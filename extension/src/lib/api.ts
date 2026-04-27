const SAFETY_API = 'https://safety.openpulsechain.com'
const REST_API = 'https://api.openpulsechain.com'

export interface SafetyScore {
  token_address: string
  score: number
  grade: string
  risks: string[]
  honeypot_score: number
  is_honeypot: boolean
  buy_tax_pct: number | null
  sell_tax_pct: number | null
  contract_score: number
  is_verified: boolean
  is_proxy: boolean
  ownership_renounced: boolean
  has_mint: boolean
  has_blacklist: boolean
  contract_dangers: string[]
  lp_score: number
  has_lp: boolean
  total_liquidity_usd: number
  pair_count: number
  holders_score: number
  holder_count: number
  top10_pct: number
  top1_pct: number
  age_score: number
  age_days: number
  analyzed_at: string
  token_symbol?: string | null
  token_name?: string | null
  // API also returns these as separate fields
  symbol?: string | null
  name?: string | null
  // Raw JSON string with detailed analysis (honeypot, scam, etc.)
  analysis_details?: string | null
}

// Parsed scam analysis from analysis_details
export interface ScamAnalysis {
  scam_score: number
  risk_level: 'low' | 'medium' | 'high' | 'critical'
  signals: { signal: string; severity: string; detail: string }[]
}

export interface DeployerReputation {
  deployer_address: string
  tokens_deployed: number
  tokens_dead: number
  tokens_alive: number
  dead_ratio: number
  reputation_score: number
  risk_level: string
  analyzed_at: string
}

// Raw format from wallet API
interface RawWalletBalance {
  token_address: string
  symbol: string
  name: string
  balance: number
  token_type: string
}

// Enriched format for display
export interface WalletBalance {
  token_address: string
  symbol: string
  name: string
  balance: number
  price_usd: number | null
  value_usd: number | null
}

export interface SmartMoneySwap {
  dex: string
  bought_address: string
  sold_address: string
  bought_symbol: string
  sold_symbol: string
  pair_address: string
  amount_usd: number
  wallet: string
  timestamp: number
  tx_id: string
}

export interface ScamAlert {
  id: number
  alert_type: string
  severity: string
  token_address: string
  pair_address: string | null
  data: string
  created_at: string
}

// Cache with TTL
const cache = new Map<string, { data: unknown; expires: number }>()

// Simple rate limiter — max 30 requests per 10 seconds (non-cached)
const requestTimestamps: number[] = []
const RATE_LIMIT_WINDOW = 10_000
const RATE_LIMIT_MAX = 30

function checkRateLimit(): boolean {
  const now = Date.now()
  while (requestTimestamps.length > 0 && requestTimestamps[0] < now - RATE_LIMIT_WINDOW) {
    requestTimestamps.shift()
  }
  if (requestTimestamps.length >= RATE_LIMIT_MAX) return false
  requestTimestamps.push(now)
  return true
}

async function cachedFetch<T>(url: string, ttlMs: number, timeoutMs = 90_000): Promise<T> {
  const cached = cache.get(url)
  if (cached && cached.expires > Date.now()) {
    return cached.data as T
  }
  if (!checkRateLimit()) throw new Error('Rate limit — too many requests, please wait')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (res.status === 404) return null as T
    if (!res.ok) throw new Error(`API error: ${res.status}`)
    let data: unknown
    try {
      data = await res.json()
    } catch {
      throw new Error('API returned invalid JSON')
    }
    cache.set(url, { data, expires: Date.now() + ttlMs })
    return data as T
  } finally {
    clearTimeout(timer)
  }
}

// REST API token info (returns price_usd)
interface TokenApiResponse {
  data: {
    address: string
    symbol: string
    name: string
    price_usd: number | null
    market_cap_usd: number | null
    price_change_24h_pct: number | null
  }
}

// WPLS address — PLS native uses WPLS price
const WPLS_ADDRESS = '0xa1077a294dde1b09bb078844df40758a5d0f9a27'
const PLS_NATIVE = '0x0000000000000000000000000000000000000000'

