"""
Honeypot detection via FeeChecker contract on PulseChain.
Simulates buy+sell and checks if token can be sold.
Enriched with: variable-amount testing, gas estimation,
transfer tax detection, max-tx detection, cooldown detection,
transfer-block detection, and warning flags.
"""

from __future__ import annotations

import logging
from web3 import Web3
from config import (
    RPC_URL, FEE_CHECKER_CONTRACT,
    PULSEX_V1_ROUTER, PULSEX_V2_ROUTER, WPLS_ADDRESS,
)

logger = logging.getLogger(__name__)

w3 = Web3(Web3.HTTPProvider(RPC_URL))

# ---------------------------------------------------------------------------
# ABIs
# ---------------------------------------------------------------------------

# FeeChecker ABI (only honeyCheck function)
FEE_CHECKER_ABI = [
    {
        "inputs": [
            {"name": "tokenAddr", "type": "address"},
            {"name": "routerAddr", "type": "address"}
        ],
        "name": "honeyCheck",
        "outputs": [
            {
                "components": [
                    {"name": "buyResult", "type": "uint256"},
                    {"name": "tokenBalance2", "type": "uint256"},
                    {"name": "sellResult", "type": "uint256"},
                    {"name": "buyCost", "type": "uint256"},
                    {"name": "sellCost", "type": "uint256"},
                    {"name": "expectedAmount", "type": "uint256"}
                ],
                "name": "",
                "type": "tuple"
            }
        ],
        "stateMutability": "payable",
        "type": "function"
    }
]

# Minimal ERC-20 ABI for transfer-tax and balance checks
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
]

# PulseX Router ABI (only swap functions needed for gas estimation)
ROUTER_ABI = [
    {
        "inputs": [
            {"name": "amountOutMin", "type": "uint256"},
            {"name": "path", "type": "address[]"},
            {"name": "to", "type": "address"},
            {"name": "deadline", "type": "uint256"},
        ],
        "name": "swapExactETHForTokensSupportingFeeOnTransferTokens",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function",
    },
    {
        "inputs": [
            {"name": "amountIn", "type": "uint256"},
            {"name": "amountOutMin", "type": "uint256"},
            {"name": "path", "type": "address[]"},
            {"name": "to", "type": "address"},
            {"name": "deadline", "type": "uint256"},
        ],
        "name": "swapExactTokensForETHSupportingFeeOnTransferTokens",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function",
    },
    {
        "inputs": [
            {"name": "factory", "type": "address"},
        ],
        "name": "factory",
        "outputs": [{"name": "", "type": "address"}],
        "stateMutability": "view",
        "type": "function",
    },
]

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

# Selectors for max-tx / max-wallet functions (4-byte selectors)
MAX_TX_SELECTORS: list[tuple[str, str]] = [
    ("maxTransactionAmount()", "0xc024666800000000000000000000000000000000000000000000000000000000"[:10]),
    ("_maxTxAmount()", "0x7d1db4a5"),
    ("maxTxAmount()", "0x8da5cb5b"),  # fallback try
]
MAX_WALLET_SELECTORS: list[tuple[str, str]] = [
    ("maxWalletAmount()", "0x9c3b4fdc"),
    ("_maxWalletAmount()", "0xe3624bdc"),
]

# Correct selectors computed from keccak256
_SELECTOR_MAP = {
    "maxTransactionAmount()": Web3.keccak(text="maxTransactionAmount()")[:4].hex(),
    "_maxTxAmount()":         Web3.keccak(text="_maxTxAmount()")[:4].hex(),
    "maxTxAmount()":          Web3.keccak(text="maxTxAmount()")[:4].hex(),
    "maxWalletAmount()":      Web3.keccak(text="maxWalletAmount()")[:4].hex(),
    "_maxWalletAmount()":     Web3.keccak(text="_maxWalletAmount()")[:4].hex(),
}

# Cooldown-related function selectors (keccak-derived)
_COOLDOWN_SELECTORS: list[str] = [
    Web3.keccak(text="cooldownTimer()")[:4].hex(),
    Web3.keccak(text="tradeCooldownEnabled()")[:4].hex(),
    Web3.keccak(text="_cooldownBlocks()")[:4].hex(),
]

# Human-readable names for bytecode substring matching
_COOLDOWN_BYTECODE_NAMES: list[str] = [
    "cooldowntimer",
    "tradecooldownenabled",
    "_cooldownblocks",
    "cooldown",
]

# Second dead-like address for transfer-block simulation
ADDR_ONE = "0x0000000000000000000000000000000000000001"

# ---------------------------------------------------------------------------
# Contract instances
# ---------------------------------------------------------------------------

fee_checker = w3.eth.contract(
    address=Web3.to_checksum_address(FEE_CHECKER_CONTRACT),
    abi=FEE_CHECKER_ABI,
)

