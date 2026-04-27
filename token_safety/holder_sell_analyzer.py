"""
Phase 2: Holder Sell Analysis — tests whether top holders can actually transfer
their tokens, detects siphoned balances, and reports tax distribution.

Limitations:
  - This module tests `token.transfer()`, NOT router swaps. A token contract
    could allow direct transfers but block sells through the router (e.g.,
    by checking msg.sender == pair address). A passing transfer test does NOT
    guarantee the holder can sell on PulseX.
  - Siphon detection is heuristic: it compares on-chain `balanceOf()` with
    the balance reported by PulseChain Scan API. Discrepancies can also be
    caused by rebasing tokens, reflection tokens, or stale indexer data.
  - Tax estimation per holder reuses the buy_tax_pct from the main honeypot
    simulation as a proxy — individual holder tax rates are not measured.
"""

import logging
import requests
from web3 import Web3

from config import RPC_URL, SCAN_API_URL, PULSEX_V1_ROUTER, PULSEX_V2_ROUTER, WPLS_ADDRESS

logger = logging.getLogger(__name__)

w3 = Web3(Web3.HTTPProvider(RPC_URL))

# Dead address used as transfer recipient in simulations
DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD"

# PulseX Factory ABI — getPair
FACTORY_ABI = [
    {
        "inputs": [
            {"name": "tokenA", "type": "address"},
            {"name": "tokenB", "type": "address"},
        ],
        "name": "getPair",
        "outputs": [{"name": "pair", "type": "address"}],
        "stateMutability": "view",
        "type": "function",
    },
]

# Router ABI — factory()
ROUTER_FACTORY_ABI = [
    {
        "inputs": [],
        "name": "factory",
        "outputs": [{"name": "", "type": "address"}],
        "stateMutability": "view",
        "type": "function",
    },
]

