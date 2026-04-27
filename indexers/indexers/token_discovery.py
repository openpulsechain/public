"""Token discovery indexer — discovers PulseChain tokens from PulseX subgraph.

Fetches all tokens with meaningful trade volume, filters spam,
and stores in pulsechain_tokens table.
"""

import logging
import time
from datetime import datetime, timezone

import requests

from db import supabase
from config import SUBGRAPH_PAGE_SIZE, PULSEX_SUBGRAPH_V1, PULSEX_SUBGRAPH_V2

logger = logging.getLogger(__name__)

PULSEX_SUBGRAPH = PULSEX_SUBGRAPH_V1

# Minimum thresholds to filter spam tokens
MIN_VOLUME_USD = 10_000  # $10K lifetime volume
MIN_LIQUIDITY_TOKENS = 1  # Must have some liquidity

# Known core tokens (always included regardless of filters)
CORE_TOKENS = {
    "0xa1077a294dde1b09bb078844df40758a5d0f9a27",  # WPLS
    "0x95b303987a60c71504d99aa1b13b4da07b0790ab",  # PLSX
    "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",  # HEX
    "0x2fa878ab3f87cc1c9737fc071108f904c0b0c95d",  # INC
    "0x02dcdd04e3f455d838cd1249292c58f3b79e3c3c",  # WETH
    "0xefd766ccb38eaf1dfd701853bfce31359239f305",  # DAI (bridged)
    "0x15d38573d2feeb82e7ad5187ab8c1d52810b1f07",  # USDC (bridged)
    "0x0cb6f5a34ad42ec934882a05265a7d5f59b51a2f",  # USDT (bridged)
    "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",  # WBTC
}