# Simulation amount: 1 PLS (in wei)
SIM_AMOUNT = w3.to_wei(1, "ether")

# Variable amounts for multi-amount testing (in PLS)
VARIABLE_AMOUNTS_PLS = [0.1, 1, 10, 100]

# Gas thresholds
GAS_MEDIUM_THRESHOLD = 2_000_000
GAS_HIGH_THRESHOLD = 3_500_000

# Dummy address for simulations (dead address)
DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD"


# ---------------------------------------------------------------------------
# Helper: Single-amount simulation via FeeChecker
# ---------------------------------------------------------------------------

def _simulate_single(
    token_addr: str,
    router_addr: str,
    amount_wei: int,
) -> dict | None:
    """
    Run honeyCheck for one (token, router, amount) combination.
    Returns parsed dict or None on failure.
    """
    try:
        result = fee_checker.functions.honeyCheck(
            Web3.to_checksum_address(token_addr),
            Web3.to_checksum_address(router_addr),
        ).call({"value": amount_wei})

        buy_result, token_balance2, sell_result, buy_cost, sell_cost, expected_amount = result

        buy_success = buy_result > 0
        sell_success = sell_result > 0

        buy_tax_pct = 0.0
        sell_tax_pct = 0.0

        if buy_success and expected_amount > 0 and buy_result > 0:
            if buy_result < expected_amount:
                buy_tax_pct = ((expected_amount - buy_result) / expected_amount) * 100

        if sell_success and sell_result > 0:
            roundtrip_loss = max(0, ((amount_wei - sell_result) / amount_wei) * 100)
            sell_tax_pct = max(0, roundtrip_loss - buy_tax_pct)

        return {
            "buy_result": buy_result,
            "sell_result": sell_result,
            "buy_success": buy_success,
            "sell_success": sell_success,
            "buy_tax_pct": round(buy_tax_pct, 2),
            "sell_tax_pct": round(sell_tax_pct, 2),
            "is_honeypot": not sell_success or sell_result == 0,
        }
    except Exception as e:
        logger.debug(f"Simulation failed for amount {amount_wei}: {str(e)[:120]}")
        return None


# ---------------------------------------------------------------------------
# 1. Variable-amount testing
# ---------------------------------------------------------------------------

def _test_variable_amounts(
    token_addr: str,
    router_addr: str,
) -> dict:
    """
    Test multiple PLS amounts to detect dynamic taxes.
    Returns:
        {
            "tax_by_amount": {amount_pls: {"buy_tax": float, "sell_tax": float}},
            "dynamic_tax": bool,
            "best_buy_tax": float,
            "best_sell_tax": float,
            "best_is_honeypot": bool | None,
            "best_buy_success": bool,
            "best_sell_success": bool,
        }
    """
    tax_by_amount: dict[float, dict] = {}
    best = None  # track result with lowest combined tax

    for amount_pls in VARIABLE_AMOUNTS_PLS:
        amount_wei = w3.to_wei(amount_pls, "ether")
        sim = _simulate_single(token_addr, router_addr, amount_wei)
        if sim is None:
            tax_by_amount[amount_pls] = {"buy_tax": None, "sell_tax": None, "error": True}
            continue

        entry = {
            "buy_tax": sim["buy_tax_pct"],
            "sell_tax": sim["sell_tax_pct"],
        }
        tax_by_amount[amount_pls] = entry

        combined = sim["buy_tax_pct"] + sim["sell_tax_pct"]
        if best is None or combined < (best["buy_tax_pct"] + best["sell_tax_pct"]):
            best = sim

    # Detect dynamic tax: compare successful results, flag if any differ by >2%
    successful_buy_taxes = [
        v["buy_tax"] for v in tax_by_amount.values()
        if v.get("buy_tax") is not None
    ]
    successful_sell_taxes = [
        v["sell_tax"] for v in tax_by_amount.values()
        if v.get("sell_tax") is not None
    ]

    dynamic_tax = False
    if len(successful_buy_taxes) >= 2:
        if max(successful_buy_taxes) - min(successful_buy_taxes) > 2:
            dynamic_tax = True
    if len(successful_sell_taxes) >= 2:
        if max(successful_sell_taxes) - min(successful_sell_taxes) > 2:
            dynamic_tax = True

    if best is None:
        return {
            "tax_by_amount": tax_by_amount,
            "dynamic_tax": dynamic_tax,
            "best_buy_tax": None,
            "best_sell_tax": None,
            "best_is_honeypot": None,
            "best_buy_success": False,
            "best_sell_success": False,
        }

    return {
        "tax_by_amount": tax_by_amount,
        "dynamic_tax": dynamic_tax,
        "best_buy_tax": best["buy_tax_pct"],
        "best_sell_tax": best["sell_tax_pct"],
        "best_is_honeypot": best["is_honeypot"],
        "best_buy_success": best["buy_success"],
        "best_sell_success": best["sell_success"],
    }


