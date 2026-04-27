"""PulseX DefiLlama indexer — daily sync of PulseX TVL + Volume from DefiLlama.

Fetches the full history and upserts only new/updated days.
Runs as part of the daily cron alongside other indexers.
"""

import logging
from datetime import datetime, timezone

import requests

from db import supabase
from utils.retry import with_retry

logger = logging.getLogger(__name__)

PULSEX_PROTOCOL_URL = "https://api.llama.fi/protocol/pulsex"
PULSEX_DEX_VOLUME_URL = "https://api.llama.fi/summary/dexs/pulsex"


def _set_status(status, error=None, records=0):
    supabase.table("sync_status").upsert({
        "indexer_name": "pulsex_defillama",
        "status": status,
        "error_message": error,
        "records_synced": records,
        "last_synced_at": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="indexer_name").execute()


def _dedup(rows):
    seen = {}
    for r in rows:
        seen[r["date"]] = r
    return list(seen.values())


def run():
    logger.info("Starting PulseX DefiLlama sync...")
    _set_status("running")

    try:
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        total = 0

        # --- TVL ---
        logger.info("Fetching PulseX TVL from DefiLlama...")
        data = with_retry(lambda: requests.get(PULSEX_PROTOCOL_URL, timeout=60).json())
        tvl_raw = data.get("chainTvls", {}).get("PulseChain", {}).get("tvl", [])

        # Get last synced date
        last = supabase.table("pulsex_defillama_tvl") \
            .select("date").order("date", desc=True).limit(1).execute()
        last_tvl_date = last.data[0]["date"] if last.data else "2023-01-01"

        tvl_rows = []
        for p in tvl_raw:
            date_str = datetime.fromtimestamp(p["date"], tz=timezone.utc).strftime("%Y-%m-%d")
            if date_str > last_tvl_date and date_str <= today:
                tvl_rows.append({
                    "date": date_str,
                    "tvl_usd": p["totalLiquidityUSD"],
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                })

        # Always update today's value (intraday refresh)
        today_tvl = [p for p in tvl_raw if datetime.fromtimestamp(p["date"], tz=timezone.utc).strftime("%Y-%m-%d") == today]
        if today_tvl:
            tvl_rows.append({
                "date": today,
                "tvl_usd": today_tvl[-1]["totalLiquidityUSD"],
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })

        tvl_rows = _dedup(tvl_rows)
        if tvl_rows:
            for i in range(0, len(tvl_rows), 500):
                supabase.table("pulsex_defillama_tvl").upsert(
                    tvl_rows[i:i + 500], on_conflict="date"
                ).execute()
            total += len(tvl_rows)
        logger.info(f"pulsex_defillama_tvl: {len(tvl_rows)} rows")

        # --- Volume ---
        logger.info("Fetching PulseX Volume from DefiLlama...")
        vol_data = with_retry(lambda: requests.get(PULSEX_DEX_VOLUME_URL, timeout=60).json())
        chart = vol_data.get("totalDataChart", [])

        last = supabase.table("pulsex_defillama_volume") \
            .select("date").order("date", desc=True).limit(1).execute()
        last_vol_date = last.data[0]["date"] if last.data else "2023-01-01"

        vol_rows = []
        for p in chart:
            date_str = datetime.fromtimestamp(p[0], tz=timezone.utc).strftime("%Y-%m-%d")
            if date_str > last_vol_date and date_str <= today:
                vol_rows.append({
                    "date": date_str,
                    "volume_usd": p[1],
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                })

        # Always update today
        today_vol = [p for p in chart if datetime.fromtimestamp(p[0], tz=timezone.utc).strftime("%Y-%m-%d") == today]
        if today_vol:
            vol_rows.append({
                "date": today,
                "volume_usd": today_vol[-1][1],
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })

        vol_rows = _dedup(vol_rows)
        if vol_rows:
            for i in range(0, len(vol_rows), 500):
                supabase.table("pulsex_defillama_volume").upsert(
                    vol_rows[i:i + 500], on_conflict="date"
                ).execute()
            total += len(vol_rows)
        logger.info(f"pulsex_defillama_volume: {len(vol_rows)} rows")

        _set_status("idle", records=total)
        logger.info(f"PulseX DefiLlama sync complete: {total} total rows")

    except Exception as e:
        _set_status("error", str(e)[:500])
        logger.warning(f"PulseX DefiLlama sync failed: {e}")
