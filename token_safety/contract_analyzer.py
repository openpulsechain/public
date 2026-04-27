"""
Contract analysis via PulseChain Scan API (Blockscout v2).
Checks: verification, owner privileges, mint, pause, blacklist, proxy.
"""

import logging
import re
import requests
from web3 import Web3
from config import RPC_URL, SCAN_API_URL

logger = logging.getLogger(__name__)

w3 = Web3(Web3.HTTPProvider(RPC_URL))

# Dangerous function signatures (4-byte selectors)
DANGEROUS_SIGS = {
    "mint": ["40c10f19", "a0712d68", "4e6ec247"],  # mint(address,uint256), mint(uint256), mint()
    "pause": ["8456cb59", "02329a29"],  # pause(), setPause(bool)
    "blacklist": ["44337ea1", "e4997dc5"],  # blacklist(address), blacklistAddress(address)
    "setFee": ["69fe0e2d", "8c0b5e22"],  # setFee(uint256), setMaxTxAmount
    "exclude": ["437823ec"],  # excludeFromFee(address)
}

# Dangerous patterns in source code
DANGEROUS_PATTERNS = [
    (r"\bowner\b.*\bmint\b", "owner_can_mint"),
    (r"\bpause\b", "has_pause"),
    (r"\bblacklist\b|\b_isBlacklisted\b|\bisBlocked\b", "has_blacklist"),
    (r"\bselfdestruct\b|\bsuicide\b", "has_selfdestruct"),
    (r"\bdelegatecall\b", "has_delegatecall"),
    (r"\bsetFee\b|\bsetTax\b|\b_taxFee\b|\b_liquidityFee\b", "has_variable_fee"),
    (r"\bmaxTxAmount\b|\b_maxTxAmount\b|\bmaxTransactionAmount\b", "has_max_tx"),
    (r"\bexcludeFromFee\b|\bisExcludedFromFee\b", "has_fee_exclusion"),
    (r"\brenounceOwnership\b", "has_renounce"),
    (r"\bOwnable\b", "is_ownable"),
]


def analyze_contract(token_address: str) -> dict:
    """
    Analyze a token contract for safety.
    Returns:
        {
            "is_verified": bool,
            "is_proxy": bool,
            "has_source": bool,
            "compiler": str | None,
            "dangers": list[str],
            "features": list[str],
            "ownership_renounced": bool | None,
            "has_mint": bool,
            "has_pause": bool,
            "has_blacklist": bool,
            "has_variable_fee": bool,
            "has_selfdestruct": bool,
            "error": str | None,
        }
    """
    addr = token_address.lower()
    result = {
        "is_verified": False,
        "is_proxy": False,
        "has_source": False,
        "compiler": None,
        "dangers": [],
        "features": [],
        "ownership_renounced": None,
        "has_mint": False,
        "has_pause": False,
        "has_blacklist": False,
        "has_variable_fee": False,
        "has_selfdestruct": False,
        "error": None,
    }

    # 1. Check if contract exists (has bytecode)
    try:
        code = w3.eth.get_code(Web3.to_checksum_address(token_address))
        if code == b"" or code == b"0x":
            result["error"] = "Not a contract (EOA)"
            return result
    except Exception as e:
        result["error"] = f"RPC error: {str(e)[:100]}"
        return result

    # 2. Get contract info from Scan API
    try:
        resp = requests.get(
            f"{SCAN_API_URL}/api/v2/smart-contracts/{addr}",
            timeout=15
        )
        if resp.status_code == 200:
            data = resp.json()
            result["is_verified"] = data.get("is_verified", False)
            result["is_proxy"] = data.get("is_proxy", False) or data.get("proxy_type") is not None
            result["compiler"] = data.get("compiler_version")
            source_code = data.get("source_code", "") or ""
            result["has_source"] = len(source_code) > 0

            if result["is_proxy"]:
                result["dangers"].append("proxy_upgradeable")

            # 3. Analyze source code for dangerous patterns
            if source_code:
                source_lower = source_code.lower()
                for pattern, label in DANGEROUS_PATTERNS:
                    if re.search(pattern, source_code, re.IGNORECASE):
                        result["features"].append(label)

                result["has_mint"] = "owner_can_mint" in result["features"]
                result["has_pause"] = "has_pause" in result["features"]
                result["has_blacklist"] = "has_blacklist" in result["features"]
                result["has_variable_fee"] = "has_variable_fee" in result["features"]
                result["has_selfdestruct"] = "has_selfdestruct" in result["features"]

                # Check if ownership was renounced
                if "has_renounce" in result["features"]:
                    result["features"].append("can_renounce_ownership")

                # Build danger list
                if result["has_mint"]:
                    result["dangers"].append("owner_can_mint")
                if result["has_pause"]:
                    result["dangers"].append("can_be_paused")
                if result["has_blacklist"]:
                    result["dangers"].append("has_blacklist")
                if result["has_variable_fee"]:
                    result["dangers"].append("variable_fees")
                if result["has_selfdestruct"]:
                    result["dangers"].append("has_selfdestruct")

            # 4. Check ABI for dangerous functions
            abi = data.get("abi") or []
            for item in abi:
                if item.get("type") == "function":
                    fname = item.get("name", "").lower()
                    if fname == "owner":
                        result["features"].append("has_owner_function")
                    if fname == "renounceownership":
                        result["features"].append("has_renounce_function")

        elif resp.status_code == 404:
            # Contract exists but not verified
            result["is_verified"] = False
            result["dangers"].append("unverified_contract")
        else:
            logger.warning(f"Scan API returned {resp.status_code} for {addr}")

    except Exception as e:
        logger.warning(f"Scan API error for {addr}: {str(e)[:100]}")
        result["error"] = f"Scan API error: {str(e)[:100]}"

    # 5. Check ownership status via eth_call (owner() function)
    try:
        owner_sig = w3.keccak(text="owner()")[:4]
        owner_result = w3.eth.call({
            "to": Web3.to_checksum_address(token_address),
            "data": owner_sig.hex()
        })
        owner_address = "0x" + owner_result.hex()[-40:]
        if owner_address == "0x" + "0" * 40:
            result["ownership_renounced"] = True
            result["features"].append("ownership_renounced")
        else:
            result["ownership_renounced"] = False
    except Exception:
        # No owner() function = likely safe (no single owner)
        result["ownership_renounced"] = None

    return result
