"""
LP (Liquidity Pool) analysis via PulseX Subgraph.
Checks: LP exists, reserve size, deployer LP holdings, pair age.

IMPORTANT: PulseX subgraph reserveUSD is unreliable for spam/dust pairs.
We sort by totalTransactions (not reserveUSD), filter low-txn pairs,
and cross-validate using derivedUSD * reserves.
"""

import logging
import time
import requests
from config import PULSEX_V1_SUBGRAPH, PULSEX_V2_SUBGRAPH

logger = logging.getLogger(__name__)

# Minimum transactions to consider a pair legitimate
MIN_TXNS = 50
# Minimum liquidity per side to count as real (not dust)
MIN_SIDE_USD = 100.0
# Maximum realistic liquidity per pair (safety cap)
MAX_PAIR_USD = 100_000_000  # $100M
# Max liquidity for pairs NOT containing a reference token
MAX_UNANCHORED_PAIR_USD = 50_000  # $50K cap for unanchored pairs

# Reference tokens with verified real-world value.
# Pairs containing at least one of these are "anchored" and trusted.
# Pairs with NO reference token are "unanchored" and capped at $50K.
REFERENCE_TOKENS = {
    "0xa1077a294dde1b09bb078844df40758a5d0f9a27",  # WPLS
    "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",  # HEX
    "0x95b303987a60c71504d99aa1b13b4da07b0790ab",  # PLSX
    "0x2fa878ab3f87cc1c9737fc071108f904c0b0c95d",  # INC
    "0xefd766ccb38eaf1dfd701853bfce31359239f305",  # DAI
    "0x15d38573d2feeb82e7ad5187ab8c1d52810b1f07",  # USDC
    "0x0cb6f5a34ad42ec934882a05265a7d5f59b51a2f",  # USDT
    "0x02dcdd04e3f455d838cd1249292c58f3b79e3c3c",  # WETH
    "0xb17d901469b9208b17d916112988a3fed19b5ca1",  # WBTC
}


def _query_subgraph(url: str, query: str, variables: dict = None) -> dict:
    """Execute a GraphQL query against PulseX subgraph."""
    try:
        resp = requests.post(
            url,
            json={"query": query, "variables": variables or {}},
            timeout=15
        )
        resp.raise_for_status()
        data = resp.json()
        if "errors" in data:
            logger.warning(f"Subgraph errors: {data['errors']}")
        return data.get("data", {})
    except Exception as e:
        logger.warning(f"Subgraph query error: {str(e)[:100]}")
        return {}


def _calc_pair_liquidity(pair: dict) -> float:
    """
    Calculate pair liquidity using derivedUSD × reserves.
    Filters out dust/spam pairs where one side has near-zero real value.

    Applies "anchor check": if neither token in the pair is a reference token
    (WPLS, HEX, PLSX, DAI, USDC, etc.), the pair's liquidity is capped at
    MAX_UNANCHORED_PAIR_USD ($50K). This prevents inflated derivedUSD from
    tokens that only trade against other worthless tokens.
    """
    try:
        r0 = float(pair.get("reserve0", 0) or 0)
        r1 = float(pair.get("reserve1", 0) or 0)
        d0 = float(pair.get("token0", {}).get("derivedUSD", 0) or 0)
        d1 = float(pair.get("token1", {}).get("derivedUSD", 0) or 0)

        side0_usd = r0 * d0
        side1_usd = r1 * d1
        calc_usd = side0_usd + side1_usd

        # Both sides must have meaningful value (> $100).
        if side0_usd < MIN_SIDE_USD or side1_usd < MIN_SIDE_USD:
            return 0.0

        # Reject if total is unreasonably high
        if calc_usd > MAX_PAIR_USD:
            return 0.0

        # Anchor check: is at least one token a reference token?
        t0_addr = pair.get("token0", {}).get("id", "").lower()
        t1_addr = pair.get("token1", {}).get("id", "").lower()
        is_anchored = t0_addr in REFERENCE_TOKENS or t1_addr in REFERENCE_TOKENS

        if not is_anchored and calc_usd > MAX_UNANCHORED_PAIR_USD:
            logger.debug(
                f"Unanchored pair {pair.get('id','?')[:10]} "
                f"({pair.get('token0',{}).get('symbol','?')}/{pair.get('token1',{}).get('symbol','?')}) "
                f"capped: ${calc_usd:,.0f} → ${MAX_UNANCHORED_PAIR_USD:,.0f}"
            )
            return MAX_UNANCHORED_PAIR_USD

        return calc_usd
    except (ValueError, TypeError):
        return 0.0