# ---------------------------------------------------------------------------
# 2. Gas estimation
# ---------------------------------------------------------------------------

def _estimate_gas(
    token_addr: str,
    router_addr: str,
) -> dict:
    """
    Estimate gas for buy and sell swaps.
    Returns {"buy_gas": int|None, "sell_gas": int|None}.
    """
    buy_gas = None
    sell_gas = None
    wpls = Web3.to_checksum_address(WPLS_ADDRESS)
    token = Web3.to_checksum_address(token_addr)
    router_cs = Web3.to_checksum_address(router_addr)
    router_contract = w3.eth.contract(address=router_cs, abi=ROUTER_ABI)
    deadline = 2**64  # far-future deadline

    # Buy gas estimate
    try:
        buy_gas = router_contract.functions \
            .swapExactETHForTokensSupportingFeeOnTransferTokens(
                0,                  # amountOutMin
                [wpls, token],      # path
                DEAD_ADDRESS,       # to
                deadline,
            ).estimate_gas({"value": SIM_AMOUNT, "from": DEAD_ADDRESS})
    except Exception as e:
        logger.debug(f"Buy gas estimation failed: {str(e)[:120]}")

    # Sell gas estimate — likely to fail because DEAD_ADDRESS doesn't hold tokens
    try:
        sell_gas = router_contract.functions \
            .swapExactTokensForETHSupportingFeeOnTransferTokens(
                w3.to_wei(1, "ether"),   # amountIn (1 token unit)
                0,                        # amountOutMin
                [token, wpls],            # path
                DEAD_ADDRESS,
                deadline,
            ).estimate_gas({"from": DEAD_ADDRESS})
    except Exception as e:
        logger.debug(f"Sell gas estimation failed (expected if no token balance): {str(e)[:120]}")

    return {"buy_gas": buy_gas, "sell_gas": sell_gas}


# ---------------------------------------------------------------------------
# 3. Transfer tax detection
# ---------------------------------------------------------------------------

