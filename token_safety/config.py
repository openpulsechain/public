import os
from dotenv import load_dotenv

load_dotenv()

# Database
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")

# PulseChain
RPC_URL = "https://rpc.pulsechain.com"
SCAN_API_URL = "https://api.scan.pulsechain.com"

# PulseX Subgraphs
PULSEX_V1_SUBGRAPH = "https://graph.pulsechain.com/subgraphs/name/pulsechain/pulsex"
PULSEX_V2_SUBGRAPH = "https://graph.pulsechain.com/subgraphs/name/pulsechain/pulsexv2"

# PulseX Routers
PULSEX_V1_ROUTER = "0x98bf93ebf5c380C0e6Ae8e192A7e2AE08edAcc02"
PULSEX_V2_ROUTER = "0x165C3410fC91EF562C50559f7d2289fEbed552d9"

# Honeypot checker contract (verified on PulseChain)
FEE_CHECKER_CONTRACT = "0xBe4A121B0fa604438B61e49a4a818A00F50c09e1"

# WPLS (Wrapped PLS) — base token for simulations
WPLS_ADDRESS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27"

# Scoring weights and thresholds configured via environment in production
# 5 pillars: honeypot, contract, liquidity, holders, age (total = 100)
WEIGHT_HONEYPOT = int(os.getenv("WEIGHT_HONEYPOT", "0"))
WEIGHT_CONTRACT = int(os.getenv("WEIGHT_CONTRACT", "0"))
WEIGHT_LP = int(os.getenv("WEIGHT_LP", "0"))
WEIGHT_HOLDERS = int(os.getenv("WEIGHT_HOLDERS", "0"))
WEIGHT_AGE = int(os.getenv("WEIGHT_AGE", "0"))

HOLDER_CONCENTRATION_DANGER = int(os.getenv("HOLDER_CONCENTRATION_DANGER", "50"))
HOLDER_CONCENTRATION_WARNING = int(os.getenv("HOLDER_CONCENTRATION_WARNING", "30"))
LP_LOCK_MIN_DAYS = int(os.getenv("LP_LOCK_MIN_DAYS", "30"))
MIN_HOLDERS_FOR_SAFETY = int(os.getenv("MIN_HOLDERS_FOR_SAFETY", "50"))
MIN_TOKEN_AGE_DAYS = int(os.getenv("MIN_TOKEN_AGE_DAYS", "7"))

# ── Token Categories ─────────────────────────────────────────────
CATEGORY_INFRASTRUCTURE = "infrastructure"    # WPLS — wrapped native token
CATEGORY_STABLECOIN = "stablecoin"            # DAI, USDC, USDT
CATEGORY_BLUE_CHIP_BRIDGE = "blue_chip_bridge"  # WETH, WBTC
CATEGORY_ECOSYSTEM_CORE = "ecosystem_core"    # HEX, PLSX, INC, eHEX, etc.
CATEGORY_ESTABLISHED = "established"          # Age>180d, holders>500, liq>$50K
CATEGORY_EMERGING = "emerging"                # Age>30d, holders>100, liq>$10K
CATEGORY_NEW = "new"                          # Everything else

# Categories where holder concentration, compliance features, and
# "unverified" penalties are structural (not risks) and should be ignored
TRUSTED_CATEGORIES = {
    CATEGORY_INFRASTRUCTURE,
    CATEGORY_STABLECOIN,
    CATEGORY_BLUE_CHIP_BRIDGE,
}

# Categories where LP removal alerts are false positives (base token of pairs)
LP_ALERT_IMMUNE_CATEGORIES = {
    CATEGORY_INFRASTRUCTURE,
    CATEGORY_STABLECOIN,
    CATEGORY_BLUE_CHIP_BRIDGE,
    CATEGORY_ECOSYSTEM_CORE,
}

# ── Grade Brackets (relaxed from 85/65/45/25) ────────────────────
GRADE_A_THRESHOLD = 80
GRADE_B_THRESHOLD = 60
GRADE_C_THRESHOLD = 40
GRADE_D_THRESHOLD = 20

# ── Score Floors by Category ─────────────────────────────────────
# Minimum score for tokens in trusted categories (if not honeypot/scam)
CATEGORY_SCORE_FLOOR = {
    CATEGORY_INFRASTRUCTURE: 90,
    CATEGORY_STABLECOIN: 85,
    CATEGORY_BLUE_CHIP_BRIDGE: 80,
    CATEGORY_ECOSYSTEM_CORE: 0,
    CATEGORY_ESTABLISHED: 0,
    CATEGORY_EMERGING: 0,
    CATEGORY_NEW: 0,
}
