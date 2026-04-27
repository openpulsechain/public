"""
Main token safety analyzer — orchestrates all checks and produces final score.

v2: Category-aware scoring system. Tokens are classified into categories
    (infrastructure, stablecoin, blue_chip_bridge, ecosystem_core, established,
    emerging, new) BEFORE scoring. Each category has differentiated rules.
"""

import logging
import time
import requests
from datetime import datetime, timezone, timedelta

from honeypot_checker import check_honeypot, generate_combined_flags
from holder_sell_analyzer import analyze_holder_sells
from contract_analyzer import analyze_contract
from lp_analyzer import analyze_lp
from holder_analyzer import analyze_holders
from scorer import calculate_score, classify_token, ALL_CANONICAL
from scam_risk import detect_scam_risk
from config import (
    SCAN_API_URL, TRUSTED_CATEGORIES, LP_ALERT_IMMUNE_CATEGORIES,
    CATEGORY_SCORE_FLOOR,
)
from db import supabase

logger = logging.getLogger(__name__)

# PulseChain launch date — all forked tokens (USDC, WBTC, etc.) exist since this date
PULSECHAIN_LAUNCH_TS = 1684108800  # 2023-05-15T00:00:00Z


def _get_contract_age_days(token_address: str) -> float | None:
    """
    Get token contract age from Scan API (creation transaction timestamp).
    Returns age in days, or None if unavailable.
    For canonical tokens, falls back to PulseChain launch date.
    """
    addr = token_address.lower()
    try:
        resp = requests.get(
            f"{SCAN_API_URL}/api/v2/addresses/{addr}",
            timeout=10
        )
        if resp.status_code == 200:
            data = resp.json()
            creation_tx = data.get("creation_tx_hash")
            if creation_tx:
                # Get creation tx timestamp
                tx_resp = requests.get(
                    f"{SCAN_API_URL}/api/v2/transactions/{creation_tx}",
                    timeout=10
                )
                if tx_resp.status_code == 200:
                    tx_data = tx_resp.json()
                    ts_str = tx_data.get("timestamp")
                    if ts_str:
                        created = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                        age = (datetime.now(timezone.utc) - created).total_seconds() / 86400
                        return max(0, age)
    except Exception as e:
        logger.debug(f"  Contract age lookup failed for {addr[:12]}: {str(e)[:60]}")

    # Fallback for canonical tokens: PulseChain launch date
    if addr in ALL_CANONICAL:
        age = (datetime.now(timezone.utc).timestamp() - PULSECHAIN_LAUNCH_TS) / 86400
        return max(0, age)

    return None


