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
import { z } from 'zod'

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
type ToolResult = { content: Array<{ type: 'text'; text: string }> }

function proGate<Args>(
  handler: (args: Args) => Promise<ToolResult>
): (args: Args) => Promise<ToolResult> {
  return async (args: Args) => {
    if (!HAS_API_KEY) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            error: 'pro_tier_required',
            message:
              'This tool is part of the OpenPulsechain MCP Pro tier. ' +
              'Set the OPENPULSECHAIN_API_KEY environment variable to unlock it.',
            upgrade_url: PRICING_URL,
            how_to:
              'In your Claude/Cursor/Claude-Code MCP config, add: ' +
              '"env": { "OPENPULSECHAIN_API_KEY": "sk-opk-..." }',
            included_alternatives: [
              'get_token_price', 'get_token_info', 'get_token_safety',
              'get_token_liquidity', 'get_top_tokens', 'get_honeypots',
              'get_market_overview', 'get_bridge_stats', 'get_holder_leagues',
            ],
          }, null, 2),
        }],
      }
    }
    return handler(args)
  }
}

// ── Server ──

const server = new McpServer({
  name: 'openpulsechain',
  version: '1.2.1',
})

// ═══════════════════════════════════════════════════════════════════════════
// ── INCLUDED TOOLS (11) — public data, no API key required ───────────────
// ═══════════════════════════════════════════════════════════════════════════

