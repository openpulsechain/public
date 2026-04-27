"""
Smart Money Feed — Track profitable wallets on PulseChain.

Strategy:
1. From whale_tracker data, identify wallets with positive PNL
2. From DexScreener Top Traders (per-pair), aggregate cross-pair performance
3. Track their recent buys/sells as "smart money signals"

Data sources:
- PulseChain Scan API: wallet transactions, token transfers
- PulseX Subgraph: swap events with USD values
- Existing whale_clustering data in Supabase
"""
from __future__ import annotations

import logging
import time
import requests
from datetime import datetime, timezone
from config import (
    SCAN_API_URL, PULSEX_V1_SUBGRAPH, PULSEX_V2_SUBGRAPH, RPC_URL,
    PULSEX_V1_ROUTER, PULSEX_V2_ROUTER,
)

logger = logging.getLogger(__name__)

# Contracts that appear as "wallets" in swap events but are infrastructure
EXCLUDED_WALLETS = {
    PULSEX_V1_ROUTER.lower(),
    PULSEX_V2_ROUTER.lower(),
    "0x0000000000000000000000000000000000000000",
    "0x000000000000000000000000000000000000dead",
    "0x1715a3e4a142d8b698131108995174f37aeba10d",  # OmniBridge ETH
    "0xbeb6a26ffa386bfc03368e8243193c56db062577",  # OmniBridge PLS
}


def _query_subgraph(url: str, query: str, variables: dict = None) -> dict:
    try:
        resp = requests.post(url, json={"query": query, "variables": variables or {}}, timeout=15)
        resp.raise_for_status()
        return resp.json().get("data", {})
    except Exception as e:
        logger.warning(f"Subgraph error: {str(e)[:100]}")
        return {}


def get_recent_large_swaps(since_minutes: int = 60, min_usd: float = 1000) -> list:
    """
    Get recent large swaps from PulseX V1+V2.
    Returns list of swap events with wallet, token, amount, direction.
    """
    since_ts = str(int(time.time()) - since_minutes * 60)
    swaps = []

    swap_query = """
    query($timestamp: String!) {
        swaps(where: {timestamp_gt: $timestamp, amountUSD_gt: "1000"},
              orderBy: amountUSD, orderDirection: desc, first: 100) {
            id
            timestamp
            pair {
                id
                token0 { id symbol }
                token1 { id symbol }
            }
            amount0In
            amount0Out
            amount1In
            amount1Out
            amountUSD
            sender
            to
        }
    }
    """

    for dex_name, url in [("V2", PULSEX_V2_SUBGRAPH), ("V1", PULSEX_V1_SUBGRAPH)]:
        data = _query_subgraph(url, swap_query, {"timestamp": since_ts})
        for swap in data.get("swaps", []):
            amount_usd = float(swap.get("amountUSD", 0) or 0)
            if amount_usd > 1_000_000_000:  # Filter inflated values
                continue
            if amount_usd < min_usd:
                continue

            pair = swap.get("pair", {})
            token0 = pair.get("token0", {})
            token1 = pair.get("token1", {})

            # Determine direction: which token was bought
            a0_in = float(swap.get("amount0In", 0) or 0)
            a1_in = float(swap.get("amount1In", 0) or 0)

            if a0_in > 0:
                # Token0 was sold, Token1 was bought
                bought_token = token1
                sold_token = token0
            else:
                bought_token = token0
                sold_token = token1

            wallet = swap.get("sender", "") or swap.get("to", "")
            # Skip router/bridge contracts masquerading as wallets
            if wallet.lower() in EXCLUDED_WALLETS:
                continue

            swaps.append({
                "dex": f"PulseX_{dex_name}",
                "pair_address": pair.get("id", ""),
                "bought_symbol": bought_token.get("symbol", "?"),
                "bought_address": bought_token.get("id", ""),
                "sold_symbol": sold_token.get("symbol", "?"),
                "sold_address": sold_token.get("id", ""),
                "amount_usd": round(amount_usd, 2),
                "wallet": wallet,
                "timestamp": int(swap.get("timestamp", 0)),
                "tx_id": swap.get("id", ""),
            })

    # Deduplicate multi-hop swaps: keep only the highest-value leg per transaction
    # Multi-hop swaps (e.g. WPLS→DAI→WETH) produce multiple entries with same base tx_id
    # but different suffixes (-0, -1, -2). Without dedup, volume is inflated 40-60%.
    seen_tx: dict = {}  # base_tx_id -> best swap entry
    for swap in swaps:
        tx_id = swap["tx_id"]
        # Strip the subgraph swap index suffix (e.g., "0xabc...-0" → "0xabc...")
        base_tx = tx_id.rsplit("-", 1)[0] if "-" in tx_id else tx_id
        if base_tx not in seen_tx or swap["amount_usd"] > seen_tx[base_tx]["amount_usd"]:
            seen_tx[base_tx] = swap

    deduped = list(seen_tx.values())
    deduped.sort(key=lambda x: x["amount_usd"], reverse=True)
    return deduped


