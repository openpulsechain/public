"""Token holder count indexer — PulseChain Scan API (Blockscout v2).

Fetches holder_count for top tokens via /api/v2/tokens/{address}.
Updates pulsechain_tokens.holder_count column.
Runs daily (holder counts don't change fast).
"""

import logging
import time
from datetime import datetime, timezone

import requests

from db import supabase

logger = logging.getLogger(__name__)

SCAN_API = "https://api.scan.pulsechain.com/api/v2"


def _fetch_holder_count(address: str) -> int | None:
    """Fetch holder count for a single token from Blockscout v2 API."""
    try:
        resp = requests.get(f"{SCAN_API}/tokens/{address}", timeout=15)
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        data = resp.json()
        count = data.get("holders") or data.get("holders_count")
        if count is not None:
            return int(count)
        return None
    except Exception as e:
        logger.warning(f"Failed to fetch holders for {address}: {e}")
        return None


def run():
    # Only run once per day — skip if last sync was less than 20 hours ago
    try:
        status_resp = (
            supabase.table("sync_status")
            .select("last_synced_at")
            .eq("indexer_name", "token_holders")
            .execute()
        )
        if status_resp.data and status_resp.data[0].get("last_synced_at"):
            from datetime import timedelta
            last = datetime.fromisoformat(status_resp.data[0]["last_synced_at"].replace("Z", "+00:00"))
            if datetime.now(timezone.utc) - last < timedelta(hours=20):
                logger.info("token_holders: skipped (last run < 20h ago)")
                return
    except Exception:
        pass  # If check fails, run anyway

    logger.info("Fetching token holder counts (Blockscout v2)...")

    supabase.table("sync_status").update({
        "status": "running",
    }).eq("indexer_name", "token_holders").execute()

    try:
        # Get top tokens by volume
        resp = (
            supabase.table("pulsechain_tokens")
            .select("address, symbol")
            .eq("is_active", True)
            .order("total_volume_usd", desc=True)
            .limit(50)
            .execute()
        )
        tokens = resp.data or []
        logger.info(f"Fetching holder counts for {len(tokens)} tokens")

        updated = 0
        for t in tokens:
            address = t["address"]
            count = _fetch_holder_count(address)
            if count is not None:
                try:
                    supabase.table("pulsechain_tokens").update({
                        "holder_count": count,
                    }).eq("address", address).execute()
                    logger.info(f"  {t['symbol']}: {count:,} holders")
                    updated += 1
                except Exception as e:
                    logger.warning(f"  Failed to update {t['symbol']}: {e}")

            # Rate limit: ~2 req/s to be respectful
            time.sleep(0.5)

        supabase.table("sync_status").update({
            "status": "idle",
            "last_synced_at": datetime.now(timezone.utc).isoformat(),
            "records_synced": updated,
            "error_message": None,
        }).eq("indexer_name", "token_holders").execute()

        logger.info(f"Updated holder counts for {updated}/{len(tokens)} tokens")

    except Exception as e:
        supabase.table("sync_status").update({
            "status": "error",
            "error_message": str(e)[:500],
        }).eq("indexer_name", "token_holders").execute()
        raise
