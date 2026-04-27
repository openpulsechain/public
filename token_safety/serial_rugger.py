from __future__ import annotations
"""
Serial Rugger Detection — Deployer reputation scoring.
Analyzes deployer history:
- How many tokens deployed
- How many died within 24h
- Pattern of pump-and-dump behavior
"""

import logging
import requests
from datetime import datetime, timezone
from config import SCAN_API_URL

logger = logging.getLogger(__name__)


def get_deployer_address(token_address: str) -> str | None:
    """Get the deployer address for a token contract."""
    addr = token_address.lower()
    try:
        # Use /addresses/ endpoint which has creator_address_hash
        resp = requests.get(
            f"{SCAN_API_URL}/api/v2/addresses/{addr}",
            timeout=15
        )
        if resp.status_code == 200:
            data = resp.json()
            creator = data.get("creator_address_hash")
            if creator:
                return creator.lower()
    except Exception as e:
        logger.warning(f"Failed to get deployer for {addr}: {str(e)[:100]}")
    return None


def get_deployer_tokens(deployer_address: str) -> list[dict]:
    """
    Get all tokens deployed by an address.
    Uses internal transactions (contract creation) from Scan API.
    """
    addr = deployer_address.lower()
    tokens = []

    try:
        # Get internal transactions (contract creations)
        resp = requests.get(
            f"{SCAN_API_URL}/api/v2/addresses/{addr}/internal-transactions",
            params={"limit": 50, "filter": "to"},
            timeout=15
        )
        if resp.status_code != 200:
            return tokens

        data = resp.json()
        for tx in data.get("items", []):
            # Contract creation = "to" is null and "created_contract" exists
            created = tx.get("created_contract") or {}
            if created.get("hash"):
                contract_addr = created["hash"].lower()

                # Check if it's a token (has token info)
                token_resp = requests.get(
                    f"{SCAN_API_URL}/api/v2/tokens/{contract_addr}",
                    timeout=10
                )
                if token_resp.status_code == 200:
                    token_data = token_resp.json()
                    if token_data.get("type") == "ERC-20":
                        tokens.append({
                            "address": contract_addr,
                            "symbol": token_data.get("symbol", "?"),
                            "name": token_data.get("name", "?"),
                            "holders": int(token_data.get("holders", 0) or 0),
                            "total_supply": token_data.get("total_supply", "0"),
                        })

    except Exception as e:
        logger.warning(f"Failed to get deployer tokens for {addr}: {str(e)[:100]}")

    return tokens


def calculate_deployer_score(deployer_address: str) -> dict:
    """
    Calculate a reputation score for a deployer.
    Returns:
        {
            "deployer": str,
            "tokens_deployed": int,
            "tokens_dead": int (holders < 5),
            "tokens_alive": int,
            "dead_ratio": float,
            "reputation_score": int (0-100, higher = safer),
            "risk_level": str ("low", "medium", "high", "critical"),
            "tokens": list[dict],
        }
    """
    tokens = get_deployer_tokens(deployer_address)

    total = len(tokens)
    dead = sum(1 for t in tokens if t.get("holders", 0) < 5)
    alive = total - dead
    dead_ratio = (dead / total * 100) if total > 0 else 0

    # Score calculation
    if total == 0:
        score = 50  # Unknown
        risk_level = "unknown"
    elif total == 1:
        score = 70  # Single token, neutral
        risk_level = "low"
    else:
        # More tokens with more dead = worse score
        score = max(0, 100 - int(dead_ratio) - (dead * 5))

        if dead_ratio > 80 and dead > 3:
            risk_level = "critical"
        elif dead_ratio > 60 and dead > 2:
            risk_level = "high"
        elif dead_ratio > 40:
            risk_level = "medium"
        else:
            risk_level = "low"

    return {
        "deployer": deployer_address.lower(),
        "tokens_deployed": total,
        "tokens_dead": dead,
        "tokens_alive": alive,
        "dead_ratio": round(dead_ratio, 1),
        "reputation_score": max(0, min(100, score)),
        "risk_level": risk_level,
        "tokens": tokens[:20],  # Cap at 20 for response size
    }


def analyze_deployer_for_token(token_address: str) -> dict | None:
    """
    Full deployer analysis starting from a token address.
    """
    deployer = get_deployer_address(token_address)
    if not deployer:
        return None

    return calculate_deployer_score(deployer)
