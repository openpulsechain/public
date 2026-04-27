from __future__ import annotations

"""Token Pools Live — lightweight DexScreener cache updater.

Fetches live per-pair data from DexScreener API and updates token_pools_live
table in-place (no history). Designed to run frequently via cron.

Tier system to respect DexScreener rate limits (300 req/min):
  - hot:  top 10 tokens by volume  → every 30s
  - warm: top 11-50 tokens         → every 5 min
  - cold: tokens 51+               → every 1 hour

Each run only fetches tokens whose tier is due for refresh.
"""

import logging
import time
from datetime import datetime, timezone, timedelta

import requests

from db import supabase

logger = logging.getLogger(__name__)

DEXSCREENER_API = "https://api.dexscreener.com/latest/dex/tokens"
DEXSCREENER_DELAY = 0.5  # seconds between requests (conservative)

# Tier boundaries
HOT_COUNT = 10
WARM_COUNT = 50  # top 11-50

# Refresh intervals per tier
TIER_INTERVALS = {
    "hot": timedelta(seconds=30),
    "warm": timedelta(minutes=5),
    "cold": timedelta(hours=1),
}


def _assign_tiers() -> dict[str, list[dict]]:
    """Assign tokens to tiers based on volume ranking.

    Returns dict with keys 'hot', 'warm', 'cold' → list of {address, symbol, name}.
    """
    try:
        resp = supabase.table("pulsechain_tokens") \
            .select("address, symbol, name") \
            .eq("is_active", True) \
            .order("total_volume_usd", desc=True) \
            .limit(500) \
            .execute()
    except Exception as e:
        logger.error(f"Failed to fetch tokens for tier assignment: {e}")
        return {"hot": [], "warm": [], "cold": []}

    tokens = resp.data or []
    tiers = {"hot": [], "warm": [], "cold": []}

    for i, t in enumerate(tokens):
        if i < HOT_COUNT:
            tiers["hot"].append(t)
        elif i < WARM_COUNT:
            tiers["warm"].append(t)
        else:
            tiers["cold"].append(t)

    return tiers


def _get_tokens_due_for_refresh(tiers: dict[str, list[dict]]) -> list[tuple[str, dict]]:
    """Determine which tokens need refreshing based on their tier interval.

    Returns list of (tier, token_dict) for tokens that are due.
    """
    now = datetime.now(timezone.utc)
    due = []

    for tier_name, tokens in tiers.items():
        if not tokens:
            continue

        interval = TIER_INTERVALS[tier_name]
        cutoff = (now - interval).isoformat()

        # Check which tokens in this tier were last updated before the cutoff
        addresses = [t["address"].lower() for t in tokens]
        addr_to_meta = {t["address"].lower(): t for t in tokens}

        try:
            # Get last update time for these tokens
            resp = supabase.table("token_pools_live") \
                .select("token_address, updated_at") \
                .in_("token_address", addresses) \
                .execute()

            last_updated = {}
            for row in resp.data or []:
                addr = row["token_address"]
                ts = row["updated_at"]
                # Keep the most recent per token
                if addr not in last_updated or ts > last_updated[addr]:
                    last_updated[addr] = ts

        except Exception:
            # If we can't check, refresh all
            last_updated = {}

        for addr in addresses:
            last = last_updated.get(addr)
            if not last or last < cutoff:
                due.append((tier_name, addr_to_meta[addr]))

    return due


def _fetch_and_upsert(token_address: str, token_symbol: str, token_name: str,
                      tier: str, validation_cache: dict) -> int:
    """Fetch DexScreener pairs for a token and upsert into token_pools_live.

    Returns number of pools upserted.
    """
    try:
        resp = requests.get(
            f"{DEXSCREENER_API}/{token_address}",
            timeout=10,
            headers={"User-Agent": "OpenPulsechain-Live/1.0"},
        )

        if resp.status_code == 429:
            logger.warning("DexScreener rate limited, stopping this run")
            return -1  # Signal to stop

        if resp.status_code != 200:
            return 0

        data = resp.json()
        pairs = data.get("pairs") or []
        pls_pairs = [p for p in pairs if p.get("chainId") == "pulsechain"]

        if not pls_pairs:
            return 0

    except Exception as e:
        logger.warning(f"DexScreener failed for {token_address[:10]}...: {e}")
        return 0

    now = datetime.now(timezone.utc).isoformat()
    rows = []

    for p in pls_pairs:
        pair_addr = (p.get("pairAddress") or "").lower()
        if not pair_addr:
            continue

        txns = p.get("txns", {}).get("h24", {})
        liq = p.get("liquidity", {})
        price_change = p.get("priceChange", {})
        buys = int(txns.get("buys", 0))
        sells = int(txns.get("sells", 0))

        # Get validation from cache (last monitoring snapshot)
        val = validation_cache.get(pair_addr, {})

        rows.append({
            "token_address": token_address,
            "pair_address": pair_addr,
            "updated_at": now,
            "tier": tier,
            "token_symbol": token_symbol,
            "token_name": token_name,
            "dex_id": p.get("dexId", "unknown"),
            "base_token_address": (p.get("baseToken", {}).get("address") or "").lower(),
            "base_token_symbol": p.get("baseToken", {}).get("symbol", ""),
            "quote_token_address": (p.get("quoteToken", {}).get("address") or "").lower(),
            "quote_token_symbol": p.get("quoteToken", {}).get("symbol", ""),
            "price_usd": float(p.get("priceUsd", 0)),
            "volume_24h_usd": float(p.get("volume", {}).get("h24", 0)),
            "liquidity_usd": float(liq.get("usd", 0)),
            "liquidity_base": float(liq.get("base", 0)),
            "liquidity_quote": float(liq.get("quote", 0)),
            "buys_24h": buys,
            "sells_24h": sells,
            "txns_24h": buys + sells,
            "fdv": float(p.get("fdv", 0)),
            "market_cap_usd": float(p.get("marketCap", 0)),
            "price_change_5m": float(price_change.get("m5", 0)),
            "price_change_1h": float(price_change.get("h1", 0)),
            "price_change_6h": float(price_change.get("h6", 0)),
            "price_change_24h": float(price_change.get("h24", 0)),
            "pair_created_at": p.get("pairCreatedAt"),
            "dx_url": p.get("url", ""),
            # Validation from monitoring cache
            "pool_is_legitimate": val.get("pool_is_legitimate", True),
            "pool_confidence": val.get("pool_confidence", "medium"),
            "pool_spam_reason": val.get("pool_spam_reason"),
        })

    if rows:
        try:
            supabase.table("token_pools_live").upsert(
                rows, on_conflict="token_address,pair_address"
            ).execute()
        except Exception as e:
            logger.error(f"Failed to upsert live pools for {token_symbol}: {e}")
            return 0

    return len(rows)


