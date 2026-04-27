"""Whale clustering indexer — finds connections between whale addresses.

Heuristics:
1. Common funding source: if 2+ whales received their first PLS from the same address
2. Direct transfers: whale A sent PLS or tokens to whale B
3. Bridge lineage: bridge user → distributes to multiple PLS addresses (strongest signal)
4. Shared contract interactions: same staking/DEX patterns (future)

Uses PulseChain Scan API v2 for transaction history + bridge data from the database.
"""

import logging
import time
from datetime import datetime, timezone
from collections import defaultdict

import requests

from db import supabase

logger = logging.getLogger(__name__)

SCAN_API = "https://api.scan.pulsechain.com/api/v2"

# Known infrastructure to ignore as "funders"
INFRA_ADDRESSES = {
    "0x0000000000000000000000000000000000000000",  # Null
    "0x000000000000000000000000000000000000dead",  # Dead
    # PulseX routers
    "0x98bf93ebf5c380c0e6ae8e192a7e2ae08edacc3a",  # PulseX Router v1
    "0x165c3410fc91f0b75b2ab5093d7226e3929e0bff",  # PulseX Router v2
    # PulseX factory
    "0x1715a3e4a142d8b698131108995174f37aeba10d",  # PulseX Factory v1
    "0x29ea7545def87022badc76323f373ea1e707c523",  # PulseX Factory v2
    # Bridges
    "0x4fdef7c7bfceb52b77b3e04f20df35e76d287c8d",  # OmniBridge
    "0x6d411e0a54382ed43f02410ce1c7a7c122afa6e1",  # Hyperlane bridge
    # Token contracts (not real funders)
    "0xa1077a294dde1b09bb078844df40758a5d0f9a27",  # WPLS
    "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",  # HEX
    "0x95b303987a60c71504d99aa1b13b4da07b0790ab",  # PLSX
    "0x2fa878ab3f87cc1c9737fc071108f904c0b0c95d",  # INC
    # DEX aggregators
    "0xb45a2dda996c32e93b8c47098e90ed0a7b2b1f44",  # Piteas Router
    # Staking / DeFi
    "0x5a9780bfe63f3ec57f01b087cd65bd656c9034a8",  # HEX Staking
    # PulseChain system
    "0x0000000000000000000000000000000000000369",  # PLS system deposit
}

# Confidence scores per link type
LINK_CONFIDENCE = {
    "bridge_user": 0.90,       # Self-link, very reliable
    "bridge_funded": 0.85,     # Bridge user sent directly to whale
    "bridge_siblings": 0.80,   # Same bridge user funded both
    "common_funder": 0.75,     # Same first funder (lowered if high fanout)
    "same_funder": 0.70,       # Cross-link within common_funder cluster
    "direct_transfer": 0.60,   # Whale-to-whale PLS transfer
    "token_transfer": 0.50,    # Whale-to-whale token transfer
}

# Fanout threshold: if a funder funds > this many whales, confidence drops
HIGH_FANOUT_THRESHOLD = 5
HIGH_FANOUT_CONFIDENCE = 0.30  # Likely exchange/service


def _fetch_transactions(address, limit=50):
    """Fetch transactions for an address from Scan API v2."""
    url = f"{SCAN_API}/addresses/{address}/transactions"
    try:
        resp = requests.get(url, params={"limit": limit}, timeout=15)
        if resp.status_code != 200:
            return []
        data = resp.json()
        return data.get("items", [])
    except Exception as e:
        logger.debug(f"Failed to fetch txs for {address[:12]}: {e}")
        return []


def _fetch_token_transfers(address, direction="to", limit=50):
    """Fetch token transfers for an address."""
    url = f"{SCAN_API}/addresses/{address}/token-transfers"
    try:
        resp = requests.get(url, params={"limit": limit, "filter": direction, "type": "ERC-20"}, timeout=15)
        if resp.status_code != 200:
            return []
        data = resp.json()
        return data.get("items", [])
    except Exception as e:
        logger.debug(f"Failed to fetch token transfers for {address[:12]}: {e}")
        return []