// Fetch prices for multiple tokens via REST API
// Uses concurrent requests with concurrency limit
async function getTokenPrices(addresses: string[]): Promise<Map<string, number>> {
  const priceMap = new Map<string, number>()
  if (addresses.length === 0) return priceMap

  // Replace PLS native with WPLS for price lookup, deduplicate
  const lookupSet = new Set<string>()
  for (const addr of addresses) {
    const lower = addr.toLowerCase()
    lookupSet.add(lower === PLS_NATIVE ? WPLS_ADDRESS : lower)
  }
  const lookupAddresses = [...lookupSet]

  // Check cache first, collect uncached
  const uncached: string[] = []
  for (const addr of lookupAddresses) {
    const key = `price:${addr}`
    const cached = cache.get(key)
    if (cached && cached.expires > Date.now()) {
      const price = cached.data as number | null
      if (price != null) priceMap.set(addr, price)
    } else {
      uncached.push(addr)
    }
  }

  if (uncached.length > 0) {
    // Fetch in batches of 5 concurrent requests
    const BATCH_SIZE = 5
    for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
      const batch = uncached.slice(i, i + BATCH_SIZE)
      const results = await Promise.allSettled(
        batch.map(async (addr) => {
          try {
            const url = `${REST_API}/api/v1/tokens/${addr}`
            const res = await fetch(url)
            if (!res.ok) return { addr, price: null }
            const json: TokenApiResponse = await res.json()
            return { addr, price: json.data?.price_usd ?? null }
          } catch {
            return { addr, price: null }
          }
        })
      )
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          const { addr, price } = result.value
          cache.set(`price:${addr}`, { data: price, expires: Date.now() + 5 * 60 * 1000 })
          if (price != null) {
            priceMap.set(addr, price)
          }
        }
      }
    }
  }

  // Always copy WPLS price to PLS native address
  const wplsPrice = priceMap.get(WPLS_ADDRESS)
  if (wplsPrice != null) {
    priceMap.set(PLS_NATIVE, wplsPrice)
  }

  return priceMap
}

// Token search (by name/symbol)
export interface TokenSuggestion {
  address: string
  symbol: string
  name: string
}

export async function searchTokens(query: string): Promise<TokenSuggestion[]> {
  try {
    const res = await fetch(`${REST_API}/api/v1/tokens/search?q=${encodeURIComponent(query)}&limit=6`)
    if (!res.ok) return []
    const json = await res.json()
    return Array.isArray(json.data) ? json.data : []
  } catch {
    return []
  }
}

// Token price info
export interface TokenPriceInfo {
  address: string
  symbol: string
  name: string
  price_usd: number | null
  price_change_24h_pct: number | null
}

export async function getTokenPrice(address: string): Promise<TokenPriceInfo | null> {
  const json = await cachedFetch<TokenApiResponse | null>(`${REST_API}/api/v1/tokens/${address}`, 60 * 1000)
  if (!json?.data) return null
  return {
    address: json.data.address,
    symbol: json.data.symbol,
    name: json.data.name,
    price_usd: json.data.price_usd,
    price_change_24h_pct: json.data.price_change_24h_pct,
  }
}

// Safety API — response is { data: SafetyScore, cached: bool }
export async function getTokenSafety(address: string): Promise<SafetyScore | null> {
  const res = await cachedFetch<{ data: SafetyScore } | null>(`${SAFETY_API}/api/v1/token/${address}/safety`, 60 * 60 * 1000)
  return res?.data ?? null
}

export async function getDeployerReputation(address: string): Promise<DeployerReputation | null> {
  const res = await cachedFetch<{ data: DeployerReputation } | null>(`${SAFETY_API}/api/v1/deployer/${address}`, 60 * 60 * 1000)
  return res?.data ?? null
}

export async function getRecentAlerts(limit = 20): Promise<ScamAlert[]> {
  const result = await cachedFetch<{ data: ScamAlert[]; count: number } | null>(
    `${SAFETY_API}/api/v1/alerts/recent?limit=${limit}`, 2 * 60 * 1000
  )
  return result?.data || []
}

// Wallet API — fetch raw balances then enrich with live prices from REST API
export async function getWalletBalances(address: string): Promise<WalletBalance[]> {
  const result = await cachedFetch<{ data: RawWalletBalance[]; wallet: string; count: number } | null>(
    `${SAFETY_API}/api/v1/wallet/${address}/balances`, 2 * 60 * 1000
  )
  const raw = result?.data || []

  // Get prices via REST API (batched, concurrent)
  const addresses = raw.map(b => b.token_address)
  const prices = await getTokenPrices(addresses)

  // Deduplicate by token_address (API may return multiple entries for same token)
  const merged = new Map<string, WalletBalance>()
  for (const b of raw) {
    const addr = b.token_address.toLowerCase()
    const price = prices.get(addr) || null
    const existing = merged.get(addr)
    if (existing) {
      existing.balance += b.balance
      existing.value_usd = price != null ? existing.balance * price : null
    } else {
      merged.set(addr, {
        token_address: b.token_address,
        symbol: b.symbol,
        name: b.name,
        balance: b.balance,
        price_usd: price,
        value_usd: price != null ? b.balance * price : null,
      })
    }
  }
  return [...merged.values()]
}

// Smart Money
export async function getSmartMoneySwaps(minUsd = 1000, minutes = 360): Promise<SmartMoneySwap[]> {
  const result = await cachedFetch<{ data: SmartMoneySwap[]; count: number }>(
    `${SAFETY_API}/api/v1/smart-money/swaps?min_usd=${minUsd}&minutes=${minutes}`, 60 * 1000
  )
  return result?.data || []
}

// Bridge Monitor
export interface BridgeSnapshot {
  deposit_volume_24h: number
  withdrawal_volume_24h: number
  deposit_count_24h: number
  withdrawal_count_24h: number
  net_flow_24h: number
  tx_count_24h: number
  deposit_volume_7d: number
  withdrawal_volume_7d: number
  net_flow_7d: number
}

