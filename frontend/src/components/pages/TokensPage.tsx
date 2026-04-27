import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { X, Search, ChevronLeft, ChevronRight, ExternalLink, Info, ChevronDown, ChevronUp, ArrowUpDown, Filter, Users, Coins, Activity } from 'lucide-react'
import { ShareButton } from '../ui/ShareButton'
import { supabase } from '../../lib/supabase'
import { AreaChartComponent } from '../charts/AreaChart'
import { Spinner } from '../ui/Spinner'
import { TimeRangeSelector } from '../ui/TimeRangeSelector'
import { formatUsd } from '../../lib/format'
import { resolvePoolSymbol } from '../../lib/tokenSymbols'
import { Sparkline } from '../ui/Sparkline'
import type { LivePoolSummary } from '../../types'
import { useTranslation } from '../../i18n'
import { TokenLogo } from '../ui/TokenLogo'

// Ethereum fork copies on PulseChain — these have same symbol as native bridged versions
// but trade at massive discounts. Show a visual indicator to avoid confusion.
const ETH_FORK_ADDRESSES = new Set([
  // Stablecoins (Ethereum fork copies — NOT the real bridged versions)
  '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
  '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
  // DeFi majors
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', // WBTC
  '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9', // AAVE
  '0x514910771af9ca656af840dff83e8264ecf986ca', // LINK
  '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2', // MKR
  '0xc00e94cb662c3520282e6f5717214004a7f26888', // COMP
  '0xc011a747ee81f4a9b44e00b193a5ddf4b7d84ed0', // SNX
  '0xd533a949740bb3306d119cc777fa900ba034cd52', // CRV
  '0x5a98fcbea516cf06857215779fd812ca3bef1b32', // LDO
  '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', // UNI
  '0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0', // MATIC
  '0x6b3595068778dd592e39a122f4f5a5cf09c90fe2', // SUSHI
  // Memes
  '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce', // SHIB
  '0x6386704cd6f7a584ea9d23ccca66af7eba5a727e', // DOGE
  // Spam/old
  '0x5b218ed1428cfc1e488b777bdd473cf2647d30e3', // PLSX v2
])

// --- Token categories ---
type TokenCategory = 'Native' | 'DEX' | 'DeFi' | 'Stablecoin' | 'Meme' | 'Bridge' | 'Governance' | 'NFT' | 'Other'

const CATEGORY_COLORS: Record<TokenCategory, string> = {
  Native: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  DEX: 'bg-green-500/10 text-green-400 border-green-500/20',
  DeFi: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  Stablecoin: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  Meme: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  Bridge: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  Governance: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  NFT: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
  Other: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
}

// Curated category mapping for top tokens (lowercase address → category)
const TOKEN_CATEGORIES: Record<string, TokenCategory> = {
  // ── Native (core PulseChain / Richard Heart ecosystem) ──
  '0xa1077a294dde1b09bb078844df40758a5d0f9a27': 'Native',     // WPLS
  '0x2b591e99afe9f32eaa6214f7b7629768c40eeb39': 'Native',     // HEX
  '0x57fde0a71132198bbec939b98976993d8d89d225': 'Native',     // eHEX
  '0x95b303987a60c71504d99aa1b13b4da07b0790ab': 'Native',     // PLSX (PulseX)
  '0x2fa878ab3f87cc1c9737fc071108f904c0b0c95d': 'Native',     // INC (Incentive — PulseX buy & burn)
  '0xf6f8db0aba00007681f8faf16a0fda1c9b030b11': 'Native',     // PRVX
  '0x9159f1d2a9f51998fc9ab03fbd8f265ab14a1b3b': 'DeFi',       // LOAN
  '0x832396a5e87efd5e437a7134e25e3e2c05c963be': 'DeFi',       // MINT
  // ── Bridge (tokens bridged from Ethereum) ──
  '0x02dcdd04e3f455d838cd1249292c58f3b79e3c3c': 'Bridge',     // WETH (bridged)
  '0xb17d901469b9208b17d916112988a3fed19b5ca1': 'Bridge',     // WBTC (bridged)
  // ── Stablecoins ──
  '0x0cb6f5a34ad42ec934882a05265a7d5f59b51a2f': 'Stablecoin', // USDT (bridged)
  '0x15d38573d2feeb82e7ad5187ab8c1d52810b1f07': 'Stablecoin', // USDC (bridged)
  '0xefd766ccb38eaf1dfd701853bfce31359239f305': 'Stablecoin', // DAI (bridged)
  '0x0deed1486bc52aa0d3e6f8849cec5add6598a162': 'Stablecoin', // USDL
  '0xeb6b7932da20c6d7b3a899d5887d86dfb09a6408': 'Stablecoin', // PXDC
  '0x1fe0319440a672526916c232eaee4808254bdb00': 'Stablecoin', // HEXDC
  '0x144cd22aaa2a80fed0bb8b1deaddc51a53df1d50': 'Stablecoin', // INCD
  '0xa5b0d537cebe97f087dc5fe5732d70719caaec1d': 'Stablecoin', // hUSDC (Hyperlane)
  // ── DeFi ──
  '0x5ee84583f67d5ecea5420dbb42b462896e7f8d06': 'DeFi',       // PLSB (PulseBitcoin)
  '0x3819f64f282bf135d62168c1e513280daf905e06': 'DeFi',       // HEDRON
  '0xabf663531fa10ab8116cbf7d5c6229b018a26ff9': 'DeFi',       // HEDRON (from ETH)
  '0xfc4913214444af5c715cc9f7b52655e788a569ed': 'DeFi',       // ICSA (Icosa)
  '0x5a9780bfe63f3ec57f01b087cd65bd656c9034a8': 'DeFi',       // COM (Communis)
  '0xb513038bbfdf9d40b676f41606f4f61d4b02c4a2': 'DeFi',       // EARN
  '0xca35638a3fddd02fec597d8c1681198c06b23f58': 'DeFi',       // TIME
  '0x600136da8cc6d1ea07449514604dc4ab7098db82': 'Stablecoin', // CST (Coast)
  '0x96e035ae0905efac8f733f133462f971cfa45db1': 'DeFi',       // PHIAT
  '0x9663c2d75ffd5f4017310405fce61720af45b829': 'DEX',        // PHUX
  '0xdfdc2836fd2e63bba9f0ee07901ad465bff4de71': 'DeFi',       // WATT
  '0x7b39712ef45f7dced2bbdf11f3d5046ba61da719': 'DEX',        // 9MM
  '0xd6c31ba0754c4383a41c0e9df042c62b5e918f6d': 'Meme',       // TEDDY BEAR
  '0x9c6fa17d92898b684676993828143596894aa2a6': 'DeFi',       // FLEX
  '0xcfcffe432a48db53f59c301422d2edd77b2a88d7': 'DeFi',       // TEXAN
  // ── Meme ──
  '0x6982508145454ce325ddbe47a25d4ec3d2311933': 'Meme',       // PEPE (fork)
  '0x4d3aea379b7689e0cb722826c909fab39e54123d': 'Meme',       // PEPE (bridged from Ethereum)
  '0xa12e2661ec6603cbbb891072b2ad5b3d5edb48bd': 'Meme',       // PINU (PulseInu)
  '0xd7407bd3e6ad1baae0ba9eafd1ec41bfe63907b2': 'Meme',       // BEAN
}

function getTokenCategory(address: string, symbol: string, price_usd: number | null): TokenCategory {
  const addr = address.toLowerCase()
  if (TOKEN_CATEGORIES[addr]) return TOKEN_CATEGORIES[addr]
  // Auto-detection heuristics
  const sym = symbol.toUpperCase()
  // Fork tokens are NOT stablecoins even if price is near $1
  const isFork = ETH_FORK_ADDRESSES.has(addr)
  // Price-based stablecoin detection: $0.95-$1.05 range, excluding forks
  if (!isFork && price_usd && price_usd > 0.95 && price_usd < 1.05) return 'Stablecoin'
  if (['SWAP', 'DEX', 'LP'].some(m => sym.includes(m))) return 'DEX'
  // Most PulseChain tokens are meme/speculative — classify as Meme unless matched above
  // Known meme keywords + fallback: everything unclassified with a price is likely a meme coin
  if (['DOGE', 'SHIB', 'PEPE', 'FLOKI', 'BONK', 'WOJAK', 'MEME', 'CHAD', 'BASED',
       'MOON', 'BEAR', 'BULL', 'COCK', 'CAT', 'PULS', 'WHALE', 'TIGER', 'DRAGON',
       'BABY', 'KING', 'GOD', 'PUMP', 'ROCKET', 'APE', 'FROG', 'RICH', 'LAMBO',
       'ELON', 'TRUMP', 'BIDEN', 'JESUS', 'SATAN', 'DEVIL', 'ANGEL', 'DIAMOND',
       'GEM', 'GOLD', 'SILVER', 'PLUTO', 'MARS', 'SAFE', 'INU'].some(m => sym.includes(m))) return 'Meme'
  // Default: unclassified tokens with price are likely meme/speculative on PulseChain
  if (price_usd != null && price_usd > 0) return 'Meme'
  return 'Other'
}

// --- On-chain supply overrides (fixes inflated market_cap_usd for bridged/fork tokens) ---
// Aggregators often report global multi-chain supply instead of PulseChain-only supply.
// We call totalSupply() on-chain for these tokens to get the real PulseChain supply.
const RPC_URL = 'https://rpc.pulsechain.com'
const ONCHAIN_SUPPLY_TOKENS: Record<string, number> = {
  // Stablecoins (bridged)
  '0xefd766ccb38eaf1dfd701853bfce31359239f305': 18, // DAI
  '0x15d38573d2feeb82e7ad5187ab8c1d52810b1f07': 6,  // USDC
  '0x0cb6f5a34ad42ec934882a05265a7d5f59b51a2f': 6,  // USDT
  '0x0deed1486bc52aa0d3e6f8849cec5add6598a162': 18, // USDL
  '0xeb6b7932da20c6d7b3a899d5887d86dfb09a6408': 18, // PXDC
  '0x1fe0319440a672526916c232eaee4808254bdb00': 8,  // HEXDC
  '0x144cd22aaa2a80fed0bb8b1deaddc51a53df1d50': 18, // INCD
  '0xa5b0d537cebe97f087dc5fe5732d70719caaec1d': 6,  // hUSDC (Hyperlane)
  // HEX (forked from Ethereum — cached mcap uses global supply, 12.4x inflated)
  '0x2b591e99afe9f32eaa6214f7b7629768c40eeb39': 8,  // HEX
  // eHEX (bridged Ethereum HEX)
  '0x57fde0a71132198bbec939b98976993d8d89d225': 8,  // eHEX
}

async function fetchOnchainSupplies(): Promise<Map<string, number>> {
  const entries = Object.entries(ONCHAIN_SUPPLY_TOKENS)
  const results = await Promise.all(entries.map(async ([addr, decimals]) => {
    try {
      const resp = await fetch(RPC_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call',
          params: [{ to: addr, data: '0x18160ddd' }, 'latest'] }),
      })
      const data = await resp.json()
      if (!data.result || data.result === '0x') return [addr, 0] as const
      return [addr, Number(BigInt(data.result)) / Math.pow(10, decimals)] as const
    } catch { return [addr, 0] as const }
  }))
  return new Map(results)
}

// --- Interfaces ---
interface Token {
  address: string
  symbol: string
  name: string
  decimals: number
  total_volume_usd: number
  total_liquidity: number
  total_liquidity_usd: number | null
  is_active: boolean
  holder_count?: number | null
}

