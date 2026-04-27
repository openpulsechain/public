"""PulseX top pairs indexer — fetches top 50 pairs by volume from V1 + V2 subgraphs.

Combines pairs from both subgraphs, deduplicates by pair address,
and fetches 24h volume from pairDayDatas for each.
"""

import logging
import time
from datetime import datetime, timezone

from db import supabase
from config import PULSEX_SUBGRAPH_V1, PULSEX_SUBGRAPH_V2
from utils.subgraph import query_subgraph

logger = logging.getLogger(__name__)

PAIRS_QUERY = """
{
  pairs(first: 50, orderBy: volumeUSD, orderDirection: desc) {
    id
    token0 { symbol name }
    token1 { symbol name }
    volumeUSD
    reserveUSD
    totalTransactions
  }
}
"""


def _fetch_daily_volumes(endpoint: str, pair_addresses: list[str]) -> dict[str, float]:
    """Fetch yesterday's daily volume for each pair via pairDayDatas."""
    if not pair_addresses:
        return {}

    # Use a timestamp ~36h ago to catch the latest full day
    cutoff = int(datetime.now(timezone.utc).timestamp()) - 36 * 3600
    volumes = {}

    # Batch by 10 pairs to avoid query size limits
    for i in range(0, len(pair_addresses), 10):
        batch = pair_addresses[i:i + 10]
        addr_list = ", ".join(f'"{a}"' for a in batch)
        query = f"""{{
          pairDayDatas(
            first: {len(batch) * 3},
            where: {{pairAddress_in: [{addr_list}], date_gt: {cutoff}}},
            orderBy: date,
            orderDirection: desc
          ) {{
            id
            date
            dailyVolumeUSD
          }}
        }}"""

        try:
            data = query_subgraph(endpoint, query)
            day_datas = data.get("pairDayDatas", [])
            for dd in day_datas:
                # id format: "{pairAddress}-{dayNumber}"
                raw_id = dd.get("id", "")
                addr = raw_id.rsplit("-", 1)[0] if "-" in raw_id else raw_id
                if not addr or addr in volumes:
                    continue  # Keep most recent
                vol = float(dd.get("dailyVolumeUSD", 0))
                if vol >= 0:
                    volumes[addr] = vol
        except Exception as e:
            logger.warning(f"Failed to fetch pairDayDatas batch: {e}")

        time.sleep(0.2)

    return volumes


def run():
    logger.info("Fetching PulseX top pairs (V1 + V2)...")

    supabase.table("sync_status").update({
        "status": "running",
    }).eq("indexer_name", "pulsex_pairs").execute()

    try:
        # Fetch V1 pairs
        v1_data = query_subgraph(PULSEX_SUBGRAPH_V1, PAIRS_QUERY)
        v1_pairs = v1_data.get("pairs", [])
        logger.info(f"  V1: {len(v1_pairs)} pairs")

        # Fetch V2 pairs
        v2_data = query_subgraph(PULSEX_SUBGRAPH_V2, PAIRS_QUERY)
        v2_pairs = v2_data.get("pairs", [])
        logger.info(f"  V2: {len(v2_pairs)} pairs")

        # Combine and deduplicate by pair address (sum volumes if same pair on both)
        pair_map: dict[str, dict] = {}
        for p in v1_pairs:
            pair_map[p["id"]] = {
                "pair_address": p["id"],
                "token0_symbol": p["token0"]["symbol"],
                "token0_name": p["token0"]["name"],
                "token1_symbol": p["token1"]["symbol"],
                "token1_name": p["token1"]["name"],
                "volume_usd": float(p["volumeUSD"]),
                "reserve_usd": float(p["reserveUSD"]),
                "total_transactions": int(p["totalTransactions"]),
                "version": "v1",
            }
        for p in v2_pairs:
            addr = p["id"]
            if addr in pair_map:
                # Same pair on both — sum volumes and reserves
                pair_map[addr]["volume_usd"] += float(p["volumeUSD"])
                pair_map[addr]["reserve_usd"] += float(p["reserveUSD"])
                pair_map[addr]["total_transactions"] += int(p["totalTransactions"])
                pair_map[addr]["version"] = "v1+v2"
            else:
                pair_map[addr] = {
                    "pair_address": addr,
                    "token0_symbol": p["token0"]["symbol"],
                    "token0_name": p["token0"]["name"],
                    "token1_symbol": p["token1"]["symbol"],
                    "token1_name": p["token1"]["name"],
                    "volume_usd": float(p["volumeUSD"]),
                    "reserve_usd": float(p["reserveUSD"]),
                    "total_transactions": int(p["totalTransactions"]),
                    "version": "v2",
                }

        # Sort by volume desc, take top 50
        sorted_pairs = sorted(pair_map.values(), key=lambda x: x["volume_usd"], reverse=True)[:50]
        all_addrs = [p["pair_address"] for p in sorted_pairs]

        # Fetch 24h volumes from pairDayDatas (V1 + V2)
        v1_daily = _fetch_daily_volumes(PULSEX_SUBGRAPH_V1, all_addrs)
        v2_daily = _fetch_daily_volumes(PULSEX_SUBGRAPH_V2, all_addrs)

        now = datetime.now(timezone.utc).isoformat()
        rows = []
        for p in sorted_pairs:
            addr = p["pair_address"]
            daily_vol = (v1_daily.get(addr, 0) or 0) + (v2_daily.get(addr, 0) or 0)
            rows.append({
                "pair_address": addr,
                "token0_symbol": p["token0_symbol"],
                "token0_name": p["token0_name"],
                "token1_symbol": p["token1_symbol"],
                "token1_name": p["token1_name"],
                "volume_usd": p["volume_usd"],
                "reserve_usd": p["reserve_usd"],
                "total_transactions": p["total_transactions"],
                "daily_volume_usd": daily_vol,
                "updated_at": now,
            })

        supabase.table("pulsex_top_pairs").upsert(rows, on_conflict="pair_address").execute()

        supabase.table("sync_status").update({
            "status": "idle",
            "last_synced_at": now,
            "records_synced": len(rows),
            "error_message": None,
        }).eq("indexer_name", "pulsex_pairs").execute()

        logger.info(f"Updated {len(rows)} top pairs (V1+V2 combined)")

    except Exception as e:
        supabase.table("sync_status").update({
            "status": "error",
            "error_message": str(e)[:500],
        }).eq("indexer_name", "pulsex_pairs").execute()
        raise
