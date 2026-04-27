"""Whale tracker indexer — finds top holders of major PulseChain tokens.

Uses PulseChain Scan API (Blockscout v2) to fetch top holders per token,
then cross-references addresses across tokens to identify whales.

Phase 1: Top holders per token
Phase 2: Address clustering (common addresses across tokens)
"""

import logging
import time
from datetime import datetime, timezone

import requests

from db import supabase

logger = logging.getLogger(__name__)

SCAN_API = "https://api.scan.pulsechain.com/api/v2"

# Top PulseChain-native tokens to track (address → symbol, decimals)
# Only tokens with real volume on PulseX
TRACKED_TOKENS = {
    "0xa1077a294dde1b09bb078844df40758a5d0f9a27": ("WPLS", 18),
    "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39": ("HEX", 8),
    "0x95b303987a60c71504d99aa1b13b4da07b0790ab": ("PLSX", 18),
    "0x2fa878ab3f87cc1c9737fc071108f904c0b0c95d": ("INC", 18),
    "0xefd766ccb38eaf1dfd701853bfce31359239f305": ("DAI", 18),
    "0x15d38573d2feeb82e7ad5187ab8c1d52810b1f07": ("USDC", 6),
    "0x02dcdd04e3f455d838cd1249292c58f3b79e3c3c": ("WETH", 18),
    "0x0cb6f5a34ad42ec934882a05265a7d5f59b51a2f": ("USDT", 6),
}

# Known infrastructure addresses to exclude (not real whales)
EXCLUDED_ADDRESSES = {
    "0x0000000000000000000000000000000000000000",
    "0x000000000000000000000000000000000000dead",
    # PulseX Router v1/v2
    "0x98bf93ebf5c380c0e6ae8e192a7e2ae08edacc3a",
    "0x165c3410fc91f0b75b2ab5093d7226e3929e0bff",
}

TOP_HOLDERS_PER_TOKEN = 50


def _fetch_holders(token_address, limit=TOP_HOLDERS_PER_TOKEN):
    """Fetch top holders for a token from PulseChain Scan API v2."""
    url = f"{SCAN_API}/tokens/{token_address}/holders"
    holders = []
    params = {"limit": min(limit, 50)}

    try:
        resp = requests.get(url, params=params, timeout=15)
        if resp.status_code == 404:
            logger.warning(f"Token {token_address} not found on Scan API")
            return []
        resp.raise_for_status()
        data = resp.json()
        items = data.get("items", [])

        for item in items:
            addr_data = item.get("address", {})
            addr = addr_data.get("hash", "").lower()
            if addr in EXCLUDED_ADDRESSES:
                continue
            holders.append({
                "address": addr,
                "is_contract": addr_data.get("is_contract", False),
                "balance_raw": item.get("value", "0"),
            })
    except Exception as e:
        logger.error(f"Failed to fetch holders for {token_address}: {e}")

    return holders


def _get_prices():
    """Get current token prices keyed by token address (PulseChain-native prices)."""
    result = supabase.table("token_prices") \
        .select("symbol, price_usd, source, address") \
        .not_.is_("price_usd", "null") \
        .gt("price_usd", 0) \
        .execute()

    # Build address-based price map for tracked tokens
    addr_prices = {}
    symbol_prices = {}
    for row in (result.data or []):
        sym = row["symbol"].upper()
        addr = (row.get("address") or "").lower()
        price = row["price_usd"]

        # If we have address, map it directly
        if addr and addr in TRACKED_TOKENS:
            addr_prices[addr] = price

        # Also keep symbol-based as fallback (prefer CoinGecko for majors)
        if sym not in symbol_prices or row.get("source") == "coingecko":
            symbol_prices[sym] = price

    return addr_prices, symbol_prices


def _set_status(status, error=None):
    supabase.table("sync_status").update({
        "status": status,
        "error_message": error,
        "last_synced_at": datetime.now(timezone.utc).isoformat(),
    }).eq("indexer_name", "whale_tracker").execute()


