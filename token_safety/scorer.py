"""
Token Safety Score calculator.
Combines all analyses into a 0-100 score.

Weights (base = 100 pts):
- Honeypot simulation: 30 pts
- Contract analysis: 25 pts
- LP analysis: 20 pts
- Holder concentration: 15 pts
- Age & activity: 10 pts

Reputation adjustments (applied after base score):
- Canonical token bonus: up to +10 pts
- Deployer reputation malus: up to -10 pts
- Mature token bonus: up to +3 pts for tokens > 1 year
- Intel signals penalty: up to -15 pts for known bad actors, alerts, negative events

Category system (v2):
- Token is classified into a category BEFORE scoring
- Trusted categories (infrastructure, stablecoin, blue_chip_bridge) get:
  - Full holder score (concentration ignored — structural, not risky)
  - Compliance features neutralized (pause/blacklist = security, not risk)
  - "Unverified" penalty waived (bridged tokens aren't verified on PulseChain)
  - Score floor applied (minimum grade guarantee if not honeypot/scam)
- ecosystem_core tokens get a larger canonical bonus (+10)
"""

import math
import logging
from config import (
    WEIGHT_HONEYPOT, WEIGHT_CONTRACT, WEIGHT_LP, WEIGHT_HOLDERS, WEIGHT_AGE,
    HOLDER_CONCENTRATION_DANGER, HOLDER_CONCENTRATION_WARNING,
    MIN_HOLDERS_FOR_SAFETY, MIN_TOKEN_AGE_DAYS,
    TRUSTED_CATEGORIES, LP_ALERT_IMMUNE_CATEGORIES,
    GRADE_A_THRESHOLD, GRADE_B_THRESHOLD, GRADE_C_THRESHOLD, GRADE_D_THRESHOLD,
    CATEGORY_SCORE_FLOOR,
    CATEGORY_INFRASTRUCTURE, CATEGORY_STABLECOIN, CATEGORY_BLUE_CHIP_BRIDGE,
    CATEGORY_ECOSYSTEM_CORE, CATEGORY_ESTABLISHED, CATEGORY_EMERGING, CATEGORY_NEW,
)

logger = logging.getLogger(__name__)

# ── Token Classification Maps ──────────────────────────────────────
# Each token is classified into exactly one category.

INFRASTRUCTURE_TOKENS = {
    "0xa1077a294dde1b09bb078844df40758a5d0f9a27",  # WPLS
}

STABLECOIN_TOKENS = {
    "0xefd766ccb38eaf1dfd701853bfce31359239f305",  # DAI from Ethereum
    "0x15d38573d2feeb82e7ad5187ab8c1d52810b1f07",  # USDC from Ethereum
    "0x0cb6f5a34ad42ec934882a05265a7d5f59b51a2f",  # USDT from Ethereum
}

BLUE_CHIP_BRIDGE_TOKENS = {
    "0x02dcdd04e3f455d838cd1249292c58f3b79e3c3c",  # WETH from Ethereum
    "0xb17d901469b9208b17d916112988a3fed19b5ca1",  # WBTC (PulseChain bridge)
    "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",  # WBTC (Ethereum fork address)
}

ECOSYSTEM_CORE_TOKENS = {
    "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",  # HEX (eHEX)
    "0x57fde0a71132198bbec939b98976993d8d89d225",  # eHEX (PulseChain)
    "0x95b303987a60c71504d99aa1b13b4da07b0790ab",  # PLSX
    "0x2fa878ab3f87cc1c9737fc071108f904c0b0c95d",  # INC
    "0x0d86eb9f43c57f6ff3bc9e23d8f9d82503f0e84b",  # Maximus
    "0x3819f64f282bf135d62168c1e513280daf905e06",  # HEDRON
    "0xb56a1f3310578698f5d74e82413c7e0f4b0b54e5",  # LOAN
    "0xfc4913214444af5c715cc9f7b52655e788a569ed",  # ICSA
}

# Backward-compatible aliases used by analyzer.py impersonation check
CANONICAL_CORE = INFRASTRUCTURE_TOKENS | STABLECOIN_TOKENS | BLUE_CHIP_BRIDGE_TOKENS | ECOSYSTEM_CORE_TOKENS
CANONICAL_KNOWN = set()  # Merged into ECOSYSTEM_CORE_TOKENS