def get_wallet_swap_history(wallet_address: str, limit: int = 50) -> list:
    """
    Get recent swap history for a specific wallet from PulseX.
    """
    addr = wallet_address.lower()
    swaps = []

    swap_query = """
    query($wallet: String!) {
        swaps(where: {sender: $wallet}, orderBy: timestamp, orderDirection: desc, first: 50) {
            id
            timestamp
            pair {
                id
                token0 { id symbol }
                token1 { id symbol }
            }
            amount0In
            amount0Out
            amount1In
            amount1Out
            amountUSD
        }
    }
    """

    for dex_name, url in [("V2", PULSEX_V2_SUBGRAPH), ("V1", PULSEX_V1_SUBGRAPH)]:
        data = _query_subgraph(url, swap_query, {"wallet": addr})
        for swap in data.get("swaps", []):
            amount_usd = float(swap.get("amountUSD", 0) or 0)
            if amount_usd > 1_000_000_000:
                continue

            pair = swap.get("pair", {})
            token0 = pair.get("token0", {})
            token1 = pair.get("token1", {})

            a0_in = float(swap.get("amount0In", 0) or 0)
            if a0_in > 0:
                bought_token = token1
                sold_token = token0
            else:
                bought_token = token0
                sold_token = token1

            swaps.append({
                "dex": f"PulseX_{dex_name}",
                "bought_symbol": bought_token.get("symbol", "?"),
                "bought_address": bought_token.get("id", ""),
                "sold_symbol": sold_token.get("symbol", "?"),
                "sold_address": sold_token.get("id", ""),
                "amount_usd": round(amount_usd, 2),
                "timestamp": int(swap.get("timestamp", 0)),
            })

    swaps.sort(key=lambda x: x["timestamp"], reverse=True)
    return swaps[:limit]


def get_wallet_token_balances(wallet_address: str) -> list:
    """
    Get current token balances for a wallet via Scan API + RPC for native PLS.
    """
    addr = wallet_address.lower()
    balances = []

    # 1. Fetch native PLS balance via RPC eth_getBalance
    try:
        rpc_resp = requests.post(
            RPC_URL,
            json={"jsonrpc": "2.0", "method": "eth_getBalance", "params": [addr, "latest"], "id": 1},
            timeout=10
        )
        if rpc_resp.status_code == 200:
            rpc_data = rpc_resp.json()
            hex_balance = rpc_data.get("result", "0x0")
            pls_balance = int(hex_balance, 16) / 1e18
            if pls_balance > 0:
                balances.append({
                    "token_address": "0x0000000000000000000000000000000000000000",
                    "symbol": "PLS",
                    "name": "PulseChain",
                    "balance": pls_balance,
                    "token_type": "native",
                })
    except Exception as e:
        logger.warning(f"PLS native balance error for {addr}: {str(e)[:100]}")

    # 2. Fetch ERC-20 token balances via Scan API
    try:
        resp = requests.get(
            f"{SCAN_API_URL}/api/v2/addresses/{addr}/token-balances",
            timeout=15
        )
        if resp.status_code != 200:
            return balances

        data = resp.json()
        for item in data:
            token = item.get("token", {})
            value_str = item.get("value", "0")
            decimals = int(token.get("decimals", "18") or "18")
            value = int(value_str) / (10 ** decimals) if value_str else 0

            if value > 0:
                balances.append({
                    "token_address": token.get("address", "").lower(),
                    "symbol": token.get("symbol", "?"),
                    "name": token.get("name", "?"),
                    "balance": value,
                    "token_type": token.get("type", "ERC-20"),
                })

        return balances

    except Exception as e:
        logger.warning(f"Balance fetch error for {addr}: {str(e)[:100]}")
        return []


def build_smart_money_feed(since_hours: int = 24, min_usd: float = 5000) -> dict:
    """
    Build a smart money feed:
    1. Get large swaps in the last N hours
    2. Group by wallet
    3. Rank wallets by total volume
    4. Return top wallets + their recent activity
    """
    swaps = get_recent_large_swaps(since_minutes=since_hours * 60, min_usd=min_usd)

    # Group by wallet
    wallet_activity: dict = {}
    for swap in swaps:
        wallet = swap["wallet"]
        if not wallet:
            continue
        # Skip known contracts (routers, bridges, burn addresses)
        if wallet.lower() in EXCLUDED_WALLETS:
            continue
        if wallet not in wallet_activity:
            wallet_activity[wallet] = {
                "wallet": wallet,
                "total_volume_usd": 0,
                "swap_count": 0,
                "tokens_bought": {},
                "tokens_sold": {},
                "swaps": [],
            }

        wa = wallet_activity[wallet]
        wa["total_volume_usd"] += swap["amount_usd"]
        wa["swap_count"] += 1
        wa["swaps"].append(swap)

        bought = swap["bought_symbol"]
        sold = swap["sold_symbol"]
        wa["tokens_bought"][bought] = wa["tokens_bought"].get(bought, 0) + swap["amount_usd"]
        wa["tokens_sold"][sold] = wa["tokens_sold"].get(sold, 0) + swap["amount_usd"]

    # Rank by volume
    ranked = sorted(wallet_activity.values(), key=lambda x: x["total_volume_usd"], reverse=True)

    # Simplify for response
    top_wallets = []
    for w in ranked[:20]:
        top_wallets.append({
            "wallet": w["wallet"],
            "total_volume_usd": round(w["total_volume_usd"], 2),
            "swap_count": w["swap_count"],
            "top_buys": sorted(w["tokens_bought"].items(), key=lambda x: x[1], reverse=True)[:5],
            "top_sells": sorted(w["tokens_sold"].items(), key=lambda x: x[1], reverse=True)[:5],
            "recent_swaps": w["swaps"][:5],
        })

    return {
        "period_hours": since_hours,
        "min_usd": min_usd,
        "total_swaps": len(swaps),
        "unique_wallets": len(wallet_activity),
        "top_wallets": top_wallets,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
