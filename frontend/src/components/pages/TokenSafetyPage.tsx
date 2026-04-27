import { useState, useEffect, Fragment } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Shield, AlertTriangle, CheckCircle, XCircle, ExternalLink, ArrowLeft, Loader2, Clock, Users, FileCode, Droplets, Fingerprint, Activity, Info, Copy, Check, ChevronDown, ChevronRight, MessageCircle, TrendingUp, TrendingDown, Minus, X, Search, ThumbsUp, ThumbsDown, Eye } from 'lucide-react'
import { ShareButton } from '../ui/ShareButton'
import { supabase } from '../../lib/supabase'
import { resolvePoolSymbol } from '../../lib/tokenSymbols'
import { useTranslation } from '../../i18n'
import { TokenLogo } from '../ui/TokenLogo'
import { SafetyVerdictGrid, type ScamVerdict } from '../safety/SafetyVerdictGrid'
import { parseSafetyPayload, reportSafetyContractWarning } from '../../lib/safetyContract'

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface SafetyScore {
  token_address: string
  score: number
  grade: string
  risks: string[]
  honeypot_score: number
  is_honeypot: boolean | null
  buy_tax_pct: number | null
  sell_tax_pct: number | null
  contract_score: number
  is_verified: boolean
  is_proxy: boolean
  ownership_renounced: boolean | null
  has_mint: boolean
  has_blacklist: boolean
  contract_dangers: string[]
  lp_score: number
  has_lp: boolean
  total_liquidity_usd: number
  pair_count: number
  recent_burns_24h: number
  holders_score: number
  holder_count: number
  top10_pct: number
  top1_pct: number
  age_score: number
  age_days: number
  analyzed_at: string
  analysis_details?: string | Record<string, unknown> | null
  scam_score?: number | null
  scam_risk_level?: 'critical' | 'high' | 'medium' | 'low' | null
}

interface HoneypotDetail {
  is_honeypot: boolean | null
  buy_tax_pct: number | null
  sell_tax_pct: number | null
  transfer_tax_pct: number | null
  buy_gas: number | null
  sell_gas: number | null
  max_tx_amount: string | null
  max_wallet_amount: string | null
  dynamic_tax: boolean
  tax_by_amount: Record<string, { buy_tax: number | null; sell_tax: number | null; error?: boolean }> | null
  flags: string[]
  router: string | null
  error: string | null
  holder_analysis?: {
    holders_tested: number
    successful: number
    failed: number
    siphoned: number
    average_tax: number | null
    highest_tax: number | null
    holder_results: { address: string; pct_supply: number; can_transfer: boolean | null; is_contract: boolean; error: string | null }[]
  }
}

interface TokenInfo {
  address: string
  symbol: string
  name: string
}

interface LiquidityPair {
  address: string
  dex: string
  reserve_usd: number
  token0_symbol: string
  token1_symbol: string
  token0_address: string
  token1_address: string
  created_at: number
  age_days: number
  total_txns: number
  is_anchored?: boolean
}

// Pool data from token_pools_live (database) — used for sections ④⑥⑦
interface PoolLive {
  token_address: string
  pair_address: string
  dex_id: string | null
  base_token_address: string | null
  base_token_symbol: string | null
  quote_token_address: string | null
  quote_token_symbol: string | null
  price_usd: number | null
  liquidity_usd: number | null
  volume_24h_usd: number | null
  buys_24h: number | null
  sells_24h: number | null
  pool_is_legitimate: boolean
  pool_confidence: string | null
  pool_spam_reason: string | null
  pool_risk_score: number | null
  tier: string
  dx_url: string | null
  updated_at: string
}

// Monitoring history snapshots (from token_monitoring_pools)
interface MonitoringSnapshot {
  pair_address: string
  snapshot_at: string
  pool_confidence: string
  pool_is_legitimate: boolean
  pool_spam_reason: string | null
  reserve_usd: number | null
  volume_24h_usd: number | null
  token0_symbol: string | null
  token1_symbol: string | null
  token0_is_known: boolean
  token0_is_core: boolean
  token1_is_known: boolean
  token1_is_core: boolean
}

interface VerifiedToken {
  address: string
  symbol: string
  name: string | null
}

interface DeployerInfo {
  deployer_address: string
  tokens_deployed: number
  dead_tokens: number
  mortality_rate: number
  risk_level: string
}

// Leagues holder data for section ⑤
interface LeagueHolder {
  holder_address: string
  balance_pct: number
  tier: string
  family_id: string | null
}

interface LeagueFamily {
  family_id: string
  mother_address: string
  daughter_count: number
  combined_balance_pct: number
  combined_tier: string
  link_types: string[]
}

interface LeagueSummary {
  total_holders: number
  poseidon_count: number
  whale_count: number
  shark_count: number
  dolphin_count: number
  squid_count: number
  turtle_count: number
  updated_at: string
}

// ─── Constants ───────────────────────────────────────────────────────────────

// Tokens tracked by the Leagues module (holder_leagues scraper)
const LEAGUE_TOKEN_ADDRESSES: Record<string, string> = {
  '0xa1077a294dde1b09bb078844df40758a5d0f9a27': 'PLS',
  '0x95b303987a60c71504d99aa1b13b4da07b0790ab': 'PLSX',
  '0x2b591e99afe9f32eaa6214f7b7629768c40eeb39': 'HEX',
  '0x2fa878ab3f87cc1c9737fc071108f904c0b0c95d': 'INC',
}

// Canonical token registry — curated list of verified token addresses
// This replaces the unreliable "search by symbol in pulsechain_tokens" approach (Finding #3)
// Status: Canonical (address matches) / Address differs (symbol match, wrong address) / Unlisted (not in registry)
const CANONICAL_TOKENS: Record<string, { address: string; name: string; source: string }> = {
  // Native & Core
  WPLS: { address: '0xa1077a294dde1b09bb078844df40758a5d0f9a27', name: 'Wrapped Pulse', source: 'native' },
  PLS: { address: '0xa1077a294dde1b09bb078844df40758a5d0f9a27', name: 'PulseChain', source: 'native' },
  HEX: { address: '0x2b591e99afe9f32eaa6214f7b7629768c40eeb39', name: 'HEX', source: 'native' },
  PLSX: { address: '0x95b303987a60c71504d99aa1b13b4da07b0790ab', name: 'PulseX', source: 'native' },
  INC: { address: '0x2fa878ab3f87cc1c9737fc071108f904c0b0c95d', name: 'Incentive', source: 'native' },
  // Bridged stablecoins
  DAI: { address: '0xefd766ccb38eaf1dfd701853bfce31359239f305', name: 'Dai (bridged)', source: 'bridge' },
  USDC: { address: '0x15d38573d2feeb82e7ad5187ab8c1d52810b1f07', name: 'USD Coin (bridged)', source: 'bridge' },
  USDT: { address: '0x0cb6f5a34ad42ec934882a05265a7d5f59b51a2f', name: 'Tether (bridged)', source: 'bridge' },
  // Bridged assets
  WETH: { address: '0x02dcdd04e3f455d838cd1249292c58f3b79e3c3c', name: 'Wrapped Ether (bridged)', source: 'bridge' },
  WBTC: { address: '0xb17d901469b9208b17d916112988a3fed19b5ca1', name: 'Wrapped Bitcoin (bridged)', source: 'bridge' },
  // DeFi tokens
  HEDRON: { address: '0x3819f64f282bf135d62168c1e513280daf905e06', name: 'Hedron', source: 'pulsex_top' },
  eHEX: { address: '0x57fde0a71132198bbec939b98976993d8d89d225', name: 'HEX (Ethereum)', source: 'bridge' },
  MAXI: { address: '0x0d86eb9f43c57f6ff3bc9e23d8f9d82503f0e84b', name: 'Maximus', source: 'pulsex_top' },
  // Top tokens by liquidity
  LOAN: { address: '0x9159f1d2a9f51998fc9ab03fbd8f265ab14a1b3b', name: 'Liquid Loans', source: 'pulsex_top' },
  USDL: { address: '0x0deed1486bc52aa0d3e6f8849cec5add6598a162', name: 'USDL Stablecoin', source: 'pulsex_top' },
  CST: { address: '0x600136da8cc6d1ea07449514604dc4ab7098db82', name: 'Coast', source: 'pulsex_top' },
  BEAR: { address: '0xd6c31ba0754c4383a41c0e9df042c62b5e918f6d', name: 'Teddy Bear', source: 'pulsex_top' },
  FLEX: { address: '0x9c6fa17d92898b684676993828143596894aa2a6', name: 'FLEX', source: 'pulsex_top' },
  SPARK: { address: '0x6386704cd6f7a584ea9d23ccca66af7eba5a727e', name: 'SparkSwap', source: 'pulsex_top' },
  pDAI: { address: '0x6b175474e89094c44da98b954eedeac495271d0f', name: 'DAI (Ethereum fork)', source: 'fork' },
  // PulseX Extended tokens
  HDRN_ETH: { address: '0xabf663531fa10ab8116cbf7d5c6229b018a26ff9', name: 'Hedron (Ethereum)', source: 'bridge' },
  TIME: { address: '0xca35638a3fddd02fec597d8c1681198c06b23f58', name: 'T.I.M.E. Dividend', source: 'pulsex_top' },
  TEXAN: { address: '0xcfcffe432a48db53f59c301422d2edd77b2a88d7', name: 'Texan', source: 'pulsex_top' },
  PHUX: { address: '0x9663c2d75ffd5f4017310405fce61720af45b829', name: 'PHUX', source: 'pulsex_top' },
  PHIAT: { address: '0x96e035ae0905efac8f733f133462f971cfa45db1', name: 'Phiat', source: 'pulsex_top' },
  PXDC: { address: '0xeb6b7932da20c6d7b3a899d5887d86dfb09a6408', name: 'PXDC Stablecoin', source: 'pulsex_top' },
  EARN: { address: '0xb513038bbfdf9d40b676f41606f4f61d4b02c4a2', name: 'EARN', source: 'pulsex_top' },
  BEAN: { address: '0xd7407bd3e6ad1baae0ba9eafd1ec41bfe63907b2', name: 'BEAN', source: 'pulsex_top' },
  WATT: { address: '0xdfdc2836fd2e63bba9f0ee07901ad465bff4de71', name: 'WATT', source: 'pulsex_top' },
  PINU: { address: '0xa12e2661ec6603cbbb891072b2ad5b3d5edb48bd', name: 'PulseInu', source: 'pulsex_top' },
  PLSB: { address: '0x5ee84583f67d5ecea5420dbb42b462896e7f8d06', name: 'PulseBitcoin', source: 'pulsex_top' },
  COM: { address: '0x5a9780bfe63f3ec57f01b087cd65bd656c9034a8', name: 'Communis', source: 'pulsex_top' },
  ICSA: { address: '0xfc4913214444af5c715cc9f7b52655e788a569ed', name: 'Icosa', source: 'pulsex_top' },
  '9MM': { address: '0x7b39712ef45f7dced2bbdf11f3d5046ba61da719', name: '9mm', source: 'pulsex_top' },
}


// Aliases: DB symbol → legacy LLM-extracted symbols used in token_sentiment
const SENTIMENT_ALIASES: Record<string, string[]> = {
  WPLS: ['PLS', 'PULSE'],
  'eHEX': ['EHEX'],
  pWBTC: ['WBTC'],
  pUSDT: ['USDT'],
  pUSDC: ['USDC'],
  pDAI: ['DAI'],
}

// Reverse lookup: address → symbol (for sentiment fallback when tokenInfo not yet loaded)
const ADDRESS_TO_SYMBOL: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TOKENS).map(([sym, t]) => [t.address.toLowerCase(), sym])
)

const GRADE_COLORS: Record<string, string> = {
  A: 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10',
  B: 'text-green-400 border-green-400/30 bg-green-400/10',
  C: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10',
  D: 'text-orange-400 border-orange-400/30 bg-orange-400/10',
  F: 'text-red-400 border-red-400/30 bg-red-400/10',
}

// Pool confidence levels — P0-B fix: Low=orange (distinct from Suspect=red)
const CONFIDENCE_INFO: Record<string, { label: string; color: string; bg: string; explanation: string }> = {
  high: {
    label: 'High',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10 border-emerald-500/20',
    explanation: 'Both tokens in this pair are core PulseChain tokens (WPLS, HEX, PLSX, INC, WETH, DAI, USDC, USDT, WBTC, HEDRON, MAXI, eHEX). Highest trust level.',
  },
  medium: {
    label: 'Medium',
    color: 'text-yellow-400',
    bg: 'bg-yellow-500/10 border-yellow-500/20',
    explanation: 'One token is a core PulseChain token and the other is a known token listed in our database. Standard trust level for most legitimate pairs.',
  },
  low: {
    label: 'Low',
    color: 'text-orange-400',
    bg: 'bg-orange-500/10 border-orange-500/20',
    explanation: 'Both tokens are known (listed in our database) but neither is a core token. Exercise caution — verify the token contracts independently.',
  },
  suspect: {
    label: 'Suspect',
    color: 'text-red-400',
    bg: 'bg-red-500/10 border-red-500/20',
    explanation: 'At least one token in this pair is not recognized in our database. This pool may involve an unverified or potentially fraudulent token. Do your own research before interacting.',
  },
  resolving: {
    label: 'Resolving...',
    color: 'text-gray-400 animate-pulse',
    bg: 'bg-gray-500/10 border-gray-500/20',
    explanation: 'Querying DexScreener + PulseChain Scan to determine actual confidence...',
  },
}

// Core tokens used for confidence resolution (lowercase)
const CORE_SYMBOLS = new Set(['wpls', 'pls', 'hex', 'plsx', 'inc', 'weth', 'dai', 'usdc', 'usdt', 'wbtc', 'hedron', 'maxi', 'ehex'])

/** Extract unknown token addresses from a suspect pool's spam reason */
function getUnknownAddrs(pool: { pool_spam_reason: string | null; base_token_address: string | null; quote_token_address: string | null }): string[] {
  if (!pool.pool_spam_reason) return []
  const reasons = pool.pool_spam_reason.split('; ').map(r => r.split(':')[0].trim())
  const addrs: string[] = []
  if (reasons.includes('unknown_token0') && pool.base_token_address) addrs.push(pool.base_token_address.toLowerCase())
  if (reasons.includes('unknown_token1') && pool.quote_token_address) addrs.push(pool.quote_token_address.toLowerCase())
  return addrs
}

/** Resolve effective confidence for a pool based on multi-source verification */
function resolvePoolConfidence(
  pool: { pool_confidence: string | null; pool_spam_reason: string | null; base_token_address: string | null; quote_token_address: string | null; base_token_symbol: string | null; quote_token_symbol: string | null },
  verifications: Record<string, { loading: boolean; resolvedConfidence: string; resolvedReason: string }>
): { level: string; reason: string } | undefined {
  if ((pool.pool_confidence ?? 'suspect') !== 'suspect' || !pool.pool_spam_reason) return undefined
  const reasons = pool.pool_spam_reason.split('; ').map(r => r.split(':')[0].trim())
  const onlyUnknown = reasons.every(r => r === 'unknown_token0' || r === 'unknown_token1')
  if (!onlyUnknown) return undefined // Has other red flags → stay suspect

  const unknownAddrs = getUnknownAddrs(pool)
  if (unknownAddrs.length === 0) return undefined

  const anyLoading = unknownAddrs.some(a => verifications[a]?.loading)
  if (anyLoading) return { level: 'resolving', reason: '' }

  // All resolved: pick the worst (lowest) confidence among unknown tokens
  const resolved = unknownAddrs.map(a => verifications[a]).filter(Boolean)
  if (resolved.length === 0) return undefined

  const order = ['suspect', 'low', 'medium', 'high']
  let worstLevel = 'high'
  const reasonParts: string[] = []
  for (const v of resolved) {
    if (order.indexOf(v.resolvedConfidence) < order.indexOf(worstLevel)) worstLevel = v.resolvedConfidence
    if (v.resolvedReason) reasonParts.push(v.resolvedReason)
  }

  // If the other token in the pair is core, and resolved is at least "low", bump to "medium"
  if (worstLevel === 'low') {
    const otherSymbol = reasons.includes('unknown_token0')
      ? pool.quote_token_symbol : pool.base_token_symbol
    if (otherSymbol && CORE_SYMBOLS.has(otherSymbol.toLowerCase())) {
      worstLevel = 'medium'
    }
  }

  return { level: worstLevel, reason: reasonParts.join(' | ') }
}

/** Compute confidence from multi-source signals */
function computeResolvedConfidence(dx: { pairs: number; liquidity: number; volume: number }, scan: { verified: boolean; holders: number }): { level: 'high' | 'medium' | 'low' | 'suspect'; reason: string } {
  const signals: string[] = []
  let score = 0

  // DexScreener signals
  if (dx.pairs > 0) { score += 1; signals.push(`${dx.pairs} DX pairs`) }
  if (dx.liquidity > 50000) { score += 3; signals.push(`$${Math.round(dx.liquidity).toLocaleString('en-US')} liq`) }
  else if (dx.liquidity > 10000) { score += 2; signals.push(`$${Math.round(dx.liquidity).toLocaleString('en-US')} liq`) }
  else if (dx.liquidity > 1000) { score += 1; signals.push(`$${Math.round(dx.liquidity).toLocaleString('en-US')} liq`) }
  if (dx.volume > 10000) { score += 2; signals.push(`$${Math.round(dx.volume).toLocaleString('en-US')} vol/24h`) }
  else if (dx.volume > 1000) { score += 1; signals.push(`$${Math.round(dx.volume).toLocaleString('en-US')} vol/24h`) }

  // PulseChain Scan signals
  if (scan.verified) { score += 2; signals.push('contract verified') }
  if (scan.holders > 500) { score += 2; signals.push(`${scan.holders.toLocaleString('en-US')} holders`) }
  else if (scan.holders > 100) { score += 1; signals.push(`${scan.holders} holders`) }
  else if (scan.holders > 0) { signals.push(`${scan.holders} holders`) }

  const reason = signals.join(' · ')

  // Score thresholds: ≥5 = Medium, ≥2 = Low, <2 = Suspect
  if (score >= 5) return { level: 'medium', reason }
  if (score >= 2) return { level: 'low', reason }
  return { level: 'suspect', reason: reason || 'No data found on DexScreener or PulseChain Scan' }
}

