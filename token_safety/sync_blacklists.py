"""
Sync external blacklists into known_addresses table.

Sources (all free):
1. OFAC Sanctioned Addresses — github.com/0xB10C/ofac-sanctioned-digital-currency-addresses
2. ScamSniffer — github.com/scamsniffer/scam-database
3. eth-labels — github.com/dawsbot/eth-labels (phish/hack only)

Designed to run daily via scheduler or /cron/sync-blacklists endpoint.
"""

import logging
import re
import requests
from datetime import datetime, timezone
from typing import List, Dict

from config import SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
from supabase import create_client

logger = logging.getLogger(__name__)

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")

# ── Sources ──────────────────────────────────────────────────────

OFAC_ETH_URL = (
    "https://raw.githubusercontent.com/0xB10C/"
    "ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_ETH.json"
)

SCAMSNIFFER_ADDRESSES_URL = (
    "https://raw.githubusercontent.com/scamsniffer/"
    "scam-database/main/blacklist/address.json"
)

ETH_LABELS_PHISH_URL = (
    "https://raw.githubusercontent.com/dawsbot/"
    "eth-labels/main/src/mainnet/phish-hack/all.json"
)


def _is_valid_address(addr: str) -> bool:
    return bool(ADDRESS_RE.match(addr))


# ── OFAC Sanctioned Addresses ────────────────────────────────────

def fetch_ofac_addresses() -> List[Dict]:
    """Fetch OFAC-sanctioned Ethereum addresses (works for any EVM chain)."""
    try:
        resp = requests.get(OFAC_ETH_URL, timeout=30)
        resp.raise_for_status()
        addresses = resp.json()

        results = []
        for addr in addresses:
            addr = addr.strip().lower()
            if _is_valid_address(addr):
                results.append({
                    "address": addr,
                    "label": "OFAC sanctioned address",
                    "risk_level": "HIGH",
                    "category": "sanctioned",
                    "source": "ofac",
                })

        logger.info(f"[OFAC] Fetched {len(results)} sanctioned addresses")
        return results

    except Exception as e:
        logger.error(f"[OFAC] Failed to fetch: {e}")
        return []


# ── ScamSniffer ──────────────────────────────────────────────────

def fetch_scamsniffer_addresses() -> List[Dict]:
    """Fetch ScamSniffer phishing address blacklist."""
    try:
        resp = requests.get(SCAMSNIFFER_ADDRESSES_URL, timeout=30)
        resp.raise_for_status()
        data = resp.json()

        # Format: list of addresses or dict with addresses key
        if isinstance(data, dict):
            addresses = data.get("addresses", data.get("blacklist", []))
        elif isinstance(data, list):
            addresses = data
        else:
            logger.warning("[ScamSniffer] Unexpected format")
            return []

        results = []
        for addr in addresses:
            if isinstance(addr, str):
                addr = addr.strip().lower()
            elif isinstance(addr, dict):
                addr = addr.get("address", "").strip().lower()
            else:
                continue

            if _is_valid_address(addr):
                results.append({
                    "address": addr,
                    "label": "ScamSniffer phishing address",
                    "risk_level": "HIGH",
                    "category": "phishing",
                    "source": "scamsniffer",
                })

        logger.info(f"[ScamSniffer] Fetched {len(results)} phishing addresses")
        return results

    except Exception as e:
        logger.error(f"[ScamSniffer] Failed to fetch: {e}")
        return []


# ── eth-labels (phish/hack only) ─────────────────────────────────

def fetch_eth_labels_phish() -> List[Dict]:
    """Fetch phish/hack labeled addresses from dawsbot/eth-labels GitHub repo."""
    try:
        resp = requests.get(ETH_LABELS_PHISH_URL, timeout=60)
        resp.raise_for_status()
        data = resp.json()

        results = []
        entries = data if isinstance(data, list) else []

        for entry in entries:
            if isinstance(entry, dict):
                addr = entry.get("address", "").strip().lower()
                label = entry.get("nameTag", "") or "phish/hack"
            elif isinstance(entry, str):
                addr = entry.strip().lower()
                label = "phish/hack"
            else:
                continue

            if _is_valid_address(addr):
                results.append({
                    "address": addr,
                    "label": f"eth-labels: {label}"[:200],
                    "risk_level": "HIGH",
                    "category": "phishing",
                    "source": "eth_labels",
                })

        logger.info(f"[eth-labels] Fetched {len(results)} phish/hack addresses")
        return results

    except Exception as e:
        logger.error(f"[eth-labels] Failed to fetch: {e}")
        return []