# Minimal ERC-20 ABI for balanceOf, transfer, decimals
ERC20_ABI = [
    {
        "constant": True,
        "inputs": [{"name": "account", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"name": "", "type": "uint256"}],
        "type": "function",
    },
    {
        "constant": False,
        "inputs": [
            {"name": "to", "type": "address"},
            {"name": "amount", "type": "uint256"},
        ],
        "name": "transfer",
        "outputs": [{"name": "", "type": "bool"}],
        "type": "function",
    },
    {
        "constant": True,
        "inputs": [],
        "name": "decimals",
        "outputs": [{"name": "", "type": "uint8"}],
        "type": "function",
    },
    {
        "constant": True,
        "inputs": [],
        "name": "totalSupply",
        "outputs": [{"name": "", "type": "uint256"}],
        "type": "function",
    },
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_pair_address(token_address: str) -> str | None:
    """
    Find the PulseX LP pair address for a token (tries V2 then V1).
    Returns the pair address or None if no pair exists.
    """
    token_cs = Web3.to_checksum_address(token_address)
    wpls = Web3.to_checksum_address(WPLS_ADDRESS)

    for router_addr in [PULSEX_V2_ROUTER, PULSEX_V1_ROUTER]:
        try:
            router_cs = Web3.to_checksum_address(router_addr)
            router_contract = w3.eth.contract(address=router_cs, abi=ROUTER_FACTORY_ABI)
            factory_addr = router_contract.functions.factory().call()
            factory = w3.eth.contract(
                address=Web3.to_checksum_address(factory_addr),
                abi=FACTORY_ABI,
            )
            pair = factory.functions.getPair(token_cs, wpls).call()
            if pair != "0x0000000000000000000000000000000000000000":
                return pair.lower()
        except Exception as e:
            logger.debug(f"Pair lookup failed on router {router_addr}: {str(e)[:80]}")
            continue

    return None


def _get_top_holders(token_address: str, limit: int = 20) -> list[dict] | None:
    """
    Fetch top holders from PulseChain Scan API (Blockscout v2).
    Returns list of holder dicts or None on failure.
    Each dict: {"address": str, "value": str, "is_contract": bool}
    """
    try:
        resp = requests.get(
            f"{SCAN_API_URL}/api/v2/tokens/{token_address}/holders",
            params={"limit": limit},
            timeout=15,
        )
        if resp.status_code != 200:
            logger.warning(f"Holders API returned HTTP {resp.status_code}")
            return None

        data = resp.json()
        items = data.get("items", [])
        holders = []
        for item in items[:limit]:
            addr_info = item.get("address", {})
            holders.append({
                "address": addr_info.get("hash", "").lower(),
                "value": item.get("value", "0"),
                "is_contract": addr_info.get("is_contract", False),
            })
        return holders

    except Exception as e:
        logger.warning(f"Failed to fetch holders: {str(e)[:120]}")
        return None


def _get_token_info(token_address: str) -> tuple[int, int]:
    """
    Read decimals and totalSupply from the token contract on-chain.
    Returns (decimals, total_supply_raw). Falls back to (18, 0) on error.
    """
    token_cs = Web3.to_checksum_address(token_address)
    token_contract = w3.eth.contract(address=token_cs, abi=ERC20_ABI)

    decimals = 18
    total_supply = 0

    try:
        decimals = token_contract.functions.decimals().call()
    except Exception:
        pass

    try:
        total_supply = token_contract.functions.totalSupply().call()
    except Exception:
        pass

    return decimals, total_supply


def _simulate_transfer(
    token_address: str,
    holder_address: str,
    amount: int,
    receiver_address: str = DEAD_ADDRESS,
) -> tuple[bool | None, str | None]:
    """
    Simulate token.transfer(receiver, amount) from holder_address via eth_call.

    Args:
        receiver_address: Where to send tokens (DEAD_ADDRESS for basic test,
                          PAIR_ADDRESS for sell-ability test).

    Returns:
        (can_transfer, error_message)
        - (True, None)    if transfer succeeds
        - (False, reason)  if transfer reverts (holder blocked/blacklisted)
        - (None, reason)   if simulation itself failed (inconclusive)
    """
    token_cs = Web3.to_checksum_address(token_address)
    holder_cs = Web3.to_checksum_address(holder_address)
    receiver = Web3.to_checksum_address(receiver_address)

    token_contract = w3.eth.contract(address=token_cs, abi=ERC20_ABI)

    try:
        # Build the transfer calldata
        calldata = token_contract.encode_abi(
            "transfer",
            args=[receiver, amount],
        )

        # Execute via eth_call (read-only simulation, no state change)
        result = w3.eth.call({
            "from": holder_cs,
            "to": token_cs,
            "data": calldata,
            "gas": 500_000,
        })

        # ERC-20 transfer returns bool — decode it
        # result is bytes; for standard ERC-20, it's 32 bytes encoding True/False
        if len(result) >= 32:
            return_value = int.from_bytes(result[-32:], "big")
            if return_value == 1:
                return True, None
            else:
                return False, "transfer returned false"
        else:
            # Non-standard return (some tokens return empty on success)
            # If eth_call didn't revert, we consider it a success
            return True, None

    except Exception as e:
        error_msg = str(e)[:200]
        # Common revert reasons indicating the holder is blocked
        blocked_indicators = [
            "blacklist", "blocked", "frozen", "paused",
            "not allowed", "restricted", "banned",
        ]
        is_blocked = any(ind in error_msg.lower() for ind in blocked_indicators)

        if is_blocked or "revert" in error_msg.lower() or "execution reverted" in error_msg.lower():
            return False, error_msg
        else:
            # Inconclusive — could be gas issue, RPC error, etc.
            return None, error_msg


def _check_siphon(
    token_address: str,
    holder_address: str,
    scan_balance_raw: int,
) -> bool:
    """
    Compare on-chain balanceOf() with the balance reported by Scan API.
    If balanceOf returns 0 but Scan API says holder has tokens, flag as siphoned.

    Returns True if siphon is suspected, False otherwise.
    """
    try:
        token_cs = Web3.to_checksum_address(token_address)
        holder_cs = Web3.to_checksum_address(holder_address)
        token_contract = w3.eth.contract(address=token_cs, abi=ERC20_ABI)

        on_chain_balance = token_contract.functions.balanceOf(holder_cs).call()

        # Siphon heuristic: Scan says they hold tokens, but on-chain says 0
        if scan_balance_raw > 0 and on_chain_balance == 0:
            return True

        return False

    except Exception as e:
        logger.debug(f"Siphon check failed for {holder_address}: {str(e)[:100]}")
        return False


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def analyze_holder_sells(
    token_address: str,
    buy_tax_pct: float | None = None,
) -> dict:
    """
    Analyze whether top holders can sell their tokens.

    Args:
        token_address: Token contract address (lowercase or checksum).
        buy_tax_pct: Buy tax percentage from the main honeypot simulation,
                     used as a proxy for per-holder tax estimation.

    Returns:
        {
            "holders_tested": int,
            "successful": int,       # holders that can transfer
            "failed": int,           # holders that cannot transfer (blocked)
            "siphoned": int,         # suspected siphoned balances
            "average_tax": float | None,
            "highest_tax": float | None,
            "holder_results": [
                {
                    "address": str,
                    "pct_supply": float,
                    "can_transfer": bool | None,
                    "is_contract": bool,
                    "error": str | None,
                }
            ]
        }
    """
    addr = token_address.lower()

    empty_result = {
        "holders_tested": 0,
        "successful": 0,
        "failed": 0,
        "siphoned": 0,
        "pair_blocked": 0,
        "pair_tested": 0,
        "average_tax": None,
        "highest_tax": None,
        "holder_results": [],
    }

    # Step 1: Fetch top 20 holders from Scan API
    holders = _get_top_holders(addr, limit=20)
    if not holders:
        logger.warning(f"No holders found for {addr}, skipping holder sell analysis")
        return empty_result

    # Step 2: Get token decimals and total supply for percentage calculations
    decimals, total_supply_raw = _get_token_info(addr)

    # Step 3: Find the DEX pair address for sell-ability testing
    pair_address = _get_pair_address(addr)
    if pair_address:
        logger.info(f"  Pair address found for sell test: {pair_address}")
    else:
        logger.warning(f"  No pair address found — skipping sell-to-pair test")

    # Step 4: Iterate over each holder and test transfer
    holder_results = []
    successful = 0
    failed = 0
    siphoned = 0
    pair_blocked = 0       # can transfer to DEAD but NOT to pair
    pair_tested = 0        # holders tested for pair transfer

    for holder in holders:
        holder_addr = holder["address"]
        scan_balance_raw = int(holder.get("value", "0") or "0")
        is_contract = holder.get("is_contract", False)

        # Calculate percentage of supply
        if total_supply_raw > 0:
            pct_supply = round((scan_balance_raw / total_supply_raw) * 100, 4)
        else:
            pct_supply = 0.0

        # Use 1 token unit (smallest practical amount) for transfer simulation
        # to avoid hitting max-tx limits
        transfer_amount = 10 ** decimals  # 1 full token

        # If holder has less than 1 token, use their full balance
        if scan_balance_raw > 0 and scan_balance_raw < transfer_amount:
            transfer_amount = scan_balance_raw

        # Skip holders with zero balance according to Scan
        if scan_balance_raw == 0:
            holder_results.append({
                "address": holder_addr,
                "pct_supply": pct_supply,
                "can_transfer": None,
                "can_sell_to_pair": None,
                "is_contract": is_contract,
                "error": "zero balance on Scan",
            })
            continue

        # Simulate transfer to DEAD (basic transferability)
        can_transfer, error = _simulate_transfer(addr, holder_addr, transfer_amount)

        if can_transfer is True:
            successful += 1
        elif can_transfer is False:
            failed += 1

        # Simulate transfer to PAIR (sell-ability test)
        # This catches honeypots that allow wallet-to-wallet transfers
        # but block transfers TO the DEX pair (= blocking sells)
        can_sell_to_pair = None
        if pair_address and can_transfer is True and not is_contract:
            pair_tested += 1
            can_sell_to_pair, pair_error = _simulate_transfer(
                addr, holder_addr, transfer_amount, receiver_address=pair_address,
            )
            if can_sell_to_pair is False:
                pair_blocked += 1
                logger.warning(
                    f"  Holder {holder_addr[:10]}... can transfer to DEAD "
                    f"but BLOCKED to pair — sell-blocking honeypot signal"
                )

        # Check for siphon
        is_siphoned = _check_siphon(addr, holder_addr, scan_balance_raw)
        if is_siphoned:
            siphoned += 1

        holder_results.append({
            "address": holder_addr,
            "pct_supply": pct_supply,
            "can_transfer": can_transfer,
            "can_sell_to_pair": can_sell_to_pair,
            "is_contract": is_contract,
            "error": error,
        })

    holders_tested = successful + failed  # only count conclusive results

    # Step 4: Tax distribution (using buy_tax_pct as proxy)
    # For holders that can transfer, we assume they'd face the same tax
    # as detected by the main honeypot simulation. This is a simplification:
    # some tokens apply different taxes per address (whitelisted, etc.).
    average_tax = None
    highest_tax = None

    if buy_tax_pct is not None and successful > 0:
        # All transferable holders get the same proxy tax
        average_tax = round(buy_tax_pct, 2)
        highest_tax = round(buy_tax_pct, 2)

    return {
        "holders_tested": holders_tested,
        "successful": successful,
        "failed": failed,
        "siphoned": siphoned,
        "pair_blocked": pair_blocked,
        "pair_tested": pair_tested,
        "average_tax": average_tax,
        "highest_tax": highest_tax,
        "holder_results": holder_results,
    }