def _find_funder(txs, whale_address):
    """Find the first address that sent PLS to this whale."""
    # Sort by block number ascending to find earliest
    incoming = []
    for tx in txs:
        to_addr = (tx.get("to") or {}).get("hash", "").lower()
        from_addr = tx.get("from", {}).get("hash", "").lower()
        value = int(tx.get("value", "0"))

        if to_addr == whale_address.lower() and value > 0:
            block = tx.get("block_number") or 999999999
            incoming.append((block, from_addr, value))

    if not incoming:
        return None

    incoming.sort(key=lambda x: x[0])
    _, funder, _ = incoming[0]

    if funder in INFRA_ADDRESSES:
        # Try second funder
        for _, f, _ in incoming[1:]:
            if f not in INFRA_ADDRESSES:
                return f
        return None

    return funder


def _find_direct_links(txs, whale_address, whale_set):
    """Find direct PLS transfers between this whale and other known whales."""
    links = []
    for tx in txs:
        from_addr = tx.get("from", {}).get("hash", "").lower()
        to_addr = (tx.get("to") or {}).get("hash", "").lower()
        value = int(tx.get("value", "0"))

        if value == 0:
            continue

        if from_addr == whale_address.lower() and to_addr in whale_set:
            links.append(("sent_pls", to_addr, value / 1e18))
        elif to_addr == whale_address.lower() and from_addr in whale_set:
            links.append(("received_pls", from_addr, value / 1e18))

    return links


def _get_confidence(link_type, fanout=None):
    """Get confidence score for a link type, adjusted for fanout."""
    base = LINK_CONFIDENCE.get(link_type, 0.50)
    if fanout is not None and fanout > HIGH_FANOUT_THRESHOLD:
        if link_type in ("common_funder", "same_funder"):
            return HIGH_FANOUT_CONFIDENCE
    return base


def _find_token_links(transfers, whale_address, whale_set):
    """Find token transfers between this whale and other known whales."""
    links = []
    for tx in transfers:
        from_addr = tx.get("from", {}).get("hash", "").lower()
        to_addr = tx.get("to", {}).get("hash", "").lower()
        symbol = tx.get("token", {}).get("symbol", "?")

        if from_addr == whale_address.lower() and to_addr in whale_set:
            links.append(("sent_token", to_addr, symbol))
        elif to_addr == whale_address.lower() and from_addr in whale_set:
            links.append(("received_token", from_addr, symbol))

    return links


def _set_status(status, error=None):
    supabase.table("sync_status").update({
        "status": status,
        "error_message": error,
        "last_synced_at": datetime.now(timezone.utc).isoformat(),
    }).eq("indexer_name", "whale_clustering").execute()