def run():
    """Fetch top holders for tracked tokens and store."""
    logger.info("Starting whale tracker...")
    _set_status("running")

    try:
        addr_prices, symbol_prices = _get_prices()
        logger.info(f"Loaded {len(addr_prices)} address prices, {len(symbol_prices)} symbol prices")

        now = datetime.now(timezone.utc).isoformat()
        all_holdings = []
        # Track unique whale addresses and their total value
        whale_totals = {}  # address -> {total_usd, tokens: [{symbol, balance, usd}], is_contract}

        for token_addr, (symbol, decimals) in TRACKED_TOKENS.items():
            holders = _fetch_holders(token_addr)
            # Prefer address-specific price (avoids ETH WBTC price for PLS WBTC)
            price = addr_prices.get(token_addr, symbol_prices.get(symbol.upper(), 0))

            logger.info(f"  {symbol}: {len(holders)} holders, price=${price:.6f}")

            for rank, h in enumerate(holders, 1):
                balance = int(h["balance_raw"]) / (10 ** decimals)
                balance_usd = balance * price

                all_holdings.append({
                    "address": h["address"],
                    "token_address": token_addr,
                    "token_symbol": symbol,
                    "balance": balance,
                    "balance_usd": balance_usd,
                    "rank": rank,
                    "is_contract": h["is_contract"],
                    "updated_at": now,
                })

                # Aggregate per whale
                if h["address"] not in whale_totals:
                    whale_totals[h["address"]] = {
                        "total_usd": 0,
                        "tokens": [],
                        "is_contract": h["is_contract"],
                    }
                whale_totals[h["address"]]["total_usd"] += balance_usd
                whale_totals[h["address"]]["tokens"].append({
                    "symbol": symbol,
                    "balance": balance,
                    "usd": balance_usd,
                })

            # Rate limit courtesy
            time.sleep(0.5)

        # Store holdings
        logger.info(f"Storing {len(all_holdings)} holdings across {len(whale_totals)} unique addresses")

        # Clear old data
        supabase.table("whale_holdings").delete().neq("address", "").execute()

        # Batch insert holdings (max 500 per upsert)
        batch_size = 500
        for i in range(0, len(all_holdings), batch_size):
            batch = all_holdings[i:i + batch_size]
            supabase.table("whale_holdings").insert(batch).execute()

        # Build whale summary (addresses holding multiple tracked tokens)
        whale_rows = []
        for addr, data in whale_totals.items():
            token_count = len(data["tokens"])
            top_tokens = sorted(data["tokens"], key=lambda x: x["usd"], reverse=True)[:5]
            top_symbols = ", ".join(t["symbol"] for t in top_tokens)

            whale_rows.append({
                "address": addr,
                "total_usd": data["total_usd"],
                "token_count": token_count,
                "top_tokens": top_symbols,
                "is_contract": data["is_contract"],
                "updated_at": now,
            })

        # Sort by total USD descending
        whale_rows.sort(key=lambda x: x["total_usd"], reverse=True)

        # Clear and insert whale summary
        supabase.table("whale_addresses").delete().neq("address", "").execute()

        for i in range(0, len(whale_rows), batch_size):
            batch = whale_rows[i:i + batch_size]
            supabase.table("whale_addresses").insert(batch).execute()

        # Find cross-token whales (addresses in 2+ token top lists)
        cross_token_whales = [w for w in whale_rows if w["token_count"] >= 2]
        logger.info(f"Found {len(cross_token_whales)} cross-token whales (2+ tokens)")

        top5 = whale_rows[:5]
        for w in top5:
            logger.info(f"  Top whale: {w['address'][:10]}... ${w['total_usd']:,.0f} ({w['top_tokens']})")

        logger.info(f"Whale tracker complete: {len(whale_rows)} whales, {len(all_holdings)} holdings")
        _set_status("idle")

    except Exception as e:
        logger.error(f"Whale tracker failed: {e}")
        _set_status("error", str(e)[:500])
        raise
