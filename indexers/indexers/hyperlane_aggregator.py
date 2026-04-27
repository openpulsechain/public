"""Hyperlane aggregator — computes daily stats and chain stats from hyperlane_transfers."""

import logging
from datetime import datetime, timezone

from db import supabase

logger = logging.getLogger(__name__)

INDEXER_NAME = "hyperlane_aggregator"


def _set_status(status, error=None):
    supabase.table("sync_status").update({
        "status": status,
        "error_message": error,
        "last_synced_at": datetime.now(timezone.utc).isoformat(),
    }).eq("indexer_name", INDEXER_NAME).execute()


def _aggregate_daily():
    """Compute hyperlane_daily_stats from hyperlane_transfers via database stored procedure."""
    result = supabase.rpc("get_hyperlane_daily_stats", {}).execute()

    if hasattr(result, "data") and result.data:
        rows = result.data
        now = datetime.now(timezone.utc).isoformat()
        upsert_rows = []
        for row in rows:
            upsert_rows.append({
                "date": row["date"],
                "inbound_count": row["inbound_count"],
                "outbound_count": row["outbound_count"],
                "inbound_volume_usd": row["inbound_volume_usd"] or 0,
                "outbound_volume_usd": row["outbound_volume_usd"] or 0,
                "net_flow_usd": (row["inbound_volume_usd"] or 0) - (row["outbound_volume_usd"] or 0),
                "unique_users": row["unique_users"],
                "unique_chains": row["unique_chains"],
                "updated_at": now,
            })
        for i in range(0, len(upsert_rows), 500):
            supabase.table("hyperlane_daily_stats").upsert(
                upsert_rows[i:i + 500], on_conflict="date"
            ).execute()
        logger.info(f"Aggregated {len(rows)} Hyperlane daily stats rows")
    else:
        logger.info("No Hyperlane daily stats to aggregate")


def _aggregate_chains():
    """Compute hyperlane_chain_stats from hyperlane_transfers."""
    result = supabase.rpc("get_hyperlane_chain_stats", {}).execute()

    if hasattr(result, "data") and result.data:
        rows = result.data
        now = datetime.now(timezone.utc).isoformat()
        upsert_rows = []
        for row in rows:
            inbound = row["inbound_volume_usd"] or 0
            outbound = row["outbound_volume_usd"] or 0
            upsert_rows.append({
                "chain_id": row["chain_id"],
                "chain_name": row["chain_name"],
                "total_inbound_count": row["inbound_count"],
                "total_outbound_count": row["outbound_count"],
                "total_inbound_volume_usd": inbound,
                "total_outbound_volume_usd": outbound,
                "net_flow_usd": inbound - outbound,
                "last_transfer_at": row.get("last_transfer_at"),
                "updated_at": now,
            })
        supabase.table("hyperlane_chain_stats").upsert(
            upsert_rows, on_conflict="chain_id"
        ).execute()
        logger.info(f"Aggregated {len(rows)} Hyperlane chain stats rows")
    else:
        logger.info("No Hyperlane chain stats to aggregate")


def run():
    """Run all Hyperlane aggregations."""
    logger.info("Starting Hyperlane aggregation...")
    _set_status("running")

    errors = []
    for name, fn in [("daily_stats", _aggregate_daily), ("chain_stats", _aggregate_chains)]:
        try:
            fn()
        except Exception as e:
            logger.warning(f"Hyperlane aggregation step '{name}' failed: {e}")
            errors.append(f"{name}: {str(e)[:200]}")

    if errors:
        _set_status("error", "; ".join(errors))
    else:
        _set_status("idle")
        logger.info("Hyperlane aggregation complete")
