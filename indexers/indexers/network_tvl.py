"""Network TVL indexer — fetches PulseChain TVL history from DefiLlama."""

import logging
from datetime import datetime, timezone

import requests

from db import supabase
from config import DEFILLAMA_CHAIN_TVL
from utils.retry import with_retry

logger = logging.getLogger(__name__)


def run():
    logger.info("Fetching PulseChain TVL from DefiLlama...")

    supabase.table("sync_status").update({
        "status": "running",
    }).eq("indexer_name", "network_tvl").execute()

    try:
        data = with_retry(lambda: requests.get(DEFILLAMA_CHAIN_TVL, timeout=30).json())

        if not isinstance(data, list):
            logger.warning("Unexpected DefiLlama TVL response format")
            return

        # Get last synced date to only insert new records
        last = supabase.table("network_tvl_history") \
            .select("date") \
            .order("date", desc=True) \
            .limit(1) \
            .execute()

        last_date = last.data[0]["date"] if last.data else "2023-01-01"
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        rows = []
        for point in data:
            ts = point.get("date", 0)
            tvl = point.get("tvl", 0)
            date_str = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")

            if date_str > last_date and date_str <= today:
                rows.append({
                    "date": date_str,
                    "tvl_usd": tvl,
                    "source": "defillama",
                })

        if rows:
            # Batch upsert
            for i in range(0, len(rows), 500):
                supabase.table("network_tvl_history").upsert(
                    rows[i:i + 500], on_conflict="date"
                ).execute()

        supabase.table("sync_status").update({
            "status": "idle",
            "last_synced_at": datetime.now(timezone.utc).isoformat(),
            "records_synced": len(rows),
            "error_message": None,
        }).eq("indexer_name", "network_tvl").execute()

        logger.info(f"Synced {len(rows)} TVL data points")

    except Exception as e:
        supabase.table("sync_status").update({
            "status": "error",
            "error_message": str(e)[:500],
        }).eq("indexer_name", "network_tvl").execute()
        raise