server.tool(
  'get_token_price',
  'Get current price, 24h change, volume, and market cap for a PulseChain token.',
  {
    address: z.string().describe('Token contract address (0x...) — e.g. 0x2b591e99afe9f32eaa6214f7b7629768c40eeb39 for HEX'),
  },
  async ({ address }) => {
    const addr = validateAddress(address)
    const data = await fetchJSON(`${API}/api/v1/tokens/${addr}/price`)
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'get_token_info',
  'Get full details for a PulseChain token: name, symbol, decimals, liquidity, volume, holder count.',
  {
    address: z.string().describe('Token contract address (0x...)'),
  },
  async ({ address }) => {
    const addr = validateAddress(address)
    const data = await fetchJSON(`${API}/api/v1/tokens/${addr}`)
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'get_token_history',
  'Get historical price data (OHLCV) for a PulseChain token. Limited to 30 days without API key; Pro unlocks full history.',
  {
    address: z.string().describe('Token contract address (0x...)'),
    days: z.number().min(1).max(1000).optional().describe('Number of days of history (default 30, max 1000)'),
  },
  async ({ address, days }) => {
    const d = days ?? 30
    const addr = validateAddress(address)
    const data = await fetchJSON(`${API}/api/v1/tokens/${addr}/history?days=${d}`)
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'get_top_tokens',
  'List top PulseChain tokens sorted by volume, liquidity, or symbol.',
  {
    sort_by: z.enum(['volume', 'liquidity', 'symbol']).optional().describe('Sort field (default: volume)'),
    limit: z.number().min(1).max(500).optional().describe('Number of tokens to return (default 20, max 500)'),
  },
  async ({ sort_by, limit }) => {
    const s = sort_by ?? 'volume'
    const l = limit ?? 20
    const data = await fetchJSON(`${API}/api/v1/tokens?sort_by=${s}&limit=${l}`)
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'get_top_pairs',
  'List top PulseX DEX trading pairs by volume.',
  {
    limit: z.number().min(1).max(500).optional().describe('Number of pairs (default 20, max 500)'),
  },
  async ({ limit }) => {
    const data = await fetchJSON(`${API}/api/v1/pairs?limit=${limit ?? 20}`)
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'get_market_overview',
  'Get PulseChain network overview: TVL, 24h volume, active tokens, top gainers/losers.',
  {},
  async () => {
    const data = await fetchJSON(`${API}/api/v1/market/overview`)
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'get_token_safety',
  'Analyze a token for scam indicators: honeypot detection, buy/sell tax, ownership, liquidity score (0-100, A-F grade).',
  {
    address: z.string().describe('Token contract address (0x...)'),
  },
  async ({ address }) => {
    const addr = validateAddress(address)
    const data = await fetchJSON(`${SAFETY}/api/v1/token/${addr}/safety`)
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'get_token_liquidity',
  'Get detailed liquidity breakdown for a token: all DEX pairs, volumes, and reserves.',
  {
    address: z.string().describe('Token contract address (0x...)'),
  },
  async ({ address }) => {
    const addr = validateAddress(address)
    const data = await fetchJSON(`${SAFETY}/api/v1/token/${addr}/liquidity`)
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

// ═══════════════════════════════════════════════════════════════════════════
// ── PRO TIER TOOLS (9) — require OPENPULSECHAIN_API_KEY env var ───────────
// ═══════════════════════════════════════════════════════════════════════════

server.tool(
  'check_address_risk',
  '[PRO] Check if a wallet/contract address is flagged for AML risk, known exploits, phishing, or sanctions (OFAC). Requires OPENPULSECHAIN_API_KEY.',
  {
    address: z.string().describe('Wallet or contract address (0x...)'),
  },
  proGate<{ address: string }>(async ({ address }) => {
    const addr = validateAddress(address)
    const data = await fetchJSON(`${SAFETY}/api/v1/address/${addr}/risk`)
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  })
)

server.tool(
  'get_deployer_reputation',
  '[PRO] Get reputation score for a token deployer: how many tokens deployed, how many died (rug pattern detection). Requires OPENPULSECHAIN_API_KEY.',
  {
    address: z.string().describe('Deployer wallet address (0x...)'),
  },
  proGate<{ address: string }>(async ({ address }) => {
    const addr = validateAddress(address)
    const data = await fetchJSON(`${SAFETY}/api/v1/deployer/${addr}`)
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  })
)

server.tool(
  'get_scam_alerts',
  '[PRO] Get real-time scam radar alerts: honeypots, LP removals (rug pulls), whale dumps. Requires OPENPULSECHAIN_API_KEY.',
  {
    alert_type: z.enum(['honeypot', 'lp_removal', 'whale_dump']).optional()
      .describe('Filter by alert type (omit for all)'),
    limit: z.number().min(1).max(200).optional().describe('Number of alerts (default 20, max 200)'),
  },
  proGate<{ alert_type?: 'honeypot' | 'lp_removal' | 'whale_dump'; limit?: number }>(async ({ alert_type, limit }) => {
    let url = `${SAFETY}/api/v1/alerts/recent?limit=${limit ?? 20}`
    if (alert_type) url += `&alert_type=${alert_type}`
    const data = await fetchJSON(url)
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  })
)

server.tool(
  'get_smart_money_feed',
  '[PRO] Get smart money / whale activity feed: large wallet movements and recent swaps on PulseX. Requires OPENPULSECHAIN_API_KEY.',
  {
    hours: z.number().min(1).max(168).optional().describe('Lookback period in hours (default 24, max 168)'),
    min_usd: z.number().min(100).optional().describe('Minimum swap value in USD (default 1000)'),
  },
  proGate<{ hours?: number; min_usd?: number }>(async ({ hours, min_usd }) => {
    const data = await fetchJSON(`${SAFETY}/api/v1/smart-money/feed?hours=${hours ?? 24}&min_usd=${min_usd ?? 1000}`)
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  })
)

server.tool(
  'get_recent_swaps',
  '[PRO] Get recent large swaps on PulseX DEX. Requires OPENPULSECHAIN_API_KEY.',
  {
    minutes: z.number().min(5).max(1440).optional().describe('Lookback in minutes (default 60, max 1440)'),
    min_usd: z.number().min(100).optional().describe('Minimum swap USD value (default 1000)'),
  },
  proGate<{ minutes?: number; min_usd?: number }>(async ({ minutes, min_usd }) => {
    const data = await fetchJSON(`${SAFETY}/api/v1/smart-money/swaps?minutes=${minutes ?? 60}&min_usd=${min_usd ?? 1000}`)
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  })
)

server.tool(
  'get_wallet_balances',
  '[PRO] Get current token balances for a PulseChain wallet. Requires OPENPULSECHAIN_API_KEY.',
  {
    address: z.string().describe('Wallet address (0x...)'),
  },
  proGate<{ address: string }>(async ({ address }) => {
    const addr = validateAddress(address)
    const data = await fetchJSON(`${SAFETY}/api/v1/wallet/${addr}/balances`)
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  })
)

server.tool(
  'get_wallet_swaps',
  '[PRO] Get swap history for a PulseChain wallet. Requires OPENPULSECHAIN_API_KEY.',
  {
    address: z.string().describe('Wallet address (0x...)'),
  },
  proGate<{ address: string }>(async ({ address }) => {
    const addr = validateAddress(address)
    const data = await fetchJSON(`${SAFETY}/api/v1/wallet/${addr}/swaps`)
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  })
)

server.tool(
  'get_funding_tree',
  '[PRO] Trace funding sources for a wallet: where did the money come from? (2-level depth, bridge/DEX interactions). Requires OPENPULSECHAIN_API_KEY.',
  {
    address: z.string().describe('Wallet address to trace (0x...)'),
  },
  proGate<{ address: string }>(async ({ address }) => {
    const addr = validateAddress(address)
    const data = await fetchJSON(`${SAFETY}/api/v1/address/${addr}/funding-tree`)
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  })
)

server.tool(
  'get_holder_rank',
  '[PRO] Get holder rank and tier for a wallet address across all tracked tokens. Requires OPENPULSECHAIN_API_KEY.',
  {
    address: z.string().describe('Wallet address (0x...)'),
  },
  proGate<{ address: string }>(async ({ address }) => {
    const addr = validateAddress(address)
    const data = await fetchJSON(`${SAFETY}/api/v1/leagues/rank/${addr}`)
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  })
)

// ═══════════════════════════════════════════════════════════════════════════
// ── INCLUDED TOOLS (continued) ────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

server.tool(
  'get_bridge_stats',
  'Get PulseChain bridge statistics: inflows, outflows, net flow over the last 7 days.',
  {},
  async () => {
    const data = await fetchJSON(`${SAFETY}/api/v1/bridge/stats`)
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'get_holder_leagues',
  'Get aggregated holder distribution tiers (poseidon/whale/shark/dolphin/squid/turtle) for a core PulseChain token.',
  {
    symbol: z.enum(['PLS', 'PLSX', 'HEX', 'INC', 'PRVX']).describe('Token symbol'),
  },
  async ({ symbol }) => {
    const data = await fetchJSON(`${SAFETY}/api/v1/leagues/${symbol}`)
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'get_honeypots',
  'List recently detected honeypot tokens on PulseChain.',
  {
    limit: z.number().min(1).max(200).optional().describe('Number of results (default 20, max 200)'),
  },
  async ({ limit }) => {
    const data = await fetchJSON(`${API}/api/v1/safety/honeypots?limit=${limit ?? 20}`)
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
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

// ── Start ──

async function main() {
  // Log tier to stderr (not stdout — stdout is reserved for MCP protocol)
  const tier = HAS_API_KEY ? 'PRO (API key detected)' : 'STANDARD (no API key)'
  process.stderr.write(
    `[openpulsechain-mcp] starting in ${tier} mode — upgrade: ${PRICING_URL}\n`
  )
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch(console.error)
