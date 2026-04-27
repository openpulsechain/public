"""Network DEX volume indexer — fetches PulseChain DEX volume from DefiLlama."""

import logging
from datetime import datetime, timezone

import requests

from db import supabase
from config import DEFILLAMA_DEX_VOLUME
from utils.retry import with_retry

logger = logging.getLogger(__name__)


def run():
    logger.info("Fetching PulseChain DEX volume from DefiLlama...")

    supabase.table("sync_status").update({
        "status": "running",
    }).eq("indexer_name", "network_dex_volume").execute()

    try:
        resp = with_retry(lambda: requests.get(DEFILLAMA_DEX_VOLUME, timeout=30))
        data = resp.json()

        # DefiLlama returns { totalDataChart: [[timestamp, volume], ...], ... }
        chart_data = data.get("totalDataChart", [])

        if not chart_data:
            logger.warning("No DEX volume data from DefiLlama")
            return

        # Get last synced date
        last = supabase.table("network_dex_volume") \
            .select("date") \
            .order("date", desc=True) \
            .limit(1) \
            .execute()

        last_date = last.data[0]["date"] if last.data else "2023-01-01"
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        rows = []
        for point in chart_data:
            ts, volume = point[0], point[1]
            date_str = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")

            if date_str > last_date and date_str <= today:
                rows.append({
                    "date": date_str,
                    "volume_usd": volume,
                    "source": "defillama",
                })

        if rows:
            for i in range(0, len(rows), 500):
                supabase.table("network_dex_volume").upsert(
                    rows[i:i + 500], on_conflict="date"
                ).execute()

        supabase.table("sync_status").update({
            "status": "idle",
            "last_synced_at": datetime.now(timezone.utc).isoformat(),
            "records_synced": len(rows),
            "error_message": None,
        }).eq("indexer_name", "network_dex_volume").execute()

        logger.info(f"Synced {len(rows)} DEX volume data points")

    except Exception as e:
        supabase.table("sync_status").update({
            "status": "error",
            "error_message": str(e)[:500],
        }).eq("indexer_name", "network_dex_volume").execute()
        raise
