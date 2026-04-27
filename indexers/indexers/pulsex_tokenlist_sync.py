"""PulseX token list sync — monitors the official PulseX token lists for new additions.

Fetches the PulseX default (priority) + extended v0.1.2 token lists,
compares with pulsechain_tokens table, and:
  1. Inserts any new tokens (ensuring they enter our discovery pipeline)
  2. Marks PulseX-listed tokens with a flag for priority safety scoring
  3. Logs new additions for alerting

Runs every 15 min as part of the indexer orchestrator.
"""

import logging
import time
from datetime import datetime, timezone

import requests

from db import supabase

logger = logging.getLogger(__name__)

PULSEX_EXTENDED_URL = "https://tokens.app.pulsex.com/pulsex-extended-v0.1.2.tokenlist.json"

# PulseX default/priority tokens (hardcoded in PulseX IPFS JS bundle)
# These are NOT in the extended list — they are the pinned tokens at the top of the selector
PULSEX_DEFAULT_TOKENS = [
    {"address": "0xa1077a294dde1b09bb078844df40758a5d0f9a27", "symbol": "WPLS", "name": "Wrapped Pulse", "decimals": 18},
    {"address": "0x95b303987a60c71504d99aa1b13b4da07b0790ab", "symbol": "PLSX", "name": "PulseX", "decimals": 18},
    {"address": "0x2fa878ab3f87cc1c9737fc071108f904c0b0c95d", "symbol": "INC", "name": "PulseX Incentive Token", "decimals": 18},
    {"address": "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39", "symbol": "HEX", "name": "HEX (PulseChain)", "decimals": 8},
    {"address": "0x57fde0a71132198bbec939b98976993d8d89d225", "symbol": "HEX", "name": "HEX from Ethereum", "decimals": 8},
    {"address": "0xefd766ccb38eaf1dfd701853bfce31359239f305", "symbol": "DAI", "name": "Dai from Ethereum", "decimals": 18},
    {"address": "0x15d38573d2feeb82e7ad5187ab8c1d52810b1f07", "symbol": "USDC", "name": "USD Coin from Ethereum", "decimals": 6},
    {"address": "0x0cb6f5a34ad42ec934882a05265a7d5f59b51a2f", "symbol": "USDT", "name": "Tether from Ethereum", "decimals": 6},
    {"address": "0x02dcdd04e3f455d838cd1249292c58f3b79e3c3c", "symbol": "WETH", "name": "WETH from Ethereum", "decimals": 18},
    {"address": "0xb17d901469b9208b17d916112988a3fed19b5ca1", "symbol": "WBTC", "name": "WBTC from Ethereum", "decimals": 8},
    {"address": "0xf6f8db0aba00007681f8faf16a0fda1c9b030b11", "symbol": "PRVX", "name": "PRVX", "decimals": 18},
]


def _fetch_extended_list() -> list[dict]:
    """Fetch the PulseX extended token list from CDN."""
    resp = requests.get(PULSEX_EXTENDED_URL, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    tokens = data.get("tokens", [])
    # Filter to chainId 369 only
    return [t for t in tokens if t.get("chainId", 369) == 369]


def _get_existing_addresses() -> set[str]:
    """Get all addresses currently in pulsechain_tokens."""
    result = supabase.table("pulsechain_tokens").select("address").execute()
    return {row["address"].lower() for row in (result.data or [])}


def _build_logo_url(checksum_address: str) -> str:
    """Build PulseX CDN logo URL from checksummed address."""
    return f"https://tokens.app.pulsex.com/images/tokens/{checksum_address}.png"


def run():
    logger.info("Syncing PulseX official token lists...")

    supabase.table("sync_status").upsert({
        "indexer_name": "pulsex_tokenlist_sync",
        "status": "running",
    }, on_conflict="indexer_name").execute()

    try:
        # 1. Fetch PulseX extended list
        extended_tokens = _fetch_extended_list()
        logger.info(f"PulseX extended list: {len(extended_tokens)} tokens")

        # 2. Combine default + extended
        all_pulsex = []
        seen = set()

        for t in PULSEX_DEFAULT_TOKENS:
            addr = t["address"].lower()
            if addr not in seen:
                seen.add(addr)
                all_pulsex.append({
                    "address": addr,
                    "symbol": t["symbol"],
                    "name": t["name"],
                    "decimals": t["decimals"],
                    "logo_url": _build_logo_url(t["address"]),
                    "pulsex_listed": True,
                    "pulsex_priority": True,
                })

        for t in extended_tokens:
            addr = t["address"].lower()
            if addr not in seen:
                seen.add(addr)
                all_pulsex.append({
                    "address": addr,
                    "symbol": t["symbol"],
                    "name": t["name"],
                    "decimals": t["decimals"],
                    "logo_url": t.get("logoURI", _build_logo_url(t["address"])),
                    "pulsex_listed": True,
                    "pulsex_priority": False,
                })

        logger.info(f"Total PulseX tokens: {len(all_pulsex)} (default: {len(PULSEX_DEFAULT_TOKENS)}, extended: {len(extended_tokens)})")

        # 3. Compare with existing tokens in DB
        existing = _get_existing_addresses()
        new_tokens = [t for t in all_pulsex if t["address"] not in existing]

        if new_tokens:
            logger.info(f"NEW PULSEX TOKENS DETECTED: {len(new_tokens)}")
            for t in new_tokens:
                logger.info(f"  + {t['symbol']} ({t['name']}) — {t['address']}")

        # 4. Upsert all PulseX tokens into pulsechain_tokens
        now = datetime.now(timezone.utc).isoformat()
        rows = []
        for t in all_pulsex:
            rows.append({
                "address": t["address"],
                "symbol": t["symbol"],
                "name": t["name"],
                "decimals": t["decimals"],
                "is_active": True,
                "updated_at": now,
            })

        if rows:
            supabase.table("pulsechain_tokens").upsert(
                rows, on_conflict="address"
            ).execute()

        # 5. Trigger safety scoring for new tokens via the safety API
        if new_tokens:
            _trigger_safety_scoring(new_tokens)

        supabase.table("sync_status").upsert({
            "indexer_name": "pulsex_tokenlist_sync",
            "status": "idle",
            "last_synced_at": now,
            "records_synced": len(all_pulsex),
            "error_message": None,
        }, on_conflict="indexer_name").execute()

        logger.info(f"PulseX token list sync complete — {len(all_pulsex)} tokens, {len(new_tokens)} new")

    except Exception as e:
        supabase.table("sync_status").upsert({
            "indexer_name": "pulsex_tokenlist_sync",
            "status": "error",
            "error_message": str(e)[:500],
        }, on_conflict="indexer_name").execute()
        raise


def _trigger_safety_scoring(tokens: list[dict]):
    """Request safety analysis for newly discovered PulseX tokens."""
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
                logger.info(f"  Safety scored {t['symbol']}: {data.get('grade', '?')} ({data.get('score', '?')}/100)")
            else:
                logger.warning(f"  Safety scoring failed for {t['symbol']}: HTTP {resp.status_code}")
        except Exception as e:
            logger.warning(f"  Safety scoring error for {t['symbol']}: {e}")
        time.sleep(2)  # Rate limit

    logger.info(f"Safety scoring triggered for {scored}/{len(tokens)} new tokens")