export async function getBridgeStats(): Promise<BridgeSnapshot> {
  const cached = cache.get('bridge_stats')
  if (cached && cached.expires > Date.now()) {
    return cached.data as BridgeSnapshot
  }

  const res = await fetch(`${SAFETY_API}/api/v1/bridge/stats`)
  if (!res.ok) throw new Error(`Bridge API error: ${res.status}`)
  let json: { data?: { date: string; deposit_count: number; withdrawal_count: number; deposit_volume_usd: number; withdrawal_volume_usd: number; net_flow_usd: number }[] }
  try { json = await res.json() } catch { throw new Error('Bridge API returned invalid JSON') }
  const rows: { date: string; deposit_count: number; withdrawal_count: number; deposit_volume_usd: number; withdrawal_volume_usd: number; net_flow_usd: number }[] = json.data || []

  // Today = first row (most recent), 7d = all rows
  const today = rows[0] || { deposit_count: 0, withdrawal_count: 0, deposit_volume_usd: 0, withdrawal_volume_usd: 0, net_flow_usd: 0 }
  const dep7d = rows.reduce((s, r) => s + (r.deposit_volume_usd || 0), 0)
  const wd7d = rows.reduce((s, r) => s + (r.withdrawal_volume_usd || 0), 0)

  const snapshot: BridgeSnapshot = {
    deposit_volume_24h: today.deposit_volume_usd || 0,
    withdrawal_volume_24h: today.withdrawal_volume_usd || 0,
    deposit_count_24h: today.deposit_count || 0,
    withdrawal_count_24h: today.withdrawal_count || 0,
    net_flow_24h: today.net_flow_usd || 0,
    tx_count_24h: (today.deposit_count || 0) + (today.withdrawal_count || 0),
    deposit_volume_7d: dep7d,
    withdrawal_volume_7d: wd7d,
    net_flow_7d: dep7d - wd7d,
  }

  cache.set('bridge_stats', { data: snapshot, expires: Date.now() + 5 * 60 * 1000 })
  return snapshot
}

// Hyperlane Bridge
export interface HyperlaneDaily {
  date: string
  inbound_count: number
  outbound_count: number
  inbound_volume_usd: number
  outbound_volume_usd: number
  net_flow_usd: number
  unique_users: number
  unique_chains: number
}

export interface HyperlaneChain {
  chain_name: string
  total_inbound_count: number
  total_outbound_count: number
  total_inbound_volume_usd: number
  total_outbound_volume_usd: number
  net_flow_usd: number
}

export interface HyperlaneStats {
  daily: HyperlaneDaily[]
  chains: HyperlaneChain[]
}

export async function getHyperlaneStats(): Promise<HyperlaneStats> {
  return cachedFetch(`${SAFETY_API}/api/v1/bridge/hyperlane`, 5 * 60 * 1000)
}

// Holder Leagues
export interface LeagueData {
  token_symbol: string
  token_address: string
  total_holders: number
  total_supply_human: number
  poseidon_count: number
  whale_count: number
  shark_count: number
  dolphin_count: number
  squid_count: number
  turtle_count: number
  updated_at: string
}

export interface HolderRankEntry {
  rank: number
  total_holders: number
  tier: string
  balance_pct: number
}

export interface HolderRankResult {
  address: string
  ranks: Record<string, HolderRankEntry>
}

export async function getHolderRank(address: string): Promise<HolderRankResult> {
  return cachedFetch(`${SAFETY_API}/api/v1/leagues/rank/${address}`, 10 * 60 * 1000)
}

export async function getHolderLeagues(): Promise<LeagueData[]> {
  const result = await cachedFetch<{ data: LeagueData[] }>(
    `${SAFETY_API}/api/v1/leagues`, 10 * 60 * 1000
  )
  return result?.data || []
}

// Token price history (for charts)
export interface PriceHistoryPoint {
  date: string
  price_usd: number
  daily_volume_usd: number
  total_liquidity_usd: number
}

export async function getTokenHistory(address: string, days = 30): Promise<PriceHistoryPoint[]> {
  const result = await cachedFetch<{ data: PriceHistoryPoint[] }>(
    `${REST_API}/api/v1/tokens/${address}/history?days=${days}`, 5 * 60 * 1000
  )
  return result?.data || []
}

// Research tweets (from database via safety API)
export interface ResearchTweet {
  id: string
  text: string
  author_username: string
  author_name: string
  tweet_url: string
  like_count: number
  retweet_count: number
  tweeted_at: string
}

export function clearCache() {
  cache.clear()
}

// Grade color helpers
export function gradeColor(grade: string): string {
  switch (grade) {
    case 'A': return '#10b981'
    case 'B': return '#22d3ee'
    case 'C': return '#f59e0b'
    case 'D': return '#f97316'
    case 'F': return '#ef4444'
    default: return '#6b7280'
  }
}
