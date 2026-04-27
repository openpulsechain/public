"""
Scam risk detection — pure function extracted from analyzer._detect_scam_risk.

This module has ZERO runtime dependencies (no DB, no HTTP, no config imports).
That makes the function trivially unit-testable with synthetic fixtures.

The caller (analyzer.analyze_token) is responsible for:
  - fetching lp / holders / age / contract / deployer / intel signals
  - computing lp_immune from category + canonical-token membership
  - passing them as plain dicts into detect_scam_risk()

INVARIANT — the return shape MUST always be:
    {"scam_score": int (0..100), "risk_level": str, "signals": list}
with risk_level in {"critical", "high", "medium", "low"}.

This function is the foundation of the Scam Analysis pillar and is covered
by tests/test_scam_risk.py.
"""

from typing import Any, Optional, Dict, List


def detect_scam_risk(
    lp: dict,
    holders: dict,
    age_info: dict,
    contract: dict,
    deployer_reputation: Optional[dict] = None,
    intel_signals: Optional[dict] = None,
    lp_immune: bool = False,
) -> Dict[str, Any]:
    signals: List[Dict[str, Any]] = []
    score = 0

    # --- 1. Liquidity ---
    liq = lp.get("total_liquidity_usd", 0) or 0
    if liq < 100:
        signals.append({"signal": "near_zero_liquidity", "severity": "critical", "detail": f"${liq:,.0f}"})
        score += 30
    elif liq < 1_000:
        signals.append({"signal": "very_low_liquidity", "severity": "high", "detail": f"${liq:,.0f}"})
        score += 20
    elif liq < 10_000:
        signals.append({"signal": "low_liquidity", "severity": "medium", "detail": f"${liq:,.0f}"})
        score += 10

    # --- 2. Holder concentration ---
    top1 = holders.get("top1_pct", 0) or 0
    top10 = holders.get("top10_pct", 0) or 0
    if top1 > 90:
        signals.append({"signal": "extreme_concentration", "severity": "critical", "detail": f"Top 1 holds {top1:.1f}%"})
        score += 30
    elif top1 > 40:
        signals.append({"signal": "high_concentration", "severity": "high", "detail": f"Top 1 holds {top1:.1f}%"})
        score += 15
    elif top10 > 70:
        signals.append({"signal": "concentrated_supply", "severity": "medium", "detail": f"Top 10 hold {top10:.1f}%"})
        score += 10

    # --- 3. Token age ---
    best_pair = lp.get("best_pair") or {}
    age_days = best_pair.get("age_days", 0) or 0
    if age_days < 1:
        signals.append({"signal": "brand_new_token", "severity": "high", "detail": "< 24h old"})
        score += 15
    elif age_days < 7:
        signals.append({"signal": "very_new_token", "severity": "medium", "detail": f"{age_days:.0f} days old"})
        score += 8

    # --- 4. Activity ---
    txns = best_pair.get("total_txns", 0) or 0
    if txns < 10:
        signals.append({"signal": "no_activity", "severity": "high", "detail": f"{txns} transactions"})
        score += 10
    elif txns < 50:
        signals.append({"signal": "low_activity", "severity": "medium", "detail": f"{txns} transactions"})
        score += 5

    # --- 5. LP removals (rug pull signal) ---
    recent_burns = lp.get("recent_burns_24h", len(lp.get("recent_burns", []) or []))
    is_low_liq = liq < 50_000
    if recent_burns >= 10 and is_low_liq:
        signals.append({"signal": "heavy_lp_removals", "severity": "critical", "detail": f"{recent_burns} LP removals in 24h"})
        score += 15
    elif recent_burns >= 5 and is_low_liq:
        signals.append({"signal": "lp_removals", "severity": "high", "detail": f"{recent_burns} LP removals in 24h"})
        score += 8
    elif recent_burns >= 3 and is_low_liq:
        signals.append({"signal": "lp_removal", "severity": "medium", "detail": f"{recent_burns} LP removals in 24h"})
        score += 3

    # --- 6. Contract risks (non-honeypot) ---
    is_unverified = not contract.get("is_verified")
    if is_unverified:
        signals.append({"signal": "unverified_contract", "severity": "medium", "detail": "Source code not verified"})
        score += 8

    if contract.get("has_mint") and not contract.get("ownership_renounced"):
        signals.append({"signal": "mintable_active_owner", "severity": "high", "detail": "Owner can mint tokens"})
        score += 12

    if is_unverified and top1 > 30:
        signals.append({"signal": "unverified_whale", "severity": "high", "detail": f"Unverified code + top holder {top1:.0f}%"})
        score += 15

    # --- 7. Deployer reputation ---
    if deployer_reputation:
        risk = deployer_reputation.get("risk_level", "low")
        dead_ratio = deployer_reputation.get("dead_ratio", 0) or 0
        if risk == "critical" or dead_ratio > 0.8:
            signals.append({"signal": "serial_rugger", "severity": "critical", "detail": f"{dead_ratio:.0%} tokens dead"})
            score += 25
        elif risk == "high" or dead_ratio > 0.6:
            signals.append({"signal": "risky_deployer", "severity": "high", "detail": f"{dead_ratio:.0%} tokens dead"})
            score += 15

    # --- 8. Intel signals ---
    if intel_signals:
        if intel_signals.get("deployer_flagged"):
            signals.append({"signal": "flagged_deployer", "severity": "critical", "detail": f"Risk: {intel_signals.get('deployer_risk_level', 'unknown')}"})
            score += 20
        neg_events = intel_signals.get("negative_events") or []
        if len(neg_events) >= 2:
            signals.append({"signal": "negative_intel", "severity": "high", "detail": f"{len(neg_events)} negative events"})
            score += 10

        alerts = intel_signals.get("alerts") or []
        if lp_immune:
            alerts = [a for a in alerts if a.get("alert_type") != "lp_removal"]
        critical_alerts = [a for a in alerts if a.get("severity") == "critical"]
        high_alerts = [a for a in alerts if a.get("severity") == "high"]
        medium_alerts = [a for a in alerts if a.get("severity") == "medium"]

        if critical_alerts:
            alert_types = set(a.get("alert_type", "unknown") for a in critical_alerts)
            signals.append({"signal": "critical_alerts", "severity": "critical", "detail": f"{len(critical_alerts)} critical ({', '.join(alert_types)})"})
            score += 25
        if high_alerts:
            alert_types = set(a.get("alert_type", "unknown") for a in high_alerts)
            signals.append({"signal": "high_alerts", "severity": "high", "detail": f"{len(high_alerts)} high ({', '.join(alert_types)})"})
            score += 12
        if len(medium_alerts) >= 3:
            signals.append({"signal": "many_alerts", "severity": "medium", "detail": f"{len(medium_alerts)} medium alerts"})
            score += 8

    # --- Combination amplifier: multiple critical signals = worse ---
    critical_count = sum(1 for s in signals if s["severity"] == "critical")
    if critical_count >= 2:
        score = min(100, int(score * 1.3))

    score = min(100, score)

    # Verdict thresholds — INVARIANT of the scoring model
    if score >= 70:
        risk_level = "critical"
    elif score >= 50:
        risk_level = "high"
    elif score >= 30:
        risk_level = "medium"
    else:
        risk_level = "low"

    return {
        "scam_score": score,
        "risk_level": risk_level,
        "signals": signals,
    }
