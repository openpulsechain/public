from __future__ import annotations
"""
Scam Radar — Real-time monitoring for suspicious on-chain events.
Monitors:
1. LP removals (rug pulls) — only flags significant removals (>10% of pool)
2. Large mint events
3. Whale dumps (>X% supply sold)
4. Tax changes (if detectable)

Stores alerts in Supabase for frontend display and webhook delivery.
"""

import logging
import time
import json
import requests
from datetime import datetime, timezone
from config import PULSEX_V1_SUBGRAPH, PULSEX_V2_SUBGRAPH, SCAN_API_URL

logger = logging.getLogger(__name__)

# Thresholds
LP_REMOVAL_USD_THRESHOLD = 1000  # Minimum USD value to consider
LP_REMOVAL_PCT_THRESHOLD = 30   # Alert if >30% of pool liquidity removed (normal LP is <30%)
LP_REMOVAL_CRITICAL_PCT = 80    # Critical if >80% of pool removed (near-total drain)
WHALE_DUMP_SUPPLY_PCT = 5  # Alert if >5% supply sold
MINT_EVENT_SUPPLY_PCT = 1  # Alert if mint >1% of supply

# Known legitimate protocol addresses — LP movements from these are normal
KNOWN_PROTOCOL_ADDRESSES = {
    "0x165c3410fc91ef562c50559f7d2289febed552d9",  # PulseX V2 Router
    "0x98bf93ebf5c380c0e6ae8e192a7e2ae08edacc02",  # PulseX V1 Router
    "0xa1077a294dde1b09bb078844df40758a5d0f9a27",  # WPLS
}

# Known core pair addresses — LP moves on these pools are routine
# LP removal alerts should NOT be attributed to these tokens (they're the base
# side of the pair — the rug pull is on the OTHER token).
CORE_TOKEN_ADDRESSES = {
    "0xa1077a294dde1b09bb078844df40758a5d0f9a27",  # WPLS
    "0x2fa878ab3f87cc1c9737fc071108f904c0b0c95d",  # INC
    "0x95b303987a60c71504d99aa1b13b4da07b0790ab",  # PLSX
    "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",  # HEX
    "0x57fde0a71132198bbec939b98976993d8d89d225",  # eHEX
    "0xefd766ccb38eaf1dfd701853bfce31359239f305",  # DAI
    "0x15d38573d2feeb82e7ad5187ab8c1d52810b1f07",  # USDC
    "0x0cb6f5a34ad42ec934882a05265a7d5f59b51a2f",  # USDT
    "0x02dcdd04e3f455d838cd1249292c58f3b79e3c3c",  # WETH
    "0xb17d901469b9208b17d916112988a3fed19b5ca1",  # WBTC (bridge)
    "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",  # WBTC (fork)
}


