"""Token prices indexer — PulseX subgraph for PulseChain tokens + CoinGecko for majors.

PulseChain tokens use derivedUSD from PulseX subgraph (100% sovereign, no GeckoTerminal).
24h change is calculated from token_price_history table in Supabase.
Major tokens (BTC, ETH, stables) still use CoinGecko.
"""

import logging
from datetime import datetime, timezone, timedelta

import requests

from db import supabase
from config import COINGECKO_BASE, COINGECKO_API_KEY, PULSEX_SUBGRAPH_V1, PULSEX_SUBGRAPH_V2
from utils.retry import with_retry

logger = logging.getLogger(__name__)

PULSEX_SUBGRAPH = PULSEX_SUBGRAPH_V1

# Tokens with known broken V1 totalSupply (frozen/incorrect)
# These MUST use V2 totalSupply for Market Cap calculation
V1_SUPPLY_BROKEN = {
    "0x2fa878ab3f87cc1c9737fc071108f904c0b0c95d",  # INC: V1=640, real=55.8M
    "0x02dcdd04e3f455d838cd1249292c58f3b79e3c3c",  # WETH: V1=0.018, real=10,771
    "0xb17d901469b9208b17d916112988a3fed19b5ca1",  # WBTC(br): V1=0.20, real=367
    "0x15d38573d2feeb82e7ad5187ab8c1d52810b1f07",  # USDC(br): V1=1143, real=34.6M
    "0x0cb6f5a34ad42ec934882a05265a7d5f59b51a2f",  # USDT(br): V1=21304, real=~4.5M
    "0xefd766ccb38eaf1dfd701853bfce31359239f305",  # DAI(br): V1≈0, real=33.3M
    "0x57fde0a71132198bbec939b98976993d8d89d225",  # eHEX: V1 broken
}

# Major tokens from CoinGecko (reliable for these — not PulseChain native)
COINGECKO_TOKENS = {
    "bitcoin": {"symbol": "BTC", "name": "Bitcoin"},
    "ethereum": {"symbol": "ETH", "name": "Ethereum"},
    "tether": {"symbol": "USDT", "name": "Tether"},
    "usd-coin": {"symbol": "USDC", "name": "USD Coin"},
    "wrapped-bitcoin": {"symbol": "WBTC", "name": "Wrapped Bitcoin"},
    "weth": {"symbol": "WETH", "name": "Wrapped Ether"},
    "dai": {"symbol": "DAI", "name": "Dai"},
}


def _fetch_top_tokens_from_db(limit: int = 50) -> list[dict]:
    """Fetch top tokens by volume from pulsechain_tokens table."""
    try:
        resp = (
            supabase.table("pulsechain_tokens")
            .select("address, symbol, name")
            .order("total_volume_usd", desc=True)
            .limit(limit)
            .execute()
        )
        tokens = resp.data or []
        logger.info(f"Fetched {len(tokens)} tokens from pulsechain_tokens table")
        return tokens
    except Exception as e:
        logger.error(f"Failed to fetch tokens from pulsechain_tokens: {e}")
        return []


def _query_subgraph_prices(addresses: list[str]) -> dict:
    """Query PulseX subgraph for current token prices using derivedUSD.

    Returns dict keyed by lowercase address.
    """
    if not addresses:
        return {}

    # Subgraph expects lowercase addresses
    lower_addresses = [a.lower() for a in addresses]

    # Query in batches of 100 to avoid subgraph limits
    all_tokens = {}
    batch_size = 100

    for i in range(0, len(lower_addresses), batch_size):
        batch = lower_addresses[i : i + batch_size]
        query = """
        {
          tokens(where: {id_in: %s}) {
            id
            symbol
            name
            decimals
            derivedUSD
            tradeVolumeUSD
            totalLiquidity
            totalSupply
          }
        }
        """ % str(batch).replace("'", '"')

        try:
            resp = requests.post(
                PULSEX_SUBGRAPH,
                json={"query": query},
                timeout=30,
            )
            if resp.status_code != 200:
                logger.warning(f"PulseX subgraph returned {resp.status_code}")
                continue

            data = resp.json()
            if "errors" in data:
                logger.warning(f"PulseX subgraph errors: {data['errors']}")
                continue

            tokens = data.get("data", {}).get("tokens", [])
            for t in tokens:
                all_tokens[t["id"].lower()] = t

        except Exception as e:
            logger.warning(f"PulseX subgraph request failed: {e}")

    return all_tokens


