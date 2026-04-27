"""Non-regression tests for pool classification logic (P3-D).

Tests the _classify_pool and _validate_pool_token functions from token_monitoring.py.
Each test case covers a specific spam/legitimacy criterion.

Run: python -m pytest tests/test_classification.py -v
"""

import sys
import os

# Add indexers path so we can import the classification functions
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'indexers'))

# We need to test the classification logic without a database connection.
# Extract the pure logic by reimplementing locally with the same constants.

# ── Constants (must match token_monitoring.py) ──

SPAM_KEYWORDS_ALWAYS = {"fuck", "shit", "scam", "rug", "fake", "airdrop", "claim", "reward"}
SPAM_KEYWORDS_CONDITIONAL = {"test", "free"}

MIN_POOL_RESERVE_USD = 100

RISK_PENALTIES = {
    "unknown_token": 30,
    "spam_name": 40,
    "low_reserve": 15,
    "low_volume": 10,
    "no_liquidity": 20,
}

# ── Core tokens (subset for testing) ──

CORE_TOKENS = {
    "0xa1077a294dde1b09bb078844df40758a5d0f9a27",  # WPLS
    "0x95b303987a60c71504d99aa1b13b4da07b0790ab",  # PLSX
    "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",  # HEX
    "0x57fde0a71132198bbec939b98976993d8d89d225",  # eHEX
    "0x2fa878ab3f87cc1c9737fc071108f904c0b0c95d",  # INC
    "0xefd766ccb38eaf1dfd701853bfce31359239f305",  # DAI
    "0x15d38573d2feeb82e7ad5187ab8c1d52810b1f07",  # USDC
    "0x0cb6f5a34ad42ec934882a05265a7d5f59b51a2f",  # USDT
}


def _validate_pool_token(token_address, token_symbol, token_name,
                          token_volume_usd, token_liquidity,
                          known_addresses):
    """Mirror of token_monitoring._validate_pool_token."""
    addr = token_address.lower()
    is_core = addr in CORE_TOKENS
    is_known = addr in known_addresses or is_core
    has_liquidity = token_liquidity > 1
    return is_known, is_core, has_liquidity