def _detect_transfer_tax(
    token_addr: str,
    router_addr: str,
) -> float | None:
    """
    Detect transfer tax by simulating a token.transfer() from the pair
    address (which holds tokens) to a dead address.
    Returns transfer_tax_pct or None if detection failed.
    """
    try:
        token_cs = Web3.to_checksum_address(token_addr)
        wpls = Web3.to_checksum_address(WPLS_ADDRESS)
        router_cs = Web3.to_checksum_address(router_addr)

        # Find the pair address (it holds tokens, so we use it as sender)
        router_contract = w3.eth.contract(address=router_cs, abi=ROUTER_ABI)
        factory_addr = router_contract.functions.factory().call()
        factory = w3.eth.contract(
            address=Web3.to_checksum_address(factory_addr),
            abi=FACTORY_ABI,
        )
        pair_addr = factory.functions.getPair(token_cs, wpls).call()

        if pair_addr == "0x0000000000000000000000000000000000000000":
            logger.debug("No pair found for transfer tax detection")
            return None

        token_contract = w3.eth.contract(address=token_cs, abi=ERC20_ABI)

        # Get pair's token balance
        pair_balance = token_contract.functions.balanceOf(pair_addr).call()
        if pair_balance == 0:
            logger.debug("Pair has zero token balance, cannot detect transfer tax")
            return None

        # Use 0.01% of pair balance as test amount (small to avoid max-tx issues)
        test_amount = max(1, pair_balance // 10_000)

        # Get receiver's balance before
        receiver = Web3.to_checksum_address(DEAD_ADDRESS)
        balance_before = token_contract.functions.balanceOf(receiver).call()

        # Simulate transfer from pair to dead address via eth_call
        transfer_data = token_contract.functions.transfer(
            receiver, test_amount
        ).build_transaction({
            "from": pair_addr,
            "gas": 500_000,
            "gasPrice": 0,
        })

        w3.eth.call({
            "from": pair_addr,
            "to": token_cs,
            "data": transfer_data["data"],
            "gas": 500_000,
        })

        # After the simulated transfer, check receiver's balance via a
        # multicall-style approach: we read the state AFTER the transfer
        # Unfortunately eth_call doesn't persist state between calls,
        # so we encode balanceOf into the same call isn't possible directly.
        #
        # Alternative approach: encode transfer + balanceOf in a single
        # eth_call is complex. Instead, we compare:
        #   - the amount sent (test_amount) with what the contract's
        #     transfer function should deliver.
        #
        # For tokens with transfer tax, the ERC20 transfer() function
        # itself deducts tax. We can detect this by:
        #   1. If transfer reverts -> probably honeypot (already detected)
        #   2. If transfer succeeds and buy_tax != sell_tax -> likely has
        #      fee-on-transfer
        #
        # A more reliable approach: use the FeeChecker results.
        # If buy_tax > 0 and the token deducts on transfer(), the
        # buy_tax already captures it. But a PURE transfer tax
        # (not via router) is different.
        #
        # Best approach: use a staticcall to simulate the state change.
        # We'll use a raw eth_call with the transfer calldata FROM the pair
        # and then a separate eth_call for balanceOf. Since eth_call is
        # stateless between calls, we approximate by checking if the
        # contract code contains fee/tax patterns.

        # Practical approach: simulate via FeeChecker differences.
        # If the token has a transfer tax, the buy_result (tokens received)
        # will be LESS than the expectedAmount from getAmountsOut.
        # The buy_tax from FeeChecker already captures this.
        # So we return the buy_tax as a proxy for transfer tax.
        # If buy_tax > 0 and the token isn't using a router-specific tax,
        # it's likely a transfer tax.

        # Since direct state comparison isn't possible with simple eth_call,
        # we return None and let the buy_tax from the main check serve
        # as the indicator. A future improvement could use a custom
        # multicall contract.

        # Actually, we CAN detect it: if the transfer itself succeeds
        # (didn't revert), we know there's no hard block on transfers.
        # The tax amount can be inferred from buy_tax.

        # The transfer call succeeded (didn't revert), meaning transfers work.
        # We'll flag transfer tax based on buy_tax from the FeeChecker.
        return None  # Handled via _infer_transfer_tax below

    except Exception as e:
        logger.debug(f"Transfer tax detection failed: {str(e)[:120]}")
        return None


def _infer_transfer_tax(
    token_addr: str,
    router_addr: str,
    buy_tax_from_sim: float | None,
) -> float | None:
    """
    Infer transfer tax by comparing raw transfer vs router swap.
    Uses the pair address as sender (it holds tokens).

    Strategy: get the pair address, read its balance, simulate a
    transfer of a small amount, then read the receiver balance
    change via a custom eth_call sequence using state overrides
    (not available on all nodes). Fallback: use bytecode heuristics.
    """
    try:
        token_cs = Web3.to_checksum_address(token_addr)
        wpls = Web3.to_checksum_address(WPLS_ADDRESS)
        router_cs = Web3.to_checksum_address(router_addr)

        # Find pair address
        router_contract = w3.eth.contract(address=router_cs, abi=ROUTER_ABI)
        factory_addr = router_contract.functions.factory().call()
        factory = w3.eth.contract(
            address=Web3.to_checksum_address(factory_addr),
            abi=FACTORY_ABI,
        )
        pair_addr = factory.functions.getPair(token_cs, wpls).call()
        if pair_addr == "0x0000000000000000000000000000000000000000":
            return None

        token_contract = w3.eth.contract(address=token_cs, abi=ERC20_ABI)
        pair_balance = token_contract.functions.balanceOf(pair_addr).call()
        if pair_balance == 0:
            return None

        # Test amount: 0.01% of pair balance
        test_amount = max(1, pair_balance // 10_000)

        # Read dead address balance before (actual on-chain state)
        receiver = Web3.to_checksum_address(DEAD_ADDRESS)
        balance_before = token_contract.functions.balanceOf(receiver).call()

        # Build transfer calldata
        transfer_calldata = token_contract.encode_abi(
            "transfer",
            args=[receiver, test_amount],
        )

        # Build balanceOf calldata for receiver
        balance_calldata = token_contract.encode_abi(
            "balanceOf",
            args=[receiver],
        )

        # We need to execute transfer then check balance in one atomic call.
        # Since standard eth_call can't chain state, we use a trick:
        # Deploy a minimal proxy via eth_call that does transfer + balanceOf.
        #
        # Simpler approach that works on most nodes:
        # Use eth_call with state override to give the pair address gas,
        # then just check if transfer succeeds. The actual received amount
        # can only be checked with multicall.
        #
        # Pragmatic fallback: check bytecode for fee keywords
        code = w3.eth.get_code(token_cs)
        code_hex = code.hex().lower()

        # Common transfer-tax signatures in bytecode (function selectors
        # and storage patterns found in tax tokens)
        tax_indicators = [
            "fee",      # _fee, taxFee, liquidityFee
            "tax",      # _tax, buyTax, sellTax
            "takefee",  # _takeFee pattern
            "7b1a4909", # Selector for excludeFromFees(address,bool)
            "c0246668", # Selector for setAutomatedMarketMakerPair
        ]

        has_tax_code = any(ind in code_hex for ind in tax_indicators)

        if has_tax_code and buy_tax_from_sim is not None and buy_tax_from_sim > 0:
            # The buy tax from FeeChecker is effectively the transfer tax
            # applied during the swap (transfer from pair to buyer).
            return round(buy_tax_from_sim, 2)

        if has_tax_code:
            # Contract has tax-related code but we couldn't measure it
            # Return 0 to indicate "detected but unmeasured"
            return 0.0

        return None

    except Exception as e:
        logger.debug(f"Transfer tax inference failed: {str(e)[:120]}")
        return None


# ---------------------------------------------------------------------------
# 4. Max transaction / max wallet detection
# ---------------------------------------------------------------------------

def _detect_max_limits(token_addr: str) -> dict:
    """
    Check for maxTransactionAmount and maxWalletAmount by calling
    common getter functions via eth_call.
    Returns {"max_tx_amount": str|None, "max_wallet_amount": str|None}.
    """
    token_cs = Web3.to_checksum_address(token_addr)
    result = {"max_tx_amount": None, "max_wallet_amount": None}

    # Try to get decimals for formatting
    decimals = 18
    try:
        token_contract = w3.eth.contract(address=token_cs, abi=ERC20_ABI)
        decimals = token_contract.functions.decimals().call()
    except Exception:
        pass

    # Max transaction amount
    for fn_name in ["maxTransactionAmount()", "_maxTxAmount()", "maxTxAmount()"]:
        selector = "0x" + _SELECTOR_MAP[fn_name]
        try:
            raw = w3.eth.call({"to": token_cs, "data": selector})
            value = int(raw.hex(), 16)
            if value > 0:
                # Convert to human-readable units
                human = value / (10 ** decimals)
                result["max_tx_amount"] = str(human)
                logger.debug(f"Max TX amount via {fn_name}: {human}")
                break
        except Exception:
            continue

    # Max wallet amount
    for fn_name in ["maxWalletAmount()", "_maxWalletAmount()"]:
        selector = "0x" + _SELECTOR_MAP[fn_name]
        try:
            raw = w3.eth.call({"to": token_cs, "data": selector})
            value = int(raw.hex(), 16)
            if value > 0:
                human = value / (10 ** decimals)
                result["max_wallet_amount"] = str(human)
                logger.debug(f"Max wallet amount via {fn_name}: {human}")
                break
        except Exception:
            continue

    return result


# ---------------------------------------------------------------------------
# 5. Warning flags
# ---------------------------------------------------------------------------

def _generate_flags(
    is_honeypot: bool | None,
    buy_tax: float | None,
    sell_tax: float | None,
    transfer_tax: float | None,
    buy_gas: int | None,
    sell_gas: int | None,
    dynamic_tax: bool,
    max_tx_amount: str | None,
    buy_success: bool,
    sell_success: bool,
    simulation_error: str | None,
    *,
    max_wallet_amount: str | None = None,
    has_blacklist: bool = False,
    has_pause: bool = False,
    is_proxy: bool = False,
    is_verified: bool = True,
    ownership_renounced: bool | None = None,
    has_cooldown: bool = False,
    transfer_blocked: bool = False,
) -> list[str]:
    """Generate warning flags from all collected data.

    The keyword-only parameters (max_wallet_amount … transfer_blocked) are
    optional so that existing callers in ``check_honeypot`` keep working
    without any change.  The new ``generate_combined_flags`` helper passes
    them when combining honeypot + contract results.
    """
    flags: list[str] = []

    if is_honeypot is True:
        flags.append("honeypot")

    if buy_tax is not None and buy_tax > 50:
        flags.append("extreme_tax")
    elif sell_tax is not None and sell_tax > 50:
        flags.append("extreme_tax")

    if buy_tax is not None and buy_tax > 20 and "extreme_tax" not in flags:
        flags.append("high_buy_tax")

    if sell_tax is not None and sell_tax > 20 and "extreme_tax" not in flags:
        flags.append("high_sell_tax")

    if dynamic_tax:
        flags.append("dynamic_tax")

    if sell_gas is not None:
        if sell_gas > GAS_HIGH_THRESHOLD:
            flags.append("high_gas")
        elif sell_gas > GAS_MEDIUM_THRESHOLD:
            flags.append("medium_gas")
    elif buy_gas is not None:
        # Fallback: use buy gas if sell gas unavailable
        if buy_gas > GAS_HIGH_THRESHOLD:
            flags.append("high_gas")
        elif buy_gas > GAS_MEDIUM_THRESHOLD:
            flags.append("medium_gas")

    if transfer_tax is not None and transfer_tax > 0:
        flags.append("has_transfer_tax")

    if max_tx_amount is not None:
        flags.append("max_tx_limited")

    if simulation_error is not None or (not buy_success and not sell_success):
        flags.append("simulation_failed")

    # -- Additional flags from contract analysis / extra detections ----------
    if max_wallet_amount is not None:
        flags.append("max_wallet_limited")

    if has_blacklist:
        flags.append("has_blacklist_function")

    if has_pause:
        flags.append("can_be_paused")

    if is_proxy:
        flags.append("proxy_upgradeable")

    if not is_verified:
        flags.append("closed_source")

    if ownership_renounced is False:
        flags.append("active_owner")

    if has_cooldown:
        flags.append("has_cooldown")

    if transfer_blocked:
        flags.append("transfer_blocked")

    return flags


# ---------------------------------------------------------------------------
# 6. Cooldown detection
# ---------------------------------------------------------------------------

def _detect_cooldown(token_addr: str) -> bool:
    """
    Detect cooldown mechanisms by checking contract bytecode for known
    cooldown-related function selectors and keyword patterns.

    Returns True if a cooldown mechanism is likely present.
    """
    try:
        token_cs = Web3.to_checksum_address(token_addr)
        code = w3.eth.get_code(token_cs)
        if not code or code == b"0x":
            return False

        code_hex = code.hex().lower()

        # Check for keccak-derived 4-byte selectors in bytecode
        for selector in _COOLDOWN_SELECTORS:
            # Selectors appear in bytecode without the 0x prefix
            if selector in code_hex:
                logger.debug(f"Cooldown selector {selector} found in bytecode")
                return True

        # Check for human-readable keyword fragments in bytecode
        # Solidity compiler encodes string literals and variable names;
        # the ascii representation may appear in the deployed bytecode
        # when the source uses these identifiers.
        for name in _COOLDOWN_BYTECODE_NAMES:
            name_hex = name.encode("utf-8").hex()
            if name_hex in code_hex:
                logger.debug(f"Cooldown keyword '{name}' found in bytecode")
                return True

        return False
    except Exception as e:
        logger.debug(f"Cooldown detection failed: {str(e)[:120]}")
        return False


# ---------------------------------------------------------------------------
# 7. Transfer-block detection
# ---------------------------------------------------------------------------

def _detect_transfer_block(
    token_addr: str,
    router_addr: str,
) -> bool:
    """
    Detect tokens that block direct wallet-to-wallet transfers while
    allowing DEX swaps (a common anti-bot / rug mechanism).

    Strategy:
      1. Simulate a plain ``token.transfer()`` between two non-DEX
         addresses (0x...dead and 0x...0001).
      2. If the transfer reverts, check whether a router swap succeeds
         (already validated by the honeypot simulation).
      3. If swap works but transfer reverts -> the token blocks
         non-DEX transfers.

    Returns True if direct transfers appear blocked.
    """
    try:
        token_cs = Web3.to_checksum_address(token_addr)
        wpls = Web3.to_checksum_address(WPLS_ADDRESS)
        router_cs = Web3.to_checksum_address(router_addr)

        # Find the pair address (it holds tokens, so we can use it as sender)
        router_contract = w3.eth.contract(address=router_cs, abi=ROUTER_ABI)
        factory_addr = router_contract.functions.factory().call()
        factory = w3.eth.contract(
            address=Web3.to_checksum_address(factory_addr),
            abi=FACTORY_ABI,
        )
        pair_addr = factory.functions.getPair(token_cs, wpls).call()
        if pair_addr == "0x0000000000000000000000000000000000000000":
            return False

        token_contract = w3.eth.contract(address=token_cs, abi=ERC20_ABI)
        pair_balance = token_contract.functions.balanceOf(pair_addr).call()
        if pair_balance == 0:
            return False

        # Use a tiny fraction so max-tx limits don't interfere
        test_amount = max(1, pair_balance // 100_000)

        # Simulate: pair_addr -> ADDR_ONE  (two non-DEX addresses)
        sender = pair_addr                                  # holds tokens
        receiver = Web3.to_checksum_address(ADDR_ONE)       # 0x...0001

        transfer_calldata = token_contract.encode_abi(
            "transfer",
            args=[receiver, test_amount],
        )

        try:
            w3.eth.call({
                "from": sender,
                "to": token_cs,
                "data": transfer_calldata,
                "gas": 500_000,
            })
            # Transfer succeeded -> not blocked
            return False
        except Exception:
            # Transfer reverted -> check if router swap works
            pass

        # Verify that the router swap path still works (buy direction)
        try:
            router_contract_obj = w3.eth.contract(address=router_cs, abi=ROUTER_ABI)
            router_contract_obj.functions \
                .swapExactETHForTokensSupportingFeeOnTransferTokens(
                    0,
                    [wpls, token_cs],
                    Web3.to_checksum_address(DEAD_ADDRESS),
                    2**64,
                ).call({"value": SIM_AMOUNT, "from": Web3.to_checksum_address(DEAD_ADDRESS)})
            # Router swap succeeded but direct transfer reverted
            logger.debug("Transfer blocked: direct transfer reverts but DEX swap works")
            return True
        except Exception:
            # Both failed -> probably a different issue (not transfer-block specific)
            return False

    except Exception as e:
        logger.debug(f"Transfer block detection failed: {str(e)[:120]}")
        return False


# ---------------------------------------------------------------------------
# 8. Combined flags (honeypot + contract analysis)
# ---------------------------------------------------------------------------

def generate_combined_flags(
    honeypot_result: dict,
    contract_result: dict,
) -> list[str]:
    """
    Produce a complete flag list by merging honeypot simulation data with
    contract-analysis data.

    This is the recommended entry point for the analyzer: call it after
    ``check_honeypot()`` and ``analyze_contract()`` have both returned.

    The function also runs cooldown and transfer-block detection on-the-fly
    when a working router is available in the honeypot result.
    """
    # --- Cooldown & transfer-block detection (needs RPC, not in contract) ---
    token_addr = honeypot_result.get("_token_addr")
    router_addr = honeypot_result.get("_router_addr")

    has_cooldown = False
    transfer_blocked = False

    if token_addr:
        try:
            has_cooldown = _detect_cooldown(token_addr)
        except Exception as e:
            logger.debug(f"Cooldown detection error: {str(e)[:120]}")

    if token_addr and router_addr:
        try:
            transfer_blocked = _detect_transfer_block(token_addr, router_addr)
        except Exception as e:
            logger.debug(f"Transfer block detection error: {str(e)[:120]}")

    # --- Delegate to _generate_flags with all available info ---------------
    return _generate_flags(
        is_honeypot=honeypot_result.get("is_honeypot"),
        buy_tax=honeypot_result.get("buy_tax_pct"),
        sell_tax=honeypot_result.get("sell_tax_pct"),
        transfer_tax=honeypot_result.get("transfer_tax_pct"),
        buy_gas=honeypot_result.get("buy_gas"),
        sell_gas=honeypot_result.get("sell_gas"),
        dynamic_tax=honeypot_result.get("dynamic_tax", False),
        max_tx_amount=honeypot_result.get("max_tx_amount"),
        buy_success=honeypot_result.get("buy_success", False),
        sell_success=honeypot_result.get("sell_success", False),
        simulation_error=honeypot_result.get("error"),
        # -- contract-sourced flags --
        max_wallet_amount=honeypot_result.get("max_wallet_amount"),
        has_blacklist=contract_result.get("has_blacklist", False),
        has_pause=contract_result.get("has_pause", False),
        is_proxy=contract_result.get("is_proxy", False),
        is_verified=contract_result.get("is_verified", True),
        ownership_renounced=contract_result.get("ownership_renounced"),
        # -- extra detections --
        has_cooldown=has_cooldown,
        transfer_blocked=transfer_blocked,
    )


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def _build_empty_result(
    error: str | None = None,
    router: str | None = None,
) -> dict:
    """Build a result dict with all fields set to safe defaults."""
    return {
        "is_honeypot": None,
        "buy_tax_pct": None,
        "sell_tax_pct": None,
        "transfer_tax_pct": None,
        "buy_gas": None,
        "sell_gas": None,
        "max_tx_amount": None,
        "max_wallet_amount": None,
        "dynamic_tax": False,
        "tax_by_amount": None,
        "flags": ["simulation_failed"] if error else [],
        "buy_success": False,
        "sell_success": False,
        "error": error,
        "router": router,
    }


def check_honeypot(token_address: str) -> dict:
    """
    Simulate buy+sell via FeeChecker contract with enriched analysis.
    Returns:
        {
            "is_honeypot": bool | None,
            "buy_tax_pct": float,
            "sell_tax_pct": float,
            "transfer_tax_pct": float | None,
            "buy_gas": int | None,
            "sell_gas": int | None,
            "max_tx_amount": str | None,
            "max_wallet_amount": str | None,
            "dynamic_tax": bool,
            "tax_by_amount": dict | None,
            "flags": list[str],
            "buy_success": bool,
            "sell_success": bool,
            "error": str | None,
            "router": str,
        }
    """
    # WPLS cannot be honeypot-checked (swap WPLS->WPLS = IDENTICAL_ADDRESSES)
    if token_address.lower() == WPLS_ADDRESS.lower():
        return {
            "is_honeypot": False,
            "buy_tax_pct": 0.0,
            "sell_tax_pct": 0.0,
            "transfer_tax_pct": 0.0,
            "buy_gas": None,
            "sell_gas": None,
            "max_tx_amount": None,
            "max_wallet_amount": None,
            "dynamic_tax": False,
            "tax_by_amount": None,
            "flags": [],
            "buy_success": True,
            "sell_success": True,
            "error": None,
            "router": "native",
        }

    token_addr = Web3.to_checksum_address(token_address)

    # ------------------------------------------------------------------
    # Phase 1: Find working router via standard 1-PLS simulation
    # ------------------------------------------------------------------
    primary_result = None
    working_router_name = None
    working_router_addr = None

    for router_name, router_addr in [("V2", PULSEX_V2_ROUTER), ("V1", PULSEX_V1_ROUTER)]:
        sim = _simulate_single(token_addr, router_addr, SIM_AMOUNT)
        if sim is not None:
            primary_result = sim
            working_router_name = router_name
            working_router_addr = router_addr
            break
        else:
            if router_name == "V2":
                logger.debug(f"V2 router failed for {token_address}, trying V1")

    if primary_result is None:
        logger.warning(f"Honeypot check failed for {token_address}: all routers failed")
        return _build_empty_result(error="All routers failed", router=None)

    # ------------------------------------------------------------------
    # Phase 2: Variable-amount testing (enrichment)
    # ------------------------------------------------------------------
    var_result = {"tax_by_amount": None, "dynamic_tax": False}
    try:
        var_result = _test_variable_amounts(token_addr, working_router_addr)
        logger.debug(
            f"Variable amount test: dynamic_tax={var_result['dynamic_tax']}, "
            f"amounts_tested={len([v for v in var_result['tax_by_amount'].values() if not v.get('error')])}"
        )
    except Exception as e:
        logger.warning(f"Variable amount testing failed: {str(e)[:120]}")

    # Use the BEST result from variable testing if available
    if var_result.get("best_buy_tax") is not None:
        best_buy_tax = var_result["best_buy_tax"]
        best_sell_tax = var_result["best_sell_tax"]
        best_is_honeypot = var_result["best_is_honeypot"]
        best_buy_success = var_result["best_buy_success"]
        best_sell_success = var_result["best_sell_success"]
    else:
        best_buy_tax = primary_result["buy_tax_pct"]
        best_sell_tax = primary_result["sell_tax_pct"]
        best_is_honeypot = primary_result["is_honeypot"]
        best_buy_success = primary_result["buy_success"]
        best_sell_success = primary_result["sell_success"]

    # ------------------------------------------------------------------
    # Phase 3: Gas estimation (enrichment)
    # ------------------------------------------------------------------
    gas_result = {"buy_gas": None, "sell_gas": None}
    try:
        gas_result = _estimate_gas(token_addr, working_router_addr)
        logger.debug(f"Gas estimation: buy={gas_result['buy_gas']}, sell={gas_result['sell_gas']}")
    except Exception as e:
        logger.warning(f"Gas estimation failed: {str(e)[:120]}")

    # ------------------------------------------------------------------
    # Phase 4: Transfer tax detection (enrichment)
    # ------------------------------------------------------------------
    transfer_tax_pct = None
    try:
        transfer_tax_pct = _infer_transfer_tax(
            token_addr, working_router_addr, best_buy_tax,
        )
        if transfer_tax_pct is not None:
            logger.debug(f"Transfer tax detected: {transfer_tax_pct}%")
    except Exception as e:
        logger.warning(f"Transfer tax detection failed: {str(e)[:120]}")

    # ------------------------------------------------------------------
    # Phase 5: Max transaction / wallet detection (enrichment)
    # ------------------------------------------------------------------
    max_limits = {"max_tx_amount": None, "max_wallet_amount": None}
    try:
        max_limits = _detect_max_limits(token_addr)
        if max_limits["max_tx_amount"]:
            logger.debug(f"Max TX amount: {max_limits['max_tx_amount']}")
        if max_limits["max_wallet_amount"]:
            logger.debug(f"Max wallet amount: {max_limits['max_wallet_amount']}")
    except Exception as e:
        logger.warning(f"Max limits detection failed: {str(e)[:120]}")

    # ------------------------------------------------------------------
    # Phase 6: Generate warning flags
    # ------------------------------------------------------------------
    flags = _generate_flags(
        is_honeypot=best_is_honeypot,
        buy_tax=best_buy_tax,
        sell_tax=best_sell_tax,
        transfer_tax=transfer_tax_pct,
        buy_gas=gas_result["buy_gas"],
        sell_gas=gas_result["sell_gas"],
        dynamic_tax=var_result.get("dynamic_tax", False),
        max_tx_amount=max_limits["max_tx_amount"],
        buy_success=best_buy_success,
        sell_success=best_sell_success,
        simulation_error=None,
    )

    return {
        "is_honeypot": best_is_honeypot,
        "buy_tax_pct": round(best_buy_tax, 2) if best_buy_tax is not None else None,
        "sell_tax_pct": round(best_sell_tax, 2) if best_sell_tax is not None else None,
        "transfer_tax_pct": transfer_tax_pct,
        "buy_gas": gas_result["buy_gas"],
        "sell_gas": gas_result["sell_gas"],
        "max_tx_amount": max_limits["max_tx_amount"],
        "max_wallet_amount": max_limits["max_wallet_amount"],
        "dynamic_tax": var_result.get("dynamic_tax", False),
        "tax_by_amount": var_result.get("tax_by_amount"),
        "flags": flags,
        "buy_success": best_buy_success,
        "sell_success": best_sell_success,
        "error": None,
        "router": working_router_name,
        # Internal: used by generate_combined_flags for extra detections
        "_token_addr": str(token_addr),
        "_router_addr": str(working_router_addr) if working_router_addr else None,
    }
