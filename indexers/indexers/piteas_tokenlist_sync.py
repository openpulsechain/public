"""Piteas token list sync — monitors the Piteas DEX aggregator token list for new additions.

Fetches the Piteas token list from GitHub (piteasio/app-tokens),
compares with pulsechain_tokens table, and:
  1. Inserts any new tokens
  2. Triggers safety scoring for new tokens
  3. Logs new additions

Source: https://raw.githubusercontent.com/piteasio/app-tokens/main/piteas-tokenlist.json
Logo pattern: https://raw.githubusercontent.com/piteasio/app-tokens/main/token-logo/{checksumAddress}.png
"""

import logging
import time
from datetime import datetime, timezone

import requests

from db import supabase

logger = logging.getLogger(__name__)

PITEAS_TOKENLIST_URL = "https://raw.githubusercontent.com/piteasio/app-tokens/main/piteas-tokenlist.json"
PITEAS_LOGO_BASE = "https://raw.githubusercontent.com/piteasio/app-tokens/main/token-logo"


def _fetch_piteas_list() -> list[dict]:
    """Fetch the complete Piteas token list from GitHub."""
    resp = requests.get(PITEAS_TOKENLIST_URL, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    tokens = data.get("tokens", [])
    # Filter to chainId 369 (PulseChain) only
    return [t for t in tokens if t.get("chainId", 369) == 369]


def _get_existing_addresses() -> set[str]:
    """Get all addresses currently in pulsechain_tokens."""
    result = supabase.table("pulsechain_tokens").select("address").execute()
    return {row["address"].lower() for row in (result.data or [])}


def run():
    logger.info("Syncing Piteas token list from GitHub...")

    supabase.table("sync_status").upsert({
        "indexer_name": "piteas_tokenlist_sync",
        "status": "running",
    }, on_conflict="indexer_name").execute()

    try:
        # 1. Fetch Piteas token list
        piteas_tokens = _fetch_piteas_list()
        logger.info(f"Piteas token list: {len(piteas_tokens)} tokens")

        # 2. Deduplicate by address (some tokens have same address with different entries)
        seen = set()
        unique_tokens = []
        for t in piteas_tokens:
            addr = t["address"].lower()
            if addr not in seen:
                seen.add(addr)
                unique_tokens.append({
                    "address": addr,
                    "symbol": t["symbol"],
                    "name": t["name"],
                    "decimals": t["decimals"],
                    "checksum_address": t["address"],
                    "logo_url": t.get("logoURI", f"{PITEAS_LOGO_BASE}/{t['address']}.png"),
                })

        logger.info(f"Piteas unique tokens: {len(unique_tokens)}")

        # 3. Compare with existing tokens in DB
        existing = _get_existing_addresses()
        new_tokens = [t for t in unique_tokens if t["address"] not in existing]

        if new_tokens:
            logger.info(f"NEW PITEAS TOKENS DETECTED: {len(new_tokens)}")
            for t in new_tokens[:20]:  # Log first 20
                logger.info(f"  + {t['symbol']} ({t['name']}) — {t['address']}")
            if len(new_tokens) > 20:
                logger.info(f"  ... and {len(new_tokens) - 20} more")

        # 4. Upsert all Piteas tokens into pulsechain_tokens
        now = datetime.now(timezone.utc).isoformat()
        rows = []
        for t in unique_tokens:
            rows.append({
                "address": t["address"],
                "symbol": t["symbol"],
                "name": t["name"],
                "decimals": t["decimals"],
                "is_active": True,
                "updated_at": now,
            })

        if rows:
            for i in range(0, len(rows), 500):
                supabase.table("pulsechain_tokens").upsert(
                    rows[i:i + 500], on_conflict="address"
                ).execute()

        # 5. Trigger safety scoring for new tokens (max 30 per run to avoid timeout)
        if new_tokens:
            _trigger_safety_scoring(new_tokens[:30])

        supabase.table("sync_status").upsert({
            "indexer_name": "piteas_tokenlist_sync",
            "status": "idle",
            "last_synced_at": now,
            "records_synced": len(unique_tokens),
            "error_message": None,
        }, on_conflict="indexer_name").execute()

        logger.info(f"Piteas token list sync complete — {len(unique_tokens)} tokens, {len(new_tokens)} new")

    except Exception as e:
        supabase.table("sync_status").upsert({
            "indexer_name": "piteas_tokenlist_sync",
            "status": "error",
            "error_message": str(e)[:500],
        }, on_conflict="indexer_name").execute()
        raise


def _trigger_safety_scoring(tokens: list[dict]):
    """Request safety analysis for newly discovered Piteas tokens."""
    safety_api = "https://safety.openpulsechain.com"
    scored = 0
    for t in tokens:
        try:
            resp = requests.get(
                f"{safety_api}/api/v1/token/{t['address']}/safety",
                params={"fresh": "true"},
                timeout=30,
            )
            if resp.ok:
                scored += 1
                data = resp.json()
                logger.info(f"  Safety scored {t['symbol']}: {data.get('data', {}).get('grade', '?')} ({data.get('data', {}).get('score', '?')}/100)")
            else:
                logger.warning(f"  Safety scoring failed for {t['symbol']}: HTTP {resp.status_code}")
        except Exception as e:
            logger.warning(f"  Safety scoring error for {t['symbol']}: {e}")
        time.sleep(2)  # Rate limit

    logger.info(f"Safety scoring triggered for {scored}/{len(tokens)} new Piteas tokens")