# All tokens with known canonical addresses (union of all categories)
ALL_CANONICAL = INFRASTRUCTURE_TOKENS | STABLECOIN_TOKENS | BLUE_CHIP_BRIDGE_TOKENS | ECOSYSTEM_CORE_TOKENS


def classify_token(
    token_address: str,
    liquidity_usd: float = 0,
    age_days: float = 0,
    holder_count: int = 0,
) -> str:
    """
    Classify a token into a category for differentiated scoring.
    Address-based categories take priority, then heuristic classification.
    """
    addr = token_address.lower()

    if addr in INFRASTRUCTURE_TOKENS:
        return CATEGORY_INFRASTRUCTURE
    if addr in STABLECOIN_TOKENS:
        return CATEGORY_STABLECOIN
    if addr in BLUE_CHIP_BRIDGE_TOKENS:
        return CATEGORY_BLUE_CHIP_BRIDGE
    if addr in ECOSYSTEM_CORE_TOKENS:
        return CATEGORY_ECOSYSTEM_CORE

    # Heuristic classification for non-canonical tokens
    if age_days >= 180 and holder_count >= 500 and liquidity_usd >= 50_000:
        return CATEGORY_ESTABLISHED
    if age_days >= 30 and holder_count >= 100 and liquidity_usd >= 10_000:
        return CATEGORY_EMERGING
    return CATEGORY_NEW


