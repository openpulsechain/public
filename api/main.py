"""
OpenPulsechain API — Sovereign PulseChain token data.
Public, open-source.
"""

import os
import re
from datetime import datetime, date, timedelta, timezone
from typing import Optional, Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from supabase import create_client, Client

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
# Use anon key for read-only access (respects RLS, no write access)
SUPABASE_KEY = os.environ["SUPABASE_ANON_KEY"]

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

API_VERSION = "0.1.0"
SOURCE = "PulseX Subgraph (graph.pulsechain.com)"
LICENSE = "Open Data"

# Address regex: 0x + 40 hex chars
ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")

# ---------------------------------------------------------------------------
# Rate limiter
# ---------------------------------------------------------------------------

limiter = Limiter(key_func=get_remote_address)

# ---------------------------------------------------------------------------
# App & middleware
# ---------------------------------------------------------------------------

app = FastAPI(
    title="OpenPulsechain API",
    description="Public REST API serving PulseChain token data sourced from PulseX Subgraph.",
    version=API_VERSION,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://openpulsechain.com",
        "https://www.openpulsechain.com",
    ],
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
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


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _meta() -> dict:
    return {
        "source": SOURCE,
        "license": LICENSE,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def _cache(response: Response, max_age: int = 30):
    response.headers["Cache-Control"] = f"public, max-age={max_age}"


def _validate_address(address: str) -> str:
    """Validate and normalize an Ethereum address. Raises 400 if invalid."""
    addr = address.strip().lower()
    if not ADDRESS_RE.match(addr):
        raise HTTPException(status_code=400, detail="Invalid address format. Expected: 0x + 40 hex chars")
    return addr


def _validate_date(date_str: str) -> str:
    """Validate ISO date format. Raises 400 if invalid."""
    try:
        datetime.strptime(date_str, "%Y-%m-%d")
        return date_str
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid date format: {date_str}. Expected: YYYY-MM-DD")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


# ---- Root -----------------------------------------------------------------

@app.get("/", tags=["Info"])
@limiter.limit("120/minute")
def root(request: Request):
    """API info and version."""
    return {
        "name": "OpenPulsechain API",
        "version": API_VERSION,
        "description": "Public API for PulseChain token data.",
        "docs": "https://openpulsechain.com/api",
        "meta": _meta(),
    }


@app.get("/health", tags=["Info"])
@limiter.limit("120/minute")
def health(request: Request):
    """Health check: verifies DB connectivity."""
    try:
        result = supabase.table("pulsechain_tokens").select("address", count="exact").eq("is_active", True).limit(1).execute()
        token_count = result.count or 0
        db_ok = token_count > 0
    except Exception:
        db_ok = False
        token_count = 0

    return {
        "status": "ok" if db_ok else "degraded",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ---- Tokens ---------------------------------------------------------------

SORT_MAP = {
    "volume": "total_volume_usd",
    "liquidity": "total_liquidity",
    "symbol": "symbol",
}


@app.get("/api/v1/tokens", tags=["Tokens"])
@limiter.limit("60/minute")
def list_tokens(
    request: Request,
    response: Response,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    sort_by: Literal["volume", "liquidity", "symbol"] = "volume",
    order: Literal["asc", "desc"] = "desc",
):
    """List all active tokens, paginated and sortable."""
    _cache(response, 30)

    col = SORT_MAP[sort_by]
    query = (
        supabase.table("pulsechain_tokens")
        .select("address, symbol, name, decimals, total_volume_usd, total_liquidity, is_active")
        .eq("is_active", True)
        .order(col, desc=(order == "desc"))
        .range(offset, offset + limit - 1)
    )
    result = query.execute()
    tokens = result.data or []

    # Enrich with current price from token_prices
    addresses = [t["address"] for t in tokens]
    prices_map: dict = {}
    if addresses:
        prices_result = (
            supabase.table("token_prices")
            .select("id, price_usd, price_change_24h_pct")
            .in_("id", [a.lower() for a in addresses])
            .execute()
        )
        for p in (prices_result.data or []):
            prices_map[p["id"]] = {
                "price_usd": p["price_usd"],
                "price_change_24h_pct": p["price_change_24h_pct"],
            }

    for t in tokens:
        t["address"] = t["address"].lower()
        price_info = prices_map.get(t["address"], {})
        t["price_usd"] = price_info.get("price_usd")
        t["price_change_24h_pct"] = price_info.get("price_change_24h_pct")

    # Count total
    count_result = (
        supabase.table("pulsechain_tokens")
        .select("address", count="exact")
        .eq("is_active", True)
        .execute()
    )

    return {
        "data": tokens,
        "pagination": {
            "limit": limit,
            "offset": offset,
            "total": count_result.count,
        },
        "meta": _meta(),
    }


@app.get("/api/v1/tokens/search", tags=["Tokens"])
@limiter.limit("60/minute")
def search_tokens(
    request: Request,
    response: Response,
    q: str = Query(..., min_length=2, max_length=50),
    limit: int = Query(8, ge=1, le=20),
):
    """Search tokens by name or symbol (case-insensitive)."""
    _cache(response, 30)
    # Sanitize q to prevent PostgREST filter injection.
    # PostgREST special characters (.,()%) in the value could alter the
    # filter semantics. We strip everything except alphanumeric, space, and hyphen.
    import re as _re
    clean_q = _re.sub(r'[^a-zA-Z0-9 \-]', '', q).strip()
    if len(clean_q) < 2:
        return {"data": []}
    result = (
        supabase.table("pulsechain_tokens")
        .select("address, symbol, name")
        .or_(f"symbol.ilike.%{clean_q}%,name.ilike.%{clean_q}%")
        .eq("is_active", True)
        .order("total_liquidity", desc=True)
        .limit(limit)
        .execute()
    )
    return {"data": result.data or []}


@app.get("/api/v1/tokens/{address}", tags=["Tokens"])
@limiter.limit("120/minute")
def get_token(address: str, request: Request, response: Response):
    """Token details with current price and 24h change."""
    _cache(response, 30)
    addr = _validate_address(address)

    result = (
        supabase.table("pulsechain_tokens")
        .select("*")
        .eq("address", addr)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail=f"Token not found: {addr}")

    token = result.data[0]
    token["address"] = token["address"].lower()

    # Current price — try by address (id) first, fallback to symbol
    price_result = (
        supabase.table("token_prices")
        .select("price_usd, volume_24h_usd, market_cap_usd, price_change_24h_pct, last_updated")
        .eq("id", addr)
        .limit(1)
        .execute()
    )
    if not price_result.data:
        price_result = (
            supabase.table("token_prices")
            .select("price_usd, volume_24h_usd, market_cap_usd, price_change_24h_pct, last_updated")
            .eq("symbol", token["symbol"])
            .limit(1)
            .execute()
        )
    price = price_result.data[0] if price_result.data else {}
    token["price_usd"] = price.get("price_usd")
    token["volume_24h_usd"] = price.get("volume_24h_usd")
    token["market_cap_usd"] = price.get("market_cap_usd")
    token["price_change_24h_pct"] = price.get("price_change_24h_pct")
    token["price_last_updated"] = price.get("last_updated")

    return {"data": token, "meta": _meta()}


@app.get("/api/v1/tokens/{address}/history", tags=["Tokens"])
@limiter.limit("30/minute")
def token_history(
    address: str,
    request: Request,
    response: Response,
    days: int = Query(30, ge=1, le=1000),
    start_date: Optional[str] = Query(None, description="ISO date, e.g. 2025-01-01"),
    end_date: Optional[str] = Query(None, description="ISO date, e.g. 2025-12-31"),
):
    """OHLCV-style price history for a token."""
    _cache(response, 300)
    addr = _validate_address(address)

    # Validate dates if provided
    if start_date:
        start_date = _validate_date(start_date)
    if end_date:
        end_date = _validate_date(end_date)

    # Verify token exists
    exists = (
        supabase.table("pulsechain_tokens")
        .select("address")
        .eq("address", addr)
        .execute()
    )
    if not exists.data:
        raise HTTPException(status_code=404, detail=f"Token not found: {addr}")

    # Date range
    if start_date and end_date:
        d_start = start_date
        d_end = end_date
    else:
        d_end = date.today().isoformat()
        d_start = (date.today() - timedelta(days=days)).isoformat()

    result = (
        supabase.table("token_price_history")
        .select("date, price_usd, daily_volume_usd, total_liquidity_usd, source")
        .eq("address", addr)
        .gte("date", d_start)
        .lte("date", d_end)
        .order("date", desc=False)
        .limit(1000)
        .execute()
    )

    return {
        "data": result.data or [],
        "token": addr,
        "range": {"start": d_start, "end": d_end},
        "meta": _meta(),
    }


@app.get("/api/v1/tokens/{address}/price", tags=["Tokens"])
@limiter.limit("120/minute")
def token_price(address: str, request: Request, response: Response):
    """Current price only (fast endpoint)."""
    _cache(response, 30)
    addr = _validate_address(address)

    # Try token_prices first (fastest)
    token_result = (
        supabase.table("pulsechain_tokens")
        .select("symbol")
        .eq("address", addr)
        .execute()
    )
    if not token_result.data:
        raise HTTPException(status_code=404, detail=f"Token not found: {addr}")

    symbol = token_result.data[0]["symbol"]
    price_result = (
        supabase.table("token_prices")
        .select("price_usd, price_change_24h_pct, last_updated")
        .eq("id", addr)
        .limit(1)
        .execute()
    )
    if not price_result.data:
        price_result = (
            supabase.table("token_prices")
            .select("price_usd, price_change_24h_pct, last_updated")
            .eq("symbol", symbol)
            .limit(1)
            .execute()
        )

    if price_result.data:
        p = price_result.data[0]
        return {
            "data": {
                "address": addr,
                "symbol": symbol,
                "price_usd": p["price_usd"],
                "price_change_24h_pct": p["price_change_24h_pct"],
                "last_updated": p["last_updated"],
            },
            "meta": _meta(),
        }

    # Fallback: latest from history
    hist = (
        supabase.table("token_price_history")
        .select("date, price_usd")
        .eq("address", addr)
        .order("date", desc=True)
        .limit(1)
        .execute()
    )
    if hist.data:
        h = hist.data[0]
        return {
            "data": {
                "address": addr,
                "symbol": symbol,
                "price_usd": h["price_usd"],
                "price_change_24h_pct": None,
                "last_updated": h["date"],
            },
            "meta": _meta(),
        }

    raise HTTPException(status_code=404, detail=f"No price data for token: {addr}")


# ---- Pairs ----------------------------------------------------------------

@app.get("/api/v1/pairs", tags=["Pairs"])
@limiter.limit("60/minute")
def list_pairs(
    request: Request,
    response: Response,
    limit: int = Query(50, ge=1, le=500),
):
    """Top PulseX trading pairs by volume."""
    _cache(response, 30)

    result = (
        supabase.table("pulsex_top_pairs")
        .select("pair_address, token0_symbol, token0_name, token1_symbol, token1_name, volume_usd, reserve_usd, total_transactions")
        .order("volume_usd", desc=True)
        .limit(limit)
        .execute()
    )

    pairs = result.data or []
    for p in pairs:
        p["pair_address"] = p["pair_address"].lower()

    return {"data": pairs, "meta": _meta()}


# ---- Market Overview -------------------------------------------------------

@app.get("/api/v1/market/overview", tags=["Market"])
@limiter.limit("60/minute")
def market_overview(request: Request, response: Response):
    """Network-level overview: TVL, volume, token count, top movers."""
    _cache(response, 30)

    # Latest TVL
    tvl_result = (
        supabase.table("network_tvl_history")
        .select("date, tvl_usd")
        .order("date", desc=True)
        .limit(1)
        .execute()
    )
    tvl = tvl_result.data[0] if tvl_result.data else {"date": None, "tvl_usd": None}

    # Latest daily volume
    vol_result = (
        supabase.table("network_dex_volume")
        .select("date, volume_usd")
        .order("date", desc=True)
        .limit(1)
        .execute()
    )
    vol = vol_result.data[0] if vol_result.data else {"date": None, "volume_usd": None}

    # Active token count
    count_result = (
        supabase.table("pulsechain_tokens")
        .select("address", count="exact")
        .eq("is_active", True)
        .execute()
    )

    # Top gainers (top 5 by 24h change)
    gainers_result = (
        supabase.table("token_prices")
        .select("symbol, name, price_usd, price_change_24h_pct")
        .order("price_change_24h_pct", desc=True)
        .limit(5)
        .execute()
    )

    # Top losers (bottom 5 by 24h change)
    losers_result = (
        supabase.table("token_prices")
        .select("symbol, name, price_usd, price_change_24h_pct")
        .order("price_change_24h_pct", desc=False)
        .limit(5)
        .execute()
    )

    return {
        "data": {
            "tvl_usd": tvl.get("tvl_usd"),
            "tvl_date": tvl.get("date"),
            "volume_24h_usd": vol.get("volume_usd"),
            "volume_date": vol.get("date"),
            "active_tokens": count_result.count,
            "top_gainers": gainers_result.data or [],
            "top_losers": losers_result.data or [],
        },
        "meta": _meta(),
    }


# ---- Token Safety --------------------------------------------------------

@app.get("/api/v1/tokens/{address}/safety", tags=["Safety"])
@limiter.limit("30/minute")
def token_safety(address: str, request: Request, response: Response):
    """Token safety score (honeypot, contract, LP, holders)."""
    _cache(response, 300)
    addr = _validate_address(address)

    result = (
        supabase.table("token_safety_scores")
        .select("*")
        .eq("token_address", addr)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail=f"No safety score for {addr}. Request analysis at /token/{addr}")

    data = result.data[0]
    # Remove internal fields
    data.pop("analysis_details", None)
    data.pop("created_at", None)
    data.pop("updated_at", None)

    return {"data": data, "meta": _meta()}


@app.get("/api/v1/safety/recent", tags=["Safety"])
@limiter.limit("30/minute")
def safety_recent(
    request: Request,
    response: Response,
    limit: int = Query(20, ge=1, le=100),
    grade: Optional[str] = Query(None, description="Filter by grade: A, B, C, D, F"),
):
    """Recent safety scores, optionally filtered by grade."""
    _cache(response, 60)

    query = supabase.table("token_safety_scores").select(
        "token_address, score, grade, risks, is_honeypot, is_verified, "
        "total_liquidity_usd, holder_count, top10_pct, buy_tax_pct, sell_tax_pct, analyzed_at"
    )

    if grade and grade.upper() in ("A", "B", "C", "D", "F"):
        query = query.eq("grade", grade.upper())

    result = query.order("analyzed_at", desc=True).limit(limit).execute()

    return {"data": result.data or [], "count": len(result.data or []), "meta": _meta()}


@app.get("/api/v1/safety/honeypots", tags=["Safety"])
@limiter.limit("30/minute")
def safety_honeypots(request: Request, response: Response, limit: int = Query(50, ge=1, le=200)):
    """List detected honeypot tokens."""
    _cache(response, 60)

    result = (
        supabase.table("token_safety_scores")
        .select("token_address, score, grade, risks, buy_tax_pct, sell_tax_pct, analyzed_at")
        .eq("is_honeypot", True)
        .order("analyzed_at", desc=True)
        .limit(limit)
        .execute()
    )

    return {"data": result.data or [], "count": len(result.data or []), "meta": _meta()}
