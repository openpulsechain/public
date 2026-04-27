"""One-shot backfill: PulseX DefiLlama TVL + Volume + refresh existing tables."""

import logging
import sys
from datetime import datetime, timezone

import requests
from dotenv import load_dotenv

load_dotenv("/tmp/pulsechain-analytics/indexers/.env")

from db import supabase

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger(__name__)

TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")


def dedup_by_date(rows):
    """Keep last occurrence per date (DefiLlama sometimes has duplicates)."""
    seen = {}
    for r in rows:
        seen[r["date"]] = r
    return list(seen.values())


def upsert_batch(table, rows, batch_size=500):
    rows = dedup_by_date(rows)
    total = 0
    for i in range(0, len(rows), batch_size):
        supabase.table(table).upsert(rows[i : i + batch_size], on_conflict="date").execute()
        total += len(rows[i : i + batch_size])
    return total


def backfill_pulsex_tvl():
    """PulseX TVL from DefiLlama /protocol/pulsex → chainTvls.PulseChain.tvl"""
    log.info("Fetching PulseX TVL history from DefiLlama...")
    data = requests.get("https://api.llama.fi/protocol/pulsex", timeout=60).json()
    tvl_raw = data.get("chainTvls", {}).get("PulseChain", {}).get("tvl", [])

    rows = []
    for p in tvl_raw:
        date_str = datetime.fromtimestamp(p["date"], tz=timezone.utc).strftime("%Y-%m-%d")
        if date_str <= TODAY:
            rows.append({"date": date_str, "tvl_usd": p["totalLiquidityUSD"], "updated_at": datetime.now(timezone.utc).isoformat()})

    n = upsert_batch("pulsex_defillama_tvl", rows)
    log.info(f"pulsex_defillama_tvl: {n} rows upserted")


def backfill_pulsex_volume():
    """PulseX Volume from DefiLlama /summary/dexs/pulsex → totalDataChart"""
    log.info("Fetching PulseX Volume history from DefiLlama...")
    data = requests.get("https://api.llama.fi/summary/dexs/pulsex", timeout=60).json()
    chart = data.get("totalDataChart", [])

    rows = []
    for p in chart:
        date_str = datetime.fromtimestamp(p[0], tz=timezone.utc).strftime("%Y-%m-%d")
        if date_str <= TODAY:
            rows.append({"date": date_str, "volume_usd": p[1], "updated_at": datetime.now(timezone.utc).isoformat()})

    n = upsert_batch("pulsex_defillama_volume", rows)
    log.info(f"pulsex_defillama_volume: {n} rows upserted")


def refresh_network_tvl():
    """All PulseChain TVL from DefiLlama /v2/historicalChainTvl/PulseChain"""
    log.info("Refreshing network_tvl_history...")
    data = requests.get("https://api.llama.fi/v2/historicalChainTvl/PulseChain", timeout=30).json()

    rows = []
    for p in data:
        date_str = datetime.fromtimestamp(p["date"], tz=timezone.utc).strftime("%Y-%m-%d")
        if date_str <= TODAY:
            rows.append({"date": date_str, "tvl_usd": p["tvl"], "source": "defillama"})

    n = upsert_batch("network_tvl_history", rows)
    log.info(f"network_tvl_history: {n} rows upserted")


def refresh_network_dex_volume():
    """All PulseChain DEX Volume from DefiLlama /overview/dexs/PulseChain"""
    log.info("Refreshing network_dex_volume...")
    data = requests.get("https://api.llama.fi/overview/dexs/PulseChain", timeout=30).json()
    chart = data.get("totalDataChart", [])

    rows = []
    for p in chart:
        date_str = datetime.fromtimestamp(p[0], tz=timezone.utc).strftime("%Y-%m-%d")
        if date_str <= TODAY:
            rows.append({"date": date_str, "volume_usd": p[1], "source": "defillama"})

    n = upsert_batch("network_dex_volume", rows)
    log.info(f"network_dex_volume: {n} rows upserted")


if __name__ == "__main__":
    try:
        backfill_pulsex_tvl()
        backfill_pulsex_volume()
        refresh_network_tvl()
        refresh_network_dex_volume()
        log.info("All backfills complete.")
    except Exception as e:
        log.error(f"Backfill failed: {e}")
        sys.exit(1)
