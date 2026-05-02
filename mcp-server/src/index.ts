#!/usr/bin/env node
/**
 * OpenPulsechain MCP Server
 *
 * Gives AI assistants (Claude, ChatGPT, etc.) access to real-time PulseChain
 * on-chain data via the Model Context Protocol.
 *
 * ┌─ Tier model ────────────────────────────────────────────────────────┐
 * │  Included (11 tools, no auth):                                     │
 * │    Token prices, info, history, top tokens/pairs, market overview,  │
 * │    basic safety checks, liquidity, honeypot list, bridge, leagues.  │
 * │                                                                     │
 * │  PRO (9 tools, requires OPENPULSECHAIN_API_KEY env var):            │
 * │    AML risk, deployer reputation, real-time scam alerts, smart      │
 * │    money feed, recent swaps, wallet balances/swaps, funding tree,   │
 * │    holder rank.                                                     │
 * │                                                                     │
 * │  Upgrade: https://openpulsechain.com/pricing                        │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * Data sources:
 *   - api.openpulsechain.com (tokens, pairs, market)
 *   - safety.openpulsechain.com (safety scores, alerts, smart money, leagues, tracing)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'

const API = 'https://api.openpulsechain.com'
const SAFETY = 'https://safety.openpulsechain.com'
const PRICING_URL = 'https://openpulsechain.com/pricing'
const FETCH_TIMEOUT_MS = 15_000

// ── Input validation ──
const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
function validateAddress(address: string): string {
  const clean = address.trim().toLowerCase()
  if (!ETH_ADDRESS_RE.test(clean)) {
    throw new Error('Invalid address format. Expected 0x followed by 40 hex characters.')
  }
  return clean
}

// ── Tier detection ──
// If an API key is set, we're in PRO mode — forward it on every request and
// all tools are callable. Otherwise only the included tools respond, and
// PRO tools return a clear upgrade message.
const API_KEY = (process.env.OPENPULSECHAIN_API_KEY || '').trim()
const HAS_API_KEY = API_KEY.length > 0

async function fetchJSON(url: string): Promise<any> {
  const headers: Record<string, string> = { 'Accept': 'application/json' }
  if (HAS_API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { headers, signal: controller.signal })
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          `API ${res.status}: This endpoint requires a valid API key. ` +
          `Get one at ${PRICING_URL}`
        )
      }
      throw new Error(`API request failed with status ${res.status}`)
    }
    return res.json()
  } finally {
    clearTimeout(timer)
  }
}

// ── Pro tier gate ──
// Wraps a handler so that if no API key is configured, it returns a clear
// "pro_tier_required" error instead of hitting the backend. Keeps the tier
// separation visible in the MCP itself (fast-fail), while the backend remains
// the source of truth for fine-grained quotas.
type ToolResult = { content: Array<{ type: 'text'; text: string }>; structuredContent?: Record<string, unknown> }

function proGate<Args>(
  handler: (args: Args) => Promise<ToolResult>
): (args: Args) => Promise<ToolResult> {
  return async (args: Args) => {
    if (!HAS_API_KEY) {
      const errorPayload = {
        error: 'pro_tier_required',
        message:
          'This tool is part of the OpenPulsechain MCP Pro tier. ' +
          'Set the OPENPULSECHAIN_API_KEY environment variable to unlock it.',
        upgrade_url: PRICING_URL,
        how_to:
          'In your Claude/Cursor/Claude-Code MCP config, add: ' +
          '"env": { "OPENPULSECHAIN_API_KEY": "sk-opk-..." }',
        included_alternatives: [
          'get-token-price', 'get-token-info', 'get-token-safety',
          'get-token-liquidity', 'get-top-tokens', 'get-honeypots',
          'get-market-overview', 'get-bridge-stats', 'get-holder-leagues',
          'get-opportunity-signal', 'get-pair-analytics', 'get-whale-alerts',
          'get-gas', 'get-token-holders', 'get-token-sentiment',
          'get-wallet-transactions', 'get-tx-trace',
        ],
      }
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(errorPayload, null, 2),
        }],
        structuredContent: errorPayload,
      }
    }
    return handler(args)
  }
}

// ── Shared annotations ──
const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true as const,
  destructiveHint: false as const,
  idempotentHint: true as const,
  openWorldHint: true as const,
}

// ── Helper: wrap API response for MCP return ──
function wrapResult(data: any): ToolResult {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  }
}

// ── Server factory ──
// Creates a new McpServer with all tools registered.
// For stdio: one server instance. For HTTP: one per session.

function createServer(): McpServer {
  const s = new McpServer({
    name: 'openpulsechain',
    version: '2.0.0',
    description: 'PulseChain on-chain analytics for AI agents. Token safety scores, honeypot detection, whale tracking, smart money feed, scam alerts, DEX volume, bridge stats, holder leagues. 11 free + 9 pro tools.',
    websiteUrl: 'https://openpulsechain.com',
    icons: [{ src: 'https://www.openpulsechain.com/logo.png', mimeType: 'image/png' }],
  })
  registerTools(s)
  return s
}

function registerTools(server: McpServer): void {

// ═══════════════════════════════════════════════════════════════════════════
// ── INCLUDED TOOLS (11) — public data, no API key required ───────────────
// ═══════════════════════════════════════════════════════════════════════════

server.registerTool(
  'get-token-price',
  {
    title: 'Get Token Price',
    description: 'Get current price, 24h change, volume, and market cap for a PulseChain token.',
    inputSchema: {
      address: z.string().describe('Token contract address (0x...) — e.g. 0x2b591e99afe9f32eaa6214f7b7629768c40eeb39 for HEX'),
    },
    outputSchema: z.object({
      address: z.string().describe('Token contract address'),
      price_usd: z.number().describe('Current price in USD'),
      price_change_24h: z.number().describe('24-hour price change percentage'),
      volume_24h: z.number().describe('24-hour trading volume in USD'),
      market_cap: z.number().describe('Market capitalization in USD'),
    }).passthrough(),
    annotations: READ_ONLY_ANNOTATIONS,
  },
  async ({ address }) => {
    const addr = validateAddress(address)
    const data = await fetchJSON(`${API}/api/v1/tokens/${addr}/price`)
    return wrapResult(data)
  }
)

server.registerTool(
  'get-token-info',
  {
    title: 'Get Token Info',
    description: 'Get full details for a PulseChain token: name, symbol, decimals, liquidity, volume, holder count.',
    inputSchema: {
      address: z.string().describe('Token contract address (0x...)'),
    },
    outputSchema: z.object({
      address: z.string().describe('Token contract address'),
      name: z.string().describe('Token name'),
      symbol: z.string().describe('Token ticker symbol'),
      decimals: z.number().describe('Token decimal places'),
      total_liquidity_usd: z.number().describe('Total liquidity in USD'),
      volume_24h: z.number().describe('24-hour trading volume in USD'),
      holder_count: z.number().describe('Number of token holders'),
    }).passthrough(),
    annotations: READ_ONLY_ANNOTATIONS,
  },
  async ({ address }) => {
    const addr = validateAddress(address)
    const data = await fetchJSON(`${API}/api/v1/tokens/${addr}`)
    return wrapResult(data)
  }
)

server.registerTool(
  'get-token-history',
  {
    title: 'Get Token Price History',
    description: 'Get historical price data (OHLCV) for a PulseChain token. Limited to 30 days without API key; Pro unlocks full history.',
    inputSchema: {
      address: z.string().describe('Token contract address (0x...)'),
      days: z.number().min(1).max(1000).optional().describe('Number of days of history (default 30, max 1000)'),
    },
    outputSchema: z.object({
      address: z.string().describe('Token contract address'),
      days: z.number().describe('Number of days returned'),
      history: z.array(z.object({
        date: z.string().describe('Date in ISO format'),
        open: z.number().describe('Opening price in USD'),
        high: z.number().describe('Highest price in USD'),
        low: z.number().describe('Lowest price in USD'),
        close: z.number().describe('Closing price in USD'),
        volume: z.number().describe('Trading volume in USD'),
      }).passthrough()).describe('Array of OHLCV candles'),
    }).passthrough(),
    annotations: READ_ONLY_ANNOTATIONS,
  },
  async ({ address, days }) => {
    const d = days ?? 30
    const addr = validateAddress(address)
    const data = await fetchJSON(`${API}/api/v1/tokens/${addr}/history?days=${d}`)
    return wrapResult(data)
  }
)

server.registerTool(
  'get-top-tokens',
  {
    title: 'Get Top Tokens',
    description: 'List top PulseChain tokens sorted by volume, liquidity, or symbol.',
    inputSchema: {
      sort_by: z.enum(['volume', 'liquidity', 'symbol']).optional().describe('Sort field (default: volume)'),
      limit: z.number().min(1).max(500).optional().describe('Number of tokens to return (default 20, max 500)'),
    },
    outputSchema: z.object({
      tokens: z.array(z.object({
        address: z.string().describe('Token contract address'),
        name: z.string().describe('Token name'),
        symbol: z.string().describe('Token ticker symbol'),
        price_usd: z.number().describe('Current price in USD'),
        volume_24h: z.number().describe('24-hour volume in USD'),
        liquidity_usd: z.number().describe('Total liquidity in USD'),
      }).passthrough()).describe('Array of top tokens'),
    }).passthrough(),
    annotations: READ_ONLY_ANNOTATIONS,
  },
  async ({ sort_by, limit }) => {
    const s = sort_by ?? 'volume'
    const l = limit ?? 20
    const data = await fetchJSON(`${API}/api/v1/tokens?sort_by=${s}&limit=${l}`)
    return wrapResult(data)
  }
)

server.registerTool(
  'get-top-pairs',
  {
    title: 'Get Top DEX Pairs',
    description: 'List top PulseX DEX trading pairs by volume.',
    inputSchema: {
      limit: z.number().min(1).max(500).optional().describe('Number of pairs (default 20, max 500)'),
    },
    outputSchema: z.object({
      pairs: z.array(z.object({
        pair_address: z.string().describe('DEX pair contract address'),
        token0_symbol: z.string().describe('First token symbol'),
        token1_symbol: z.string().describe('Second token symbol'),
        volume_24h: z.number().describe('24-hour volume in USD'),
        liquidity_usd: z.number().describe('Total pair liquidity in USD'),
      }).passthrough()).describe('Array of top trading pairs'),
    }).passthrough(),
    annotations: READ_ONLY_ANNOTATIONS,
  },
  async ({ limit }) => {
    const data = await fetchJSON(`${API}/api/v1/pairs?limit=${limit ?? 20}`)
    return wrapResult(data)
  }
)

server.registerTool(
  'get-market-overview',
  {
    title: 'Get Market Overview',
    description: 'Get PulseChain network overview: TVL, 24h volume, active tokens, top gainers/losers.',
    outputSchema: z.object({
      tvl_usd: z.number().describe('Total value locked in USD'),
      volume_24h: z.number().describe('Total 24-hour volume in USD'),
      active_tokens: z.number().describe('Number of actively traded tokens'),
      top_gainers: z.array(z.object({
        symbol: z.string().describe('Token symbol'),
        price_change_24h: z.number().describe('24-hour price change percentage'),
      }).passthrough()).describe('Tokens with largest 24h gains'),
      top_losers: z.array(z.object({
        symbol: z.string().describe('Token symbol'),
        price_change_24h: z.number().describe('24-hour price change percentage'),
      }).passthrough()).describe('Tokens with largest 24h losses'),
    }).passthrough(),
    annotations: READ_ONLY_ANNOTATIONS,
  },
  async () => {
    const data = await fetchJSON(`${API}/api/v1/market/overview`)
    return wrapResult(data)
  }
)

server.registerTool(
  'get-token-safety',
  {
    title: 'Get Token Safety Score',
    description: 'Analyze a token for scam indicators: honeypot detection, buy/sell tax, ownership, liquidity score (0-100, A-F grade).',
    inputSchema: {
      address: z.string().describe('Token contract address (0x...)'),
    },
    outputSchema: z.object({
      address: z.string().describe('Token contract address'),
      score: z.number().describe('Safety score from 0 (dangerous) to 100 (safe)'),
      grade: z.string().describe('Letter grade: A (safest) through F (dangerous)'),
      is_honeypot: z.boolean().describe('Whether the token is detected as a honeypot'),
      buy_tax: z.number().describe('Buy tax percentage'),
      sell_tax: z.number().describe('Sell tax percentage'),
      ownership_renounced: z.boolean().describe('Whether contract ownership has been renounced'),
    }).passthrough(),
    annotations: READ_ONLY_ANNOTATIONS,
  },
  async ({ address }) => {
    const addr = validateAddress(address)
    const data = await fetchJSON(`${SAFETY}/api/v1/token/${addr}/safety`)
    return wrapResult(data)
  }
)

server.registerTool(
  'get-token-liquidity',
  {
    title: 'Get Token Liquidity',
    description: 'Get detailed liquidity breakdown for a token: all DEX pairs, volumes, and reserves.',
    inputSchema: {
      address: z.string().describe('Token contract address (0x...)'),
    },
    outputSchema: z.object({
      address: z.string().describe('Token contract address'),
      total_liquidity_usd: z.number().describe('Total liquidity across all pairs in USD'),
      pairs: z.array(z.object({
        pair_address: z.string().describe('DEX pair contract address'),
        dex: z.string().describe('DEX name (e.g. PulseX)'),
        token0_symbol: z.string().describe('First token symbol'),
        token1_symbol: z.string().describe('Second token symbol'),
        liquidity_usd: z.number().describe('Pair liquidity in USD'),
        volume_24h: z.number().describe('24-hour volume in USD'),
      }).passthrough()).describe('Array of liquidity pairs'),
    }).passthrough(),
    annotations: READ_ONLY_ANNOTATIONS,
  },
  async ({ address }) => {
    const addr = validateAddress(address)
    const data = await fetchJSON(`${SAFETY}/api/v1/token/${addr}/liquidity`)
    return wrapResult(data)
  }
)

// ═══════════════════════════════════════════════════════════════════════════
// ── PRO TIER TOOLS (9) — require OPENPULSECHAIN_API_KEY env var ───────────
// ═══════════════════════════════════════════════════════════════════════════

server.registerTool(
  'check-address-risk',
  {
    title: 'Check Address AML Risk',
    description: '[PRO] Check if a wallet/contract address is flagged for AML risk, known exploits, phishing, or sanctions (OFAC). Requires OPENPULSECHAIN_API_KEY.',
    inputSchema: {
      address: z.string().describe('Wallet or contract address (0x...)'),
    },
    outputSchema: z.object({
      address: z.string().describe('Checked address'),
      risk_level: z.string().describe('Risk level: low, medium, high, critical'),
      risk_score: z.number().describe('Numeric risk score (0-100)'),
      flags: z.array(z.string()).describe('List of risk flags (e.g. sanctions, exploit, phishing)'),
      details: z.string().optional().describe('Additional risk context'),
    }).passthrough(),
    annotations: READ_ONLY_ANNOTATIONS,
  },
  proGate<{ address: string }>(async ({ address }) => {
    const addr = validateAddress(address)
    const data = await fetchJSON(`${SAFETY}/api/v1/address/${addr}/risk`)
    return wrapResult(data)
  })
)

server.registerTool(
  'get-deployer-reputation',
  {
    title: 'Get Deployer Reputation',
    description: '[PRO] Get reputation score for a token deployer: how many tokens deployed, how many died (rug pattern detection). Requires OPENPULSECHAIN_API_KEY.',
    inputSchema: {
      address: z.string().describe('Deployer wallet address (0x...)'),
    },
    outputSchema: z.object({
      address: z.string().describe('Deployer address'),
      reputation_score: z.number().describe('Reputation score (0-100)'),
      tokens_deployed: z.number().describe('Total number of tokens deployed'),
      tokens_dead: z.number().describe('Number of tokens that died or were rugged'),
      rug_pattern: z.boolean().describe('Whether a rug pull pattern is detected'),
    }).passthrough(),
    annotations: READ_ONLY_ANNOTATIONS,
  },
  proGate<{ address: string }>(async ({ address }) => {
    const addr = validateAddress(address)
    const data = await fetchJSON(`${SAFETY}/api/v1/deployer/${addr}`)
    return wrapResult(data)
  })
)

server.registerTool(
  'get-scam-alerts',
  {
    title: 'Get Scam Alerts',
    description: '[PRO] Get real-time scam radar alerts: honeypots, LP removals (rug pulls), whale dumps. Requires OPENPULSECHAIN_API_KEY.',
    inputSchema: {
      alert_type: z.enum(['honeypot', 'lp_removal', 'whale_dump']).optional()
        .describe('Filter by alert type (omit for all)'),
      limit: z.number().min(1).max(200).optional().describe('Number of alerts (default 20, max 200)'),
    },
    outputSchema: z.object({
      alerts: z.array(z.object({
        alert_type: z.string().describe('Type of alert: honeypot, lp_removal, whale_dump'),
        token_address: z.string().describe('Affected token address'),
        token_symbol: z.string().describe('Affected token symbol'),
        severity: z.string().describe('Alert severity: low, medium, high, critical'),
        timestamp: z.string().describe('Alert timestamp in ISO format'),
        details: z.string().optional().describe('Additional alert context'),
      }).passthrough()).describe('Array of scam alerts'),
    }).passthrough(),
    annotations: READ_ONLY_ANNOTATIONS,
  },
  proGate<{ alert_type?: 'honeypot' | 'lp_removal' | 'whale_dump'; limit?: number }>(async ({ alert_type, limit }) => {
    let url = `${SAFETY}/api/v1/alerts/recent?limit=${limit ?? 20}`
    if (alert_type) url += `&alert_type=${alert_type}`
    const data = await fetchJSON(url)
    return wrapResult(data)
  })
)

server.registerTool(
  'get-smart-money-feed',
  {
    title: 'Get Smart Money Feed',
    description: '[PRO] Get smart money / whale activity feed: large wallet movements and recent swaps on PulseX. Requires OPENPULSECHAIN_API_KEY.',
    inputSchema: {
      hours: z.number().min(1).max(168).optional().describe('Lookback period in hours (default 24, max 168)'),
      min_usd: z.number().min(100).optional().describe('Minimum swap value in USD (default 1000)'),
    },
    outputSchema: z.object({
      movements: z.array(z.object({
        wallet: z.string().describe('Smart money wallet address'),
        action: z.string().describe('Action type: buy, sell, transfer'),
        token_symbol: z.string().describe('Token symbol'),
        amount_usd: z.number().describe('Transaction value in USD'),
        timestamp: z.string().describe('Transaction timestamp in ISO format'),
      }).passthrough()).describe('Array of smart money movements'),
    }).passthrough(),
    annotations: READ_ONLY_ANNOTATIONS,
  },
  proGate<{ hours?: number; min_usd?: number }>(async ({ hours, min_usd }) => {
    const data = await fetchJSON(`${SAFETY}/api/v1/smart-money/feed?hours=${hours ?? 24}&min_usd=${min_usd ?? 1000}`)
    return wrapResult(data)
  })
)

server.registerTool(
  'get-recent-swaps',
  {
    title: 'Get Recent DEX Swaps',
    description: '[PRO] Get recent large swaps on PulseX DEX. Requires OPENPULSECHAIN_API_KEY.',
    inputSchema: {
      minutes: z.number().min(5).max(1440).optional().describe('Lookback in minutes (default 60, max 1440)'),
      min_usd: z.number().min(100).optional().describe('Minimum swap USD value (default 1000)'),
    },
    outputSchema: z.object({
      swaps: z.array(z.object({
        tx_hash: z.string().describe('Transaction hash'),
        wallet: z.string().describe('Swapper wallet address'),
        token_in: z.string().describe('Input token symbol'),
        token_out: z.string().describe('Output token symbol'),
        amount_usd: z.number().describe('Swap value in USD'),
        timestamp: z.string().describe('Swap timestamp in ISO format'),
      }).passthrough()).describe('Array of recent swaps'),
    }).passthrough(),
    annotations: READ_ONLY_ANNOTATIONS,
  },
  proGate<{ minutes?: number; min_usd?: number }>(async ({ minutes, min_usd }) => {
    const data = await fetchJSON(`${SAFETY}/api/v1/smart-money/swaps?minutes=${minutes ?? 60}&min_usd=${min_usd ?? 1000}`)
    return wrapResult(data)
  })
)

server.registerTool(
  'get-wallet-balances',
  {
    title: 'Get Wallet Balances',
    description: '[PRO] Get current token balances for a PulseChain wallet. Requires OPENPULSECHAIN_API_KEY.',
    inputSchema: {
      address: z.string().describe('Wallet address (0x...)'),
    },
    outputSchema: z.object({
      address: z.string().describe('Wallet address'),
      total_value_usd: z.number().describe('Total portfolio value in USD'),
      balances: z.array(z.object({
        token_address: z.string().describe('Token contract address'),
        token_symbol: z.string().describe('Token symbol'),
        balance: z.string().describe('Raw token balance'),
        value_usd: z.number().describe('Balance value in USD'),
      }).passthrough()).describe('Array of token balances'),
    }).passthrough(),
    annotations: READ_ONLY_ANNOTATIONS,
  },
  proGate<{ address: string }>(async ({ address }) => {
    const addr = validateAddress(address)
    const data = await fetchJSON(`${SAFETY}/api/v1/wallet/${addr}/balances`)
    return wrapResult(data)
  })
)

server.registerTool(
  'get-wallet-swaps',
  {
    title: 'Get Wallet Swap History',
    description: '[PRO] Get swap history for a PulseChain wallet. Requires OPENPULSECHAIN_API_KEY.',
    inputSchema: {
      address: z.string().describe('Wallet address (0x...)'),
    },
    outputSchema: z.object({
      address: z.string().describe('Wallet address'),
      swaps: z.array(z.object({
        tx_hash: z.string().describe('Transaction hash'),
        token_in: z.string().describe('Input token symbol'),
        token_out: z.string().describe('Output token symbol'),
        amount_usd: z.number().describe('Swap value in USD'),
        timestamp: z.string().describe('Swap timestamp in ISO format'),
      }).passthrough()).describe('Array of wallet swaps'),
    }).passthrough(),
    annotations: READ_ONLY_ANNOTATIONS,
  },
  proGate<{ address: string }>(async ({ address }) => {
    const addr = validateAddress(address)
    const data = await fetchJSON(`${SAFETY}/api/v1/wallet/${addr}/swaps`)
    return wrapResult(data)
  })
)

server.registerTool(
  'get-funding-tree',
  {
    title: 'Get Funding Tree',
    description: '[PRO] Trace funding sources for a wallet: where did the money come from? (2-level depth, bridge/DEX interactions). Requires OPENPULSECHAIN_API_KEY.',
    inputSchema: {
      address: z.string().describe('Wallet address to trace (0x...)'),
    },
    outputSchema: z.object({
      address: z.string().describe('Root wallet address'),
      depth: z.number().describe('Trace depth level'),
      funding_sources: z.array(z.object({
        source_address: z.string().describe('Funding source address'),
        source_type: z.string().describe('Source type: wallet, bridge, dex, contract'),
        amount_usd: z.number().describe('Funded amount in USD'),
        tx_hash: z.string().describe('Transaction hash'),
        timestamp: z.string().describe('Transaction timestamp in ISO format'),
      }).passthrough()).describe('Array of funding sources'),
    }).passthrough(),
    annotations: READ_ONLY_ANNOTATIONS,
  },
  proGate<{ address: string }>(async ({ address }) => {
    const addr = validateAddress(address)
    const data = await fetchJSON(`${SAFETY}/api/v1/address/${addr}/funding-tree`)
    return wrapResult(data)
  })
)

server.registerTool(
  'get-holder-rank',
  {
    title: 'Get Holder Rank',
    description: '[PRO] Get holder rank and tier for a wallet address across all tracked tokens. Requires OPENPULSECHAIN_API_KEY.',
    inputSchema: {
      address: z.string().describe('Wallet address (0x...)'),
    },
    outputSchema: z.object({
      address: z.string().describe('Wallet address'),
      ranks: z.array(z.object({
        token_symbol: z.string().describe('Token symbol'),
        rank: z.number().describe('Holder rank position'),
        tier: z.string().describe('Tier: poseidon, whale, shark, dolphin, squid, turtle'),
        balance_usd: z.number().describe('Balance value in USD'),
      }).passthrough()).describe('Array of holder rankings per token'),
    }).passthrough(),
    annotations: READ_ONLY_ANNOTATIONS,
  },
  proGate<{ address: string }>(async ({ address }) => {
    const addr = validateAddress(address)
    const data = await fetchJSON(`${SAFETY}/api/v1/leagues/rank/${addr}`)
    return wrapResult(data)
  })
)

// ═══════════════════════════════════════════════════════════════════════════
// ── INCLUDED TOOLS (continued) ────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

server.registerTool(
  'get-bridge-stats',
  {
    title: 'Get Bridge Stats',
    description: 'Get PulseChain bridge statistics: inflows, outflows, net flow over the last 7 days.',
    outputSchema: z.object({
      inflow_usd: z.number().describe('Total bridge inflows in USD over the last 7 days'),
      outflow_usd: z.number().describe('Total bridge outflows in USD over the last 7 days'),
      net_flow_usd: z.number().describe('Net flow (inflow - outflow) in USD'),
      daily: z.array(z.object({
        date: z.string().describe('Date in ISO format'),
        inflow_usd: z.number().describe('Daily inflow in USD'),
        outflow_usd: z.number().describe('Daily outflow in USD'),
      }).passthrough()).describe('Daily bridge flow breakdown'),
    }).passthrough(),
    annotations: READ_ONLY_ANNOTATIONS,
  },
  async () => {
    const data = await fetchJSON(`${SAFETY}/api/v1/bridge/stats`)
    return wrapResult(data)
  }
)

server.registerTool(
  'get-holder-leagues',
  {
    title: 'Get Holder Leagues',
    description: 'Get aggregated holder distribution tiers (poseidon/whale/shark/dolphin/squid/turtle) for a core PulseChain token.',
    inputSchema: {
      symbol: z.enum(['PLS', 'PLSX', 'HEX', 'INC', 'PRVX']).describe('Token symbol'),
    },
    outputSchema: z.object({
      symbol: z.string().describe('Token symbol'),
      tiers: z.array(z.object({
        tier: z.string().describe('Tier name: poseidon, whale, shark, dolphin, squid, turtle'),
        holder_count: z.number().describe('Number of holders in this tier'),
        min_balance_usd: z.number().describe('Minimum balance in USD for this tier'),
        total_value_usd: z.number().describe('Total value held by this tier in USD'),
      }).passthrough()).describe('Array of holder tiers'),
    }).passthrough(),
    annotations: READ_ONLY_ANNOTATIONS,
  },
  async ({ symbol }) => {
    const data = await fetchJSON(`${SAFETY}/api/v1/leagues/${symbol}`)
    return wrapResult(data)
  }
)

server.registerTool(
  'get-honeypots',
  {
    title: 'Get Honeypot Tokens',
    description: 'List recently detected honeypot tokens on PulseChain.',
    inputSchema: {
      limit: z.number().min(1).max(200).optional().describe('Number of results (default 20, max 200)'),
    },
    outputSchema: z.object({
      honeypots: z.array(z.object({
        address: z.string().describe('Honeypot token address'),
        name: z.string().describe('Token name'),
        symbol: z.string().describe('Token symbol'),
        detected_at: z.string().describe('Detection timestamp in ISO format'),
        buy_tax: z.number().describe('Buy tax percentage'),
        sell_tax: z.number().describe('Sell tax percentage (often 100% for honeypots)'),
      }).passthrough()).describe('Array of detected honeypot tokens'),
    }).passthrough(),
    annotations: READ_ONLY_ANNOTATIONS,
  },
  async ({ limit }) => {
    const data = await fetchJSON(`${API}/api/v1/safety/honeypots?limit=${limit ?? 20}`)
    return wrapResult(data)
  }
)

// ── Well-known token addresses (resource for LLMs) ──

server.resource(
  'pulsechain-tokens',
  'pulsechain://tokens/core',
  async () => ({
    contents: [{
      uri: 'pulsechain://tokens/core',
      mimeType: 'application/json',
      text: JSON.stringify({
        description: 'Core PulseChain token addresses — use these with the tools above',
        tokens: {
          WPLS:  { address: '0xa1077a294dde1b09bb078844df40758a5d0f9a27', name: 'Wrapped Pulse', decimals: 18 },
          HEX:   { address: '0x2b591e99afe9f32eaa6214f7b7629768c40eeb39', name: 'HEX', decimals: 8 },
          PLSX:  { address: '0x95b303987a60c71504d99aa1b13b4da07b0790ab', name: 'PulseX', decimals: 18 },
          INC:   { address: '0x2fa878ab3f87cc1c9737fc071108f904c0b0c95d', name: 'Incentive', decimals: 18 },
          eHEX:  { address: '0x57fde0a71132198bbec939b98976993d8d89d225', name: 'HEX (Ethereum bridged)', decimals: 8 },
          DAI:   { address: '0xefd766ccb38eaf1dfd701853bfce31359239f305', name: 'DAI (bridged)', decimals: 18 },
          USDC:  { address: '0x15d38573d2feeb82e7ad5187ab8c1d52810b1f07', name: 'USDC (bridged)', decimals: 6 },
          USDT:  { address: '0x0cb6f5a34ad42ec934882a05265a7d5f59b51a2f', name: 'USDT (bridged)', decimals: 6 },
          WETH:  { address: '0x02dcdd04e3f455d838cd1249292c58f3b79e3c3c', name: 'WETH (bridged)', decimals: 18 },
          WBTC:  { address: '0xb17d901469b9208b17d916112988a3fed19b5ca1', name: 'WBTC (bridged)', decimals: 8 },
        },
      }, null, 2),
    }],
  })
)
// ═══════════════════════════════════════════════════════════════════════════
// ── PHASE A-D NEW TOOLS ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

server.registerTool(
  'get-opportunity-signal',
  {
    title: 'Get Opportunity Signal',
    description: '[PRO] Composite opportunity score (0-100) for a PulseChain token. Combines momentum, volume spike, buy pressure, safety, whale activity, and MC/liquidity fragility. Returns confidence level and graceful degradation for partial data. Requires OPENPULSECHAIN_API_KEY.',
    inputSchema: {
      address: z.string().describe('Token contract address (0x...)'),
    },
    outputSchema: z.object({
      opportunity_score: z.number().describe('Composite score 0-100'),
      grade: z.string().describe('Grade: A, B+, B, C, D, F'),
      direction_hint: z.string().describe('strong_opportunity, bullish_momentum, neutral_positive, neutral, bearish_pressure, avoid'),
      confidence: z.string().describe('high, medium, low, insufficient_data'),
      factors: z.record(z.string(), z.object({ score: z.number(), detail: z.string() }).passthrough()).describe('Individual factor scores'),
      kill_signals: z.array(z.string()).describe('Override signals that force score to 0'),
      data_completeness: z.string().describe('full, partial_no_history, safety_only, minimal'),
    }).passthrough(),
    annotations: READ_ONLY_ANNOTATIONS,
  },
  proGate<{ address: string }>(async ({ address }) => {
    const addr = validateAddress(address)
    const data = await fetchJSON(`${SAFETY}/api/v1/signal/${addr}`)
    return wrapResult(data)
  })
)

server.registerTool(
  'get-pair-analytics',
  {
    title: 'Get DEX Pair Analytics',
    description: '[PRO] Detailed analytics for a PulseX trading pair: price, volume, liquidity, buy/sell ratio, price impact estimates, volatility, wash trading detection. Requires OPENPULSECHAIN_API_KEY.',
    inputSchema: {
      address: z.string().describe('Pair contract address (0x...)'),
    },
    outputSchema: z.object({
      pair_address: z.string(),
      price_usd: z.number().nullable(),
      metrics: z.object({
        volume_24h_usd: z.number(),
        liquidity_usd: z.number(),
        buys_24h: z.number(),
        sells_24h: z.number(),
      }).passthrough(),
      computed: z.object({
        buy_sell_ratio: z.number(),
        price_impact_1k_usd: z.number().nullable(),
        price_impact_10k_usd: z.number().nullable(),
        volatility_24h: z.number(),
        liquidity_depth_ratio: z.number(),
        wash_trading_flag: z.boolean(),
      }).passthrough(),
    }).passthrough(),
    annotations: READ_ONLY_ANNOTATIONS,
  },
  proGate<{ address: string }>(async ({ address }) => {
    const addr = validateAddress(address)
    const data = await fetchJSON(`${SAFETY}/api/v1/pair/${addr}/analytics`)
    return wrapResult(data)
  })
)

server.registerTool(
  'get-whale-alerts',
  {
    title: 'Get Whale Alerts',
    description: '[PRO] Recent whale movements: large swaps (>$10K), LP removals, whale dumps. Combines scam radar + PulseX subgraph data. Requires OPENPULSECHAIN_API_KEY.',
    inputSchema: {
      hours: z.number().optional().describe('Lookback period in hours (default: 24, max: 168)'),
      min_usd: z.number().optional().describe('Minimum USD value for swaps (default: 10000)'),
    },
    outputSchema: z.object({
      data: z.array(z.object({
        type: z.string().describe('large_swap, lp_removal, whale_dump'),
        severity: z.string().describe('critical, high, medium'),
        token_address: z.string().nullable(),
        timestamp: z.string().nullable(),
        source: z.string(),
      }).passthrough()),
      count: z.number(),
    }).passthrough(),
    annotations: READ_ONLY_ANNOTATIONS,
  },
  proGate<{ hours?: number; min_usd?: number }>(async ({ hours, min_usd }) => {
    const params = new URLSearchParams()
    if (hours) params.set('hours', String(hours))
    if (min_usd) params.set('min_usd', String(min_usd))
    const qs = params.toString() ? `?${params}` : ''
    const data = await fetchJSON(`${SAFETY}/api/v1/whale-alerts${qs}`)
    return wrapResult(data)
  })
)

server.registerTool(
  'get-gas',
  {
    title: 'Get Gas Price',
    description: '[PRO] Current PulseChain gas price in Gwei, block number, and base fee. Requires OPENPULSECHAIN_API_KEY.',
    inputSchema: {},
    outputSchema: z.object({
      gas_price_gwei: z.number().describe('Current gas price in Gwei'),
      base_fee_gwei: z.number().nullable().describe('Base fee in Gwei'),
      block_number: z.number().nullable().describe('Latest block number'),
    }).passthrough(),
    annotations: READ_ONLY_ANNOTATIONS,
  },
  proGate<Record<string, never>>(async (_args) => {
    const data = await fetchJSON(`${SAFETY}/api/v1/gas`)
    return wrapResult(data)
  })
)

server.registerTool(
  'get-token-holders',
  {
    title: 'Get Token Holders',
    description: '[PRO] Top holders of a PulseChain token with balances and ownership percentages. Requires OPENPULSECHAIN_API_KEY.',
    inputSchema: {
      address: z.string().describe('Token contract address (0x...)'),
      limit: z.number().optional().describe('Number of holders to return (default: 50, max: 100)'),
    },
    outputSchema: z.object({
      data: z.array(z.object({
        address: z.string(),
        balance: z.string(),
        percentage: z.number(),
        is_contract: z.boolean(),
      }).passthrough()),
      token_address: z.string(),
      count: z.number(),
    }).passthrough(),
    annotations: READ_ONLY_ANNOTATIONS,
  },
  proGate<{ address: string; limit?: number }>(async ({ address, limit }) => {
    const addr = validateAddress(address)
    const qs = limit ? `?limit=${limit}` : ''
    const data = await fetchJSON(`${SAFETY}/api/v1/token/${addr}/holders${qs}`)
    return wrapResult(data)
  })
)

server.registerTool(
  'get-token-sentiment',
  {
    title: 'Get Token Sentiment',
    description: '[PRO] Aggregated social sentiment score (-100 to +100) for a PulseChain token. Based on categorized events (partnerships, exploits, dumps, etc.). Requires OPENPULSECHAIN_API_KEY.',
    inputSchema: {
      symbol: z.string().describe('Token symbol (e.g. PLS, HEX, PLSX)'),
    },
    outputSchema: z.object({
      symbol: z.string(),
      sentiment_score: z.number().describe('-100 (extreme bearish) to +100 (extreme bullish)'),
      classification: z.string().describe('bullish, bearish, neutral'),
      positive_events: z.number(),
      negative_events: z.number(),
      total_events: z.number(),
    }).passthrough(),
    annotations: READ_ONLY_ANNOTATIONS,
  },
  proGate<{ symbol: string }>(async ({ symbol }) => {
    const clean = symbol.replace(/[^a-zA-Z0-9_]/g, '').toUpperCase()
    const data = await fetchJSON(`${SAFETY}/api/v1/sentiment/${clean}`)
    return wrapResult(data)
  })
)

server.registerTool(
  'get-wallet-transactions',
  {
    title: 'Get Wallet Transactions',
    description: '[PRO] Recent transactions for a wallet address (PLS transfers + token transfers). Requires OPENPULSECHAIN_API_KEY.',
    inputSchema: {
      address: z.string().describe('Wallet address (0x...)'),
      limit: z.number().optional().describe('Number of transactions (default: 20, max: 50)'),
    },
    outputSchema: z.object({
      data: z.array(z.object({
        hash: z.string(),
        from: z.string(),
        to: z.string(),
        value: z.string(),
        timestamp: z.string(),
      }).passthrough()),
    }).passthrough(),
    annotations: READ_ONLY_ANNOTATIONS,
  },
  proGate<{ address: string; limit?: number }>(async ({ address, limit }) => {
    const addr = validateAddress(address)
    const qs = limit ? `?limit=${limit}` : ''
    const data = await fetchJSON(`${SAFETY}/api/v1/address/${addr}/transactions${qs}`)
    return wrapResult(data)
  })
)

server.registerTool(
  'get-tx-trace',
  {
    title: 'Get Transaction Trace',
    description: '[PRO] Internal call trace for a transaction hash. Shows all internal transfers, contract calls, and token movements. Requires OPENPULSECHAIN_API_KEY.',
    inputSchema: {
      tx_hash: z.string().describe('Transaction hash (0x...)'),
    },
    outputSchema: z.object({
      transaction: z.object({
        hash: z.string(),
        from: z.string(),
        to: z.string(),
        value: z.string(),
      }).passthrough(),
      internal_transactions: z.array(z.object({
        from: z.string(),
        to: z.string(),
        value: z.string(),
        type: z.string(),
      }).passthrough()),
    }).passthrough(),
    annotations: READ_ONLY_ANNOTATIONS,
  },
  proGate<{ tx_hash: string }>(async ({ tx_hash }) => {
    const clean = tx_hash.trim().toLowerCase()
    if (!/^0x[0-9a-f]{64}$/.test(clean)) throw new Error('Invalid transaction hash')
    const data = await fetchJSON(`${SAFETY}/api/v1/tx/${clean}/trace`)
    return wrapResult(data)
  })
)

} // end registerTools

// ── Start ──

const TRANSPORT = (process.env.MCP_TRANSPORT || 'stdio').toLowerCase()

async function main() {
  const tier = HAS_API_KEY ? 'PRO (API key detected)' : 'STANDARD (no API key)'

  if (TRANSPORT === 'http') {
    // HTTP mode — for remote deployment (Railway, mcp.openpulsechain.com)
    const express = await import('express')
    const app = express.default()

    // ── Security middleware ──
    // Limit request body size (prevent DoS via large payloads)
    app.use(express.json({ limit: '64kb' }))

    // Remove server fingerprint
    app.disable('x-powered-by')

    // CORS — restrict to known origins
    const ALLOWED_ORIGINS = new Set([
      'https://openpulsechain.com',
      'https://www.openpulsechain.com',
      'https://glama.ai',
      'https://smithery.ai',
    ])
    app.use((req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => {
      const origin = req.headers.origin
      if (origin && ALLOWED_ORIGINS.has(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin)
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id, Authorization')
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
      }
      if (req.method === 'OPTIONS') { res.sendStatus(204); return }
      next()
    })

    // Rate limiting — simple in-memory counter per IP
    const ipCounts = new Map<string, { count: number; reset: number }>()
    const RATE_LIMIT = 120 // requests per minute
    app.use((req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => {
      if (req.path === '/health') { next(); return }
      const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown'
      const now = Date.now()
      const entry = ipCounts.get(ip)
      if (!entry || now > entry.reset) {
        ipCounts.set(ip, { count: 1, reset: now + 60_000 })
      } else {
        entry.count++
        if (entry.count > RATE_LIMIT) {
          res.status(429).json({ error: 'rate_limit_exceeded', message: 'Too many requests. Max 120/min.' })
          return
        }
      }
      next()
    })

    // Health check
    app.get('/health', (_req: import('express').Request, res: import('express').Response) => {
      res.json({ status: 'ok', transport: 'http', tier, version: '2.0.0' })
    })

    // Reject all paths except /mcp and /health (catch-all at the end)
    // Note: this is registered AFTER /health and /mcp routes below

    // Stateless mode — each POST creates a fresh server+transport.
    // sessionIdGenerator=undefined disables the "Server not initialized" check.
    app.post('/mcp', async (req: import('express').Request, res: import('express').Response) => {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
      const mcpServer = createServer()
      await mcpServer.connect(transport)
      await transport.handleRequest(req, res, req.body)
    })

    // GET/DELETE not needed in stateless mode
    app.get('/mcp', (_req: import('express').Request, res: import('express').Response) => {
      res.status(405).json({ error: 'Use POST /mcp' })
    })
    app.delete('/mcp', (_req: import('express').Request, res: import('express').Response) => {
      res.status(405).json({ error: 'Stateless server, no sessions' })
    })

    // Catch-all 404 for unknown routes
    app.use((_req: import('express').Request, res: import('express').Response) => {
      res.status(404).json({ error: 'not_found', mcp_endpoint: '/mcp' })
    })

    const PORT = parseInt(process.env.PORT || '3100')
    app.listen(PORT, '0.0.0.0', () => {
      process.stderr.write(
        `[openpulsechain-mcp] HTTP server on port ${PORT} in ${tier} mode — upgrade: ${PRICING_URL}\n`
      )
    })
  } else {
    // stdio mode — for local usage (npx, Claude Desktop, Cursor)
    process.stderr.write(
      `[openpulsechain-mcp] starting in ${tier} mode — upgrade: ${PRICING_URL}\n`
    )
    const stdioServer = createServer()
    const transport = new StdioServerTransport()
    await stdioServer.connect(transport)
  }
}

main().catch(console.error)
