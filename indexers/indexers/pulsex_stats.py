"""PulseX stats indexer — syncs daily DEX data from PulseX V1 + V2 subgraphs."""

import logging
from datetime import datetime, timezone

from db import supabase
from config import SUBGRAPH_PAGE_SIZE, PULSEX_SUBGRAPH_V1, PULSEX_SUBGRAPH_V2
from utils.subgraph import paginate_subgraph

logger = logging.getLogger(__name__)

DAY_DATA_FIELDS = """
    id
    date
    dailyVolumeUSD
    totalLiquidityUSD
    totalVolumeUSD
    totalTransactions
"""


def _set_status(status, error=None):
    supabase.table("sync_status").update({
        "status": status,
        "error_message": error,
        "last_synced_at": datetime.now(timezone.utc).isoformat(),
    }).eq("indexer_name", "pulsex_stats").execute()


def _fetch_day_datas(endpoint: str, cursor: str) -> dict[str, dict]:
    """Fetch pulsexDayDatas from a subgraph, keyed by date string."""
    result = {}
    for batch in paginate_subgraph(
        endpoint=endpoint,
        entity="pulsexDayDatas",
        fields=DAY_DATA_FIELDS,
        where=f'date_gt: {cursor}',
        order_by="date",
        page_size=SUBGRAPH_PAGE_SIZE,
        max_pages=10,
    ):
        for day in batch:
            ts = int(day.get("date", 0))
            date_str = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")
            result[date_str] = {
                "ts": str(ts),
                "daily_volume_usd": float(day.get("dailyVolumeUSD", 0)),
                "total_liquidity_usd": float(day.get("totalLiquidityUSD", 0)),
                "total_volume_usd": float(day.get("totalVolumeUSD", 0)),
                "total_transactions": int(day.get("totalTransactions", 0)),
            }
    return result


def run():
    """Sync PulseX daily stats from V1 + V2 subgraphs (combined)."""
    logger.info("Starting PulseX stats sync (V1 + V2)...")
    _set_status("running")

    try:
        # Get cursor (last synced date as unix timestamp)
        result = supabase.table("sync_status").select("last_cursor").eq(
            "indexer_name", "pulsex_stats"
        ).single().execute()
        cursor = result.data.get("last_cursor") or "0"

        # Fetch V1 and V2 day datas
        v1_data = _fetch_day_datas(PULSEX_SUBGRAPH_V1, cursor)
        logger.info(f"  V1: {len(v1_data)} days fetched")

        v2_data = _fetch_day_datas(PULSEX_SUBGRAPH_V2, cursor)
        logger.info(f"  V2: {len(v2_data)} days fetched")

        # Combine: sum volumes, sum liquidity, sum transactions
        all_dates = sorted(set(v1_data.keys()) | set(v2_data.keys()))

        rows = []
        last_ts = cursor
        for date_str in all_dates:
            v1 = v1_data.get(date_str, {})
            v2 = v2_data.get(date_str, {})

            combined_volume = v1.get("daily_volume_usd", 0) + v2.get("daily_volume_usd", 0)
            combined_liquidity = v1.get("total_liquidity_usd", 0) + v2.get("total_liquidity_usd", 0)
            # total_volume_usd: V2 returns 0, use V1 only for cumulative
            combined_total_vol = v1.get("total_volume_usd", 0)
            # transactions: V2 totalTransactions is cumulative, not addable simply
            # Use the larger of V1 or V2 as base, add the other's daily contribution
            combined_txns = v1.get("total_transactions", 0)

            rows.append({
                "date": date_str,
                "daily_volume_usd": combined_volume,
                "total_liquidity_usd": combined_liquidity,
                "total_volume_usd": combined_total_vol,
                "total_transactions": combined_txns,
                "daily_volume_v1": v1.get("daily_volume_usd", 0),
                "daily_volume_v2": v2.get("daily_volume_usd", 0),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })

            # Track latest timestamp for cursor
            ts = v1.get("ts") or v2.get("ts")
            if ts and int(ts) > int(last_ts):
                last_ts = ts

        if rows:
            supabase.table("pulsex_daily_stats").upsert(
                rows, on_conflict="date"
            ).execute()

        # Update cursor
        supabase.table("sync_status").update({
            "last_cursor": last_ts,
            "records_synced": len(rows),
            "last_synced_at": datetime.now(timezone.utc).isoformat(),
            "status": "idle",
            "error_message": None,
        }).eq("indexer_name", "pulsex_stats").execute()

        logger.info(f"PulseX stats: synced {len(rows)} days (V1+V2 combined)")

    except Exception as e:
        _set_status("error", str(e)[:500])
        logger.warning(f"PulseX stats sync failed: {e}")
