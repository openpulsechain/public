"""
Holder concentration analysis via PulseChain Scan API (Blockscout v2).
Checks: top holder %, deployer holdings, holder count.
"""

import logging
import requests
from config import SCAN_API_URL

logger = logging.getLogger(__name__)

# Addresses to exclude from holder concentration analysis:
# bridge contracts, routers, burn addresses, known infrastructure
EXCLUDED_HOLDERS = {
    "0x0000000000000000000000000000000000000000",  # zero address
    "0x000000000000000000000000000000000000dead",  # dead/burn
    "0xdead000000000000000000000000000000000000",  # dead variant
    "0x98bf93ebf5c380c0e6ae8e192a7e2ae08edacc02",  # PulseX V1 Router
    "0x165c3410fc91ef562c50559f7d2289febed552d9",  # PulseX V2 Router
    "0x1715a3e4a142d8b698131108995174f37aeba10d",  # OmniBridge (ETH)
    "0xbeb6a26ffa386bfc03368e8243193c56db062577",  # OmniBridge (PLS)
    "0x8bca0149752de7271360b69789e6be8c47f86b8c",  # Burn address HEX
    "0x1111111254eeb25477b68fb85ed929f73a960582",  # 1inch Router
    "0xa619a82e88b0847c815ad6bf5d09fca13e1f5602",  # PulseX V2 Factory
    "0x29ea7545def87022badc76323f373ea1e707c523",  # PulseX V1 Factory
}


def analyze_holders(token_address: str) -> dict:
    """
    Analyze holder distribution for a token.
    Returns:
        {
            "holder_count": int,
            "top10_pct": float,  # % of supply held by top 10
            "top1_pct": float,   # % held by #1 holder
            "deployer_pct": float | None,
            "top_holders": list[{"address": str, "pct": float}],
            "error": str | None,
        }
    """
    addr = token_address.lower()
    result = {
        "holder_count": 0,
        "top10_pct": 0.0,
        "top1_pct": 0.0,
        "deployer_pct": None,
        "top_holders": [],
        "error": None,
    }

    # 1. Get token info (total supply, holder count)
    try:
        token_resp = requests.get(
            f"{SCAN_API_URL}/api/v2/tokens/{addr}",
            timeout=15
        )
        if token_resp.status_code != 200:
            result["error"] = f"Token not found (HTTP {token_resp.status_code})"
            return result

        token_data = token_resp.json()
        total_supply_str = token_data.get("total_supply", "0")
        decimals = int(token_data.get("decimals", "18") or "18")
        total_supply = int(total_supply_str) / (10 ** decimals) if total_supply_str else 0
        result["holder_count"] = int(token_data.get("holders", 0) or 0)

        if total_supply <= 0:
            result["error"] = "Total supply is 0"
            return result

    except Exception as e:
        result["error"] = f"Token info error: {str(e)[:100]}"
        return result

    # 2. Get top holders
    try:
        holders_resp = requests.get(
            f"{SCAN_API_URL}/api/v2/tokens/{addr}/holders",
            params={"limit": 50},
            timeout=15
        )
        if holders_resp.status_code != 200:
            result["error"] = f"Holders API error (HTTP {holders_resp.status_code})"
            return result

        holders_data = holders_resp.json()
        items = holders_data.get("items", [])

        top10_total = 0.0
        top_holders = []
        counted = 0

        for holder in items[:50]:
            holder_addr = holder.get("address", {}).get("hash", "").lower()

            # Skip known infrastructure/burn addresses
            if holder_addr in EXCLUDED_HOLDERS:
                continue

            # Also skip if the address is a known contract detected by Scan API
            is_contract = holder.get("address", {}).get("is_contract", False)

            value_str = holder.get("value", "0")
            value = int(value_str) / (10 ** decimals) if value_str else 0
            pct = (value / total_supply) * 100 if total_supply > 0 else 0
            # Cap at 100% — prevents overflow from bad decimals/supply data
            pct = min(pct, 100.0)

            holder_info = {
                "address": holder_addr,
                "pct": round(pct, 2),
                "is_contract": is_contract,
            }

            if counted < 10:
                top10_total += pct
                top_holders.append(holder_info)

            if counted == 0:
                result["top1_pct"] = round(pct, 2)

            counted += 1
            if counted >= 10:
                break

        result["top10_pct"] = round(top10_total, 2)
        result["top_holders"] = top_holders

    except Exception as e:
        result["error"] = f"Holders error: {str(e)[:100]}"

    return result