def _fetch_yesterday_prices(addresses: list[str]) -> dict:
    """Fetch recent prices from token_price_history for 24h change calculation.

    Looks at the last 3 days and picks the most recent entry per token.
    Returns dict keyed by lowercase address with the previous price_usd.
    """
    if not addresses:
        return {}

    three_days_ago = (datetime.now(timezone.utc) - timedelta(days=3)).strftime("%Y-%m-%d")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    lower_addresses = [a.lower() for a in addresses]

    prices = {}
    # Query in batches to avoid URL length limits
    batch_size = 50

    for i in range(0, len(lower_addresses), batch_size):
        batch = lower_addresses[i : i + batch_size]
        try:
            resp = (
                supabase.table("token_price_history")
                .select("address, date, price_usd")
                .in_("address", batch)
                .gte("date", three_days_ago)
                .lt("date", today)
                .order("date", desc=True)
                .execute()
            )
            for row in resp.data or []:
                addr = row["address"].lower()
                if addr in prices:
                    continue  # Already have the most recent
                price = row.get("price_usd")
                if price and float(price) > 0:
                    prices[addr] = float(price)
        except Exception as e:
            logger.warning(f"Failed to fetch yesterday prices: {e}")

    return prices


def _fetch_latest_daily_volumes(addresses: list[str]) -> dict:
    """Fetch the most recent daily_volume_usd from token_price_history.

    This gives the REAL daily volume (from tokenDayDatas), not the all-time
    tradeVolumeUSD which was incorrectly stored as volume_24h before.
    Returns dict keyed by lowercase address.
    """
    if not addresses:
        return {}

    three_days_ago = (datetime.now(timezone.utc) - timedelta(days=3)).strftime("%Y-%m-%d")
    lower_addresses = [a.lower() for a in addresses]

    volumes = {}
    batch_size = 50

    for i in range(0, len(lower_addresses), batch_size):
        batch = lower_addresses[i : i + batch_size]
        try:
            resp = (
                supabase.table("token_price_history")
                .select("address, date, daily_volume_usd")
                .in_("address", batch)
                .gte("date", three_days_ago)
                .order("date", desc=True)
                .execute()
            )
            for row in resp.data or []:
                addr = row["address"].lower()
                if addr in volumes:
                    continue  # Already have the most recent
                vol = row.get("daily_volume_usd")
                if vol is not None and float(vol) >= 0:
                    volumes[addr] = float(vol)
        except Exception as e:
            logger.warning(f"Failed to fetch latest daily volumes: {e}")

    return volumes