def _fetch_intel_signals(token_address: str, deployer_address: str | None = None) -> dict | None:
    """
    Fetch intel signals from known_addresses, scam_radar_alerts, and token_intelligence.

    Returns:
        {
            "alerts": list of recent HIGH/CRITICAL scam_radar_alerts,
            "negative_events": list of negative social_timeline events,
            "deployer_flagged": bool,
            "deployer_risk_level": str ("HIGH"/"MEDIUM"/"LOW" or ""),
            "deployer_category": str (e.g. "sanctioned", "phishing", "dumper", ""),
        }
        or None if no intel data found.
    """
    addr = token_address.lower()
    alerts = []
    negative_events = []
    deployer_flagged = False
    deployer_risk_level = ""
    deployer_category = ""

    # 1. Query scam_radar_alerts for this token (last 30 days, HIGH or CRITICAL)
    try:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        result = supabase.table("scam_radar_alerts").select("alert_type,severity,data,created_at") \
            .eq("token_address", addr) \
            .in_("severity", ["high", "critical"]) \
            .gte("created_at", cutoff) \
            .order("created_at", desc=True) \
            .limit(20) \
            .execute()
        alerts = result.data or []
    except Exception as e:
        logger.debug(f"  scam_radar_alerts query failed: {str(e)[:80]}")

    # 2. Query token_intelligence for negative social_timeline events
    try:
        result = supabase.table("token_intelligence").select("social_timeline,project_summary") \
            .eq("token_address", addr) \
            .limit(1) \
            .execute()
        if result.data:
            intel_row = result.data[0]
            timeline = intel_row.get("social_timeline") or []
            for event in timeline:
                if (
                    isinstance(event, dict)
                    and event.get("impact") == "negative"
                    and event.get("category") in ("dump", "exploit", "controversy")
                ):
                    negative_events.append(event)
    except Exception as e:
        logger.debug(f"  token_intelligence query failed: {str(e)[:80]}")

    # 3. Check if deployer is flagged in known_addresses
    if deployer_address:
        try:
            dep_addr = deployer_address.lower()
            result = supabase.table("known_addresses").select("address,label,risk_level,category") \
                .eq("address", dep_addr) \
                .limit(1) \
                .execute()
            if result.data:
                known = result.data[0]
                deployer_flagged = True
                deployer_risk_level = known.get("risk_level", "MEDIUM")
                deployer_category = known.get("category", "")
        except Exception as e:
            logger.debug(f"  known_addresses query failed: {str(e)[:80]}")

    # 4. Check exploit_events for deployer or token address
    exploit_count = 0
    if deployer_address:
        try:
            dep_addr = deployer_address.lower()
            result = supabase.table("exploit_events").select("id", count="exact") \
                .eq("attacker_address", dep_addr) \
                .execute()
            exploit_count = result.count or 0
            if exploit_count > 0 and not deployer_flagged:
                deployer_flagged = True
                deployer_risk_level = "HIGH"
                deployer_category = "exploit"
        except Exception as e:
            logger.debug(f"  exploit_events query failed: {str(e)[:80]}")

    # Return None if no intel data was found at all
    if not alerts and not negative_events and not deployer_flagged:
        return None

    return {
        "alerts": alerts,
        "negative_events": negative_events,
        "deployer_flagged": deployer_flagged,
        "deployer_risk_level": deployer_risk_level,
        "deployer_category": deployer_category,
        "exploit_count": exploit_count,
    }


def _detect_scam_risk(
    lp: dict,
    holders: dict,
    age_info: dict,
    contract: dict,
    deployer_reputation: dict | None = None,
    intel_signals: dict | None = None,
    token_address: str = "",
    category: str = "",
) -> dict:
    """
    Legacy wrapper — delegates to the pure function in scam_risk.py.
    Kept here so existing call sites (and tests that might import it) continue
    to work. All the logic lives in scam_risk.detect_scam_risk.
    """
    lp_immune = category in LP_ALERT_IMMUNE_CATEGORIES or token_address.lower() in ALL_CANONICAL
    return detect_scam_risk(
        lp=lp,
        holders=holders,
        age_info=age_info,
        contract=contract,
        deployer_reputation=deployer_reputation,
        intel_signals=intel_signals,
        lp_immune=lp_immune,
    )


# (_detect_scam_risk implementation lives in scam_risk.py — see wrapper above)


