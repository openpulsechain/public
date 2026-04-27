"""Bridge TVL indexer — reads OmniBridge contract balances on Ethereum.

Computes real Bridge TVL by calling balanceOf(OmniBridge) for each bridged
ERC20 token on Ethereum mainnet, then multiplying by current price.

This is the only accurate way to compute TVL — transfer sums don't work because:
- Historical USD amounts inflate due to price changes (ETH was $3-4K in 2023)
- Raw amount_raw has decimal encoding inconsistencies across subgraphs
"""

import logging
import json
from datetime import datetime, timezone

import requests

from db import supabase

logger = logging.getLogger(__name__)

# OmniBridge Proxy on Ethereum mainnet
OMNIBRIDGE_ETH = "0x1715a3e4a142d8b698131108995174f37aeba10d"

# Free Ethereum RPC endpoints (fallback chain)
ETH_RPCS = [
    "https://eth.llamarpc.com",
    "https://rpc.ankr.com/eth",
    "https://ethereum.publicnode.com",
]

# Canonical Ethereum token addresses (lowercase) — used to filter out fakes
# Multiple bridge_transfers records can share a symbol but only one is the real token
CANONICAL_ETH_TOKENS = {
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",  # USDC
    "0x6b175474e89094c44da98b954eedeac495271d0f",  # DAI
    "0xdac17f958d2ee523a2206206994597c13d831ec7",  # USDT
    "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",  # WETH
    "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",  # WBTC
    "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",  # HEX
}

# Max reasonable TVL per token for PulseChain bridge (filter out fake/inflated balances)
MAX_TVL_PER_TOKEN = 100_000_000  # $100M cap

# Symbols that are native assets, NOT ERC20 tokens — their prices should not
# be applied to random ERC20s sharing the same symbol
NATIVE_ASSET_SYMBOLS = {"BTC", "ETH", "SOL", "BNB", "AVAX", "MATIC", "DOT", "ADA"}

# ERC20 function selectors
BALANCE_OF_SIG = "0x70a08231"  # balanceOf(address)
DECIMALS_SIG = "0x313ce567"    # decimals()

# Pad address to 32 bytes for eth_call
def _pad_address(addr: str) -> str:
    return "0x" + addr.lower().replace("0x", "").zfill(64)


def _eth_call(rpc_url: str, to: str, data: str) -> str:
    """Make an eth_call to Ethereum mainnet."""
    payload = {
        "jsonrpc": "2.0",
        "method": "eth_call",
        "params": [{"to": to, "data": data}, "latest"],
        "id": 1,
    }
    try:
        resp = requests.post(rpc_url, json=payload, timeout=10)
        result = resp.json()
        if "error" in result:
            return None
        return result.get("result")
    except Exception:
        return None


def _eth_call_with_fallback(to: str, data: str) -> str:
    """Try multiple RPCs until one works."""
    for rpc in ETH_RPCS:
        result = _eth_call(rpc, to, data)
        if result and result != "0x":
            return result
    return None


def _get_balance(token_address: str) -> int:
    """Get balanceOf(OmniBridge) for a token on Ethereum."""
    data = BALANCE_OF_SIG + _pad_address(OMNIBRIDGE_ETH)[2:]
    result = _eth_call_with_fallback(token_address, data)
    if not result or result == "0x" or len(result) < 3:
        return None
    try:
        return int(result, 16)
    except ValueError:
        return None


def _get_decimals(token_address: str) -> int:
    """Get decimals() for a token on Ethereum."""
    result = _eth_call_with_fallback(token_address, DECIMALS_SIG)
    if not result or result == "0x" or len(result) < 3:
        return None
    try:
        return int(result, 16)
    except ValueError:
        return None


def _get_bridged_tokens() -> list:
    """Get unique token addresses from bridge_transfers (ETH side only)."""
    result = supabase.rpc("get_bridge_token_addresses", {}).execute()
    if hasattr(result, "data") and result.data:
        return result.data

    # Fallback: query directly
    result = supabase.table("bridge_transfers") \
        .select("token_address_eth, token_symbol") \
        .eq("chain_source", "ethereum") \
        .not_.is_("token_address_eth", "null") \
        .limit(1000) \
        .execute()

    if not result.data:
        return []

    # Deduplicate
    seen = {}
    for row in result.data:
        addr = row["token_address_eth"].lower()
        if addr not in seen and addr != "0x0000000000000000000000000000000000000000":
            seen[addr] = row.get("token_symbol")

    return [{"token_address": k, "token_symbol": v} for k, v in seen.items()]


