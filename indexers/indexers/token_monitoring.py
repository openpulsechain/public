from __future__ import annotations

"""Token Monitoring indexer — cross-source coherence audit.

Compares OpenPulsechain displayed values (V1/V2 subgraph) against DexScreener
(source of truth) and CoinGecko. Computes per-token coherence scores and flags
anomalies. Designed to run every 6 hours.

Sources:
  - PulseX V1 subgraph: graph.pulsechain.com/.../pulsex
  - PulseX V2 subgraph: graph.pulsechain.com/.../pulsexv2
  - DexScreener API: api.dexscreener.com/latest/dex/tokens/{addr}
  - CoinGecko API: api.coingecko.com/api/v3/simple/price
  - Database tables: token_prices, pulsechain_tokens, token_safety_scores
"""

import logging
import time
from datetime import datetime, timezone

import requests

from db import supabase
from config import (
    PULSEX_SUBGRAPH_V1,
    PULSEX_SUBGRAPH_V2,
    COINGECKO_BASE,
    COINGECKO_API_KEY,
)

logger = logging.getLogger(__name__)

# DexScreener rate limit: ~1 req/s
DEXSCREENER_API = "https://api.dexscreener.com/latest/dex/tokens"
DEXSCREENER_DELAY = 1.2  # seconds between requests

# CoinGecko IDs for PulseChain tokens (only those listed on CG)
COINGECKO_IDS = {
    "0xa1077a294dde1b09bb078844df40758a5d0f9a27": "hex",          # HEX
    "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39": "hex",          # HEX (same CG ID)
    "0x2fa878ab3f87cc1c9737fc071108f904c0b0c95d": "pulsechain",   # WPLS
    "0x95b303987a60c71504d99aa1b13b4da07b0790ab": "pulsex",       # PLSX
    "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599": "wrapped-bitcoin",
    "0xdac17f958d2ee523a2206206994597c13d831ec7": "tether",
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "usd-coin",
    "0x0d86eb9f43c57f6ff3bc9e23d8f9d82503f0e84b": "maximus",
    "0x57fde0a71132198bbec939b98976993d8d89d225": "hedron",
}

# Max tokens to process per run
MAX_TOKENS = 100

# Known core tokens — hardcoded fallback if canonical_tokens table is unavailable (Finding #6)
# P1-B: Dynamic loading from canonical_tokens WHERE is_core = TRUE
# P3-C: WBTC address corrected to bridged PulseChain address (was Ethereum address)
CORE_TOKENS_FALLBACK = {
    "0xa1077a294dde1b09bb078844df40758a5d0f9a27",  # WPLS
    "0x95b303987a60c71504d99aa1b13b4da07b0790ab",  # PLSX
    "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",  # HEX
    "0x2fa878ab3f87cc1c9737fc071108f904c0b0c95d",  # INC
    "0x02dcdd04e3f455d838cd1249292c58f3b79e3c3c",  # WETH (bridged)
    "0xefd766ccb38eaf1dfd701853bfce31359239f305",  # DAI (bridged)
    "0x15d38573d2feeb82e7ad5187ab8c1d52810b1f07",  # USDC (bridged)
    "0x0cb6f5a34ad42ec934882a05265a7d5f59b51a2f",  # USDT (bridged)
    "0xb17d901469b9208b17d916112988a3fed19b5ca1",  # WBTC (bridged) — corrected from Ethereum address
    "0x3819f64f282bf135d62168c1e513280daf905e06",  # HEDRON
    "0x0d86eb9f43c57f6ff3bc9e23d8f9d82503f0e84b",  # MAXI
    "0x57fde0a71132198bbec939b98976993d8d89d225",  # eHEX (bridge)
}

# Will be populated dynamically from database at startup
CORE_TOKENS: set[str] = set()

# Spam keywords for pool token names
# P1-D: Contextual exclusions added — "test" and "free" only flag when pool has < $1K volume
# Threshold: 10 keywords — backtest 2026-03-13: 0 false positives on tokens with >$10K liquidity
SPAM_KEYWORDS_ALWAYS = {"fuck", "shit", "scam", "rug", "fake", "airdrop", "claim", "reward"}
SPAM_KEYWORDS_CONDITIONAL = {"test", "free"}  # Only flag if token volume < $1,000 (P1-D calibration)

# Minimum reserves to consider a pool non-dust
# Threshold: $100 — backtest 2026-03-13: separates 99%+ of spam pools from legitimate ones
MIN_POOL_RESERVE_USD = 100

# Pool risk score penalty weights (P2-C: Finding #4)
RISK_PENALTIES = {
    "unknown_token": 30,   # Each unknown token = -30
    "spam_name": 40,       # Spam keyword = -40
    "low_reserve": 15,     # Reserve < $100 = -15
    "low_volume": 10,      # Volume < $1000 = -10
    "no_liquidity": 20,    # Zero liquidity = -20
}


def _load_core_tokens() -> set[str]:
    """Load core token addresses from canonical_tokens table (P1-B).

    Falls back to CORE_TOKENS_FALLBACK if the table doesn't exist or query fails.
    """
    global CORE_TOKENS
    try:
        resp = supabase.table("canonical_tokens") \
            .select("address") \
            .eq("is_core", True) \
            .execute()
        if resp.data and len(resp.data) > 0:
            CORE_TOKENS = {row["address"].lower() for row in resp.data}
            logger.info(f"Loaded {len(CORE_TOKENS)} core tokens from canonical_tokens table")
            return CORE_TOKENS
    except Exception as e:
        logger.warning(f"Failed to load core tokens from database: {e}")

    CORE_TOKENS = set(CORE_TOKENS_FALLBACK)
    logger.info(f"Using fallback CORE_TOKENS ({len(CORE_TOKENS)} tokens)")
    return CORE_TOKENS