def analyze_token(token_address: str) -> dict:
    """
    Run full safety analysis on a token.
    Returns complete analysis with score, risks, and detailed breakdown.
    """
    addr = token_address.lower()
    start = time.time()

    logger.info(f"Analyzing token: {addr}")

    # Run all 5 analyses in PARALLEL (they are independent)
    from concurrent.futures import ThreadPoolExecutor, as_completed

    with ThreadPoolExecutor(max_workers=5) as pool:
        fut_hp = pool.submit(check_honeypot, addr)
        fut_contract = pool.submit(analyze_contract, addr)
        fut_lp = pool.submit(analyze_lp, addr)
        fut_holders = pool.submit(analyze_holders, addr)
        # holder_sells needs buy_tax from honeypot, but we can start it
        # with a default and it still works (tax is optional param)
        fut_holder_sells = pool.submit(analyze_holder_sells, addr)

    honeypot = fut_hp.result()
    logger.info(f"  Honeypot check done: is_honeypot={honeypot.get('is_honeypot')}")

    # Re-run holder_sells with actual buy_tax if honeypot found a tax
    # (only if buy_tax > 0, otherwise the parallel run was correct)
    buy_tax = honeypot.get("buy_tax_pct")
    holder_sells = fut_holder_sells.result()
    if buy_tax and buy_tax > 0:
        holder_sells = analyze_holder_sells(addr, buy_tax_pct=buy_tax)
    logger.info(
        f"  Holder sell analysis done: tested={holder_sells.get('holders_tested')}, "
        f"blocked={holder_sells.get('failed')}, siphoned={holder_sells.get('siphoned')}"
    )

    contract = fut_contract.result()
    logger.info(f"  Contract analysis done: verified={contract.get('is_verified')}, dangers={contract.get('dangers')}")

    lp = fut_lp.result()
    logger.info(f"  LP analysis done: has_lp={lp.get('has_lp')}, liquidity=${lp.get('total_liquidity_usd', 0):,.0f}")

    holders = fut_holders.result()
    logger.info(f"  Holder analysis done: count={holders.get('holder_count')}, top10={holders.get('top10_pct')}%")

    # ── Cross-reference: override honeypot verdict using holder data ──
    # FeeChecker can be fooled if the token whitelists the checker contract.
    # If most real holders can't transfer, it's a honeypot regardless.
    hp_overridden = False
    tested = holder_sells.get("holders_tested", 0)
    hs_failed = holder_sells.get("failed", 0)
    hs_siphoned = holder_sells.get("siphoned", 0)

    if honeypot.get("is_honeypot") is not True and tested > 0:
        fail_ratio = hs_failed / tested
        # If >50% of tested holders can't transfer → honeypot
        if fail_ratio > 0.5 and hs_failed >= 2:
            honeypot["is_honeypot"] = True
            honeypot["error"] = (
                f"FeeChecker passed but {hs_failed}/{tested} holders "
                f"cannot transfer their tokens"
            )
            hp_overridden = True
            logger.warning(
                f"  HONEYPOT OVERRIDE: {hs_failed}/{tested} holders blocked "
                f"({fail_ratio:.0%}) — marking as honeypot despite FeeChecker pass"
            )

    # Siphoned balances = another strong honeypot signal
    if not hp_overridden and honeypot.get("is_honeypot") is not True and hs_siphoned >= 3:
        honeypot["is_honeypot"] = True
        honeypot["error"] = (
            f"FeeChecker passed but {hs_siphoned} holders have "
            f"siphoned balances (on-chain = 0 despite reported holdings)"
        )
        hp_overridden = True
        logger.warning(
            f"  HONEYPOT OVERRIDE: {hs_siphoned} holders siphoned — marking as honeypot"
        )

    # Sell-blocking honeypot: holders can transfer to DEAD but NOT to the DEX pair
    # This catches tokens that whitelist the FeeChecker contract or allow
    # wallet-to-wallet transfers but block sells through the router.
    hs_pair_blocked = holder_sells.get("pair_blocked", 0)
    hs_pair_tested = holder_sells.get("pair_tested", 0)

    if not hp_overridden and honeypot.get("is_honeypot") is not True and hs_pair_tested > 0:
        pair_block_ratio = hs_pair_blocked / hs_pair_tested
        # If >50% of tested EOA holders are blocked from transferring to pair
        if pair_block_ratio > 0.5 and hs_pair_blocked >= 2:
            honeypot["is_honeypot"] = True
            honeypot["error"] = (
                f"FeeChecker passed but {hs_pair_blocked}/{hs_pair_tested} holders "
                f"cannot transfer tokens to the DEX pair (sells blocked)"
            )
            hp_overridden = True
            logger.warning(
                f"  HONEYPOT OVERRIDE: {hs_pair_blocked}/{hs_pair_tested} holders "
                f"blocked from selling to pair ({pair_block_ratio:.0%}) — "
                f"sell-blocking honeypot detected"
            )

    if hp_overridden:
        logger.info(f"  Honeypot verdict overridden to: is_honeypot=True")

    # Generate combined flags (honeypot + contract + extra detections)
    combined_flags = generate_combined_flags(honeypot, contract)
    logger.info(f"  Combined flags: {combined_flags}")

    # Fetch deployer reputation (optional — don't fail if unavailable)
    deployer_rep = None
    deployer_addr_raw = None
    try:
        from serial_rugger import analyze_deployer_for_token
        dep_result = analyze_deployer_for_token(addr)
        if dep_result:
            deployer_rep = {
                "reputation_score": dep_result.get("reputation_score", 100),
                "risk_level": dep_result.get("risk_level", "low"),
                "dead_ratio": dep_result.get("dead_ratio", 0),
            }
            deployer_addr_raw = dep_result.get("deployer")
            logger.info(f"  Deployer reputation: score={deployer_rep['reputation_score']}, risk={deployer_rep['risk_level']}")
    except Exception as e:
        logger.warning(f"  Deployer reputation check failed (non-blocking): {str(e)[:80]}")

    # Fetch intel signals for scoring (known_addresses + scam_radar + intelligence)
    intel_signals = None
    try:
        # Extract deployer address from contract analysis or deployer reputation result
        deployer_addr = contract.get("deployer") or deployer_addr_raw
        intel_signals = _fetch_intel_signals(addr, deployer_address=deployer_addr)
        if intel_signals:
            logger.info(f"  Intel signals: {len(intel_signals.get('alerts', []))} alerts, "
                        f"{len(intel_signals.get('negative_events', []))} negative events, "
                        f"deployer_flagged={intel_signals.get('deployer_flagged', False)}")
    except Exception as e:
        logger.warning(f"  Intel signals fetch failed (non-blocking): {str(e)[:80]}")

    # ── Classify token (v2 category system) ─────────────────────
    # Classification uses address-based lookup for canonical tokens,
    # then heuristic for others (age, holders, liquidity).
    lp_age = (lp.get("best_pair") or {}).get("age_days", 0)
    category = classify_token(
        addr,
        liquidity_usd=lp.get("total_liquidity_usd", 0),
        age_days=lp_age,
        holder_count=holders.get("holder_count", 0),
    )
    logger.info(f"  Category: {category}")

    # ── Fix age for bridged/canonical tokens ──────────────────────
    # LP pair age ≠ token age. USDC exists since PulseChain launch, not since
    # its newest LP pair was created 12 days ago. Use contract creation date.
    contract_age = _get_contract_age_days(addr)
    if contract_age is not None:
        best_pair = lp.get("best_pair") or {}
        pair_age = best_pair.get("age_days", 0)
        if contract_age > pair_age:
            logger.info(f"  Age override: LP pair {pair_age:.0f}d → contract {contract_age:.0f}d")
            if best_pair:
                best_pair["age_days"] = contract_age

    # Calculate composite score (with category)
    score_result = calculate_score(
        honeypot, contract, lp, holders,
        token_address=addr,
        deployer_reputation=deployer_rep,
        intel_signals=intel_signals,
        category=category,
    )

    # Scam risk analysis (independent of honeypot, category-aware)
    scam_analysis = _detect_scam_risk(
        lp, holders,
        score_result["details"].get("age", {}),
        contract,
        deployer_reputation=deployer_rep,
        intel_signals=intel_signals,
        token_address=addr,
        category=category,
    )
    logger.info(f"  Scam risk: {scam_analysis['risk_level']} (score {scam_analysis['scam_score']})")

    # Cap overall safety score if scam risk is high
    # Trusted categories (infrastructure/stablecoin/blue_chip_bridge) are EXEMPT
    # from scam risk caps — the scam signals are false positives for these tokens.
    if category not in TRUSTED_CATEGORIES:
        if scam_analysis["risk_level"] == "critical":
            if score_result["score"] > 30:
                score_result["score"] = min(score_result["score"], 30)
                score_result["risks"].append(f"Score capped: critical scam risk ({scam_analysis['scam_score']}/100)")
                score_result["grade"] = "D" if score_result["score"] >= 20 else "F"
        elif scam_analysis["risk_level"] == "high":
            if score_result["score"] > 50:
                score_result["score"] = min(score_result["score"], 50)
                score_result["risks"].append(f"Score capped: high scam risk ({scam_analysis['scam_score']}/100)")
                score_result["grade"] = "C" if score_result["score"] >= 40 else "D"

    # Impersonation detection — flag tokens that copy known symbols but aren't canonical
    _CANONICAL_SYMBOLS = {
        "DAI": "0xefd766ccb38eaf1dfd701853bfce31359239f305",
        "USDC": "0x15d38573d2feeb82e7ad5187ab8c1d52810b1f07",
        "USDT": "0x0cb6f5a34ad42ec934882a05265a7d5f59b51a2f",
        "WETH": "0x02dcdd04e3f455d838cd1249292c58f3b79e3c3c",
        "WBTC": "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",
        "WPLS": "0xa1077a294dde1b09bb078844df40758a5d0f9a27",
        "HEX": "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
        "PLSX": "0x95b303987a60c71504d99aa1b13b4da07b0790ab",
        "INC": "0x2fa878ab3f87cc1c9737fc071108f904c0b0c95d",
    }
    try:
        _tok = supabase.table("pulsechain_tokens").select("symbol").eq("address", addr).single().execute()
        _sym = (_tok.data or {}).get("symbol", "").upper().strip()
        if _sym in _CANONICAL_SYMBOLS and _CANONICAL_SYMBOLS[_sym] != addr:
            score_result["risks"].append(f"Impersonation warning: uses symbol {_sym} but is not the canonical token")
            if score_result["score"] > 59:
                score_result["score"] = 59
                score_result["grade"] = "C"
    except Exception:
        pass  # Non-blocking

    # Hard liquidity caps — multi-tier, prevents misleading grades
    # Trusted categories are EXEMPT (their liquidity is real and verified)
    liquidity_usd = lp.get("total_liquidity_usd", 0)
    if category not in TRUSTED_CATEGORIES:
        if liquidity_usd < 1_000 and score_result["score"] >= 40:
            score_result["score"] = 39
            score_result["grade"] = "D"
            score_result["risks"].append(f"Grade capped at D: liquidity ${liquidity_usd:,.0f} < $1K")
        elif liquidity_usd < 10_000 and score_result["score"] >= 60:
            score_result["score"] = 59
            score_result["grade"] = "C"
            score_result["risks"].append(f"Grade capped at C: liquidity ${liquidity_usd:,.0f} < $10K")
        elif liquidity_usd < 50_000 and score_result["score"] >= 80:
            score_result["score"] = 79
            score_result["grade"] = "B"
            score_result["risks"].append(f"Grade capped at B: liquidity ${liquidity_usd:,.0f} < $50K")

    elapsed = round(time.time() - start, 2)
    logger.info(f"  Score: {score_result['score']}/100 (grade {score_result['grade']}) in {elapsed}s")

    return {
        "address": addr,
        "score": score_result["score"],
        "grade": score_result["grade"],
        "category": category,
        "risks": score_result["risks"],
        "honeypot": {
            "score": score_result["honeypot_score"],
            "is_honeypot": honeypot.get("is_honeypot"),
            "buy_tax_pct": honeypot.get("buy_tax_pct"),
            "sell_tax_pct": honeypot.get("sell_tax_pct"),
            "transfer_tax_pct": honeypot.get("transfer_tax_pct"),
            "buy_gas": honeypot.get("buy_gas"),
            "sell_gas": honeypot.get("sell_gas"),
            "max_tx_amount": honeypot.get("max_tx_amount"),
            "max_wallet_amount": honeypot.get("max_wallet_amount"),
            "dynamic_tax": honeypot.get("dynamic_tax", False),
            "tax_by_amount": honeypot.get("tax_by_amount"),
            "flags": combined_flags,
            "router": honeypot.get("router"),
            "error": honeypot.get("error"),
            "holder_analysis": holder_sells,
        },
        "contract": {
            "score": score_result["contract_score"],
            "is_verified": contract.get("is_verified"),
            "is_proxy": contract.get("is_proxy"),
            "ownership_renounced": contract.get("ownership_renounced"),
            "has_mint": contract.get("has_mint"),
            "has_pause": contract.get("has_pause"),
            "has_blacklist": contract.get("has_blacklist"),
            "has_variable_fee": contract.get("has_variable_fee"),
            "dangers": contract.get("dangers", []),
        },
        "lp": {
            "score": score_result["lp_score"],
            "has_lp": lp.get("has_lp"),
            "total_liquidity_usd": lp.get("total_liquidity_usd"),
            "pair_count": lp.get("pair_count"),
            "best_pair": lp.get("best_pair"),
            "all_pairs": lp.get("all_pairs", []),
            "recent_burns_24h": len(lp.get("recent_burns", [])),
            "recent_mints_24h": len(lp.get("recent_mints", [])),
        },
        "holders": {
            "score": score_result["holders_score"],
            "holder_count": holders.get("holder_count"),
            "top10_pct": holders.get("top10_pct"),
            "top1_pct": holders.get("top1_pct"),
            "top_holders": holders.get("top_holders", [])[:5],
        },
        "age": score_result["details"].get("age", {}),
        "scam_analysis": scam_analysis,
        "analyzed_at": datetime.now(timezone.utc).isoformat(),
        "analysis_time_s": elapsed,
    }