const TIER_COLORS: Record<string, string> = {
  poseidon: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  whale: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  shark: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
  dolphin: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  squid: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
  turtle: 'text-gray-400 bg-gray-500/10 border-gray-500/20',
}

const TIER_EMOJI: Record<string, string> = {
  poseidon: '\u{1F30A}',
  whale: '\u{1F40B}',
  shark: '\u{1F988}',
  dolphin: '\u{1F42C}',
  squid: '\u{1F991}',
  turtle: '\u{1F422}',
}

const TIER_THRESHOLDS: Record<string, string> = {
  poseidon: '10%+ of supply',
  whale: '1%+ of supply',
  shark: '0.1%+ of supply',
  dolphin: '0.01%+ of supply',
  squid: '0.001%+ of supply',
  turtle: '0.0001%+ of supply',
}

const DEX_NAMES: Record<string, string> = {
  pulsex: 'PulseX', '9mm': '9mm', '9inch': '9inch',
  'pulse-rate': 'Pulse Rate', dextop: 'DexTop', eazyswap: 'EazySwap',
}

// ─── Utility functions ───────────────────────────────────────────────────────

function formatDexName(dex: string | null): string {
  if (!dex) return '--'
  return DEX_NAMES[dex] || dex.charAt(0).toUpperCase() + dex.slice(1)
}

function formatUsdCompact(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`
  if (val >= 1_000) return `$${(val / 1_000).toFixed(1)}K`
  return `$${val.toFixed(0)}`
}

// P0-D fix: use real token symbols instead of generic "Token 0/1"
// P3-A: add actionable recommendations per spam reason type
function formatSpamReason(raw: string | null, baseSymbol?: string | null, quoteSymbol?: string | null, pageAddress?: string | null, baseAddress?: string | null, quoteAddress?: string | null): { code: string; explanation: string; action?: string }[] {
  if (!raw) return []
  const t0 = baseSymbol || 'Base token'
  const t1 = quoteSymbol || 'Quote token'
  const pa = pageAddress?.toLowerCase()
  return raw.split('; ').filter(part => {
    // Don't flag the monitored token as "unknown" on its own page (stale cache safety net)
    const k = part.split(':')[0].trim()
    if (k === 'unknown_token0' && pa && baseAddress?.toLowerCase() === pa) return false
    if (k === 'unknown_token1' && pa && quoteAddress?.toLowerCase() === pa) return false
    return true
  }).map(part => {
    const [code, val] = part.split(':')
    const key = code.trim()
    if (key.startsWith('low_reserve')) {
      return {
        code: part,
        explanation: `Pool reserves are extremely low ($${val ?? '< 100'} USD). Legitimate pools typically have significantly higher reserves.`,
        action: 'This pool has almost no capital. Trades here will have extreme price impact.',
      }
    }
    // Handle spam_name_token0/token1 patterns
    if (key === 'spam_name_token0') {
      return {
        code: part,
        explanation: `The name of ${t0} contains a flagged keyword: '${val ?? 'unknown'}'.`,
        action: `Token names containing '${val ?? 'flagged keywords'}' are commonly associated with scam/test tokens.`,
      }
    }
    if (key === 'spam_name_token1') {
      return {
        code: part,
        explanation: `The name of ${t1} contains a flagged keyword: '${val ?? 'unknown'}'.`,
        action: `Token names containing '${val ?? 'flagged keywords'}' are commonly associated with scam/test tokens.`,
      }
    }
    const map: Record<string, { explanation: string; action: string }> = {
      unknown_token0: {
        explanation: `${t0} is not recognized in our token database.`,
        action: 'Check the contract address on PulseChain Scan. Compare with the official token website.',
      },
      unknown_token1: {
        explanation: `${t1} is not recognized in our token database.`,
        action: 'Check the contract address on PulseChain Scan. Compare with the official token website.',
      },
      low_volume_token0: {
        explanation: `${t0} has very low all-time trading volume (< $1,000), indicating an inactive or fake token.`,
        action: 'Low volume means high slippage and potential exit difficulty.',
      },
      low_volume_token1: {
        explanation: `${t1} has very low all-time trading volume (< $1,000), indicating an inactive or fake token.`,
        action: 'Low volume means high slippage and potential exit difficulty.',
      },
      spam_name: {
        explanation: `One of the token names contains a spam keyword (e.g. "airdrop", "free", "claim", "test").`,
        action: 'Token names with promotional keywords are commonly associated with scam tokens.',
      },
      no_liquidity_token0: {
        explanation: `${t0} has zero or near-zero liquidity in this pool.`,
        action: 'No liquidity means you cannot sell this token. Do not buy.',
      },
      no_liquidity_token1: {
        explanation: `${t1} has zero or near-zero liquidity in this pool.`,
        action: 'No liquidity means you cannot sell this token. Do not buy.',
      },
    }
    const entry = map[key]
    if (entry) return { code: part, ...entry }
    return { code: part, explanation: `Flagged: ${part}` }
  })
}

// ─── Popup Panel (modal overlay) ─────────────────────────────────────────────

function PopupPanel({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-md" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="relative w-full max-w-4xl max-h-[85vh] mx-4 rounded-2xl border border-white/10 bg-gray-900 shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 shrink-0">
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors text-lg leading-none">&times;</button>
        </div>
        <div className="overflow-y-auto p-5 space-y-4">{children}</div>
      </div>
    </div>
  )
}

// ─── Utility components ──────────────────────────────────────────────────────

function CopyAddress({ address }: { address: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <p className="text-sm text-gray-400 font-mono mb-3 flex items-center gap-1.5 flex-wrap">
      <span>{address}</span>
      <button
        onClick={handleCopy}
        className="text-gray-500 hover:text-[#00D4FF] transition-colors shrink-0"
        title="Copy address"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      <a
        href={`https://scan.mypinata.cloud/ipfs/bafybeienxyoyrhn5tswclvd3gdjy5mtkkwmu37aqtml6onbf7xnb3o22pe/#/address/${address}`}
        target="_blank" rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-[#00D4FF] hover:underline"
      >
        {t.common.explorer} <ExternalLink className="h-3 w-3" />
      </a>
    </p>
  )
}

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false)
  return (
    <button
      onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1500) }) }}
      className="text-gray-600 hover:text-[#00D4FF] transition-colors shrink-0 ml-1"
      title="Copy address"
    >
      {ok ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
    </button>
  )
}


function ScoreRing({ score, grade }: { score: number; grade: string }) {
  const circumference = 2 * Math.PI * 58
  const offset = circumference - (score / 100) * circumference
  const color = grade === 'A' ? '#34d399' : grade === 'B' ? '#4ade80' : grade === 'C' ? '#facc15' : grade === 'D' ? '#fb923c' : '#f87171'
  return (
    <div className="relative w-36 h-36 flex items-center justify-center">
      <svg className="w-36 h-36 -rotate-90" viewBox="0 0 128 128">
        <circle cx="64" cy="64" r="58" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="8" />
        <circle cx="64" cy="64" r="58" fill="none" stroke={color} strokeWidth="8"
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
          className="transition-all duration-1000" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold">{score}</span>
        <span className={`text-sm font-medium ${GRADE_COLORS[grade]?.split(' ')[0] || 'text-gray-400'}`}>{grade}</span>
      </div>
    </div>
  )
}

function SubScore({ label, score, max, icon }: { label: string; score: number; max: number; icon: React.ReactNode }) {
  const pct = max > 0 ? (score / max) * 100 : 0
  const color = pct >= 80 ? 'bg-emerald-500' : pct >= 60 ? 'bg-green-500' : pct >= 40 ? 'bg-yellow-500' : pct >= 20 ? 'bg-orange-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-3">
      <div className="text-gray-400 w-5">{icon}</div>
      <div className="flex-1">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm text-gray-300">{label}</span>
          <span className="text-sm font-medium">{score}/{max}</span>
        </div>
        <div className="h-2 rounded-full bg-white/5 overflow-hidden">
          <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  )
}

function RiskBadge({ risk }: { risk: string }) {
  const isHoneypot = risk.toLowerCase().includes('honeypot')
  const isCritical = isHoneypot || risk.toLowerCase().includes('selfdestruct') || risk.includes('Extreme')
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
      isCritical ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
      'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
    }`}>
      {isCritical ? <XCircle className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
      {risk}
    </span>
  )
}

function BoolBadge({ value, trueLabel, falseLabel }: { value: boolean | null; trueLabel: string; falseLabel: string }) {
  const { t } = useTranslation()
  if (value === null) return <span className="text-xs text-gray-500">{t.safety.unknown}</span>
  return value ? (
    <span className="inline-flex items-center gap-1 text-xs text-emerald-400"><CheckCircle className="h-3 w-3" />{trueLabel}</span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs text-red-400"><XCircle className="h-3 w-3" />{falseLabel}</span>
  )
}

function ContractCheckRow({ label, badge, tooltip, href }: { label: string; badge: React.ReactNode; tooltip: string; href: string }) {
  const { t } = useTranslation()
  return (
    <div className="flex justify-between items-center">
      <span className="text-gray-400">{label}</span>
      <span className="flex items-center gap-2">
        {badge}
        <span className="group relative">
          <Info className="h-3 w-3 text-gray-600 hover:text-[#00D4FF] cursor-help transition-colors" />
          <span className="pointer-events-none absolute bottom-full right-0 mb-2 w-64 rounded-lg bg-gray-800 border border-white/10 px-3 py-2 text-xs text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-xl">
            {tooltip}
          </span>
        </span>
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-gray-600 hover:text-[#00D4FF] transition-colors" title={t.safety.verify_on_explorer}>
          <ExternalLink className="h-3 w-3" />
        </a>
      </span>
    </div>
  )
}

function ConfidenceBadge({ level, resolvedLevel }: { level: string | null; resolvedLevel?: string }) {
  const effectiveLevel = resolvedLevel ?? level ?? ''
  const conf = CONFIDENCE_INFO[effectiveLevel] ?? CONFIDENCE_INFO.suspect
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${conf.bg} ${conf.color} cursor-help`}
      title={conf.explanation}
    >
      {conf.label}
    </span>
  )
}

// ─── Token Intelligence types ────────────────────────────────────────────────

interface TokenIntelligence {
  token_address: string
  token_symbol: string | null
  project_summary: {
    name: string
    description: string
    type: string
    objective: string
    team: string | null
    launch_date: string | null
    links: { website?: string; twitter?: string; telegram?: string; discord?: string }
  } | null
  social_timeline: {
    date: string
    category: string
    title: string
    description: string
    cause: string | null
    impact: string
    sentiment: number
    source_tweet_ids: string[]
  }[]
  mentioned_addresses: {
    address: string
    context: string
    type: string
    first_mentioned_at: string
    mention_count: number
    tweet_ids: string[]
  }[]
  chart_analyses: {
    tweet_id: string
    image_url: string
    analysis: string
    date: string
  }[]
  analyzed_tweet_count: number
  last_analyzed_at: string | null
  model_version: string | null
}