def analyze_lp(token_address: str) -> dict:
    """
    Analyze liquidity pools for a token.
    Returns:
        {
            "has_lp": bool,
            "total_liquidity_usd": float,
            "pair_count": int,
            "best_pair": {
                "address": str,
                "dex": str,
                "reserve_usd": float,
                "created_at": int (timestamp),
                "age_days": float,
                "total_txns": int,
            } | None,
            "recent_burns": list[dict],  # LP removals in last 24h
            "recent_mints": list[dict],  # LP additions in last 24h
            "error": str | None,
        }
    """
    addr = token_address.lower()
    result = {
        "has_lp": False,
        "total_liquidity_usd": 0.0,
        "pair_count": 0,
        "best_pair": None,
        "recent_burns": [],
        "recent_mints": [],
        "error": None,
    }

    all_pairs = []

    # Query both V1 and V2 — sorted by totalTransactions to get real pairs first
    # Include reserve0/reserve1 + derivedUSD for cross-validation
    pairs_query = """
    query($token: String!) {
        asToken0: pairs(where: {token0: $token}, orderBy: totalTransactions, orderDirection: desc, first: 50) {
            id
            token0 { id symbol derivedUSD }
            token1 { id symbol derivedUSD }
            reserve0
            reserve1
            reserveUSD
            totalTransactions
            timestamp
        }
        asToken1: pairs(where: {token1: $token}, orderBy: totalTransactions, orderDirection: desc, first: 50) {
            id
            token0 { id symbol derivedUSD }
            token1 { id symbol derivedUSD }
            reserve0
            reserve1
            reserveUSD
            totalTransactions
            timestamp
        }
    }
    """

    for dex_name, subgraph_url in [("PulseX_V2", PULSEX_V2_SUBGRAPH), ("PulseX_V1", PULSEX_V1_SUBGRAPH)]:
        data = _query_subgraph(subgraph_url, pairs_query, {"token": addr})
        for pair in (data.get("asToken0", []) + data.get("asToken1", [])):
            pair["_dex"] = dex_name
            all_pairs.append(pair)

    if not all_pairs:
        return result

    # Deduplicate and filter spam pairs (< MIN_TXNS transactions)
    seen = set()
    unique_pairs = []
    for p in all_pairs:
        if p["id"] not in seen:
            seen.add(p["id"])
            txns = int(p.get("totalTransactions", 0) or 0)
            if txns >= MIN_TXNS:
                unique_pairs.append(p)

    if not unique_pairs:
        return result

    result["has_lp"] = True

    # Calculate total liquidity using derivedUSD cross-validation
    total_liq = 0.0
    all_valid_pairs = []
    best = None
    best_reserve = 0.0
    now = int(time.time())

    for p in unique_pairs:
        reserve = _calc_pair_liquidity(p)
        if reserve > 0:
            total_liq += reserve
            t0 = p.get("token0", {})
            t1 = p.get("token1", {})
            created_ts = int(p.get("timestamp", 0) or 0)
            age_days = (now - created_ts) / 86400 if created_ts > 0 else 0
            t0_addr = t0.get("id", "").lower()
            t1_addr = t1.get("id", "").lower()
            anchored = t0_addr in REFERENCE_TOKENS or t1_addr in REFERENCE_TOKENS
            pair_info = {
                "address": p["id"],
                "dex": p["_dex"],
                "reserve_usd": round(reserve, 2),
                "token0_symbol": t0.get("symbol", "?"),
                "token1_symbol": t1.get("symbol", "?"),
                "token0_address": t0.get("id", ""),
                "token1_address": t1.get("id", ""),
                "created_at": created_ts,
                "age_days": round(age_days, 1),
                "total_txns": int(p.get("totalTransactions", 0) or 0),
                "is_anchored": anchored,
            }
            all_valid_pairs.append(pair_info)
            if reserve > best_reserve:
                best_reserve = reserve
                best = pair_info

    # Sort by liquidity descending
    all_valid_pairs.sort(key=lambda x: x["reserve_usd"], reverse=True)

    # Only count pairs with real liquidity (passed bilateral filter)
    result["pair_count"] = len(all_valid_pairs)
    result["total_liquidity_usd"] = round(total_liq, 2)
    result["best_pair"] = best
    result["all_pairs"] = all_valid_pairs

    # Check recent burns (LP removals) and mints across ALL valid pairs (not just best)
    if all_valid_pairs:
        ts_24h_ago = str(now - 86400)
        burns_query = """
        query($pair: String!, $timestamp: String!) {
            burns(where: {pair: $pair, timestamp_gt: $timestamp}, orderBy: timestamp, orderDirection: desc, first: 10) {
                id
                timestamp
                amount0
                amount1
                amountUSD
                sender
                to
            }
        }
        """
        mints_query = """
        query($pair: String!, $timestamp: String!) {
            mints(where: {pair: $pair, timestamp_gt: $timestamp}, orderBy: timestamp, orderDirection: desc, first: 10) {
                id
                timestamp
                amount0
                amount1
                amountUSD
                sender
                to
            }
        }
        """

        all_burns = []
        all_mints = []
        seen_burn_ids = set()
        seen_mint_ids = set()

        for pair_info in all_valid_pairs:
            subgraph_url = PULSEX_V2_SUBGRAPH if pair_info["dex"] == "PulseX_V2" else PULSEX_V1_SUBGRAPH
            variables = {"pair": pair_info["address"], "timestamp": ts_24h_ago}

            burn_data = _query_subgraph(subgraph_url, burns_query, variables)
            for b in burn_data.get("burns", []):
                if b["id"] not in seen_burn_ids:
                    seen_burn_ids.add(b["id"])
                    b["_pair"] = pair_info["address"]
                    all_burns.append(b)

            mint_data = _query_subgraph(subgraph_url, mints_query, variables)
            for m in mint_data.get("mints", []):
                if m["id"] not in seen_mint_ids:
                    seen_mint_ids.add(m["id"])
                    m["_pair"] = pair_info["address"]
                    all_mints.append(m)

        # Sort by timestamp descending
        all_burns.sort(key=lambda x: int(x.get("timestamp", 0)), reverse=True)
        all_mints.sort(key=lambda x: int(x.get("timestamp", 0)), reverse=True)

        result["recent_burns"] = all_burns
        result["recent_mints"] = all_mints

    return result
