"""Pump.tires token sync — monitors the Pump.tires memecoin launchpad factory contract.

Pump.tires is a PulseChain memecoin launchpad (similar to pump.fun on Solana).
Factory contract: 0xcf6402cdEdfF50Fe334471D0fDD33014E40e828c
~11K+ tokens created, but most are dead (79% have 1-2 holders).

This indexer:
  1. Queries Blockscout for tokens created by the factory
  2. Filters for tokens with meaningful activity (holders >= 5)
  3. Inserts qualified tokens into pulsechain_tokens
  4. Triggers safety scoring for new qualified tokens

Does NOT import all tokens — only those showing real activity.

Source: Blockscout API on factory contract
Docs: https://pump.tires/how-it-works
"""

import logging
import time
from datetime import datetime, timezone

import requests

from db import supabase

logger = logging.getLogger(__name__)

FACTORY_ADDRESS = "0xcf6402cdEdfF50Fe334471D0fDD33014E40e828c"
BLOCKSCOUT_API = "https://api.scan.pulsechain.com/api/v2"
MIN_HOLDERS = 5  # Only track tokens with at least 5 holders
MAX_PAGES = 10   # Limit pages per run to avoid timeout

# PUMP native token — always include
PUMP_TOKEN = {
    "address": "0xec4252e62c6de3d655ca9ce3afc12e553ebba274",
    "symbol": "PUMP",
    "name": "PUMP.tires",
    "decimals": 18,
}


def _fetch_factory_tokens() -> list[dict]:
    """Fetch tokens created by Pump.tires factory from Blockscout API."""
    all_tokens = []
    next_params = None

    for page in range(MAX_PAGES):
        url = f"{BLOCKSCOUT_API}/addresses/{FACTORY_ADDRESS}/tokens"
        params = {"type": "ERC-20", "limit": 50}
        if next_params:
            params.update(next_params)

        try:
            resp = requests.get(url, params=params, timeout=30)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            logger.warning(f"Blockscout fetch failed page {page}: {e}")
            break

        items = data.get("items", [])
        if not items:
            break

        for item in items:
            token = item.get("token", {})
            if not token.get("address"):
                continue

            holders = int(token.get("holders", "0") or "0")
            all_tokens.append({
                "address": token["address"].lower(),
                "symbol": token.get("symbol", "???"),
                "name": token.get("name", "Unknown"),
                "decimals": int(token.get("decimals", "18") or "18"),
                "holders": holders,
            })

        # Pagination
        next_page = data.get("next_page_params")
        if not next_page:
            break
        next_params = next_page
        time.sleep(0.3)

    return all_tokens


def _get_existing_addresses() -> set[str]:
    """Get all addresses currently in pulsechain_tokens."""
    result = supabase.table("pulsechain_tokens").select("address").execute()
    return {row["address"].lower() for row in (result.data or [])}


def run():
    logger.info(f"Syncing Pump.tires tokens (factory: {FACTORY_ADDRESS[:10]}..., min holders: {MIN_HOLDERS})...")

    supabase.table("sync_status").upsert({
        "indexer_name": "pumptires_sync",
        "status": "running",
    }, on_conflict="indexer_name").execute()

    try:
        # 1. Fetch tokens from factory
        raw_tokens = _fetch_factory_tokens()
        logger.info(f"Pump.tires factory: {len(raw_tokens)} tokens fetched (first {MAX_PAGES} pages)")

        # 2. Filter for meaningful activity
        qualified = [t for t in raw_tokens if t["holders"] >= MIN_HOLDERS]
        # Always include PUMP token
        pump_addr = PUMP_TOKEN["address"].lower()
        if pump_addr not in {t["address"] for t in qualified}:
            qualified.append({**PUMP_TOKEN, "holders": 999})

        logger.info(f"Qualified tokens (>={MIN_HOLDERS} holders): {len(qualified)}")

        # 3. Compare with existing
        existing = _get_existing_addresses()
        new_tokens = [t for t in qualified if t["address"] not in existing]

        if new_tokens:
            logger.info(f"NEW PUMP.TIRES TOKENS: {len(new_tokens)}")
            for t in new_tokens[:15]:
                logger.info(f"  + {t['symbol']} ({t['name']}) — {t['holders']} holders — {t['address']}")

        # 4. Upsert qualified tokens
        now = datetime.now(timezone.utc).isoformat()
        rows = [{
            "address": t["address"],
            "symbol": t["symbol"],
            "name": t["name"],
            "decimals": t["decimals"],
            "is_active": True,
            "updated_at": now,
        } for t in qualified]

        if rows:
            supabase.table("pulsechain_tokens").upsert(
                rows, on_conflict="address"
            ).execute()

        # 5. Trigger safety scoring for new tokens
        if new_tokens:
            _trigger_safety_scoring(new_tokens[:20])

        supabase.table("sync_status").upsert({
            "indexer_name": "pumptires_sync",
            "status": "idle",
            "last_synced_at": now,
            "records_synced": len(qualified),
            "error_message": None,
        }, on_conflict="indexer_name").execute()

        logger.info(f"Pump.tires sync complete — {len(qualified)} qualified tokens, {len(new_tokens)} new")

    except Exception as e:
        supabase.table("sync_status").upsert({
            "indexer_name": "pumptires_sync",
            "status": "error",
            "error_message": str(e)[:500],
        }, on_conflict="indexer_name").execute()
        raise


def _trigger_safety_scoring(tokens: list[dict]):
    """Request safety analysis for new qualified Pump.tires tokens."""
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
                grade = data.get("data", {}).get("grade", "?")
                logger.info(f"  Safety: {t['symbol']} = {grade} ({t['holders']} holders)")
        except Exception as e:
            logger.warning(f"  Safety error for {t['symbol']}: {e}")
        time.sleep(2)
    logger.info(f"Safety scoring: {scored}/{len(tokens)} Pump.tires tokens")