def _query_subgraph(url: str, query: str, variables: dict = None) -> dict:
    try:
        resp = requests.post(url, json={"query": query, "variables": variables or {}}, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        return data.get("data", {})
    except Exception as e:
        logger.warning(f"Subgraph query error: {str(e)[:100]}")
        return {}


def _is_core_pair(token0_addr: str, token1_addr: str) -> bool:
    """Check if both tokens in a pair are core ecosystem tokens."""
    return (token0_addr.lower() in CORE_TOKEN_ADDRESSES and
            token1_addr.lower() in CORE_TOKEN_ADDRESSES)


def check_lp_removals(since_timestamp: int) -> list[dict]:
    """
    Check for significant LP removals across PulseX V1 & V2.
    Only flags removals that are suspicious:
    - Removal > 10% of pool liquidity (indicates potential rug)
    - Ignores routine LP adjustments on large/core pools
    Returns list of alerts.
    """
    alerts = []

    burns_query = """
    query($timestamp: String!) {
        burns(where: {timestamp_gt: $timestamp}, orderBy: amountUSD, orderDirection: desc, first: 50) {
            id
            timestamp
            pair {
                id
                token0 { id symbol name }
                token1 { id symbol name }
                reserveUSD
            }
            amount0
            amount1
            amountUSD
            sender
            to
        }
    }
    """

    for dex_name, url in [("PulseX_V2", PULSEX_V2_SUBGRAPH), ("PulseX_V1", PULSEX_V1_SUBGRAPH)]:
        data = _query_subgraph(url, burns_query, {"timestamp": str(since_timestamp)})
        for burn in data.get("burns", []):
            amount_usd = float(burn.get("amountUSD", 0) or 0)

            # Filter inflated values (PulseX subgraph quirk)
            if amount_usd > 1_000_000_000:
                continue

            # Skip small removals
            if amount_usd < LP_REMOVAL_USD_THRESHOLD:
                continue

            pair = burn.get("pair", {})
            token0 = pair.get("token0", {})
            token1 = pair.get("token1", {})
            token0_addr = token0.get("id", "").lower()
            token1_addr = token1.get("id", "").lower()
            sender = burn.get("sender", "").lower()
            reserve_usd = float(pair.get("reserveUSD", 0) or 0)

            # Skip known protocol addresses
            if sender in KNOWN_PROTOCOL_ADDRESSES:
                continue

            # Skip core-to-core pairs (e.g. WPLS/DAI, PLS/HEX) — routine LP ops
            if _is_core_pair(token0_addr, token1_addr):
                continue

            # Calculate % of pool liquidity removed
            # reserveUSD = current reserves AFTER the burn, so total was reserve + amount
            total_before = reserve_usd + amount_usd
            if total_before <= 0:
                continue

            pct_of_pool = (amount_usd / total_before) * 100

            # Only alert if removal is significant portion of pool
            if pct_of_pool < LP_REMOVAL_PCT_THRESHOLD:
                continue

            # Determine severity: % removed + pool size context
            # Large pools (>$100K) = LP removals are more routine
            if pct_of_pool >= LP_REMOVAL_CRITICAL_PCT:
                severity = "critical"
            elif pct_of_pool >= 50 and total_before < 100_000:
                severity = "critical"  # 50%+ drain on small pool
            elif pct_of_pool >= 50:
                severity = "high"      # 50%+ on large pool = less suspicious
            else:
                severity = "medium"    # 30-50% = worth noting but not alarming

            alerts.append({
                "type": "lp_removal",
                "severity": severity,
                "dex": dex_name,
                "pair_address": pair.get("id", ""),
                "token0_symbol": token0.get("symbol", "?"),
                "token0_address": token0_addr,
                "token1_symbol": token1.get("symbol", "?"),
                "token1_address": token1_addr,
                "amount_usd": round(amount_usd, 2),
                "pct_of_pool": round(pct_of_pool, 1),
                "reserve_usd_after": round(reserve_usd, 2),
                "sender": sender,
                "timestamp": int(burn.get("timestamp", 0)),
                "tx_id": burn.get("id", ""),
            })

    return alerts


def check_large_transfers(token_address: str, total_supply: float, since_block: int = 0, token_price: float = 0) -> list[dict]:
    """
    Check for large transfers (whale dumps) via Scan API.
    Returns list of alerts with USD values when price is available.
    """
    alerts = []
    addr = token_address.lower()

    try:
        # Get recent transfers
        resp = requests.get(
            f"{SCAN_API_URL}/api/v2/tokens/{addr}/transfers",
            params={"limit": 50},
            timeout=15
        )
        if resp.status_code != 200:
            return alerts

        data = resp.json()
        for tx in data.get("items", []):
            # Check transfer value
            value_str = tx.get("total", {}).get("value", "0")
            decimals = int(tx.get("total", {}).get("decimals", "18") or "18")
            value = int(value_str) / (10 ** decimals) if value_str else 0

            if total_supply > 0:
                pct_of_supply = (value / total_supply) * 100
                if pct_of_supply >= WHALE_DUMP_SUPPLY_PCT:
                    amount_usd = round(value * token_price, 2) if token_price > 0 else None
                    alerts.append({
                        "type": "whale_dump",
                        "severity": "high" if pct_of_supply > 10 else "medium",
                        "token_address": addr,
                        "from": tx.get("from", {}).get("hash", ""),
                        "to": tx.get("to", {}).get("hash", ""),
                        "value": value,
                        "amount_usd": amount_usd,
                        "pct_of_supply": round(pct_of_supply, 2),
                        "timestamp": tx.get("timestamp", ""),
                        "tx_hash": tx.get("tx_hash", ""),
                    })

    except Exception as e:
        logger.warning(f"Transfer check error for {addr}: {str(e)[:100]}")

    return alerts


def check_honeypots() -> list[dict]:
    """
    Generate alerts for tokens recently detected as honeypots.
    Reads from token_safety_scores where is_honeypot=true and analyzed recently.
    """
    alerts = []
    try:
        from db import supabase

        # Get tokens analyzed in the last 60 minutes that are honeypots
        cutoff = datetime.now(timezone.utc).replace(microsecond=0)
        cutoff_str = (cutoff - __import__('datetime').timedelta(minutes=60)).isoformat()

        result = supabase.table("token_safety_scores").select(
            "token_address, score, grade, analyzed_at"
        ).eq("is_honeypot", True).gte("analyzed_at", cutoff_str).execute()

        # Check which ones already have a recent honeypot alert (avoid duplicates)
        existing = set()
        try:
            day_ago = (cutoff - __import__('datetime').timedelta(days=1)).isoformat()
            existing_rows = supabase.table("scam_radar_alerts").select(
                "token_address"
            ).eq("alert_type", "honeypot").gte("created_at", day_ago).execute()
            existing = {r["token_address"] for r in (existing_rows.data or [])}
        except Exception:
            pass

        # Get token names for display
        token_names = {}
        addrs = [r["token_address"] for r in (result.data or []) if r["token_address"] not in existing]
        if addrs:
            try:
                names_rows = supabase.table("pulsechain_tokens").select(
                    "address, symbol, name"
                ).in_("address", addrs).execute()
                for n in (names_rows.data or []):
                    token_names[n["address"]] = {"symbol": n.get("symbol", "?"), "name": n.get("name", "")}
            except Exception:
                pass

        for row in (result.data or []):
            addr = row["token_address"]
            if addr in existing:
                continue

            token_info = token_names.get(addr, {"symbol": "?", "name": ""})
            alerts.append({
                "type": "honeypot",
                "severity": "critical",
                "token_address": addr,
                "token_symbol": token_info["symbol"],
                "token_name": token_info["name"],
                "score": row.get("score", 0),
                "grade": row.get("grade", "F"),
                "timestamp": row.get("analyzed_at", ""),
            })

        logger.info(f"  Found {len(alerts)} new honeypot alerts")
    except Exception as e:
        logger.warning(f"Honeypot alert check error: {str(e)[:100]}")

    return alerts


def check_suspicious_mints(since_minutes: int = 1440) -> list[dict]:
    """
    Detect suspicious mint events: large token mints (from 0x0 address).
    Targets tokens with mintable contracts. Default window: 24h (1440 min).
    """
    alerts = []

    try:
        from db import supabase

        # Target tokens with mintable contracts (has_mint column in token_safety_scores)
        # Priority: mintable + owner NOT renounced = highest risk
        result_active = supabase.table("token_safety_scores").select(
            "token_address"
        ).eq("has_mint", True).eq("ownership_renounced", False).limit(100).execute()

        result_mintable = supabase.table("token_safety_scores").select(
            "token_address"
        ).eq("has_mint", True).limit(100).execute()

        # Build priority list: active owner first, then all mintable
        token_addresses = []
        seen = set()
        for r in (result_active.data or []):
            token_addresses.append(r["token_address"])
            seen.add(r["token_address"])
        for r in (result_mintable.data or []):
            if r["token_address"] not in seen:
                token_addresses.append(r["token_address"])
                seen.add(r["token_address"])

        # Check existing mint alerts to avoid duplicates
        existing_mints = set()
        try:
            day_ago = (datetime.now(timezone.utc) - __import__('datetime').timedelta(days=1)).isoformat()
            ex_rows = supabase.table("scam_radar_alerts").select(
                "token_address"
            ).eq("alert_type", "mint_event").gte("created_at", day_ago).execute()
            existing_mints = {r["token_address"] for r in (ex_rows.data or [])}
        except Exception:
            pass

        logger.info(f"  Checking {len(token_addresses)} mintable tokens for suspicious mints...")

        for addr in token_addresses[:40]:
            if addr in existing_mints:
                continue
            try:
                # Query Scan API for recent transfers FROM 0x0 (= mints)
                resp = requests.get(
                    f"{SCAN_API_URL}/api/v2/tokens/{addr}/transfers",
                    params={"limit": 50},
                    timeout=10
                )
                if resp.status_code != 200:
                    continue

                data = resp.json()

                # Get total supply
                token_resp = requests.get(f"{SCAN_API_URL}/api/v2/tokens/{addr}", timeout=10)
                if token_resp.status_code != 200:
                    continue
                token_data = token_resp.json()
                total_supply_str = token_data.get("total_supply", "0")
                decimals = int(token_data.get("decimals", "18") or "18")
                total_supply = int(total_supply_str) / (10 ** decimals) if total_supply_str else 0
                token_symbol = token_data.get("symbol", "?")
                token_name = token_data.get("name", "")

                if total_supply <= 0:
                    continue

                since_ts = int(time.time()) - (since_minutes * 60)

                for tx in data.get("items", []):
                    # Check if this is a mint (from = 0x0000...0000)
                    from_addr = tx.get("from", {}).get("hash", "").lower()
                    if from_addr != "0x0000000000000000000000000000000000000000":
                        continue

                    # Check timestamp
                    tx_ts = tx.get("timestamp", "")
                    if tx_ts:
                        try:
                            from datetime import datetime as _dt
                            tx_time = _dt.fromisoformat(tx_ts.replace("Z", "+00:00"))
                            if tx_time.timestamp() < since_ts:
                                continue
                        except Exception:
                            pass

                    # Check value
                    value_str = tx.get("total", {}).get("value", "0")
                    value = int(value_str) / (10 ** decimals) if value_str else 0
                    pct_of_supply = (value / total_supply) * 100

                    if pct_of_supply >= MINT_EVENT_SUPPLY_PCT:
                        to_addr = tx.get("to", {}).get("hash", "").lower()

                        if pct_of_supply >= 10:
                            severity = "critical"
                        elif pct_of_supply >= 5:
                            severity = "high"
                        else:
                            severity = "medium"

                        alerts.append({
                            "type": "mint_event",
                            "severity": severity,
                            "token_address": addr,
                            "token_symbol": token_symbol,
                            "token_name": token_name,
                            "to": to_addr,
                            "value": value,
                            "pct_of_supply": round(pct_of_supply, 2),
                            "timestamp": tx_ts,
                            "tx_hash": tx.get("tx_hash", ""),
                        })

                time.sleep(0.5)  # Rate limit
            except Exception as e:
                logger.warning(f"  Mint check error for {addr[:10]}: {str(e)[:80]}")

    except Exception as e:
        logger.warning(f"Suspicious mints check error: {str(e)[:100]}")

    logger.info(f"  Found {len(alerts)} suspicious mint alerts")
    return alerts


# Tokens PulseChain connus pour des mints problematiques
KNOWN_DANGEROUS_TOKENS = [
    "0xcc78a0acdf847a2c1714d2a925bb4477df5d48a6",  # ATROPA
    "0x6b175474e89094c44da98b954eedeac495271d0f",  # pDAI (fork MakerDAO)
    "0xefD766cCb38EaF1dfd701853BFCe31359239F305",  # pDAI (Atropa ecosystem)
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",  # pUSDC
    "0xdac17f958d2ee523a2206206994597c13d831ec7",  # pUSDT
]


def scan_historical_mints(max_tokens: int = 200) -> list[dict]:
    """
    Scan complet des mints historiques sur PulseChain.
    Pas de limite de temps — capture TOUS les mints significatifs.
    Inclut les tokens connus dangereux + tous les mintables de la DB.
    """
    alerts = []

    try:
        from db import supabase

        # 1. Tokens avec mint actif (owner non renonce = risque max)
        result_active = supabase.table("token_safety_scores").select(
            "token_address, has_mint, ownership_renounced"
        ).eq("has_mint", True).limit(max_tokens).execute()

        token_addresses = []
        seen = set()

        # Tokens connus dangereux en priorite
        for addr in KNOWN_DANGEROUS_TOKENS:
            addr = addr.lower()
            if addr not in seen:
                token_addresses.append(addr)
                seen.add(addr)

        # Puis les mintables non renonces (risque max)
        for r in (result_active.data or []):
            addr = r["token_address"].lower()
            if addr not in seen:
                if not r.get("ownership_renounced", True):
                    token_addresses.insert(len(KNOWN_DANGEROUS_TOKENS), addr)
                else:
                    token_addresses.append(addr)
                seen.add(addr)

        # Dedup avec alertes existantes
        existing_mints = set()
        try:
            ex_rows = supabase.table("scam_radar_alerts").select(
                "data"
            ).eq("alert_type", "mint_event").execute()
            for r in (ex_rows.data or []):
                d = r.get("data")
                if isinstance(d, str):
                    d = json.loads(d)
                if isinstance(d, dict) and d.get("tx_hash"):
                    existing_mints.add(d["tx_hash"])
        except Exception:
            pass

        logger.info(f"[MINT HISTORY] Scanning {len(token_addresses)} tokens ({len(KNOWN_DANGEROUS_TOKENS)} known dangerous)...")

        for idx, addr in enumerate(token_addresses[:max_tokens]):
            try:
                # Recuperer les infos du token
                token_resp = requests.get(f"{SCAN_API_URL}/api/v2/tokens/{addr}", timeout=10)
                if token_resp.status_code != 200:
                    continue
                token_data = token_resp.json()
                total_supply_str = token_data.get("total_supply", "0")
                decimals = int(token_data.get("decimals", "18") or "18")
                total_supply = int(total_supply_str) / (10 ** decimals) if total_supply_str else 0
                token_symbol = token_data.get("symbol", "?")
                token_name = token_data.get("name", "")

                if total_supply <= 0:
                    continue

                # Paginer les transfers pour recuperer TOUS les mints
                next_params = {"limit": 50}
                pages = 0
                token_alerts = 0

                while pages < 10:  # Max 10 pages = 500 transfers par token
                    resp = requests.get(
                        f"{SCAN_API_URL}/api/v2/tokens/{addr}/transfers",
                        params=next_params,
                        timeout=15
                    )
                    if resp.status_code != 200:
                        break

                    data = resp.json()
                    items = data.get("items", [])
                    if not items:
                        break

                    for tx in items:
                        from_addr = tx.get("from", {}).get("hash", "").lower()
                        if from_addr != "0x0000000000000000000000000000000000000000":
                            continue

                        tx_hash = tx.get("tx_hash", "")
                        if tx_hash in existing_mints:
                            continue

                        value_str = tx.get("total", {}).get("value", "0")
                        value = int(value_str) / (10 ** decimals) if value_str else 0
                        pct_of_supply = (value / total_supply) * 100 if total_supply > 0 else 0

                        if pct_of_supply >= MINT_EVENT_SUPPLY_PCT:
                            to_addr = tx.get("to", {}).get("hash", "").lower()
                            tx_ts = tx.get("timestamp", "")

                            if pct_of_supply >= 10:
                                severity = "critical"
                            elif pct_of_supply >= 5:
                                severity = "high"
                            else:
                                severity = "medium"

                            alerts.append({
                                "type": "mint_event",
                                "severity": severity,
                                "token_address": addr,
                                "token_symbol": token_symbol,
                                "token_name": token_name,
                                "to": to_addr,
                                "value": value,
                                "pct_of_supply": round(pct_of_supply, 2),
                                "timestamp": tx_ts,
                                "tx_hash": tx_hash,
                            })
                            existing_mints.add(tx_hash)
                            token_alerts += 1

                    # Pagination Blockscout
                    next_page = data.get("next_page_params")
                    if not next_page:
                        break
                    next_params = {**next_page, "limit": 50}
                    pages += 1

                if token_alerts > 0:
                    logger.info(f"  [{idx+1}/{len(token_addresses)}] {token_symbol}: {token_alerts} suspicious mints found")

                time.sleep(0.3)  # Rate limit

            except Exception as e:
                logger.warning(f"  Mint history error for {addr[:12]}: {str(e)[:80]}")

    except Exception as e:
        logger.error(f"[MINT HISTORY] Fatal error: {str(e)[:200]}")

    logger.info(f"[MINT HISTORY] Total: {len(alerts)} suspicious mints across all tokens")
    return alerts


def check_flagged_activity(since_minutes: int = 60) -> list[dict]:
    """
    Monitor activity from known HIGH-risk addresses (known_addresses table).
    Generates alerts when flagged wallets (dumpers, manipulators) make large transfers.
    """
    alerts = []

    try:
        from db import supabase

        # Only check PulseChain-relevant sources (intelligence_study, ofac)
        # NOT the 10K+ Ethereum phishing addresses (forta_etherscan, eth_labels)
        # which would cause thousands of Blockscout API calls and block the server
        result = supabase.table("known_addresses").select(
            "address, label, risk_level, category"
        ).in_("risk_level", ["HIGH"]).in_(
            "source", ["intelligence_study", "ofac", "scamsniffer"]
        ).limit(50).execute()

        flagged = result.data or []
        if not flagged:
            logger.info("  No PulseChain-relevant HIGH risk addresses")
            return alerts

        logger.info(f"  Monitoring {len(flagged)} PulseChain-relevant flagged addresses...")

        # Check existing alerts to avoid duplicates (1 per address per day)
        existing = set()
        try:
            day_ago = (datetime.now(timezone.utc) - __import__('datetime').timedelta(days=1)).isoformat()
            ex_rows = supabase.table("scam_radar_alerts").select(
                "data"
            ).eq("alert_type", "flagged_activity").gte("created_at", day_ago).execute()
            for r in (ex_rows.data or []):
                d = r.get("data")
                if isinstance(d, str):
                    d = json.loads(d)
                if isinstance(d, dict):
                    existing.add(d.get("flagged_address", ""))
        except Exception:
            pass

        since_ts = datetime.now(timezone.utc) - __import__('datetime').timedelta(minutes=since_minutes)

        for entry in flagged:
            addr = entry["address"].lower()
            if addr in existing:
                continue

            try:
                # Check recent transactions from this address
                resp = requests.get(
                    f"{SCAN_API_URL}/api/v2/addresses/{addr}/transactions",
                    params={"limit": 10},
                    timeout=10
                )
                if resp.status_code != 200:
                    continue

                data = resp.json()
                recent_txs = []

                for tx in data.get("items", []):
                    tx_ts = tx.get("timestamp", "")
                    if tx_ts:
                        try:
                            tx_time = datetime.fromisoformat(tx_ts.replace("Z", "+00:00"))
                            if tx_time >= since_ts:
                                recent_txs.append(tx)
                        except Exception:
                            pass

                if recent_txs:
                    # Also check token transfers
                    transfer_resp = requests.get(
                        f"{SCAN_API_URL}/api/v2/addresses/{addr}/token-transfers",
                        params={"limit": 20},
                        timeout=10
                    )
                    transfer_count = 0
                    transfer_tokens = set()
                    if transfer_resp.status_code == 200:
                        for tr in transfer_resp.json().get("items", []):
                            tr_ts = tr.get("timestamp", "")
                            if tr_ts:
                                try:
                                    tr_time = datetime.fromisoformat(tr_ts.replace("Z", "+00:00"))
                                    if tr_time >= since_ts:
                                        transfer_count += 1
                                        token = tr.get("token", {})
                                        sym = token.get("symbol", "?")
                                        transfer_tokens.add(sym)
                                except Exception:
                                    pass

                    severity = "critical" if entry["category"] in ("dumper", "manipulator", "exploit") else "high"

                    alerts.append({
                        "type": "flagged_activity",
                        "severity": severity,
                        "flagged_address": addr,
                        "label": entry["label"],
                        "category": entry.get("category", "unknown"),
                        "risk_level": entry["risk_level"],
                        "tx_count": len(recent_txs),
                        "transfer_count": transfer_count,
                        "tokens_involved": list(transfer_tokens)[:10],
                        "timestamp": recent_txs[0].get("timestamp", ""),
                    })

                time.sleep(0.5)
            except Exception as e:
                logger.warning(f"  Flagged activity check error for {addr[:12]}: {str(e)[:80]}")

    except Exception as e:
        logger.warning(f"Flagged activity check error: {str(e)[:100]}")

    logger.info(f"  Found {len(alerts)} flagged activity alerts")
    return alerts


def run_scan(since_minutes: int = 30) -> list[dict]:
    """
    Run a full scam radar scan.
    Returns all alerts found.
    """
    since_ts = int(time.time()) - (since_minutes * 60)
    all_alerts = []

    # 1. Check LP removals
    logger.info(f"Checking LP removals since {since_minutes}m ago...")
    lp_alerts = check_lp_removals(since_ts)
    all_alerts.extend(lp_alerts)
    logger.info(f"  Found {len(lp_alerts)} LP removal alerts")

    # 2. Check honeypots (from recent safety analysis)
    logger.info("Checking for new honeypot detections...")
    hp_alerts = check_honeypots()
    all_alerts.extend(hp_alerts)

    # 3. Check flagged address activity (known dumpers, manipulators)
    logger.info("Checking flagged address activity...")
    flagged_alerts = check_flagged_activity(since_minutes=max(since_minutes, 120))
    all_alerts.extend(flagged_alerts)

    # 4. Check suspicious mints (24h window — mints are rarer events)
    mint_window = max(since_minutes, 1440)  # At least 24h
    logger.info(f"Checking suspicious mints since {mint_window}m ago...")
    mint_alerts = check_suspicious_mints(mint_window)
    all_alerts.extend(mint_alerts)

    # 4. Check whale dumps on tokens with recent LP alerts
    token_addresses_seen = set()
    for alert in lp_alerts:
        for addr_key in ("token0_address", "token1_address"):
            addr = alert.get(addr_key, "")
            if addr and addr not in token_addresses_seen:
                token_addresses_seen.add(addr)

    # Fetch token prices for USD conversion
    token_prices = {}
    try:
        from db import supabase
        price_rows = supabase.table("token_prices").select("id, price_usd").execute()
        for p in (price_rows.data or []):
            token_prices[p["id"].lower()] = float(p.get("price_usd", 0) or 0)
    except Exception:
        pass

    for addr in list(token_addresses_seen)[:20]:
        try:
            # Get total supply from Scan API
            resp = requests.get(f"{SCAN_API_URL}/api/v2/tokens/{addr}", timeout=10)
            if resp.status_code != 200:
                continue
            token_data = resp.json()
            total_supply_str = token_data.get("total_supply", "0")
            decimals = int(token_data.get("decimals", "18") or "18")
            total_supply = int(total_supply_str) / (10 ** decimals) if total_supply_str else 0
            token_price = token_prices.get(addr.lower(), 0)

            if total_supply > 0:
                logger.info(f"  Checking whale dumps for {addr[:10]}...")
                dump_alerts = check_large_transfers(addr, total_supply, token_price=token_price)
                all_alerts.extend(dump_alerts)
                if dump_alerts:
                    logger.info(f"    Found {len(dump_alerts)} whale dump alerts")

            time.sleep(0.5)  # Rate limit
        except Exception as e:
            logger.warning(f"  Whale dump check error for {addr[:10]}: {str(e)[:80]}")

    return all_alerts


def save_alerts(alerts: list[dict], supabase_client) -> int:
    """Save alerts to Supabase."""
    saved = 0
    for alert in alerts:
        try:
            row = {
                "alert_type": alert["type"],
                "severity": alert["severity"],
                "data": json.dumps(alert),
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            # Add token-specific fields
            # For LP removal alerts: attribute to the NON-core token in the pair.
            # If WPLS/SHITCOIN pair is rugged, the alert goes to SHITCOIN, not WPLS.
            if alert.get("type") == "lp_removal" and alert.get("token0_address") and alert.get("token1_address"):
                t0 = alert["token0_address"].lower()
                t1 = alert["token1_address"].lower()
                t0_is_core = t0 in CORE_TOKEN_ADDRESSES
                t1_is_core = t1 in CORE_TOKEN_ADDRESSES
                if t0_is_core and not t1_is_core:
                    row["token_address"] = t1  # Attribute to non-core token
                elif t1_is_core and not t0_is_core:
                    row["token_address"] = t0  # Attribute to non-core token
                else:
                    row["token_address"] = t0  # Both core or both non-core: default token0
            elif alert.get("token0_address"):
                row["token_address"] = alert["token0_address"]
            elif alert.get("token_address"):
                row["token_address"] = alert["token_address"]

            if alert.get("pair_address"):
                row["pair_address"] = alert["pair_address"]

            # Honeypot alerts don't have tx_id — always use insert
            if alert["type"] == "honeypot":
                supabase_client.table("scam_radar_alerts").insert(row).execute()
            else:
                supabase_client.table("scam_radar_alerts").upsert(
                    row, on_conflict="alert_type,data->>'tx_id'"
                ).execute()
            saved += 1
        except Exception as e:
            # Use insert as fallback (upsert might fail on jsonb conflict)
            try:
                supabase_client.table("scam_radar_alerts").insert(row).execute()
                saved += 1
            except Exception as e2:
                logger.warning(f"Failed to save alert: {str(e2)[:100]}")

    return saved
