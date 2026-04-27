"""
Safety response contract — runtime validation.

INVARIANT:
    A safety analysis response MUST always contain:
      - is_honeypot: bool | None (three-state verdict)
      - scam_analysis: object with scam_score (0-100), risk_level (critical|high|medium|low), signals (list)

This is the pillar of the product. Any path (fresh analysis, cache hit,
future sources) MUST satisfy this contract. If it does not, the API
returns HTTP 500 with a clear error, rather than silently omitting the
scam verdict and showing "NO DATA" to the user.

This module is the single source of truth for the response shape. It is
imported by main.py (request path) and by a contract test runnable via
`python -m token_safety.safety_contract --self-check`.
"""

from typing import Any, Optional
from pydantic import BaseModel, Field, ValidationError
from typing import Literal, List


RiskLevel = Literal["critical", "high", "medium", "low"]


class ScamSignal(BaseModel):
    signal: str
    severity: Literal["critical", "high", "medium", "low"]
    detail: str = ""


class ScamAnalysis(BaseModel):
    scam_score: int = Field(ge=0, le=100)
    risk_level: RiskLevel
    signals: List[ScamSignal] = []


class SafetyResponseData(BaseModel):
    """Minimal invariant fields. Extra fields are allowed and preserved."""
    is_honeypot: Optional[bool] = None
    scam_analysis: ScamAnalysis

    model_config = {"extra": "allow"}


class SafetyContractViolation(Exception):
    """Raised when the safety response does not satisfy the pillar invariant."""

    def __init__(self, missing: List[str], original: Any):
        self.missing = missing
        self.original = original
        super().__init__(
            f"Safety response contract violated — missing/invalid: {', '.join(missing)}"
        )


def validate_safety_data(data: Any) -> None:
    """
    Validate that a safety response dict satisfies the pillar invariant.

    Raises SafetyContractViolation if not. The original dict is NOT mutated;
    this is strictly a shape check.
    """
    if data is None:
        raise SafetyContractViolation(["data is None"], data)

    if not isinstance(data, dict):
        raise SafetyContractViolation([f"data is not a dict (got {type(data).__name__})"], data)

    # Extract & normalize the two invariant fields. Accept nested honeypot.is_honeypot
    # as an alternative location (legacy fresh-path shape).
    is_hp = data.get("is_honeypot")
    if is_hp is None and isinstance(data.get("honeypot"), dict):
        is_hp = data["honeypot"].get("is_honeypot")

    scam = data.get("scam_analysis")

    missing: List[str] = []
    if not isinstance(is_hp, bool) and is_hp is not None:
        missing.append(f"is_honeypot (got {type(is_hp).__name__})")
    if scam is None:
        missing.append("scam_analysis (absent)")

    if missing:
        raise SafetyContractViolation(missing, data)

    # Validate scam_analysis shape strictly via Pydantic.
    try:
        SafetyResponseData(is_honeypot=is_hp, scam_analysis=scam)
    except ValidationError as exc:
        detail_errors = [f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors()]
        raise SafetyContractViolation(detail_errors, data) from exc


def _self_check() -> int:
    """Run a suite of contract assertions. Exit 0 on success, 1 on failure."""
    fixtures = [
        {
            "name": "valid_clean_token",
            "data": {
                "is_honeypot": False,
                "scam_analysis": {"scam_score": 10, "risk_level": "low", "signals": []},
            },
            "should_pass": True,
        },
        {
            "name": "valid_critical_scam",
            "data": {
                "is_honeypot": False,
                "scam_analysis": {
                    "scam_score": 95,
                    "risk_level": "critical",
                    "signals": [{"signal": "rug", "severity": "critical", "detail": "LP drained"}],
                },
            },
            "should_pass": True,
        },
        {
            "name": "valid_honeypot",
            "data": {
                "is_honeypot": True,
                "scam_analysis": {"scam_score": 100, "risk_level": "critical", "signals": []},
            },
            "should_pass": True,
        },
        {
            "name": "valid_nested_honeypot_shape",
            "data": {
                "honeypot": {"is_honeypot": False},
                "scam_analysis": {"scam_score": 30, "risk_level": "low", "signals": []},
            },
            "should_pass": True,
        },
        {
            "name": "missing_scam_analysis",
            "data": {"is_honeypot": False},
            "should_pass": False,
        },
        {
            "name": "scam_analysis_wrong_type",
            "data": {"is_honeypot": False, "scam_analysis": "low"},
            "should_pass": False,
        },
        {
            "name": "scam_score_out_of_range",
            "data": {
                "is_honeypot": False,
                "scam_analysis": {"scam_score": 150, "risk_level": "low", "signals": []},
            },
            "should_pass": False,
        },
        {
            "name": "risk_level_invalid",
            "data": {
                "is_honeypot": False,
                "scam_analysis": {"scam_score": 10, "risk_level": "unknown", "signals": []},
            },
            "should_pass": False,
        },
        {
            "name": "data_is_none",
            "data": None,
            "should_pass": False,
        },
    ]

    failures = 0
    for fx in fixtures:
        name = fx["name"]
        try:
            validate_safety_data(fx["data"])
            passed = True
        except SafetyContractViolation:
            passed = False

        expected = fx["should_pass"]
        status = "✓" if passed == expected else "✗"
        if passed == expected:
            print(f"{status} {name}")
        else:
            print(f"{status} {name} — expected pass={expected}, got pass={passed}")
            failures += 1

    if failures:
        print(f"\n{failures} safety contract self-check failure(s)")
        return 1
    print("\nAll safety contract assertions passed.")
    return 0


if __name__ == "__main__":
    import sys
    if "--self-check" in sys.argv:
        sys.exit(_self_check())