interface TokenWithPrice extends Token {
  price_usd: number | null
  price_change_24h_pct: number | null
  price_change_7d_pct: number | null
  volume_24h_usd: number | null
  market_cap_usd: number | null
  category: TokenCategory
}

interface PriceHistory {
  date: string
  price_usd: number
  daily_volume_usd: number
  total_liquidity_usd: number
}

type SortField = 'volume' | 'market_cap' | 'price' | 'change_24h' | 'change_7d' | 'liquidity'

const SORT_FIELDS: SortField[] = ['volume', 'market_cap', 'price', 'change_24h', 'change_7d', 'liquidity']

interface Filters {
  minLiquidity: number | null
  minMcap: number | null
  positiveChange: boolean
  hideEthForks: boolean
  hasPriceOnly: boolean
  category: TokenCategory | null
  safetyGrade: string | null  // 'safe' | 'moderate' | 'risky' | 'honeypot' | 'unanalyzed' | null
}

const DEFAULT_FILTERS: Filters = {
  minLiquidity: null,
  minMcap: null,
  positiveChange: false,
  hideEthForks: true,
  hasPriceOnly: true,
  category: null,
  safetyGrade: null,
}

const LIQUIDITY_PRESETS = [
  { value: null, label: 'Any' },
  { value: 1000, label: '$1K+' },
  { value: 10000, label: '$10K+' },
  { value: 100000, label: '$100K+' },
  { value: 1000000, label: '$1M+' },
]

const MCAP_PRESETS = [
  { value: null, label: 'Any' },
  { value: 10000, label: '$10K+' },
  { value: 100000, label: '$100K+' },
  { value: 1000000, label: '$1M+' },
  { value: 10000000, label: '$10M+' },
]

const ALL_CATEGORIES: TokenCategory[] = ['Native', 'DEX', 'DeFi', 'Stablecoin', 'Meme', 'Bridge', 'Governance', 'NFT', 'Other']

const PAGE_SIZE = 50

// Unicode subscript digits for DexScreener-style zero compression
const SUBSCRIPT_DIGITS = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉']
function toSubscript(n: number): string {
  return String(n).split('').map(d => SUBSCRIPT_DIGITS[parseInt(d)]).join('')
}

function formatPrice(price: number | null): string {
  if (price == null) return '--'
  if (price > 1e15) return '$∞'
  if (price >= 0.01) return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
  if (price === 0) return '$0'
  // Count leading zeros after "0." — e.g. 0.00001456 has 4 leading zeros
  const str = price.toFixed(20)
  const afterDot = str.split('.')[1] || ''
  let zeros = 0
  for (const c of afterDot) {
    if (c === '0') zeros++
    else break
  }
  if (zeros >= 3) {
    // DexScreener style: $0.0₁₀1456
    const significant = afterDot.slice(zeros, zeros + 4).replace(/0+$/, '')
    return `$0.0${toSubscript(zeros)}${significant || '0'}`
  }
  return `$${price.toFixed(6)}`
}

function formatChange(pct: number | null): { text: string; className: string } {
  if (pct == null) return { text: '--', className: 'text-gray-500' }
  if (Math.abs(pct) > 1e6) return { text: pct >= 0 ? '+∞%' : '-∞%', className: pct >= 0 ? 'text-emerald-400' : 'text-red-400' }
  const sign = pct >= 0 ? '+' : ''
  return {
    text: `${sign}${pct.toFixed(2)}%`,
    className: pct >= 0 ? 'text-emerald-400' : 'text-red-400',
  }
}

