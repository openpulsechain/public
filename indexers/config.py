import os
from dotenv import load_dotenv

load_dotenv()

# Database
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

# Bridge subgraph endpoints
SUBGRAPH_ETH = "https://graph.ethereum.pulsechain.com/subgraphs/name/ethereum/bridge"
SUBGRAPH_PLS = "https://graph.pulsechain.com/subgraphs/name/pulsechain/bridge"

# PulseChain RPC
RPC_URL = "https://rpc.pulsechain.com"

# DefiLlama
DEFILLAMA_CHAIN_TVL = "https://api.llama.fi/v2/historicalChainTvl/PulseChain"
DEFILLAMA_DEX_VOLUME = "https://api.llama.fi/overview/dexs/PulseChain"

# CoinGecko
COINGECKO_BASE = "https://api.coingecko.com/api/v3"
COINGECKO_API_KEY = os.environ.get("COINGECKO_API_KEY", "")

# Token lists are now defined in indexers/token_prices.py
# PulseChain tokens: PulseX subgraph (sovereign, no GeckoTerminal)
# Major tokens (BTC, ETH, stables): CoinGecko

# PulseX subgraphs
PULSEX_SUBGRAPH_V1 = "https://graph.pulsechain.com/subgraphs/name/pulsechain/pulsex"
PULSEX_SUBGRAPH_V2 = "https://graph.pulsechain.com/subgraphs/name/pulsechain/pulsexv2"

# Subgraph page size
SUBGRAPH_PAGE_SIZE = 1000

# Per-run limits (avoid timeout on cron)
BRIDGE_SYNC_MAX_PAGES = 50  # 50K records per run max

# Hyperlane
HYPERLANE_API_URL = "https://api.hyperlane.xyz/v1/graphql"
HYPERLANE_PLS_DOMAIN = 369
HYPERLANE_PAGE_SIZE = 100  # API max limit per query
HYPERLANE_SYNC_MAX_PAGES = 50  # 5K records per run max