# ── Upsert into known_addresses ──────────────────────────────────

def upsert_addresses(addresses: List[Dict]) -> int:
    """Batch upsert addresses into known_addresses. Returns count saved."""
    if not addresses:
        return 0

    saved = 0
    # Batch in chunks of 500 to avoid payload limits
    chunk_size = 500

    for i in range(0, len(addresses), chunk_size):
        chunk = addresses[i : i + chunk_size]

        # Add timestamps
        now = datetime.now(timezone.utc).isoformat()
        for row in chunk:
            row["updated_at"] = now

        try:
            supabase.table("known_addresses").upsert(
                chunk,
                on_conflict="address",
            ).execute()
            saved += len(chunk)
        except Exception as e:
            logger.error(f"[sync] Upsert failed for chunk {i}-{i+len(chunk)}: {e}")

    return saved


# ── Main sync function ───────────────────────────────────────────

def run_sync() -> Dict:
    """Run full blacklist sync. Returns summary stats."""
    logger.info("=" * 50)
    logger.info("[sync_blacklists] Starting daily sync...")

    stats = {
        "ofac": 0,
        "scamsniffer": 0,
        "eth_labels": 0,
        "total_fetched": 0,
        "total_saved": 0,
        "started_at": datetime.now(timezone.utc).isoformat(),
    }

    # 1. Fetch from all sources
    ofac = fetch_ofac_addresses()
    scamsniffer = fetch_scamsniffer_addresses()
    eth_labels = fetch_eth_labels_phish()

    stats["ofac"] = len(ofac)
    stats["scamsniffer"] = len(scamsniffer)
    stats["eth_labels"] = len(eth_labels)

    # 2. Deduplicate — OFAC takes priority, then scamsniffer, then eth-labels
    #    (if same address appears in multiple sources, keep highest-priority label)
    merged = {}

    # eth-labels first (lowest priority)
    for addr in eth_labels:
        merged[addr["address"]] = addr

    # ScamSniffer overrides eth-labels
    for addr in scamsniffer:
        merged[addr["address"]] = addr

    # OFAC overrides all (highest priority — legal compliance)
    for addr in ofac:
        merged[addr["address"]] = addr

    all_addresses = list(merged.values())
    stats["total_fetched"] = len(all_addresses)

    # 3. Upsert — but DO NOT overwrite manually curated intelligence_study entries
    #    Filter out addresses that already exist with source='intelligence_study'
    if all_addresses:
        try:
            existing = supabase.table("known_addresses").select(
                "address"
            ).eq("source", "intelligence_study").execute()
            protected = {r["address"] for r in (existing.data or [])}

            to_upsert = [a for a in all_addresses if a["address"] not in protected]
            stats["total_saved"] = upsert_addresses(to_upsert)
            logger.info(
                f"[sync] Skipped {len(all_addresses) - len(to_upsert)} "
                f"intelligence_study entries (protected)"
            )
        except Exception as e:
            logger.error(f"[sync] Failed to check protected addresses: {e}")
            stats["total_saved"] = upsert_addresses(all_addresses)

    stats["finished_at"] = datetime.now(timezone.utc).isoformat()

    logger.info(
        f"[sync_blacklists] Done — "
        f"OFAC: {stats['ofac']}, "
        f"ScamSniffer: {stats['scamsniffer']}, "
        f"eth-labels: {stats['eth_labels']}, "
        f"saved: {stats['total_saved']}"
    )
    logger.info("=" * 50)

    return stats


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    stats = run_sync()
    print(f"\nSync complete: {stats}")