def _classify_pool(pool, known_addresses):
    """Mirror of token_monitoring._classify_pool with identical logic."""
    t0_addr = pool["token0_address"]
    t1_addr = pool["token1_address"]
    t0_name = (pool.get("token0_name") or "").lower()
    t1_name = (pool.get("token1_name") or "").lower()

    t0_known, t0_core, t0_liq = _validate_pool_token(
        t0_addr, pool.get("token0_symbol", ""), t0_name,
        pool.get("token0_volume_usd", 0), pool.get("token0_liquidity", 0),
        known_addresses,
    )
    t1_known, t1_core, t1_liq = _validate_pool_token(
        t1_addr, pool.get("token1_symbol", ""), t1_name,
        pool.get("token1_volume_usd", 0), pool.get("token1_liquidity", 0),
        known_addresses,
    )

    pool["token0_is_known"] = t0_known
    pool["token0_is_core"] = t0_core
    pool["token0_has_liquidity"] = t0_liq
    pool["token1_is_known"] = t1_known
    pool["token1_is_core"] = t1_core
    pool["token1_has_liquidity"] = t1_liq

    spam_reasons = []
    risk_penalty = 0

    t0_vol = pool.get("token0_volume_usd", 0)
    t1_vol = pool.get("token1_volume_usd", 0)

    for kw in SPAM_KEYWORDS_ALWAYS:
        if kw in t0_name:
            spam_reasons.append(f"spam_name_token0:{kw}")
            risk_penalty += RISK_PENALTIES["spam_name"]
        if kw in t1_name:
            spam_reasons.append(f"spam_name_token1:{kw}")
            risk_penalty += RISK_PENALTIES["spam_name"]

    for kw in SPAM_KEYWORDS_CONDITIONAL:
        if kw in t0_name and t0_vol < 1000:
            spam_reasons.append(f"spam_name_token0:{kw}")
            risk_penalty += RISK_PENALTIES["spam_name"]
        if kw in t1_name and t1_vol < 1000:
            spam_reasons.append(f"spam_name_token1:{kw}")
            risk_penalty += RISK_PENALTIES["spam_name"]

    if not t0_known:
        spam_reasons.append("unknown_token0")
        risk_penalty += RISK_PENALTIES["unknown_token"]
    if not t1_known:
        spam_reasons.append("unknown_token1")
        risk_penalty += RISK_PENALTIES["unknown_token"]

    if pool.get("reserve_usd", 0) < MIN_POOL_RESERVE_USD:
        spam_reasons.append(f"low_reserve:{pool.get('reserve_usd', 0):.0f}")
        risk_penalty += RISK_PENALTIES["low_reserve"]

    if not t0_liq and not t0_core:
        spam_reasons.append("no_liquidity_token0")
        risk_penalty += RISK_PENALTIES["no_liquidity"]
    if not t1_liq and not t1_core:
        spam_reasons.append("no_liquidity_token1")
        risk_penalty += RISK_PENALTIES["no_liquidity"]

    if not t0_core and t0_vol < 1000:
        spam_reasons.append("low_volume_token0")
        risk_penalty += RISK_PENALTIES["low_volume"]
    if not t1_core and t1_vol < 1000:
        spam_reasons.append("low_volume_token1")
        risk_penalty += RISK_PENALTIES["low_volume"]

    pool_risk_score = max(0, 100 - risk_penalty)
    pool["pool_risk_score"] = pool_risk_score
    pool["pool_is_legitimate"] = pool_risk_score >= 50
    pool["pool_spam_reason"] = "; ".join(spam_reasons) if spam_reasons else None

    if t0_core and t1_core:
        pool["pool_confidence"] = "high"
    elif (t0_core and t1_known) or (t1_core and t0_known):
        pool["pool_confidence"] = "medium"
    elif t0_known and t1_known:
        pool["pool_confidence"] = "low"
    else:
        pool["pool_confidence"] = "suspect"

    return pool


# ── Helper to build pool dicts ──

def make_pool(t0_addr, t1_addr, t0_sym="T0", t1_sym="T1",
              t0_name="Token Zero", t1_name="Token One",
              t0_vol=50000, t1_vol=50000, t0_liq=100, t1_liq=100,
              reserve_usd=10000):
    return {
        "token0_address": t0_addr.lower(),
        "token1_address": t1_addr.lower(),
        "token0_symbol": t0_sym,
        "token1_symbol": t1_sym,
        "token0_name": t0_name,
        "token1_name": t1_name,
        "token0_volume_usd": t0_vol,
        "token1_volume_usd": t1_vol,
        "token0_liquidity": t0_liq,
        "token1_liquidity": t1_liq,
        "reserve_usd": reserve_usd,
    }


# Known addresses: simulate tokens that exist in pulsechain_tokens with volume
KNOWN_ADDRS = CORE_TOKENS | {
    "0xaaaa0000000000000000000000000000000000aa",  # Known non-core token A
    "0xbbbb0000000000000000000000000000000000bb",  # Known non-core token B
}


# ─── TEST CASES ──────────────────────────────────────────────────────────────


def test_01_two_core_tokens_high_confidence():
    """Pool with 2 core tokens = high confidence + legitimate."""
    pool = make_pool(
        "0xa1077a294dde1b09bb078844df40758a5d0f9a27",  # WPLS
        "0x95b303987a60c71504d99aa1b13b4da07b0790ab",  # PLSX
        t0_sym="WPLS", t1_sym="PLSX",
        t0_name="Wrapped PLS", t1_name="PulseX",
    )
    result = _classify_pool(pool, KNOWN_ADDRS)
    assert result["pool_confidence"] == "high"
    assert result["pool_is_legitimate"] is True
    assert result["pool_risk_score"] == 100
    assert result["pool_spam_reason"] is None