def _get_prices() -> dict:
    """Get current token prices keyed by uppercase symbol."""
    result = supabase.table("token_prices") \
        .select("symbol, price_usd, source") \
        .not_.is_("price_usd", "null") \
        .gt("price_usd", 0) \
        .execute()

    prices = {}
    for row in (result.data or []):
        sym = row["symbol"].upper()
        # Prefer CoinGecko source
        if sym not in prices or row.get("source") == "coingecko":
            prices[sym] = row["price_usd"]
    return prices


def _set_status(status, error=None):
    supabase.table("sync_status").update({
        "status": status,
        "error_message": error,
        "last_synced_at": datetime.now(timezone.utc).isoformat(),
    }).eq("indexer_name", "bridge_tvl").execute()


def run():
    """Compute Bridge TVL from on-chain balances."""
    logger.info("Starting Bridge TVL computation...")
    _set_status("running")

    try:
        # 1. Get bridged token addresses
        tokens = _get_bridged_tokens()
        logger.info(f"Found {len(tokens)} bridged tokens to check")

        if not tokens:
            logger.warning("No bridged tokens found, skipping TVL")
            _set_status("idle")
            return

        # 2. Get current prices
        prices = _get_prices()
        logger.info(f"Loaded {len(prices)} token prices")

        # 3. For each token, read balance from Ethereum
        # Track per-symbol: prefer canonical addresses over unknown ones
        symbol_results = {}  # symbol -> {addr, balance, decimals, price, tvl_usd, is_canonical}

        for token in tokens:
            addr = token["token_address"]
            symbol = token.get("token_symbol") or "?"
            sym_upper = symbol.upper()
            is_canonical = addr.lower() in CANONICAL_ETH_TOKENS

            # Skip fake ERC20s using native asset names (BTC, ETH, SOL, etc.)
            if sym_upper in NATIVE_ASSET_SYMBOLS and not is_canonical:
                logger.info(f"Skipping {symbol} ({addr}): native asset symbol on non-canonical ERC20")
                continue

            # Skip non-canonical if we already have canonical for this symbol
            existing = symbol_results.get(sym_upper)
            if existing and existing["is_canonical"] and not is_canonical:
                continue

            # Get balance
            balance_raw = _get_balance(addr)
            if balance_raw is None or balance_raw == 0:
                continue

            # Get decimals
            decimals = _get_decimals(addr)
            if decimals is None:
                decimals = 18

            balance = balance_raw / (10 ** decimals)
            price = prices.get(sym_upper, 0)
            tvl_usd = balance * price

            # Skip tokens with unreasonable TVL (fake/inflated balances)
            if tvl_usd > MAX_TVL_PER_TOKEN:
                logger.warning(f"Skipping {symbol} ({addr}): TVL ${tvl_usd:,.0f} exceeds cap")
                continue

            if tvl_usd > 0:
                # Prefer canonical, or higher TVL if both non-canonical
                if not existing or is_canonical or (not existing["is_canonical"] and tvl_usd > existing["tvl_usd"]):
                    symbol_results[sym_upper] = {
                        "token_symbol": symbol,
                        "net_amount": balance,
                        "price_usd": price,
                        "tvl_usd": tvl_usd,
                        "is_canonical": is_canonical,
                    }

        tvl_rows = list(symbol_results.values())
        total_tvl = sum(r["tvl_usd"] for r in tvl_rows)

        # 5. Compute percentages and store
        now = datetime.now(timezone.utc).isoformat()

        # Clear old data
        supabase.table("bridge_tvl_tokens").delete().neq("token_symbol", "").execute()

        # Insert new data
        if tvl_rows:
            # Sort by TVL descending
            tvl_rows.sort(key=lambda x: x["tvl_usd"], reverse=True)

            upsert_rows = []
            for row in tvl_rows:
                upsert_rows.append({
                    "token_symbol": row["token_symbol"],
                    "net_amount": row["net_amount"],
                    "price_usd": row["price_usd"],
                    "tvl_usd": row["tvl_usd"],
                    "pct_of_total": (row["tvl_usd"] / total_tvl * 100) if total_tvl > 0 else 0,
                    "updated_at": now,
                })

            supabase.table("bridge_tvl_tokens").upsert(
                upsert_rows, on_conflict="token_symbol"
            ).execute()

        logger.info(f"Bridge TVL: {total_tvl:,.0f} USD across {len(tvl_rows)} tokens")
        _set_status("idle")

    except Exception as e:
        logger.error(f"Bridge TVL failed: {e}")
        _set_status("error", str(e)[:500])
        raise
