"""
Token Safety Score — Main service.
Runs as:
1. HTTP API server (for on-demand analysis)
2. Cron batch analyzer (for periodic re-scoring of all tokens)
"""

import os
import sys
import json
import logging
import time
import asyncio
import secrets
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from contextlib import asynccontextmanager
import uvicorn

from analyzer import analyze_token
from db import save_score, get_score, get_all_tokens_to_analyze, supabase_public
from safety_contract import validate_safety_data, SafetyContractViolation

# Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("token_safety")

# ── Background Scheduler ─────────────────────────────────────────

RADAR_INTERVAL_MIN = int(os.environ.get("RADAR_INTERVAL_MIN", "0"))
BATCH_INTERVAL_HOURS = int(os.environ.get("BATCH_INTERVAL_HOURS", "0"))
LEAGUE_INTERVAL_HOURS = int(os.environ.get("LEAGUE_INTERVAL_HOURS", "0"))
LP_MONITOR_INTERVAL_HOURS = int(os.environ.get("LP_MONITOR_INTERVAL_HOURS", "0"))
LP_MONITOR_LIMIT = int(os.environ.get("LP_MONITOR_LIMIT", "0"))
BATCH_LIMIT = int(os.environ.get("BATCH_LIMIT", "0"))
BLACKLIST_SYNC_INTERVAL_HOURS = int(os.environ.get("BLACKLIST_SYNC_INTERVAL_HOURS", "0"))
EXPLOIT_SYNC_INTERVAL_HOURS = int(os.environ.get("EXPLOIT_SYNC_INTERVAL_HOURS", "0"))
ENABLE_SCHEDULER = os.environ.get("ENABLE_SCHEDULER", "true").lower() == "true"


async def _scheduler_loop():
    """Background scheduler: runs radar every 30min, batch every 12h, blacklist sync daily."""
    await asyncio.sleep(30)  # Wait 30s after startup before first run
    logger.info(f"Scheduler started: radar every {RADAR_INTERVAL_MIN}min, batch every {BATCH_INTERVAL_HOURS}h, leagues every {LEAGUE_INTERVAL_HOURS}h, LP monitor every {LP_MONITOR_INTERVAL_HOURS}h, blacklist sync every {BLACKLIST_SYNC_INTERVAL_HOURS}h")

    radar_interval = RADAR_INTERVAL_MIN * 60
    batch_interval = BATCH_INTERVAL_HOURS * 3600
    league_interval = LEAGUE_INTERVAL_HOURS * 3600
    lp_monitor_interval = LP_MONITOR_INTERVAL_HOURS * 3600
    blacklist_interval = BLACKLIST_SYNC_INTERVAL_HOURS * 3600
    exploit_interval = EXPLOIT_SYNC_INTERVAL_HOURS * 3600
    last_radar = 0
    last_batch = 0
    last_league = 0
    last_lp_monitor = 0
    last_blacklist = 0
    last_exploit = 0

    while True:
        now = time.time()

        # Scam Radar — run in thread to avoid blocking the HTTP event loop
        if now - last_radar >= radar_interval:
            try:
                import threading
                logger.info("[CRON] Running Scam Radar scan (background thread)...")
                def _radar_job():
                    try:
                        from scam_radar import run_scan, save_alerts
                        from db import supabase
                        alerts = run_scan(since_minutes=RADAR_INTERVAL_MIN)
                        saved = 0
                        if alerts:
                            saved = save_alerts(alerts, supabase)
                        logger.info(f"[CRON] Radar: {len(alerts)} alerts, {saved} saved")
                    except Exception as e:
                        logger.error(f"[CRON] Radar error: {e}")
                threading.Thread(target=_radar_job, daemon=True).start()
            except Exception as e:
                logger.error(f"[CRON] Radar thread error: {e}")
            last_radar = time.time()

        # Holder Leagues
        if now - last_league >= league_interval:
            try:
                logger.info("[CRON] Running Holder Leagues scrape...")
                import threading
                from holder_leagues import run_holder_leagues
                t = threading.Thread(target=run_holder_leagues, daemon=True)
                t.start()
            except Exception as e:
                logger.error(f"[CRON] Leagues error: {e}")
            last_league = time.time()

        # LP Liquidity Monitor — re-check top tokens' liquidity
        if now - last_lp_monitor >= lp_monitor_interval:
            try:
                logger.info(f"[CRON] Running LP liquidity monitor (top {LP_MONITOR_LIMIT} tokens)...")
                import threading
                t = threading.Thread(target=_run_lp_monitor, args=(LP_MONITOR_LIMIT,), daemon=True)
                t.start()
            except Exception as e:
                logger.error(f"[CRON] LP monitor error: {e}")
            last_lp_monitor = time.time()

        # Batch analysis
        if now - last_batch >= batch_interval:
            try:
                logger.info(f"[CRON] Running batch analysis (limit={BATCH_LIMIT})...")
                import threading
                t = threading.Thread(target=run_batch, args=(BATCH_LIMIT,), daemon=True)
                t.start()
            except Exception as e:
                logger.error(f"[CRON] Batch error: {e}")
            last_batch = time.time()

        # Blacklist sync (OFAC, ScamSniffer, eth-labels)
        if now - last_blacklist >= blacklist_interval:
            try:
                logger.info("[CRON] Running blacklist sync...")
                import threading
                from sync_blacklists import run_sync as run_blacklist_sync
                t = threading.Thread(target=run_blacklist_sync, daemon=True)
                t.start()
            except Exception as e:
                logger.error(f"[CRON] Blacklist sync error: {e}")
            last_blacklist = time.time()

        # Exploit history sync (Forta datasets — weekly)
        if now - last_exploit >= exploit_interval:
            try:
                logger.info("[CRON] Running exploit history sync...")
                import threading
                from sync_exploits import run_sync as run_exploit_sync
                t = threading.Thread(target=run_exploit_sync, daemon=True)
                t.start()
            except Exception as e:
                logger.error(f"[CRON] Exploit sync error: {e}")
            last_exploit = time.time()

        await asyncio.sleep(60)  # Check every minute


# ---------------------------------------------------------------------------
# Rate limiter
# ---------------------------------------------------------------------------

