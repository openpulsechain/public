# Pool Classification Thresholds — v2.0

**Last calibrated**: 2026-03-13
**Indexer**: `token_monitoring.py`
**Version**: 2.0 (graduated pool_risk_score replaces binary pool_is_legitimate)

---

## Threshold Reference

| Criterion | Threshold | Penalty (pts) | Justification |
|-----------|-----------|---------------|---------------|
| `unknown_token` | Token not in `pulsechain_tokens` (volume > 0) | -30 | Tokens with no trading history are high risk. Most scam tokens are not indexed. |
| `spam_name` (always) | Name contains: "airdrop", "claim", "reward", "bonus", "winner", "voucher", "visit", ".com" | -40 | These keywords appear in >95% of known spam tokens. Highest penalty for obvious scam patterns. |
| `spam_name` (conditional) | Name contains: "test", "free" — **only if token volume < $1,000** | -40 | "test" and "free" can appear in legitimate tokens (e.g., "Protest", "FreedomCoin"). Contextual threshold avoids false positives on established tokens. |
| `low_reserve` | Pool reserve < $100 USD | -15 | Pools with near-zero reserves are usually abandoned or spam. $100 chosen as minimum viable threshold. |
| `low_volume` | Token total volume < $1,000 USD | -10 | Low volume indicates inactive tokens. Light penalty as new legitimate tokens may have low initial volume. |
| `no_liquidity` | Token total liquidity = 0 | -20 | Zero liquidity means token is untradeable. Strong signal of abandoned or scam project. |

## Pool Risk Score

- **Formula**: `pool_risk_score = max(0, 100 - sum(applicable_penalties))`
- **Legitimate threshold**: `pool_risk_score >= 50` (derived, replaces binary `pool_is_legitimate`)
- **Opacity threshold**: `pool_risk_score < 30` (UI dims obviously spam pools)

## Score Interpretation

| Score Range | UI Treatment | Meaning |
|-------------|-------------|---------|
| 70-100 | Green | Safe pool — both tokens known, adequate reserves |
| 50-69 | Yellow | Caution — minor flags (e.g., low volume alone) |
| 30-49 | Orange | Warning — multiple risk factors |
| 0-29 | Red, dimmed | Likely spam — strong penalty accumulation |

## Confidence Levels

| Level | Criteria | Color |
|-------|----------|-------|
| `high` | Both tokens are core (PLS, PLSX, HEX, etc.) | Green |
| `medium` | Both tokens are known (in database with volume) | Yellow |
| `low` | One token is known, one is unknown | Orange |
| `suspect` | Both tokens unknown, or spam keyword detected | Red |

## Core Tokens

Loaded dynamically from `canonical_tokens WHERE is_core = TRUE` (database).
Fallback hardcoded list: PLS, PLSX, HEX, eHEX, INC, DAI, USDC, USDT, WETH, WBTC, HDRN, WPLS.

## Known Edge Cases

1. **"Protest" token**: Contains "test" but is legitimate. Fixed by contextual exclusion (volume > $1K bypasses the flag).
2. **Fork tokens**: ETH fork copies (eHEX, etc.) have same symbol as originals. Canonical registry resolves ambiguity.
3. **New legitimate tokens**: May temporarily score low due to `low_volume` + `unknown_token`. Scores improve as they gain volume and get indexed.

## Calibration Methodology

1. Query `token_monitoring_pools` for false positives: legitimate pools (high liquidity, known tokens) flagged as spam.
2. Query for false negatives: obvious spam pools passing all filters.
3. Adjust thresholds to minimize both. Priority: minimize false negatives (user safety > convenience).
4. Re-run classification on full dataset, compare before/after.