def _query_subgraph(query: str, endpoint: str) -> dict:
    """Execute GraphQL query against a PulseX subgraph."""
    resp = requests.post(endpoint, json={"query": query}, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    if "errors" in data:
        raise ValueError(f"Subgraph error: {data['errors']}")
    return data.get("data", {})


def _fetch_subgraph_tokens(addresses: list[str], endpoint: str) -> dict:
    """Fetch token data from a PulseX subgraph. Returns dict keyed by address."""
    result = {}
    batch_size = 100

    for i in range(0, len(addresses), batch_size):
        batch = addresses[i:i + batch_size]
        query = """
        {
          tokens(where: {id_in: %s}) {
            id
            derivedUSD
            tradeVolumeUSD
            totalLiquidity
            totalSupply
            decimals
          }
        }
        """ % str(batch).replace("'", '"')

        try:
            data = _query_subgraph(query, endpoint)
            for t in data.get("tokens", []):
                addr = t["id"].lower()
                decimals = int(t.get("decimals", 18))
                derived = float(t.get("derivedUSD", 0))
                total_supply_raw = float(t.get("totalSupply", 0))
                total_supply = total_supply_raw / (10 ** decimals) if total_supply_raw > 0 else 0

                result[addr] = {
                    "derived_usd": derived,
                    "trade_volume_usd": float(t.get("tradeVolumeUSD", 0)),
                    "total_liquidity": float(t.get("totalLiquidity", 0)),
                    "total_supply": total_supply,
                }
        except Exception as e:
            logger.warning(f"Subgraph query failed ({endpoint}): {e}")

    return result


def _fetch_daily_volumes(addresses: list[str], endpoint: str) -> dict:
    """Fetch latest tokenDayDatas for 24h volume from a subgraph."""
    result = {}

    # Get yesterday's timestamp (approximate)
    yesterday_ts = int(time.time()) - 86400 * 2  # 2 days back for safety

    for i in range(0, len(addresses), 20):
        batch = addresses[i:i + 20]
        for addr in batch:
            try:
                query = f"""{{
                    tokenDayDatas(
                        first: 2,
                        where: {{token: "{addr}", date_gt: {yesterday_ts}}},
                        orderBy: date,
                        orderDirection: desc
                    ) {{
                        dailyVolumeUSD
                        totalLiquidityUSD
                    }}
                }}"""
                data = _query_subgraph(query, endpoint)
                dds = data.get("tokenDayDatas", [])
                if dds:
                    result[addr] = {
                        "daily_volume_usd": float(dds[0].get("dailyVolumeUSD", 0)),
                        "total_liquidity_usd": float(dds[0].get("totalLiquidityUSD", 0)),
                    }
            except Exception:
                pass
        time.sleep(0.3)

    return result


def _fetch_dexscreener(addresses: list[str]) -> tuple[dict, dict]:
    """Fetch token data from DexScreener API.

    Returns:
        (aggregated, raw_pairs)
        - aggregated: dict[addr] -> {price_usd, volume_24h_usd, ...} (token-level summary)
        - raw_pairs: dict[addr] -> list[dict] (all PulseChain pairs with full per-pair data)
    """
    aggregated = {}
    raw_pairs: dict[str, list[dict]] = {}

    for addr in addresses:
        try:
            resp = requests.get(
                f"{DEXSCREENER_API}/{addr}",
                timeout=15,
                headers={"User-Agent": "OpenPulsechain-Monitor/1.0"},
            )
            if resp.status_code == 429:
                logger.warning("DexScreener rate limited, waiting 5s...")
                time.sleep(5)
                resp = requests.get(
                    f"{DEXSCREENER_API}/{addr}",
                    timeout=15,
                    headers={"User-Agent": "OpenPulsechain-Monitor/1.0"},
                )

            if resp.status_code != 200:
                continue

            data = resp.json()
            pairs = data.get("pairs", [])
            if not pairs:
                continue

            # Filter to PulseChain pairs only
            pls_pairs = [p for p in pairs if p.get("chainId") == "pulsechain"]
            if not pls_pairs:
                continue

            # Use the first pair's price (highest liquidity usually first)
            best = pls_pairs[0]
            price = float(best.get("priceUsd", 0))

            # Aggregate volume and liquidity across all PulseChain pairs
            total_vol = sum(float(p.get("volume", {}).get("h24", 0)) for p in pls_pairs)
            total_liq = sum(float(p.get("liquidity", {}).get("usd", 0)) for p in pls_pairs)
            fdv = float(best.get("fdv", 0))
            mcap = float(best.get("marketCap", 0))
            change_24h = float(best.get("priceChange", {}).get("h24", 0))

            # Collect DEX names
            dex_names = list(set(p.get("dexId", "unknown") for p in pls_pairs))

            aggregated[addr] = {
                "price_usd": price,
                "volume_24h_usd": total_vol,
                "liquidity_usd": total_liq,
                "fdv": fdv,
                "market_cap_usd": mcap,
                "change_24h_pct": change_24h,
                "pair_count": len(pls_pairs),
                "dex_list": ",".join(sorted(dex_names)),
            }

            # Store raw per-pair data for pool enrichment
            token_pairs = []
            for p in pls_pairs:
                txns_h24 = p.get("txns", {}).get("h24", {})
                liq = p.get("liquidity", {})
                token_pairs.append({
                    "pair_address": (p.get("pairAddress") or "").lower(),
                    "dex_id": p.get("dexId", "unknown"),
                    "price_usd": float(p.get("priceUsd", 0)),
                    "volume_24h_usd": float(p.get("volume", {}).get("h24", 0)),
                    "liquidity_usd": float(liq.get("usd", 0)),
                    "liquidity_base": float(liq.get("base", 0)),
                    "liquidity_quote": float(liq.get("quote", 0)),
                    "buys_24h": int(txns_h24.get("buys", 0)),
                    "sells_24h": int(txns_h24.get("sells", 0)),
                    "fdv": float(p.get("fdv", 0)),
                    "market_cap_usd": float(p.get("marketCap", 0)),
                    "price_change_24h_pct": float(p.get("priceChange", {}).get("h24", 0)),
                    "base_token_address": (p.get("baseToken", {}).get("address") or "").lower(),
                    "base_token_symbol": p.get("baseToken", {}).get("symbol", ""),
                    "quote_token_address": (p.get("quoteToken", {}).get("address") or "").lower(),
                    "quote_token_symbol": p.get("quoteToken", {}).get("symbol", ""),
                    "pair_created_at": p.get("pairCreatedAt"),
                    "url": p.get("url", ""),
                })
            raw_pairs[addr] = token_pairs

        except Exception as e:
            logger.warning(f"DexScreener failed for {addr[:10]}...: {e}")

        time.sleep(DEXSCREENER_DELAY)

    return aggregated, raw_pairs


def _fetch_coingecko(addresses: list[str]) -> dict:
    """Fetch prices from CoinGecko for tokens that have CG IDs."""
    # Build reverse map: cg_id -> address
    addr_to_cg = {}
    for addr in addresses:
        cg_id = COINGECKO_IDS.get(addr)
        if cg_id:
            addr_to_cg[addr] = cg_id

    if not addr_to_cg:
        return {}

    # Deduplicate CG IDs (e.g. HEX maps to same ID)
    unique_ids = list(set(addr_to_cg.values()))
    ids_str = ",".join(unique_ids)

    params = {
        "ids": ids_str,
        "vs_currencies": "usd",
        "include_market_cap": "true",
        "include_24hr_vol": "true",
        "include_24hr_change": "true",
    }
    headers = {}
    if COINGECKO_API_KEY:
        headers["x-cg-demo-api-key"] = COINGECKO_API_KEY

    try:
        resp = requests.get(
            f"{COINGECKO_BASE}/simple/price",
            params=params,
            headers=headers,
            timeout=30,
        )
        if resp.status_code != 200:
            logger.warning(f"CoinGecko returned {resp.status_code}")
            return {}

        data = resp.json()
    except Exception as e:
        logger.warning(f"CoinGecko request failed: {e}")
        return {}

    result = {}
    for addr, cg_id in addr_to_cg.items():
        cg_data = data.get(cg_id, {})
        if cg_data:
            result[addr] = {
                "price_usd": cg_data.get("usd"),
                "volume_24h_usd": cg_data.get("usd_24h_vol"),
                "market_cap_usd": cg_data.get("usd_market_cap"),
                "change_24h_pct": cg_data.get("usd_24h_change"),
                "cg_id": cg_id,
            }

    return result


def _fetch_op_displayed(addresses: list[str]) -> dict:
    """Fetch what OpenPulsechain currently displays from database tables."""
    result = {}

    # token_prices = what's displayed on the site
    batch_size = 50
    for i in range(0, len(addresses), batch_size):
        batch = addresses[i:i + batch_size]
        try:
            resp = supabase.table("token_prices") \
                .select("id, symbol, name, price_usd, volume_24h_usd, market_cap_usd, price_change_24h_pct, source") \
                .in_("id", batch) \
                .execute()
            for row in resp.data or []:
                addr = row["id"].lower()
                result[addr] = {
                    "price_usd": float(row["price_usd"]) if row.get("price_usd") else None,
                    "volume_24h_usd": float(row["volume_24h_usd"]) if row.get("volume_24h_usd") else None,
                    "market_cap_usd": float(row["market_cap_usd"]) if row.get("market_cap_usd") else None,
                    "change_24h_pct": float(row["price_change_24h_pct"]) if row.get("price_change_24h_pct") else None,
                    "source": row.get("source", "unknown"),
                }
        except Exception as e:
            logger.warning(f"Failed to fetch token_prices: {e}")

    # token_safety_scores
    for i in range(0, len(addresses), batch_size):
        batch = addresses[i:i + batch_size]
        try:
            resp = supabase.table("token_safety_scores") \
                .select("token_address, score, grade") \
                .in_("token_address", batch) \
                .execute()
            for row in resp.data or []:
                addr = row["token_address"].lower()
                if addr in result:
                    result[addr]["safety_score"] = row.get("score")
                    result[addr]["safety_grade"] = row.get("grade")
        except Exception:
            pass

    # pulsechain_tokens (for holder count, category, liquidity from discovery)
    for i in range(0, len(addresses), batch_size):
        batch = addresses[i:i + batch_size]
        try:
            resp = supabase.table("pulsechain_tokens") \
                .select("address, symbol, name, holder_count, total_liquidity_usd") \
                .in_("address", batch) \
                .execute()
            for row in resp.data or []:
                addr = row["address"].lower()
                if addr not in result:
                    result[addr] = {}
                result[addr]["symbol"] = row.get("symbol")
                result[addr]["name"] = row.get("name")
                result[addr]["holder_count"] = row.get("holder_count")
                result[addr]["liquidity_usd"] = float(row["total_liquidity_usd"]) if row.get("total_liquidity_usd") else None
                result[addr]["token_type"] = None
                result[addr]["has_logo"] = False
        except Exception:
            pass

    return result


def _coherence_score(displayed: float | None, truth: float | None) -> int:
    """Compute coherence score 0-100 between displayed and truth values.

    100 = <1% difference
    80  = <5% difference
    60  = <10% difference
    40  = <25% difference
    20  = <50% difference
    0   = >50% difference or missing data
    """
    if not displayed or not truth or truth == 0:
        return 0

    pct_diff = abs(displayed - truth) / abs(truth) * 100

    if pct_diff < 1:
        return 100
    if pct_diff < 5:
        return 80
    if pct_diff < 10:
        return 60
    if pct_diff < 25:
        return 40
    if pct_diff < 50:
        return 20
    return 0


def _compute_global_coherence(price_score: int, vol_score: int, liq_score: int, mcap_score: int) -> int:
    """Weighted global coherence score. Price=40%, Vol=25%, Liq=20%, MCap=15%."""
    return round(price_score * 0.40 + vol_score * 0.25 + liq_score * 0.20 + mcap_score * 0.15)


def _get_subgraph_block(endpoint: str) -> int | None:
    """Get the latest indexed block number from a subgraph for freshness tracking."""
    try:
        query = "{ _meta { block { number } } }"
        data = _query_subgraph(query, endpoint)
        return int(data.get("_meta", {}).get("block", {}).get("number", 0)) or None
    except Exception as e:
        logger.warning(f"Failed to get subgraph block: {e}")
        return None


def _fetch_pools_for_token(token_address: str, endpoint: str, version: str) -> list[dict]:
    """Fetch all liquidity pools (pairs) for a specific token from a subgraph.

    Queries both where token is token0 and token1.
    Returns list of pool dicts with full token addresses and reserves.
    """
    pools = []

    for position in ["token0", "token1"]:
        try:
            query = f"""{{
                pairs(
                    first: 50,
                    where: {{{position}: "{token_address}"}},
                    orderBy: reserveUSD,
                    orderDirection: desc
                ) {{
                    id
                    token0 {{
                        id
                        symbol
                        name
                        decimals
                        tradeVolumeUSD
                        totalLiquidity
                    }}
                    token1 {{
                        id
                        symbol
                        name
                        decimals
                        tradeVolumeUSD
                        totalLiquidity
                    }}
                    reserve0
                    reserve1
                    reserveUSD
                    volumeUSD
                    totalTransactions
                }}
            }}"""
            data = _query_subgraph(query, endpoint)
            for pair in data.get("pairs", []):
                pools.append({
                    "pair_address": pair["id"].lower(),
                    "dex_version": version,
                    "token0_address": pair["token0"]["id"].lower(),
                    "token0_symbol": pair["token0"]["symbol"],
                    "token0_name": pair["token0"]["name"],
                    "token0_decimals": int(pair["token0"].get("decimals", 18)),
                    "token0_volume_usd": float(pair["token0"].get("tradeVolumeUSD", 0)),
                    "token0_liquidity": float(pair["token0"].get("totalLiquidity", 0)),
                    "token1_address": pair["token1"]["id"].lower(),
                    "token1_symbol": pair["token1"]["symbol"],
                    "token1_name": pair["token1"]["name"],
                    "token1_decimals": int(pair["token1"].get("decimals", 18)),
                    "token1_volume_usd": float(pair["token1"].get("tradeVolumeUSD", 0)),
                    "token1_liquidity": float(pair["token1"].get("totalLiquidity", 0)),
                    "reserve0": float(pair.get("reserve0", 0)),
                    "reserve1": float(pair.get("reserve1", 0)),
                    "reserve_usd": float(pair.get("reserveUSD", 0)),
                    "volume_alltime_usd": float(pair.get("volumeUSD", 0)),
                    "total_transactions": int(pair.get("totalTransactions", 0)),
                    "created_at_ts": None,
                })
        except Exception as e:
            logger.warning(f"Failed to fetch {version} pools for {token_address[:10]}... ({position}): {e}")

    # Deduplicate by pair_address (token can be both token0 and token1 in query results)
    seen = set()
    unique = []
    for p in pools:
        if p["pair_address"] not in seen:
            seen.add(p["pair_address"])
            unique.append(p)

    return unique


def _fetch_pool_daily_volumes(pair_addresses: list[str], endpoint: str) -> dict[str, float]:
    """Fetch 24h volumes for a list of pair addresses."""
    if not pair_addresses:
        return {}

    cutoff = int(time.time()) - 36 * 3600
    volumes = {}

    for i in range(0, len(pair_addresses), 10):
        batch = pair_addresses[i:i + 10]
        addr_list = ", ".join(f'"{a}"' for a in batch)
        try:
            query = f"""{{
                pairDayDatas(
                    first: {len(batch) * 3},
                    where: {{pairAddress_in: [{addr_list}], date_gt: {cutoff}}},
                    orderBy: date,
                    orderDirection: desc
                ) {{
                    id
                    dailyVolumeUSD
                }}
            }}"""
            data = _query_subgraph(query, endpoint)
            for dd in data.get("pairDayDatas", []):
                raw_id = dd.get("id", "")
                addr = raw_id.rsplit("-", 1)[0].lower() if "-" in raw_id else raw_id.lower()
                if not addr or addr in volumes:
                    continue
                volumes[addr] = float(dd.get("dailyVolumeUSD", 0))
        except Exception:
            pass
        time.sleep(0.2)

    return volumes


def _validate_pool_token(token_address: str, token_symbol: str, token_name: str,
                          token_volume_usd: float, token_liquidity: float,
                          known_addresses: set[str]) -> tuple[bool, bool, bool]:
    """Validate a token in a pool against anti-spam criteria.

    Returns (is_known, is_core, has_liquidity).
    - is_known: token exists in pulsechain_tokens (already spam-filtered by token_discovery)
    - is_core: token is in the hardcoded CORE_TOKENS set
    - has_liquidity: token has meaningful liquidity (>1 unit)
    """
    addr = token_address.lower()
    is_core = addr in CORE_TOKENS
    is_known = addr in known_addresses or is_core
    has_liquidity = token_liquidity > 1

    return is_known, is_core, has_liquidity


def _classify_pool(pool: dict, known_addresses: set[str]) -> dict:
    """Classify a pool as legitimate or spam based on multi-criteria analysis.

    Checks:
    1. Both token addresses exist in pulsechain_tokens (already filtered for spam)
    2. Neither token name contains spam keywords
    3. Pool has minimum reserve USD (not dust)
    4. Both tokens have meaningful trade volume
    5. Core token pairing (WPLS, HEX, PLSX, WETH, stables)

    Returns pool dict enriched with validation fields.
    """
    t0_addr = pool["token0_address"]
    t1_addr = pool["token1_address"]
    t0_name = (pool.get("token0_name") or "").lower()
    t1_name = (pool.get("token1_name") or "").lower()

    # Validate each token
    t0_known, t0_core, t0_liq = _validate_pool_token(
        t0_addr, pool.get("token0_symbol", ""), t0_name,
        pool.get("token0_volume_usd", 0), pool.get("token0_liquidity", 0),
        known_addresses,
    )
    t1_known, t1_core, t1_liq = _validate_pool_token(
        t1_addr, pool.get("token1_symbol", ""), t1_name,
        pool.get("token1_volume_usd", 0), pool.get("token1_liquidity", 0),
        known_addresses,
    )

    pool["token0_is_known"] = t0_known
    pool["token0_is_core"] = t0_core
    pool["token0_has_liquidity"] = t0_liq
    pool["token1_is_known"] = t1_known
    pool["token1_is_core"] = t1_core
    pool["token1_has_liquidity"] = t1_liq

    # --- Determine legitimacy ---
    spam_reasons = []
    risk_penalty = 0  # P2-C: accumulated penalty for pool_risk_score

    # Check spam keywords in token names (P1-D: contextual exclusions)
    t0_vol = pool.get("token0_volume_usd", 0)
    t1_vol = pool.get("token1_volume_usd", 0)
    for kw in SPAM_KEYWORDS_ALWAYS:
        if kw in t0_name:
            spam_reasons.append(f"spam_name_token0:{kw}")
            risk_penalty += RISK_PENALTIES["spam_name"]
        if kw in t1_name:
            spam_reasons.append(f"spam_name_token1:{kw}")
            risk_penalty += RISK_PENALTIES["spam_name"]
    # Conditional keywords: only flag if token volume < $1,000 (P1-D calibration)
    for kw in SPAM_KEYWORDS_CONDITIONAL:
        if kw in t0_name and t0_vol < 1000:
            spam_reasons.append(f"spam_name_token0:{kw}")
            risk_penalty += RISK_PENALTIES["spam_name"]
        if kw in t1_name and t1_vol < 1000:
            spam_reasons.append(f"spam_name_token1:{kw}")
            risk_penalty += RISK_PENALTIES["spam_name"]

    # Check if tokens are known
    if not t0_known:
        spam_reasons.append("unknown_token0")
        risk_penalty += RISK_PENALTIES["unknown_token"]
    if not t1_known:
        spam_reasons.append("unknown_token1")
        risk_penalty += RISK_PENALTIES["unknown_token"]

    # Check minimum reserve
    # Threshold: $100 — justified by backtest 2026-03-13
    if pool.get("reserve_usd", 0) < MIN_POOL_RESERVE_USD:
        spam_reasons.append(f"low_reserve:{pool.get('reserve_usd', 0):.0f}")
        risk_penalty += RISK_PENALTIES["low_reserve"]

    # Check for zero liquidity on either side
    if not t0_liq and not t0_core:
        spam_reasons.append("no_liquidity_token0")
        risk_penalty += RISK_PENALTIES["no_liquidity"]
    if not t1_liq and not t1_core:
        spam_reasons.append("no_liquidity_token1")
        risk_penalty += RISK_PENALTIES["no_liquidity"]

    # Check for suspiciously low volume (< $1000 lifetime) on non-core tokens
    # Threshold: $1,000 — justified by backtest 2026-03-13
    if not t0_core and t0_vol < 1000:
        spam_reasons.append("low_volume_token0")
        risk_penalty += RISK_PENALTIES["low_volume"]
    if not t1_core and t1_vol < 1000:
        spam_reasons.append("low_volume_token1")
        risk_penalty += RISK_PENALTIES["low_volume"]

    # P2-C: Pool risk score (0-100) — graduated instead of binary (Finding #4)
    pool_risk_score = max(0, 100 - risk_penalty)
    pool["pool_risk_score"] = pool_risk_score

    # Legitimate derived from risk score (>= 50 = legitimate)
    is_legitimate = pool_risk_score >= 50
    pool["pool_is_legitimate"] = is_legitimate
    pool["pool_spam_reason"] = "; ".join(spam_reasons) if spam_reasons else None

    # Confidence level
    if t0_core and t1_core:
        pool["pool_confidence"] = "high"
    elif (t0_core and t1_known) or (t1_core and t0_known):
        pool["pool_confidence"] = "medium"
    elif t0_known and t1_known:
        pool["pool_confidence"] = "low"
    else:
        pool["pool_confidence"] = "suspect"

    return pool


def _fetch_all_pools(addresses: list[str], known_addresses: set[str],
                     dx_raw_pairs: dict[str, list[dict]],
                     dx_aggregated: dict) -> dict[str, list[dict]]:
    """Fetch, merge, and validate all pools for all monitored tokens.

    Combines PulseX V1+V2 subgraph pools with DexScreener per-pair data:
    1. Fetches subgraph pools (V1 + V2)
    2. Matches DexScreener pairs by pair_address
    3. Adds multi-DEX pools (9mm, pdex, etc.) that only exist on DexScreener
    4. Classifies all pools (anti-spam)
    5. Computes implied price per pool

    Returns dict keyed by token_address -> list of enriched, classified pool dicts.
    """
    all_pools: dict[str, list[dict]] = {}

    for addr in addresses:
        # Fetch from V1 and V2 subgraphs
        v1_pools = _fetch_pools_for_token(addr, PULSEX_SUBGRAPH_V1, "pulsex_v1")
        time.sleep(0.3)
        v2_pools = _fetch_pools_for_token(addr, PULSEX_SUBGRAPH_V2, "pulsex_v2")
        time.sleep(0.3)

        # Combine (different pair addresses on V1 vs V2)
        combined = v1_pools + v2_pools

        # Deduplicate by pair_address
        seen = set()
        unique = []
        for p in combined:
            if p["pair_address"] not in seen:
                seen.add(p["pair_address"])
                unique.append(p)

        # --- Merge DexScreener per-pair data ---
        dx_pairs = dx_raw_pairs.get(addr, [])
        dx_by_pair = {dp["pair_address"]: dp for dp in dx_pairs}

        # Enrich existing subgraph pools with DexScreener data
        for pool in unique:
            dx_match = dx_by_pair.pop(pool["pair_address"], None)
            if dx_match:
                pool["dx_pair_address"] = dx_match["pair_address"]
                pool["dx_price_usd"] = dx_match["price_usd"]
                pool["dx_volume_24h_usd"] = dx_match["volume_24h_usd"]
                pool["dx_liquidity_usd"] = dx_match["liquidity_usd"]
                pool["dx_dex_id"] = dx_match["dex_id"]
                pool["dx_buys_24h"] = dx_match["buys_24h"]
                pool["dx_sells_24h"] = dx_match["sells_24h"]
                pool["dx_txns_24h"] = dx_match["buys_24h"] + dx_match["sells_24h"]
                pool["dx_fdv"] = dx_match["fdv"]
                pool["dx_market_cap_usd"] = dx_match["market_cap_usd"]
                pool["dx_price_change_24h_pct"] = dx_match["price_change_24h_pct"]
                pool["dx_liquidity_base"] = dx_match["liquidity_base"]
                pool["dx_liquidity_quote"] = dx_match["liquidity_quote"]
                pool["dx_base_token_address"] = dx_match["base_token_address"]
                pool["dx_base_token_symbol"] = dx_match["base_token_symbol"]
                pool["dx_quote_token_address"] = dx_match["quote_token_address"]
                pool["dx_quote_token_symbol"] = dx_match["quote_token_symbol"]
                pool["dx_pair_created_at"] = dx_match["pair_created_at"]
                pool["dx_url"] = dx_match["url"]
                pool["data_source"] = "both"
            else:
                pool["data_source"] = "subgraph"

        # Add multi-DEX pools only on DexScreener (9mm, pdex, etc.)
        for pair_addr, dx_pair in dx_by_pair.items():
            # This pair was NOT matched to any subgraph pool
            dx_only_pool = {
                "pair_address": pair_addr,
                "dex_version": dx_pair["dex_id"],
                "token0_address": dx_pair["base_token_address"],
                "token0_symbol": dx_pair["base_token_symbol"],
                "token0_name": dx_pair["base_token_symbol"],  # DexScreener doesn't provide full names
                "token0_decimals": None,
                "token0_volume_usd": 0,
                "token0_liquidity": 0,
                "token1_address": dx_pair["quote_token_address"],
                "token1_symbol": dx_pair["quote_token_symbol"],
                "token1_name": dx_pair["quote_token_symbol"],
                "token1_decimals": None,
                "token1_volume_usd": 0,
                "token1_liquidity": 0,
                "reserve0": None,
                "reserve1": None,
                "reserve_usd": dx_pair["liquidity_usd"],  # Use DexScreener liq as reserve proxy
                "volume_alltime_usd": None,
                "total_transactions": None,
                "created_at_ts": dx_pair["pair_created_at"],
                # DexScreener fields
                "dx_pair_address": pair_addr,
                "dx_price_usd": dx_pair["price_usd"],
                "dx_volume_24h_usd": dx_pair["volume_24h_usd"],
                "dx_liquidity_usd": dx_pair["liquidity_usd"],
                "dx_dex_id": dx_pair["dex_id"],
                "dx_buys_24h": dx_pair["buys_24h"],
                "dx_sells_24h": dx_pair["sells_24h"],
                "dx_txns_24h": dx_pair["buys_24h"] + dx_pair["sells_24h"],
                "dx_fdv": dx_pair["fdv"],
                "dx_market_cap_usd": dx_pair["market_cap_usd"],
                "dx_price_change_24h_pct": dx_pair["price_change_24h_pct"],
                "dx_liquidity_base": dx_pair["liquidity_base"],
                "dx_liquidity_quote": dx_pair["liquidity_quote"],
                "dx_base_token_address": dx_pair["base_token_address"],
                "dx_base_token_symbol": dx_pair["base_token_symbol"],
                "dx_quote_token_address": dx_pair["quote_token_address"],
                "dx_quote_token_symbol": dx_pair["quote_token_symbol"],
                "dx_pair_created_at": dx_pair["pair_created_at"],
                "dx_url": dx_pair["url"],
                "data_source": "dexscreener",
            }
            unique.append(dx_only_pool)

        # The monitored token itself must always be "known" in its own pools
        known_addresses.add(addr.lower())

        # Classify each pool (anti-spam)
        classified = [_classify_pool(p, known_addresses) for p in unique]

        # Compute implied price per pool + coherence vs consensus
        consensus_price = dx_aggregated.get(addr, {}).get("price_usd")
        for pool in classified:
            # Implied price from reserves: if token is token0, price = reserve1/reserve0 * token1_price
            # Simpler: use DexScreener price if available, else derive from reserveUSD / 2 / reserve_of_token
            implied = pool.get("dx_price_usd") or 0
            if not implied and pool.get("reserve_usd") and pool.get("reserve_usd", 0) > 0:
                # Very rough: total reserves / 2 = value of each side
                # If we know which side is our token, we can compute price
                r0 = pool.get("reserve0", 0)
                if r0 and r0 > 0 and pool["token0_address"] == addr:
                    implied = (pool["reserve_usd"] / 2) / r0
                else:
                    r1 = pool.get("reserve1", 0)
                    if r1 and r1 > 0 and pool["token1_address"] == addr:
                        implied = (pool["reserve_usd"] / 2) / r1

            pool["implied_price_usd"] = implied if implied > 0 else None

            if implied and consensus_price and consensus_price > 0:
                pool["price_vs_consensus_pct"] = round(
                    (implied - consensus_price) / consensus_price * 100, 2
                )
            else:
                pool["price_vs_consensus_pct"] = None

        # Sort: legitimate first, then by effective liquidity desc
        classified.sort(key=lambda p: (
            not p.get("pool_is_legitimate"),
            -(p.get("dx_liquidity_usd") or p.get("reserve_usd") or 0)
        ))

        all_pools[addr] = classified

        if classified:
            legit = sum(1 for p in classified if p.get("pool_is_legitimate"))
            dx_matched = sum(1 for p in classified if p.get("data_source") in ("both", "dexscreener"))
            logger.info(f"  {addr[:10]}...: {len(classified)} pools ({legit} legit, {dx_matched} DX-enriched)")

    return all_pools


def _fetch_known_token_addresses() -> set[str]:
    """Fetch all known token addresses from pulsechain_tokens table.

    These tokens have already been filtered for spam by token_discovery.
    Used as ground truth for pool token validation.
    Also loads core tokens dynamically from canonical_tokens (P1-B).
    """
    # Load core tokens from database (P1-B)
    _load_core_tokens()

    known = set()
    try:
        resp = supabase.table("pulsechain_tokens") \
            .select("address") \
            .eq("is_active", True) \
            .execute()
        for row in resp.data or []:
            known.add(row["address"].lower())
    except Exception as e:
        logger.warning(f"Failed to fetch known token addresses: {e}")

    # Always include core tokens
    known.update(CORE_TOKENS)
    logger.info(f"Known token addresses for validation: {len(known)}")
    return known


def _log_confidence_transitions(all_pools: dict[str, list[dict]], now: str) -> None:
    """Log confidence/legitimacy transitions to pool_confidence_events (P1-E: Finding #8).

    Compares current pool classification against the most recent snapshot in
    token_monitoring_pools. Inserts a row for each pool where confidence or
    legitimacy has changed, with a human-readable event_summary.
    """
    # Collect all pair addresses from current pools
    pair_to_pool: dict[str, dict] = {}
    for addr, pools in all_pools.items():
        for pool in pools:
            pair_to_pool[pool["pair_address"]] = pool

    if not pair_to_pool:
        return

    pair_addresses = list(pair_to_pool.keys())

    # Fetch the most recent snapshot for each pair
    prev_states: dict[str, dict] = {}
    try:
        # Get latest snapshot per pair (before current run)
        for i in range(0, len(pair_addresses), 50):
            batch_addrs = pair_addresses[i:i + 50]
            resp = supabase.table("token_monitoring_pools") \
                .select("pair_address, pool_confidence, pool_is_legitimate, pool_spam_reason, token_address") \
                .in_("pair_address", batch_addrs) \
                .neq("snapshot_at", now) \
                .order("snapshot_at", desc=True) \
                .limit(len(batch_addrs) * 2) \
                .execute()
            for row in resp.data or []:
                pa = row["pair_address"]
                if pa not in prev_states:  # Keep only the most recent
                    prev_states[pa] = row
    except Exception as e:
        logger.warning(f"Failed to fetch previous pool states for transition logging: {e}")
        return

    # Compare and log transitions
    events = []
    for pair_addr, pool in pair_to_pool.items():
        new_conf = pool.get("pool_confidence", "suspect")
        new_legit = pool.get("pool_is_legitimate", False)
        new_spam = pool.get("pool_spam_reason")

        prev = prev_states.get(pair_addr)
        if prev is None:
            continue  # First observation — no transition to log

        prev_conf = prev.get("pool_confidence")
        prev_legit = prev.get("pool_is_legitimate")

        if prev_conf == new_conf and prev_legit == new_legit:
            continue  # No change

        # Build human-readable summary
        conf_changed = prev_conf != new_conf
        legit_changed = prev_legit != new_legit
        parts = []
        if conf_changed:
            direction = "upgraded" if _conf_rank(new_conf) > _conf_rank(prev_conf) else "downgraded"
            parts.append(f"Confidence {direction}: {prev_conf} -> {new_conf}")
        if legit_changed:
            if new_legit:
                parts.append("Pool now classified as legitimate")
            else:
                parts.append(f"Pool classified as not legitimate ({new_spam or 'unknown reason'})")

        token_addr = pool.get("token0_address", prev.get("token_address", ""))

        events.append({
            "event_at": now,
            "token_address": token_addr,
            "pair_address": pair_addr,
            "prev_confidence": prev_conf,
            "prev_is_legitimate": prev_legit,
            "prev_spam_reason": prev.get("pool_spam_reason"),
            "new_confidence": new_conf,
            "new_is_legitimate": new_legit,
            "new_spam_reason": new_spam,
            "reserve_usd": pool.get("reserve_usd"),
            "volume_24h_usd": pool.get("dx_volume_24h_usd"),
            "liquidity_usd": pool.get("dx_liquidity_usd"),
            "token0_symbol": pool.get("token0_symbol"),
            "token1_symbol": pool.get("token1_symbol"),
            "dex_version": pool.get("dex_version") or pool.get("dx_dex_id"),
            "event_summary": ". ".join(parts),
        })

    if events:
        try:
            for i in range(0, len(events), 50):
                batch = events[i:i + 50]
                supabase.table("pool_confidence_events").insert(batch).execute()
            logger.info(f"Logged {len(events)} confidence transitions")
        except Exception as e:
            logger.warning(f"Failed to log confidence transitions: {e}")
    else:
        logger.debug("No confidence transitions detected")


def _conf_rank(level: str | None) -> int:
    """Return numeric rank for confidence level (higher = better)."""
    return {"high": 4, "medium": 3, "low": 2, "suspect": 1}.get(level or "", 0)


# Thresholds for pool event detection
LIQ_SPIKE_PCT = 50     # +50% liquidity change
LIQ_DRAIN_PCT = -50    # -50% liquidity change
PRICE_DIVERGE_PCT = 5  # 5% price deviation from consensus


def _detect_pool_events(addresses: list[str], current_pools: dict[str, list[dict]],
                        now: str) -> list[dict]:
    """Detect pool lifecycle events by comparing current pools with previous snapshot.

    Detects:
    - pool_created: new pair_address not in previous snapshot
    - pool_removed: pair_address in previous but not in current
    - liq_spike: liquidity increased >50%
    - liq_drain: liquidity decreased >50%
    - price_divergent: pool price diverges >5% from consensus

    Returns list of event dicts ready for upsert into token_pool_events.
    """
    events = []

    # Fetch previous snapshot for each token (most recent before current)
    for addr in addresses:
        curr_pools = current_pools.get(addr, [])
        if not curr_pools:
            continue

        # Get previous pools from DB
        try:
            resp = supabase.table("token_monitoring_pools") \
                .select("pair_address, dex_version, dx_liquidity_usd, dx_price_usd, "
                        "token0_symbol, token1_symbol, pool_is_legitimate, pool_confidence, "
                        "snapshot_at, data_source, dx_base_token_symbol, dx_quote_token_symbol") \
                .eq("token_address", addr) \
                .lt("snapshot_at", now) \
                .order("snapshot_at", desc=True) \
                .limit(500) \
                .execute()
        except Exception as e:
            logger.warning(f"Failed to fetch previous pools for {addr[:10]}...: {e}")
            continue

        prev_rows = resp.data or []
        if not prev_rows:
            # First snapshot — all pools are "new" but we don't generate events for initial load
            continue

        # Get unique previous snapshot timestamp
        prev_snapshot = prev_rows[0]["snapshot_at"] if prev_rows else None

        # Filter to only the latest previous snapshot
        prev_by_pair = {}
        for row in prev_rows:
            if row["snapshot_at"] == prev_snapshot:
                prev_by_pair[row["pair_address"]] = row

        # Build current pool lookup (only legitimate + DX-enriched for meaningful comparison)
        curr_by_pair = {}
        for p in curr_pools:
            if p.get("data_source") in ("both", "dexscreener"):
                curr_by_pair[p["pair_address"]] = p

        # Get token symbol
        token_sym = None
        for p in curr_pools:
            if p.get("dx_base_token_symbol"):
                token_sym = p["dx_base_token_symbol"]
                break
            token_sym = p.get("token0_symbol") or p.get("token1_symbol")

        # --- Detect NEW pools ---
        for pair_addr, pool in curr_by_pair.items():
            if pair_addr not in prev_by_pair:
                liq = pool.get("dx_liquidity_usd") or 0
                if liq < 100:
                    continue  # Ignore dust pools

                events.append({
                    "detected_at": now,
                    "token_address": addr,
                    "token_symbol": token_sym,
                    "pair_address": pair_addr,
                    "event_type": "pool_created",
                    "severity": "info" if liq < 10000 else "warning",
                    "dex_version": pool.get("dx_dex_id") or pool.get("dex_version"),
                    "base_symbol": pool.get("dx_base_token_symbol") or pool.get("token0_symbol"),
                    "quote_symbol": pool.get("dx_quote_token_symbol") or pool.get("token1_symbol"),
                    "pool_is_legitimate": pool.get("pool_is_legitimate"),
                    "pool_confidence": pool.get("pool_confidence"),
                    "prev_value": None,
                    "curr_value": liq,
                    "change_pct": None,
                    "detail": f"New pool: {pool.get('dx_base_token_symbol', '?')}/{pool.get('dx_quote_token_symbol', '?')} "
                              f"on {pool.get('dx_dex_id', pool.get('dex_version', '?'))} — liq ${liq:,.0f}",
                    "prev_snapshot_at": prev_snapshot,
                    "curr_snapshot_at": now,
                })

        # --- Detect REMOVED pools ---
        for pair_addr, prev_pool in prev_by_pair.items():
            if pair_addr not in curr_by_pair and prev_pool.get("data_source") in ("both", "dexscreener"):
                prev_liq = float(prev_pool.get("dx_liquidity_usd") or 0)
                if prev_liq < 100:
                    continue

                events.append({
                    "detected_at": now,
                    "token_address": addr,
                    "token_symbol": token_sym,
                    "pair_address": pair_addr,
                    "event_type": "pool_removed",
                    "severity": "warning" if prev_liq < 50000 else "critical",
                    "dex_version": prev_pool.get("dex_version"),
                    "base_symbol": prev_pool.get("dx_base_token_symbol") or prev_pool.get("token0_symbol"),
                    "quote_symbol": prev_pool.get("dx_quote_token_symbol") or prev_pool.get("token1_symbol"),
                    "pool_is_legitimate": prev_pool.get("pool_is_legitimate"),
                    "pool_confidence": prev_pool.get("pool_confidence"),
                    "prev_value": prev_liq,
                    "curr_value": 0,
                    "change_pct": -100,
                    "detail": f"Pool removed: {prev_pool.get('dx_base_token_symbol', prev_pool.get('token0_symbol', '?'))}/"
                              f"{prev_pool.get('dx_quote_token_symbol', prev_pool.get('token1_symbol', '?'))} "
                              f"was ${prev_liq:,.0f} liq",
                    "prev_snapshot_at": prev_snapshot,
                    "curr_snapshot_at": now,
                })

        # --- Detect LIQUIDITY changes + PRICE divergence ---
        for pair_addr, pool in curr_by_pair.items():
            prev_pool = prev_by_pair.get(pair_addr)
            if not prev_pool:
                continue  # Already handled as pool_created

            curr_liq = pool.get("dx_liquidity_usd") or 0
            prev_liq = float(prev_pool.get("dx_liquidity_usd") or 0)

            if prev_liq > 100 and curr_liq > 0:
                change_pct = (curr_liq - prev_liq) / prev_liq * 100

                if change_pct > LIQ_SPIKE_PCT:
                    events.append({
                        "detected_at": now,
                        "token_address": addr,
                        "token_symbol": token_sym,
                        "pair_address": pair_addr,
                        "event_type": "liq_spike",
                        "severity": "warning" if change_pct > 200 else "info",
                        "dex_version": pool.get("dx_dex_id") or pool.get("dex_version"),
                        "base_symbol": pool.get("dx_base_token_symbol"),
                        "quote_symbol": pool.get("dx_quote_token_symbol"),
                        "pool_is_legitimate": pool.get("pool_is_legitimate"),
                        "pool_confidence": pool.get("pool_confidence"),
                        "prev_value": prev_liq,
                        "curr_value": curr_liq,
                        "change_pct": round(change_pct, 1),
                        "detail": f"Liq spike: ${prev_liq:,.0f} → ${curr_liq:,.0f} (+{change_pct:.0f}%)",
                        "prev_snapshot_at": prev_snapshot,
                        "curr_snapshot_at": now,
                    })

                elif change_pct < LIQ_DRAIN_PCT:
                    events.append({
                        "detected_at": now,
                        "token_address": addr,
                        "token_symbol": token_sym,
                        "pair_address": pair_addr,
                        "event_type": "liq_drain",
                        "severity": "critical" if change_pct < -80 else "warning",
                        "dex_version": pool.get("dx_dex_id") or pool.get("dex_version"),
                        "base_symbol": pool.get("dx_base_token_symbol"),
                        "quote_symbol": pool.get("dx_quote_token_symbol"),
                        "pool_is_legitimate": pool.get("pool_is_legitimate"),
                        "pool_confidence": pool.get("pool_confidence"),
                        "prev_value": prev_liq,
                        "curr_value": curr_liq,
                        "change_pct": round(change_pct, 1),
                        "detail": f"Liq drain: ${prev_liq:,.0f} → ${curr_liq:,.0f} ({change_pct:.0f}%)",
                        "prev_snapshot_at": prev_snapshot,
                        "curr_snapshot_at": now,
                    })

    return events


def run():
    logger.info("Running token monitoring (cross-source coherence audit)...")

    supabase.table("sync_status").upsert({
        "indexer_name": "token_monitoring",
        "status": "running",
    }, on_conflict="indexer_name").execute()

    try:
        # 1. Get top tokens by volume from pulsechain_tokens
        resp = supabase.table("pulsechain_tokens") \
            .select("address, symbol, name") \
            .eq("is_active", True) \
            .order("total_volume_usd", desc=True) \
            .limit(MAX_TOKENS) \
            .execute()

        tokens = resp.data or []
        if not tokens:
            logger.warning("No tokens found — run token_discovery first")
            return

        addresses = [t["address"].lower() for t in tokens]
        token_meta = {t["address"].lower(): t for t in tokens}

        logger.info(f"Processing {len(addresses)} tokens...")

        # 2. Fetch from all sources in sequence
        logger.info("  Fetching PulseX V1 subgraph...")
        v1_tokens = _fetch_subgraph_tokens(addresses, PULSEX_SUBGRAPH_V1)
        v1_daily = _fetch_daily_volumes(addresses, PULSEX_SUBGRAPH_V1)
        logger.info(f"  V1: {len(v1_tokens)} tokens, {len(v1_daily)} daily volumes")

        logger.info("  Fetching PulseX V2 subgraph...")
        v2_tokens = _fetch_subgraph_tokens(addresses, PULSEX_SUBGRAPH_V2)
        v2_daily = _fetch_daily_volumes(addresses, PULSEX_SUBGRAPH_V2)
        logger.info(f"  V2: {len(v2_tokens)} tokens, {len(v2_daily)} daily volumes")

        # Subgraph freshness
        logger.info("  Checking subgraph block freshness...")
        v1_block = _get_subgraph_block(PULSEX_SUBGRAPH_V1)
        v2_block = _get_subgraph_block(PULSEX_SUBGRAPH_V2)
        logger.info(f"  Subgraph blocks — V1: {v1_block}, V2: {v2_block}")

        logger.info("  Fetching DexScreener...")
        dx_data, dx_raw_pairs = _fetch_dexscreener(addresses)
        dx_pair_total = sum(len(v) for v in dx_raw_pairs.values())
        logger.info(f"  DexScreener: {len(dx_data)} tokens, {dx_pair_total} raw pairs")

        logger.info("  Fetching CoinGecko...")
        cg_data = _fetch_coingecko(addresses)
        logger.info(f"  CoinGecko: {len(cg_data)} tokens")

        logger.info("  Fetching OpenPulsechain displayed values...")
        op_data = _fetch_op_displayed(addresses)
        logger.info(f"  OpenPulsechain: {len(op_data)} tokens")

        # 2b. Fetch known token addresses for pool validation
        logger.info("  Loading known token addresses for anti-spam validation...")
        known_addresses = _fetch_known_token_addresses()

        # 2c. Fetch all pools per token (V1+V2+DexScreener) with anti-spam classification
        logger.info("  Fetching liquidity pools per token (V1+V2+DexScreener)...")
        all_pools = _fetch_all_pools(addresses, known_addresses, dx_raw_pairs, dx_data)
        total_pools = sum(len(v) for v in all_pools.values())
        legit_pools = sum(sum(1 for p in v if p["pool_is_legitimate"]) for v in all_pools.values())
        logger.info(f"  Pools: {total_pools} total, {legit_pools} legitimate")

        # 3. Build monitoring rows
        now = datetime.now(timezone.utc).isoformat()
        rows = []

        for addr in addresses:
            meta = token_meta.get(addr, {})
            v1 = v1_tokens.get(addr, {})
            v2 = v2_tokens.get(addr, {})
            v1d = v1_daily.get(addr, {})
            v2d = v2_daily.get(addr, {})
            dx = dx_data.get(addr, {})
            cg = cg_data.get(addr, {})
            op = op_data.get(addr, {})

            # V1 values
            v1_price = v1.get("derived_usd", 0)
            v1_derived = v1.get("derived_usd", 0)
            v1_vol_alltime = v1.get("trade_volume_usd", 0)
            v1_vol_24h = v1d.get("daily_volume_usd", 0)
            v1_liq_tokens = v1.get("total_liquidity", 0)
            v1_liq_usd = v1d.get("total_liquidity_usd", 0)
            v1_supply = v1.get("total_supply", 0)
            v1_mcap = v1_derived * v1_supply if v1_derived and v1_supply else 0

            # V2 values
            v2_price = v2.get("derived_usd", 0)
            v2_derived = v2.get("derived_usd", 0)
            v2_vol_alltime = v2.get("trade_volume_usd", 0)
            v2_vol_24h = v2d.get("daily_volume_usd", 0)
            v2_liq_tokens = v2.get("total_liquidity", 0)
            v2_liq_usd = v2d.get("total_liquidity_usd", 0)
            v2_supply = v2.get("total_supply", 0)
            v2_mcap = v2_derived * v2_supply if v2_derived and v2_supply else 0

            # Combined V1+V2
            combined_price = v1_price or v2_price  # V1 preferred
            combined_vol = v1_vol_24h + v2_vol_24h
            combined_liq = v1_liq_usd + v2_liq_usd
            best_supply = max(v1_supply, v2_supply)
            combined_mcap = combined_price * best_supply if combined_price and best_supply else 0

            # OpenPulsechain displayed
            op_price = op.get("price_usd")
            op_vol = op.get("volume_24h_usd")
            op_liq = op.get("liquidity_usd")
            op_mcap = op.get("market_cap_usd")
            op_change = op.get("change_24h_pct")
            op_price_source = op.get("source", "unknown")

            # DexScreener
            dx_price = dx.get("price_usd")
            dx_vol = dx.get("volume_24h_usd")
            dx_liq = dx.get("liquidity_usd")
            dx_fdv = dx.get("fdv")
            dx_mcap = dx.get("market_cap_usd")
            dx_change = dx.get("change_24h_pct")
            dx_pair_count = dx.get("pair_count")
            dx_dex_list = dx.get("dex_list")

            # CoinGecko
            cg_price = cg.get("price_usd")
            cg_vol = cg.get("volume_24h_usd")
            cg_mcap_val = cg.get("market_cap_usd")
            cg_change = cg.get("change_24h_pct")
            cg_id = cg.get("cg_id")

            # --- Coherence scores (vs DexScreener as source of truth) ---
            # OP vs DX
            op_coh_price = _coherence_score(op_price, dx_price)
            op_coh_vol = _coherence_score(op_vol, dx_vol)
            op_coh_liq = _coherence_score(op_liq, dx_liq)
            op_coh_mcap = _coherence_score(op_mcap, dx_mcap or dx_fdv)
            op_coh_global = _compute_global_coherence(op_coh_price, op_coh_vol, op_coh_liq, op_coh_mcap)

            # CG vs DX
            cg_coh_price = _coherence_score(cg_price, dx_price)
            cg_coh_vol = _coherence_score(cg_vol, dx_vol)
            cg_coh_mcap = _coherence_score(cg_mcap_val, dx_mcap or dx_fdv)
            cg_coh_global = _compute_global_coherence(cg_coh_price, cg_coh_vol, 0, cg_coh_mcap)

            # Combined V1+V2 vs DX
            comb_coh_vol = _coherence_score(combined_vol, dx_vol)
            comb_coh_liq = _coherence_score(combined_liq, dx_liq)
            comb_coh_mcap = _coherence_score(combined_mcap, dx_mcap or dx_fdv)
            comb_coh_global = _compute_global_coherence(
                _coherence_score(combined_price, dx_price), comb_coh_vol, comb_coh_liq, comb_coh_mcap
            )

            # --- Anomaly flags ---
            flag_mcap_broken = False
            if dx_mcap and op_mcap and dx_mcap > 0:
                ratio = op_mcap / dx_mcap
                flag_mcap_broken = ratio > 10 or ratio < 0.1

            flag_vol_under = False
            if dx_vol and op_vol and dx_vol > 0:
                flag_vol_under = (op_vol / dx_vol) < 0.5

            flag_liq_under = False
            if dx_liq and op_liq and dx_liq > 0:
                flag_liq_under = (op_liq / dx_liq) < 0.5

            flag_price_div = False
            if dx_price and op_price and dx_price > 0:
                flag_price_div = abs(op_price - dx_price) / dx_price > 0.05

            flag_v2_dominant = False
            if combined_vol > 0 and v2_vol_24h > 0:
                flag_v2_dominant = (v2_vol_24h / combined_vol) > 0.5

            # Coherence details JSON
            coherence_details = {}
            if dx_price and op_price and dx_price > 0:
                coherence_details["price_diff_pct"] = round((op_price - dx_price) / dx_price * 100, 2)
            if dx_vol and op_vol and dx_vol > 0:
                coherence_details["volume_diff_pct"] = round((op_vol - dx_vol) / dx_vol * 100, 2)
            if dx_liq and op_liq and dx_liq > 0:
                coherence_details["liquidity_diff_pct"] = round((op_liq - dx_liq) / dx_liq * 100, 2)
            if (dx_mcap or dx_fdv) and op_mcap:
                ref = dx_mcap or dx_fdv
                if ref > 0:
                    coherence_details["mcap_diff_pct"] = round((op_mcap - ref) / ref * 100, 2)

            # Pool stats for this token
            token_pools = all_pools.get(addr, [])
            pool_total = len(token_pools)
            pool_legit = sum(1 for p in token_pools if p.get("pool_is_legitimate"))
            pool_dx = sum(1 for p in token_pools if p.get("data_source") in ("both", "dexscreener"))

            # Data sources tracking
            sources = []
            if v1: sources.append("v1")
            if v2: sources.append("v2")
            if dx: sources.append("dexscreener")
            if cg: sources.append("coingecko")

            row = {
                "snapshot_at": now,
                "token_address": addr,
                "token_symbol": meta.get("symbol") or op.get("symbol"),
                "token_name": meta.get("name") or op.get("name"),
                "token_type": op.get("token_type"),

                # OpenPulsechain displayed
                "op_price_usd": op_price,
                "op_price_source": op_price_source,
                "op_volume_24h_usd": op_vol,
                "op_volume_source": "pulsex_v1_tokenDayDatas" if op_price_source == "pulsex_subgraph" else op_price_source,
                "op_liquidity_usd": op_liq,
                "op_liquidity_source": "token_discovery" if op_liq else None,
                "op_market_cap_usd": op_mcap,
                "op_mcap_source": "pulsex_v1_derivedUSD*totalSupply" if op_mcap else None,
                "op_mcap_supply_used": v1_supply if op_mcap else None,
                "op_change_24h_pct": op_change,
                "op_holder_count": op.get("holder_count"),
                "op_holder_source": "blockscout_api_v2" if op.get("holder_count") else None,
                "op_has_logo": op.get("has_logo", False),
                "op_safety_score": op.get("safety_score"),
                "op_safety_grade": op.get("safety_grade"),
                "op_category": op.get("token_type"),

                # V1
                "v1_price_usd": v1_price or None,
                "v1_derived_usd": v1_derived or None,
                "v1_volume_alltime_usd": v1_vol_alltime or None,
                "v1_volume_24h_usd": v1_vol_24h or None,
                "v1_liquidity_tokens": v1_liq_tokens or None,
                "v1_liquidity_usd": v1_liq_usd or None,
                "v1_total_supply": v1_supply or None,
                "v1_market_cap_usd": v1_mcap or None,

                # V2
                "v2_price_usd": v2_price or None,
                "v2_derived_usd": v2_derived or None,
                "v2_volume_alltime_usd": v2_vol_alltime or None,
                "v2_volume_24h_usd": v2_vol_24h or None,
                "v2_liquidity_tokens": v2_liq_tokens or None,
                "v2_liquidity_usd": v2_liq_usd or None,
                "v2_total_supply": v2_supply or None,
                "v2_market_cap_usd": v2_mcap or None,

                # Combined V1+V2
                "combined_price_usd": combined_price or None,
                "combined_volume_24h_usd": combined_vol or None,
                "combined_liquidity_usd": combined_liq or None,
                "combined_market_cap_usd": combined_mcap or None,

                # DexScreener
                "dx_price_usd": dx_price,
                "dx_volume_24h_usd": dx_vol,
                "dx_liquidity_usd": dx_liq,
                "dx_fdv": dx_fdv,
                "dx_market_cap_usd": dx_mcap,
                "dx_change_24h_pct": dx_change,
                "dx_pair_count": dx_pair_count,
                "dx_dex_list": dx_dex_list,

                # CoinGecko
                "cg_price_usd": cg_price,
                "cg_volume_24h_usd": cg_vol,
                "cg_market_cap_usd": cg_mcap_val,
                "cg_change_24h_pct": cg_change,
                "cg_id": cg_id,

                # Coherence scores
                "op_coherence_global": op_coh_global,
                "op_coherence_price": op_coh_price,
                "op_coherence_volume": op_coh_vol,
                "op_coherence_liquidity": op_coh_liq,
                "op_coherence_mcap": op_coh_mcap,
                "op_coherence_details": coherence_details if coherence_details else None,

                "cg_coherence_global": cg_coh_global if cg_price else None,
                "cg_coherence_price": cg_coh_price if cg_price else None,
                "cg_coherence_volume": cg_coh_vol if cg_vol else None,
                "cg_coherence_mcap": cg_coh_mcap if cg_mcap_val else None,

                "combined_coherence_global": comb_coh_global,
                "combined_coherence_volume": comb_coh_vol,
                "combined_coherence_liquidity": comb_coh_liq,
                "combined_coherence_mcap": comb_coh_mcap,

                # Flags
                "flag_mcap_broken": flag_mcap_broken,
                "flag_volume_underreported": flag_vol_under,
                "flag_liquidity_underreported": flag_liq_under,
                "flag_price_divergent": flag_price_div,
                "flag_v2_dominant": flag_v2_dominant,
                "flag_no_logo": not op.get("has_logo", False),
                "flag_no_sparkline": False,  # TODO: check sparkline availability

                # Freshness tracking
                "v1_subgraph_block": v1_block,
                "v2_subgraph_block": v2_block,
                "dx_data_age_seconds": None,  # DexScreener doesn't expose this directly
                "is_stale": False,  # TODO: compare block numbers with chain head
                "data_sources": sources,
                "pool_count_total": pool_total,
                "pool_count_legitimate": pool_legit,
                "pool_count_dexscreener": pool_dx,
            }

            rows.append(row)

        # 4. Upsert into database
        if rows:
            for i in range(0, len(rows), 50):
                batch = rows[i:i + 50]
                supabase.table("token_monitoring").upsert(
                    batch, on_conflict="token_address,snapshot_at"
                ).execute()

            logger.info(f"Inserted {len(rows)} token monitoring snapshots")

            # 5. Build and insert pool rows
            pool_rows = []
            for addr in addresses:
                token_pools = all_pools.get(addr, [])
                if not token_pools:
                    continue

                # Fetch 24h volumes for pools of this token
                v1_pair_addrs = [p["pair_address"] for p in token_pools if p["dex_version"] == "pulsex_v1"]
                v2_pair_addrs = [p["pair_address"] for p in token_pools if p["dex_version"] == "pulsex_v2"]
                v1_vols = _fetch_pool_daily_volumes(v1_pair_addrs, PULSEX_SUBGRAPH_V1) if v1_pair_addrs else {}
                v2_vols = _fetch_pool_daily_volumes(v2_pair_addrs, PULSEX_SUBGRAPH_V2) if v2_pair_addrs else {}
                pair_vols = {**v1_vols, **v2_vols}

                # Calculate totals for % computation (DexScreener preferred)
                total_liq = sum(
                    (p.get("dx_liquidity_usd") or p.get("reserve_usd") or 0)
                    for p in token_pools if p.get("pool_is_legitimate")
                )
                total_vol = sum(
                    (p.get("dx_volume_24h_usd") or pair_vols.get(p["pair_address"], 0))
                    for p in token_pools if p.get("pool_is_legitimate")
                )

                for pool in token_pools:
                    vol_24h = pair_vols.get(pool["pair_address"], 0)
                    reserve = pool.get("reserve_usd", 0)

                    # Best volume: DexScreener > subgraph pairDayDatas
                    best_vol_24h = pool.get("dx_volume_24h_usd") or vol_24h or 0
                    # Best liquidity: DexScreener > subgraph reserveUSD
                    best_liq = pool.get("dx_liquidity_usd") or reserve or 0

                    pool_rows.append({
                        "snapshot_at": now,
                        "token_address": addr,
                        "pair_address": pool["pair_address"],
                        "dex_version": pool.get("dex_version") or pool.get("dx_dex_id", "unknown"),
                        "token0_address": pool["token0_address"],
                        "token0_symbol": pool.get("token0_symbol"),
                        "token0_name": pool.get("token0_name"),
                        "token0_decimals": pool.get("token0_decimals"),
                        "token1_address": pool["token1_address"],
                        "token1_symbol": pool.get("token1_symbol"),
                        "token1_name": pool.get("token1_name"),
                        "token1_decimals": pool.get("token1_decimals"),
                        "reserve0": pool.get("reserve0"),
                        "reserve1": pool.get("reserve1"),
                        "reserve_usd": reserve,
                        "volume_alltime_usd": pool.get("volume_alltime_usd"),
                        "volume_24h_usd": vol_24h or None,
                        "total_transactions": pool.get("total_transactions"),
                        "created_at_ts": pool.get("created_at_ts"),
                        # DexScreener per-pair enrichment
                        "dx_pair_address": pool.get("dx_pair_address"),
                        "dx_price_usd": pool.get("dx_price_usd"),
                        "dx_volume_24h_usd": pool.get("dx_volume_24h_usd"),
                        "dx_liquidity_usd": pool.get("dx_liquidity_usd"),
                        "dx_dex_id": pool.get("dx_dex_id"),
                        "dx_buys_24h": pool.get("dx_buys_24h"),
                        "dx_sells_24h": pool.get("dx_sells_24h"),
                        "dx_txns_24h": pool.get("dx_txns_24h"),
                        "dx_fdv": pool.get("dx_fdv"),
                        "dx_market_cap_usd": pool.get("dx_market_cap_usd"),
                        "dx_price_change_24h_pct": pool.get("dx_price_change_24h_pct"),
                        "dx_liquidity_base": pool.get("dx_liquidity_base"),
                        "dx_liquidity_quote": pool.get("dx_liquidity_quote"),
                        "dx_base_token_address": pool.get("dx_base_token_address"),
                        "dx_base_token_symbol": pool.get("dx_base_token_symbol"),
                        "dx_quote_token_address": pool.get("dx_quote_token_address"),
                        "dx_quote_token_symbol": pool.get("dx_quote_token_symbol"),
                        "dx_pair_created_at": pool.get("dx_pair_created_at"),
                        "dx_url": pool.get("dx_url"),
                        # Calculated
                        "implied_price_usd": pool.get("implied_price_usd"),
                        "price_vs_consensus_pct": pool.get("price_vs_consensus_pct"),
                        "data_source": pool.get("data_source", "subgraph"),
                        # Validation anti-spam
                        "token0_is_known": pool.get("token0_is_known", False),
                        "token0_is_core": pool.get("token0_is_core", False),
                        "token0_volume_usd": pool.get("token0_volume_usd"),
                        "token0_has_liquidity": pool.get("token0_has_liquidity", False),
                        "token1_is_known": pool.get("token1_is_known", False),
                        "token1_is_core": pool.get("token1_is_core", False),
                        "token1_volume_usd": pool.get("token1_volume_usd"),
                        "token1_has_liquidity": pool.get("token1_has_liquidity", False),
                        "pool_is_legitimate": pool.get("pool_is_legitimate", False),
                        "pool_spam_reason": pool.get("pool_spam_reason"),
                        "pool_confidence": pool.get("pool_confidence", "suspect"),
                        "pool_risk_score": pool.get("pool_risk_score"),
                        "pct_of_total_liquidity": round(best_liq / total_liq * 100, 2) if total_liq > 0 and best_liq > 0 else None,
                        "pct_of_total_volume": round(best_vol_24h / total_vol * 100, 2) if total_vol > 0 and best_vol_24h > 0 else None,
                    })

            if pool_rows:
                for i in range(0, len(pool_rows), 50):
                    batch = pool_rows[i:i + 50]
                    supabase.table("token_monitoring_pools").upsert(
                        batch, on_conflict="token_address,pair_address,snapshot_at"
                    ).execute()
                logger.info(f"Inserted {len(pool_rows)} pool snapshots ({legit_pools} legitimate)")

            # 5b. Log confidence transitions (P1-E: Finding #8)
            _log_confidence_transitions(all_pools, now)

            # 6. Detect pool lifecycle events (new/removed/liq changes)
            logger.info("  Detecting pool events (diff vs previous snapshot)...")
            pool_events = _detect_pool_events(addresses, all_pools, now)
            if pool_events:
                for i in range(0, len(pool_events), 50):
                    batch = pool_events[i:i + 50]
                    supabase.table("token_pool_events").upsert(
                        batch, on_conflict="token_address,pair_address,event_type,curr_snapshot_at"
                    ).execute()
                # Summary by event type
                from collections import Counter
                evt_counts = Counter(e["event_type"] for e in pool_events)
                logger.info(f"  Pool events: {len(pool_events)} total — {dict(evt_counts)}")
            else:
                logger.info("  Pool events: none detected (stable or first run)")

            # Log anomaly summary
            anomalies = {
                "mcap_broken": sum(1 for r in rows if r["flag_mcap_broken"]),
                "vol_underreported": sum(1 for r in rows if r["flag_volume_underreported"]),
                "liq_underreported": sum(1 for r in rows if r["flag_liquidity_underreported"]),
                "price_divergent": sum(1 for r in rows if r["flag_price_divergent"]),
                "v2_dominant": sum(1 for r in rows if r["flag_v2_dominant"]),
            }
            logger.info(f"Anomalies: {anomalies}")

            # Log coherence summary
            scores = [r["op_coherence_global"] for r in rows if r["op_coherence_global"] is not None]
            if scores:
                avg = sum(scores) / len(scores)
                logger.info(f"Average OP coherence: {avg:.0f}/100 ({len(scores)} tokens scored)")

        supabase.table("sync_status").upsert({
            "indexer_name": "token_monitoring",
            "status": "idle",
            "last_synced_at": now,
            "records_synced": len(rows),
            "error_message": None,
        }, on_conflict="indexer_name").execute()

        logger.info(f"Token monitoring complete: {len(rows)} tokens processed")

    except Exception as e:
        supabase.table("sync_status").upsert({
            "indexer_name": "token_monitoring",
            "status": "error",
            "error_message": str(e)[:500],
        }, on_conflict="indexer_name").execute()
        raise