def _fetch_pulsechain_prices() -> list[dict]:
    """Fetch PulseChain token prices from PulseX V1+V2 subgraphs (sovereign, no GeckoTerminal).

    Aggregates V1 and V2:
    - Price: V1 preferred, V2 fallback
    - Volume: from token_price_history (already V1+V2 via token_history.py)
    - Liquidity: V1 totalLiquidity + V2 totalLiquidity (in token units × price)
    - Market Cap: derivedUSD × totalSupply, with V2 fallback for broken V1 supplies
    """
    # 1. Get top tokens from database
    db_tokens = _fetch_top_tokens_from_db(limit=50)
    if not db_tokens:
        logger.warning("No tokens found in pulsechain_tokens table")
        return []

    # Build address-to-metadata mapping
    token_meta = {}
    addresses = []
    for t in db_tokens:
        addr = t["address"].lower()
        token_meta[addr] = {
            "symbol": t["symbol"],
            "name": t["name"],
            "address": t["address"],
        }
        addresses.append(addr)

    # 2. Query BOTH V1 and V2 subgraphs for current prices
    v1_data = _query_subgraph_prices(addresses)
    logger.info(f"  V1 subgraph: {len(v1_data)} tokens")

    # Query V2 subgraph (same schema)
    v2_data = {}
    lower_addresses = [a.lower() for a in addresses]
    batch_size = 100
    for i in range(0, len(lower_addresses), batch_size):
        batch = lower_addresses[i : i + batch_size]
        query = """
        {
          tokens(where: {id_in: %s}) {
            id
            symbol
            name
            decimals
            derivedUSD
            tradeVolumeUSD
            totalLiquidity
            totalSupply
          }
        }
        """ % str(batch).replace("'", '"')
        try:
            resp = requests.post(
                PULSEX_SUBGRAPH_V2,
                json={"query": query},
                timeout=30,
            )
            if resp.status_code == 200:
                data = resp.json()
                if "errors" not in data:
                    for t in data.get("data", {}).get("tokens", []):
                        v2_data[t["id"].lower()] = t
        except Exception as e:
            logger.warning(f"V2 subgraph request failed: {e}")
    logger.info(f"  V2 subgraph: {len(v2_data)} tokens")

    if not v1_data and not v2_data:
        logger.warning("No data returned from either subgraph")
        return []

    # 3. Get yesterday's prices for 24h change calculation
    yesterday_prices = _fetch_yesterday_prices(addresses)

    # 4. Get real daily volumes from token_price_history (already V1+V2 via token_history.py)
    daily_volumes = _fetch_latest_daily_volumes(addresses)

    # 5. Build output rows with V1+V2 aggregation
    rows = []
    now = datetime.now(timezone.utc).isoformat()

    for addr in addresses:
        v1 = v1_data.get(addr)
        v2 = v2_data.get(addr)

        if not v1 and not v2:
            continue

        # Price: V1 preferred, V2 fallback
        v1_price = float(v1.get("derivedUSD", 0)) if v1 else 0
        v2_price = float(v2.get("derivedUSD", 0)) if v2 else 0
        derived_usd = v1_price or v2_price
        if derived_usd <= 0:
            continue

        meta = token_meta[addr]

        # Liquidity: V1 + V2 totalLiquidity (in token units) × price
        v1_liq = float(v1.get("totalLiquidity", 0)) if v1 else 0
        v2_liq = float(v2.get("totalLiquidity", 0)) if v2 else 0
        total_liquidity_usd = (v1_liq + v2_liq) * derived_usd

        # Volume: from token_price_history (already V1+V2 via token_history.py)
        real_daily_vol = daily_volumes.get(addr)

        # Market Cap: use V2 totalSupply for tokens with broken V1 supply
        market_cap = None
        try:
            # Determine which subgraph to use for totalSupply
            if addr in V1_SUPPLY_BROKEN and v2:
                # V1 supply is known broken — use V2
                supply_source = v2
                supply_label = "V2"
            elif v1:
                supply_source = v1
                supply_label = "V1"
            elif v2:
                supply_source = v2
                supply_label = "V2"
            else:
                supply_source = None
                supply_label = None

            if supply_source:
                total_supply_raw = float(supply_source.get("totalSupply", 0))
                decimals = int(supply_source.get("decimals", 18))
                if total_supply_raw > 0:
                    total_supply = total_supply_raw / (10 ** decimals)
                    market_cap = derived_usd * total_supply

                    # Sanity check: if MCap < $100 and we used V1, try V2 as fallback
                    if market_cap < 100 and supply_label == "V1" and v2:
                        v2_supply_raw = float(v2.get("totalSupply", 0))
                        v2_decimals = int(v2.get("decimals", 18))
                        if v2_supply_raw > 0:
                            v2_supply = v2_supply_raw / (10 ** v2_decimals)
                            v2_mcap = derived_usd * v2_supply
                            if v2_mcap > market_cap:
                                market_cap = v2_mcap
                                logger.info(f"  {meta['symbol']}: V1 MCap=${market_cap:.0f} broken, using V2 MCap=${v2_mcap:.0f}")
        except (ValueError, TypeError):
            pass

        # Calculate 24h change from yesterday's price in token_price_history
        change_pct = None
        yesterday_price = yesterday_prices.get(addr)
        if yesterday_price and yesterday_price > 0:
            change_pct = ((derived_usd - yesterday_price) / yesterday_price) * 100

        rows.append({
            "id": addr,
            "symbol": meta["symbol"],
            "name": meta["name"],
            "price_usd": derived_usd,
            "volume_24h_usd": real_daily_vol,
            "market_cap_usd": market_cap,
            "price_change_24h_pct": change_pct,
            "last_updated": now,
            "source": "pulsex_subgraph_v1v2",
            "address": meta["address"],
        })
        v1_tag = "V1" if v1_price else ""
        v2_tag = "V2" if v2_price else ""
        logger.info(f"  {meta['symbol']}: ${derived_usd:.8f} ({v1_tag}+{v2_tag}, liq=${total_liquidity_usd:.0f})")

    return rows


