"""Bridge aggregator — computes daily stats and token stats from bridge_transfers."""

import logging
from datetime import datetime, timezone, timedelta

from db import supabase

logger = logging.getLogger(__name__)


def _set_status(status, error=None):
    supabase.table("sync_status").update({
        "status": status,
        "error_message": error,
        "last_synced_at": datetime.now(timezone.utc).isoformat(),
    }).eq("indexer_name", "bridge_aggregator").execute()


def _aggregate_daily():
    """Compute bridge_daily_stats from bridge_transfers.
    Aggregates last 90 days directly to avoid PostgREST 1000-row RPC truncation (bug #13)."""
    from collections import defaultdict

    since = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
    daily = defaultdict(lambda: {"dep_c": 0, "wdr_c": 0, "dep_v": 0.0, "wdr_v": 0.0, "users": set()})

    offset = 0
    page_size = 1000
    total = 0

    while True:
        result = (supabase.table("bridge_transfers")
                  .select("direction,amount_usd,user_address,block_timestamp")
                  .gte("block_timestamp", since)
                  .order("block_timestamp")
                  .range(offset, offset + page_size - 1)
                  .execute())
        rows = result.data if hasattr(result, "data") and result.data else []
        if not rows:
            break
        total += len(rows)
        for r in rows:
            ts = (r.get("block_timestamp") or "")[:10]
            if not ts:
                continue
            d = daily[ts]
            if r["direction"] == "deposit":
                d["dep_c"] += 1
                d["dep_v"] += float(r.get("amount_usd") or 0)
            else:
                d["wdr_c"] += 1
                d["wdr_v"] += float(r.get("amount_usd") or 0)
            if r.get("user_address"):
                d["users"].add(r["user_address"])
        if len(rows) < page_size:
            break
        offset += page_size

    if daily:
        now = datetime.now(timezone.utc).isoformat()
        MAX_DAILY_VOLUME_USD = 10_000_000
        upsert_rows = []
        for date, d in sorted(daily.items()):
            dep_vol = min(d["dep_v"], MAX_DAILY_VOLUME_USD)
            wdr_vol = min(d["wdr_v"], MAX_DAILY_VOLUME_USD)
            upsert_rows.append({
                "date": date,
                "deposit_count": d["dep_c"],
                "withdrawal_count": d["wdr_c"],
                "deposit_volume_usd": round(dep_vol, 2),
                "withdrawal_volume_usd": round(wdr_vol, 2),
                "net_flow_usd": round(dep_vol - wdr_vol, 2),
                "unique_users": len(d["users"]),
                "updated_at": now,
            })
        for i in range(0, len(upsert_rows), 500):
            supabase.table("bridge_daily_stats").upsert(
                upsert_rows[i:i + 500], on_conflict="date"
            ).execute()
        logger.info(f"Aggregated {len(upsert_rows)} daily stats from {total} transfers (last 90 days)")
    else:
        logger.info("No bridge transfers found for aggregation")


def _aggregate_tokens():
    """Compute bridge_token_stats from bridge_transfers."""
    result = supabase.rpc("get_bridge_token_stats", {}).execute()

    if hasattr(result, "data") and result.data:
        rows = result.data
        now = datetime.now(timezone.utc).isoformat()
        upsert_rows = []
        for row in rows:
            upsert_rows.append({
                "token_address": row["token_address"],
                "token_symbol": row.get("token_symbol"),
                "total_deposit_count": row["deposit_count"],
                "total_withdrawal_count": row["withdrawal_count"],
                "total_deposit_volume_usd": row["deposit_volume_usd"] or 0,
                "total_withdrawal_volume_usd": row["withdrawal_volume_usd"] or 0,
                "net_flow_usd": (row["deposit_volume_usd"] or 0) - (row["withdrawal_volume_usd"] or 0),
                "last_bridge_at": row.get("last_bridge_at"),
                "updated_at": now,
            })
        # Batch upsert (500 at a time)
        for i in range(0, len(upsert_rows), 500):
            supabase.table("bridge_token_stats").upsert(
                upsert_rows[i:i + 500], on_conflict="token_address"
            ).execute()
        logger.info(f"Aggregated {len(rows)} token stats rows")
    else:
        logger.info("No token stats to aggregate (RPC not yet created, skipping)")


def _compute_usd_prices():
    """Compute amount_usd for new transfers using current token prices."""
    result = supabase.rpc("compute_bridge_usd_prices", {}).execute()
    count = result.data if result.data else 0
    if count:
        logger.info(f"Computed USD prices for {count} transfers")


def run():
    """Run all aggregations."""
    logger.info("Starting bridge aggregation...")
    _set_status("running")

    errors = []
    for name, fn in [("usd_prices", _compute_usd_prices), ("daily_stats", _aggregate_daily), ("token_stats", _aggregate_tokens)]:
        try:
            fn()
        except Exception as e:
            logger.warning(f"Bridge aggregation step '{name}' failed: {e}")
            errors.append(f"{name}: {str(e)[:200]}")

    if errors:
        _set_status("error", "; ".join(errors))
    else:
        _set_status("idle")
        logger.info("Bridge aggregation complete")