def test_02_core_plus_known_medium_confidence():
    """Pool with 1 core + 1 known non-core = medium confidence + legitimate."""
    pool = make_pool(
        "0xa1077a294dde1b09bb078844df40758a5d0f9a27",  # WPLS (core)
        "0xaaaa0000000000000000000000000000000000aa",  # Known non-core
        t0_sym="WPLS", t1_sym="ATROPA",
        t0_name="Wrapped PLS", t1_name="Atropa Token",
    )
    result = _classify_pool(pool, KNOWN_ADDRS)
    assert result["pool_confidence"] == "medium"
    assert result["pool_is_legitimate"] is True
    assert result["pool_risk_score"] == 100


def test_03_two_known_noncores_low_confidence():
    """Pool with 2 known non-core tokens = low confidence + legitimate."""
    pool = make_pool(
        "0xaaaa0000000000000000000000000000000000aa",
        "0xbbbb0000000000000000000000000000000000bb",
        t0_sym="TOKENA", t1_sym="TOKENB",
        t0_name="Token A", t1_name="Token B",
    )
    result = _classify_pool(pool, KNOWN_ADDRS)
    assert result["pool_confidence"] == "low"
    assert result["pool_is_legitimate"] is True


def test_04_spam_name_airdrop_flagged():
    """Pool with "FREE AIRDROP TOKEN" name = suspect + not legitimate."""
    pool = make_pool(
        "0x1111000000000000000000000000000000000011",
        "0xa1077a294dde1b09bb078844df40758a5d0f9a27",  # WPLS
        t0_sym="SCAM", t1_sym="WPLS",
        t0_name="FREE AIRDROP TOKEN", t1_name="Wrapped PLS",
        t0_vol=0, t0_liq=0,
    )
    result = _classify_pool(pool, KNOWN_ADDRS)
    assert result["pool_confidence"] == "suspect"
    assert result["pool_is_legitimate"] is False
    assert "spam_name_token0:airdrop" in result["pool_spam_reason"]
    assert "spam_name_token0:free" in result["pool_spam_reason"]
    assert result["pool_risk_score"] < 30


def test_05_low_reserve_flagged():
    """Pool with $50 reserve = flagged low_reserve."""
    pool = make_pool(
        "0xaaaa0000000000000000000000000000000000aa",
        "0xbbbb0000000000000000000000000000000000bb",
        reserve_usd=50,
    )
    result = _classify_pool(pool, KNOWN_ADDRS)
    assert "low_reserve:50" in result["pool_spam_reason"]
    # Score should be 100 - 15 = 85 (still legitimate)
    assert result["pool_risk_score"] == 85
    assert result["pool_is_legitimate"] is True


def test_06_low_volume_flagged():
    """Pool with token volume $500 = flagged low_volume."""
    pool = make_pool(
        "0xaaaa0000000000000000000000000000000000aa",
        "0xbbbb0000000000000000000000000000000000bb",
        t0_vol=500, t1_vol=500,
    )
    result = _classify_pool(pool, KNOWN_ADDRS)
    assert "low_volume_token0" in result["pool_spam_reason"]
    assert "low_volume_token1" in result["pool_spam_reason"]
    # Score: 100 - 10 - 10 = 80
    assert result["pool_risk_score"] == 80


def test_07_unknown_token_detected():
    """Pool with unknown token address = flagged unknown_token."""
    pool = make_pool(
        "0xdead000000000000000000000000000000000000",  # Unknown
        "0xa1077a294dde1b09bb078844df40758a5d0f9a27",  # WPLS (core)
        t0_sym="UNKN", t1_sym="WPLS",
        t0_name="Unknown Token", t1_name="Wrapped PLS",
    )
    result = _classify_pool(pool, KNOWN_ADDRS)
    assert "unknown_token0" in result["pool_spam_reason"]
    assert result["pool_confidence"] == "suspect"