def run():
    """Analyze whale addresses to find clusters (same owner)."""
    logger.info("Starting whale clustering...")
    _set_status("running")

    try:
        # 1. Load all whale addresses
        result = supabase.table("whale_addresses") \
            .select("address, total_usd, token_count, top_tokens, is_contract") \
            .order("total_usd", desc=True) \
            .limit(200) \
            .execute()

        whales = result.data or []
        whale_set = {w["address"].lower() for w in whales}
        logger.info(f"Analyzing {len(whales)} whale addresses")

        if not whales:
            _set_status("idle")
            return

        now = datetime.now(timezone.utc).isoformat()
        funder_map = {}  # whale_address -> funder_address
        all_links = []   # list of {from, to, link_type, detail}
        funder_groups = defaultdict(list)  # funder -> [whale addresses]

        # 1b. Load bridge users upfront (needed during per-whale loop)
        bridge_users = set()
        try:
            omni = supabase.table("bridge_transfers") \
                .select("user_address") \
                .eq("direction", "deposit") \
                .execute()
            for row in (omni.data or []):
                a = (row.get("user_address") or "").lower()
                if a:
                    bridge_users.add(a)

            hyper = supabase.table("hyperlane_transfers") \
                .select("origin_tx_sender") \
                .eq("direction", "inbound") \
                .execute()
            for row in (hyper.data or []):
                a = (row.get("origin_tx_sender") or "").lower()
                if a:
                    bridge_users.add(a)

            logger.info(f"Loaded {len(bridge_users)} unique bridge user addresses")
        except Exception as e:
            logger.warning(f"Failed to load bridge data: {e}")

        # Track token senders to whales (for bridge lineage)
        token_senders_to_whale = defaultdict(list)  # sender -> [(whale, symbol)]

        # 2. For each whale, find funder + direct links
        for i, whale in enumerate(whales):
            addr = whale["address"]

            # Fetch transactions
            txs = _fetch_transactions(addr)

            if txs:
                # Find first funder
                funder = _find_funder(txs, addr)
                if funder:
                    funder_map[addr] = funder
                    funder_groups[funder].append(addr)

                # Find direct whale-to-whale links
                pls_links = _find_direct_links(txs, addr, whale_set)
                for link_type, other, amount in pls_links:
                    all_links.append({
                        "address_from": addr if "sent" in link_type else other,
                        "address_to": other if "sent" in link_type else addr,
                        "link_type": "direct_transfer",
                        "detail": f"{amount:,.0f} PLS",
                        "confidence_score": _get_confidence("direct_transfer"),
                        "updated_at": now,
                    })

            # Fetch token transfers (both directions)
            token_in = _fetch_token_transfers(addr, "to", 30)
            token_out = _fetch_token_transfers(addr, "from", 30)
            token_txs = token_in + token_out

            if token_txs:
                token_links = _find_token_links(token_txs, addr, whale_set)
                for link_type, other, symbol in token_links:
                    all_links.append({
                        "address_from": addr if "sent" in link_type else other,
                        "address_to": other if "sent" in link_type else addr,
                        "link_type": "token_transfer",
                        "detail": symbol,
                        "confidence_score": _get_confidence("token_transfer"),
                        "updated_at": now,
                    })

                # Track ALL incoming token senders (for bridge lineage)
                for tx in token_in:
                    sender = tx.get("from", {}).get("hash", "").lower()
                    symbol = tx.get("token", {}).get("symbol", "?")
                    if sender and sender not in INFRA_ADDRESSES:
                        token_senders_to_whale[sender].append((addr, symbol))

            # Rate limit (0.3s between requests, ~4 requests per whale)
            time.sleep(0.3)

            if (i + 1) % 20 == 0:
                logger.info(f"  Processed {i + 1}/{len(whales)} whales")

        # 3. Build funding clusters (same funder = likely same owner)
        cluster_links = []
        for funder, funded_whales in funder_groups.items():
            if len(funded_whales) >= 2:
                fanout = len(funded_whales)
                confidence = _get_confidence("common_funder", fanout=fanout)
                is_high_fanout = fanout > HIGH_FANOUT_THRESHOLD

                if is_high_fanout:
                    logger.info(f"  HIGH FANOUT: funder {funder[:12]}... funds {fanout} whales "
                                f"(likely exchange/service, confidence={confidence})")
                else:
                    logger.info(f"  Cluster: funder {funder[:12]}... funds {fanout} whales "
                                f"(confidence={confidence})")

                for w in funded_whales:
                    cluster_links.append({
                        "address_from": funder,
                        "address_to": w,
                        "link_type": "common_funder",
                        "detail": f"funded {fanout} whales" + (" (high fanout)" if is_high_fanout else ""),
                        "confidence_score": confidence,
                        "updated_at": now,
                    })
                # Also link the funded whales to each other
                same_funder_confidence = _get_confidence("same_funder", fanout=fanout)
                for j in range(len(funded_whales)):
                    for k in range(j + 1, len(funded_whales)):
                        cluster_links.append({
                            "address_from": funded_whales[j],
                            "address_to": funded_whales[k],
                            "link_type": "same_funder",
                            "detail": f"both funded by {funder[:12]}..." + (" (high fanout)" if is_high_fanout else ""),
                            "confidence_score": same_funder_confidence,
                            "updated_at": now,
                        })

        all_links.extend(cluster_links)

        # 3b. Bridge lineage — cross-reference token senders with bridge users
        bridge_links = []
        bridge_token_groups = defaultdict(list)  # bridge_sender -> [whale_addresses]

        # Check all token senders: if sender is a bridge user → bridge_funded
        for sender, recipients in token_senders_to_whale.items():
            if sender in bridge_users:
                unique_whales = list(set(r[0] for r in recipients))
                tokens = list(set(r[1] for r in recipients))
                bridge_token_groups[sender] = unique_whales

                for w in unique_whales:
                    bridge_links.append({
                        "address_from": sender,
                        "address_to": w,
                        "link_type": "bridge_funded",
                        "detail": f"bridge user sent {', '.join(tokens[:3])}",
                        "confidence_score": _get_confidence("bridge_funded"),
                        "updated_at": now,
                    })

                # Link daughter whales to each other
                if len(unique_whales) >= 2:
                    for j in range(len(unique_whales)):
                        for k in range(j + 1, len(unique_whales)):
                            bridge_links.append({
                                "address_from": unique_whales[j],
                                "address_to": unique_whales[k],
                                "link_type": "bridge_siblings",
                                "detail": f"same bridge user {sender[:12]}...",
                                "confidence_score": _get_confidence("bridge_siblings"),
                                "updated_at": now,
                            })

        # Also check PLS funders that are bridge users
        for funder, funded_whales in funder_groups.items():
            if funder in bridge_users and funder not in bridge_token_groups:
                for w in funded_whales:
                    bridge_links.append({
                        "address_from": funder,
                        "address_to": w,
                        "link_type": "bridge_funded",
                        "detail": "bridge user sent PLS",
                        "confidence_score": _get_confidence("bridge_funded"),
                        "updated_at": now,
                    })

        # Mark whales who themselves bridged
        bridge_whales = whale_set & bridge_users
        for whale_addr in bridge_whales:
            bridge_links.append({
                "address_from": whale_addr,
                "address_to": whale_addr,
                "link_type": "bridge_user",
                "detail": "bridged assets to PulseChain",
                "confidence_score": _get_confidence("bridge_user"),
                "updated_at": now,
            })

        logger.info(f"  Bridge lineage: {len(bridge_links)} links — "
                     f"{len(bridge_token_groups)} bridge senders to whales, "
                     f"{len(bridge_whales)} whales are bridge users")
        all_links.extend(bridge_links)

        # 4. Deduplicate links (keep unique from-to-type combinations)
        seen = set()
        unique_links = []
        for link in all_links:
            key = (link["address_from"], link["address_to"], link["link_type"])
            if key not in seen:
                seen.add(key)
                unique_links.append(link)

        # 5. Store results
        logger.info(f"Found {len(unique_links)} unique links ({len(cluster_links)} from clustering)")

        # Clear old links
        supabase.table("whale_links").delete().neq("address_from", "").execute()

        # Insert new links
        batch_size = 500
        for i in range(0, len(unique_links), batch_size):
            batch = unique_links[i:i + batch_size]
            supabase.table("whale_links").insert(batch).execute()

        # Update whale_addresses with funder info
        for addr, funder in funder_map.items():
            supabase.table("whale_addresses").update({
                "funder_address": funder,
                "updated_at": now,
            }).eq("address", addr).execute()

        # Summary
        funding_clusters = sum(1 for v in funder_groups.values() if len(v) >= 2)
        high_fanout_clusters = sum(1 for v in funder_groups.values() if len(v) > HIGH_FANOUT_THRESHOLD)
        direct_links = sum(1 for l in unique_links if l["link_type"] == "direct_transfer")
        token_links = sum(1 for l in unique_links if l["link_type"] == "token_transfer")
        bridge_funded = sum(1 for l in unique_links if l["link_type"] == "bridge_funded")
        bridge_sibling = sum(1 for l in unique_links if l["link_type"] == "bridge_siblings")
        bridge_self = sum(1 for l in unique_links if l["link_type"] == "bridge_user")
        high_conf = sum(1 for l in unique_links if l.get("confidence_score", 0.5) >= 0.7)
        low_conf = sum(1 for l in unique_links if l.get("confidence_score", 0.5) < 0.5)

        logger.info(f"Clustering complete: {funding_clusters} funding clusters "
                     f"({high_fanout_clusters} high-fanout), "
                     f"{direct_links} direct PLS, {token_links} token, "
                     f"{bridge_funded} bridge-funded, {bridge_sibling} bridge-siblings, "
                     f"{bridge_self} bridge-users | "
                     f"Confidence: {high_conf} high (≥0.7), {low_conf} low (<0.5)")
        _set_status("idle")

    except Exception as e:
        logger.error(f"Whale clustering failed: {e}")
        _set_status("error", str(e)[:500])
        raise