def _query_subgraph(query: str) -> dict:
    """Execute a GraphQL query against PulseX subgraph."""
    resp = requests.post(
        PULSEX_SUBGRAPH,
        json={"query": query},
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()
    if "errors" in data:
        raise ValueError(f"Subgraph error: {data['errors']}")
    return data["data"]


def _fetch_all_tokens() -> list[dict]:
    """Paginate through all tokens with meaningful volume using id-based pagination."""
    all_tokens = []
    last_id = ""

    for _ in range(20):  # Max 20 pages
        where = f'tradeVolumeUSD_gt: "{MIN_VOLUME_USD}"'
        if last_id:
            where += f', id_gt: "{last_id}"'

        query = f"""{{
            tokens(
                first: {SUBGRAPH_PAGE_SIZE},
                where: {{{where}}},
                orderBy: id,
                orderDirection: asc
            ) {{
                id
                symbol
                name
                decimals
                tradeVolumeUSD
                totalLiquidity
                derivedUSD
            }}
        }}"""

        data = _query_subgraph(query)
        tokens = data.get("tokens", [])
        if not tokens:
            break

        all_tokens.extend(tokens)
        last_id = tokens[-1]["id"]
        logger.info(f"  Fetched {len(tokens)} tokens (total: {len(all_tokens)})")

        if len(tokens) < SUBGRAPH_PAGE_SIZE:
            break

        time.sleep(0.5)

    return all_tokens


def _is_valid_token(token: dict) -> bool:
    """Filter out spam/dead tokens."""
    addr = token["id"].lower()

    # Always include core tokens
    if addr in CORE_TOKENS:
        return True

    # Filter tokens with zero liquidity
    liquidity = float(token.get("totalLiquidity", 0))
    if liquidity < MIN_LIQUIDITY_TOKENS:
        return False

    # Filter tokens with suspicious names (common spam patterns)
    name = token.get("name", "").lower()
    spam_keywords = ["fuck", "shit", "scam", "rug", "test", "fake"]
    if any(kw in name for kw in spam_keywords):
        return False

    return True


def _fetch_all_tokens_v2() -> list[dict]:
    """Paginate through V2 tokens with meaningful volume."""
    all_tokens = []
    last_id = ""

    for _ in range(20):
        where = f'tradeVolumeUSD_gt: "{MIN_VOLUME_USD}"'
        if last_id:
            where += f', id_gt: "{last_id}"'

        query = f"""{{
            tokens(
                first: {SUBGRAPH_PAGE_SIZE},
                where: {{{where}}},
                orderBy: id,
                orderDirection: asc
            ) {{
                id
                symbol
                name
                decimals
                tradeVolumeUSD
                totalLiquidity
                derivedUSD
            }}
        }}"""

        try:
            resp = requests.post(
                PULSEX_SUBGRAPH_V2,
                json={"query": query},
                timeout=60,
            )
            resp.raise_for_status()
            data = resp.json()
            if "errors" in data:
                break
            tokens = data.get("data", {}).get("tokens", [])
        except Exception as e:
            logger.warning(f"V2 token fetch failed: {e}")
            break

        if not tokens:
            break

        all_tokens.extend(tokens)
        last_id = tokens[-1]["id"]

        if len(tokens) < SUBGRAPH_PAGE_SIZE:
            break
        time.sleep(0.5)

    return all_tokens


def run():
    logger.info("Discovering PulseChain tokens from PulseX V1+V2 subgraphs...")

    supabase.table("sync_status").upsert({
        "indexer_name": "token_discovery",
        "status": "running",
    }, on_conflict="indexer_name").execute()

    try:
        # Fetch from V1
        raw_tokens_v1 = _fetch_all_tokens()
        logger.info(f"V1: {len(raw_tokens_v1)} tokens with >${MIN_VOLUME_USD:,} volume")

        # Fetch from V2
        raw_tokens_v2 = _fetch_all_tokens_v2()
        logger.info(f"V2: {len(raw_tokens_v2)} tokens with >${MIN_VOLUME_USD:,} volume")

        # Combine: merge by address, sum volumes and liquidity
        token_map: dict[str, dict] = {}

        for t in raw_tokens_v1:
            if not _is_valid_token(t):
                continue
            addr = t["id"].lower()
            total_liq = float(t.get("totalLiquidity", 0))
            derived_usd = float(t.get("derivedUSD", 0))
            token_map[addr] = {
                "address": addr,
                "symbol": t["symbol"],
                "name": t["name"],
                "decimals": int(t["decimals"]),
                "total_volume_usd": float(t["tradeVolumeUSD"]),
                "total_liquidity": total_liq,
                "derived_usd": derived_usd,
            }

        for t in raw_tokens_v2:
            if not _is_valid_token(t):
                continue
            addr = t["id"].lower()
            total_liq = float(t.get("totalLiquidity", 0))
            derived_usd = float(t.get("derivedUSD", 0))
            v2_volume = float(t["tradeVolumeUSD"])

            if addr in token_map:
                # Merge: sum volume and liquidity, keep V1 price (or V2 if V1=0)
                token_map[addr]["total_volume_usd"] += v2_volume
                token_map[addr]["total_liquidity"] += total_liq
                if token_map[addr]["derived_usd"] <= 0 and derived_usd > 0:
                    token_map[addr]["derived_usd"] = derived_usd
            else:
                token_map[addr] = {
                    "address": addr,
                    "symbol": t["symbol"],
                    "name": t["name"],
                    "decimals": int(t["decimals"]),
                    "total_volume_usd": v2_volume,
                    "total_liquidity": total_liq,
                    "derived_usd": derived_usd,
                }

        logger.info(f"After V1+V2 merge and filtering: {len(token_map)} valid tokens")

        now = datetime.now(timezone.utc).isoformat()
        rows = []
        # Cap: subgraph totalLiquidity × derivedUSD is unreliable for spam tokens.
        # Real liquidity is computed by lp_analyzer with bilateral filtering.
        # This cap prevents absurd values (e.g., SQP at $1.7 quadrillion).
        MAX_LIQUIDITY_USD = 50_000_000  # $50M cap — no PulseChain token has more
        for t in token_map.values():
            total_liq = t["total_liquidity"]
            derived_usd = t["derived_usd"]
            total_liq_usd = total_liq * derived_usd if total_liq > 0 and derived_usd > 0 else None
            if total_liq_usd is not None and total_liq_usd > MAX_LIQUIDITY_USD:
                total_liq_usd = None  # Mark as unreliable — lp_analyzer provides the real value

            rows.append({
                "address": t["address"],
                "symbol": t["symbol"],
                "name": t["name"],
                "decimals": t["decimals"],
                "total_volume_usd": t["total_volume_usd"],
                "total_liquidity": total_liq,
                "total_liquidity_usd": total_liq_usd,
                "is_active": True,
                "updated_at": now,
            })

        # Upsert in batches
        if rows:
            for i in range(0, len(rows), 500):
                supabase.table("pulsechain_tokens").upsert(
                    rows[i:i + 500], on_conflict="address"
                ).execute()

        supabase.table("sync_status").upsert({
            "indexer_name": "token_discovery",
            "status": "idle",
            "last_synced_at": now,
            "records_synced": len(rows),
            "error_message": None,
        }, on_conflict="indexer_name").execute()

        logger.info(f"Synced {len(rows)} tokens to pulsechain_tokens (V1+V2)")

    except Exception as e:
        supabase.table("sync_status").upsert({
            "indexer_name": "token_discovery",
            "status": "error",
            "error_message": str(e)[:500],
        }, on_conflict="indexer_name").execute()
        raise