def _fetch_coingecko_prices() -> list[dict]:
    """Fetch major token prices from CoinGecko."""
    ids = ",".join(COINGECKO_TOKENS.keys())
    params = {
        "ids": ids,
        "vs_currencies": "usd",
        "include_market_cap": "true",
        "include_24hr_vol": "true",
        "include_24hr_change": "true",
    }
    headers = {}
    if COINGECKO_API_KEY:
        headers["x-cg-demo-api-key"] = COINGECKO_API_KEY

    resp = with_retry(
        lambda: requests.get(f"{COINGECKO_BASE}/simple/price", params=params, headers=headers, timeout=30)
    )
    data = resp.json()

    rows = []
    now = datetime.now(timezone.utc).isoformat()
    for cg_id, info in COINGECKO_TOKENS.items():
        price_data = data.get(cg_id, {})
        if not price_data:
            continue
        rows.append({
            "id": cg_id,
            "symbol": info["symbol"],
            "name": info["name"],
            "price_usd": price_data.get("usd"),
            "market_cap_usd": price_data.get("usd_market_cap"),
            "volume_24h_usd": price_data.get("usd_24h_vol"),
            "price_change_24h_pct": price_data.get("usd_24h_change"),
            "last_updated": now,
            "source": "coingecko",
            "address": None,
        })

    return rows


def run():
    logger.info("Fetching token prices (PulseX subgraph + CoinGecko)...")

    supabase.table("sync_status").update({
        "status": "running",
    }).eq("indexer_name", "token_prices").execute()

    try:
        # 1. PulseChain tokens from PulseX subgraph (sovereign)
        pls_rows = _fetch_pulsechain_prices()

        # 2. Major tokens from CoinGecko
        cg_rows = _fetch_coingecko_prices()

        all_rows = pls_rows + cg_rows

        if all_rows:
            supabase.table("token_prices").upsert(all_rows, on_conflict="id").execute()

            # Also snapshot PulseChain prices into token_price_history
            # so tomorrow's run has a "yesterday price" for 24h change calculation
            # NOTE: do NOT write daily_volume_usd here — token_history.py handles that
            # from tokenDayDatas.dailyVolumeUSD (correct daily volume)
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            history_rows = []
            for row in pls_rows:
                addr = row.get("address")
                if addr and row.get("price_usd") and row["price_usd"] > 0:
                    history_rows.append({
                        "address": addr.lower(),
                        "date": today,
                        "price_usd": row["price_usd"],
                        "source": "pulsex_subgraph",
                    })
            if history_rows:
                try:
                    supabase.table("token_price_history").upsert(
                        history_rows, on_conflict="address,date"
                    ).execute()
                    logger.info(f"Saved {len(history_rows)} price snapshots to token_price_history")
                except Exception as e:
                    logger.warning(f"Failed to save price history: {e}")

        supabase.table("sync_status").update({
            "status": "idle",
            "last_synced_at": datetime.now(timezone.utc).isoformat(),
            "records_synced": len(all_rows),
            "error_message": None,
        }).eq("indexer_name", "token_prices").execute()

        logger.info(f"Updated prices: {len(pls_rows)} PulseChain (PulseX subgraph) + {len(cg_rows)} majors (CoinGecko)")

    except Exception as e:
        supabase.table("sync_status").update({
            "status": "error",
            "error_message": str(e)[:500],
        }).eq("indexer_name", "token_prices").execute()
        raise
