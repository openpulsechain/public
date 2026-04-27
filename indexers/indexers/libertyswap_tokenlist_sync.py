"""LibertySwap token list sync — monitors the LibertySwap cross-chain DEX tokens.

LibertySwap does NOT publish a standard tokenlist.json. This indexer maintains
a curated list of tokens supported by LibertySwap (from docs + Twitter announcements).
It ensures all tokens are in pulsechain_tokens and triggers safety scoring for new ones.

Source: https://docs.libertyswap.finance/ + https://x.com/LibertySwapFi
"""

import logging
from datetime import datetime, timezone

import requests

from db import supabase

logger = logging.getLogger(__name__)

# LibertySwap supported PulseChain tokens (manually curated — no public API)
# Last updated: 2026-03-26 from docs + Twitter @LibertySwapFi
LIBERTYSWAP_TOKENS = [
    # Core PulseChain tokens (swap + bridge endpoints)
    {"address": "0xa1077a294dde1b09bb078844df40758a5d0f9a27", "symbol": "WPLS", "name": "Wrapped Pulse", "decimals": 18},
    {"address": "0x95b303987a60c71504d99aa1b13b4da07b0790ab", "symbol": "PLSX", "name": "PulseX", "decimals": 18},
    {"address": "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39", "symbol": "HEX", "name": "HEX", "decimals": 8},
    {"address": "0x57fde0a71132198bbec939b98976993d8d89d225", "symbol": "eHEX", "name": "HEX from Ethereum", "decimals": 8},
    {"address": "0x2fa878ab3f87cc1c9737fc071108f904c0b0c95d", "symbol": "INC", "name": "Incentive", "decimals": 18},
    {"address": "0xf6f8db0aba00007681f8faf16a0fda1c9b030b11", "symbol": "PRVX", "name": "ProveX", "decimals": 18},
    # Bridged stablecoins
    {"address": "0x15d38573d2feeb82e7ad5187ab8c1d52810b1f07", "symbol": "USDC", "name": "USD Coin from Ethereum", "decimals": 6},
    {"address": "0x0cb6f5a34ad42ec934882a05265a7d5f59b51a2f", "symbol": "USDT", "name": "Tether from Ethereum", "decimals": 6},
    {"address": "0xefd766ccb38eaf1dfd701853bfce31359239f305", "symbol": "DAI", "name": "Dai from Ethereum", "decimals": 18},
    # Bridged assets
    {"address": "0x02dcdd04e3f455d838cd1249292c58f3b79e3c3c", "symbol": "WETH", "name": "WETH from Ethereum", "decimals": 18},
    {"address": "0xb17d901469b9208b17d916112988a3fed19b5ca1", "symbol": "WBTC", "name": "WBTC from Ethereum", "decimals": 8},
    # DeFi stablecoins
    {"address": "0x0deed1486bc52aa0d3e6f8849cec5add6598a162", "symbol": "USDL", "name": "USDL Stablecoin", "decimals": 18},
    {"address": "0x600136da8cc6d1ea07449514604dc4ab7098db82", "symbol": "CST", "name": "Coast", "decimals": 6},
    {"address": "0xeb6b7932da20c6d7b3a899d5887d86dfb09a6408", "symbol": "PXDC", "name": "PXDC Stablecoin", "decimals": 18},
    # Ecosystem tokens
    {"address": "0xc10a4ed9b4042222d69ff0b374eddd47ed90fc1f", "symbol": "PCOCK", "name": "PulseChain Peacock", "decimals": 18},
    {"address": "0x22b2f187e6ee1f9bc8f7fc38bb0d9357462800e4", "symbol": "SOIL", "name": "SUN Minimeal", "decimals": 2},
    # PCOCK ecosystem (found via LibertySwap search)
    {"address": "0xfb6aa01800a2c8563f564e175ab4d20a139d41d3", "symbol": "pTERN", "name": "Pcocks Intern", "decimals": 18},
    {"address": "0xce80edf0e34eab96038909411b2abebd0b1abe1f", "symbol": "FLAPPY", "name": "Flappy pCock", "decimals": 18},
    # LibertySwap native token
    {"address": "0x1e2b5d8257735ccc19cf6baf94c88626647327f8", "symbol": "LSF", "name": "Liberty Swap Finance", "decimals": 18},
]


def _get_existing_addresses() -> set[str]:
    """Get all addresses currently in pulsechain_tokens."""
    result = supabase.table("pulsechain_tokens").select("address").execute()
    return {row["address"].lower() for row in (result.data or [])}


def run():
    logger.info("Syncing LibertySwap token list...")

    supabase.table("sync_status").upsert({
        "indexer_name": "libertyswap_tokenlist_sync",
        "status": "running",
    }, on_conflict="indexer_name").execute()

    try:
        # Compare with existing tokens
        existing = _get_existing_addresses()
        new_tokens = [t for t in LIBERTYSWAP_TOKENS if t["address"].lower() not in existing]

        if new_tokens:
            logger.info(f"NEW LIBERTYSWAP TOKENS: {len(new_tokens)}")
            for t in new_tokens:
                logger.info(f"  + {t['symbol']} ({t['name']}) — {t['address']}")

        # Upsert all LibertySwap tokens
        now = datetime.now(timezone.utc).isoformat()
        rows = [{
            "address": t["address"].lower(),
            "symbol": t["symbol"],
            "name": t["name"],
            "decimals": t["decimals"],
            "is_active": True,
            "updated_at": now,
        } for t in LIBERTYSWAP_TOKENS]

        if rows:
            supabase.table("pulsechain_tokens").upsert(
                rows, on_conflict="address"
            ).execute()

        # Trigger safety scoring for genuinely new tokens
        if new_tokens:
            _trigger_safety_scoring(new_tokens)

        supabase.table("sync_status").upsert({
            "indexer_name": "libertyswap_tokenlist_sync",
            "status": "idle",
            "last_synced_at": now,
            "records_synced": len(LIBERTYSWAP_TOKENS),
            "error_message": None,
        }, on_conflict="indexer_name").execute()

        logger.info(f"LibertySwap sync complete — {len(LIBERTYSWAP_TOKENS)} tokens, {len(new_tokens)} new")

    except Exception as e:
        supabase.table("sync_status").upsert({
            "indexer_name": "libertyswap_tokenlist_sync",
            "status": "error",
            "error_message": str(e)[:500],
        }, on_conflict="indexer_name").execute()
        raise


def _trigger_safety_scoring(tokens: list[dict]):
    """Request safety analysis for new tokens."""
    import time
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
                logger.info(f"  Safety scored {t['symbol']}: {data.get('data', {}).get('grade', '?')}")
        except Exception as e:
            logger.warning(f"  Safety scoring error for {t['symbol']}: {e}")
        time.sleep(2)
    logger.info(f"Safety scoring: {scored}/{len(tokens)} new LibertySwap tokens")