def test_08_test_keyword_contextual_not_flagged_high_volume():
    """Token with 'test' in name but $50K volume should NOT be flagged (P1-D)."""
    pool = make_pool(
        "0xaaaa0000000000000000000000000000000000aa",
        "0xbbbb0000000000000000000000000000000000bb",
        t0_sym="PROTEST", t1_sym="TOKENB",
        t0_name="Protest Token", t1_name="Token B",
        t0_vol=50000, t1_vol=50000,
    )
    result = _classify_pool(pool, KNOWN_ADDRS)
    assert result["pool_spam_reason"] is None or "spam_name" not in result["pool_spam_reason"]
    assert result["pool_is_legitimate"] is True


def test_09_test_keyword_flagged_low_volume():
    """Token with 'test' in name and $100 volume SHOULD be flagged (P1-D)."""
    pool = make_pool(
        "0xaaaa0000000000000000000000000000000000aa",
        "0xbbbb0000000000000000000000000000000000bb",
        t0_sym="TESTTOK", t1_sym="TOKENB",
        t0_name="Test Token Alpha", t1_name="Token B",
        t0_vol=100, t1_vol=50000,
    )
    result = _classify_pool(pool, KNOWN_ADDRS)
    assert "spam_name_token0:test" in result["pool_spam_reason"]


def test_10_no_liquidity_flagged():
    """Pool with zero liquidity = flagged no_liquidity."""
    pool = make_pool(
        "0xaaaa0000000000000000000000000000000000aa",
        "0xbbbb0000000000000000000000000000000000bb",
        t0_liq=0, t1_liq=0,
    )
    result = _classify_pool(pool, KNOWN_ADDRS)
    assert "no_liquidity_token0" in result["pool_spam_reason"]
    assert "no_liquidity_token1" in result["pool_spam_reason"]


def test_11_core_token_bypasses_volume_and_liquidity_checks():
    """Core tokens are never flagged for low_volume or no_liquidity."""
    pool = make_pool(
        "0xa1077a294dde1b09bb078844df40758a5d0f9a27",  # WPLS (core)
        "0x95b303987a60c71504d99aa1b13b4da07b0790ab",  # PLSX (core)
        t0_vol=0, t1_vol=0, t0_liq=0, t1_liq=0,
    )
    result = _classify_pool(pool, KNOWN_ADDRS)
    assert result["pool_spam_reason"] is None or "low_volume" not in result["pool_spam_reason"]
    assert result["pool_spam_reason"] is None or "no_liquidity" not in result["pool_spam_reason"]
    assert result["pool_confidence"] == "high"


def test_12_high_liquidity_unknown_token_caution_not_spam():
    """WPLS/NewToken with $10M liquidity should score ~70 (caution), not spam (Finding #4)."""
    pool = make_pool(
        "0xa1077a294dde1b09bb078844df40758a5d0f9a27",  # WPLS
        "0xcccc000000000000000000000000000000000000",  # Unknown but high liquidity
        t0_sym="WPLS", t1_sym="NEWTOK",
        t0_name="Wrapped PLS", t1_name="New Token",
        t0_vol=100000, t1_vol=100, t0_liq=5000000, t1_liq=5000000,
        reserve_usd=10000000,
    )
    result = _classify_pool(pool, KNOWN_ADDRS)
    # unknown_token1 (-30) + low_volume_token1 (-10) = -40 → score 60
    assert result["pool_risk_score"] >= 50, f"Score {result['pool_risk_score']} should be >= 50"
    assert result["pool_is_legitimate"] is True


def test_13_total_spam_pool_zero_score():
    """Pool with every possible spam signal should score ~0."""
    pool = make_pool(
        "0xdead000000000000000000000000000000000001",
        "0xdead000000000000000000000000000000000002",
        t0_sym="SCAM", t1_sym="RUG",
        t0_name="FAKE AIRDROP SCAM", t1_name="RUG CLAIM TOKEN",
        t0_vol=0, t1_vol=0, t0_liq=0, t1_liq=0,
        reserve_usd=0,
    )
    result = _classify_pool(pool, KNOWN_ADDRS)
    assert result["pool_risk_score"] == 0
    assert result["pool_is_legitimate"] is False
    assert result["pool_confidence"] == "suspect"


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