function formatCompact(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

interface PoolRow {
  token_address: string
  pair_address: string
  dex_id: string | null
  base_token_address: string | null
  base_token_symbol: string | null
  quote_token_address: string | null
  quote_token_symbol: string | null
  price_usd: number | null
  liquidity_usd: number | null
  liquidity_base: number | null
  liquidity_quote: number | null
  volume_24h_usd: number | null
  buys_24h: number | null
  sells_24h: number | null
  pool_is_legitimate: boolean
  pool_confidence: string | null
  pool_spam_reason: string | null
  tier: string
  dx_url: string | null
  price_change_24h: number | null
  updated_at: string
}

const DEX_NAMES: Record<string, string> = {
  pulsex: 'PulseX', '9mm': '9mm', '9inch': '9inch',
  'pulse-rate': 'Pulse Rate', dextop: 'DexTop', eazyswap: 'EazySwap',
}
function formatDexName(dex: string | null): string {
  if (!dex) return '--'
  return DEX_NAMES[dex] || dex.charAt(0).toUpperCase() + dex.slice(1)
}

const COLUMN_DESCRIPTIONS: Record<string, string> = {
  '#': 'Row number — pools are ranked by liquidity (highest first).',
  'DEX': 'The decentralized exchange where this liquidity pool is deployed (PulseX, 9mm, 9inch, etc.).',
  'Pair': 'The trading pair for this pool (e.g. HEX/WPLS). Click to open on DexScreener.',
  'Contract': 'The on-chain smart contract address of the liquidity pool. Click to view on PulseChain Explorer.',
  'Price': 'Current token price in USD as reported by this specific pool.',
  'Liquidity': 'Total value locked (TVL) in this pool in USD — sum of both sides of the pair.',
  'Volume 24h': 'Total trading volume through this pool in the last 24 hours in USD.',
  'Buys': 'Number of buy transactions in this pool over the last 24 hours.',
  'Sells': 'Number of sell transactions in this pool over the last 24 hours.',
  'Price Change 24h': 'Percentage price change over the last 24 hours. Green = up, red = down.',
  'Safety': 'Composite indicator: colored dot = pool confidence (green=high, yellow=medium, orange=low, red=suspect), letter = token safety grade (A-F). Click to view full safety report.',
  'DexScreener': 'External link to view this pool on DexScreener for detailed charts and analytics.',
}


function ClickableHeader({ label, className }: { label: string; className?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLTableCellElement>(null)
  const desc = COLUMN_DESCRIPTIONS[label]

  // Close on click outside
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Split description into paragraphs on sentence boundaries
  const paragraphs = desc ? desc.split(/\.(?:\s)/).map(s => s.endsWith('.') ? s : s + '.') : []

  return (
    <th
      ref={ref}
      className={`py-2 text-center relative select-none ${desc ? 'cursor-pointer hover:text-gray-300' : ''} ${className || ''}`}
      onClick={() => desc && setOpen(v => !v)}
    >
      {label}
      {open && desc && (
        <div className="absolute z-50 top-full left-1/2 -translate-x-1/2 mt-1 w-56 rounded-lg bg-gray-900 border border-white/10 p-3 text-left text-[11px] text-gray-300 font-normal shadow-xl whitespace-normal">
          {paragraphs.map((p, i) => (
            <p key={i} className={i > 0 ? 'mt-1.5' : ''}>{p}</p>
          ))}
        </div>
      )}
    </th>
  )
}

export function TokensPage() {
  const { t } = useTranslation()

  const sortLabel = (field: SortField): string => {
    const map: Record<SortField, string> = {
      volume: t.tokens.sort_volume,
      market_cap: t.tokens.sort_market_cap,
      price: t.tokens.sort_price,
      change_24h: t.tokens.sort_change_24h,
      change_7d: t.tokens.sort_change_7d,
      liquidity: t.tokens.sort_liquidity,
    }
    return map[field]
  }

  const categoryLabel = (cat: TokenCategory): string => {
    const map: Record<TokenCategory, string> = {
      Native: t.tokens.category_native,
      DEX: t.tokens.category_dex,
      DeFi: t.tokens.category_defi,
      Stablecoin: t.tokens.category_stablecoin,
      Meme: t.tokens.category_meme,
      Bridge: t.tokens.category_bridge,
      Governance: t.tokens.category_governance,
      NFT: t.tokens.category_nft,
      Other: t.tokens.category_other,
    }
    return map[cat]
  }

  const [tokens, setTokens] = useState<TokenWithPrice[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState<SortField>('volume')
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [showFilters, setShowFilters] = useState(false)
  const [selectedToken, setSelectedToken] = useState<TokenWithPrice | null>(null)
  const [history, setHistory] = useState<PriceHistory[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [priceRange, setPriceRange] = useState<number | null>(null)
  const [volRange, setVolRange] = useState<number | null>(null)
  const [showNote, setShowNote] = useState(false)
  const [sparkData, setSparkData] = useState<Record<string, number[]>>({})
  const [liveSummary, setLiveSummary] = useState<LivePoolSummary | null>(null)
  const [livePools, setLivePools] = useState<PoolRow[]>([])
  const [liveLoading, setLiveLoading] = useState(false)
  const [safetyScores, setSafetyScores] = useState<Record<string, { score: number; grade: string }>>({})
  const [tokenIntel, setTokenIntel] = useState<any>(null)
  const poolCacheRef = useRef<Map<string, { summary: LivePoolSummary | null; pools: PoolRow[] }>>(new Map())

  // Live price flash animation (same pattern as Overview)
  const prevPricesRef = useRef<Map<string, number>>(new Map())
  const [priceFlash, setPriceFlash] = useState<Map<string, 'up' | 'down'>>(new Map())
  const flashTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  // Popup price flash
  const prevPopupPriceRef = useRef<number | null>(null)
  const [popupPriceFlash, setPopupPriceFlash] = useState<'up' | 'down' | null>(null)
  const popupFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Pool prices flash in popup
  const prevPoolPricesRef = useRef<Map<string, number>>(new Map())
  const [poolPriceFlash, setPoolPriceFlash] = useState<Map<string, 'up' | 'down'>>(new Map())
  const poolFlashTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const activeFilterCount = useMemo(() => {
    let n = 0
    if (filters.minLiquidity) n++
    if (filters.minMcap) n++
    if (filters.positiveChange) n++
    if (filters.hideEthForks) n++
    if (filters.hasPriceOnly) n++
    if (filters.category) n++
    if (filters.safetyGrade) n++
    return n
  }, [filters])

  const fetchTokens = useCallback(async () => {
    setLoading(true)
    // Fetch on-chain supplies in background (non-blocking) — fixes inflated multi-chain mcap
    const onchainSupplyPromise = fetchOnchainSupplies().catch(() => new Map<string, number>())
    try {
      const from = page * PAGE_SIZE
      const to = from + PAGE_SIZE - 1

      // For sorts that use token_prices columns, query token_prices first
      const priceBasedSort = ['market_cap', 'price', 'change_24h'].includes(sortField)

      let tokenList: Token[] = []
      let totalCount = 0

      // Fast path: for FULLY curated categories, fetch by known addresses (no pagination needed)
      // Only for categories where ALL members are explicitly mapped (not heuristic-detected)
      const FULLY_CURATED: TokenCategory[] = ['Native', 'Bridge', 'Stablecoin']
      const curatedAddrs = (filters.category && FULLY_CURATED.includes(filters.category))
        ? Object.entries(TOKEN_CATEGORIES).filter(([, cat]) => cat === filters.category).map(([addr]) => addr)
        : []
      const isCuratedCategory = curatedAddrs.length > 0 && !search.trim()

      if (isCuratedCategory) {
        const { data: catTokens } = await supabase
          .from('pulsechain_tokens')
          .select('address, symbol, name, decimals, total_volume_usd, total_liquidity, total_liquidity_usd, is_active, holder_count')
          .in('address', curatedAddrs)
          .eq('is_active', true)
        tokenList = (catTokens || []) as Token[]
        totalCount = tokenList.length
      } else if (priceBasedSort && !search.trim()) {
        // Get ordered addresses from token_prices, then fetch only the page slice from pulsechain_tokens
        const priceOrderCol = sortField === 'market_cap' ? 'market_cap_usd'
          : sortField === 'price' ? 'price_usd'
          : 'price_change_24h_pct'

        const { data: priceRows } = await supabase
          .from('token_prices')
          .select('id')
          .eq('source', 'pulsex_subgraph_v1v2')
          .not(priceOrderCol, 'is', null)
          .order(priceOrderCol, { ascending: false })

        const priceAddresses = (priceRows || []).map(r => r.id)

        // Get total count
        const { count } = await supabase
          .from('pulsechain_tokens')
          .select('address', { count: 'exact', head: true })
          .eq('is_active', true)
        totalCount = count || 0

        // Slice to current page — tokens with prices come first, rest after
        const pageAddrs = priceAddresses.slice(from, to + 1)
        const needMore = PAGE_SIZE - pageAddrs.length

        if (pageAddrs.length > 0) {
          const { data: pageTokens } = await supabase
            .from('pulsechain_tokens')
            .select('address, symbol, name, decimals, total_volume_usd, total_liquidity, total_liquidity_usd, is_active, holder_count')
            .in('address', pageAddrs)
          const tokByAddr = new Map<string, Token>()
          for (const t of (pageTokens || [])) {
            tokByAddr.set(t.address.toLowerCase(), t as Token)
          }
          // Maintain price-based ordering
          for (const addr of pageAddrs) {
            const t = tokByAddr.get(addr)
            if (t) tokenList.push(t)
          }
        }

        // If page extends beyond priced tokens, fill with remaining tokens sorted by volume
        if (needMore > 0) {
          const skipNonPriced = Math.max(0, from - priceAddresses.length)
          const { data: rest } = await supabase
            .from('pulsechain_tokens')
            .select('address, symbol, name, decimals, total_volume_usd, total_liquidity, total_liquidity_usd, is_active, holder_count')
            .eq('is_active', true)
            .not('address', 'in', `(${priceAddresses.join(',')})`)
            .order('total_volume_usd', { ascending: false })
            .range(skipNonPriced, skipNonPriced + needMore - 1)
          tokenList.push(...((rest || []) as Token[]))
        }
      } else {
        let query = supabase
          .from('pulsechain_tokens')
          .select('address, symbol, name, decimals, total_volume_usd, total_liquidity, total_liquidity_usd, is_active, holder_count', { count: 'exact' })
          .eq('is_active', true)

        if (sortField === 'liquidity') {
          query = query.order('total_liquidity_usd', { ascending: false, nullsFirst: false })
        } else {
          query = query.order('total_volume_usd', { ascending: false })
        }

        if (search.trim()) {
          const s = search.trim()
          if (s.startsWith('0x')) {
            query = query.ilike('address', `${s}%`)
          } else {
            query = query.or(`symbol.ilike.%${s}%,name.ilike.%${s}%`)
          }
        }

        const { data: rows, count, error } = await query.range(from, to)
        if (error) throw error

        tokenList = (rows || []) as Token[]
        totalCount = count || 0
      }

      setTotal(totalCount)

      // Enrich with prices
      const addresses = tokenList.map(t => t.address.toLowerCase())
      let pricesMap: Record<string, { price_usd: number | null; price_change_24h_pct: number | null; volume_24h_usd: number | null; market_cap_usd: number | null }> = {}

      // Start DexScreener fetch in parallel (resolves stale cached prices for quoteTokens like DAI/USDC/USDT)
      let dexMap: Record<string, { price: number; change24h: number | null; volume: number; liquidity: number; mcap: number | null; bestLiq: number }> = {}
      const dexPromise = (async () => {
        if (addresses.length === 0) return
        try {
          const chunks: string[][] = []
          for (let i = 0; i < addresses.length; i += 30) chunks.push(addresses.slice(i, i + 30))
          const allPairs: any[] = []
          await Promise.all(chunks.map(async (chunk) => {
            try {
              const res = await fetch(`https://api.dexscreener.com/tokens/v1/pulsechain/${chunk.join(',')}`, { cache: 'no-store' })
              if (!res.ok) return
              const pairs = await res.json()
              if (Array.isArray(pairs)) allPairs.push(...pairs)
            } catch { /* skip */ }
          }))
          for (const p of allPairs) {
            if (p.chainId !== 'pulsechain') continue
            const baseAddr = p.baseToken?.address?.toLowerCase()
            const quoteAddr = p.quoteToken?.address?.toLowerCase()
            const basePrice = p.priceUsd ? parseFloat(p.priceUsd) : null
            const liq = p.liquidity?.usd ?? 0
            const vol = p.volume?.h24 ?? 0
            const priceNative = p.priceNative ? parseFloat(p.priceNative) : null
            // baseToken match — use price from highest-liquidity pool
            if (baseAddr && addresses.includes(baseAddr) && basePrice && basePrice > 0 && basePrice < 1e15) {
              const prev = dexMap[baseAddr]
              if (!prev || liq > prev.bestLiq) {
                dexMap[baseAddr] = {
                  price: basePrice,
                  change24h: p.priceChange?.h24 != null ? parseFloat(p.priceChange.h24) : (prev?.change24h ?? null),
                  volume: (prev?.volume ?? 0) + vol,
                  liquidity: (prev?.liquidity ?? 0) + liq,
                  mcap: p.marketCap ?? p.fdv ?? (prev?.mcap ?? null),
                  bestLiq: liq,
                }
              } else if (prev) {
                prev.volume += vol
                prev.liquidity += liq
              }
            }
            // quoteToken match (e.g. DAI, USDC, USDT) — derive price with sanity bounds
            if (quoteAddr && addresses.includes(quoteAddr) && basePrice && priceNative && priceNative > 1e-12) {
              const quotePrice = basePrice / priceNative
              // Sanity: reject absurd derived prices (e.g. rounding artifacts)
              if (quotePrice > 1e-10 && quotePrice < 1e10) {
                const prev = dexMap[quoteAddr]
                if (!prev || liq > prev.bestLiq) {
                  dexMap[quoteAddr] = {
                    price: quotePrice,
                    change24h: prev?.change24h ?? null,
                    volume: (prev?.volume ?? 0) + vol,
                    liquidity: (prev?.liquidity ?? 0) + liq,
                    mcap: prev?.mcap ?? null,
                    bestLiq: liq,
                  }
                } else if (prev) {
                  prev.volume += vol
                  prev.liquidity += liq
                }
              }
            }
          }
        } catch { /* keep empty dexMap */ }
      })()

      if (addresses.length > 0) {
        const { data: prices } = await supabase
          .from('token_prices')
          .select('id, price_usd, price_change_24h_pct, volume_24h_usd, market_cap_usd')
          .in('id', addresses)
        for (const p of (prices || [])) {
          pricesMap[p.id] = { price_usd: p.price_usd, price_change_24h_pct: p.price_change_24h_pct, volume_24h_usd: p.volume_24h_usd, market_cap_usd: p.market_cap_usd }
        }
      }

      // Overlay with DexScreener live data when available (more accurate: all DEXes, not just PulseX subgraph)
      let liveMap: Record<string, { price_usd: number | null; price_change_24h: number | null; total_volume_24h_usd: number | null; total_liquidity_usd: number | null; market_cap_usd: number | null }> = {}
      if (addresses.length > 0) {
        const { data: liveRows } = await supabase
          .from('token_live_summary')
          .select('token_address, price_usd, price_change_24h, total_volume_24h_usd, total_liquidity_usd, market_cap_usd')
          .in('token_address', addresses)
        for (const r of (liveRows || [])) {
          liveMap[r.token_address] = r
        }
      }

      // Wait for DexScreener to finish (started in parallel with database queries)
      await dexPromise

      // Fetch 7d price history for change calculation + sparklines
      let change7dMap: Record<string, number> = {}
      let sparkMap: Record<string, number[]> = {}
      if (addresses.length > 0) {
        const eightDaysAgo = new Date()
        eightDaysAgo.setDate(eightDaysAgo.getDate() - 8)

        const { data: histRows } = await supabase
          .from('token_price_history')
          .select('address, date, price_usd')
          .in('address', addresses)
          .gte('date', eightDaysAgo.toISOString().slice(0, 10))
          .order('date', { ascending: true })

        // Collect raw prices per address
        const rawPrices: Record<string, number[]> = {}
        for (const row of (histRows || [])) {
          const addr = row.address.toLowerCase()
          const price = row.price_usd
          if (!price || price <= 0 || price > 1e15) continue
          if (!rawPrices[addr]) rawPrices[addr] = []
          rawPrices[addr].push(price)
        }

        // Filter outliers per token, build sparkMap and 7d change
        for (const addr of Object.keys(rawPrices)) {
          const prices = rawPrices[addr]
          if (prices.length < 2) { sparkMap[addr] = prices; continue }
          // Compute median to filter outliers (>1000x deviation)
          const sorted = [...prices].sort((a, b) => a - b)
          const median = sorted[Math.floor(sorted.length / 2)]
          sparkMap[addr] = prices.filter(p => p / median < 1000 && median / p < 1000)
        }

        for (const addr of Object.keys(sparkMap)) {
          const filtered = sparkMap[addr]
          if (filtered.length < 2) continue
          const oldest = filtered[0]
          const currentPrice = dexMap[addr]?.price ?? liveMap[addr]?.price_usd ?? pricesMap[addr]?.price_usd
          if (oldest > 0 && currentPrice && currentPrice > 0) {
            change7dMap[addr] = ((currentPrice - oldest) / oldest) * 100
          }
        }
      }
      setSparkData(sparkMap)

      // Fetch safety scores for badge display
      if (addresses.length > 0) {
        supabase
          .from('token_safety_scores')
          .select('token_address, score, grade')
          .in('token_address', addresses)
          .then(({ data: safetyRows }) => {
            if (safetyRows && safetyRows.length > 0) {
              const map: Record<string, { score: number; grade: string }> = {}
              for (const r of safetyRows) map[r.token_address] = { score: r.score, grade: r.grade }
              setSafetyScores(prev => ({ ...prev, ...map }))
            }
          })
      }

      let enriched: TokenWithPrice[] = tokenList.map(t => {
        const addr = t.address.toLowerCase()
        const live = liveMap[addr]
        const dex = dexMap[addr]
        // DexScreener > token_live_summary > token_prices (priority order)
        const price = dex?.price ?? live?.price_usd ?? pricesMap[addr]?.price_usd ?? null
        return {
          ...t,
          price_usd: price,
          price_change_24h_pct: dex?.change24h ?? live?.price_change_24h ?? pricesMap[addr]?.price_change_24h_pct ?? null,
          price_change_7d_pct: change7dMap[addr] ?? null,
          volume_24h_usd: (dex?.volume && dex.volume > 0 ? dex.volume : null) ?? live?.total_volume_24h_usd ?? pricesMap[addr]?.volume_24h_usd ?? null,
          market_cap_usd: dex?.mcap ?? live?.market_cap_usd ?? pricesMap[addr]?.market_cap_usd ?? null,
          total_liquidity_usd: (dex?.liquidity && dex.liquidity > 0 ? dex.liquidity : null) ?? live?.total_liquidity_usd ?? t.total_liquidity_usd,
          category: getTokenCategory(t.address, t.symbol, price),
        }
      })

      // Override market cap with on-chain totalSupply × price (stablecoins + HEX + bridged tokens)
      const onchainSupplies = await onchainSupplyPromise
      for (const t of enriched) {
        const supply = onchainSupplies.get(t.address.toLowerCase())
        if (supply && supply > 0 && t.price_usd) {
          t.market_cap_usd = supply * t.price_usd
        }
      }

      // Client-side re-sort after DexScreener enrichment to ensure displayed order matches displayed values
      const sortFns: Record<SortField, (a: TokenWithPrice, b: TokenWithPrice) => number> = {
        market_cap: (a, b) => (b.market_cap_usd ?? -1) - (a.market_cap_usd ?? -1),
        price: (a, b) => (b.price_usd ?? -1) - (a.price_usd ?? -1),
        change_24h: (a, b) => (b.price_change_24h_pct ?? -Infinity) - (a.price_change_24h_pct ?? -Infinity),
        change_7d: (a, b) => (b.price_change_7d_pct ?? -Infinity) - (a.price_change_7d_pct ?? -Infinity),
        volume: (a, b) => (b.volume_24h_usd ?? -1) - (a.volume_24h_usd ?? -1),
        liquidity: (a, b) => (b.total_liquidity_usd ?? -1) - (a.total_liquidity_usd ?? -1),
      }
      enriched.sort(sortFns[sortField])

      // Apply client-side filters
      enriched = enriched.filter(t => {
        if (filters.hideEthForks && ETH_FORK_ADDRESSES.has(t.address.toLowerCase())) return false
        if (filters.hasPriceOnly && t.price_usd == null) return false
        if (filters.positiveChange && (t.price_change_24h_pct == null || t.price_change_24h_pct <= 0)) return false
        if (filters.minLiquidity) {
          const liqUsd = t.total_liquidity_usd ?? ((t.price_usd && t.total_liquidity > 0) ? t.total_liquidity * t.price_usd : 0)
          if (liqUsd < filters.minLiquidity) return false
        }
        if (filters.minMcap) {
          if (!t.market_cap_usd || t.market_cap_usd < filters.minMcap) return false
        }
        if (filters.category && t.category !== filters.category) return false
        if (filters.safetyGrade) {
          const ss = safetyScores[t.address.toLowerCase()]
          switch (filters.safetyGrade) {
            case 'safe': if (!ss || !['A', 'B'].includes(ss.grade)) return false; break
            case 'moderate': if (!ss || ss.grade !== 'C') return false; break
            case 'risky': if (!ss || !['D', 'F'].includes(ss.grade)) return false; break
            case 'honeypot': if (!ss || ss.grade !== 'F' || ss.score > 15) return false; break
            case 'unanalyzed': if (ss) return false; break
          }
        }
        return true
      })

      setTokens(enriched)
    } catch (e) {
      console.error('Failed to fetch tokens:', e)
    } finally {
      setLoading(false)
    }
  }, [page, search, sortField, filters])

  useEffect(() => {
    fetchTokens()
  }, [fetchTokens])

  // Background preload LP data for all tokens on the current page
  useEffect(() => {
    if (tokens.length === 0) return
    const cache = poolCacheRef.current
    const uncached = tokens.filter(t => !cache.has(t.address.toLowerCase()))
    if (uncached.length === 0) return

    const addresses = uncached.map(t => t.address.toLowerCase())
    const controller = new AbortController()

    ;(async () => {
      try {
        // Batch fetch all summaries + pools for current page in 2 queries
        const [summaryRes, poolsRes] = await Promise.all([
          supabase.from('token_live_summary').select('*').in('token_address', addresses),
          supabase.from('token_pools_live').select('*').in('token_address', addresses).order('liquidity_usd', { ascending: false, nullsFirst: false }),
        ])
        if (controller.signal.aborted) return

        const summaryMap = new Map<string, LivePoolSummary>()
        for (const s of (summaryRes.data ?? [])) {
          summaryMap.set(s.token_address, s as LivePoolSummary)
        }

        const poolsMap = new Map<string, PoolRow[]>()
        for (const p of (poolsRes.data ?? []) as PoolRow[]) {
          const addr = (p as any).token_address as string
          if (!poolsMap.has(addr)) poolsMap.set(addr, [])
          poolsMap.get(addr)!.push(p)
        }

        for (const addr of addresses) {
          cache.set(addr, {
            summary: summaryMap.get(addr) ?? null,
            pools: poolsMap.get(addr) ?? [],
          })
        }
      } catch (e) {
        console.error('LP preload failed:', e)
      }
    })()

    return () => controller.abort()
  }, [tokens])

  // Reset page on search/sort/filter change
  useEffect(() => {
    setPage(0)
  }, [search, sortField, filters])

  // ─── Live price polling (10s) via DexScreener API (real-time, not cached) ───
  const tokenAddrsRef = useRef<string[]>([])
  useEffect(() => {
    tokenAddrsRef.current = tokens.map(t => t.address.toLowerCase())
  }, [tokens])

  useEffect(() => {
    if (tokens.length === 0) return
    const addresses = tokens.map(t => t.address.toLowerCase())

    const pollPrices = async () => {
      try {
        // DexScreener batch endpoint: max 30 addresses per request
        const chunks: string[][] = []
        for (let i = 0; i < addresses.length; i += 30) {
          chunks.push(addresses.slice(i, i + 30))
        }

        const allPairs: any[] = []
        await Promise.all(chunks.map(async (chunk) => {
          try {
            const res = await fetch(`https://api.dexscreener.com/tokens/v1/pulsechain/${chunk.join(',')}`, { cache: 'no-store' })
            if (!res.ok) return
            const pairs = await res.json()
            if (Array.isArray(pairs)) allPairs.push(...pairs)
          } catch { /* skip failed chunk */ }
        }))

        if (allPairs.length === 0) return

        // Aggregate: best price by liquidity per token, sum volume/liquidity
        // Handles both baseToken and quoteToken positions (e.g. DAI is always quoteToken)
        const priceMap: Record<string, { price: number; change24h: number | null; volume: number; liquidity: number; mcap: number | null; bestLiq: number }> = {}
        for (const p of allPairs) {
          if (p.chainId !== 'pulsechain') continue
          const baseAddr = p.baseToken?.address?.toLowerCase()
          const quoteAddr = p.quoteToken?.address?.toLowerCase()
          const basePrice = p.priceUsd ? parseFloat(p.priceUsd) : null
          const liq = p.liquidity?.usd ?? 0
          const vol = p.volume?.h24 ?? 0
          const priceNative = p.priceNative ? parseFloat(p.priceNative) : null

          // Match as baseToken (direct price) — use highest-liquidity pool
          if (baseAddr && addresses.includes(baseAddr) && basePrice && basePrice > 0 && basePrice < 1e15) {
            const prev = priceMap[baseAddr]
            if (!prev) {
              priceMap[baseAddr] = {
                price: basePrice,
                change24h: p.priceChange?.h24 != null ? parseFloat(p.priceChange.h24) : null,
                volume: vol, liquidity: liq,
                mcap: p.marketCap ?? p.fdv ?? null,
                bestLiq: liq,
              }
            } else {
              prev.volume += vol
              prev.liquidity += liq
              if (liq > prev.bestLiq) {
                prev.price = basePrice
                prev.change24h = p.priceChange?.h24 != null ? parseFloat(p.priceChange.h24) : prev.change24h
                prev.mcap = p.marketCap ?? p.fdv ?? prev.mcap
                prev.bestLiq = liq
              }
            }
          }

          // Match as quoteToken — derive price with sanity bounds
          if (quoteAddr && addresses.includes(quoteAddr) && basePrice && priceNative && priceNative > 1e-12) {
            const quotePrice = basePrice / priceNative
            if (quotePrice > 1e-10 && quotePrice < 1e10) {
              const prev = priceMap[quoteAddr]
              if (!prev) {
                priceMap[quoteAddr] = {
                  price: quotePrice,
                  change24h: null,
                  volume: vol, liquidity: liq,
                  mcap: null,
                  bestLiq: liq,
                }
              } else {
                prev.volume += vol
                prev.liquidity += liq
                if (liq > prev.bestLiq) {
                  prev.price = quotePrice
                  prev.bestLiq = liq
                }
              }
            }
          }
        }

        if (Object.keys(priceMap).length === 0) return

        setTokens(prev => prev.map(t => {
          const live = priceMap[t.address.toLowerCase()]
          if (!live) return t
          return {
            ...t,
            price_usd: live.price,
            price_change_24h_pct: live.change24h ?? t.price_change_24h_pct,
            volume_24h_usd: live.volume > 0 ? live.volume : t.volume_24h_usd,
            market_cap_usd: live.mcap ?? t.market_cap_usd,
            total_liquidity_usd: live.liquidity > 0 ? live.liquidity : t.total_liquidity_usd,
          }
        }))
      } catch {
        // Silently fail — keep previous data
      }
    }

    pollPrices() // Immediate first poll — correct stale cached prices
    const timer = setInterval(pollPrices, 10_000)
    return () => clearInterval(timer)
  }, [tokens.length, page]) // re-bind when page changes

  // ─── Flash detection for table prices ───
  useEffect(() => {
    const newFlashes = new Map<string, 'up' | 'down'>()
    for (const token of tokens) {
      if (token.price_usd == null) continue
      const addr = token.address.toLowerCase()
      const prev = prevPricesRef.current.get(addr)
      if (prev != null && token.price_usd !== prev) {
        const dir = token.price_usd > prev ? 'up' : 'down'
        newFlashes.set(addr, dir)
        const existing = flashTimers.current.get(addr)
        if (existing) clearTimeout(existing)
        flashTimers.current.set(addr, setTimeout(() => {
          setPriceFlash(prev => {
            const next = new Map(prev)
            next.delete(addr)
            return next
          })
          flashTimers.current.delete(addr)
        }, 3000))
      }
      prevPricesRef.current.set(addr, token.price_usd)
    }
    if (newFlashes.size > 0) {
      setPriceFlash(prev => {
        const next = new Map(prev)
        for (const [k, v] of newFlashes) next.set(k, v)
        return next
      })
    }
  }, [tokens])

  // Fetch DexScreener data for a single token and update liveSummary + livePools
  const fetchDexScreenerForToken = useCallback(async (addr: string) => {
    try {
      const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${addr}`, { cache: 'no-store' })
      if (!res.ok) return
      const json = await res.json()
      const pairs = (json.pairs || []).filter((p: any) => p.chainId === 'pulsechain')
      if (pairs.length === 0) return

      pairs.sort((a: any, b: any) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))
      const best = pairs[0]
      let bestPrice: number | null = null
      if (best.baseToken?.address?.toLowerCase() === addr) {
        bestPrice = best.priceUsd ? parseFloat(best.priceUsd) : null
      } else if (best.quoteToken?.address?.toLowerCase() === addr && best.priceUsd && best.priceNative) {
        bestPrice = parseFloat(best.priceUsd) / parseFloat(best.priceNative)
      }

      if (bestPrice && bestPrice > 0) {
        const totalVolume = pairs.reduce((s: number, p: any) => s + (p.volume?.h24 ?? 0), 0)
        const totalLiquidity = pairs.reduce((s: number, p: any) => s + (p.liquidity?.usd ?? 0), 0)
        setLiveSummary(prev => {
          const base = prev ?? {} as any
          return {
            ...base,
            price_usd: bestPrice,
            price_change_24h: best.priceChange?.h24 != null ? parseFloat(best.priceChange.h24) : (base.price_change_24h ?? null),
            total_volume_24h_usd: totalVolume > 0 ? totalVolume : (base.total_volume_24h_usd ?? null),
            total_liquidity_usd: totalLiquidity > 0 ? totalLiquidity : (base.total_liquidity_usd ?? null),
            market_cap_usd: best.marketCap ?? best.fdv ?? (base.market_cap_usd ?? null),
          }
        })
      }

      setLivePools(prev => prev.map(pool => {
        const match = pairs.find((p: any) => p.pairAddress?.toLowerCase() === pool.pair_address?.toLowerCase())
        if (!match) return pool
        const poolPrice = match.priceUsd ? parseFloat(match.priceUsd) : null
        if (!poolPrice || poolPrice <= 0) return pool
        return {
          ...pool,
          price_usd: poolPrice,
          volume_24h_usd: match.volume?.h24 ?? pool.volume_24h_usd,
          liquidity_usd: match.liquidity?.usd ?? pool.liquidity_usd,
          buys_24h: match.txns?.h24?.buys ?? pool.buys_24h,
          sells_24h: match.txns?.h24?.sells ?? pool.sells_24h,
          price_change_24h: match.priceChange?.h24 != null ? parseFloat(match.priceChange.h24) : pool.price_change_24h,
        }
      }))
    } catch { /* keep previous data */ }
  }, [])

  // ─── Live polling for popup (selected token) via DexScreener — every 10s ───
  useEffect(() => {
    if (!selectedToken) {
      prevPopupPriceRef.current = null
      prevPoolPricesRef.current.clear()
      return
    }
    const addr = selectedToken.address.toLowerCase()
    const timer = setInterval(() => fetchDexScreenerForToken(addr), 10_000)
    return () => clearInterval(timer)
  }, [selectedToken?.address, fetchDexScreenerForToken])

  // ─── Flash detection for popup header price ───
  useEffect(() => {
    const currentPrice = liveSummary?.price_usd ?? selectedToken?.price_usd
    if (currentPrice == null) return
    const prev = prevPopupPriceRef.current
    if (prev != null && currentPrice !== prev) {
      const dir = currentPrice > prev ? 'up' : 'down'
      setPopupPriceFlash(dir)
      if (popupFlashTimer.current) clearTimeout(popupFlashTimer.current)
      popupFlashTimer.current = setTimeout(() => setPopupPriceFlash(null), 3000)
    }
    prevPopupPriceRef.current = currentPrice
  }, [liveSummary?.price_usd, selectedToken?.price_usd])

  // ─── Flash detection for popup pool prices ───
  useEffect(() => {
    const newFlashes = new Map<string, 'up' | 'down'>()
    for (const pool of livePools) {
      if (pool.price_usd == null) continue
      const key = pool.pair_address
      const prev = prevPoolPricesRef.current.get(key)
      if (prev != null && pool.price_usd !== prev) {
        const dir = pool.price_usd > prev ? 'up' : 'down'
        newFlashes.set(key, dir)
        const existing = poolFlashTimers.current.get(key)
        if (existing) clearTimeout(existing)
        poolFlashTimers.current.set(key, setTimeout(() => {
          setPoolPriceFlash(prev => {
            const next = new Map(prev)
            next.delete(key)
            return next
          })
          poolFlashTimers.current.delete(key)
        }, 3000))
      }
      prevPoolPricesRef.current.set(key, pool.price_usd)
    }
    if (newFlashes.size > 0) {
      setPoolPriceFlash(prev => {
        const next = new Map(prev)
        for (const [k, v] of newFlashes) next.set(k, v)
        return next
      })
    }
  }, [livePools])

  const fetchHistory = useCallback(async (address: string) => {
    setHistoryLoading(true)
    try {
      const { data, error } = await supabase
        .from('token_price_history')
        .select('date, price_usd, daily_volume_usd, total_liquidity_usd')
        .eq('address', address.toLowerCase())
        .order('date', { ascending: true })
        .limit(1000)
      if (error) throw error

      // Filter out outliers: reject prices that deviate >1000x from the median
      let rows = (data || []) as PriceHistory[]
      if (rows.length >= 3) {
        const validPrices = rows.map(r => r.price_usd).filter(p => p > 0 && p < 1e15).sort((a, b) => a - b)
        if (validPrices.length >= 3) {
          const median = validPrices[Math.floor(validPrices.length / 2)]
          rows = rows.filter(r => {
            if (!r.price_usd || r.price_usd <= 0) return false
            return r.price_usd / median < 1000 && median / r.price_usd < 1000
          })
        }
      }
      setHistory(rows)
    } catch {
      setHistory([])
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  const handleSelectToken = async (token: TokenWithPrice) => {
    setSelectedToken(token)
    setPriceRange(null)
    setVolRange(null)
    fetchHistory(token.address)

    const addr = token.address.toLowerCase()
    const cached = poolCacheRef.current.get(addr)

    if (cached) {
      // Instant open from preloaded cache
      setLiveSummary(cached.summary)
      setLivePools(cached.pools)
      setLiveLoading(false)
    } else {
      // Fallback: fetch on demand (token not yet preloaded)
      setLiveSummary(null)
      setLivePools([])
      setLiveLoading(true)
      try {
        const [summaryRes, poolsRes] = await Promise.all([
          supabase.from('token_live_summary').select('*').eq('token_address', addr).limit(1),
          supabase.from('token_pools_live').select('*').eq('token_address', addr).order('liquidity_usd', { ascending: false, nullsFirst: false }),
        ])
        const summary = summaryRes.data?.[0] ?? null
        const pools = (poolsRes.data ?? []) as PoolRow[]
        setLiveSummary(summary)
        setLivePools(pools)
        poolCacheRef.current.set(addr, { summary: summary as LivePoolSummary | null, pools })
      } catch (e) {
        console.error('Failed to fetch live data:', e)
      } finally {
        setLiveLoading(false)
      }
    }

    // Immediately correct prices via DexScreener (fixes stale cached quoteToken prices)
    fetchDexScreenerForToken(addr)

    // Fetch token intelligence data
    supabase
      .from('token_intelligence')
      .select('social_timeline, project_summary')
      .eq('token_address', addr)
      .maybeSingle()
      .then(({ data }) => setTokenIntel(data))
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  const closeModal = useCallback(() => {
    setSelectedToken(null)
    setHistory([])
    setLiveSummary(null)
    setLivePools([])
    setTokenIntel(null)
  }, [])

  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!selectedToken) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [selectedToken, closeModal])

  useEffect(() => {
    if (selectedToken) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [selectedToken])

  // Sync selectedToken with live table data (so popup price updates when table polls DexScreener)
  useEffect(() => {
    if (!selectedToken) return
    const updated = tokens.find(t => t.address.toLowerCase() === selectedToken.address.toLowerCase())
    if (updated && updated.price_usd != null && updated.price_usd !== selectedToken.price_usd) {
      setSelectedToken(prev => prev ? { ...prev, price_usd: updated.price_usd, price_change_24h_pct: updated.price_change_24h_pct, volume_24h_usd: updated.volume_24h_usd, market_cap_usd: updated.market_cap_usd, total_liquidity_usd: updated.total_liquidity_usd } : prev)
    }
  }, [tokens, selectedToken?.address])

  const selectedSupply = useMemo(() => {
    if (!selectedToken?.market_cap_usd || !selectedToken?.price_usd || selectedToken.price_usd <= 0) return null
    return selectedToken.market_cap_usd / selectedToken.price_usd
  }, [selectedToken])

  const chartHistory = useMemo(() => {
    if (!history.length) return history
    // Use DexScreener-corrected price from selectedToken (reliable) over liveSummary (may be stale cached data)
    const livePrice = liveSummary?.price_usd ?? selectedToken?.price_usd
    if (!livePrice) return history
    // Sanity check: reject if price ratio vs last historical is absurd (data corruption)
    const lastHistPrice = history[history.length - 1]?.price_usd
    const isStable = selectedToken?.category === 'Stablecoin'
    const maxRatio = isStable ? 1.5 : 100 // Stablecoins: 50% deviation max; others: 100x
    if (lastHistPrice && lastHistPrice > 0 && (livePrice / lastHistPrice > maxRatio || lastHistPrice / livePrice > maxRatio)) return history
    const today = new Date().toISOString().slice(0, 10)
    const lastDate = history[history.length - 1]?.date
    if (lastDate === today) return history
    return [...history, {
      date: today,
      price_usd: livePrice,
      daily_volume_usd: liveSummary?.total_volume_24h_usd ?? 0,
      total_liquidity_usd: liveSummary?.total_liquidity_usd ?? 0,
    }]
  }, [history, liveSummary, selectedToken?.price_usd])

  return (
    <div className="space-y-6">
      {/* Hero header */}
      <div className="rounded-2xl border border-white/5 bg-gradient-to-br from-purple-500/5 via-blue-500/5 to-cyan-500/5 backdrop-blur-sm p-5 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-xl bg-purple-400/10 border border-purple-400/20">
                <Coins className="h-6 w-6 text-purple-400" />
              </div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-300 to-cyan-400 bg-clip-text text-transparent">
                {t.tokens.title}
              </h1>
              <ShareButton title={t.tokens.title} text={t.tokens.subtitle.replace('{count}', total.toLocaleString('en-US'))} />
            </div>
            <p className="text-gray-400 max-w-xl text-sm">
              {t.tokens.subtitle.replace('{count}', total.toLocaleString('en-US'))}
            </p>
          </div>
          {total > 0 && (
            <div className="flex flex-wrap gap-3">
              <div className="text-center px-4 py-2 rounded-xl bg-white/[0.03] border border-white/5">
                <div className="text-lg font-bold text-white">{total.toLocaleString('en-US')}</div>
                <div className="text-[10px] text-gray-500 uppercase tracking-wider">{t.common.tokens}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-end flex-wrap gap-3">
        {/* Sort selector */}
        <div className="flex items-center gap-1.5">
          <ArrowUpDown className="h-3.5 w-3.5 text-gray-500" />
          <select
            value={sortField}
            onChange={(e) => setSortField(e.target.value as SortField)}
            className="bg-gray-900/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00D4FF]/50"
          >
            {SORT_FIELDS.map(field => (
              <option key={field} value={field}>{sortLabel(field)}</option>
            ))}
          </select>
        </div>

        {/* Filter toggle */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm transition-colors ${
            activeFilterCount > 0
              ? 'border-[#00D4FF]/50 text-[#00D4FF] bg-[#00D4FF]/5'
              : 'border-white/10 text-gray-400 hover:bg-white/5'
          }`}
        >
          <Filter className="h-3.5 w-3.5" />
          {t.tokens.filters_label}{activeFilterCount > 0 && ` (${activeFilterCount})`}
        </button>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.tokens.search_placeholder}
            className="bg-gray-900/60 border border-white/10 rounded-lg pl-10 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#00D4FF]/50 w-72"
          />
        </div>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="rounded-xl border border-white/5 bg-gray-900/40 backdrop-blur-sm p-4 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-white">{t.tokens.filters_label}</span>
            {activeFilterCount > 0 && (
              <button
                onClick={() => setFilters(DEFAULT_FILTERS)}
                className="text-xs text-gray-400 hover:text-white transition-colors"
              >
                {t.tokens.reset_all}
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {/* Min Liquidity */}
            <div>
              <label className="text-xs text-gray-500 mb-1 block">{t.tokens.min_liquidity}</label>
              <select
                value={filters.minLiquidity ?? ''}
                onChange={(e) => setFilters(f => ({ ...f, minLiquidity: e.target.value ? Number(e.target.value) : null }))}
                className="w-full bg-gray-900/60 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#00D4FF]/50"
              >
                {LIQUIDITY_PRESETS.map(p => (
                  <option key={p.label} value={p.value ?? ''}>{p.label}</option>
                ))}
              </select>
            </div>

            {/* Min Market Cap */}
            <div>
              <label className="text-xs text-gray-500 mb-1 block">{t.tokens.min_market_cap}</label>
              <select
                value={filters.minMcap ?? ''}
                onChange={(e) => setFilters(f => ({ ...f, minMcap: e.target.value ? Number(e.target.value) : null }))}
                className="w-full bg-gray-900/60 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#00D4FF]/50"
              >
                {MCAP_PRESETS.map(p => (
                  <option key={p.label} value={p.value ?? ''}>{p.label}</option>
                ))}
              </select>
            </div>

            {/* Category */}
            <div>
              <label className="text-xs text-gray-500 mb-1 block">{t.tokens.by_category}</label>
              <select
                value={filters.category ?? ''}
                onChange={(e) => setFilters(f => ({ ...f, category: (e.target.value || null) as TokenCategory | null }))}
                className="w-full bg-gray-900/60 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#00D4FF]/50"
              >
                <option value="">{t.tokens.filter_all}</option>
                {ALL_CATEGORIES.map(c => (
                  <option key={c} value={c}>{categoryLabel(c)}</option>
                ))}
              </select>
            </div>

            {/* Safety Grade */}
            <div>
              <label className="text-xs text-gray-500 mb-1 block">{t.tokens.safety_label}</label>
              <select
                value={filters.safetyGrade ?? ''}
                onChange={(e) => setFilters(f => ({ ...f, safetyGrade: e.target.value || null }))}
                className="w-full bg-gray-900/60 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#00D4FF]/50"
              >
                <option value="">{t.tokens.safety_all}</option>
                <option value="safe">{t.tokens.safety_safe}</option>
                <option value="moderate">{t.tokens.safety_moderate}</option>
                <option value="risky">{t.tokens.safety_risky}</option>
                <option value="honeypot">{t.tokens.safety_honeypots}</option>
                <option value="unanalyzed">{t.tokens.safety_not_analyzed}</option>
              </select>
            </div>

            {/* Toggles */}
            <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.positiveChange}
                onChange={(e) => setFilters(f => ({ ...f, positiveChange: e.target.checked }))}
                className="rounded border-white/20 bg-gray-800 text-[#00D4FF] focus:ring-[#00D4FF]/50"
              />
              {t.tokens.gainers_only}
            </label>

            <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.hideEthForks}
                onChange={(e) => setFilters(f => ({ ...f, hideEthForks: e.target.checked }))}
                className="rounded border-white/20 bg-gray-800 text-[#00D4FF] focus:ring-[#00D4FF]/50"
              />
              {t.tokens.hide_eth_forks}
            </label>

            <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.hasPriceOnly}
                onChange={(e) => setFilters(f => ({ ...f, hasPriceOnly: e.target.checked }))}
                className="rounded border-white/20 bg-gray-800 text-[#00D4FF] focus:ring-[#00D4FF]/50"
              />
              {t.tokens.with_price_only}
            </label>
          </div>
        </div>
      )}

      {/* Token table */}
      <div className="rounded-xl border border-white/5 bg-gray-900/40 backdrop-blur-sm p-5">
        {loading ? (
          <Spinner />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-gray-400">
                    <th className="py-3 pr-2 text-left">#</th>
                    <th className="py-3 pr-2 text-left">{t.tokens.table_token}</th>
                    <th className="py-3 px-2 text-center">
                      <span className="inline-flex items-center gap-1.5">
                        {t.tokens.table_price}
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                        </span>
                      </span>
                    </th>
                    <th className="py-3 px-2 text-center">24h</th>
                    <th className="py-3 px-2 text-center hidden md:table-cell">7d</th>
                    <th className="py-3 px-2 text-center hidden lg:table-cell">{t.tokens.table_market_cap}</th>
                    <th className="py-3 px-2 text-center hidden lg:table-cell">{t.tokens.table_volume}</th>
                    <th className="py-3 px-2 text-center hidden md:table-cell">{t.tokens.table_liquidity}</th>
                    <th className="py-3 px-2 text-center hidden sm:table-cell" title={t.tokens.table_risk_title}>{t.tokens.table_risk}</th>
                    <th className="py-3 pl-2 text-center hidden md:table-cell">{t.tokens.table_7d_chart}</th>
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((token, i) => {
                    const isStable = token.category === 'Stablecoin'
                    const c24 = formatChange(token.price_change_24h_pct)
                    // 7d change unreliable for stablecoins (historical prices from subgraph are wrong for quoteTokens)
                    const c7d = isStable ? formatChange(null) : formatChange(token.price_change_7d_pct)
                    void token.category // used for filters only
                    return (
                      <tr
                        key={token.address}
                        onClick={() => handleSelectToken(token)}
                        className="border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer"
                      >
                        <td className="py-2.5 pr-2 text-left text-gray-500">{page * PAGE_SIZE + i + 1}</td>
                        <td className="py-2.5 pr-2 text-left">
                          <div className="flex items-center gap-2">
                            <TokenLogo address={token.address} />
                            <div>
                          <span className="font-medium text-white">{token.symbol}</span>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-gray-500 text-xs">{token.name}</span>
                            {token.holder_count != null && token.holder_count > 0 && (
                              <span className="flex items-center gap-0.5 text-[10px] text-gray-500" title={t.tokens.holder_count_title}>
                                <Users className="h-2.5 w-2.5" />{formatCompact(token.holder_count)}
                              </span>
                            )}
                          </div>
                            </div>
                          </div>
                        </td>
                        <td className={`py-2.5 px-2 text-center transition-colors duration-700 ${
                          priceFlash.get(token.address.toLowerCase()) === 'up' ? 'text-emerald-400'
                          : priceFlash.get(token.address.toLowerCase()) === 'down' ? 'text-red-400'
                          : 'text-white'
                        }`}>{formatPrice(token.price_usd)}</td>
                        <td className={`py-2.5 px-2 text-center ${c24.className}`}>{c24.text}</td>
                        <td className={`py-2.5 px-2 text-center hidden md:table-cell ${c7d.className}`}>{c7d.text}</td>
                        <td className="py-2.5 px-2 text-center text-gray-300 hidden lg:table-cell">
                          {token.market_cap_usd != null ? formatUsd(token.market_cap_usd) : '--'}
                        </td>
                        <td className="py-2.5 px-2 text-center text-gray-300 hidden lg:table-cell" title={token.volume_24h_usd == null ? 'No recent daily volume data' : '24h trading volume'}>
                          {token.volume_24h_usd != null ? formatUsd(token.volume_24h_usd) : '--'}
                        </td>
                        <td className="py-2.5 px-2 text-center text-gray-300 hidden md:table-cell">
                          {token.total_liquidity_usd != null
                            ? formatUsd(token.total_liquidity_usd)
                            : (token.price_usd != null && token.total_liquidity > 0)
                              ? formatUsd(token.total_liquidity * token.price_usd)
                              : '--'}
                        </td>
                        <td className="py-2.5 px-2 text-center hidden sm:table-cell">
                          {(() => {
                            const s = safetyScores[token.address.toLowerCase()]
                            if (!s) return (
                              <a href={`/token/${token.address}`} onClick={e => e.stopPropagation()} className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-white/5 border border-white/10 text-gray-600 hover:border-white/20 hover:text-gray-400 transition-colors" title={t.tokens.not_analyzed_title}>
                                <span className="text-[10px] font-medium">?</span>
                              </a>
                            )
                            const gc = s.grade === 'A' ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                              : s.grade === 'B' ? 'bg-green-500/15 border-green-500/30 text-green-400'
                              : s.grade === 'C' ? 'bg-yellow-500/15 border-yellow-500/30 text-yellow-400'
                              : s.grade === 'D' ? 'bg-orange-500/15 border-orange-500/30 text-orange-400'
                              : 'bg-red-500/15 border-red-500/30 text-red-400'
                            return (
                              <a href={`/token/${token.address}`} onClick={e => e.stopPropagation()} className={`inline-flex items-center justify-center w-7 h-7 rounded-full border font-bold text-xs ${gc} hover:brightness-125 transition-all`} title={`Safety score: ${s.score}/100 (${s.grade})`}>
                                {s.grade}
                              </a>
                            )
                          })()}
                        </td>
                        <td className="py-2.5 pl-2 text-center hidden md:table-cell">
                          {token.category === 'Stablecoin'
                            ? <Sparkline data={[1, 1, 1, 1, 1, 1, 1]} color="#4ade80" />
                            : <Sparkline data={sparkData[token.address.toLowerCase()] || []} />
                          }
                        </td>
                      </tr>
                    )
                  })}
                  {tokens.length === 0 && (
                    <tr>
                      <td colSpan={10} className="py-8 text-center text-gray-500 text-sm">
                        {t.tokens.no_results}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/5">
                <span className="text-sm text-gray-500">
                  {t.tokens.page_of.replace('{current}', String(page + 1)).replace('{total}', String(totalPages))}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-white/10 text-sm text-gray-400 hover:bg-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="h-4 w-4" /> {t.tokens.prev}
                  </button>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-white/10 text-sm text-gray-400 hover:bg-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {t.tokens.next} <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Educational note */}
      <div className="rounded-xl border border-white/5 bg-gray-900/40 backdrop-blur-sm">
        <button
          onClick={() => setShowNote(!showNote)}
          className="flex items-center justify-between w-full p-4 text-left"
        >
          <div className="flex items-center gap-2 text-gray-400 text-sm">
            <Info className="h-4 w-4" />
            <span>{t.tokens.about_title}</span>
          </div>
          {showNote ? <ChevronUp className="h-4 w-4 text-gray-500" /> : <ChevronDown className="h-4 w-4 text-gray-500" />}
        </button>

        {showNote && (
          <div className="px-4 pb-4 space-y-4 text-sm text-gray-400">
            <div className="rounded bg-gray-800/50 border border-white/5 p-3">
              <p className="text-gray-300 font-medium mb-1">{t.tokens.about_what_title}</p>
              <p>
                {t.tokens.about_what_desc}
              </p>
            </div>

            <div>
              <p className="text-gray-300 font-medium mb-2">{t.tokens.about_data_sources}</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-gray-500">
                    <th className="py-1.5 text-left">{t.tokens.about_metric}</th>
                    <th className="py-1.5 text-left">{t.tokens.about_source}</th>
                    <th className="py-1.5 text-left">{t.tokens.about_details}</th>
                  </tr>
                </thead>
                <tbody className="text-gray-400">
                  <tr className="border-b border-white/5">
                    <td className="py-1.5">{t.tokens.ds_price}</td>
                    <td className="py-1.5">{t.tokens.ds_price_source}</td>
                    <td className="py-1.5">{t.tokens.ds_price_detail}</td>
                  </tr>
                  <tr className="border-b border-white/5">
                    <td className="py-1.5">{t.tokens.ds_change_24h}</td>
                    <td className="py-1.5">{t.tokens.ds_change_24h_source}</td>
                    <td className="py-1.5">{t.tokens.ds_change_24h_detail}</td>
                  </tr>
                  <tr className="border-b border-white/5">
                    <td className="py-1.5">{t.tokens.ds_change_7d}</td>
                    <td className="py-1.5">{t.tokens.ds_change_7d_source}</td>
                    <td className="py-1.5">{t.tokens.ds_change_7d_detail}</td>
                  </tr>
                  <tr className="border-b border-white/5">
                    <td className="py-1.5">{t.tokens.ds_market_cap}</td>
                    <td className="py-1.5">{t.tokens.ds_market_cap_source}</td>
                    <td className="py-1.5">{t.tokens.ds_market_cap_detail}</td>
                  </tr>
                  <tr className="border-b border-white/5">
                    <td className="py-1.5">{t.tokens.ds_volume}</td>
                    <td className="py-1.5">{t.tokens.ds_volume_source}</td>
                    <td className="py-1.5">{t.tokens.ds_volume_detail}</td>
                  </tr>
                  <tr className="border-b border-white/5">
                    <td className="py-1.5">{t.tokens.ds_liquidity}</td>
                    <td className="py-1.5">{t.tokens.ds_liquidity_source}</td>
                    <td className="py-1.5">{t.tokens.ds_liquidity_detail}</td>
                  </tr>
                  <tr className="border-b border-white/5">
                    <td className="py-1.5">{t.tokens.ds_holders}</td>
                    <td className="py-1.5">{t.tokens.ds_holders_source}</td>
                    <td className="py-1.5">{t.tokens.ds_holders_detail}</td>
                  </tr>
                  <tr className="border-b border-white/5">
                    <td className="py-1.5">{t.tokens.ds_categories}</td>
                    <td className="py-1.5">{t.tokens.ds_categories_source}</td>
                    <td className="py-1.5">{t.tokens.ds_categories_detail}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div>
              <p className="text-gray-300 font-medium mb-2">{t.tokens.about_known_limitations}</p>
              <ul className="list-disc list-inside space-y-1 text-xs">
                <li><span className="text-orange-400">{t.tokens.about_eth_fork_tokens}</span> — {t.tokens.about_eth_fork_desc} <span className="text-orange-400">{t.tokens.about_eth_fork_badge}</span> {t.tokens.about_eth_fork_suffix}</li>
                <li><span className="text-gray-300">{t.tokens.about_market_cap}</span> — {t.tokens.about_market_cap_desc}</li>
                <li><span className="text-gray-300">{t.tokens.about_dexscreener_enrichment}</span> — {t.tokens.about_dexscreener_desc}</li>
                <li><span className="text-gray-300">{t.tokens.about_categories}</span> — {t.tokens.about_categories_desc}</li>
                <li><span className="text-gray-300">{t.tokens.about_holders}</span> — {t.tokens.about_holders_desc}</li>
              </ul>
            </div>

            <div>
              <p className="text-gray-300 font-medium mb-2">{t.tokens.about_data_freshness}</p>
              <p className="text-xs text-gray-400">
                {t.tokens.about_freshness_desc}
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="text-xs text-gray-600 text-center">
        <p>{t.tokens.source_line}</p>
      </div>

      {/* Token Detail Modal — equal margins top=left=right */}
      {selectedToken && (
        <div
          key={selectedToken.address}
          ref={overlayRef}
          onClick={(e) => { if (e.target === overlayRef.current) closeModal() }}
          className="fixed inset-0 z-[9999] backdrop-blur-md overflow-y-auto p-4 sm:p-[3vw]"
        >
          <div className="relative w-full rounded-2xl border border-white/10 bg-gray-900 shadow-2xl">
            <button
              onClick={closeModal}
              className="absolute top-4 right-4 rounded-lg p-1.5 text-gray-400 hover:bg-white/10 hover:text-white transition-colors z-10"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="p-5 sm:p-6 lg:p-8 space-y-6">
              {/* Token Header */}
              <div className="flex items-center justify-between flex-wrap gap-4 pr-8">
                <div className="flex items-center gap-3">
                  <TokenLogo address={selectedToken.address} size="lg" />
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-2xl font-bold text-white">{selectedToken.symbol}</h2>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${CATEGORY_COLORS[selectedToken.category]}`}>{categoryLabel(selectedToken.category)}</span>
                      {ETH_FORK_ADDRESSES.has(selectedToken.address.toLowerCase()) && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 border border-orange-500/20">{t.tokens.fork_badge}</span>
                      )}
                    </div>
                    <p className="text-gray-400 text-sm">{selectedToken.name}</p>
                    <button
                      type="button"
                      onClick={() => window.open(`https://scan.mypinata.cloud/ipfs/bafybeienxyoyrhn5tswclvd3gdjy5mtkkwmu37aqtml6onbf7xnb3o22pe/#/address/${selectedToken.address}`, '_blank', 'noopener,noreferrer')}
                      className="flex items-center gap-1 text-gray-500 text-xs font-mono mt-1 hover:text-[#00D4FF] transition-colors cursor-pointer"
                    >
                      {selectedToken.address}
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                <div className="text-right">
                  <div className={`text-3xl font-bold transition-colors duration-700 flex items-center justify-end gap-2 ${
                    popupPriceFlash === 'up' ? 'text-emerald-400'
                    : popupPriceFlash === 'down' ? 'text-red-400'
                    : 'text-white'
                  }`}>
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400" />
                    </span>
                    {formatPrice(liveSummary?.price_usd ?? selectedToken.price_usd)}
                  </div>
                  <div className="flex items-center gap-3 justify-end mt-1">
                    {(() => {
                      const c = liveSummary?.price_change_24h ?? selectedToken.price_change_24h_pct
                      return c != null ? (
                        <span className={`text-sm font-medium ${c >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {c >= 0 ? '+' : ''}{c.toFixed(2)}%
                          <span className="text-gray-500 ml-1">24h</span>
                        </span>
                      ) : null
                    })()}
                    {selectedToken.price_change_7d_pct != null && (
                      <span className={`text-sm font-medium ${selectedToken.price_change_7d_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {selectedToken.price_change_7d_pct >= 0 ? '+' : ''}{selectedToken.price_change_7d_pct.toFixed(2)}%
                        <span className="text-gray-500 ml-1">7d</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Live Metrics */}
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-12">
                <div className="rounded-lg bg-white/5 px-2 py-2">
                  <div className="text-xs text-gray-400 mb-0.5 truncate">{t.tokens.detail_market_cap}</div>
                  <div className="text-sm font-medium text-white truncate">
                    {(liveSummary?.market_cap_usd ?? selectedToken.market_cap_usd) != null
                      ? formatUsd((liveSummary?.market_cap_usd ?? selectedToken.market_cap_usd)!)
                      : '--'}
                  </div>
                </div>
                <div className="rounded-lg bg-white/5 px-2 py-2">
                  <div className="text-xs text-gray-400 mb-0.5 truncate">{t.tokens.detail_fdv}</div>
                  <div className="text-sm font-medium text-white truncate">
                    {liveSummary?.fdv != null ? formatUsd(liveSummary.fdv) : '--'}
                  </div>
                </div>
                <div className="rounded-lg bg-white/5 px-2 py-2">
                  <div className="text-xs text-gray-400 mb-0.5 truncate">{t.tokens.detail_volume_24h}</div>
                  <div className="text-sm font-medium text-white truncate">
                    {(liveSummary?.total_volume_24h_usd ?? selectedToken.volume_24h_usd) != null
                      ? formatUsd((liveSummary?.total_volume_24h_usd ?? selectedToken.volume_24h_usd)!)
                      : '--'}
                  </div>
                </div>
                <div className="rounded-lg bg-white/5 px-2 py-2">
                  <div className="text-xs text-gray-400 mb-0.5 truncate">{t.tokens.table_liquidity}</div>
                  <div className="text-sm font-medium text-white truncate">
                    {(liveSummary?.total_liquidity_usd ?? selectedToken.total_liquidity_usd) != null
                      ? formatUsd((liveSummary?.total_liquidity_usd ?? selectedToken.total_liquidity_usd)!)
                      : '--'}
                  </div>
                </div>
                <div className="rounded-lg bg-white/5 px-2 py-2">
                  <div className="text-xs text-gray-400 mb-0.5 truncate">{t.tokens.detail_buys_sells}</div>
                  <div className="text-sm font-medium text-white truncate">
                    {liveSummary?.total_buys_24h != null
                      ? `${liveSummary.total_buys_24h.toLocaleString('en-US')} / ${(liveSummary.total_sells_24h ?? 0).toLocaleString('en-US')}`
                      : '--'}
                  </div>
                </div>
                <div className="rounded-lg bg-white/5 px-2 py-2">
                  <div className="text-xs text-gray-400 mb-0.5 truncate">{t.tokens.detail_pools}</div>
                  <div className="text-sm font-medium text-white truncate">
                    {liveSummary
                      ? `${liveSummary.pool_count_legitimate} · ${liveSummary.dex_count} DEX`
                      : '--'}
                  </div>
                </div>
                <div className="rounded-lg bg-white/5 px-2 py-2">
                  <div className="text-xs text-gray-400 mb-0.5 truncate">{t.tokens.table_holders}</div>
                  <div className="text-sm font-medium text-white truncate flex items-center gap-1">
                    <Users className="h-3 w-3 text-gray-500 shrink-0" />
                    {selectedToken.holder_count != null && selectedToken.holder_count > 0
                      ? selectedToken.holder_count.toLocaleString('en-US')
                      : '--'}
                  </div>
                </div>
                <div className="rounded-lg bg-white/5 px-2 py-2">
                  <div className="text-xs text-gray-400 mb-0.5 truncate">{t.tokens.detail_supply}</div>
                  <div className="text-sm font-medium text-white truncate">
                    {selectedSupply != null ? formatCompact(selectedSupply) : '--'}
                  </div>
                </div>
                <div className="rounded-lg bg-white/5 px-2 py-2">
                  <div className="text-xs text-gray-400 mb-0.5 truncate">{t.tokens.detail_median}</div>
                  <div className="text-sm font-medium text-white truncate">
                    {liveSummary?.price_median != null ? formatPrice(liveSummary.price_median) : '--'}
                  </div>
                </div>
                <div className="rounded-lg bg-white/5 px-2 py-2">
                  <div className="text-xs text-gray-400 mb-0.5 truncate">{t.tokens.detail_spread}</div>
                  <div className="text-sm font-medium text-white truncate">
                    {liveSummary?.price_min != null && liveSummary?.price_max != null && liveSummary?.price_median
                      ? `${(((liveSummary.price_max - liveSummary.price_min) / liveSummary.price_median) * 100).toFixed(2)}%`
                      : '--'}
                  </div>
                </div>
                <div className="rounded-lg bg-white/5 px-2 py-2">
                  <div className="text-xs text-gray-400 mb-0.5 truncate">{t.tokens.detail_decimals}</div>
                  <div className="text-sm font-medium text-white truncate">{selectedToken.decimals}</div>
                </div>
                <div className="rounded-lg bg-white/5 px-2 py-2">
                  <div className="text-xs text-gray-400 mb-0.5 truncate">{t.tokens.detail_freshness}</div>
                  <div className="text-sm font-medium text-white truncate">
                    {liveSummary?.data_age_seconds != null
                      ? liveSummary.data_age_seconds < 60
                        ? `${liveSummary.data_age_seconds}s`
                        : liveSummary.data_age_seconds < 3600
                          ? `${Math.round(liveSummary.data_age_seconds / 60)}min`
                          : `${Math.round(liveSummary.data_age_seconds / 3600)}h`
                      : '--'}
                  </div>
                </div>
              </div>

              {/* External links + DEX list */}
              <div className="flex items-center gap-3 flex-wrap text-xs">
                <a
                  href={`https://scan.mypinata.cloud/ipfs/bafybeienxyoyrhn5tswclvd3gdjy5mtkkwmu37aqtml6onbf7xnb3o22pe/#/address/${selectedToken.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-gray-400 hover:text-[#00D4FF] transition-colors"
                >
                  <ExternalLink className="h-3 w-3" /> Explorer
                </a>
                <a
                  href={`https://dexscreener.com/pulsechain/${selectedToken.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-gray-400 hover:text-[#00D4FF] transition-colors"
                >
                  <ExternalLink className="h-3 w-3" /> DexScreener
                </a>
                {liveSummary?.dex_list && liveSummary.dex_list.length > 0 && (
                  <>
                    <span className="text-gray-600">|</span>
                    <span className="text-gray-500">{t.tokens.listed_on}</span>
                    {liveSummary.dex_list.map((dex: string) => (
                      <span key={dex} className="px-2 py-0.5 rounded-full bg-white/5 text-gray-400">{formatDexName(dex)}</span>
                    ))}
                  </>
                )}
              </div>

              {/* Latest Intel */}
              {tokenIntel?.social_timeline?.length > 0 && (
                <div className="rounded-xl border border-white/5 bg-gray-900/60 p-4">
                  <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                    <Activity className="h-4 w-4 text-[#00D4FF]" />
                    Latest Intel
                  </h3>
                  <div className="space-y-2">
                    {tokenIntel.social_timeline
                      .sort((a: any, b: any) => (b.date || '').localeCompare(a.date || ''))
                      .slice(0, 5)
                      .map((event: any, i: number) => {
                        const impactColor = event.impact === 'negative' ? 'text-red-400'
                          : event.impact === 'positive' ? 'text-emerald-400'
                          : 'text-gray-400'
                        const catColors: Record<string, string> = {
                          launch: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
                          pump: 'bg-green-500/15 text-green-400 border-green-500/30',
                          dump: 'bg-red-500/15 text-red-400 border-red-500/30',
                          exploit: 'bg-red-500/15 text-red-400 border-red-500/30',
                          partnership: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
                          listing: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
                          controversy: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
                          milestone: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
                        }
                        const catClass = catColors[event.category] || 'bg-gray-500/15 text-gray-400 border-gray-500/30'
                        return (
                          <div key={i} className="flex items-start gap-3 py-2 border-b border-white/5 last:border-0">
                            <div className={`mt-1 h-2 w-2 rounded-full shrink-0 ${
                              event.impact === 'negative' ? 'bg-red-400'
                              : event.impact === 'positive' ? 'bg-emerald-400'
                              : 'bg-gray-500'
                            }`} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${catClass}`}>
                                  {event.category}
                                </span>
                                <span className="text-[10px] text-gray-600">
                                  {event.date?.slice(0, 10)}
                                </span>
                              </div>
                              <p className={`text-xs ${impactColor}`}>{event.title}</p>
                              {event.description && (
                                <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{event.description}</p>
                              )}
                            </div>
                          </div>
                        )
                      })}
                  </div>
                </div>
              )}

              {/* Price chart */}
              <div className="rounded-xl border border-white/5 bg-gray-900/60 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white">{t.tokens.price_history}</h3>
                  <TimeRangeSelector value={priceRange} onChange={setPriceRange} />
                </div>
                {historyLoading ? (
                  <Spinner />
                ) : chartHistory.length > 0 ? (
                  <AreaChartComponent
                    data={priceRange ? chartHistory.slice(-priceRange) : chartHistory}
                    xKey="date"
                    yKey="price_usd"
                    color="#00D4FF"
                    yFormatter={(v) => v < 0.01 ? `$${v.toFixed(6)}` : `$${v.toFixed(4)}`}
                    liveDot
                  />
                ) : (
                  <p className="py-8 text-center text-gray-500 text-sm">{t.tokens.no_price_history}</p>
                )}
              </div>

              {/* Volume chart */}
              <div className="rounded-xl border border-white/5 bg-gray-900/60 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white">{t.tokens.daily_volume}</h3>
                  <TimeRangeSelector value={volRange} onChange={setVolRange} />
                </div>
                {historyLoading ? (
                  <Spinner />
                ) : chartHistory.filter(h => h.daily_volume_usd > 0).length > 0 ? (
                  <AreaChartComponent
                    data={volRange ? chartHistory.slice(-volRange) : chartHistory}
                    xKey="date"
                    yKey="daily_volume_usd"
                    color="#8000E0"
                  />
                ) : (
                  <p className="py-8 text-center text-gray-500 text-sm">{t.tokens.no_volume_data}</p>
                )}
              </div>

              {/* LP Pools Table */}
              <div className="rounded-xl border border-white/5 bg-gray-900/60 p-4">
                <div className="mb-3">
                  <h3 className="text-sm font-semibold text-white">
                    {t.tokens.liquidity_pools}
                    {liveSummary && (
                      <span className="text-gray-500 font-normal ml-2">
                        {t.tokens.legitimate_total.replace('{legitimate}', String(liveSummary.pool_count_legitimate)).replace('{total}', String(liveSummary.pool_count_total)).replace('{dex}', String(liveSummary.dex_count))}
                      </span>
                    )}
                  </h3>
                </div>
                {liveLoading ? (
                  <Spinner />
                ) : livePools.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs table-fixed">
                      <colgroup>
                        <col style={{ width: '2.5%' }} />
                        <col style={{ width: '6%' }} />
                        <col style={{ width: '9%' }} />
                        <col style={{ width: '10%' }} />
                        <col style={{ width: '8%' }} />
                        <col style={{ width: '8%' }} />
                        <col style={{ width: '8%' }} />
                        <col style={{ width: '5%' }} />
                        <col style={{ width: '5%' }} />
                        <col style={{ width: '8%' }} />
                        <col style={{ width: '12%' }} />
                        <col style={{ width: '5%' }} />
                      </colgroup>
                      <thead>
                        <tr className="border-b border-white/10 text-gray-500">
                          <ClickableHeader label="#" />
                          <ClickableHeader label="DEX" />
                          <ClickableHeader label="Pair" />
                          <ClickableHeader label="Contract" />
                          <ClickableHeader label="Price" />
                          <ClickableHeader label="Liquidity" />
                          <ClickableHeader label="Volume 24h" />
                          <ClickableHeader label="Buys" />
                          <ClickableHeader label="Sells" />
                          <ClickableHeader label="Price Change 24h" />
                          <ClickableHeader label="Safety" />
                          <ClickableHeader label="DexScreener" />
                        </tr>
                      </thead>
                      <tbody>
                        {livePools.map((pool, i) => {
                          const isSpam = !pool.pool_is_legitimate
                          const pChange = formatChange(pool.price_change_24h)
                          const shortAddr = `${pool.pair_address.slice(0, 6)}...${pool.pair_address.slice(-4)}`
                          const baseSym = resolvePoolSymbol(pool.base_token_symbol, pool.base_token_address, selectedToken?.address, selectedToken?.symbol)
                          const quoteSym = resolvePoolSymbol(pool.quote_token_symbol, pool.quote_token_address, selectedToken?.address, selectedToken?.symbol)
                          return (
                            <tr
                              key={pool.pair_address}
                              className={`border-b border-white/5 ${isSpam ? '' : 'hover:bg-white/5'}`}
                              title={isSpam ? `Spam: ${pool.pool_spam_reason}` : undefined}
                            >
                              <td className={`py-2 text-center text-gray-500 ${isSpam ? 'opacity-40' : ''}`}>{i + 1}</td>
                              <td className={`py-2 text-center text-gray-300 ${isSpam ? 'opacity-40' : ''}`}>{formatDexName(pool.dex_id)}</td>
                              <td className={`py-2 text-center ${isSpam ? 'opacity-40' : ''}`}>
                                {pool.dx_url ? (
                                  <a href={pool.dx_url} target="_blank" rel="noopener noreferrer" className="text-[#00D4FF] hover:underline">
                                    {baseSym}/{quoteSym}
                                  </a>
                                ) : (
                                  <span className="text-gray-300">{baseSym}/{quoteSym}</span>
                                )}
                              </td>
                              <td className={`py-2 text-center ${isSpam ? 'opacity-40' : ''}`}>
                                <a
                                  href={`https://scan.mypinata.cloud/ipfs/bafybeienxyoyrhn5tswclvd3gdjy5mtkkwmu37aqtml6onbf7xnb3o22pe/#/address/${pool.pair_address}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-gray-500 hover:text-[#00D4FF] transition-colors font-mono"
                                  title={pool.pair_address}
                                >
                                  {shortAddr}
                                </a>
                              </td>
                              <td className={`py-2 text-center transition-colors duration-700 ${
                                poolPriceFlash.get(pool.pair_address) === 'up' ? 'text-emerald-400'
                                : poolPriceFlash.get(pool.pair_address) === 'down' ? 'text-red-400'
                                : 'text-white'
                              } ${isSpam ? 'opacity-40' : ''}`}>{formatPrice(pool.price_usd)}</td>
                              <td className={`py-2 text-center text-gray-300 ${isSpam ? 'opacity-40' : ''}`}>{pool.liquidity_usd != null ? formatUsd(pool.liquidity_usd) : '--'}</td>
                              <td className={`py-2 text-center text-gray-300 ${isSpam ? 'opacity-40' : ''}`}>{pool.volume_24h_usd != null ? formatUsd(pool.volume_24h_usd) : '--'}</td>
                              <td className={`py-2 text-center text-gray-300 ${isSpam ? 'opacity-40' : ''}`}>{pool.buys_24h?.toLocaleString('en-US') ?? '--'}</td>
                              <td className={`py-2 text-center text-gray-300 ${isSpam ? 'opacity-40' : ''}`}>{pool.sells_24h?.toLocaleString('en-US') ?? '--'}</td>
                              <td className={`py-2 text-center ${isSpam ? 'opacity-40' : ''} ${pChange.className}`}>{pChange.text}</td>
                              <td className={`py-2 text-center ${isSpam ? 'opacity-40' : ''}`}>
                                {(() => {
                                  const ss = safetyScores[pool.token_address?.toLowerCase()]
                                  const conf = pool.pool_confidence
                                  const confDotClass = conf === 'high' ? 'bg-emerald-400' : conf === 'medium' ? 'bg-yellow-400' : conf === 'low' ? 'bg-orange-400' : 'bg-red-400'
                                  if (!ss) {
                                    return (
                                      <span className="text-gray-500 text-[10px] inline-flex items-center gap-1" title={`Pool confidence: ${conf || 'unknown'}`}>
                                        <span className={`inline-block w-1.5 h-1.5 rounded-full ${confDotClass}`} />
                                        <span>{'\u2014'}</span>
                                      </span>
                                    )
                                  }
                                  const gc = ss.grade === 'A' ? 'text-emerald-400'
                                    : ss.grade === 'B' ? 'text-green-400'
                                    : ss.grade === 'C' ? 'text-yellow-400'
                                    : ss.grade === 'D' ? 'text-orange-400'
                                    : 'text-red-400'
                                  return (
                                    <a href={`/token/${pool.token_address}`} className={`${gc} font-bold hover:underline inline-flex items-center gap-1`} title={`Safety ${ss.score}/100 \u00B7 Pool: ${conf}`} onClick={e => e.stopPropagation()}>
                                      <span className={`inline-block w-1.5 h-1.5 rounded-full ${confDotClass}`} />
                                      <span>{ss.grade}</span>
                                    </a>
                                  )
                                })()}
                              </td>
                              <td className={`py-2 text-center ${isSpam ? 'opacity-40' : ''}`}>
                                <a
                                  href={pool.dx_url || `https://dexscreener.com/pulsechain/${pool.pair_address}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-gray-500 hover:text-[#00D4FF] transition-colors"
                                  title={t.tokens.view_on_dexscreener}
                                >
                                  <ExternalLink className="h-3 w-3 inline" />
                                </a>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="py-6 text-center text-gray-500 text-sm">{t.tokens.no_pool_data}</p>
                )}
              </div>

              {/* Source */}
              <div className="text-xs text-gray-600 text-center">
                {t.tokens.detail_source}
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