def calculate_score(
    honeypot: dict,
    contract: dict,
    lp: dict,
    holders: dict,
    token_address: str = "",
    deployer_reputation: dict | None = None,
    intel_signals: dict | None = None,
    category: str = "",
) -> dict:
    """
    Calculate composite safety score 0-100.

    Args:
        honeypot: Honeypot check results
        contract: Contract analysis results
        lp: Liquidity pool analysis results
        holders: Holder concentration results
        token_address: Token address (for canonical check)
        deployer_reputation: Optional deployer reputation data
            {"reputation_score": 0-100, "risk_level": "low"|"medium"|"high"|"critical", "dead_ratio": float}
        intel_signals: Optional intel signals from known_addresses, scam_radar_alerts, token_intelligence
            {"alerts": list, "negative_events": list, "deployer_flagged": bool, "deployer_risk_level": str}
        category: Token category from classify_token() — controls scoring rules

    Returns:
        {
            "score": int (0-100),
            "grade": str (A/B/C/D/F),
            "category": str,
            "honeypot_score": int,
            "contract_score": int,
            "lp_score": int,
            "holders_score": int,
            "age_score": int,
            "reputation_adj": int,
            "risks": list[str],
            "details": dict,
        }
    """
    risks = []
    details = {}
    addr = token_address.lower() if token_address else ""
    is_trusted = category in TRUSTED_CATEGORIES
    is_lp_immune = category in LP_ALERT_IMMUNE_CATEGORIES

    # ── 1. Honeypot Score (0-30) ──────────────────────────────────
    hp_score = WEIGHT_HONEYPOT

    if honeypot.get("is_honeypot") is True:
        hp_score = 0
        risks.append("HONEYPOT: Token cannot be sold")
    elif honeypot.get("is_honeypot") is None:
        hp_score = WEIGHT_HONEYPOT // 3  # Unknown = partial penalty
        risks.append("Honeypot check inconclusive")
    else:
        # Deduct for taxes
        buy_tax = honeypot.get("buy_tax_pct") or 0
        sell_tax = honeypot.get("sell_tax_pct") or 0

        if sell_tax > 50:
            hp_score = 2
            risks.append(f"Extreme sell tax: {sell_tax}%")
        elif sell_tax > 20:
            hp_score = WEIGHT_HONEYPOT // 3
            risks.append(f"High sell tax: {sell_tax}%")
        elif sell_tax > 10:
            hp_score = WEIGHT_HONEYPOT * 2 // 3
            risks.append(f"Moderate sell tax: {sell_tax}%")
        elif sell_tax > 5:
            hp_score -= 5

        if buy_tax > 20:
            hp_score = max(0, hp_score - 10)
            risks.append(f"High buy tax: {buy_tax}%")
        elif buy_tax > 10:
            hp_score = max(0, hp_score - 5)
            risks.append(f"Moderate buy tax: {buy_tax}%")

    details["honeypot"] = {
        "score": hp_score,
        "max": WEIGHT_HONEYPOT,
        "is_honeypot": honeypot.get("is_honeypot"),
        "buy_tax": honeypot.get("buy_tax_pct"),
        "sell_tax": honeypot.get("sell_tax_pct"),
    }

    # ── 2. Contract Score (0-25) ──────────────────────────────────
    # For trusted categories (infrastructure/stablecoin/blue_chip_bridge):
    # - "unverified" penalty waived (bridged tokens aren't verified on PulseChain)
    # - has_pause/has_blacklist = compliance features, not risks → neutral
    # - has_mint = normal for stablecoins (USDC can mint) → neutral if trusted
    ct_score = WEIGHT_CONTRACT

    if contract.get("error") and "Not a contract" in str(contract.get("error", "")):
        ct_score = 0
        risks.append("Not a smart contract")
    else:
        if not contract.get("is_verified"):
            if is_trusted:
                pass  # Bridged tokens aren't verified on PulseChain — not a risk
            else:
                ct_score -= 10
                risks.append("Contract not verified on explorer")

        if contract.get("is_proxy"):
            ct_score -= 8
            risks.append("Proxy/upgradeable contract")

        if contract.get("has_mint") and not contract.get("ownership_renounced"):
            if is_trusted:
                pass  # Mint on stablecoins/infra = normal operation
            else:
                ct_score -= 8
                risks.append("Owner can mint new tokens")

        if contract.get("has_blacklist"):
            if is_trusted:
                pass  # OFAC/AML compliance feature on stablecoins
            else:
                ct_score -= 5
                risks.append("Has blacklist function")

        if contract.get("has_pause"):
            if is_trusted:
                pass  # Emergency pause = security feature on stablecoins
            else:
                ct_score -= 5
                risks.append("Has pause function")

        if contract.get("has_variable_fee"):
            ct_score -= 4
            risks.append("Has variable fee/tax")

        if contract.get("has_selfdestruct"):
            ct_score -= 8
            risks.append("Has selfdestruct")

        if contract.get("ownership_renounced"):
            ct_score = min(ct_score + 5, WEIGHT_CONTRACT)

    ct_score = max(0, ct_score)
    details["contract"] = {
        "score": ct_score,
        "max": WEIGHT_CONTRACT,
        "verified": contract.get("is_verified"),
        "proxy": contract.get("is_proxy"),
        "ownership_renounced": contract.get("ownership_renounced"),
        "dangers": contract.get("dangers", []),
    }

    # ── 3. LP Score (0-20) ────────────────────────────────────────
    lp_score = 0

    if not lp.get("has_lp"):
        lp_score = 0
        risks.append("No liquidity pool found")
    else:
        liq = lp.get("total_liquidity_usd", 0)
        if liq >= 1_000_000:
            lp_score = WEIGHT_LP  # $1M+ = full score
        elif liq >= 500_000:
            lp_score = WEIGHT_LP - 2  # 18
        elif liq >= 100_000:
            lp_score = WEIGHT_LP - 4  # 16
        elif liq >= 50_000:
            lp_score = WEIGHT_LP * 3 // 5  # 12
        elif liq >= 10_000:
            lp_score = WEIGHT_LP * 2 // 5  # 8
            risks.append(f"Low liquidity: ${liq:,.0f}")
        elif liq >= 1_000:
            lp_score = WEIGHT_LP // 5  # 4
            risks.append(f"Low liquidity: ${liq:,.0f}")
        else:
            lp_score = 1
            risks.append(f"Near-zero liquidity: ${liq:,.0f}")

        # Recent burns (LP removals) = danger signal
        # Only penalize if liquidity is < $1M (for large tokens, LP moves are normal)
        burns = lp.get("recent_burns", [])
        if burns and liq < 1_000_000:
            if len(burns) >= 3:
                lp_score = max(0, lp_score - 8)
                risks.append(f"{len(burns)} LP removals in last 24h")
            elif len(burns) >= 1:
                lp_score = max(0, lp_score - 3)
                risks.append(f"{len(burns)} LP removal in last 24h")

    details["lp"] = {
        "score": lp_score,
        "max": WEIGHT_LP,
        "has_lp": lp.get("has_lp"),
        "liquidity_usd": lp.get("total_liquidity_usd"),
        "pair_count": lp.get("pair_count"),
        "recent_burns_24h": len(lp.get("recent_burns", [])),
    }

    # ── 4. Holder Score (0-15) ────────────────────────────────────
    # For trusted categories: holder concentration is structural, not risky.
    # WPLS top holder is PulseX router (81%) — that's how AMMs work.
    # USDC/DAI top holders are bridge/protocol contracts.
    # → Full score for trusted tokens, standard scoring for others.
    hl_score = WEIGHT_HOLDERS
    holder_count = holders.get("holder_count", 0)
    top10_pct = holders.get("top10_pct", 100)
    top1 = holders.get("top1_pct", 0)

    if is_trusted:
        # Trusted categories get full holder score — concentration is from
        # infrastructure contracts (routers, bridges, staking), not whale risk
        hl_score = WEIGHT_HOLDERS
    else:
        if holder_count < 10:
            hl_score = 0
            risks.append(f"Very few holders: {holder_count}")
        elif holder_count < MIN_HOLDERS_FOR_SAFETY:
            hl_score = WEIGHT_HOLDERS // 3
            risks.append(f"Low holder count: {holder_count}")

        if top10_pct > HOLDER_CONCENTRATION_DANGER:
            hl_score = max(0, hl_score - 10)
            risks.append(f"Top 10 holders own {top10_pct:.1f}% of supply")
        elif top10_pct > HOLDER_CONCENTRATION_WARNING:
            hl_score = max(0, hl_score - 5)
            risks.append(f"Top 10 holders own {top10_pct:.1f}%")

        if top1 > 30:
            hl_score = max(0, hl_score - 5)
            risks.append(f"Single holder owns {top1:.1f}%")

    details["holders"] = {
        "score": hl_score,
        "max": WEIGHT_HOLDERS,
        "count": holder_count,
        "top10_pct": top10_pct,
        "top1_pct": top1,
    }

    # ── 5. Age & Activity Score (0-10) ────────────────────────────
    # Logarithmic curve instead of cliff: gradual increase over time
    age_score = 0
    best_pair = lp.get("best_pair") or {}
    age_days = best_pair.get("age_days", 0)
    txns = best_pair.get("total_txns", 0)

    if age_days <= 0:
        age_score = 0
        risks.append("Token created less than 24h ago")
    elif age_days < 1:
        age_score = 0
        risks.append("Token created less than 24h ago")
    elif age_days < MIN_TOKEN_AGE_DAYS:
        age_score = WEIGHT_AGE // 4
        risks.append(f"Very new token: {age_days:.0f} days old")
    else:
        # Logarithmic curve: rapid gain early, diminishing returns later
        # log2(7)=2.8, log2(30)=4.9, log2(90)=6.5, log2(365)=8.5, log2(730)=9.5
        age_score = min(WEIGHT_AGE, round(WEIGHT_AGE * math.log2(max(age_days, 1)) / math.log2(1024)))

    if txns < 10:
        age_score = max(0, age_score - 3)
        risks.append(f"Very low activity: {txns} transactions")

    details["age"] = {
        "score": age_score,
        "max": WEIGHT_AGE,
        "age_days": age_days,
        "transactions": txns,
    }

    # ── Base Score ────────────────────────────────────────────────
    base_total = hp_score + ct_score + lp_score + hl_score + age_score
    base_total = max(0, min(100, base_total))

    # ── 6. Reputation Adjustments ────────────────────────────────
    # Applied after base score to differentiate quality within grades
    reputation_adj = 0

    # 6a. Canonical token bonus (category-based)
    # Gate: only apply bonus if liquidity >= $50K
    total_liq = lp.get("total_liquidity_usd", 0)
    if addr in ALL_CANONICAL and total_liq >= 50_000:
        reputation_adj += 5

    # 6b. Deployer reputation malus
    if deployer_reputation:
        deployer_score = deployer_reputation.get("reputation_score", 100)
        risk_level = deployer_reputation.get("risk_level", "low")
        dead_ratio = deployer_reputation.get("dead_ratio", 0)

        if risk_level == "critical" or dead_ratio > 0.8:
            reputation_adj -= 10
            risks.append(f"Deployer high risk: {dead_ratio:.0%} of tokens dead")
        elif risk_level == "high" or dead_ratio > 0.6:
            reputation_adj -= 7
            risks.append(f"Deployer risky: {dead_ratio:.0%} of tokens dead")
        elif risk_level == "medium" or dead_ratio > 0.4:
            reputation_adj -= 4
            risks.append(f"Deployer caution: {dead_ratio:.0%} of tokens dead")
        elif deployer_score >= 90:
            # Excellent deployer track record = small bonus
            reputation_adj += 2

    # 6c. Maturity bonus for very old tokens (>365 days)
    if age_days >= 365 and holder_count >= 500:
        reputation_adj += 3
    elif age_days >= 180 and holder_count >= 200:
        reputation_adj += 1

    # 6d. Intel signals penalty (known_addresses + scam_radar + intelligence)
    if intel_signals:
        # Deployer is a known bad actor
        if intel_signals.get("deployer_flagged"):
            dl = intel_signals.get("deployer_risk_level", "MEDIUM")
            dc = intel_signals.get("deployer_category", "")
            if dc == "sanctioned":
                reputation_adj -= 50
                risks.append("CRITICAL: Deployer is OFAC-sanctioned address")
            elif dl == "HIGH":
                reputation_adj -= 15
                risks.append("Deployer flagged as known bad actor (HIGH risk)")
            elif dl == "MEDIUM":
                reputation_adj -= 8
                risks.append("Deployer flagged in intel reports (MEDIUM risk)")
            else:
                reputation_adj -= 3
                risks.append("Deployer mentioned in intel reports")

        # Active scam radar alerts
        # For LP-immune categories, filter out lp_removal alerts (false positives:
        # these are OTHER tokens removing liquidity from pairs with this base token)
        alerts = intel_signals.get("alerts", [])
        if is_lp_immune:
            alerts = [a for a in alerts if a.get("alert_type") != "lp_removal"]

        critical_alerts = [a for a in alerts if a.get("severity") == "critical"]
        high_alerts = [a for a in alerts if a.get("severity") == "high"]
        if critical_alerts:
            reputation_adj -= 10
            risks.append(f"CRITICAL scam alert: {critical_alerts[0].get('alert_type', 'unknown')}")
        elif high_alerts:
            reputation_adj -= 5
            risks.append(f"High severity alert: {high_alerts[0].get('alert_type', 'unknown')}")

        # Exploit history (cross-chain)
        exploit_count = intel_signals.get("exploit_count", 0)
        if exploit_count >= 3:
            reputation_adj -= 20
            risks.append(f"Deployer linked to {exploit_count} exploit events (serial attacker)")
        elif exploit_count >= 1:
            reputation_adj -= 12
            risks.append(f"Deployer linked to {exploit_count} exploit event(s) in history DB")

        # Negative intel events (dumps, exploits, controversies)
        neg_events = intel_signals.get("negative_events", [])
        if len(neg_events) >= 3:
            reputation_adj -= 8
            risks.append(f"Multiple negative intel events ({len(neg_events)} reported)")
        elif len(neg_events) >= 1:
            reputation_adj -= 4
            risks.append(f"Negative intel: {neg_events[0].get('title', 'reported issue')}")

    total = max(0, min(100, base_total + reputation_adj))

    # ── Score Floor (category-based) ────────────────────────────
    # Trusted tokens get a minimum score if not flagged as honeypot/scam
    # This prevents structural penalties from dragging canonical tokens below their tier
    floor = CATEGORY_SCORE_FLOOR.get(category, 0)
    if floor > 0 and total < floor:
        # Only apply floor if token is NOT a honeypot
        if not honeypot.get("is_honeypot"):
            total = floor
            risks.append(f"Score floored to {floor} ({category} category)")

    details["reputation"] = {
        "adjustment": reputation_adj,
        "is_canonical": addr in ALL_CANONICAL,
        "category": category,
        "deployer_risk": deployer_reputation.get("risk_level") if deployer_reputation else None,
        "intel_alerts": len(intel_signals.get("alerts", [])) if intel_signals else 0,
        "intel_negative_events": len(intel_signals.get("negative_events", [])) if intel_signals else 0,
        "intel_deployer_flagged": intel_signals.get("deployer_flagged", False) if intel_signals else False,
    }

    # ── Grade (relaxed brackets) ─────────────────────────────────
    # A = 80+ (was 85), B = 60-79 (was 65-84), C = 40-59, D = 20-39, F = <20
    if total >= GRADE_A_THRESHOLD:
        grade = "A"
    elif total >= GRADE_B_THRESHOLD:
        grade = "B"
    elif total >= GRADE_C_THRESHOLD:
        grade = "C"
    elif total >= GRADE_D_THRESHOLD:
        grade = "D"
    else:
        grade = "F"

    return {
        "score": total,
        "grade": grade,
        "category": category,
        "honeypot_score": hp_score,
        "contract_score": ct_score,
        "lp_score": lp_score,
        "holders_score": hl_score,
        "age_score": age_score,
        "reputation_adj": reputation_adj,
        "risks": risks,
        "details": details,
    }