limiter = Limiter(key_func=get_remote_address)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start background scheduler on app startup."""
    task = None
    if ENABLE_SCHEDULER:
        task = asyncio.create_task(_scheduler_loop())
        logger.info("Background scheduler enabled")
    else:
        logger.info("Background scheduler disabled (ENABLE_SCHEDULER=false)")
    yield
    if task:
        task.cancel()


# FastAPI app
app = FastAPI(
    title="OpenPulsechain Token Safety",
    description="Token safety scoring for PulseChain tokens.",
    version="1.0.0",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── x402 Protocol (micropayments for bots/agents) ────────────────
# Must be added BEFORE CORSMiddleware so CORS is outermost (handles OPTIONS preflight).
# X402_ENABLED=false by default — zero impact on existing behavior.
from x402_config import (
    X402_ENABLED, build_x402_routes, build_x402_server,
    well_known_payload, X402BypassMiddleware, X402_NETWORK,
)

if X402_ENABLED:
    _x402_routes = build_x402_routes()
    _x402_server = build_x402_server()
    if _x402_routes and _x402_server:
        try:
            from x402.http.middleware.fastapi import PaymentMiddlewareASGI
            app.add_middleware(PaymentMiddlewareASGI, routes=_x402_routes, server=_x402_server)
            logger.info(f"x402 ENABLED — {len(_x402_routes)} paid endpoints on {X402_NETWORK}")
        except ImportError:
            logger.error("x402 package not found — running without x402")
    else:
        logger.error("x402 ENABLED but config incomplete — check X402_PAY_TO_ADDRESS")
else:
    logger.info("x402 disabled (set X402_ENABLED=true to activate)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://openpulsechain.com",
        "https://www.openpulsechain.com",
    ],
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*", "X-Payment", "Payment-Signature", "X-Api-Key"],
)


@app.middleware("http")
async def add_security_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    response.headers["Content-Security-Policy"] = "default-src 'none'"
    return response


# Address validation
import re
ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")


def _validate_address(address: str) -> str:
    addr = address.strip().lower()
    if not ADDRESS_RE.match(addr):
        raise HTTPException(status_code=400, detail="Invalid address format")
    return addr


# ── Endpoints ─────────────────────────────────────────────────────

@app.get("/health")
@limiter.limit("30/minute")
def health(request: Request):
    return {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "x402": X402_ENABLED,
    }


@app.get("/.well-known/x402")
@limiter.limit("30/minute")
def x402_discovery(request: Request):
    """x402 endpoint discovery — lists all paid endpoints, prices, and payment network."""
    return well_known_payload()


@app.get("/api/v1/chrome-security")
@limiter.limit("30/minute")
def chrome_security(request: Request):
    """
    Returns minimum safe Chrome version and known CVEs.
    Used by the Chrome extension to warn users about vulnerable browsers.
    """
    return {
        "min_chrome_version": 143,
        "cves": ["CVE-2026-0628"],
        "message": "Chrome 143+ required. Older versions have a known extension privilege escalation vulnerability.",
    }


# Fresh analysis rate limiter — simple in-process counter per IP.
_fresh_rate: dict = {}  # ip → [timestamps]
FRESH_LIMIT_PER_MIN = int(os.environ.get("FRESH_LIMIT_PER_MIN", "5"))

def _check_fresh_rate(request: Request):
    ip = get_remote_address(request)
    now = time.time()
    _fresh_rate.setdefault(ip, [])
    _fresh_rate[ip] = [t for t in _fresh_rate[ip] if now - t < 60]
    if len(_fresh_rate[ip]) >= FRESH_LIMIT_PER_MIN:
        raise HTTPException(
            status_code=429,
            detail=f"Fresh analysis limited to {FRESH_LIMIT_PER_MIN}/minute. Omit ?fresh=true to use cached score.",
        )
    _fresh_rate[ip].append(now)


@app.get("/api/v1/token/{address}/safety")
@limiter.limit("30/minute")
def token_safety(address: str, request: Request, response: Response, fresh: bool = Query(False)):
    """
    Get safety score for a token.
    - Returns cached score if available (< 1h old)
    - Set fresh=true to force re-analysis (stricter rate limit: 5/min)
    """
    addr = _validate_address(address)
    if fresh:
        _check_fresh_rate(request)

    def _enforce_contract(payload: dict) -> None:
        """
        INVARIANT — the safety response MUST satisfy the pillar contract.
        This is the pillar of the product; failing here means a regression
        has leaked into prod and we refuse to serve a silent-null response.
        """
        try:
            validate_safety_data(payload)
        except SafetyContractViolation as exc:
            logger.error(
                f"SAFETY_CONTRACT_VIOLATION addr={addr} missing={exc.missing}"
            )
            raise HTTPException(
                status_code=500,
                detail=f"Safety contract violation: {', '.join(exc.missing)}",
            )

    # Check cache first (unless fresh requested)
    if not fresh:
        cached = get_score(addr)
        if cached:
            # Check if cache is recent (< 1 hour)
            analyzed_at = cached.get("analyzed_at", "")
            if analyzed_at:
                try:
                    analyzed_dt = datetime.fromisoformat(analyzed_at.replace("Z", "+00:00"))
                    age_seconds = (datetime.now(timezone.utc) - analyzed_dt).total_seconds()
                    if age_seconds < 3600:
                        # Hydrate cached row with nested objects from analysis_details
                        # so the response schema matches the fresh path (frontend reads
                        # d.scam_analysis, d.honeypot, etc. — these are not top-level
                        # columns in token_safety_scores).
                        raw_details = cached.get("analysis_details") or {}
                        if isinstance(raw_details, str):
                            try:
                                raw_details = json.loads(raw_details)
                            except (ValueError, TypeError):
                                raw_details = {}
                        for key in ("scam_analysis", "honeypot", "contract", "lp", "holders", "age"):
                            if key in raw_details and key not in cached:
                                cached[key] = raw_details[key]

                        _enforce_contract(cached)

                        response.headers["X-Cache"] = "HIT"
                        response.headers["Cache-Control"] = "public, max-age=300"
                        return {
                            "data": cached,
                            "cached": True,
                            "cache_age_s": int(age_seconds),
                        }
                except (ValueError, TypeError):
                    pass

    # Run fresh analysis
    try:
        analysis = analyze_token(addr)
    except Exception as e:
        logger.error(f"Analysis failed for {addr}: {e}")
        raise HTTPException(status_code=500, detail="Internal error")

    # Save to DB (uses analysis["address"])
    save_score(analysis)

    # ── CRITICAL: return the SAME shape for fresh as for cache ──
    # analyze_token() returns nested objects (honeypot.score, contract.score, etc.)
    # but the extension and some frontend paths read FLAT columns (honeypot_score,
    # contract_score, is_honeypot, etc.). The DB row saved by save_score() has the
    # flat shape. Re-reading it guarantees ONE response shape for all consumers.
    # This was the root cause of the extension showing all-zeros on fresh analysis.
    saved_row = get_score(addr)
    if saved_row:
        # Hydrate nested objects from analysis_details (same as cache path)
        raw_details = saved_row.get("analysis_details") or {}
        if isinstance(raw_details, str):
            try:
                raw_details = json.loads(raw_details)
            except (ValueError, TypeError):
                raw_details = {}
        for key in ("scam_analysis", "honeypot", "contract", "lp", "holders", "age"):
            if key in raw_details and key not in saved_row:
                saved_row[key] = raw_details[key]

        _enforce_contract(saved_row)

        response.headers["X-Cache"] = "MISS"
        response.headers["Cache-Control"] = "public, max-age=300"
        return {
            "data": saved_row,
            "cached": False,
        }

    # Fallback: if re-read failed (shouldn't happen), return normalized analysis
    if "address" in analysis and "token_address" not in analysis:
        analysis["token_address"] = analysis.pop("address")

    _enforce_contract(analysis)

    response.headers["X-Cache"] = "MISS"
    response.headers["Cache-Control"] = "public, max-age=300"
    return {
        "data": analysis,
        "cached": False,
    }


@app.get("/api/v1/token/{address}/liquidity")
@limiter.limit("30/minute")
def token_liquidity(address: str, request: Request, response: Response, fresh: bool = Query(False)):
    """Get detailed liquidity breakdown for a token — all pairs with links."""
    addr = _validate_address(address)
    response.headers["Cache-Control"] = "public, max-age=300"

    supabase = supabase_public

    # Try to get from analysis_details JSONB
    row = supabase.table("token_safety_scores").select(
        "analysis_details, total_liquidity_usd, pair_count"
    ).eq("token_address", addr).execute()

    if not row.data:
        raise HTTPException(status_code=404, detail="Token not analyzed yet")

    record = row.data[0]
    raw_details = record.get("analysis_details") or {}
    # analysis_details may be stored as JSON string
    if isinstance(raw_details, str):
        import json as _json
        try:
            raw_details = _json.loads(raw_details)
        except Exception:
            raw_details = {}
    details = raw_details
    lp_data = details.get("lp", {})
    all_pairs = lp_data.get("all_pairs", [])

    # If no pairs stored yet or fresh requested, re-analyze
    if not all_pairs or fresh:
        from lp_analyzer import analyze_lp
        lp_result = analyze_lp(addr)
        all_pairs = lp_result.get("all_pairs", [])
        # Update analysis_details with fresh pair data
        lp_data["all_pairs"] = all_pairs
        lp_data["total_liquidity_usd"] = lp_result.get("total_liquidity_usd", 0)
        lp_data["pair_count"] = lp_result.get("pair_count", 0)
        lp_data["best_pair"] = lp_result.get("best_pair")
        details["lp"] = lp_data
        supabase.table("token_safety_scores").update({
            "analysis_details": json.dumps(details),
            "total_liquidity_usd": lp_result.get("total_liquidity_usd", 0),
            "pair_count": lp_result.get("pair_count", 0),
        }).eq("token_address", addr).execute()

    return {
        "token_address": addr,
        "total_liquidity_usd": lp_data.get("total_liquidity_usd", record.get("total_liquidity_usd", 0)),
        "pair_count": lp_data.get("pair_count", record.get("pair_count", 0)),
        "pairs": all_pairs,
    }


@app.get("/api/v1/tokens/safety/stats")
@limiter.limit("60/minute")
def safety_stats(request: Request, response: Response):
    """Source de vérité unique — compteurs réels depuis token_safety_scores."""
    try:
        supabase = supabase_public

        def _count(query):
            res = query.limit(1).execute()
            return res.count if res.count is not None else 0

        # Total + safe + risky
        total = _count(supabase.table("token_safety_scores").select("token_address", count="exact"))
        safe = _count(supabase.table("token_safety_scores").select("token_address", count="exact").gte("score", 60))
        risky = total - safe

        # Honeypots
        honeypots = _count(supabase.table("token_safety_scores").select("token_address", count="exact").eq("is_honeypot", True))
        honeypot_inconclusive = _count(supabase.table("token_safety_scores").select("token_address", count="exact").is_("is_honeypot", "null"))

        # Scam risk (via dedicated column populated at analysis time)
        scam_critical = _count(supabase.table("token_safety_scores").select("token_address", count="exact").eq("scam_risk_level", "critical"))
        scam_high = _count(supabase.table("token_safety_scores").select("token_address", count="exact").eq("scam_risk_level", "high"))
        scam_medium = _count(supabase.table("token_safety_scores").select("token_address", count="exact").eq("scam_risk_level", "medium"))
        scam_low = _count(supabase.table("token_safety_scores").select("token_address", count="exact").eq("scam_risk_level", "low"))

        response.headers["Cache-Control"] = "public, max-age=300"
        return {
            "analyzed": total,
            "safe": safe,
            "risky": risky,
            "honeypots": honeypots,
            "honeypot_inconclusive": honeypot_inconclusive,
            "scam": {
                "critical": scam_critical,
                "high": scam_high,
                "medium": scam_medium,
                "low": scam_low,
                "total_high_or_critical": scam_critical + scam_high,
            },
        }
    except Exception as e:
        logger.error(f"Safety stats query failed: {e}")
        raise HTTPException(status_code=500, detail="Internal error")


@app.get("/api/v1/tokens/safety/stats/grades")
@limiter.limit("30/minute")
def safety_stats_grades(request: Request, response: Response):
    """Detailed breakdown: grades × categories (safe/risky/honeypot/scam)."""
    try:
        supabase = supabase_public

        def _count(query):
            res = query.limit(1).execute()
            return res.count if res.count is not None else 0

        result = {"grades": {}, "cross": {}}

        for grade in ["A", "B", "C", "D", "F"]:
            g_total = _count(supabase.table("token_safety_scores").select("token_address", count="exact").eq("grade", grade))
            g_safe = _count(supabase.table("token_safety_scores").select("token_address", count="exact").eq("grade", grade).gte("score", 60))
            g_risky = _count(supabase.table("token_safety_scores").select("token_address", count="exact").eq("grade", grade).lt("score", 60))
            g_honeypot = _count(supabase.table("token_safety_scores").select("token_address", count="exact").eq("grade", grade).eq("is_honeypot", True))
            g_scam_critical = _count(supabase.table("token_safety_scores").select("token_address", count="exact").eq("grade", grade).eq("scam_risk_level", "critical"))
            g_scam_high = _count(supabase.table("token_safety_scores").select("token_address", count="exact").eq("grade", grade).eq("scam_risk_level", "high"))
            result["grades"][grade] = {
                "total": g_total,
                "safe": g_safe,
                "risky": g_risky,
                "honeypots": g_honeypot,
                "scams_high_or_critical": g_scam_critical + g_scam_high,
            }

        # Anomalies
        safe_below_B = _count(supabase.table("token_safety_scores").select("token_address", count="exact").gte("score", 60).not_.in_("grade", ["A", "B"]))
        risky_with_AB = _count(supabase.table("token_safety_scores").select("token_address", count="exact").lt("score", 60).in_("grade", ["A", "B"]))
        honeypot_AB = _count(supabase.table("token_safety_scores").select("token_address", count="exact").eq("is_honeypot", True).in_("grade", ["A", "B"]))
        scam_AB = _count(supabase.table("token_safety_scores").select("token_address", count="exact").in_("scam_risk_level", ["critical", "high"]).in_("grade", ["A", "B"]))

        result["anomalies"] = {
            "safe_below_B": safe_below_B,
            "risky_with_A_or_B": risky_with_AB,
            "honeypot_with_A_or_B": honeypot_AB,
            "scam_with_A_or_B": scam_AB,
        }

        response.headers["Cache-Control"] = "public, max-age=300"
        return result
    except Exception as e:
        logger.error(f"Safety grades stats query failed: {e}")
        raise HTTPException(status_code=500, detail="Internal error")


@app.get("/api/v1/tokens/safety/batch")
@limiter.limit("30/minute")
def batch_safety(request: Request, limit: int = Query(20, ge=1, le=200), offset: int = Query(0, ge=0)):
    """Get safety scores for analyzed tokens, ordered by liquidity."""
    try:
        supabase = supabase_public
        query = supabase.table("token_safety_scores").select(
            "token_address, score, grade, risks, is_honeypot, is_verified, "
            "total_liquidity_usd, holder_count, top10_pct, analyzed_at"
        ).order("total_liquidity_usd", desc=True).range(offset, offset + limit - 1)
        result = query.execute()

        return {
            "data": result.data or [],
            "count": len(result.data or []),
        }
    except Exception as e:
        logger.error(f"Batch safety query failed: {e}")
        raise HTTPException(status_code=500, detail="Internal error")


# ── Scam Radar ────────────────────────────────────────────────────

@app.get("/api/v1/alerts/recent")
@limiter.limit("30/minute")
def recent_alerts(request: Request, limit: int = Query(50, ge=1, le=200), alert_type: str = Query(None)):
    """Get recent scam radar alerts."""
    VALID_ALERT_TYPES = {"honeypot", "lp_removal", "whale_dump", "mint_event", "flagged_activity"}
    if alert_type and alert_type not in VALID_ALERT_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid alert_type. Must be one of: {', '.join(sorted(VALID_ALERT_TYPES))}")
    try:
        supabase = supabase_public
        query = supabase.table("scam_radar_alerts").select("alert_type, severity, token_address, pair_address, data, created_at")
        if alert_type:
            query = query.eq("alert_type", alert_type)
        result = query.order("created_at", desc=True).limit(limit).execute()
        return {"data": result.data or [], "count": len(result.data or [])}
    except Exception as e:
        logger.error(f"Recent alerts query failed: {e}")
        raise HTTPException(status_code=500, detail="Internal error")


# ── Deployer Reputation ──────────────────────────────────────────

@app.get("/api/v1/address/{address}/risk")
@limiter.limit("30/minute")
def address_risk(address: str, request: Request, response: Response):
    """Check if an address is flagged in known_addresses (AML/exploit/phishing)."""
    addr = _validate_address(address)
    response.headers["Cache-Control"] = "public, max-age=600"

    try:
        supabase = supabase_public
        result = supabase.table("known_addresses").select(
            "address,label,risk_level,category,source"
        ).eq("address", addr).limit(1).execute()

        if result.data:
            return {"data": result.data[0]}
        return {"data": None}
    except Exception as e:
        logger.warning(f"Failed to check address risk: {e}")
        return {"data": None}


@app.get("/api/v1/deployer/{address}")
@limiter.limit("30/minute")
def deployer_reputation(address: str, request: Request, response: Response, fresh: bool = Query(False)):
    """Get deployer reputation score."""
    addr = _validate_address(address)

    if not fresh:
        try:
            supabase = supabase_public
            cached = supabase.table("deployer_reputation").select("deployer_address, tokens_deployed, tokens_dead, tokens_alive, dead_ratio, reputation_score, risk_level, tokens, analyzed_at").eq(
                "deployer_address", addr
            ).execute()
            if cached.data:
                response.headers["X-Cache"] = "HIT"
                return {"data": cached.data[0], "cached": True}
        except Exception:
            pass

    # Fresh analysis
    from serial_rugger import calculate_deployer_score
    result = calculate_deployer_score(addr)

    # Save
    try:
        supabase = supabase_public
        import json
        supabase.table("deployer_reputation").upsert({
            "deployer_address": result["deployer"],
            "tokens_deployed": result["tokens_deployed"],
            "tokens_dead": result["tokens_dead"],
            "tokens_alive": result["tokens_alive"],
            "dead_ratio": result["dead_ratio"],
            "reputation_score": result["reputation_score"],
            "risk_level": result["risk_level"],
            "tokens": json.dumps(result["tokens"]),
            "analyzed_at": datetime.now(timezone.utc).isoformat(),
        }, on_conflict="deployer_address").execute()
    except Exception as e:
        logger.warning(f"Failed to cache deployer score: {e}")

    response.headers["X-Cache"] = "MISS"
    return {"data": result, "cached": False}


@app.get("/api/v1/token/{address}/deployer")
@limiter.limit("30/minute")
def token_deployer(address: str, request: Request, response: Response):
    """Get deployer reputation for a specific token."""
    addr = _validate_address(address)

    from serial_rugger import analyze_deployer_for_token
    result = analyze_deployer_for_token(addr)
    if not result:
        raise HTTPException(status_code=404, detail="Could not determine deployer")

    return {"data": result}


# ── Smart Money ───────────────────────────────────────────────────

@app.get("/api/v1/smart-money/feed")
@limiter.limit("30/minute")
def smart_money_feed(
    request: Request,
    response: Response,
    hours: int = Query(24, ge=1, le=168),
    min_usd: float = Query(5000, ge=100),
):
    """Smart money feed: top wallets by volume + their recent activity."""
    response.headers["Cache-Control"] = "public, max-age=300"
    from smart_money import build_smart_money_feed
    return build_smart_money_feed(since_hours=hours, min_usd=min_usd)


@app.get("/api/v1/smart-money/swaps")
@limiter.limit("30/minute")
def smart_money_swaps(
    request: Request,
    response: Response,
    minutes: int = Query(60, ge=5, le=1440),
    min_usd: float = Query(1000, ge=100),
):
    """Recent large swaps across PulseX."""
    response.headers["Cache-Control"] = "public, max-age=60"
    from smart_money import get_recent_large_swaps
    swaps = get_recent_large_swaps(since_minutes=minutes, min_usd=min_usd)
    return {"data": swaps, "count": len(swaps)}


@app.get("/api/v1/wallet/{address}/swaps")
@limiter.limit("30/minute")
def wallet_swaps(address: str, request: Request, response: Response):
    """Recent swap history for a wallet."""
    addr = _validate_address(address)
    response.headers["Cache-Control"] = "public, max-age=120"
    from smart_money import get_wallet_swap_history
    swaps = get_wallet_swap_history(addr)
    return {"data": swaps, "wallet": addr, "count": len(swaps)}


@app.get("/api/v1/wallet/{address}/balances")
@limiter.limit("30/minute")
def wallet_balances(address: str, request: Request, response: Response):
    """Current token balances for a wallet."""
    addr = _validate_address(address)
    response.headers["Cache-Control"] = "public, max-age=120"
    from smart_money import get_wallet_token_balances
    balances = get_wallet_token_balances(addr)
    return {"data": balances, "wallet": addr, "count": len(balances)}


# ── Token tweets (proxy — avoids exposing database keys in the extension) ──

@app.get("/api/v1/token/{symbol}/tweets")
@limiter.limit("30/minute")
def token_tweets(symbol: str, request: Request, response: Response,
                 limit: int = Query(10, ge=1, le=50),
                 hours: int = Query(0, ge=0, le=168)):
    """
    Search recent tweets mentioning a token symbol.
    This endpoint proxies the research_tweets table so that the
    extension (and any client) never needs the database key directly.
    hours=0 means no time filter (return the N most recent overall).
    """
    import re as _re
    response.headers["Cache-Control"] = "public, max-age=120"

    # Sanitize symbol — only allow alphanumeric + underscore (no PostgREST injection)
    clean_symbol = _re.sub(r'[^a-zA-Z0-9_]', '', symbol.strip().upper())
    if not clean_symbol or len(clean_symbol) > 20:
        raise HTTPException(status_code=400, detail="Invalid symbol")

    # Build search aliases for common PulseChain tokens
    ALIASES: dict[str, list[str]] = {
        "WPLS": ["PLS", "PulseChain", "WPLS"],
        "PLS": ["PLS", "PulseChain", "WPLS"],
        "HEX": ["HEX"],
        "PLSX": ["PLSX", "PulseX"],
        "INC": ["INC", "Incentive"],
    }
    terms = ALIASES.get(clean_symbol, [clean_symbol])

    supabase = supabase_public
    try:
        # Build OR filter for text search across aliases
        or_parts = [f"text.ilike.*{t}*" for t in terms]
        query = supabase.table("research_tweets") \
            .select("id,text,author_username,like_count,tweeted_at") \
            .or_(",".join(or_parts)) \
            .order("tweeted_at", desc=True) \
            .limit(limit)

        if hours > 0:
            since = (datetime.now(timezone.utc) - __import__('datetime').timedelta(hours=hours)).isoformat()
            query = query.gte("tweeted_at", since)

        result = query.execute()
        return {"data": result.data or [], "count": len(result.data or [])}

    except Exception as e:
        logger.error(f"Tweet search failed for {clean_symbol}: {e}")
        return {"data": [], "count": 0}


# ── Bridge stats ──

@app.get("/api/v1/bridge/stats")
@limiter.limit("30/minute")
def bridge_stats(request: Request, response: Response):
    """Bridge daily stats for the last 7 days."""
    response.headers["Cache-Control"] = "public, max-age=300"
    supabase = supabase_public
    from datetime import timedelta
    since = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d")
    result = supabase.table("bridge_daily_stats") \
        .select("date,deposit_count,withdrawal_count,deposit_volume_usd,withdrawal_volume_usd,net_flow_usd") \
        .gte("date", since) \
        .order("date", desc=True) \
        .execute()
    return {"data": result.data or [], "count": len(result.data or [])}


@app.get("/api/v1/bridge/hyperlane")
@limiter.limit("30/minute")
def hyperlane_stats(request: Request, response: Response):
    """Hyperlane bridge daily stats for the last 7 days + chain stats."""
    response.headers["Cache-Control"] = "public, max-age=300"
    supabase = supabase_public
    from datetime import timedelta
    since = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d")
    daily = supabase.table("hyperlane_daily_stats") \
        .select("date,inbound_count,outbound_count,inbound_volume_usd,outbound_volume_usd,net_flow_usd,unique_users,unique_chains") \
        .gte("date", since) \
        .order("date", desc=True) \
        .execute()
    chains = supabase.table("hyperlane_chain_stats") \
        .select("chain_name,total_inbound_count,total_outbound_count,total_inbound_volume_usd,total_outbound_volume_usd,net_flow_usd") \
        .order("total_inbound_volume_usd", desc=True) \
        .limit(10) \
        .execute()
    return {
        "daily": daily.data or [],
        "chains": chains.data or [],
    }


# ── Holder Leagues ───────────────────────────────────────────────

@app.get("/api/v1/leagues")
@limiter.limit("30/minute")
def holder_leagues(request: Request, response: Response):
    """Current holder league counts for all tracked tokens."""
    response.headers["Cache-Control"] = "public, max-age=600"
    supabase = supabase_public
    result = supabase.table("holder_league_current").select("token_symbol, token_address, total_holders, total_supply, total_supply_human, poseidon_count, whale_count, shark_count, dolphin_count, squid_count, turtle_count, total_entities, poseidon_entities, whale_entities, shark_entities, dolphin_entities, squid_entities, turtle_entities, family_count, updated_at").execute()
    return {"data": result.data or [], "count": len(result.data or [])}


@app.get("/api/v1/leagues/rank/{address}")
@limiter.limit("30/minute")
def holder_rank(address: str, request: Request, response: Response):
    """Get holder rank for a wallet address across all league tokens (PLS, PLSX, HEX, INC)."""
    if not re.match(r"^0x[0-9a-fA-F]{40}$", address):
        raise HTTPException(status_code=400, detail="Invalid address")
    response.headers["Cache-Control"] = "public, max-age=300"
    supabase = supabase_public
    addr = address.lower()
    ranks = {}
    for sym in ("PLS", "PLSX", "HEX", "INC"):
        # Find the holder's entry
        entry = supabase.table("holder_league_addresses").select("balance_pct,tier") \
            .eq("token_symbol", sym).eq("holder_address", addr).execute()
        if not entry.data:
            continue
        holder = entry.data[0]
        # Count how many holders have a higher balance_pct = rank
        count_above = supabase.table("holder_league_addresses").select("holder_address", count="exact") \
            .eq("token_symbol", sym).gt("balance_pct", holder["balance_pct"]).execute()
        # Get total holders from current table
        total = supabase.table("holder_league_current").select("total_holders") \
            .eq("token_symbol", sym).execute()
        total_holders = total.data[0]["total_holders"] if total.data else 0
        rank = (count_above.count or 0) + 1
        ranks[sym] = {
            "rank": rank,
            "total_holders": total_holders,
            "tier": holder["tier"],
            "balance_pct": holder["balance_pct"],
        }
    return {"address": addr, "ranks": ranks}


@app.get("/api/v1/leagues/{symbol}")
@limiter.limit("30/minute")
def holder_league_detail(symbol: str, request: Request, response: Response):
    """Current holder league for a specific token."""
    sym = symbol.upper()
    if sym == "PHEX":
        sym = "HEX"
    if sym not in ("PLS", "PLSX", "HEX", "INC"):
        raise HTTPException(status_code=400, detail="Invalid token symbol")
    response.headers["Cache-Control"] = "public, max-age=600"
    supabase = supabase_public
    result = supabase.table("holder_league_current").select("token_symbol, token_address, total_holders, total_supply, total_supply_human, poseidon_count, whale_count, shark_count, dolphin_count, squid_count, turtle_count, total_entities, poseidon_entities, whale_entities, shark_entities, dolphin_entities, squid_entities, turtle_entities, family_count, updated_at").eq("token_symbol", sym).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="No data yet")
    return {"data": result.data[0]}


@app.get("/api/v1/leagues/{symbol}/holders")
@limiter.limit("30/minute")
def league_holders(symbol: str, request: Request, response: Response, tier: str = Query(None)):
    """Individual holders for a token, optionally filtered by tier."""
    sym = symbol.upper()
    if sym == "PHEX":
        sym = "HEX"
    if sym not in ("PLS", "PLSX", "HEX", "INC"):
        raise HTTPException(status_code=400, detail="Invalid token symbol")
    response.headers["Cache-Control"] = "public, max-age=600"
    supabase = supabase_public
    query = supabase.table("holder_league_addresses").select("token_symbol, holder_address, balance_pct, tier, family_id").eq("token_symbol", sym)
    if tier:
        valid_tiers = ("poseidon", "whale", "shark", "dolphin", "squid", "turtle")
        if tier not in valid_tiers:
            raise HTTPException(status_code=400, detail="Invalid tier")
        query = query.eq("tier", tier)
    result = query.order("balance_pct", desc=True).limit(500).execute()
    return {"data": result.data or [], "count": len(result.data or [])}


@app.get("/api/v1/leagues/{symbol}/families")
@limiter.limit("30/minute")
def league_families(symbol: str, request: Request, response: Response, tier: str = Query(None)):
    """Family clusters for a token, optionally filtered by combined tier."""
    sym = symbol.upper()
    if sym == "PHEX":
        sym = "HEX"
    if sym not in ("PLS", "PLSX", "HEX", "INC"):
        raise HTTPException(status_code=400, detail="Invalid token symbol")
    response.headers["Cache-Control"] = "public, max-age=600"
    supabase = supabase_public
    query = supabase.table("holder_league_families").select("token_symbol, family_id, mother_address, daughter_count, combined_balance_pct, combined_tier, individual_tier, link_types, confidence_score").eq("token_symbol", sym)
    if tier:
        query = query.eq("combined_tier", tier)
    result = query.order("combined_balance_pct", desc=True).limit(100).execute()
    return {"data": result.data or [], "count": len(result.data or [])}


@app.get("/api/v1/leagues/{symbol}/families/{family_id}/members")
@limiter.limit("30/minute")
def family_members(symbol: str, family_id: str, request: Request, response: Response):
    """All members of a specific family for a token."""
    sym = symbol.upper()
    if sym == "PHEX":
        sym = "HEX"
    if sym not in ("PLS", "PLSX", "HEX", "INC"):
        raise HTTPException(status_code=400, detail="Invalid token symbol")
    if not re.match(r"^0x[0-9a-fA-F]{40}$", family_id):
        raise HTTPException(status_code=400, detail="Invalid address")
    response.headers["Cache-Control"] = "public, max-age=600"
    from db import supabase
    result = supabase.table("holder_league_addresses").select("token_symbol, holder_address, balance_pct, tier, family_id") \
        .eq("token_symbol", sym).eq("family_id", family_id.lower()) \
        .order("balance_pct", desc=True).execute()
    return {"data": result.data or [], "count": len(result.data or [])}


@app.get("/api/v1/leagues/{symbol}/history")
@limiter.limit("30/minute")
def holder_league_history(symbol: str, request: Request, response: Response, days: int = Query(30, ge=1, le=365)):
    """Historical holder league data for trend charts."""
    sym = symbol.upper()
    if sym == "PHEX":
        sym = "HEX"
    if sym not in ("PLS", "PLSX", "HEX", "INC"):
        raise HTTPException(status_code=400, detail="Invalid token symbol")
    response.headers["Cache-Control"] = "public, max-age=1800"
    from db import supabase
    from datetime import timedelta
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    result = supabase.table("holder_league_snapshots") \
        .select("token_symbol,total_holders,poseidon_count,whale_count,shark_count,dolphin_count,squid_count,turtle_count,scraped_at") \
        .eq("token_symbol", sym) \
        .gte("scraped_at", since) \
        .order("scraped_at", desc=False) \
        .execute()
    return {"data": result.data or [], "count": len(result.data or [])}


# ── Cron endpoints (called by scheduled job or external scheduler) ──

CRON_SECRET = os.environ.get("CRON_SECRET", "")


def _check_cron_secret(request: Request):
    """Validate cron secret via Authorization header ONLY (timing-safe).
    Query params are logged by proxies/CDN/access logs — never accept secrets there."""
    if not CRON_SECRET:
        raise HTTPException(status_code=403, detail="CRON_SECRET not configured")
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=403, detail="Missing Authorization: Bearer header")
    token = auth[7:]
    if not secrets.compare_digest(token, CRON_SECRET):
        raise HTTPException(status_code=403, detail="Unauthorized")


@app.get("/cron/radar")
@limiter.limit("5/minute")
def cron_radar(request: Request):
    """Run scam radar scan. Protected by CRON_SECRET."""
    _check_cron_secret(request)

    from scam_radar import run_scan, save_alerts
    from db import supabase

    alerts = run_scan(since_minutes=30)
    saved = 0
    if alerts:
        saved = save_alerts(alerts, supabase)
    return {"alerts_found": len(alerts), "alerts_saved": saved}


# ── Funding tree ─────────────────────────────────────────

import requests as http_req

SCAN_API_V2 = "https://api.scan.pulsechain.com/api/v2"

# ── Known contracts on PulseChain (comprehensive registry) ──
KNOWN_LABELS: dict[str, str] = {
    # ══════ BRIDGES ══════
    # OmniBridge (PulseChain side)
    "0x4fd0aaa7506f3d9cb8274bdb946ec42a1b8751ef": "OmniBridge",
    "0xf868da5a5d5f799cee2205d8fd1f5ad2c4a28499": "OmniBridge WPLS Router",
    "0x6ef79fd6f9f840264332884240539ed7a2da8b2b": "OmniBridge AMB",
    "0xa3177000d645c599e45f946240f9c2f46d26718b": "OmniBridge AMB 2",
    "0x0e18d0d556b652794ef12bf68b2dc857ef5f3996": "OmniBridge 2",
    "0xf1dfc63e10ff01b8c3d307529b47aefad2154c0e": "OmniBridge 3",
    "0x3b0e59054b34fc91e6fa4c5600f661a183409af1": "OmniBridge WPLS Router 2",
    "0x1715a3e4a142d8b698131108995174f37aeba10d": "OmniBridge (ETH)",
    # Hyperlane
    "0x56176c7fb66fdd70ef962ae53a46a226c7f6a2cc": "Hyperlane Mailbox",
    "0xc996f4d7d7f39189921a08f3daaf1b9ff0b20006": "Hyperlane IGP",
    "0xa5b0d537cebe97f087dc5fe5732d70719caaec1d": "Hyperlane USDC Warp",

    # ══════ BURN / SYSTEM ══════
    "0x0000000000000000000000000000000000000000": "Null (Mint)",
    "0x0000000000000000000000000000000000000369": "Burn (0x369)",
    "0x000000000000000000000000000000000000dead": "Burn (dead)",
    "0x3693693693693693693693693693693693693693": "Validator Deposit",
    "0x0000000000000000000000000000000000001000": "ValidatorSet (System)",
    "0x0000000000000000000000000000000000001002": "Staking (System)",

    # ══════ DEX ROUTERS ══════
    # PulseX
    "0x98bf93ebf5c380c0e6ae8e192a7e2ae08edacc02": "PulseX V1",
    "0x165c3410fc91ef562c50559f7d2289febed552d9": "PulseX V2",
    "0xda9aba4eacf54e0273f56dffee6b8f1e20b23bba": "PulseX Router",
    "0xb2ca4a66d3e57a5a9a12043b6bad28249fe302d4": "PulseX MasterChef",
    # Piteas (aggregator)
    "0x6bf228eb7f8ad948d37ded07e595efddfaaf88a6": "Piteas",
    # 9inch
    "0xeb45a3c4aedd0f47f345fb4c8a1802bb5740d725": "9inch",
    # 9mm
    "0xcc73b59f8d7b7c532703bdfea2808a28a488cf47": "9mm",
    # PHUX (Balancer fork)
    "0x7f51ac3df6a034273fb09bb29e383fcf655e473c": "PHUX Vault",
    "0xba12222222228d8ba445958a75a0704d566bf2c8": "PHUX Vault (alt)",
    # Velocimeter
    "0x370d160992c8c48bccfcf009f0c9db9d00574ef7": "Velocimeter",
    # PulseSwap
    "0xed509c29f3aaaebe3e04c8d2d95e31dd80d75264": "PulseSwap",
    # EazySwap
    "0x05d5f20500ed8d9e012647e6cfe1b2bf89f5b926": "EazySwap",
    # Internet Money Swap
    "0x2963ab11d012791acfa7a4b8d428da129898a8e4": "Internet Money Swap",
    "0xa11aa626e637df91f3ccd4f795a3d07a3dfaf00e": "Internet Money Swap 2",
    # DexTop
    "0x2221eea96821e537f100c711de439f79451c6a01": "DexTop V2",
    "0x6c2abb5701976282a722aea1db85aced38397b1f": "DexTop V1",
    # SparkSwap
    "0x955219a87eb0c6754fd247266af970f7d16906cd": "SparkSwap",
    # Algebra
    "0x63e82cf4e45afa17f1869c5d35cc7518baf8bdb0": "Algebra Swap",
    # Elk
    "0x7ae799fdbe4c330a4ac18d8d65765222a0d47e6d": "Elk Router",
    # FireBird (aggregator)
    "0x49b9009a62f921c58307e342546e8ab5c2138f05": "FireBird",
    # DEGEN (GMX fork — perpetuals)
    "0x690a67a48fbf97bfceb474aa110a69b568a3d85a": "DEGEN Exchange",

    # ══════ DeFi PROTOCOLS ══════
    # LiquidLoans (Liquity fork)
    "0xa09bb56b39d652988c7e7d3665aa7ec7308bbf09": "LiquidLoans",
    "0x7bfd406632483ad00c6edf655e04de91a96f84bc": "LiquidLoans StabilityPool",
    # Phiat (Aave V2 fork)
    "0x96e035ae0905efac8f733f133462f971cfa45db1": "Phiat",
    # POWERCITY Earn
    "0xb513038bbfdf9d40b676f41606f4f61d4b02c4a2": "POWERCITY Earn",
    # Maximus DAO (pooled HEX stakes)
    "0x0d86eb9f43c57f6ff3bc9e23d8f9d82503f0e84b": "Maximus MAXI",
    "0xe9f84d418b008888a992ff8c6d22389c2c3504e0": "Maximus BASE",
    # Hedron / Icosa
    "0x3819f64f282bf135d62168c1e513280daf905e06": "Hedron (HDRN)",
    "0xfc4913214444af5c715cc9f7b52655e788a569ed": "Icosa (ICSA)",
    # Genius
    "0x444444444444c1a66f394025ac839a535246fcc8": "Genius (GENI)",
    # PHAME (GMX fork)
    "0x8854bc985fb5725f872c8856bea11b917caeb2fe": "PHAME",
    # Vouch Liquid Staking
    "0x79bb3a0ee435f957ce4f54ee8c3cfadc7278da0c": "Vouch vPLS",
    # DxSale (launchpad)
    "0xf063fe1ab7a291c5d06a86e14730b00bf24cb589": "DxSale",
    # Team Finance (locker)
    "0xcc4304a31d09258b0029ea7fe63d032f52e44efe": "Team Finance Lock",
    # Multicall
    "0xca11bde05977b3631167028862be2a173976ca11": "Multicall3",

    # ══════ KNOWN TOKENS (for labeling) ══════
    "0xa1077a294dde1b09bb078844df40758a5d0f9a27": "WPLS",
    "0x95b303987a60c71504d99aa1b13b4da07b0790ab": "PLSX Token",
    "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39": "HEX",
    "0x2fa878ab3f87cc1c9737fc071108f904c0b0c95d": "INC Token",

    # ══════ HEX ECOSYSTEM ══════
    "0x9a6a414d6f3497c05e3b1de90520765fa1e07c03": "HEX Origin Address (OA)",
}

# Quick lookup sets
BRIDGE_ADDRS = {addr for addr, label in KNOWN_LABELS.items()
                if any(k in label for k in ("Bridge", "Omni", "Hyperlane"))}

DEX_ADDRS = {addr for addr, label in KNOWN_LABELS.items()
             if any(k in label for k in ("PulseX", "Piteas", "9inch", "9mm", "PHUX",
                                          "Velocimeter", "PulseSwap", "EazySwap",
                                          "Internet Money", "DexTop", "SparkSwap",
                                          "Algebra", "Elk", "FireBird", "DEGEN"))}

BURN_ADDRS = {addr for addr, label in KNOWN_LABELS.items()
              if any(k in label for k in ("Burn", "Null", "dead"))}


def _fetch_incoming_txs(addr: str, limit: int = 50) -> list[dict]:
    """Fetch incoming transactions for an address from PulseChain Scan API v2."""
    try:
        resp = http_req.get(
            f"{SCAN_API_V2}/addresses/{addr}/transactions",
            params={"filter": "to"},
            timeout=12,
        )
        if resp.status_code != 200:
            return []
        items = resp.json().get("items", [])[:limit]
        return items
    except Exception:
        return []


def _fetch_address_info(addr: str) -> dict:
    """Fetch address metadata (name, is_contract) from Scan API."""
    try:
        resp = http_req.get(f"{SCAN_API_V2}/addresses/{addr}", timeout=8)
        if resp.status_code != 200:
            return {}
        return resp.json()
    except Exception:
        return {}


def _build_funders(addr: str, max_funders: int = 10) -> list[dict]:
    """Group incoming transactions by sender, return top funders."""
    items = _fetch_incoming_txs(addr)
    senders: dict[str, dict] = {}

    for tx in items:
        from_info = tx.get("from") or {}
        sender = (from_info.get("hash") or "").lower()
        if not sender or sender == addr:
            continue

        value_wei = int(tx.get("value") or "0")
        value_pls = value_wei / 1e18

        if sender not in senders:
            senders[sender] = {
                "address": sender,
                "total_pls": 0,
                "tx_count": 0,
                "is_contract": from_info.get("is_contract", False),
                "label": KNOWN_LABELS.get(sender) or from_info.get("name"),
                "first_tx": tx.get("timestamp"),
            }
        senders[sender]["total_pls"] += value_pls
        senders[sender]["tx_count"] += 1

    result = sorted(senders.values(), key=lambda x: x["total_pls"], reverse=True)
    return result[:max_funders]


def _detect_protocol_interactions(addr: str) -> list[dict]:
    """Detect bridge + DEX interactions for an address."""
    interactions: dict[str, dict] = {}
    known_addrs = BRIDGE_ADDRS | DEX_ADDRS
    try:
        # Outgoing: wallet → protocol (bridge or DEX)
        out_resp = http_req.get(
            f"{SCAN_API_V2}/addresses/{addr}/transactions",
            params={"filter": "from"},
            timeout=12,
        )
        if out_resp.status_code == 200:
            for tx in out_resp.json().get("items", []):
                to_info = tx.get("to") or {}
                to_addr = (to_info.get("hash") or "").lower()
                if to_addr in known_addrs:
                    value_pls = int(tx.get("value") or "0") / 1e18
                    key = f"{addr}>{to_addr}"
                    if key not in interactions:
                        interactions[key] = {
                            "address": to_addr,
                            "total_pls": 0,
                            "tx_count": 0,
                            "is_contract": True,
                            "label": KNOWN_LABELS.get(to_addr, "Contract"),
                            "first_tx": tx.get("timestamp"),
                            "direction": "outgoing",
                            "wallet": addr,
                        }
                    interactions[key]["total_pls"] += value_pls
                    interactions[key]["tx_count"] += 1

        # Incoming: protocol → wallet
        in_resp = http_req.get(
            f"{SCAN_API_V2}/addresses/{addr}/transactions",
            params={"filter": "to"},
            timeout=12,
        )
        if in_resp.status_code == 200:
            for tx in in_resp.json().get("items", []):
                from_info = tx.get("from") or {}
                from_addr = (from_info.get("hash") or "").lower()
                if from_addr in known_addrs:
                    value_pls = int(tx.get("value") or "0") / 1e18
                    key = f"{from_addr}>{addr}"
                    if key not in interactions:
                        interactions[key] = {
                            "address": from_addr,
                            "total_pls": 0,
                            "tx_count": 0,
                            "is_contract": True,
                            "label": KNOWN_LABELS.get(from_addr, "Contract"),
                            "first_tx": tx.get("timestamp"),
                            "direction": "incoming",
                            "wallet": addr,
                        }
                    interactions[key]["total_pls"] += value_pls
                    interactions[key]["tx_count"] += 1
    except Exception as e:
        logger.warning(f"Protocol detection error for {addr}: {str(e)[:100]}")

    # ── Detect bridged tokens in holdings (e.g. "from Ethereum" tokens = OmniBridge) ──
    try:
        bal_resp = http_req.get(
            f"{SCAN_API_V2}/addresses/{addr}/token-balances",
            timeout=10,
        )
        if bal_resp.status_code == 200:
            omni_addr = "0x4fd0aaa7506f3d9cb8274bdb946ec42a1b8751ef"
            hyperlane_addr = "0xa5b0d537cebe97f087dc5fe5732d70719caaec1d"
            for item in bal_resp.json():
                token = item.get("token") or {}
                name = (token.get("name") or "").lower()
                value_str = item.get("value", "0")
                if not value_str or value_str == "0":
                    continue
                # Tokens bridged via OmniBridge have "from ethereum" in name
                if "from ethereum" in name:
                    key = f"bridged_omni>{addr}"
                    if key not in interactions:
                        interactions[key] = {
                            "address": omni_addr,
                            "total_pls": 0,
                            "tx_count": 0,
                            "is_contract": True,
                            "label": "OmniBridge",
                            "first_tx": None,
                            "direction": "incoming",
                            "wallet": addr,
                            "bridged_tokens": [],
                        }
                    interactions[key]["bridged_tokens"].append(token.get("symbol", "?"))
                    interactions[key]["tx_count"] += 1
    except Exception as e:
        logger.warning(f"Bridged token detection error for {addr}: {str(e)[:100]}")

    return list(interactions.values())


@app.get("/api/v1/address/{address}/funding-tree")
@limiter.limit("30/minute")
def address_funding_tree(address: str, request: Request, response: Response):
    """Trace funding sources of an address (2 levels deep).
    Returns: target info + funders (each with optional sub-funders + bridge interactions)."""
    if not ADDRESS_RE.match(address):
        raise HTTPException(status_code=400, detail="Invalid address")

    addr = address.lower()

    # Get target address info
    target_info = _fetch_address_info(addr)

    # Level 1: direct funders
    funders = _build_funders(addr, max_funders=10)

    # Only cache responses that have data — never cache empty results
    if funders:
        response.headers["Cache-Control"] = "public, max-age=1800"
    else:
        response.headers["Cache-Control"] = "no-store"

    # Level 2: for the top 5 non-contract funders, trace their funders
    for f in funders[:5]:
        if not f["is_contract"] and f["total_pls"] > 0:
            f["funders"] = _build_funders(f["address"], max_funders=5)
        else:
            f["funders"] = []

    # ── Detect bridge interactions for target ──
    bridge_interactions = _detect_protocol_interactions(addr)

    # ── Detect bridge interactions for each funder (parallel, max 5) ──
    from concurrent.futures import ThreadPoolExecutor, as_completed
    funder_addrs = [f["address"] for f in funders[:5] if not f["is_contract"]]
    if funder_addrs:
        with ThreadPoolExecutor(max_workers=5) as pool:
            futures = {pool.submit(_detect_protocol_interactions, fa): fa for fa in funder_addrs}
            for future in as_completed(futures, timeout=30):
                try:
                    result = future.result()
                    bridge_interactions.extend(result)
                except Exception:
                    pass

    # Also check whale_links for known relationships
    from db import supabase
    links_out = supabase.table("whale_links").select("address_from, address_to, link_type, confidence_score") \
        .eq("address_from", addr).limit(20).execute()
    links_in = supabase.table("whale_links").select("address_from, address_to, link_type, confidence_score") \
        .eq("address_to", addr).limit(20).execute()

    return {
        "target": addr,
        "target_name": target_info.get("name"),
        "target_is_contract": target_info.get("is_contract", False),
        "funders": funders,
        "bridge_interactions": bridge_interactions,
        "whale_links": (links_out.data or []) + (links_in.data or []),
    }


@app.get("/api/v1/address/{address}/transactions")
@limiter.limit("30/minute")
def address_transactions(
    address: str,
    request: Request,
    response: Response,
    limit: int = Query(20, ge=1, le=50),
    filter: str = Query("all"),
):
    """Return recent transactions for an address (PLS + token transfers)."""
    if not ADDRESS_RE.match(address):
        raise HTTPException(status_code=400, detail="Invalid address")

    addr = address.lower()
    response.headers["Cache-Control"] = "public, max-age=300"

    params: dict[str, str] = {}
    if filter in ("to", "from"):
        params["filter"] = filter

    try:
        resp = http_req.get(
            f"{SCAN_API_V2}/addresses/{addr}/transactions",
            params=params,
            timeout=12,
        )
        if resp.status_code != 200:
            return {"transactions": []}
        items = resp.json().get("items", [])[:limit]
    except Exception:
        return {"transactions": []}

    # Identify transactions that contain token transfers
    token_tx_hashes = [
        tx.get("hash") for tx in items
        if "token_transfer" in (tx.get("tx_types") or []) and tx.get("hash")
    ]

    # Fetch token transfer details in parallel (max 5 concurrent)
    from concurrent.futures import ThreadPoolExecutor, as_completed

    token_transfers_by_hash: dict[str, list] = {}

    def _fetch_tt(tx_hash: str):
        try:
            r = http_req.get(
                f"{SCAN_API_V2}/transactions/{tx_hash}/token-transfers",
                timeout=10,
            )
            if r.status_code == 200:
                return tx_hash, r.json().get("items", [])
        except Exception:
            pass
        return tx_hash, []

    if token_tx_hashes:
        with ThreadPoolExecutor(max_workers=5) as pool:
            futures = [pool.submit(_fetch_tt, h) for h in token_tx_hashes[:10]]
            for f in as_completed(futures, timeout=20):
                try:
                    h, transfers = f.result()
                    token_transfers_by_hash[h] = transfers
                except Exception:
                    pass

    txs = []
    for tx in items:
        from_info = tx.get("from") or {}
        to_info = tx.get("to") or {}
        value_wei = int(tx.get("value") or "0")
        tx_hash = tx.get("hash")

        # Parse token transfers for this tx
        tt_list = []
        for tt in token_transfers_by_hash.get(tx_hash, []):
            tok = tt.get("token") or {}
            total = tt.get("total") or {}
            decimals = int(tok.get("decimals") or "18")
            raw_value = total.get("value", "0")
            amount = int(raw_value) / (10 ** decimals) if raw_value else 0
            tt_from = tt.get("from") or {}
            tt_to = tt.get("to") or {}
            if amount > 0:
                tt_list.append({
                    "token_symbol": tok.get("symbol", "?"),
                    "token_name": tok.get("name", "?"),
                    "token_address": (tok.get("address") or "").lower(),
                    "token_decimals": decimals,
                    "amount": amount,
                    "from": tt_from.get("hash", ""),
                    "to": tt_to.get("hash", ""),
                })

        txs.append({
            "hash": tx_hash,
            "from": from_info.get("hash", ""),
            "from_name": from_info.get("name"),
            "from_is_contract": from_info.get("is_contract", False),
            "to": (to_info.get("hash") or ""),
            "to_name": to_info.get("name"),
            "to_is_contract": to_info.get("is_contract", False),
            "value_pls": value_wei / 1e18,
            "token_transfers": tt_list,
            "method": tx.get("method"),
            "timestamp": tx.get("timestamp"),
            "block": tx.get("block_number"),
            "status": tx.get("status"),
        })

    return {"transactions": txs}


# ── Transaction Trace ────────────────────────────────────────

@app.get("/api/v1/tx/{tx_hash}/trace")
@limiter.limit("30/minute")
def tx_trace(tx_hash: str, request: Request, response: Response):
    """Return internal transactions (call trace) for a transaction hash."""
    tx_hash = tx_hash.strip().lower()
    if not re.match(r"^0x[0-9a-f]{64}$", tx_hash):
        raise HTTPException(status_code=400, detail="Invalid transaction hash")

    response.headers["Cache-Control"] = "public, max-age=3600"

    # 1. Fetch main transaction
    try:
        resp = http_req.get(f"{SCAN_API_V2}/transactions/{tx_hash}", timeout=12)
        if resp.status_code != 200:
            raise HTTPException(status_code=404, detail="Transaction not found")
        main_tx = resp.json()
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=502, detail="Failed to fetch transaction")

    # 2. Fetch internal transactions
    internal_txs = []
    try:
        resp2 = http_req.get(
            f"{SCAN_API_V2}/transactions/{tx_hash}/internal-transactions",
            params={"limit": 100},
            timeout=12,
        )
        if resp2.status_code == 200:
            internal_txs = resp2.json().get("items", [])
    except Exception:
        pass

    # 3. Fetch token transfers
    token_transfers = []
    try:
        resp3 = http_req.get(
            f"{SCAN_API_V2}/transactions/{tx_hash}/token-transfers",
            params={"limit": 100},
            timeout=12,
        )
        if resp3.status_code == 200:
            token_transfers = resp3.json().get("items", [])
    except Exception:
        pass

    # 4. Parse main tx
    from_info = main_tx.get("from") or {}
    to_info = main_tx.get("to") or {}
    value_wei = int(main_tx.get("value") or "0")

    # 5. Build nodes + edges for the trace graph
    nodes = {}
    edges = []

    def _add_node(addr_info: dict, force_label: str | None = None):
        addr = (addr_info.get("hash") or "").lower()
        if not addr:
            return
        if addr not in nodes:
            label = force_label or KNOWN_LABELS.get(addr) or addr_info.get("name") or ""
            is_contract = addr_info.get("is_contract", False)
            nodes[addr] = {
                "id": addr,
                "label": label,
                "is_contract": is_contract,
                "type": _classify_node(addr, is_contract, label),
            }

    def _classify_node(addr: str, is_contract: bool, label: str) -> str:
        known = KNOWN_LABELS.get(addr, "")
        kl = known.lower()
        if "bridge" in kl or "omni" in kl or "hyperlane" in kl:
            return "Bridge"
        if "pulsex" in kl or "9inch" in kl or "piteas" in kl or "dex" in kl:
            return "DEX"
        if "burn" in kl or "dead" in kl or "null" in kl:
            return "Burn"
        if "validator" in kl or "deposit" in kl or "staking" in kl:
            return "Validator"
        if is_contract:
            return "Contract"
        return "Wallet"

    # Main tx
    _add_node(from_info)
    _add_node(to_info)

    from_addr = (from_info.get("hash") or "").lower()
    to_addr = (to_info.get("hash") or "").lower()

    if from_addr and to_addr:
        edges.append({
            "id": f"main-{tx_hash[:10]}",
            "source": from_addr,
            "target": to_addr,
            "value_pls": value_wei / 1e18,
            "type": "main",
            "method": main_tx.get("method") or "transfer",
        })

    # Internal txs
    for i, itx in enumerate(internal_txs):
        itx_from = itx.get("from") or {}
        itx_to = itx.get("to") or {}
        itx_value = int(itx.get("value") or "0")

        _add_node(itx_from)
        _add_node(itx_to)

        s = (itx_from.get("hash") or "").lower()
        t = (itx_to.get("hash") or "").lower()
        if s and t:
            edges.append({
                "id": f"internal-{i}",
                "source": s,
                "target": t,
                "value_pls": itx_value / 1e18,
                "type": "internal",
                "method": itx.get("type") or "call",
            })

    # Token transfers
    for i, tt in enumerate(token_transfers):
        tt_from = tt.get("from") or {}
        tt_to = tt.get("to") or {}
        tok = tt.get("token") or {}
        total = tt.get("total") or {}
        decimals = int(tok.get("decimals") or "18")
        raw_val = total.get("value", "0")
        amount = int(raw_val) / (10 ** decimals) if raw_val else 0

        _add_node(tt_from)
        _add_node(tt_to)

        s = (tt_from.get("hash") or "").lower()
        t = (tt_to.get("hash") or "").lower()
        if s and t and amount > 0:
            edges.append({
                "id": f"token-{i}",
                "source": s,
                "target": t,
                "value_pls": 0,
                "token_amount": amount,
                "token_symbol": tok.get("symbol", "?"),
                "token_address": (tok.get("address") or "").lower(),
                "type": "token_transfer",
                "method": "transfer",
            })

    return {
        "tx_hash": tx_hash,
        "block": main_tx.get("block_number"),
        "timestamp": main_tx.get("timestamp"),
        "status": main_tx.get("status"),
        "method": main_tx.get("method"),
        "from": from_addr,
        "to": to_addr,
        "value_pls": value_wei / 1e18,
        "gas_used": main_tx.get("gas_used"),
        "nodes": list(nodes.values()),
        "edges": edges,
    }


@app.get("/cron/leagues")
@limiter.limit("5/minute")
def cron_leagues(request: Request):
    """Run holder leagues scraper. Protected by CRON_SECRET."""
    _check_cron_secret(request)
    import threading
    from holder_leagues import run_holder_leagues
    t = threading.Thread(target=run_holder_leagues, daemon=True)
    t.start()
    return {"status": "started"}


@app.get("/cron/batch")
@limiter.limit("5/minute")
def cron_batch(request: Request, limit: int = Query(100, ge=1, le=10000), workers: int = Query(5, ge=1, le=20)):
    """Run batch token safety analysis. Protected by CRON_SECRET."""
    _check_cron_secret(request)

    import threading

    def _run():
        run_batch(max_tokens=limit, workers=workers)

    # Run in background thread to avoid timeout
    t = threading.Thread(target=_run, daemon=True)
    t.start()
    return {"status": "started", "max_tokens": limit, "workers": workers}


@app.get("/cron/sync-blacklists")
@limiter.limit("5/minute")
def cron_sync_blacklists(request: Request):
    """Sync external blacklists (OFAC, ScamSniffer, eth-labels) into known_addresses."""
    _check_cron_secret(request)
    import threading
    from sync_blacklists import run_sync
    t = threading.Thread(target=run_sync, daemon=True)
    t.start()
    return {"status": "started", "job": "sync_blacklists"}


@app.get("/cron/sync-exploits")
@limiter.limit("5/minute")
def cron_sync_exploits(request: Request):
    """Sync exploit history (Forta datasets) into exploit_events + known_addresses."""
    _check_cron_secret(request)
    import threading
    from sync_exploits import run_sync
    t = threading.Thread(target=run_sync, daemon=True)
    t.start()
    return {"status": "started", "job": "sync_exploits"}


@app.get("/cron/scan-mints-history")
@limiter.limit("5/minute")
def cron_scan_mints_history(request: Request, max_tokens: int = Query(200, ge=1, le=500)):
    """Scan historique complet des mints sur tous les tokens PulseChain. Backfill one-time."""
    _check_cron_secret(request)
    import threading
    from scam_radar import scan_historical_mints, save_alerts
    from db import supabase as _sb

    def _run():
        alerts = scan_historical_mints(max_tokens=max_tokens)
        if alerts:
            saved = save_alerts(alerts, _sb)
            logger.info(f"[MINT HISTORY] Saved {saved}/{len(alerts)} mint alerts")
        else:
            logger.info("[MINT HISTORY] No suspicious mints found")

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    return {"status": "started", "job": "scan_mints_history", "max_tokens": max_tokens}


@app.get("/cron/lp-monitor")
@limiter.limit("5/minute")
def cron_lp_monitor(request: Request, limit: int = Query(200, ge=1, le=500)):
    """Force LP liquidity re-check for top tokens. Fixes inflated values."""
    _check_cron_secret(request)
    import threading
    t = threading.Thread(target=_run_lp_monitor, args=(limit,), daemon=True)
    t.start()
    return {"status": "started", "limit": limit}


# ── LP Liquidity Monitor ─────────────────────────────────────────

def _run_lp_monitor(limit: int = 50):
    """Re-check liquidity for all scored tokens (not just top ones).
    Updates all_pairs, pair_count, total_liquidity_usd + enforces grade caps."""
    from lp_analyzer import analyze_lp
    from db import supabase

    logger.info(f"[LP Monitor] Starting liquidity check for up to {limit} tokens...")

    # Get ALL scored tokens with grade B or above — these need cap enforcement
    # Also include top tokens by liquidity to catch any changes
    rows_graded = supabase.table("token_safety_scores").select(
        "token_address, total_liquidity_usd, score, grade, risks, analysis_details"
    ).in_("grade", ["A", "B"]).limit(500).execute()

    rows_top = supabase.table("token_safety_scores").select(
        "token_address, total_liquidity_usd, score, grade, risks, analysis_details"
    ).order("total_liquidity_usd", desc=True).limit(limit).execute()

    # Merge & deduplicate
    seen = set()
    all_rows = []
    for row in (rows_graded.data or []) + (rows_top.data or []):
        if row["token_address"] not in seen:
            seen.add(row["token_address"])
            all_rows.append(row)
    rows = type('R', (), {'data': all_rows})()

    updated = 0
    skipped = 0
    for row in (rows.data or []):
        addr = row["token_address"]
        try:
            lp = analyze_lp(addr)
            new_liq = lp.get("total_liquidity_usd", 0)
            old_liq = float(row.get("total_liquidity_usd", 0) or 0)

            # Safety: if subgraph returned 0 but old value was reasonable (<$50M),
            # it's likely a transient error — don't overwrite liquidity data.
            # But still enforce grade caps based on the old liquidity value.
            skip_liq_update = new_liq == 0 and 0 < old_liq <= 50_000_000
            if skip_liq_update:
                logger.info(f"[LP Monitor] {addr[:12]}... — subgraph returned $0, keeping old=${old_liq:,.0f} but checking caps")
                skipped += 1

            # Use effective liquidity for cap checks: new if available, old if skipped
            effective_liq = old_liq if skip_liq_update else new_liq

            # Enforce liquidity hard caps on score/grade (always runs)
            cur_score = row.get("score", 0) or 0
            cur_grade = row.get("grade", "F") or "F"
            cur_risks = row.get("risks") or []
            if isinstance(cur_risks, str):
                try:
                    cur_risks = json.loads(cur_risks)
                except Exception:
                    cur_risks = []
            new_score = cur_score
            new_grade = cur_grade

            # Remove old liquidity cap risks before re-evaluating
            cap_risks = [r for r in cur_risks if not r.startswith("Grade capped")]

            if effective_liq < 1_000 and new_score >= 45:
                new_score = 44
                new_grade = "D"
                cap_risks.append(f"Grade capped at D: liquidity ${effective_liq:,.0f} < $1K")
            elif effective_liq < 10_000 and new_score >= 65:
                new_score = 64
                new_grade = "C"
                cap_risks.append(f"Grade capped at C: liquidity ${effective_liq:,.0f} < $10K")
            elif effective_liq < 50_000 and new_score >= 85:
                new_score = 84
                new_grade = "B"
                cap_risks.append(f"Grade capped at B: liquidity ${effective_liq:,.0f} < $50K")

            if new_score != cur_score or new_grade != cur_grade:
                logger.info(f"[LP Monitor] {addr[:12]}... grade {cur_grade}→{new_grade} (liq ${effective_liq:,.0f})")

            if skip_liq_update:
                # Only update score/grade/risks, preserve existing liquidity data
                supabase.table("token_safety_scores").update({
                    "score": new_score,
                    "grade": new_grade,
                    "risks": json.dumps(cap_risks),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }).eq("token_address", addr).execute()
            else:
                # Update everything including liquidity
                raw = row.get("analysis_details") or {}
                if isinstance(raw, str):
                    import json as _json
                    try:
                        raw = _json.loads(raw)
                    except Exception:
                        raw = {}
                details = raw
                lp_section = details.get("lp", {})
                lp_section["all_pairs"] = lp.get("all_pairs", [])
                lp_section["total_liquidity_usd"] = new_liq
                lp_section["pair_count"] = lp.get("pair_count", 0)
                lp_section["best_pair"] = lp.get("best_pair")
                lp_section["recent_burns_24h"] = len(lp.get("recent_burns", []))
                lp_section["recent_mints_24h"] = len(lp.get("recent_mints", []))
                details["lp"] = lp_section

                supabase.table("token_safety_scores").update({
                    "total_liquidity_usd": new_liq,
                    "pair_count": lp.get("pair_count", 0),
                    "analysis_details": json.dumps(details),
                    "score": new_score,
                    "grade": new_grade,
                    "risks": json.dumps(cap_risks),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }).eq("token_address", addr).execute()
            updated += 1

            time.sleep(2)  # Rate limit
        except Exception as e:
            logger.warning(f"[LP Monitor] Error for {addr}: {e}")

    logger.info(f"[LP Monitor] Done: {updated} updated, {skipped} skipped (transient $0) out of {len(rows.data or [])}")


# ── Batch progress tracking ───────────────────────────────────────

_batch_progress = {
    "running": False,
    "total": 0,
    "analyzed": 0,
    "errors": 0,
    "started_at": None,
    "finished_at": None,
}


@app.get("/cron/batch/status")
def batch_status(request: Request):
    """Return current batch progress. Protected by CRON_SECRET."""
    _check_cron_secret(request)
    p = _batch_progress
    pct = round(p["analyzed"] / max(p["total"], 1) * 100, 1)
    elapsed = 0
    eta_s = None
    if p["started_at"]:
        elapsed = round(time.time() - p["started_at"], 1)
        if p["analyzed"] > 0 and p["running"]:
            per_token = elapsed / p["analyzed"]
            remaining = p["total"] - p["analyzed"] - p["errors"]
            eta_s = round(per_token * remaining)
    return {
        "running": p["running"],
        "total": p["total"],
        "analyzed": p["analyzed"],
        "errors": p["errors"],
        "percent": pct,
        "elapsed_s": elapsed,
        "eta_s": eta_s,
        "started_at": datetime.fromtimestamp(p["started_at"], tz=timezone.utc).isoformat() if p["started_at"] else None,
        "finished_at": datetime.fromtimestamp(p["finished_at"], tz=timezone.utc).isoformat() if p["finished_at"] else None,
    }


# ── Batch mode ────────────────────────────────────────────────────

def run_batch(max_tokens: int = 1000, workers: int = 5):
    """Analyze all active tokens (for cron job). Uses parallel workers for speed."""
    from concurrent.futures import ThreadPoolExecutor, as_completed
    global _batch_progress
    logger.info(f"Starting batch token safety analysis (workers={workers})...")
    tokens = get_all_tokens_to_analyze()
    tokens = tokens[:max_tokens]
    logger.info(f"Found {len(tokens)} tokens to analyze (limit={max_tokens})")

    _batch_progress = {
        "running": True,
        "total": len(tokens),
        "analyzed": 0,
        "errors": 0,
        "started_at": time.time(),
        "finished_at": None,
    }

    analyzed = 0
    errors = 0

    def _analyze_and_save(addr: str) -> bool:
        """Analyze a single token and save. Returns True on success."""
        analysis = analyze_token(addr)
        save_score(analysis)
        return True

    # Process tokens in parallel with controlled concurrency
    with ThreadPoolExecutor(max_workers=workers) as executor:
        future_to_addr = {}
        for addr in tokens:
            future = executor.submit(_analyze_and_save, addr)
            future_to_addr[future] = addr

        for future in as_completed(future_to_addr):
            addr = future_to_addr[future]
            try:
                future.result()
                analyzed += 1
                _batch_progress["analyzed"] = analyzed
            except Exception as e:
                logger.error(f"Failed to analyze {addr}: {e}")
                errors += 1
                _batch_progress["errors"] = errors

            if (analyzed + errors) % 50 == 0:
                elapsed = time.time() - _batch_progress["started_at"]
                rate = analyzed / max(elapsed, 1)
                logger.info(
                    f"Progress: {analyzed}/{len(tokens)} analyzed, {errors} errors, "
                    f"{rate:.1f} tokens/s"
                )

    _batch_progress["running"] = False
    _batch_progress["finished_at"] = time.time()
    elapsed = _batch_progress["finished_at"] - _batch_progress["started_at"]
    logger.info(
        f"Batch complete: {analyzed} analyzed, {errors} errors "
        f"out of {len(tokens)} tokens in {elapsed/60:.1f} min"
    )


# ── Main ──────────────────────────────────────────────────────────

def run_scam_radar():
    """Run scam radar scan (for cron job)."""
    from scam_radar import run_scan, save_alerts
    from db import supabase

    logger.info("Running Scam Radar scan...")
    alerts = run_scan(since_minutes=30)
    if alerts:
        saved = save_alerts(alerts, supabase)
        logger.info(f"Scam Radar: {len(alerts)} alerts found, {saved} saved")
    else:
        logger.info("Scam Radar: No alerts")


if __name__ == "__main__":
    mode = os.environ.get("MODE", "server")

    if mode == "batch":
        run_batch()
    elif mode == "radar":
        run_scam_radar()
    elif mode == "all":
        # Run both batch analysis and radar scan
        run_scam_radar()
        run_batch()
    else:
        port = int(os.environ.get("PORT", 8080))
        logger.info(f"Starting Token Safety API on port {port}")
        uvicorn.run(app, host="0.0.0.0", port=port)
