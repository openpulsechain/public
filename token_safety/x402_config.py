"""
x402 Protocol Configuration — OpenPulsechain Safety API.

Micropayment gateway: bots/agents pay per-call in USDC on Base.
Disabled by default (X402_ENABLED=false).
Internal requests (site, extension) bypass via origin or API key.
API key validation: DB lookup (Stripe subscribers) + env var fallback (legacy).

Source: roadmap_x402_protocol.md §22, §24, §30
Source: ROADMAP_STRIPE_OPENPULSECHAIN.md §5-6
"""
import os
import hashlib
import logging

logger = logging.getLogger("x402")

# ── Env vars ──────────────────────────────────────────────────────
X402_ENABLED = os.getenv("X402_ENABLED", "false").lower() == "true"
X402_PAY_TO = os.getenv("X402_PAY_TO_ADDRESS", "")
X402_FACILITATOR = os.getenv("X402_FACILITATOR_URL", "https://x402.org/facilitator")
X402_NETWORK = os.getenv("X402_NETWORK", "eip155:8453")  # Base mainnet
BILLING_API_URL = os.getenv("BILLING_API_URL", "")  # Internal URL of billing service

# Internal bypass — site + extension + dev servers
INTERNAL_ORIGINS = {
    "https://openpulsechain.com",
    "https://www.openpulsechain.com",
    "http://localhost:5173",
    "http://localhost:3000",
}
# Legacy env var API keys (fallback, used until all keys are in DB)
_raw_keys = os.getenv("API_KEYS", "")
VALID_API_KEYS = set(k.strip() for k in _raw_keys.split(",") if k.strip())


def validate_api_key(key: str) -> bool:
    """Validate an API key via DB lookup (primary) or env var (fallback).
    DB lookup uses SHA-256 hash — plaintext key never leaves this function."""
    # Legacy env var check (fast, no network)
    if key in VALID_API_KEYS:
        return True
    # DB check via billing service (Stripe subscribers)
    if BILLING_API_URL:
        try:
            import requests
            key_hash = hashlib.sha256(key.encode()).hexdigest()
            resp = requests.get(
                f"{BILLING_API_URL}/api/billing/validate-key",
                params={"key_hash": key_hash},
                timeout=3,
            )
            if resp.status_code == 200:
                data = resp.json()
                return data.get("valid", False)
        except Exception as e:
            logger.warning(f"Billing API key validation failed: {e}")
    return False


# ── Pricing (USD per call) ────────────────────────────────────────
# Routes NOT listed here remain free (health, aggregate stats, bridge, league summaries).
PRICING: dict[str, str] = {
    "GET /api/v1/token/*/safety":               "$0.01",
    "GET /api/v1/token/*/liquidity":            "$0.005",
    "GET /api/v1/tokens/safety/batch":          "$0.005",
    "GET /api/v1/alerts/recent":                "$0.01",
    "GET /api/v1/address/*/risk":               "$0.01",
    "GET /api/v1/deployer/*":                   "$0.02",
    "GET /api/v1/token/*/deployer":             "$0.02",
    "GET /api/v1/smart-money/feed":             "$0.02",
    "GET /api/v1/smart-money/swaps":            "$0.01",
    "GET /api/v1/wallet/*/swaps":               "$0.005",
    "GET /api/v1/wallet/*/balances":            "$0.005",
    "GET /api/v1/token/*/tweets":               "$0.005",
    "GET /api/v1/leagues/rank/*":               "$0.005",
    "GET /api/v1/leagues/*/holders":            "$0.005",
    "GET /api/v1/leagues/*/families":           "$0.005",
    "GET /api/v1/leagues/*/families/*/members": "$0.005",
}


def build_x402_routes():
    """Build x402 RouteConfig dict for PaymentMiddlewareASGI.
    Returns None if config is incomplete or x402 not installed."""
    if not X402_PAY_TO:
        logger.error("X402_PAY_TO_ADDRESS not set — x402 routes not built")
        return None

    try:
        from x402.http import PaymentOption
        from x402.http.types import RouteConfig
    except ImportError:
        logger.warning("x402 package not installed — pip install x402[fastapi,evm]")
        return None

    routes = {}
    for pattern, price in PRICING.items():
        routes[pattern] = RouteConfig(
            accepts=[PaymentOption(
                scheme="exact",
                pay_to=X402_PAY_TO,
                price=price,
                network=X402_NETWORK,
            )],
            mime_type="application/json",
        )
    return routes


def build_x402_server():
    """Initialize x402 resource server with EVM payment verification.
    Returns None if x402 not installed."""
    try:
        from x402.http import FacilitatorConfig, HTTPFacilitatorClient
        from x402.mechanisms.evm.exact import ExactEvmServerScheme
        from x402.server import x402ResourceServer
    except ImportError:
        return None

    facilitator = HTTPFacilitatorClient(FacilitatorConfig(url=X402_FACILITATOR))
    server = x402ResourceServer(facilitator)
    server.register(X402_NETWORK, ExactEvmServerScheme())
    return server


def well_known_payload() -> dict:
    """Generate .well-known/x402 discovery response (always available, even when x402 disabled)."""
    endpoints = []
    for pattern, price in PRICING.items():
        method, path = pattern.split(" ", 1)
        endpoints.append({
            "method": method,
            "path": path,
            "price": price,
            "network": X402_NETWORK,
            "token": "USDC",
            "payTo": X402_PAY_TO or "not-configured",
        })
    return {
        "version": "1.0",
        "facilitator": X402_FACILITATOR,
        "network": X402_NETWORK,
        "payTo": X402_PAY_TO or "not-configured",
        "enabled": X402_ENABLED,
        "endpoints": endpoints,
    }


# ── Bypass middleware ─────────────────────────────────────────────

class X402BypassMiddleware:
    """ASGI middleware: bypass x402 for internal requests (site, extension, API key).
    Must wrap the x402 middleware — internal requests skip x402 entirely."""

    def __init__(self, app, x402_app):
        self.app = app            # original app (no x402)
        self.x402_app = x402_app  # app wrapped with PaymentMiddlewareASGI

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers", []))
        origin = headers.get(b"origin", b"").decode()
        api_key = headers.get(b"x-api-key", b"").decode()

        # Internal request → skip x402, go straight to app
        if origin in INTERNAL_ORIGINS or (api_key and api_key in VALID_API_KEYS):
            await self.app(scope, receive, send)
            return

        # External request → route through x402 payment check
        await self.x402_app(scope, receive, send)