def _load_validation_cache(addresses: list[str]) -> dict[str, dict]:
    """Load pool validation data from the latest monitoring snapshot.

    Returns dict keyed by pair_address → {pool_is_legitimate, pool_confidence, pool_spam_reason}.
    """
    cache = {}

    for i in range(0, len(addresses), 50):
        batch = addresses[i:i + 50]
        try:
            resp = supabase.table("token_monitoring_pools") \
                .select("pair_address, pool_is_legitimate, pool_confidence, pool_spam_reason") \
                .in_("token_address", batch) \
                .order("snapshot_at", desc=True) \
                .execute()

            # Keep first (most recent) per pair_address
            for row in resp.data or []:
                pa = row["pair_address"]
                if pa not in cache:
                    cache[pa] = {
                        "pool_is_legitimate": row["pool_is_legitimate"],
                        "pool_confidence": row["pool_confidence"],
                        "pool_spam_reason": row.get("pool_spam_reason"),
                    }
        except Exception as e:
            logger.warning(f"Failed to load validation cache: {e}")

    return cache


def run():
    logger.info("Running token pools live updater...")

    supabase.table("sync_status").upsert({
        "indexer_name": "token_pools_live",
        "status": "running",
    }, on_conflict="indexer_name").execute()

    try:
        # 1. Assign tiers
        tiers = _assign_tiers()
        logger.info(f"Tiers: hot={len(tiers['hot'])}, warm={len(tiers['warm'])}, cold={len(tiers['cold'])}")

        # 2. Determine which tokens need refresh
        due = _get_tokens_due_for_refresh(tiers)
        if not due:
            logger.info("No tokens due for refresh")
            supabase.table("sync_status").upsert({
                "indexer_name": "token_pools_live",
                "status": "idle",
                "last_synced_at": datetime.now(timezone.utc).isoformat(),
                "records_synced": 0,
            }, on_conflict="indexer_name").execute()
            return

        logger.info(f"Tokens due for refresh: {len(due)}")
        for tier_name in ("hot", "warm", "cold"):
            tier_due = [t for t_name, t in due if t_name == tier_name]
            if tier_due:
                syms = ", ".join(t.get("symbol", "?") for t in tier_due[:10])
                extra = f" +{len(tier_due) - 10} more" if len(tier_due) > 10 else ""
                logger.info(f"  {tier_name}: {len(tier_due)} tokens ({syms}{extra})")

        # 3. Load validation cache for due tokens
        due_addresses = [t["address"].lower() for _, t in due]
        validation_cache = _load_validation_cache(due_addresses)
        logger.info(f"Validation cache: {len(validation_cache)} pairs loaded")

        # 4. Fetch and upsert (in tier priority order: hot first)
        total_pools = 0
        total_tokens = 0

        for tier_name, token in due:
            addr = token["address"].lower()
            sym = token.get("symbol", "?")

            count = _fetch_and_upsert(
                addr, sym, token.get("name", ""),
                tier_name, validation_cache,
            )

            if count == -1:
                # Rate limited — stop immediately
                logger.warning("Rate limited, stopping run early")
                break

            if count > 0:
                total_pools += count
                total_tokens += 1
                logger.debug(f"  {sym}: {count} pools updated ({tier_name})")

            time.sleep(DEXSCREENER_DELAY)

        now = datetime.now(timezone.utc).isoformat()
        supabase.table("sync_status").upsert({
            "indexer_name": "token_pools_live",
            "status": "idle",
            "last_synced_at": now,
            "records_synced": total_pools,
            "error_message": None,
        }, on_conflict="indexer_name").execute()

        logger.info(f"Live update complete: {total_tokens} tokens, {total_pools} pools refreshed")

    except Exception as e:
        supabase.table("sync_status").upsert({
            "indexer_name": "token_pools_live",
            "status": "error",
            "error_message": str(e)[:500],
        }, on_conflict="indexer_name").execute()
        raise