const INTEL_CATEGORY_STYLES: Record<string, { color: string; label: string }> = {
  launch: { color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', label: 'Launch' },
  pump: { color: 'bg-green-500/15 text-green-400 border-green-500/30', label: 'Pump' },
  dump: { color: 'bg-red-500/15 text-red-400 border-red-500/30', label: 'Dump' },
  exploit: { color: 'bg-red-500/15 text-red-400 border-red-500/30', label: 'Exploit' },
  partnership: { color: 'bg-blue-500/15 text-blue-400 border-blue-500/30', label: 'Partnership' },
  listing: { color: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30', label: 'Listing' },
  controversy: { color: 'bg-orange-500/15 text-orange-400 border-orange-500/30', label: 'Controversy' },
  milestone: { color: 'bg-purple-500/15 text-purple-400 border-purple-500/30', label: 'Milestone' },
  rug_pull: { color: 'bg-red-500/15 text-red-400 border-red-500/30', label: 'Rug Pull' },
  community_split: { color: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30', label: 'Split' },
  migration: { color: 'bg-blue-500/15 text-blue-400 border-blue-500/30', label: 'Migration' },
  update: { color: 'bg-gray-500/15 text-gray-400 border-gray-500/30', label: 'Update' },
  airdrop: { color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', label: 'Airdrop' },
  other: { color: 'bg-gray-500/15 text-gray-400 border-gray-500/30', label: 'Event' },
}

const PROJECT_TYPE_STYLES: Record<string, string> = {
  defi: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  meme: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  nft: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  utility: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  bridge: 'bg-green-500/15 text-green-400 border-green-500/30',
  stablecoin: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  wrapped: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
  unknown: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
}

// ─── Social Sentiment types ──────────────────────────────────────────────────

interface SentimentArgument {
  stance: 'positive' | 'negative'
  argument: string
  frequency: number
  source_tweet_ids: string[]
  earliest_date?: string   // YYYY-MM-DD from source tweets
  latest_date?: string     // YYYY-MM-DD from source tweets
  ai_evaluation?: {
    factual: 'confirmed' | 'partial' | 'unverifiable' | 'debunked'
    evidence: string
    pertinence_score: number
    conclusion: string
  }
}

interface SentimentVerdict {
  overall_assessment: string
  positive_validity: number | null
  negative_validity: number | null
  key_facts_confirmed: string[]
  key_facts_debunked: string[]
  unverifiable_claims: string[]
  risk_factors: string[]
  conclusion: string
}

interface TokenSentiment {
  token_address: string
  token_symbol: string | null
  community_score: number | null
  community_tweet_count: number
  community_positive_count: number
  community_negative_count: number
  community_arguments: SentimentArgument[]
  external_score: number | null
  external_tweet_count: number
  external_positive_count: number
  external_negative_count: number
  external_arguments: SentimentArgument[]
  verdict: SentimentVerdict
  sentiment_history: { date: string; community_score: number; external_score: number; community_tweets: number; external_tweets: number }[]
  analyzed_tweet_count: number
  last_analyzed_at: string | null
}

// ─── Safety API ──────────────────────────────────────────────────────────────

const SAFETY_API = import.meta.env.VITE_SAFETY_API_URL || 'https://safety.openpulsechain.com'

// ─── Main component ─────────────────────────────────────────────────────────

export function TokenSafetyPage() {
  const { t } = useTranslation()
  const { address } = useParams<{ address: string }>()

  // Core safety data
  const [safety, setSafety] = useState<SafetyScore | null>(null)
  const [scamVerdict, setScamVerdict] = useState<ScamVerdict | null>(null)
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Section ④: LP pools from token_pools_live (replaces old Safety API /liquidity)
  const [livePools, setLivePools] = useState<PoolLive[]>([])
  const [poolsOpen, setPoolsOpen] = useState(false)

  // Auto-verification of "unknown" tokens flagged as suspect — multi-source resolution
  const [tokenVerifications, setTokenVerifications] = useState<Record<string, {
    loading: boolean
    // DexScreener signals
    dxPairs: number; dxLiquidity: number; dxVolume24h: number; dxName?: string; dxSymbol?: string
    // PulseChain Scan signals
    scanVerified: boolean; scanHolders: number
    // Resolved confidence
    resolvedConfidence: 'high' | 'medium' | 'low' | 'suspect'
    resolvedReason: string
  }>>({})

  // Section ③: Deployer reputation
  const [deployer, setDeployer] = useState<DeployerInfo | null>(null)
  const [deployerLoading, setDeployerLoading] = useState(true)
  const [deployerInfoOpen, setDeployerInfoOpen] = useState(false)

  // Section ⑤: Leagues integration (whale/holder tier data)
  const [leagueSummary, setLeagueSummary] = useState<LeagueSummary | null>(null)
  const [leagueHolders, setLeagueHolders] = useState<LeagueHolder[]>([])
  const [leagueFamilies, setLeagueFamilies] = useState<LeagueFamily[]>([])
  const [leagueOpen, setLeagueOpen] = useState(false)
  const [tokenTotalSupply, setTokenTotalSupply] = useState<number | null>(null)
  const [expandedFamilies, setExpandedFamilies] = useState<Record<string, boolean>>({})
  const [familyDaughters, setFamilyDaughters] = useState<Record<string, { holder_address: string; balance_pct: number; tier: string }[]>>({})

  // Section ⑥: Token identity comparison
  const [verifiedTokens, setVerifiedTokens] = useState<Record<string, VerifiedToken[]>>({})

  // Section ⑦: Monitoring history + confidence events
  const [monitoringHistory, setMonitoringHistory] = useState<MonitoringSnapshot[]>([])
  const [confidenceEvents, setConfidenceEvents] = useState<{ pair_address: string; event_summary: string; prev_confidence: string; new_confidence: string; created_at: string }[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)

  // Section ⑧: Social Sentiment (dual-perspective)
  const [tokenSentiment, setTokenSentiment] = useState<TokenSentiment | null>(null)
  const [sentimentLoading, setSentimentLoading] = useState(true)
  const [sentimentModalOpen, setSentimentModalOpen] = useState(false)
  const [sentimentTab, setSentimentTab] = useState<'positive' | 'negative'>('positive')


  // Section ⑨⑩: Token Intelligence (AI profile + social history)
  const [tokenIntel, setTokenIntel] = useState<TokenIntelligence | null>(null)
  const [intelLoading, setIntelLoading] = useState(true)
  const [timelineModalOpen, setTimelineModalOpen] = useState(false)

  // P0-C: Safety API health check
  const [apiAvailable, setApiAvailable] = useState<boolean | null>(null)

  // Honeypot detail popup (enriched from Safety API)
  const [honeypotOpen, setHoneypotOpen] = useState(false)
  const [honeypotDetail, setHoneypotDetail] = useState<HoneypotDetail | null>(null)
  const [honeypotLoading, setHoneypotLoading] = useState(false)

  const loadHoneypotDetail = () => {
    setHoneypotOpen(true)
    if (honeypotDetail || !address) return
    setHoneypotLoading(true)
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 20000)
    fetch(`${SAFETY_API}/api/v1/token/${address.toLowerCase()}/safety?fresh=true`, { signal: ctrl.signal })
      .then(r => { clearTimeout(t); if (!r.ok) throw new Error(`API ${r.status}`); return r.json() })
      .then(json => {
        const hp = json.data?.honeypot
        if (hp) setHoneypotDetail(hp)
        setHoneypotLoading(false)
      })
      .catch(() => setHoneypotLoading(false))
  }

  // Legacy: Safety API pair list (anchored/capped analysis)
  const [pairs, setPairs] = useState<LiquidityPair[]>([])
  const [pairsOpen, setPairsOpen] = useState(false)
  const [pairsLoading, setPairsLoading] = useState(false)

  const loadPairs = () => {
    if (pairs.length > 0) { setPairsOpen(true); return }
    if (!address) return
    setPairsOpen(true)
    setPairsLoading(true)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    fetch(`${SAFETY_API}/api/v1/token/${address.toLowerCase()}/liquidity?fresh=true`, { signal: controller.signal })
      .then(r => { clearTimeout(timeout); if (!r.ok) throw new Error(`API ${r.status}`); return r.json() })
      .then(json => { setPairs(json.pairs || []); setPairsLoading(false) })
      .catch(() => setPairsLoading(false))
  }

  // P0-C: Health check on mount — detect if Safety API is available
  useEffect(() => {
    if (!SAFETY_API) { setApiAvailable(false); return }
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 5000)
    fetch(`${SAFETY_API}/health`, { signal: ctrl.signal })
      .then(r => { clearTimeout(t); setApiAvailable(r.ok) })
      .catch(() => { clearTimeout(t); setApiAvailable(false) })
  }, [])

  const applySafety = (row: SafetyScore) => {
    setSafety(row)
    const parsed = parseSafetyPayload(row as unknown)
    if (parsed.warnings.length > 0) {
      reportSafetyContractWarning('token_detail_page', parsed.warnings, row.token_address)
    }
    setScamVerdict(parsed.scam)
  }

  useEffect(() => {
    if (!address) return
    const addr = address.toLowerCase()

    // ── 1. Safety score (database cache → Safety API fallback) ──
    supabase
      .from('token_safety_scores')
      .select('*')
      .eq('token_address', addr)
      .single()
      .then(({ data, error: err }) => {
        if (data && !err) {
          applySafety(data as SafetyScore)
          setLoading(false)
        } else if (SAFETY_API && apiAvailable !== false) {
          setAnalyzing(true)
          setLoading(false)
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), 30000)
          fetch(`${SAFETY_API}/api/v1/token/${addr}/safety?fresh=true`, { signal: controller.signal })
            .then(r => { clearTimeout(timeout); return r.json() })
            .then(json => {
              if (json.data) {
                supabase.from('token_safety_scores').select('*').eq('token_address', addr).single()
                  .then(({ data: refreshed }) => {
                    if (refreshed) applySafety(refreshed as SafetyScore)
                    else setError('Analysis completed but score not found.')
                    setAnalyzing(false)
                  })
              } else {
                setError('Analysis failed. Try again later.')
                setAnalyzing(false)
              }
            })
            .catch(() => { setError('Safety API unavailable. Try again later.'); setApiAvailable(false); setAnalyzing(false) })
        } else {
          setError(apiAvailable === false
            ? 'Safety analysis temporarily unavailable. The token has not been analyzed yet.'
            : 'No safety score available yet for this token.')
          setLoading(false)
        }
      })

    // ── 2. Token info ──
    supabase
      .from('pulsechain_tokens')
      .select('address, symbol, name')
      .eq('address', addr)
      .single()
      .then(({ data }) => { if (data) setTokenInfo(data) })

    // ── 2b. Total supply from Scan API (for holder balance calc) ──
    fetch(`https://api.scan.pulsechain.com/api/v2/tokens/${addr}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.total_supply && d?.decimals != null) {
          setTokenTotalSupply(Number(d.total_supply) / Math.pow(10, Number(d.decimals)))
        }
      })
      .catch(() => {})

    // ── 3. Live pools → monitoring history + verified tokens ──
    supabase
      .from('token_pools_live')
      .select('*')
      .eq('token_address', addr)
      .order('liquidity_usd', { ascending: false, nullsFirst: false })
      .then(({ data: poolData }) => {
        const pools = (poolData ?? []) as PoolLive[]
        setLivePools(pools)
        if (pools.length === 0) return

        // 3a. Monitoring history for all pools
        const pairAddresses = pools.map(p => p.pair_address)
        supabase
          .from('token_monitoring_pools')
          .select('pair_address, snapshot_at, pool_confidence, pool_is_legitimate, pool_spam_reason, reserve_usd, volume_24h_usd, token0_symbol, token1_symbol, token0_is_known, token0_is_core, token1_is_known, token1_is_core')
          .in('pair_address', pairAddresses)
          .order('snapshot_at', { ascending: false })
          .limit(200)
          .then(({ data }) => setMonitoringHistory((data ?? []) as MonitoringSnapshot[]))

        // 3a-bis. Confidence transition events (from pool_confidence_events table)
        supabase
          .from('pool_confidence_events')
          .select('pair_address, event_summary, prev_confidence, new_confidence, created_at')
          .in('pair_address', pairAddresses)
          .order('created_at', { ascending: false })
          .limit(50)
          .then(({ data }) => setConfidenceEvents((data ?? []) as typeof confidenceEvents))

        // 3a-ter. Auto-resolve unknown tokens: DexScreener + PulseChain Scan
        const unknownAddresses = new Set<string>()
        for (const pool of pools) {
          if (pool.pool_confidence === 'suspect' && pool.pool_spam_reason) {
            const reasons = pool.pool_spam_reason.split('; ').map(r => r.split(':')[0].trim())
            if (reasons.includes('unknown_token0') && pool.base_token_address) unknownAddresses.add(pool.base_token_address.toLowerCase())
            if (reasons.includes('unknown_token1') && pool.quote_token_address) unknownAddresses.add(pool.quote_token_address.toLowerCase())
          }
        }
        if (addr) unknownAddresses.delete(addr.toLowerCase())
        if (unknownAddresses.size > 0) {
          const addrArray = [...unknownAddresses].slice(0, 30)
          // Mark as loading
          setTokenVerifications(prev => {
            const next = { ...prev }
            for (const a of addrArray) next[a] = { loading: true, dxPairs: 0, dxLiquidity: 0, dxVolume24h: 0, scanVerified: false, scanHolders: 0, resolvedConfidence: 'suspect', resolvedReason: '' }
            return next
          })

          // Source 1: DexScreener batch lookup
          const dxPromise = fetch(`https://api.dexscreener.com/tokens/v1/pulsechain/${addrArray.join(',')}`)
            .then(r => r.ok ? r.json() : [])
            .then((pairs: { baseToken?: { address?: string; name?: string; symbol?: string }; quoteToken?: { address?: string; name?: string; symbol?: string }; liquidity?: { usd?: number }; volume?: { h24?: number } }[]) => {
              const agg: Record<string, { pairs: number; liquidity: number; volume: number; name?: string; symbol?: string }> = {}
              for (const a of addrArray) agg[a] = { pairs: 0, liquidity: 0, volume: 0 }
              for (const pair of (pairs ?? [])) {
                for (const tkn of [pair.baseToken, pair.quoteToken]) {
                  const a = tkn?.address?.toLowerCase()
                  if (a && agg[a] !== undefined) {
                    agg[a].pairs++
                    agg[a].liquidity += pair.liquidity?.usd ?? 0
                    agg[a].volume += pair.volume?.h24 ?? 0
                    if (!agg[a].name) { agg[a].name = tkn?.name; agg[a].symbol = tkn?.symbol }
                  }
                }
              }
              return agg
            })
            .catch(() => {
              const empty: Record<string, { pairs: number; liquidity: number; volume: number }> = {}
              for (const a of addrArray) empty[a] = { pairs: 0, liquidity: 0, volume: 0 }
              return empty
            })

          // Source 2: PulseChain Scan — parallel lookups per token (holder count + contract verified)
          const scanPromise = Promise.all(addrArray.map(a =>
            fetch(`https://api.scan.pulsechain.com/api/v2/tokens/${a}`)
              .then(r => r.ok ? r.json() : null)
              .then(d => ({
                address: a,
                verified: d?.is_verified_via_sourcify === true || d?.has_custom_methods_write === true,
                holders: typeof d?.holders_count === 'number' ? d.holders_count : (typeof d?.holders === 'string' ? parseInt(d.holders, 10) || 0 : 0),
              }))
              .catch(() => ({ address: a, verified: false, holders: 0 }))
          )).then(results => {
            const map: Record<string, { verified: boolean; holders: number }> = {}
            for (const r of results) map[r.address] = { verified: r.verified, holders: r.holders }
            return map
          })

          // Combine both sources and compute resolved confidence
          Promise.all([dxPromise, scanPromise]).then(([dxData, scanData]) => {
            setTokenVerifications(prev => {
              const next = { ...prev }
              for (const a of addrArray) {
                const dx = dxData[a] ?? { pairs: 0, liquidity: 0, volume: 0 }
                const scan = scanData[a] ?? { verified: false, holders: 0 }
                const { level, reason } = computeResolvedConfidence(
                  { pairs: dx.pairs, liquidity: dx.liquidity, volume: dx.volume },
                  scan
                )
                next[a] = {
                  loading: false,
                  dxPairs: dx.pairs, dxLiquidity: dx.liquidity, dxVolume24h: dx.volume,
                  dxName: (dx as { name?: string }).name, dxSymbol: (dx as { symbol?: string }).symbol,
                  scanVerified: scan.verified, scanHolders: scan.holders,
                  resolvedConfidence: level, resolvedReason: reason,
                }
              }
              return next
            })
          })
        }

        // 3b. Verified tokens for identity comparison (section ⑥)
        const symbols = [...new Set(
          pools.flatMap(p => [p.base_token_symbol, p.quote_token_symbol]).filter(Boolean)
        )] as string[]
        if (symbols.length > 0) {
          supabase
            .from('pulsechain_tokens')
            .select('address, symbol, name')
            .in('symbol', symbols)
            .gt('total_volume_usd', 0)
            .order('total_liquidity_usd', { ascending: false, nullsFirst: false })
            .then(({ data }) => {
              const grouped: Record<string, VerifiedToken[]> = {}
              for (const t of (data ?? []) as VerifiedToken[]) {
                if (!grouped[t.symbol]) grouped[t.symbol] = []
                grouped[t.symbol].push(t)
              }
              setVerifiedTokens(grouped)
            })
        }
      })

    // ── 4. Deployer reputation (Safety API) ──
    setDeployerLoading(true)
    const deployerController = new AbortController()
    const deployerTimeout = setTimeout(() => deployerController.abort(), 10000)
    fetch(`${SAFETY_API}/api/v1/token/${addr}/deployer`, { signal: deployerController.signal })
      .then(r => { clearTimeout(deployerTimeout); if (!r.ok) throw new Error(`API ${r.status}`); return r.json() })
      .then(json => {
        if (json.data) {
          const d = json.data
          setDeployer({
            deployer_address: d.deployer || d.deployer_address || '',
            tokens_deployed: d.tokens_deployed ?? 0,
            dead_tokens: d.tokens_dead ?? d.dead_tokens ?? 0,
            mortality_rate: (d.dead_ratio ?? 0) / 100,
            risk_level: d.risk_level ?? 'unknown',
          })
        }
        setDeployerLoading(false)
      })
      .catch(() => setDeployerLoading(false))

    // ── 5c. Token Intelligence (AI profile) ──
    setIntelLoading(true)
    supabase
      .from('token_intelligence')
      .select('*')
      .eq('token_address', addr)
      .maybeSingle()
      .then(async ({ data }) => {
        if (data) {
          setTokenIntel(data as TokenIntelligence)
          setIntelLoading(false)
          return
        }
        const sym = ADDRESS_TO_SYMBOL[addr] || tokenInfo?.symbol?.toUpperCase()
        if (!sym) { setIntelLoading(false); return }
        const candidates = [sym, ...(SENTIMENT_ALIASES[sym] || [])]
        const { data: rows } = await supabase
          .from('token_intelligence')
          .select('*')
          .in('token_symbol', candidates)
          .order('analyzed_tweet_count', { ascending: false })
          .limit(1)
        setTokenIntel(rows?.[0] as TokenIntelligence | null ?? null)
        setIntelLoading(false)
      })

    // ── 5d. Token Sentiment (dual-perspective) ──
    // Try by address first, then fallback by lowercase symbol
    // (legacy data may use symbol as token_address, e.g. "pls" instead of "0xa1077...")
    setSentimentLoading(true)
    supabase
      .from('token_sentiment')
      .select('*')
      .eq('token_address', addr)
      .maybeSingle()
      .then(async ({ data }) => {
        if (data) {
          setTokenSentiment(data as TokenSentiment)
          setSentimentLoading(false)
          return
        }
        // Fallback: search by token_symbol (legacy data uses LLM-extracted symbol)
        // Use ADDRESS_TO_SYMBOL (sync) since tokenInfo may not be loaded yet
        const sym = ADDRESS_TO_SYMBOL[addr] || tokenInfo?.symbol?.toUpperCase()
        if (!sym) { setSentimentLoading(false); return }
        const candidates = [sym, ...(SENTIMENT_ALIASES[sym] || [])]
        const { data: rows } = await supabase
          .from('token_sentiment')
          .select('*')
          .in('token_symbol', candidates)
          .order('analyzed_tweet_count', { ascending: false })
          .limit(1)
        setTokenSentiment(rows?.[0] as TokenSentiment | null ?? null)
        setSentimentLoading(false)
      })

    // ── 5. Leagues data (holder tiers — only for tracked tokens) ──
    const leagueSymbol = LEAGUE_TOKEN_ADDRESSES[addr]
    if (leagueSymbol) {
      // Summary (tier counts)
      supabase
        .from('holder_league_current')
        .select('total_holders, poseidon_count, whale_count, shark_count, dolphin_count, squid_count, turtle_count, updated_at')
        .eq('token_symbol', leagueSymbol)
        .single()
        .then(({ data }) => { if (data) setLeagueSummary(data as LeagueSummary) })

      // Top holders (limit to top tiers for display)
      supabase
        .from('holder_league_addresses')
        .select('holder_address, balance_pct, tier, family_id')
        .eq('token_symbol', leagueSymbol)
        .in('tier', ['poseidon', 'whale', 'shark'])
        .order('balance_pct', { ascending: false })
        .limit(20)
        .then(({ data }) => setLeagueHolders((data ?? []) as LeagueHolder[]))

      // Families (whale clusters)
      supabase
        .from('holder_league_families')
        .select('family_id, mother_address, daughter_count, combined_balance_pct, combined_tier, link_types')
        .eq('token_symbol', leagueSymbol)
        .order('combined_balance_pct', { ascending: false })
        .limit(10)
        .then(({ data }) => setLeagueFamilies((data ?? []) as LeagueFamily[]))
    }

  }, [address])

  // ── Loading states ──

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-8 w-8 animate-spin text-[#00D4FF]" />
      </div>
    )
  }

  if (analyzing) {
    return (
      <div className="text-center py-20">
        <Loader2 className="h-12 w-12 animate-spin text-[#00D4FF] mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-300 mb-2">{t.safety.analyzing}</h2>
        <p className="text-gray-500">{t.safety.simulation_loading}</p>
        <p className="text-gray-600 text-sm mt-2">{t.safety.may_take_seconds}</p>
      </div>
    )
  }

  if (error || !safety) {
    return (
      <div className="text-center py-20">
        <Shield className="h-16 w-16 text-gray-600 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-300 mb-2">{t.safety.no_scores}</h2>
        <p className="text-gray-500 mb-4">{error || 'Token not analyzed yet.'}</p>
        {apiAvailable === false && (
          <div className="inline-block rounded-lg bg-orange-500/10 border border-orange-500/20 px-4 py-2 mb-4">
            <p className="text-orange-400 text-sm">{t.safety.api_unavailable_cached}</p>
          </div>
        )}
        <div>
          <Link to="/safety" className="inline-flex items-center gap-2 text-[#00D4FF] hover:underline">
            <ArrowLeft className="h-4 w-4" /> {t.safety.title}
          </Link>
        </div>
      </div>
    )
  }

  const grade = safety.grade || 'F'
  const legitimatePools = livePools.filter(p => p.pool_is_legitimate)
  const suspectPools = livePools.filter(p => !p.pool_is_legitimate)

  // Unique token addresses from all pools for identity comparison
  const poolTokenEntries = livePools.flatMap(p => [
    { symbol: p.base_token_symbol, address: p.base_token_address, role: 'Base' },
    { symbol: p.quote_token_symbol, address: p.quote_token_address, role: 'Quote' },
  ]).filter(t => t.address)
  // Deduplicate by address
  const uniquePoolTokens = Object.values(
    poolTokenEntries.reduce((acc, t) => {
      const key = t.address!.toLowerCase()
      if (!acc[key]) acc[key] = t
      return acc
    }, {} as Record<string, typeof poolTokenEntries[0]>)
  )

  // Detect transitions: live pool confidence vs last monitoring snapshot
  const poolTransitions: Record<string, { from: string; to: string }> = {}
  for (const pool of livePools) {
    const lastSnap = monitoringHistory.find(s => s.pair_address === pool.pair_address)
    if (lastSnap && lastSnap.pool_confidence !== (pool.pool_confidence ?? 'suspect')) {
      poolTransitions[pool.pair_address] = {
        from: lastSnap.pool_confidence,
        to: pool.pool_confidence ?? 'suspect',
      }
    }
  }
  const hasAnyTransition = Object.keys(poolTransitions).length > 0

  return (
    <div className="space-y-6">
      {/* ── Breadcrumb ── */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link to="/safety" className="hover:text-[#00D4FF] transition-colors">{t.safety.title}</Link>
        <span>/</span>
        <span className="text-gray-300 font-mono">{address?.slice(0, 10)}...{address?.slice(-6)}</span>
      </div>

      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
        <ScoreRing score={safety.score} grade={grade} />
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            {address && <TokenLogo address={address} size="md" />}
            <h1 className="text-2xl font-bold">
              {tokenInfo ? `${tokenInfo.name} (${tokenInfo.symbol})` : `Token ${address?.slice(0, 10)}...`}
            </h1>
            <span className={`px-3 py-1 rounded-lg border text-lg font-bold ${GRADE_COLORS[grade]}`}>
              {t.common.grade} {grade}
            </span>
            <ShareButton
              title={`${tokenInfo?.symbol || 'Token'} Safety Score: ${safety.score}/100 (Grade ${grade})`}
              text="Check any PulseChain token on OpenPulsechain"
            />
          </div>
          <CopyAddress address={address || ''} />
          {safety.risks && safety.risks.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {safety.risks.map((risk, i) => <RiskBadge key={i} risk={risk} />)}
            </div>
          )}
          {safety.risks?.length === 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-sm border border-emerald-500/20">
              <CheckCircle className="h-4 w-4" /> {t.safety.no_alerts_message}
            </span>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          DUAL SAFETY VERDICT — Honeypot + Scam (INVARIANT: always both cards)
          ══════════════════════════════════════════════════════════════════════ */}
      <SafetyVerdictGrid
        hp={{ is_honeypot: safety.is_honeypot }}
        scam={scamVerdict}
        labels={{
          honeypot_title: 'Honeypot Check',
          scam_title: 'Scam Analysis',
          verdict_honeypot: t.safety.verdict_honeypot,
          verdict_safe: t.safety.verdict_safe,
          verdict_inconclusive: t.safety.verdict_inconclusive,
          verdict_honeypot_message: t.safety.verdict_honeypot_message,
          verdict_safe_message: t.safety.verdict_safe_message,
          verdict_inconclusive_message: t.safety.verdict_inconclusive_message,
        }}
      />

      {/* ── Grid: 2-column layout for modules ── */}
      <div className="columns-1 lg:columns-2 gap-6 space-y-6">

      {/* ══════════════════════════════════════════════════════════════════════
          ① CONTRACT ANALYSIS (25 pts)
          ══════════════════════════════════════════════════════════════════════ */}
      <div id="contract" className="rounded-xl border border-white/5 bg-gray-900/50 p-5 space-y-4 break-inside-avoid">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
          <FileCode className="h-4 w-4 text-[#00D4FF]" />
          {t.common.contract}
          <a
            href={`https://scan.mypinata.cloud/ipfs/bafybeienxyoyrhn5tswclvd3gdjy5mtkkwmu37aqtml6onbf7xnb3o22pe/#/address/${address}`}
            target="_blank" rel="noopener noreferrer"
            className="ml-auto text-[10px] text-gray-600 hover:text-[#00D4FF] transition-colors flex items-center gap-1 font-normal normal-case tracking-normal"
          >
            {t.common.explorer} <ExternalLink className="h-3 w-3" />
          </a>
        </h3>
        <SubScore label={t.common.contract} score={safety.contract_score} max={25} icon={<FileCode className="h-4 w-4" />} />
        <div className="space-y-2 text-sm">
          <ContractCheckRow
            label={t.safety.source_code_verified}
            badge={<BoolBadge value={safety.is_verified} trueLabel={t.safety.verified_on_explorer} falseLabel={t.safety.not_verified} />}
            tooltip={t.safety.tooltip_source_code}
            href={`https://scan.mypinata.cloud/ipfs/bafybeienxyoyrhn5tswclvd3gdjy5mtkkwmu37aqtml6onbf7xnb3o22pe/#/address/${address}?tab=contract`}
          />
          <ContractCheckRow
            label={t.safety.proxy_contract}
            badge={<BoolBadge value={safety.is_proxy ? false : true} trueLabel={t.safety.no_proxy} falseLabel={t.safety.upgradeable_proxy} />}
            tooltip='Explorer → "Read Contract" → chercher implementation() ou upgradeTo()'
            href={`https://scan.mypinata.cloud/ipfs/bafybeienxyoyrhn5tswclvd3gdjy5mtkkwmu37aqtml6onbf7xnb3o22pe/#/address/${address}?tab=read_contract`}
          />
          <ContractCheckRow
            label={t.safety.ownership}
            badge={<BoolBadge value={safety.ownership_renounced} trueLabel={t.safety.renounced} falseLabel={t.safety.active_owner} />}
            tooltip='Explorer → "Read Contract" → appeler owner() — si 0x000...000 = renounced'
            href={`https://scan.mypinata.cloud/ipfs/bafybeienxyoyrhn5tswclvd3gdjy5mtkkwmu37aqtml6onbf7xnb3o22pe/#/address/${address}?tab=read_contract`}
          />
          <ContractCheckRow
            label={t.safety.mint_function}
            badge={<BoolBadge value={!safety.has_mint} trueLabel={t.safety.no_mint} falseLabel={t.safety.can_mint} />}
            tooltip='Explorer → "Write Contract" → chercher mint() ou _mint() dans les fonctions'
            href={`https://scan.mypinata.cloud/ipfs/bafybeienxyoyrhn5tswclvd3gdjy5mtkkwmu37aqtml6onbf7xnb3o22pe/#/address/${address}?tab=write_contract`}
          />
          <ContractCheckRow
            label={t.safety.blacklist}
            badge={<BoolBadge value={!safety.has_blacklist} trueLabel={t.safety.no_blacklist} falseLabel={t.safety.can_blacklist} />}
            tooltip='Explorer → "Read/Write Contract" → chercher blacklist(), isBlacklisted(), addToBlacklist()'
            href={`https://scan.mypinata.cloud/ipfs/bafybeienxyoyrhn5tswclvd3gdjy5mtkkwmu37aqtml6onbf7xnb3o22pe/#/address/${address}?tab=read_contract`}
          />
        </div>
        {safety.contract_dangers && safety.contract_dangers.length > 0 && (
          <div className="space-y-1.5 pt-2 border-t border-white/5">
            <span className="text-xs text-red-400 font-bold">{t.safety.table_risks}:</span>
            {safety.contract_dangers.map((d, i) => (
              <div key={i} className="text-xs text-red-300 bg-red-500/5 border border-red-500/10 rounded px-2.5 py-1.5">
                {d}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          HONEYPOT TEST (30 pts) — summary card + popup detail
          ══════════════════════════════════════════════════════════════════════ */}
      <div id="honeypot" className="rounded-xl border border-white/5 bg-gray-900/50 p-5 space-y-4 break-inside-avoid">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
          <Shield className="h-4 w-4 text-[#00D4FF]" />
          {t.safety.table_honeypot}
        </h3>
        <SubScore label={t.safety.table_honeypot} score={safety.honeypot_score} max={30} icon={<Shield className="h-4 w-4" />} />

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">{t.safety.buy_tax}</span>
            <span className={safety.buy_tax_pct != null && safety.buy_tax_pct > 10 ? 'text-orange-400 font-medium' : ''}>
              {safety.buy_tax_pct != null ? `${safety.buy_tax_pct}%` : '-'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">{t.safety.sell_tax}</span>
            <span className={safety.sell_tax_pct != null && safety.sell_tax_pct > 10 ? 'text-red-400 font-medium' : ''}>
              {safety.sell_tax_pct != null ? `${safety.sell_tax_pct}%` : '-'}
            </span>
          </div>
        </div>

        <button
          onClick={loadHoneypotDetail}
          className="w-full flex items-center justify-center gap-2 text-sm font-semibold text-[#00D4FF] hover:text-white rounded-lg border border-[#00D4FF]/30 bg-[#00D4FF]/5 hover:bg-[#00D4FF]/10 py-2.5 transition-colors"
        >
          {t.safety.full_report_link}
        </button>

        <p className="text-[10px] text-gray-600">
          {t.safety.router_via}.
          {' '}
          <a
            href={`https://scan.mypinata.cloud/ipfs/bafybeienxyoyrhn5tswclvd3gdjy5mtkkwmu37aqtml6onbf7xnb3o22pe/#/address/${address}?tab=contract`}
            target="_blank" rel="noopener noreferrer"
            className="text-[#00D4FF]/60 hover:text-[#00D4FF] transition-colors inline-flex items-center gap-0.5"
          >
            View contract <ExternalLink className="h-2.5 w-2.5 inline" />
          </a>
        </p>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          ③ DEPLOYER REPUTATION (informational)
          ══════════════════════════════════════════════════════════════════════ */}
      <div id="deployer" className="rounded-xl border border-white/5 bg-gray-900/50 p-5 space-y-4 break-inside-avoid">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
          <Fingerprint className="h-4 w-4 text-[#00D4FF]" />
          {t.safety.deployer_reputation}
          <span className="relative ml-auto flex items-center">
            <button
              onClick={() => setDeployerInfoOpen(!deployerInfoOpen)}
              className="flex items-center gap-1 cursor-pointer hover:opacity-80 transition-opacity"
              title="How is this calculated?"
            >
              <span className="text-[10px] text-[#00D4FF] font-semibold normal-case tracking-normal">{t.safety.informational}</span>
              <Info className="h-3.5 w-3.5 text-gray-500 hover:text-[#00D4FF]" />
            </button>
            {deployerInfoOpen && (
              <div className="absolute right-0 top-7 z-30 w-[480px] rounded-xl border border-[#00D4FF]/20 bg-gray-900 shadow-xl shadow-black/40 px-4 py-3 space-y-2 text-[10px] text-gray-400 leading-relaxed normal-case tracking-normal font-normal">
                <button
                  onClick={() => setDeployerInfoOpen(false)}
                  className="absolute top-2 right-2 text-gray-500 hover:text-white transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                <p>
                  The <strong className="text-gray-300">deployer</strong> is the wallet that created this token's smart contract. We retrieve it via the contract's creation transaction on PulseChain Explorer.
                </p>
                <p>
                  <strong className="text-gray-300">Tokens Deployed</strong> — We scan all internal transactions (contract creations) from this deployer address, then filter for ERC-20 tokens only.
                </p>
                <p>
                  <strong className="text-gray-300">Dead Tokens</strong> — A deployed token is considered dead if it has fewer than 5 holders. The mortality rate = dead / total deployed.
                </p>
                <p>
                  <strong className="text-gray-300">Risk Level</strong> — Calculated from mortality rate + number of dead tokens:
                  {' '}<span className="text-emerald-400">Low</span> ({'<'}40% mortality),
                  {' '}<span className="text-orange-400">Medium</span> ({'>'}40%),
                  {' '}<span className="text-red-400">High</span> ({'>'}60% and {'>'}2 dead),
                  {' '}<span className="text-red-400 font-bold">Critical</span> ({'>'}80% and {'>'}3 dead).
                  {' '}<span className="text-gray-300">Unknown</span> = the explorer returned 0 contract creations for this address (e.g. deployed via a factory contract or proxy).
                </p>
              </div>
            )}
          </span>
        </h3>
        {deployerLoading ? (
          <div className="flex items-center gap-2 py-2">
            <Loader2 className="h-4 w-4 animate-spin text-gray-500" />
            <span className="text-sm text-gray-500">{t.common.loading}</span>
          </div>
        ) : deployer ? (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">{t.safety.deployer_address}</span>
              <a
                href={`https://scan.mypinata.cloud/ipfs/bafybeienxyoyrhn5tswclvd3gdjy5mtkkwmu37aqtml6onbf7xnb3o22pe/#/address/${deployer.deployer_address}`}
                target="_blank" rel="noopener noreferrer"
                className="text-[#00D4FF] hover:underline font-mono text-xs"
              >
                {deployer.deployer_address.slice(0, 10)}...{deployer.deployer_address.slice(-6)}
                <ExternalLink className="h-3 w-3 inline ml-1" />
              </a>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">{t.safety.tokens_deployed}</span>
              <span>{deployer.tokens_deployed}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">{t.safety.dead_tokens}</span>
              <span className={deployer.dead_tokens > 5 ? 'text-red-400 font-medium' : ''}>
                {deployer.dead_tokens} ({(deployer.mortality_rate * 100).toFixed(0)}% mortality)
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">{t.safety.risk_level}</span>
              <span className={
                deployer.risk_level === 'serial_rugger' ? 'text-red-400 font-bold' :
                deployer.risk_level === 'high' ? 'text-red-400 font-medium' :
                deployer.risk_level === 'medium' ? 'text-orange-400 font-medium' :
                'text-emerald-400'
              }>
                {deployer.risk_level === 'serial_rugger' ? 'SERIAL RUGGER' :
                 deployer.risk_level.charAt(0).toUpperCase() + deployer.risk_level.slice(1)}
              </span>
            </div>
          </div>
        ) : (
          <div className="rounded-lg bg-white/[0.02] border border-white/5 px-4 py-3">
            <p className="text-sm text-gray-500">{t.safety.deployer_unavailable}</p>
            <p className="text-[10px] text-gray-600 mt-1">{t.safety.deployer_unavailable_detail}</p>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          ④ LIQUIDITY POOLS (20 pts) — absorbs Pool Confidence
          ══════════════════════════════════════════════════════════════════════ */}
      <div id="liquidity" className="rounded-xl border border-white/5 bg-gray-900/50 p-5 space-y-4 break-inside-avoid">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
          <Droplets className="h-4 w-4 text-[#00D4FF]" />
          {t.common.liquidity}
        </h3>
        <SubScore label={t.common.liquidity} score={safety.lp_score} max={20} icon={<Droplets className="h-4 w-4" />} />

        {/* Summary metrics */}
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">{t.safety.has_liquidity}</span>
            <BoolBadge value={safety.has_lp} trueLabel="Yes" falseLabel="No LP" />
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">{t.safety.total_liquidity}</span>
            <span className="font-medium">{formatUsdCompact(safety.total_liquidity_usd || 0)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">{t.safety.active_pairs}</span>
            <span>{safety.pair_count || 0}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">{t.safety.lp_removals_24h}</span>
            <span className={safety.recent_burns_24h > 0 ? 'text-orange-400 font-medium' : ''}>
              {safety.recent_burns_24h || 0}
            </span>
          </div>
          {livePools.length > 0 && (
            <div className="flex justify-between">
              <span className="text-gray-400">{t.safety.monitored_pools}</span>
              <span>
                {legitimatePools.length} legitimate
                {suspectPools.length > 0 && <span className="text-red-400 ml-1">+ {suspectPools.length} suspect</span>}
              </span>
            </div>
          )}
        </div>

        {/* Pool table from token_pools_live */}
        {livePools.length > 0 && (
          <>
            <button
              onClick={() => setPoolsOpen(true)}
              className="w-full flex items-center justify-center gap-2 text-sm font-semibold text-[#00D4FF] hover:text-white rounded-lg border border-[#00D4FF]/30 bg-[#00D4FF]/5 hover:bg-[#00D4FF]/10 py-2.5 transition-colors"
            >
              {`View all ${livePools.length} pools with confidence`}
            </button>

            {/* ── HONEYPOT DETAIL POPUP (style HoneyPot.is) ── */}
            <PopupPanel open={honeypotOpen} onClose={() => setHoneypotOpen(false)} title={t.safety.honeypot_analysis_title}>
              {honeypotLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-[#00D4FF]" />
                  <span className="ml-2 text-gray-400 animate-pulse">{t.safety.simulation_loading}</span>
                </div>
              ) : (() => {
                const hp = honeypotDetail
                const buyTax = hp?.buy_tax_pct ?? safety.buy_tax_pct
                const sellTax = hp?.sell_tax_pct ?? safety.sell_tax_pct
                const transferTax = hp?.transfer_tax_pct ?? null
                const isHp = hp?.is_honeypot ?? safety.is_honeypot
                const buyGas = hp?.buy_gas ?? null
                const sellGas = hp?.sell_gas ?? null
                const maxTx = hp?.max_tx_amount ?? null
                const maxWallet = hp?.max_wallet_amount ?? null
                const dynTax = hp?.dynamic_tax ?? false
                const taxByAmt = hp?.tax_by_amount ?? null
                const flags = hp?.flags ?? []
                const router = hp?.router ?? null

                return (
                <div className="space-y-5">
                  {/* Verdict banner */}
                  <div className={`rounded-xl px-6 py-5 text-center ${
                    isHp === true
                      ? 'bg-red-500/20 border-2 border-red-500/40'
                      : isHp === false
                        ? 'bg-emerald-500/15 border-2 border-emerald-500/30'
                        : 'bg-gray-700/30 border-2 border-gray-600/30'
                  }`}>
                    <div className={`text-2xl font-black tracking-wide ${
                      isHp === true ? 'text-red-400' : isHp === false ? 'text-emerald-400' : 'text-gray-400'
                    }`}>
                      {isHp === true ? t.safety.verdict_honeypot : isHp === false ? t.safety.verdict_safe : t.safety.verdict_inconclusive}
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      {isHp === true
                        ? t.safety.verdict_honeypot_message
                        : isHp === false
                          ? t.safety.verdict_safe_message
                          : t.safety.verdict_inconclusive_message}
                    </p>
                  </div>

                  {/* Tax breakdown */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-lg bg-gray-800/60 border border-white/5 p-4 text-center">
                      <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">{t.safety.buy_tax}</div>
                      <div className={`text-xl font-bold ${(buyTax ?? 0) > 10 ? 'text-orange-400' : 'text-white'}`}>
                        {buyTax != null ? `${buyTax}%` : '-'}
                      </div>
                    </div>
                    <div className="rounded-lg bg-gray-800/60 border border-white/5 p-4 text-center">
                      <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">{t.safety.sell_tax}</div>
                      <div className={`text-xl font-bold ${(sellTax ?? 0) > 10 ? 'text-red-400' : 'text-white'}`}>
                        {sellTax != null ? `${sellTax}%` : '-'}
                      </div>
                    </div>
                    <div className="rounded-lg bg-gray-800/60 border border-white/5 p-4 text-center">
                      <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">{t.safety.transfer_tax}</div>
                      <div className={`text-xl font-bold ${(transferTax ?? 0) > 0 ? 'text-amber-400' : 'text-white'}`}>
                        {transferTax != null ? `${transferTax}%` : '-'}
                      </div>
                    </div>
                  </div>

                  {/* Gas estimation */}
                  {(buyGas != null || sellGas != null) && (
                    <div className="rounded-lg bg-gray-800/40 border border-white/5 p-4 space-y-2">
                      <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{t.safety.gas_estimation}</h4>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-400">{t.safety.buy_gas}</span>
                          <span className={buyGas && buyGas > 2_000_000 ? 'text-orange-400' : 'text-gray-300'}>
                            {buyGas != null ? buyGas.toLocaleString('en-US') : '-'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400">{t.safety.sell_gas}</span>
                          <span className={sellGas && sellGas > 3_500_000 ? 'text-red-400' : 'text-gray-300'}>
                            {sellGas != null ? sellGas.toLocaleString('en-US') : '-'}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Max transaction / wallet limits */}
                  {(maxTx || maxWallet) && (
                    <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-4 space-y-2">
                      <h4 className="text-xs font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5" /> {t.safety.limits_title}
                      </h4>
                      <div className="space-y-1 text-sm">
                        {maxTx && (
                          <div className="flex justify-between">
                            <span className="text-gray-400">{t.safety.max_transaction}</span>
                            <span className="text-amber-300 font-mono text-xs">{maxTx}</span>
                          </div>
                        )}
                        {maxWallet && (
                          <div className="flex justify-between">
                            <span className="text-gray-400">{t.safety.max_wallet}</span>
                            <span className="text-amber-300 font-mono text-xs">{maxWallet}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Variable amount tax breakdown */}
                  {taxByAmt && Object.keys(taxByAmt).length > 0 && (
                    <div className="rounded-lg bg-gray-800/40 border border-white/5 p-4 space-y-2">
                      <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                        {t.safety.tax_by_amount}
                        {dynTax && (
                          <span className="text-[10px] bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full border border-amber-500/30">
                            {t.safety.dynamic_tax_badge}
                          </span>
                        )}
                      </h4>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-gray-400 border-b border-white/5">
                              <th className="text-left py-1.5 pr-4">{t.safety.table_amount}</th>
                              <th className="text-right py-1.5 px-2">{t.safety.buy_tax}</th>
                              <th className="text-right py-1.5 pl-2">{t.safety.sell_tax}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(taxByAmt).map(([amt, taxes]) => (
                              <tr key={amt} className="border-b border-white/5">
                                <td className="py-1.5 pr-4 text-gray-300 font-mono">{amt}</td>
                                <td className="py-1.5 px-2 text-right">
                                  {taxes.error ? (
                                    <span className="text-gray-500">{t.safety.failed}</span>
                                  ) : taxes.buy_tax != null ? (
                                    <span className={taxes.buy_tax > 10 ? 'text-orange-400' : 'text-gray-300'}>{taxes.buy_tax}%</span>
                                  ) : <span>-</span>}
                                </td>
                                <td className="py-1.5 pl-2 text-right">
                                  {taxes.error ? (
                                    <span className="text-gray-500">{t.safety.failed}</span>
                                  ) : taxes.sell_tax != null ? (
                                    <span className={taxes.sell_tax > 10 ? 'text-red-400' : 'text-gray-300'}>{taxes.sell_tax}%</span>
                                  ) : <span>-</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Holder sell analysis */}
                  {hp?.holder_analysis && hp.holder_analysis.holders_tested > 0 && (() => {
                    const ha = hp.holder_analysis!
                    return (
                      <div className="rounded-lg bg-gray-800/40 border border-white/5 p-4 space-y-3">
                        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{t.safety.holder_analysis_title}</h4>
                        <div className="grid grid-cols-4 gap-3 text-center">
                          <div><div className="text-lg font-bold text-white">{ha.holders_tested}</div><div className="text-[10px] text-gray-400">{t.safety.holders_tested}</div></div>
                          <div><div className="text-lg font-bold text-emerald-400">{ha.successful}</div><div className="text-[10px] text-gray-400">{t.safety.holders_can_sell}</div></div>
                          <div><div className="text-lg font-bold text-red-400">{ha.failed}</div><div className="text-[10px] text-gray-400">{t.safety.holders_blocked}</div></div>
                          <div><div className="text-lg font-bold text-amber-400">{ha.siphoned}</div><div className="text-[10px] text-gray-400">{t.safety.holders_siphoned}</div></div>
                        </div>
                        {ha.holder_results.length > 0 && (
                          <table className="w-full text-xs">
                            <thead><tr className="text-gray-400 border-b border-white/5"><th className="text-left py-1">{t.safety.table_holder}</th><th className="text-right py-1">{t.safety.table_supply_pct}</th><th className="text-right py-1">{t.safety.table_status}</th></tr></thead>
                            <tbody>
                              {ha.holder_results.slice(0, 10).map((h, i) => (
                                <tr key={i} className="border-b border-white/5">
                                  <td className="py-1 font-mono text-gray-400">{h.address.slice(0, 6)}...{h.address.slice(-4)} {h.is_contract ? <span className="text-[9px] text-gray-500 ml-1">{t.common.contract}</span> : ''}</td>
                                  <td className="py-1 text-right text-gray-300">{h.pct_supply?.toFixed(2)}%</td>
                                  <td className="py-1 text-right">
                                    {h.can_transfer === true ? <span className="inline-flex items-center gap-0.5 text-emerald-400"><CheckCircle className="h-3 w-3" /> {t.safety.status_ok}</span>
                                      : h.can_transfer === false ? <span className="inline-flex items-center gap-0.5 text-red-400"><XCircle className="h-3 w-3" /> {t.safety.status_blocked}</span>
                                      : <span className="text-gray-600">?</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )
                  })()}

                  {/* Warning flags */}
                  {flags.length > 0 && (
                    <div className="rounded-lg bg-gray-800/40 border border-white/5 p-4 space-y-2">
                      <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{t.safety.flags_title}</h4>
                      <div className="flex flex-wrap gap-2">
                        {flags.map((flag, i) => (
                          <span key={i} className={`text-xs px-2.5 py-1 rounded-full border font-medium ${
                            ['honeypot', 'extreme_tax'].includes(flag)
                              ? 'bg-red-500/15 text-red-400 border-red-500/30'
                              : ['high_buy_tax', 'high_sell_tax', 'high_gas', 'dynamic_tax'].includes(flag)
                                ? 'bg-orange-500/15 text-orange-400 border-orange-500/30'
                                : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                          }`}>
                            {flag.replace(/_/g, ' ')}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Technical risks */}
                  <div className="rounded-lg bg-gray-800/30 border border-white/5 p-4 space-y-2">
                    <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{t.safety.technical_risks_title}</h4>
                    <ul className="text-[11px] text-gray-400 space-y-1 list-disc list-inside">
                      <li>{t.safety.risk_gas_estimation}</li>
                      <li>{t.safety.risk_max_detection}</li>
                      <li>{t.safety.risk_dynamic_tax}</li>
                      <li>{t.safety.risk_transfer_tax}</li>
                    </ul>
                  </div>

                  {/* Simulation info */}
                  <div className="text-center space-y-1">
                    <p className="text-[10px] text-gray-500">
                      {t.safety.router_label} {router ?? 'Unknown'} | {t.safety.router_via}
                    </p>
                    <p className="text-[10px] text-amber-400/80">
                      {t.safety.honeypot_disclaimer}
                    </p>
                  </div>
                </div>
                )
              })()}
            </PopupPanel>

            <PopupPanel open={poolsOpen} onClose={() => setPoolsOpen(false)} title={`All ${livePools.length} Pools — Confidence Analysis`}>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-gray-500">
                      <th className="py-2 text-left w-6">#</th>
                      <th className="py-2 text-left">{t.safety.table_pair}</th>
                      <th className="py-2 text-left">{t.safety.table_dex}</th>
                      <th className="py-2 text-right">{t.common.liquidity}</th>
                      <th className="py-2 text-right">{t.safety.table_vol_24h}</th>
                      <th className="py-2 text-center">{t.safety.table_confidence}</th>
                      <th className="py-2 text-center" title="Pool risk score (0-100, higher is safer)">{t.safety.table_risk}</th>
                      <th className="py-2 text-center">{t.safety.table_dexscreener}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {livePools.map((pool, i) => {
                      const spamReasons = formatSpamReason(pool.pool_spam_reason, pool.base_token_symbol, pool.quote_token_symbol, address, pool.base_token_address, pool.quote_token_address)
                      const transition = poolTransitions[pool.pair_address]
                      return (
                        <Fragment key={pool.pair_address}>
                          <tr className={`border-b border-white/5 ${(pool.pool_risk_score != null ? pool.pool_risk_score < 30 : !pool.pool_is_legitimate) ? 'opacity-60' : ''}`}>
                            <td className="py-2 text-gray-600">{i + 1}</td>
                            <td className="py-2">
                              <div className="flex items-center gap-1.5">
                                <span className="text-white font-medium">
                                  {resolvePoolSymbol(pool.base_token_symbol, pool.base_token_address, address, tokenInfo?.symbol)}/{resolvePoolSymbol(pool.quote_token_symbol, pool.quote_token_address, address, tokenInfo?.symbol)}
                                </span>
                                {!pool.pool_is_legitimate && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/20 font-bold whitespace-nowrap">
                                    NOT LEGITIMATE
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-2 text-gray-400">{formatDexName(pool.dex_id)}</td>
                            <td className="py-2 text-right text-gray-300">
                              {pool.liquidity_usd != null ? formatUsdCompact(pool.liquidity_usd) : '--'}
                            </td>
                            <td className="py-2 text-right text-gray-300">
                              {pool.volume_24h_usd != null ? formatUsdCompact(pool.volume_24h_usd) : '--'}
                            </td>
                            <td className="py-2 text-center">
                              <div className="flex items-center justify-center gap-1">
                                {(() => {
                                  const resolved = resolvePoolConfidence(pool, tokenVerifications)
                                  return (
                                    <>
                                      <ConfidenceBadge level={pool.pool_confidence} resolvedLevel={resolved?.level} />
                                      {resolved && resolved.level !== 'suspect' && resolved.reason && (
                                        <span className="text-[8px] text-gray-500 ml-1 cursor-help" title={resolved.reason}>
                                          ({resolved.reason.split(' · ').slice(0, 2).join(', ')})
                                        </span>
                                      )}
                                    </>
                                  )
                                })()}
                                {transition && (
                                  <span className="text-yellow-400 text-[9px]" title={`Recent transition: ${CONFIDENCE_INFO[transition.from]?.label ?? transition.from} → ${CONFIDENCE_INFO[transition.to]?.label ?? transition.to}`}>
                                    ↑
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-2 text-center">
                              {pool.pool_risk_score != null ? (
                                <span className={`font-mono text-[10px] font-bold ${
                                  pool.pool_risk_score >= 70 ? 'text-emerald-400'
                                  : pool.pool_risk_score >= 50 ? 'text-yellow-400'
                                  : pool.pool_risk_score >= 30 ? 'text-orange-400'
                                  : 'text-red-400'
                                }`} title={`Pool risk score: ${pool.pool_risk_score}/100`}>
                                  {pool.pool_risk_score}
                                </span>
                              ) : (
                                <span className="text-gray-600">—</span>
                              )}
                            </td>
                            <td className="py-2 text-center">
                              {pool.dx_url ? (
                                <a href={pool.dx_url} target="_blank" rel="noopener noreferrer" className="text-[#00D4FF] hover:text-white">
                                  <ExternalLink className="h-3.5 w-3.5 inline" />
                                </a>
                              ) : (
                                <a href={`https://dexscreener.com/pulsechain/${pool.pair_address}`} target="_blank" rel="noopener noreferrer" className="text-[#00D4FF] hover:text-white">
                                  <ExternalLink className="h-3.5 w-3.5 inline" />
                                </a>
                              )}
                            </td>
                          </tr>
                          {/* Spam reasons for this pool */}
                          {spamReasons.length > 0 && (
                            <tr className="border-b border-white/5">
                              <td></td>
                              <td colSpan={7} className="py-1.5 pb-2.5">
                                {spamReasons.map((r, j) => (
                                  <div key={j} className="text-xs text-red-400/80 leading-relaxed">
                                    <span className="font-mono text-red-400/50 mr-1">{r.code}</span>
                                    {r.explanation}
                                    {r.action && <span className="text-orange-400/80 ml-1">→ {r.action}</span>}
                                  </div>
                                ))}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </PopupPanel>
          </>
        )}

        {/* Confidence scale legend */}
        <div className="rounded-lg bg-white/[0.02] border border-white/5 p-3">
          <div className="text-[10px] text-gray-500 mb-2 font-medium uppercase tracking-wider">{t.safety.confidence_scale}</div>
          <div className="grid grid-cols-2 gap-1.5 text-xs">
            {Object.entries(CONFIDENCE_INFO).filter(([key]) => !['resolving'].includes(key)).map(([key, info]) => (
              <div key={key} className="flex items-center gap-2">
                <span className={`${info.color} font-bold w-14 shrink-0`}>{info.label}</span>
                <span className="text-gray-500">
                  {key === 'high' ? '2 core tokens' : key === 'medium' ? '1 core + 1 known' : key === 'low' ? '2 known, no core' : '1+ unknown token'}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 text-[10px] text-gray-600 leading-relaxed border-t border-white/5 pt-2">
            <span className="text-gray-400 font-medium">Auto-resolution:</span>{' '}
            Pools marked <span className="text-red-400">Suspect</span> solely because a token is not in our database are automatically investigated via <span className="text-gray-400">DexScreener</span> (pairs, liquidity, volume) and <span className="text-gray-400">PulseChain Scan</span> (verified contract, holder count). If enough signals confirm the token is real, confidence is upgraded to <span className="text-yellow-400">Medium</span> or <span className="text-orange-400">Low</span>. Hover over the badge for details.
          </div>
        </div>

        {/* Anchor analysis from Safety API (legacy, optional) */}
        {safety.has_lp && (
          <button
            onClick={apiAvailable === false ? undefined : loadPairs}
            disabled={apiAvailable === false}
            className={`w-full flex items-center justify-center gap-2 text-[11px] rounded-lg border border-white/5 py-2 transition-colors ${
              apiAvailable === false
                ? 'text-gray-600 cursor-not-allowed opacity-50'
                : 'text-gray-500 hover:text-gray-300 bg-white/[0.01] hover:bg-white/[0.03]'
            }`}
            title={apiAvailable === false ? t.safety.anchor_analysis_unavailable : undefined}
          >
            {apiAvailable === false ? t.safety.anchor_analysis_unavailable : t.safety.anchor_analysis_btn}
          </button>
        )}

        <PopupPanel open={pairsOpen} onClose={() => setPairsOpen(false)} title={t.safety.anchor_analysis_title}>
          <div className="space-y-2">
            {pairsLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-gray-500" />
              </div>
            ) : pairs.length > 0 ? (
              <>
                <div className="space-y-1.5 max-h-60 overflow-y-auto">
                  {pairs.map((p, i) => {
                    const pctOfTotal = safety.total_liquidity_usd > 0
                      ? ((p.reserve_usd / safety.total_liquidity_usd) * 100).toFixed(1) : '0'
                    return (
                      <a key={p.address}
                        href={`https://dexscreener.com/pulsechain/${p.address}`}
                        target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.05] border border-white/5 transition-colors group"
                      >
                        <span className="text-[10px] text-gray-600 w-5 shrink-0">#{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-medium text-white">{p.token0_symbol}/{p.token1_symbol}</span>
                            <span className="text-[9px] px-1 py-0.5 rounded bg-white/5 text-gray-500">{p.dex.replace('_', ' ')}</span>
                            {p.is_anchored === true && (
                              <span className="text-[8px] px-1 py-0.5 rounded bg-emerald-500/10 text-emerald-400" title={t.safety.anchored_tooltip}>{t.safety.anchored}</span>
                            )}
                            {p.is_anchored === false && (
                              <span className="text-[8px] px-1 py-0.5 rounded bg-amber-500/10 text-amber-400" title={t.safety.capped_tooltip}>{t.safety.capped}</span>
                            )}
                          </div>
                          <div className="text-[10px] text-gray-500 font-mono truncate">{p.address.slice(0, 10)}...{p.address.slice(-6)}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-xs font-semibold text-white">{formatUsdCompact(p.reserve_usd)}</div>
                          <div className="text-[9px] text-gray-500">{pctOfTotal}% &middot; {p.total_txns.toLocaleString('en-US')} tx</div>
                        </div>
                        <ExternalLink className="h-3 w-3 text-gray-600 group-hover:text-[#00D4FF] shrink-0 transition-colors" />
                      </a>
                    )
                  })}
                </div>
                {/* Methodology note */}
                <div className="rounded-lg bg-blue-500/5 border border-blue-500/10 px-3 py-2.5 space-y-1.5">
                  <p className="text-[11px] text-blue-300 font-medium">{t.safety.anchor_system}</p>
                  <p className="text-[10px] text-gray-400 leading-relaxed">
                    Pairs containing a reference token (WPLS, HEX, PLSX, INC, DAI, USDC, USDT, WETH, WBTC) are
                    {' '}<span className="text-emerald-400">trusted</span>.
                    Pairs where both tokens are unknown are <span className="text-amber-400">capped at $50K</span> to
                    prevent inflation from tokens that only trade against other worthless tokens.
                  </p>
                </div>
              </>
            ) : (
              <p className="text-xs text-gray-500 text-center py-2">{t.safety.anchor_unavailable_msg}</p>
            )}
          </div>
        </PopupPanel>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          ⑤ HOLDER DISTRIBUTION (15 pts) + Leagues integration
          ══════════════════════════════════════════════════════════════════════ */}
      <div id="holders" className="rounded-xl border border-white/5 bg-gray-900/50 p-5 space-y-4 break-inside-avoid">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
          <Users className="h-4 w-4 text-[#00D4FF]" />
          {t.common.holders}
          <a
            href={`https://scan.mypinata.cloud/ipfs/bafybeienxyoyrhn5tswclvd3gdjy5mtkkwmu37aqtml6onbf7xnb3o22pe/#/token/${address}?tab=holders`}
            target="_blank" rel="noopener noreferrer"
            className="ml-auto text-[10px] text-gray-600 hover:text-[#00D4FF] transition-colors flex items-center gap-1 font-normal normal-case tracking-normal"
          >
            View holders <ExternalLink className="h-3 w-3" />
          </a>
        </h3>
        <SubScore label={t.common.holders} score={safety.holders_score} max={15} icon={<Users className="h-4 w-4" />} />
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">{t.safety.total_holders}</span>
            <span className="font-medium">
              {leagueSummary ? leagueSummary.total_holders.toLocaleString('en-US') : (safety.holder_count || 0).toLocaleString('en-US')}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">{t.safety.top_10_holders}</span>
            <span className={safety.top10_pct > 50 ? 'text-red-400 font-medium' : safety.top10_pct > 30 ? 'text-orange-400' : ''}>
              {safety.top10_pct?.toFixed(1)}% of supply
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">#1 Holder</span>
            <span className={safety.top1_pct > 30 ? 'text-red-400 font-medium' : ''}>
              {safety.top1_pct?.toFixed(1)}% of supply
            </span>
          </div>
        </div>

        {/* Distribution assessment */}
        <div className={`rounded-lg px-3 py-2 text-xs ${
          safety.top10_pct > 50 ? 'bg-red-500/5 border border-red-500/10 text-red-300' :
          safety.top10_pct > 30 ? 'bg-orange-500/5 border border-orange-500/10 text-orange-300' :
          'bg-emerald-500/5 border border-emerald-500/10 text-emerald-300'
        }`}>
          {safety.top10_pct > 50
            ? t.safety.high_concentration
            : safety.top10_pct > 30
            ? t.safety.moderate_concentration
            : t.safety.healthy_distribution}
        </div>

        {/* Leagues tier distribution — only for tracked tokens */}
        {leagueSummary && (
          <div className="pt-3 border-t border-white/5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400 font-medium">{t.safety.holder_tier_distribution}</span>
              <span className="text-[10px] text-gray-600">
                Updated {new Date(leagueSummary.updated_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {([
                ['poseidon', leagueSummary.poseidon_count],
                ['whale', leagueSummary.whale_count],
                ['shark', leagueSummary.shark_count],
                ['dolphin', leagueSummary.dolphin_count],
                ['squid', leagueSummary.squid_count],
                ['turtle', leagueSummary.turtle_count],
              ] as [string, number][]).map(([tier, count]) => (
                <div key={tier} className={`rounded-lg border px-2.5 py-1.5 ${TIER_COLORS[tier]}`} title={TIER_THRESHOLDS[tier]}>
                  <div className="text-[10px] uppercase tracking-wider opacity-70 flex items-center gap-1"><span>{TIER_EMOJI[tier]}</span>{tier}</div>
                  <div className="text-sm font-bold">{count.toLocaleString('en-US')}</div>
                </div>
              ))}
            </div>

            {/* Top whales + family clusters (popup) */}
            {(leagueHolders.length > 0 || leagueFamilies.length > 0) && (
              <>
                <button
                  onClick={() => setLeagueOpen(true)}
                  className="w-full flex items-center justify-center gap-2 text-sm font-semibold text-[#00D4FF] hover:text-white rounded-lg border border-[#00D4FF]/30 bg-[#00D4FF]/5 hover:bg-[#00D4FF]/10 py-2.5 transition-colors"
                >
                  {`View top holders & families (${leagueHolders.length} whales, ${leagueFamilies.length} clusters)`}
                </button>

                <PopupPanel open={leagueOpen} onClose={() => setLeagueOpen(false)} title={`Top Holders & Whale Families (${leagueHolders.length} whales, ${leagueFamilies.length} clusters)`}>
                  {(() => {
                    // Derive token price from best legitimate pool
                    const bestPool = livePools.find(p => p.pool_is_legitimate && p.price_usd)
                    const tokenPrice = bestPool?.price_usd ?? null
                    const hasBalanceData = tokenTotalSupply != null && tokenTotalSupply > 0
                    const totalTopHoldersPct = leagueHolders.reduce((s, h) => s + h.balance_pct, 0)
                    const totalTopHoldersValue = hasBalanceData && tokenPrice
                      ? leagueHolders.reduce((s, h) => s + (h.balance_pct / 100) * tokenTotalSupply! * tokenPrice, 0)
                      : null

                    return (
                  <div className="space-y-4">
                    {/* Portfolio summary */}
                    {(hasBalanceData || tokenPrice) && (
                      <div className="grid grid-cols-3 gap-3">
                        {tokenPrice && (
                          <div className="rounded-lg bg-gray-800/60 border border-white/5 p-3 text-center">
                            <div className="text-[10px] text-gray-400 uppercase mb-1">{t.safety.token_price}</div>
                            <div className="text-sm font-bold text-white">${tokenPrice < 0.01 ? tokenPrice.toExponential(2) : tokenPrice.toLocaleString('en-US', { maximumFractionDigits: 4 })}</div>
                          </div>
                        )}
                        <div className="rounded-lg bg-gray-800/60 border border-white/5 p-3 text-center">
                          <div className="text-[10px] text-gray-400 uppercase mb-1">{t.safety.top_holders_pct}</div>
                          <div className="text-sm font-bold text-white">{totalTopHoldersPct.toFixed(2)}%</div>
                        </div>
                        {totalTopHoldersValue != null && (
                          <div className="rounded-lg bg-gray-800/60 border border-white/5 p-3 text-center">
                            <div className="text-[10px] text-gray-400 uppercase mb-1">{t.safety.combined_value}</div>
                            <div className="text-sm font-bold text-white">${totalTopHoldersValue >= 1_000_000 ? (totalTopHoldersValue / 1_000_000).toFixed(2) + 'M' : totalTopHoldersValue >= 1_000 ? (totalTopHoldersValue / 1_000).toFixed(1) + 'K' : totalTopHoldersValue.toFixed(0)}</div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Top holders table */}
                    {leagueHolders.length > 0 && (
                      <div>
                        <div className="text-xs text-gray-400 mb-2 font-medium">{t.safety.top_holders_label}</div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-white/10 text-gray-500">
                                <th className="py-1.5 text-left">{t.safety.table_address}</th>
                                <th className="py-1.5 text-center">{t.safety.table_tier}</th>
                                <th className="py-1.5 text-right">% Supply</th>
                                {hasBalanceData && <th className="py-1.5 text-right">{t.safety.table_balance}</th>}
                                {hasBalanceData && tokenPrice && <th className="py-1.5 text-right">{t.safety.table_value}</th>}
                                <th className="py-1.5 text-center">{t.safety.table_family}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {leagueHolders.map((h, i) => {
                                const balance = hasBalanceData ? (h.balance_pct / 100) * tokenTotalSupply! : null
                                const value = balance != null && tokenPrice ? balance * tokenPrice : null
                                return (
                                <tr key={i} className="border-b border-white/5">
                                  <td className="py-1.5 font-mono text-gray-300">
                                    <span className="inline-flex items-center">
                                      <a
                                        href={`https://scan.mypinata.cloud/ipfs/bafybeienxyoyrhn5tswclvd3gdjy5mtkkwmu37aqtml6onbf7xnb3o22pe/#/address/${h.holder_address}`}
                                        target="_blank" rel="noopener noreferrer"
                                        className="hover:text-cyan-400 transition-colors"
                                      >
                                        {h.holder_address.slice(0, 8)}...{h.holder_address.slice(-6)}
                                      </a>
                                      <CopyBtn text={h.holder_address} />
                                    </span>
                                  </td>
                                  <td className="py-1.5 text-center">
                                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${TIER_COLORS[h.tier] || 'text-gray-400'}`}>
                                      {TIER_EMOJI[h.tier]}{h.tier}
                                    </span>
                                  </td>
                                  <td className={`py-1.5 text-right font-medium ${h.balance_pct > 5 ? 'text-red-400' : h.balance_pct > 1 ? 'text-orange-400' : ''}`}>
                                    {h.balance_pct.toFixed(4)}%
                                  </td>
                                  {hasBalanceData && (
                                    <td className="py-1.5 text-right font-mono text-gray-300">
                                      {balance != null ? (balance >= 1_000_000 ? (balance / 1_000_000).toFixed(2) + 'M' : balance >= 1_000 ? (balance / 1_000).toFixed(1) + 'K' : balance.toFixed(0)) : '-'}
                                    </td>
                                  )}
                                  {hasBalanceData && tokenPrice && (
                                    <td className="py-1.5 text-right text-gray-300">
                                      {value != null ? ('$' + (value >= 1_000_000 ? (value / 1_000_000).toFixed(2) + 'M' : value >= 1_000 ? (value / 1_000).toFixed(1) + 'K' : value.toFixed(0))) : '-'}
                                    </td>
                                  )}
                                  <td className="py-1.5 text-center">
                                    {h.family_id ? (
                                      <span className="text-purple-400 text-[10px]" title={`Family: ${h.family_id.slice(0, 10)}...`}>{t.safety.clustered}</span>
                                    ) : (
                                      <span className="text-gray-600">--</span>
                                    )}
                                  </td>
                                </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Family clusters (expandable) */}
                    {leagueFamilies.length > 0 && (
                      <div>
                        <div className="text-xs text-gray-400 mb-2 font-medium">{t.safety.whale_family_clusters}</div>
                        <div className="space-y-2">
                          {leagueFamilies.map((f, i) => {
                            const expanded = expandedFamilies[f.family_id] ?? false
                            const daughters = familyDaughters[f.family_id]
                            const toggleFamily = () => {
                              const next = !expanded
                              setExpandedFamilies(prev => ({ ...prev, [f.family_id]: next }))
                              if (next && !daughters && address) {
                                const sym = LEAGUE_TOKEN_ADDRESSES[address.toLowerCase()]
                                if (sym) {
                                  supabase.from('holder_league_addresses')
                                    .select('holder_address, balance_pct, tier')
                                    .eq('token_symbol', sym)
                                    .eq('family_id', f.family_id)
                                    .neq('holder_address', f.mother_address)
                                    .order('balance_pct', { ascending: false })
                                    .limit(50)
                                    .then(({ data }) => setFamilyDaughters(prev => ({ ...prev, [f.family_id]: data ?? [] })))
                                }
                              }
                            }
                            return (
                            <div key={i} className="rounded-lg bg-purple-500/5 border border-purple-500/10 overflow-hidden">
                              <button onClick={toggleFamily} className="w-full px-3 py-2 text-left hover:bg-purple-500/10 transition-colors">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    {expanded ? <ChevronDown className="h-3 w-3 text-purple-400" /> : <ChevronRight className="h-3 w-3 text-purple-400" />}
                                    <span className="text-purple-400 text-xs font-medium">{t.safety.mother}</span>
                                    <span className="text-xs font-mono text-gray-300">
                                      {f.mother_address.slice(0, 8)}...{f.mother_address.slice(-6)}
                                    </span>
                                    <CopyBtn text={f.mother_address} />
                                  </div>
                                  <span className={`text-xs font-medium ${f.combined_balance_pct > 5 ? 'text-red-400' : 'text-orange-400'}`}>
                                    {f.combined_balance_pct.toFixed(3)}% combined
                                  </span>
                                </div>
                                <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-500 ml-5">
                                  <span>{f.daughter_count} daughter{f.daughter_count !== 1 ? 's' : ''}</span>
                                  <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border ${TIER_COLORS[f.combined_tier] || 'text-gray-400'}`}>{TIER_EMOJI[f.combined_tier]}{f.combined_tier}</span>
                                  {f.link_types.map((lt, j) => (
                                    <span key={j} className="text-purple-400/60">{lt.replace(/_/g, ' ')}</span>
                                  ))}
                                </div>
                              </button>
                              {expanded && (
                                <div className="border-t border-purple-500/10 px-3 py-2 space-y-1">
                                  {!daughters ? (
                                    <div className="flex items-center gap-2 py-2 justify-center">
                                      <Loader2 className="h-3 w-3 animate-spin text-purple-400" />
                                      <span className="text-[10px] text-gray-500">{t.safety.loading_daughters}</span>
                                    </div>
                                  ) : daughters.length === 0 ? (
                                    <div className="text-[10px] text-gray-500 text-center py-1">{t.safety.no_daughters}</div>
                                  ) : (
                                    <table className="w-full text-xs">
                                      <thead>
                                        <tr className="text-gray-500 border-b border-white/5">
                                          <th className="py-1 text-left">{t.safety.daughter_address}</th>
                                          <th className="py-1 text-center">{t.safety.table_tier}</th>
                                          <th className="py-1 text-right">% Supply</th>
                                          {hasBalanceData && <th className="py-1 text-right">{t.safety.table_balance}</th>}
                                          {hasBalanceData && tokenPrice && <th className="py-1 text-right">{t.safety.table_value}</th>}
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {daughters.map((d, j) => {
                                          const dBal = hasBalanceData ? (d.balance_pct / 100) * tokenTotalSupply! : null
                                          const dVal = dBal != null && tokenPrice ? dBal * tokenPrice : null
                                          return (
                                          <tr key={j} className="border-b border-white/5">
                                            <td className="py-1 font-mono text-gray-400">
                                              <span className="inline-flex items-center">
                                                <a
                                                  href={`https://scan.mypinata.cloud/ipfs/bafybeienxyoyrhn5tswclvd3gdjy5mtkkwmu37aqtml6onbf7xnb3o22pe/#/address/${d.holder_address}`}
                                                  target="_blank" rel="noopener noreferrer"
                                                  className="hover:text-cyan-400 transition-colors"
                                                >
                                                  {d.holder_address.slice(0, 8)}...{d.holder_address.slice(-6)}
                                                </a>
                                                <CopyBtn text={d.holder_address} />
                                              </span>
                                            </td>
                                            <td className="py-1 text-center">
                                              <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium border ${TIER_COLORS[d.tier] || 'text-gray-400'}`}>
                                                {TIER_EMOJI[d.tier]}{d.tier}
                                              </span>
                                            </td>
                                            <td className="py-1 text-right text-gray-300">{d.balance_pct.toFixed(4)}%</td>
                                            {hasBalanceData && (
                                              <td className="py-1 text-right font-mono text-gray-400">
                                                {dBal != null ? (dBal >= 1_000_000 ? (dBal / 1_000_000).toFixed(2) + 'M' : dBal >= 1_000 ? (dBal / 1_000).toFixed(1) + 'K' : dBal.toFixed(0)) : '-'}
                                              </td>
                                            )}
                                            {hasBalanceData && tokenPrice && (
                                              <td className="py-1 text-right text-gray-400">
                                                {dVal != null ? ('$' + (dVal >= 1_000_000 ? (dVal / 1_000_000).toFixed(2) + 'M' : dVal >= 1_000 ? (dVal / 1_000).toFixed(1) + 'K' : dVal.toFixed(0))) : '-'}
                                              </td>
                                            )}
                                          </tr>
                                          )
                                        })}
                                      </tbody>
                                    </table>
                                  )}
                                </div>
                              )}
                            </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    <Link
                      to="/leagues"
                      className="flex items-center justify-center gap-2 text-xs text-[#00D4FF] hover:text-white transition-colors"
                    >
                      {t.safety.view_full_leagues} <ExternalLink className="h-3 w-3" />
                    </Link>
                  </div>
                    )
                  })()}
                </PopupPanel>
              </>
            )}
          </div>
        )}

        {/* Message for non-tracked tokens */}
        {!leagueSummary && address && !LEAGUE_TOKEN_ADDRESSES[address.toLowerCase()] && (
          <p className="text-[10px] text-gray-600 text-center pt-2">
            {t.safety.leagues_info}
            <Link to="/leagues" className="text-[#00D4FF] hover:underline ml-1">{t.safety.view_leagues}</Link>
          </p>
        )}
      </div>


      {/* ══════════════════════════════════════════════════════════════════════
          ⑥ ACTIVITY TIMELINE (10 pts)
          ══════════════════════════════════════════════════════════════════════ */}
      <div id="timeline" className="rounded-xl border border-white/5 bg-gray-900/50 p-5 space-y-4 break-inside-avoid">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
          <Activity className="h-4 w-4 text-[#00D4FF]" />
          Activity Timeline
        </h3>
        <SubScore label="Age" score={safety.age_score} max={10} icon={<Clock className="h-4 w-4" />} />

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">{t.safety.token_age}</span>
            <span className="font-medium">{Math.floor(safety.age_days)} days</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">{t.safety.last_analyzed}</span>
            <span className="text-gray-300">{new Date(safety.analyzed_at).toLocaleString('en-US')}</span>
          </div>
        </div>

        {/* Transition banners — migrated from PoolConfidencePopup */}
        {hasAnyTransition && (
          <div className="space-y-2">
            {Object.entries(poolTransitions).map(([pairAddr, tr]) => {
              const pool = livePools.find(p => p.pair_address === pairAddr)
              const fromConf = CONFIDENCE_INFO[tr.from] ?? CONFIDENCE_INFO.suspect
              const toConf = CONFIDENCE_INFO[tr.to] ?? CONFIDENCE_INFO.suspect
              const event = confidenceEvents.find(e => e.pair_address === pairAddr)
              return (
                <div key={pairAddr} className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 px-3 py-2 flex items-start gap-2">
                  <span className="text-yellow-400 text-xs mt-0.5">↑</span>
                  <div className="text-xs text-yellow-300">
                    <span className="font-bold">{t.safety.recent_transition}</span>
                    {pool && <span className="text-yellow-400/70"> ({resolvePoolSymbol(pool.base_token_symbol, pool.base_token_address, address, tokenInfo?.symbol)}/{resolvePoolSymbol(pool.quote_token_symbol, pool.quote_token_address, address, tokenInfo?.symbol)})</span>}
                    {': '}
                    <span className={fromConf.color}>{fromConf.label}</span>
                    {' → '}
                    <span className={toConf.color}>{toConf.label}</span>
                    {event?.event_summary ? (
                      <span className="text-yellow-400/80 ml-1">— {event.event_summary}</span>
                    ) : (
                      <span className="text-yellow-400/60 ml-1">
                        — The monitoring history below still shows the previous state. The next indexer run (every 6h) will record this transition.
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Pool Monitoring History */}
        {monitoringHistory.length > 0 && (
          <>
            <button
              onClick={() => setHistoryOpen(true)}
              className="w-full flex items-center justify-center gap-2 text-sm font-semibold text-[#00D4FF] hover:text-white rounded-lg border border-[#00D4FF]/30 bg-[#00D4FF]/5 hover:bg-[#00D4FF]/10 py-2.5 transition-colors"
            >
              {`View monitoring history (${monitoringHistory.length} snapshots)`}
            </button>

            <PopupPanel open={historyOpen} onClose={() => setHistoryOpen(false)} title={`Monitoring History (${monitoringHistory.length} snapshots)`}>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-gray-500">
                      <th className="py-2 text-center">{t.safety.table_date}</th>
                      <th className="py-2 text-center">{t.safety.table_pool}</th>
                      <th className="py-2 text-center">{t.safety.table_confidence}</th>
                      <th className="py-2 text-center">{t.safety.table_legitimate}</th>
                      <th className="py-2 text-center">{t.safety.table_reserve_usd}</th>
                      <th className="py-2 text-center">{t.safety.table_volume_24h}</th>
                      <th className="py-2 text-center">{t.safety.table_spam_reason}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monitoringHistory.map((snap, i) => {
                      // Resolve confidence: find matching live pool to get token addresses for DX verification
                      const matchPool = livePools.find(p => p.pair_address === snap.pair_address)
                      const snapForResolve = matchPool ? {
                        pool_confidence: snap.pool_confidence,
                        pool_spam_reason: snap.pool_spam_reason,
                        base_token_address: matchPool.base_token_address,
                        quote_token_address: matchPool.quote_token_address,
                        base_token_symbol: matchPool.base_token_symbol,
                        quote_token_symbol: matchPool.quote_token_symbol,
                      } : null
                      const resolved = snapForResolve ? resolvePoolConfidence(snapForResolve, tokenVerifications) : undefined
                      const sConf = CONFIDENCE_INFO[resolved?.level ?? snap.pool_confidence] ?? CONFIDENCE_INFO.suspect
                      const prevSnap = monitoringHistory[i + 1]
                      const changed = prevSnap && prevSnap.pair_address === snap.pair_address &&
                        (prevSnap.pool_confidence !== snap.pool_confidence || prevSnap.pool_is_legitimate !== snap.pool_is_legitimate)
                      return (
                        <tr key={i} className={`border-b border-white/5 ${changed ? 'bg-yellow-500/5' : ''}`}>
                          <td className="py-1.5 text-center text-gray-400 whitespace-nowrap">
                            {new Date(snap.snapshot_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            {changed && <span className="ml-1 text-yellow-400" title={t.safety.status_changed}>*</span>}
                          </td>
                          <td className="py-1.5 text-center text-gray-300 whitespace-nowrap">
                            {snap.token0_symbol}/{snap.token1_symbol}
                          </td>
                          <td className={`py-1.5 text-center font-medium ${sConf.color}`}>
                            {sConf.label}
                            {resolved && resolved.level !== 'suspect' && resolved.level !== 'resolving' && (
                              <span className="text-gray-500 text-[8px] ml-0.5 cursor-help" title={resolved.reason}>*</span>
                            )}
                          </td>
                          <td className={`py-1.5 text-center ${snap.pool_is_legitimate ? 'text-emerald-400' : 'text-red-400 font-bold'}`}>
                            {snap.pool_is_legitimate ? 'Yes' : 'No'}
                          </td>
                          <td className="py-1.5 text-center text-gray-300">
                            {snap.reserve_usd != null ? formatUsdCompact(snap.reserve_usd) : '--'}
                          </td>
                          <td className="py-1.5 text-center text-gray-300">
                            {snap.volume_24h_usd != null ? formatUsdCompact(snap.volume_24h_usd) : '--'}
                          </td>
                          <td className="py-1.5 text-center text-gray-500 max-w-[200px] truncate" title={snap.pool_spam_reason || undefined}>
                            {snap.pool_spam_reason
                              ? resolved && resolved.level !== 'suspect' && resolved.level !== 'resolving'
                                ? <span className="text-gray-500">{resolved.reason}</span>
                                : formatSpamReason(snap.pool_spam_reason, snap.token0_symbol, snap.token1_symbol).map(r => r.explanation).join(' ')
                              : <span className="text-gray-600">--</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </PopupPanel>
          </>
        )}

        {monitoringHistory.length === 0 && livePools.length > 0 && (
          <p className="text-xs text-gray-500 text-center py-2">{t.safety.no_monitoring_history}</p>
        )}

        <p className="text-[10px] text-gray-600 text-center">
          Analysis by token_monitoring indexer (runs every 6 hours). Not real-time. Not investment advice.
        </p>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          ⑦ ABOUT THIS PROJECT (AI-generated from tweet analysis)
          ══════════════════════════════════════════════════════════════════════ */}
      {!intelLoading && tokenIntel?.project_summary && (
        <div className="rounded-xl border border-white/5 bg-gray-900/50 p-5 space-y-4 break-inside-avoid">
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
            <Info className="h-4 w-4 text-[#00D4FF]" />
            About This Project
            {tokenIntel.project_summary.type && tokenIntel.project_summary.type !== 'unknown' && (
              <span className={`ml-2 text-[10px] px-2 py-0.5 rounded-full border font-medium ${PROJECT_TYPE_STYLES[tokenIntel.project_summary.type] || PROJECT_TYPE_STYLES.unknown}`}>
                {tokenIntel.project_summary.type.toUpperCase()}
              </span>
            )}
          </h3>

          <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-line">
            {tokenIntel.project_summary.description}
          </p>

          {tokenIntel.project_summary.objective && tokenIntel.project_summary.objective !== 'Unknown' && (
            <div className="rounded-lg bg-gray-800/40 border border-white/5 p-3">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">{t.safety.objective}</p>
              <p className="text-sm text-gray-300">{tokenIntel.project_summary.objective}</p>
            </div>
          )}

          <div className="flex flex-wrap gap-4 text-xs text-gray-400">
            {tokenIntel.project_summary.team && (
              <div><span className="text-gray-500">{t.safety.team_label}</span> <span className="text-gray-300">{tokenIntel.project_summary.team}</span></div>
            )}
            {tokenIntel.project_summary.launch_date && (
              <div><span className="text-gray-500">{t.safety.launch_label}</span> <span className="text-gray-300">{tokenIntel.project_summary.launch_date}</span></div>
            )}
            {tokenIntel.project_summary.links?.website && (
              <a href={tokenIntel.project_summary.links.website} target="_blank" rel="noopener noreferrer" className="text-[#00D4FF] hover:underline flex items-center gap-1">
                Website <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {tokenIntel.project_summary.links?.twitter && (
              <a href={tokenIntel.project_summary.links.twitter} target="_blank" rel="noopener noreferrer" className="text-[#00D4FF] hover:underline flex items-center gap-1">
                Twitter <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>

          <p className="text-[10px] text-gray-600 italic">
            AI-generated profile based on {tokenIntel.analyzed_tweet_count.toLocaleString('en-US')} tweets. Not investment advice.
          </p>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          ⑧ SOCIAL SENTIMENT (dual-perspective AI analysis)          ══════════════════════════════════════════════════════════════════════ */}
      <div className="rounded-xl border border-white/5 bg-gray-900/50 p-5 space-y-4 break-inside-avoid">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-[#00D4FF]" />
          Social Sentiment
          {tokenSentiment && (
            <span className="text-xs font-normal text-gray-500 ml-1">({tokenSentiment.analyzed_tweet_count.toLocaleString('en-US')} tweets analyzed)</span>
          )}
        </h3>

        {sentimentLoading && (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-gray-500" />
          </div>
        )}

        {!sentimentLoading && !tokenSentiment && (
          <div className="text-center py-6">
            <MessageCircle className="h-8 w-8 text-gray-700 mx-auto mb-2" />
            <p className="text-sm text-gray-500">{t.safety.no_sentiment_data}</p>
            <p className="text-xs text-gray-600 mt-1">{t.safety.sentiment_runs_daily}</p>
          </div>
        )}

        {!sentimentLoading && tokenSentiment && (() => {
          const totalTweets = tokenSentiment.community_tweet_count + tokenSentiment.external_tweet_count
          const totalPos = tokenSentiment.community_positive_count + tokenSentiment.external_positive_count
          const totalNeg = tokenSentiment.community_negative_count + tokenSentiment.external_negative_count
          const posPct = totalTweets > 0 ? Math.round((totalPos / totalTweets) * 100) : 0
          const negPct = totalTweets > 0 ? Math.round((totalNeg / totalTweets) * 100) : 0
          const neutralPct = 100 - posPct - negPct

          const allArgs = [
            ...tokenSentiment.community_arguments,
            ...tokenSentiment.external_arguments,
          ]
          const posArgs = allArgs.filter(a => a.stance === 'positive')
          const negArgs = allArgs.filter(a => a.stance === 'negative')

          return (
            <>
              {/* Dual score cards */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-[#00D4FF]/5 border border-[#00D4FF]/10">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Users className="h-3.5 w-3.5 text-[#00D4FF]" />
                    <span className="text-[10px] text-gray-400 uppercase font-medium">{t.safety.community}</span>
                  </div>
                  <div className={`text-xl font-bold ${
                    (tokenSentiment.community_score ?? 0) >= 65 ? 'text-emerald-400'
                    : (tokenSentiment.community_score ?? 0) >= 40 ? 'text-yellow-400'
                    : 'text-red-400'
                  }`}>
                    {tokenSentiment.community_score ?? '--'}/100
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">{tokenSentiment.community_tweet_count.toLocaleString('en-US')} tweets</div>
                </div>
                <div className="p-3 rounded-lg bg-[#8000E0]/5 border border-[#8000E0]/10">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Eye className="h-3.5 w-3.5 text-[#8000E0]" />
                    <span className="text-[10px] text-gray-400 uppercase font-medium">{t.safety.external}</span>
                  </div>
                  <div className={`text-xl font-bold ${
                    (tokenSentiment.external_score ?? 0) >= 65 ? 'text-emerald-400'
                    : (tokenSentiment.external_score ?? 0) >= 40 ? 'text-yellow-400'
                    : 'text-red-400'
                  }`}>
                    {tokenSentiment.external_score ?? '--'}/100
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">{tokenSentiment.external_tweet_count.toLocaleString('en-US')} tweets</div>
                </div>
              </div>

              {/* Combined sentiment bar */}
              <div className="p-3 rounded-lg bg-gray-800/50 border border-white/5 space-y-1.5">
                <div className="flex items-center justify-between text-xs text-gray-400">
                  <span>{totalTweets} tweets total</span>
                  <div className="flex items-center gap-3">
                    <span className="text-emerald-400">{posPct}% positive</span>
                    <span className="text-red-400">{negPct}% negative</span>
                    <span>{neutralPct}% neutral</span>
                  </div>
                </div>
                <div className="h-2 rounded-full bg-gray-700 overflow-hidden flex">
                  {totalTweets > 0 && (
                    <>
                      <div className="h-full bg-emerald-500 transition-all" style={{ width: `${posPct}%` }} />
                      <div className="h-full bg-gray-500 transition-all" style={{ width: `${neutralPct}%` }} />
                      <div className="h-full bg-red-500 transition-all" style={{ width: `${negPct}%` }} />
                    </>
                  )}
                </div>
              </div>

              {/* View full analysis button */}
              {allArgs.length > 0 && (
                <button
                  onClick={() => setSentimentModalOpen(true)}
                  className="w-full flex items-center justify-center gap-2 text-sm font-semibold text-[#00D4FF] hover:text-white rounded-lg border border-[#00D4FF]/30 bg-[#00D4FF]/5 hover:bg-[#00D4FF]/10 py-2.5 transition-colors"
                >
                  View full sentiment analysis ({posArgs.length} positive, {negArgs.length} negative arguments)
                </button>
              )}
            </>
          )
        })()}

        <p className="text-[10px] text-gray-600 text-center">
          AI-analyzed Twitter mentions. Not investment advice.
        </p>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          ⑨ SOCIAL HISTORY (AI timeline from tweet analysis)
          ══════════════════════════════════════════════════════════════════════ */}
      {!intelLoading && tokenIntel && tokenIntel.social_timeline.length > 0 && (
        <div className="rounded-xl border border-white/5 bg-gray-900/50 p-5 space-y-4 break-inside-avoid">
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
            <Clock className="h-4 w-4 text-[#00D4FF]" />
            Social History
            <span className="text-xs font-normal text-gray-500 ml-1">({tokenIntel.social_timeline.length} events)</span>
          </h3>

          {/* Preview: first 3 events */}
          <div className="relative pl-6 space-y-4">
            <div className="absolute left-[5px] top-2 bottom-2 w-px bg-gradient-to-b from-[#00D4FF]/30 via-[#8000E0]/20 to-transparent" />

            {tokenIntel.social_timeline.slice(0, 3).map((event, i) => {
              const cat = INTEL_CATEGORY_STYLES[event.category] || INTEL_CATEGORY_STYLES.other
              const sentimentColor = event.sentiment >= 65 ? 'text-emerald-400'
                : event.sentiment >= 40 ? 'text-yellow-400'
                : 'text-red-400'
              const impactIcon = event.impact === 'positive'
                ? <TrendingUp className="h-3 w-3 text-emerald-400" />
                : event.impact === 'negative'
                ? <TrendingDown className="h-3 w-3 text-red-400" />
                : <Minus className="h-3 w-3 text-gray-500" />

              return (
                <div key={i} className="relative">
                  <div className={`absolute -left-6 top-1.5 w-[11px] h-[11px] rounded-full border-2 ${
                    event.impact === 'positive' ? 'border-emerald-400 bg-emerald-400/20'
                    : event.impact === 'negative' ? 'border-red-400 bg-red-400/20'
                    : 'border-gray-500 bg-gray-500/20'
                  }`} />

                  <div className="rounded-lg bg-gray-800/30 border border-white/5 p-3 hover:bg-gray-800/50 transition-colors">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-[10px] text-gray-500 font-mono">{event.date?.slice(0, 10)}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${cat.color}`}>
                        {cat.label}
                      </span>
                      <div className="flex items-center gap-1">
                        {impactIcon}
                        <span className={`text-[10px] ${sentimentColor}`}>{event.sentiment}/100</span>
                      </div>
                    </div>
                    <p className="text-sm text-gray-200 font-medium">{event.title}</p>
                    <p className="text-xs text-gray-400 mt-1 leading-relaxed">{event.description}</p>
                    {event.cause && (
                      <p className="text-xs text-gray-500 mt-1.5 italic">
                        <span className="text-gray-600">{t.safety.cause_label}</span> {event.cause}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Show all events button → opens modal */}
          {tokenIntel.social_timeline.length > 3 && (
            <button
              onClick={() => setTimelineModalOpen(true)}
              className="w-full py-2.5 rounded-lg border border-[#00D4FF]/30 bg-[#00D4FF]/5 hover:bg-[#00D4FF]/10 text-sm font-semibold text-[#00D4FF] hover:text-white transition-colors flex items-center justify-center gap-2"
            >
              Show all {tokenIntel.social_timeline.length} events
            </button>
          )}

          {/* ── Timeline Modal ── */}
          {timelineModalOpen && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" onClick={() => setTimelineModalOpen(false)}>
              <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
              <div
                className="relative bg-gray-900 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
                onClick={e => e.stopPropagation()}
              >
                {/* Modal header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 shrink-0">
                  <h3 className="text-base font-semibold text-gray-200 flex items-center gap-2">
                    <Clock className="h-4 w-4 text-[#00D4FF]" />
                    Social History — {tokenIntel.token_symbol || 'Token'}
                    <span className="text-xs font-normal text-gray-500">({tokenIntel.social_timeline.length} events)</span>
                  </h3>
                  <button
                    onClick={() => setTimelineModalOpen(false)}
                    className="text-gray-500 hover:text-white transition-colors p-1"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                {/* Modal body: scrollable timeline */}
                <div className="overflow-y-auto flex-1 px-6 py-5">
                  <div className="relative pl-6 space-y-4">
                    <div className="absolute left-[5px] top-2 bottom-2 w-px bg-gradient-to-b from-[#00D4FF]/30 via-[#8000E0]/20 to-transparent" />

                    {tokenIntel.social_timeline.map((event, i) => {
                      const cat = INTEL_CATEGORY_STYLES[event.category] || INTEL_CATEGORY_STYLES.other
                      const sentimentColor = event.sentiment >= 65 ? 'text-emerald-400'
                        : event.sentiment >= 40 ? 'text-yellow-400'
                        : 'text-red-400'
                      const impactIcon = event.impact === 'positive'
                        ? <TrendingUp className="h-3 w-3 text-emerald-400" />
                        : event.impact === 'negative'
                        ? <TrendingDown className="h-3 w-3 text-red-400" />
                        : <Minus className="h-3 w-3 text-gray-500" />

                      return (
                        <div key={i} className="relative">
                          <div className={`absolute -left-6 top-1.5 w-[11px] h-[11px] rounded-full border-2 ${
                            event.impact === 'positive' ? 'border-emerald-400 bg-emerald-400/20'
                            : event.impact === 'negative' ? 'border-red-400 bg-red-400/20'
                            : 'border-gray-500 bg-gray-500/20'
                          }`} />

                          <div className="rounded-lg bg-gray-800/30 border border-white/5 p-3 hover:bg-gray-800/50 transition-colors">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span className="text-[10px] text-gray-500 font-mono">{event.date?.slice(0, 10)}</span>
                              <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${cat.color}`}>
                                {cat.label}
                              </span>
                              <div className="flex items-center gap-1">
                                {impactIcon}
                                <span className={`text-[10px] ${sentimentColor}`}>{event.sentiment}/100</span>
                              </div>
                            </div>
                            <p className="text-sm text-gray-200 font-medium">{event.title}</p>
                            <p className="text-xs text-gray-400 mt-1 leading-relaxed">{event.description}</p>
                            {event.cause && (
                              <p className="text-xs text-gray-500 mt-1.5 italic">
                                <span className="text-gray-600">{t.safety.cause_label}</span> {event.cause}
                              </p>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Mentioned addresses */}
          {tokenIntel.mentioned_addresses.length > 0 && (
            <div className="border-t border-white/5 pt-3 space-y-2">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                <Fingerprint className="h-3.5 w-3.5" />
                Mentioned Addresses ({tokenIntel.mentioned_addresses.length})
              </h4>
              <div className="space-y-1">
                {tokenIntel.mentioned_addresses.slice(0, 5).map((addr, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs p-1.5 rounded bg-gray-800/30">
                    <a
                      href={`https://scan.pulsechain.com/address/${addr.address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[#00D4FF] hover:underline shrink-0"
                    >
                      {addr.address.slice(0, 6)}...{addr.address.slice(-4)}
                    </a>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                      addr.type === 'token' ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                      : 'bg-gray-500/10 text-gray-400 border-gray-500/20'
                    }`}>{addr.type}</span>
                    <span className="text-gray-500 truncate">{addr.context.slice(0, 60)}</span>
                    <span className="text-gray-600 ml-auto shrink-0">{addr.mention_count}x</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-[10px] text-gray-600 italic">
            AI analysis of {tokenIntel.analyzed_tweet_count.toLocaleString('en-US')} tweets via {tokenIntel.model_version?.split('/').pop() || 'LLM'}. Events are extracted from community discussion — verify independently.
          </p>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          ⑩ TOKEN IDENTITY (informational)
          Phase E: Canonical registry replaces auto-populated pulsechain_tokens (Finding #3)
          Status: Canonical / Address differs / Unlisted
          ══════════════════════════════════════════════════════════════════════ */}
      <div id="identity" className="rounded-xl border border-white/5 bg-gray-900/50 p-5 space-y-4 break-inside-avoid">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
          <Fingerprint className="h-4 w-4 text-[#00D4FF]" />
          Token Identity
          <span className="text-[10px] text-gray-600 font-normal normal-case tracking-normal ml-auto">{t.safety.informational}</span>
        </h3>

        {/* Token registry status — canonical check */}
        {(() => {
          const symbol = tokenInfo?.symbol?.toUpperCase()
          const canonical = symbol ? CANONICAL_TOKENS[symbol] : undefined
          const isCanonical = canonical && address && canonical.address.toLowerCase() === address.toLowerCase()
          const addressDiffers = canonical && address && canonical.address.toLowerCase() !== address.toLowerCase()
          return (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">{t.safety.symbol_label}</span>
                <span className="font-medium">{tokenInfo?.symbol || address?.slice(0, 10)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">{t.safety.name_label}</span>
                <span>{tokenInfo?.name || t.safety.unknown}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">{t.safety.canonical_status}</span>
                {isCanonical ? (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-400 font-bold">
                    <CheckCircle className="h-3 w-3" /> {t.safety.badge_canonical}
                  </span>
                ) : addressDiffers ? (
                  <span className="inline-flex items-center gap-1 text-xs text-red-400 font-bold">
                    <XCircle className="h-3 w-3" /> {t.safety.badge_address_differs}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                    {t.safety.badge_unlisted}
                  </span>
                )}
              </div>
              {canonical && (
                <div className="flex justify-between">
                  <span className="text-gray-400">{t.safety.source_label}</span>
                  <span className="text-xs text-gray-500">{canonical.source}</span>
                </div>
              )}
              {/* Warning banner for address mismatch */}
              {addressDiffers && canonical && (
                <div className="rounded-lg bg-red-500/5 border border-red-500/10 px-3 py-2 mt-1">
                  <div className="text-xs text-red-300 font-bold mb-1">{t.safety.impersonation_warning}</div>
                  <p className="text-[11px] text-red-300/80">
                    This token uses the symbol "{tokenInfo?.symbol}" but its address does not match the canonical {canonical.name} ({canonical.address.slice(0, 10)}...{canonical.address.slice(-6)}).
                    This could be a fork copy, a scam, or a different token. Verify the contract before interacting.
                  </p>
                  <Link to={`/token/${canonical.address}`} className="inline-flex items-center gap-1 mt-1.5 text-[10px] text-[#00D4FF] hover:underline">
                    <Shield className="h-3 w-3" /> {t.safety.canonical_symbol.replace('{symbol}', tokenInfo?.symbol || '')}
                  </Link>
                </div>
              )}
            </div>
          )
        })()}

        {/* Token Address Comparison — dual check: canonical + known (from pools) */}
        {uniquePoolTokens.length > 0 && (
          <div className="pt-2 border-t border-white/5">
            <div className="text-xs text-gray-400 mb-3 font-medium">{t.safety.token_address_comparison}</div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/10 text-gray-500">
                  <th className="py-1.5 text-left">{t.safety.table_symbol}</th>
                  <th className="py-1.5 text-left">{t.safety.table_address_in_pools}</th>
                  <th className="py-1.5 text-center">{t.safety.table_status}</th>
                  <th className="py-1.5 text-center">{t.safety.title}</th>
                </tr>
              </thead>
              <tbody>
                {uniquePoolTokens.map((pt, idx) => {
                  // Canonical registry check (curated, reliable)
                  const canonicalEntry = pt.symbol ? CANONICAL_TOKENS[pt.symbol.toUpperCase()] : undefined
                  const isCanonicalMatch = canonicalEntry && pt.address && canonicalEntry.address.toLowerCase() === pt.address.toLowerCase()
                  const isCanonicalMismatch = canonicalEntry && pt.address && canonicalEntry.address.toLowerCase() !== pt.address.toLowerCase()
                  // Fallback: pulsechain_tokens check (auto-populated, less reliable)
                  const knownTokens = pt.symbol ? verifiedTokens[pt.symbol] : undefined
                  const matchesKnown = knownTokens?.some(v => v.address.toLowerCase() === pt.address?.toLowerCase())
                  return (
                    <Fragment key={idx}>
                      <tr className="border-b border-white/5">
                        <td className="py-1.5 text-white font-medium">{pt.symbol ?? '--'}</td>
                        <td className="py-1.5 font-mono text-gray-300">
                          {pt.address ? (
                            <a href={`https://scan.mypinata.cloud/ipfs/bafybeienxyoyrhn5tswclvd3gdjy5mtkkwmu37aqtml6onbf7xnb3o22pe/#/address/${pt.address}`}
                              target="_blank" rel="noopener noreferrer"
                              className="hover:text-cyan-400 transition-colors"
                            >
                              {pt.address.slice(0, 10)}...{pt.address.slice(-8)}
                            </a>
                          ) : '--'}
                        </td>
                        <td className="py-1.5 text-center">
                          {!pt.address ? <span className="text-gray-600">--</span>
                            : isCanonicalMatch ? <span className="text-emerald-400 font-bold">{t.safety.badge_canonical}</span>
                            : isCanonicalMismatch ? <span className="text-red-400 font-bold">{t.safety.badge_address_differs}</span>
                            : matchesKnown ? <span className="text-cyan-400">{t.safety.badge_known}</span>
                            : <span className="text-gray-500">{t.safety.badge_unlisted}</span>}
                        </td>
                        <td className="py-1.5 text-center">
                          {pt.address && (
                            <Link to={`/token/${pt.address}`}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#00D4FF]/10 border border-[#00D4FF]/20 text-[#00D4FF] hover:bg-[#00D4FF]/20 transition-colors"
                              title={`Token Safety analysis for ${pt.symbol}`}
                            >
                              <Shield className="h-3 w-3" />
                              <span className="text-[10px] font-medium">{t.safety.analyze}</span>
                            </Link>
                          )}
                        </td>
                      </tr>
                      {/* Show canonical address if mismatch */}
                      {isCanonicalMismatch && canonicalEntry && (
                        <tr className="border-b border-white/5 bg-red-500/5">
                          <td className="py-1 text-emerald-400/60 pl-4 text-[10px]">{t.safety.canonical_symbol.replace('{symbol}', pt.symbol || '')}</td>
                          <td className="py-1 font-mono text-emerald-400/80">
                            <a href={`https://scan.mypinata.cloud/ipfs/bafybeienxyoyrhn5tswclvd3gdjy5mtkkwmu37aqtml6onbf7xnb3o22pe/#/address/${canonicalEntry.address}`}
                              target="_blank" rel="noopener noreferrer"
                              className="hover:text-emerald-300 transition-colors"
                            >
                              {canonicalEntry.address.slice(0, 10)}...{canonicalEntry.address.slice(-8)}
                            </a>
                          </td>
                          <td className="py-1 text-center text-emerald-400 font-bold">{t.safety.badge_canonical}</td>
                          <td className="py-1 text-center">
                            <Link to={`/token/${canonicalEntry.address}`}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                              title={`Token Safety for canonical ${pt.symbol}`}
                            >
                              <Shield className="h-3 w-3" />
                              <span className="text-[10px] font-medium">{t.safety.analyze}</span>
                            </Link>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
            <p className="text-[10px] text-gray-600 mt-2">
              "Canonical" = verified address from curated registry ({Object.keys(CANONICAL_TOKENS).length} tokens).
              "Known" = found in auto-populated database (not manually verified).
              "Address differs" = same symbol but different contract than canonical — potential impersonation.
              "Unlisted" = symbol not in either registry.
            </p>
          </div>
        )}
      </div>

      {/* ── Sentiment Analysis Modal ── */}
      {sentimentModalOpen && tokenSentiment && (() => {
        const allArgs = [
          ...tokenSentiment.community_arguments.map(a => ({ ...a, source: 'community' as const })),
          ...tokenSentiment.external_arguments.map(a => ({ ...a, source: 'external' as const })),
        ]
        const posArgs = allArgs.filter(a => a.stance === 'positive').sort((a, b) => b.frequency - a.frequency)
        const negArgs = allArgs.filter(a => a.stance === 'negative').sort((a, b) => b.frequency - a.frequency)

        const FACTUAL_BADGE: Record<string, string> = {
          confirmed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
          partial: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
          unverifiable: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
          debunked: 'bg-red-500/10 text-red-400 border-red-500/20',
        }

        const formatDateRange = (earliest?: string, latest?: string) => {
          if (!earliest) return null
          const fmt = (d: string) => {
            const [y, m, day] = d.split('-')
            return `${day}/${m}/${y}`
          }
          if (!latest || earliest === latest) return fmt(earliest)
          return `${fmt(earliest)} — ${fmt(latest)}`
        }

        const renderArg = (arg: SentimentArgument & { source: string }, i: number) => (
          <div key={i} className="p-3 rounded-lg bg-gray-800/30 border border-white/5 space-y-2">
            <div className="flex items-start gap-2">
              {arg.stance === 'positive'
                ? <ThumbsUp className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                : <ThumbsDown className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />}
              <p className="text-sm text-gray-200">{arg.argument}</p>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-gray-500 flex-wrap">
              <span className={`px-1.5 py-0.5 rounded border ${
                arg.source === 'community'
                  ? 'bg-[#00D4FF]/5 text-[#00D4FF]/70 border-[#00D4FF]/15'
                  : 'bg-[#8000E0]/5 text-[#8000E0]/70 border-[#8000E0]/15'
              }`}>{arg.source === 'community' ? t.safety.community : t.safety.external}</span>
              {formatDateRange(arg.earliest_date, arg.latest_date) && (
                <>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatDateRange(arg.earliest_date, arg.latest_date)}
                  </span>
                </>
              )}
              <span>·</span>
              <span>{arg.frequency} mentions</span>
              {arg.ai_evaluation && (
                <>
                  <span>·</span>
                  <span className={`px-1.5 py-0.5 rounded border text-[10px] ${FACTUAL_BADGE[arg.ai_evaluation.factual] || FACTUAL_BADGE.unverifiable}`}>
                    {arg.ai_evaluation.factual}
                  </span>
                  <span>·</span>
                  <span>{t.safety.pertinence_label} {arg.ai_evaluation.pertinence_score}/100</span>
                </>
              )}
            </div>
            {arg.ai_evaluation && (
              <div className="pl-5 space-y-1">
                {arg.ai_evaluation.evidence && (
                  <p className="text-[11px] text-gray-500">
                    <span className="text-gray-600 font-medium">{t.safety.evidence_label}</span> {arg.ai_evaluation.evidence}
                  </p>
                )}
                {arg.ai_evaluation.conclusion && (
                  <p className="text-[11px] text-gray-400 italic">{arg.ai_evaluation.conclusion}</p>
                )}
              </div>
            )}
          </div>
        )

        const shownArgs = sentimentTab === 'positive' ? posArgs : negArgs

        return (
          <div
            className="fixed inset-0 z-[9999] backdrop-blur-md overflow-y-auto p-4 sm:p-[3vw]"
            onClick={() => setSentimentModalOpen(false)}
          >
            <div
              className="relative w-full max-w-4xl mx-auto rounded-2xl border border-white/10 bg-gray-900 shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              {/* Close button */}
              <button
                onClick={() => setSentimentModalOpen(false)}
                className="absolute top-4 right-4 rounded-lg p-1.5 text-gray-400 hover:bg-white/10 hover:text-white transition-colors z-10"
              >
                <X className="h-5 w-5" />
              </button>

              {/* Header with scores */}
              <div className="px-6 pt-5 pb-4 border-b border-white/5">
                <h3 className="text-base font-semibold text-gray-200 flex items-center gap-2 mb-4">
                  <MessageCircle className="h-4 w-4 text-[#00D4FF]" />
                  Sentiment Analysis — {tokenSentiment.token_symbol || 'Token'}
                  <span className="text-xs font-normal text-gray-500">({tokenSentiment.analyzed_tweet_count} tweets)</span>
                </h3>

                {/* Score recap: Community / External */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="p-3 rounded-lg bg-[#00D4FF]/5 border border-[#00D4FF]/10 flex items-center gap-3">
                    <Users className="h-4 w-4 text-[#00D4FF]" />
                    <div>
                      <div className="text-[10px] text-gray-400 uppercase">{t.safety.community}</div>
                      <div className={`text-lg font-bold ${
                        (tokenSentiment.community_score ?? 0) >= 65 ? 'text-emerald-400'
                        : (tokenSentiment.community_score ?? 0) >= 40 ? 'text-yellow-400' : 'text-red-400'
                      }`}>{tokenSentiment.community_score ?? '--'}/100</div>
                    </div>
                    <span className="text-[10px] text-gray-500 ml-auto">{tokenSentiment.community_tweet_count.toLocaleString('en-US')} tweets</span>
                  </div>
                  <div className="p-3 rounded-lg bg-[#8000E0]/5 border border-[#8000E0]/10 flex items-center gap-3">
                    <Eye className="h-4 w-4 text-[#8000E0]" />
                    <div>
                      <div className="text-[10px] text-gray-400 uppercase">{t.safety.external}</div>
                      <div className={`text-lg font-bold ${
                        (tokenSentiment.external_score ?? 0) >= 65 ? 'text-emerald-400'
                        : (tokenSentiment.external_score ?? 0) >= 40 ? 'text-yellow-400' : 'text-red-400'
                      }`}>{tokenSentiment.external_score ?? '--'}/100</div>
                    </div>
                    <span className="text-[10px] text-gray-500 ml-auto">{tokenSentiment.external_tweet_count.toLocaleString('en-US')} tweets</span>
                  </div>
                </div>

                {/* Independent Analysis — between scores and argument tabs */}
                {tokenSentiment.verdict && tokenSentiment.verdict.overall_assessment && (
                  <div className="mb-4 space-y-4">
                    <h4 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
                      <Search className="h-4 w-4 text-[#00D4FF]" />
                      Independent Analysis
                    </h4>

                    <div className="flex gap-3">
                      {tokenSentiment.verdict.positive_validity != null && (
                        <div className="flex-1 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/10 text-center">
                          <div className="text-xl font-bold text-emerald-400">{tokenSentiment.verdict.positive_validity}%</div>
                          <div className="text-xs text-gray-500">{t.safety.positive_claims_valid}</div>
                        </div>
                      )}
                      {tokenSentiment.verdict.negative_validity != null && (
                        <div className="flex-1 p-3 rounded-lg bg-red-500/5 border border-red-500/10 text-center">
                          <div className="text-xl font-bold text-red-400">{tokenSentiment.verdict.negative_validity}%</div>
                          <div className="text-xs text-gray-500">{t.safety.negative_claims_valid}</div>
                        </div>
                      )}
                    </div>

                    <div className="p-4 rounded-lg bg-gray-800/30 border border-white/5">
                      <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-line">{tokenSentiment.verdict.overall_assessment}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs">
                      {tokenSentiment.verdict.key_facts_confirmed.length > 0 && (
                        <div className="space-y-1.5">
                          <span className="text-emerald-400 font-semibold">{t.safety.confirmed}</span>
                          {tokenSentiment.verdict.key_facts_confirmed.map((f, i) => (
                            <div key={i} className="flex items-start gap-1.5 text-gray-300">
                              <CheckCircle className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                              <span>{f}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {tokenSentiment.verdict.key_facts_debunked.length > 0 && (
                        <div className="space-y-1.5">
                          <span className="text-red-400 font-semibold">{t.safety.debunked}</span>
                          {tokenSentiment.verdict.key_facts_debunked.map((f, i) => (
                            <div key={i} className="flex items-start gap-1.5 text-gray-300">
                              <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
                              <span>{f}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {tokenSentiment.verdict.unverifiable_claims.length > 0 && (
                        <div className="space-y-1.5">
                          <span className="text-gray-400 font-semibold">{t.safety.unverifiable}</span>
                          {tokenSentiment.verdict.unverifiable_claims.map((f, i) => (
                            <div key={i} className="flex items-start gap-1.5 text-gray-400">
                              <AlertTriangle className="h-3.5 w-3.5 text-gray-500 shrink-0 mt-0.5" />
                              <span>{f}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {tokenSentiment.verdict.risk_factors.length > 0 && (
                        <div className="space-y-1.5">
                          <span className="text-amber-400 font-semibold">{t.safety.risk_factors}</span>
                          {tokenSentiment.verdict.risk_factors.map((f, i) => (
                            <div key={i} className="flex items-start gap-1.5 text-gray-300">
                              <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                              <span>{f}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {tokenSentiment.verdict.conclusion && (
                      <div className="p-4 rounded-lg bg-[#00D4FF]/5 border border-[#00D4FF]/10">
                        <p className="text-sm text-gray-200 font-medium leading-relaxed">{tokenSentiment.verdict.conclusion}</p>
                      </div>
                    )}

                    <p className="text-xs text-gray-600 italic text-center pt-1">
                      AI-generated analysis based on community &amp; external social data. Not investment advice — DYOR.
                    </p>
                  </div>
                )}

                {/* Tabs: Positive / Negative */}
                <div className="flex rounded-lg bg-gray-800/50 border border-white/5 p-0.5">
                  <button
                    onClick={() => setSentimentTab('positive')}
                    className={`flex-1 py-2 px-3 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
                      sentimentTab === 'positive'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    <ThumbsUp className="h-3.5 w-3.5" />
                    Positive Sentiment ({posArgs.length})
                  </button>
                  <button
                    onClick={() => setSentimentTab('negative')}
                    className={`flex-1 py-2 px-3 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
                      sentimentTab === 'negative'
                        ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                        : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    <ThumbsDown className="h-3.5 w-3.5" />
                    Negative Sentiment ({negArgs.length})
                  </button>
                </div>
              </div>

              {/* Body — arguments only */}
              <div className="px-6 py-5 space-y-5 max-h-[60vh] overflow-y-auto">
                {shownArgs.length > 0 && (
                  <div className="space-y-3">
                    {shownArgs.map((arg, i) => renderArg(arg, i))}
                  </div>
                )}
                {shownArgs.length === 0 && (
                  <div className="text-center py-8 text-sm text-gray-500">{t.safety.no_arguments_found.replace('{tab}', sentimentTab)}</div>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      </div>{/* end grid */}

      {/* Classification version footer (P3-B) */}
      <div className="text-center text-[10px] text-gray-600 pt-2">
        Classification v2.0 — 7 criteria, last calibrated 2026-03-13
      </div>
    </div>
  )
}
