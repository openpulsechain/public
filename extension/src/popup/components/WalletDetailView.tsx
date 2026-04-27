import { useState, useEffect, useMemo } from 'react'
import { RefreshCw, Loader2, ExternalLink, AlertTriangle, ArrowLeft } from 'lucide-react'
import { keccak256 } from 'js-sha3'
import { useStore } from '../../lib/store'
import {
  getWalletBalances,
  getHolderRank,
  getTokenHistory,
  type WalletBalance,
  type HolderRankResult,
  type PriceHistoryPoint,
} from '../../lib/api'
import { formatUsd, formatPrice } from '../../lib/format'

/* ════════════════════════════════════════════════════════════════════
 *   Shared helpers — used by both Portfolio (multi-wallet selector)
 *   and Explorer (single address lookup).
 * ════════════════════════════════════════════════════════════════════ */

export function formatBalance(val: number): string {
  if (val === 0) return '0'
  if (val < 0.0001) return val.toExponential(2)
  if (val < 1) return val.toFixed(4)
  if (val < 10000) return val.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (val < 1e9) return val.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (val < 1e12) return `${(val / 1e9).toFixed(2)}B`
  return `${(val / 1e12).toFixed(2)}T`
}

function symbolColor(symbol: string): string {
  if (!symbol) return 'hsl(0, 60%, 45%)'
  let hash = 0
  for (let i = 0; i < symbol.length; i++) {
    hash = symbol.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 60%, 45%)`
}

const PLS_LOGO = 'https://tokens.app.pulsex.com/images/tokens/0xA1077a294dDE1B09bB078844df40758a5D0f9a27.png'
const KNOWN_LOGOS: Record<string, string> = {
  'PLS': PLS_LOGO,
  'WPLS': PLS_LOGO,
  'PLSX': 'https://tokens.app.pulsex.com/images/tokens/0x95B303987A60C71504D99Aa1b13B4DA07b0790ab.png',
  'HEX': 'https://tokens.app.pulsex.com/images/tokens/0x2b591e99afE9f32eAA6214f7B7629768c40Eeb39.png',
  'INC': 'https://tokens.app.pulsex.com/images/tokens/0x2fa878Ab3F87CC1C9737Fc071108F904c0B0C95d.png',
  'DAI': 'https://tokens.app.pulsex.com/images/tokens/0xefD766cCb38EaF1dfd701853BFCe31359239F305.png',
  'USDC': 'https://tokens.app.pulsex.com/images/tokens/0x15D38573d2feeb82e7ad5187aB8c1D52810B1f07.png',
  'USDT': 'https://tokens.app.pulsex.com/images/tokens/0x0Cb6F5a34ad42ec934882A05265A7d5F59b51A2f.png',
  'WETH': 'https://tokens.app.pulsex.com/images/tokens/0x02DcdD04e3F455D838cd1249292C58f3B79e3C3C.png',
  'WBTC': 'https://tokens.app.pulsex.com/images/tokens/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599.png',
  'HDRN': 'https://tokens.app.pulsex.com/images/tokens/0x3819f64f282bf135d62168C1e513280dAF905e06.png',
  'LOAN': 'https://tokens.app.pulsex.com/images/tokens/0x9159f1D2a9f51998Fc9Ab03fbd8f265ab14A1b3B.png',
  'USDL': 'https://tokens.app.pulsex.com/images/tokens/0x0dEEd1486bc52aA0d3E6f8849cEC5adD6598A162.png',
  'CST': 'https://tokens.app.pulsex.com/images/tokens/0x600136dA8cc6D1Ea07449514604dc4ab7098dB82.png',
  'PXDC': 'https://tokens.app.pulsex.com/images/tokens/0xeB6b7932Da20c6D7B3a899D5887d86dfB09A6408.png',
  'EARN': 'https://tokens.app.pulsex.com/images/tokens/0xb513038BbFdF9D40B676F41606f4F61D4b02c4A2.png',
  'TIME': 'https://tokens.app.pulsex.com/images/tokens/0xCA35638A3fdDD02fEC597D8c1681198C06b23F58.png',
  'TEXAN': 'https://tokens.app.pulsex.com/images/tokens/0xcFCFfE432A48dB53F59c301422d2EdD77B2A88d7.png',
  'PHUX': 'https://tokens.app.pulsex.com/images/tokens/0x9663c2d75ffd5F4017310405fCe61720aF45B829.png',
  'PHIAT': 'https://tokens.app.pulsex.com/images/tokens/0x96E035ae0905EFaC8F733f133462f971Cfa45dB1.png',
  'BEAN': 'https://tokens.app.pulsex.com/images/tokens/0xd7407BD3E6aD1BAAE0ba9eaFD1Ec41bFE63907B2.png',
  'WATT': 'https://tokens.app.pulsex.com/images/tokens/0xDfdc2836FD2E63Bba9f0eE07901aD465Bff4DE71.png',
  'PINU': 'https://tokens.app.pulsex.com/images/tokens/0xa12E2661ec6603CBbB891072b2Ad5b3d5edb48bd.png',
  'PEPE': 'https://tokens.app.pulsex.com/images/tokens/0x6982508145454Ce325dDbE47a25d4ec3d2311933.png',
  'SHIB': 'https://tokens.app.pulsex.com/images/tokens/0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE.png',
  'LINK': 'https://tokens.app.pulsex.com/images/tokens/0x514910771AF9Ca656af840dff83E8264EcF986CA.png',
  'UNI': 'https://tokens.app.pulsex.com/images/tokens/0x1f9840a85d5af5bf1d1762f925bdaddc4201f984.png',
  'eHEX': 'https://tokens.app.pulsex.com/images/tokens/0x57fde0a71132198BBeC939B98976993d8D89D225.png',
}

function toChecksumAddress(address: string): string {
  const addr = address.toLowerCase().replace('0x', '')
  const hash = keccak256(addr)
  let checksummed = '0x'
  for (let i = 0; i < 40; i++) {
    checksummed += parseInt(hash[i], 16) >= 8 ? addr[i].toUpperCase() : addr[i]
  }
  return checksummed
}

export function TokenAvatar({ symbol: rawSymbol, address }: { symbol: string; address: string }) {
  const symbol = rawSymbol || '??'
  const [urlIdx, setUrlIdx] = useState(0)
  const [failed, setFailed] = useState(false)

  const checksummed = useMemo(() => toChecksumAddress(address), [address])

  const knownUrl = KNOWN_LOGOS[symbol.toUpperCase()]
  const urls = useMemo(() => knownUrl
    ? [knownUrl]
    : [
        `https://tokens.app.pulsex.com/images/tokens/${checksummed}.png`,
        `https://raw.githubusercontent.com/piteasio/app-tokens/main/token-logo/${checksummed}.png`,
        `https://dd.dexscreener.com/ds-data/tokens/pulsechain/${address.toLowerCase()}.png`,
      ], [knownUrl, checksummed, address])

  useEffect(() => { setUrlIdx(0); setFailed(false) }, [address])

  if (failed || urlIdx >= urls.length) {
    return (
      <div
        className="h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 border border-white/10"
        style={{ backgroundColor: symbolColor(symbol) }}
      >
        {symbol.slice(0, 2)}
      </div>
    )
  }

  return (
    <img
      src={urls[urlIdx]}
      alt={symbol}
      className="h-7 w-7 rounded-full shrink-0 bg-gray-800 border border-white/10"
      onError={() => {
        if (urlIdx + 1 < urls.length) setUrlIdx(urlIdx + 1)
        else setFailed(true)
      }}
    />
  )
}

// Canonical addresses for core tokens — multiple valid addresses per symbol
const CANONICAL_ADDRESSES: Record<string, string[]> = {
  HEX: ['0x2b591e99afe9f32eaa6214f7b7629768c40eeb39'],
  PLSX: ['0x95b303987a60c71504d99aa1b13b4da07b0790ab'],
  PLS: ['0xa1077a294dde1b09bb078844df40758a5d0f9a27', '0x0000000000000000000000000000000000000000'],
  WPLS: ['0xa1077a294dde1b09bb078844df40758a5d0f9a27'],
  INC: ['0x2fa878ab3f87cc1c9737fc071108f904c0b0c95d'],
  USDC: ['0x15d38573d2feeb82e7ad5187ab8c1d52810b1f07'],
  USDT: ['0x0cb6f5a34ad42ec934882a05265a7d5f59b51a2f'],
  DAI: ['0xefd766ccb38eaf1dfd701853bfce31359239f305'],
  WETH: ['0x02dcdd04e3f455d838cd1249292c58f3b79e3c3c'],
  WBTC: ['0x2260fac5e5542a773aa44fbcfedf7c193bc2c599'],
}

function isScamClone(b: { symbol: string; token_address: string }): boolean {
  const sym = (b.symbol || '').toUpperCase()
  const validAddresses = CANONICAL_ADDRESSES[sym]
  if (!validAddresses) return false
  return !validAddresses.includes(b.token_address.toLowerCase())
}

const LEAGUE_SYMBOL_MAP: Record<string, string> = {
  'PLS': 'PLS',
  'PLSX': 'PLSX',
  'HEX': 'HEX',
  'INC': 'INC',
}

const TIER_EMOJI: Record<string, string> = {
  poseidon: '\u{1F531}',
  whale: '\u{1F40B}',
  shark: '\u{1F988}',
  dolphin: '\u{1F42C}',
  squid: '\u{1F991}',
  turtle: '\u{1F422}',
}

const TIER_COLOR: Record<string, string> = {
  poseidon: '#fbbf24',
  whale: '#3b82f6',
  shark: '#8b5cf6',
  dolphin: '#06b6d4',
  squid: '#10b981',
  turtle: '#6b7280',
}

const TOKEN_BRAND: Record<string, [string, string]> = {
  HEX: ['#E8198B', '#F7A21B'],
  PLS: ['#00BFFF', '#E8198B'],
  WPLS: ['#00BFFF', '#E8198B'],
  PLSX: ['#00F77E', '#E8192C'],
  INC: ['#2ECC71', '#00E676'],
  USDC: ['#6B7FE8', '#4A5AB8'],
  USDT: ['#50AF95', '#6B7FE8'],
  DAI: ['#F5AC37', '#6B7FE8'],
  WETH: ['#627EEA', '#454A75'],
  WBTC: ['#00BFFF', '#E8198B'],
  HDRN: ['#9945FF', '#7B2FE0'],
  LOAN: ['#00C2FF', '#0088CC'],
  eHEX: ['#E8198B', '#7B2FBE'],
  MOST: ['#FF4D8D', '#CC2266'],
  SHIB: ['#FFA409', '#E08C00'],
  PEPE: ['#4CAF50', '#2E7D32'],
  LINK: ['#2A5ADA', '#1E40AF'],
  UNI: ['#FF007A', '#CC0062'],
}
const FALLBACK_COLORS: [string, string][] = [
  ['#6366f1', '#4f46e5'], ['#ec4899', '#db2777'], ['#14b8a6', '#0d9488'],
  ['#f59e0b', '#d97706'], ['#8b5cf6', '#7c3aed'], ['#06b6d4', '#0891b2'],
]

/* ════════════════════════════════════════════════════════════════════
 *   WalletDetailView — the "wallet view" used by Portfolio and Explorer.
 *   Fully encapsulates fetching + rendering for a single address.
 * ════════════════════════════════════════════════════════════════════ */

interface WalletDetailViewProps {
  address: string
}

export function WalletDetailView({ address }: WalletDetailViewProps) {
  const openTokenDetail = useStore((s) => s.openTokenDetail)

  const [balances, setBalances] = useState<WalletBalance[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ranks, setRanks] = useState<HolderRankResult | null>(null)

  const [showOverview, setShowOverview] = useState(false)
  const [portfolioHistory, setPortfolioHistory] = useState<{ date: string; value: number }[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyDays, setHistoryDays] = useState(30)
  const [historyHover, setHistoryHover] = useState<{ idx: number; x: number; y: number } | null>(null)
  const [tokenHistories, setTokenHistories] = useState<Map<string, { balance: number; history: PriceHistoryPoint[] }>>(new Map())
  const [change30d, setChange30d] = useState<{ pct: number; amount: number; sparkline: number[] } | null>(null)

  // Fetch balances + rank whenever the address changes
  const loadWallet = async (addr: string) => {
    setLoading(true)
    setError(null)
    try {
      const [result, rankResult] = await Promise.all([
        getWalletBalances(addr),
        getHolderRank(addr).catch(() => null),
      ])
      const withValue = result
        .filter((b) => b.value_usd != null && b.value_usd > 0.01)
        .sort((a, b) => (b.value_usd || 0) - (a.value_usd || 0))
      const withoutValue = result
        .filter((b) => b.value_usd == null || b.value_usd <= 0.01)
        .filter((b) => b.balance > 0)
        .sort((a, b) => b.balance - a.balance)
        .slice(0, 20)
      setBalances([...withValue, ...withoutValue])
      setRanks(rankResult)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
      setBalances([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (address) loadWallet(address)
    setShowOverview(false)
    setChange30d(null)
  }, [address])

  const totalUsd = balances.reduce((sum, b) => sum + (b.value_usd || 0), 0)
  const pricedCount = balances.filter(b => b.value_usd != null && b.value_usd > 0).length
  const tokenCount = balances.length

  // Compute 30d portfolio evolution + sparkline
  useEffect(() => {
    if (balances.length === 0) { setChange30d(null); return }
    const pricedTokens = balances.filter(b => b.value_usd != null && b.value_usd > 0).slice(0, 8)
    if (pricedTokens.length === 0) return
    Promise.allSettled(
      pricedTokens.map(t => getTokenHistory(t.token_address, 30).then(h => ({ token: t, history: h })))
    ).then(results => {
      const dailyMap = new Map<string, number>()
      for (const r of results) {
        if (r.status !== 'fulfilled' || !r.value.history.length) continue
        const { token, history } = r.value
        for (const day of history) {
          dailyMap.set(day.date, (dailyMap.get(day.date) || 0) + token.balance * day.price_usd)
        }
      }
      const sorted = [...dailyMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      const sparkline = sorted.map(([, v]) => v)
      if (sparkline.length >= 2) {
        const oldest = sparkline[0]
        const amount = totalUsd - oldest
        const pct = (amount / oldest) * 100
        setChange30d({ pct, amount, sparkline })
      }
    })
  }, [balances, totalUsd])

  // Allocation data
  const allocation = useMemo(() => {
    const items = balances
      .filter(b => b.value_usd != null && b.value_usd > 0)
      .sort((a, b) => (b.value_usd || 0) - (a.value_usd || 0))
    const total = items.reduce((s, b) => s + (b.value_usd || 0), 0)
    if (total === 0) return []
    let fallbackIdx = 0
    const top = items.slice(0, 7)
    const other = items.slice(7)
    const result = top.map((b) => {
      const brand = TOKEN_BRAND[(b.symbol || '').toUpperCase()]
      const colors = brand || FALLBACK_COLORS[fallbackIdx++ % FALLBACK_COLORS.length]
      return {
        symbol: b.symbol,
        value: b.value_usd || 0,
        pct: ((b.value_usd || 0) / total) * 100,
        color: colors[0],
        colorEnd: colors[1],
      }
    })
    if (other.length > 0) {
      const otherVal = other.reduce((s, b) => s + (b.value_usd || 0), 0)
      result.push({ symbol: 'Other', value: otherVal, pct: (otherVal / total) * 100, color: '#4b5563', colorEnd: '#374151' })
    }
    return result
  }, [balances])

  // Load portfolio value history when overview opens or period changes
  useEffect(() => {
    if (!showOverview || balances.length === 0) return
    const pricedTokens = balances.filter(b => b.value_usd != null && b.value_usd > 0).slice(0, 8)
    if (pricedTokens.length === 0) return

    setHistoryLoading(true)
    setHistoryHover(null)
    Promise.allSettled(
      pricedTokens.map(t => getTokenHistory(t.token_address, historyDays).then(h => ({ token: t, history: h })))
    ).then(results => {
      const dailyMap = new Map<string, number>()
      const tokenHists = new Map<string, { balance: number; history: PriceHistoryPoint[] }>()
      for (const r of results) {
        if (r.status !== 'fulfilled' || !r.value.history.length) continue
        const { token, history } = r.value
        tokenHists.set(token.token_address.toLowerCase(), { balance: token.balance, history })
        for (const day of history) {
          const prev = dailyMap.get(day.date) || 0
          dailyMap.set(day.date, prev + token.balance * day.price_usd)
        }
      }
      setTokenHistories(tokenHists)
      const sorted = [...dailyMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      setPortfolioHistory(sorted.map(([date, value]) => ({ date, value })))
      setHistoryLoading(false)
    })
  }, [showOverview, balances, historyDays])

  /* ──────────── Portfolio overview page ──────────── */
  if (showOverview) {
    const PERIOD_OPTIONS = [
      { label: '7D', days: 7 }, { label: '30D', days: 30 }, { label: '90D', days: 90 }, { label: '1Y', days: 365 },
    ]
    const values = portfolioHistory.map(d => d.value)
    const chartMin = values.length ? Math.min(...values) : 0
    const chartMax = values.length ? Math.max(...values) : 1
    const chartRange = chartMax - chartMin || 1
    const W = 340, H = 120, pad = 4
    const pts = portfolioHistory.map((d, i) => ({
      x: pad + (i / Math.max(portfolioHistory.length - 1, 1)) * (W - pad * 2),
      y: H - pad - ((d.value - chartMin) / chartRange) * (H - pad * 2),
    }))
    const line = pts.length > 1 ? `M${pts.map(p => `${p.x},${p.y}`).join(' L')}` : ''
    const area = pts.length > 1 ? `${line} L${W - pad},${H} L${pad},${H} Z` : ''
    const change = values.length >= 2 ? ((values[values.length - 1] - values[0]) / values[0]) * 100 : 0
    const isUp = change >= 0
    const chartColor = isUp ? '#10b981' : '#ef4444'
    const hoverData = historyHover ? portfolioHistory[historyHover.idx] : null
    const tooltipLeft = historyHover ? (historyHover.x > W * 0.65 ? historyHover.x - 136 : historyHover.x + 8) : 0

    const hoveredDate = historyHover ? portfolioHistory[historyHover.idx]?.date : null
    const allocWithAddr = allocation.map(a => {
      const match = balances.find(b => b.symbol === a.symbol)
      const addr = match?.token_address || ''
      let displayValue = a.value
      let displayPrice: number | null = match?.price_usd ?? null
      if (hoveredDate && addr) {
        const hist = tokenHistories.get(addr.toLowerCase())
        if (hist) {
          const dayData = hist.history.find(h => h.date === hoveredDate)
          if (dayData) {
            displayPrice = dayData.price_usd
            displayValue = hist.balance * dayData.price_usd
          }
        }
      }
      return { ...a, address: addr, displayValue, displayPrice }
    })

    return (
      <div className="space-y-3">
        {/* Header */}
        <div className="flex items-center gap-2">
          <button onClick={() => setShowOverview(false)} className="p-1 rounded hover:bg-white/10 transition-colors">
            <ArrowLeft className="h-4 w-4 text-gray-400" />
          </button>
          <span className="text-sm font-semibold text-white">Portfolio Overview</span>
        </div>

        {/* Total + change — dynamic on hover */}
        <div className="text-center">
          <div className="text-2xl font-bold text-white">{formatUsd(hoverData?.value ?? totalUsd)}</div>
          {historyHover && hoverData ? (
            <span className="text-xs text-gray-400">
              {new Date(hoverData.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' })}
            </span>
          ) : values.length >= 2 ? (
            <span className={`text-sm font-bold ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
              {isUp ? '+' : ''}{change.toFixed(1)}% ({historyDays}d)
            </span>
          ) : null}
        </div>

        {/* Time range selector */}
        <div className="flex gap-1">
          {PERIOD_OPTIONS.map(p => (
            <button
              key={p.days}
              onClick={() => setHistoryDays(p.days)}
              className={`flex-1 text-[10px] font-medium py-1 rounded transition-colors ${
                historyDays === p.days ? 'text-white bg-white/10' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Value history chart with tooltip */}
        {historyLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 text-gray-500 animate-spin" /></div>
        ) : pts.length > 1 ? (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full h-32 cursor-crosshair"
            onMouseMove={(e) => {
              const rect = (e.target as SVGElement).closest('svg')?.getBoundingClientRect()
              if (!rect || !pts.length) return
              const mouseX = ((e.clientX - rect.left) / rect.width) * W
              let closest = 0, closestDist = Infinity
              for (let i = 0; i < pts.length; i++) {
                const dist = Math.abs(pts[i].x - mouseX)
                if (dist < closestDist) { closestDist = dist; closest = i }
              }
              setHistoryHover({ idx: closest, x: pts[closest].x, y: pts[closest].y })
            }}
            onMouseLeave={() => setHistoryHover(null)}
          >
            <defs>
              <linearGradient id="portGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={chartColor} stopOpacity="0.25" />
                <stop offset="100%" stopColor={chartColor} stopOpacity="0.02" />
              </linearGradient>
            </defs>
            <path d={area} fill="url(#portGrad)" />
            <path d={line} fill="none" stroke={chartColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            {historyHover && (
              <>
                <line x1={historyHover.x} y1={pad} x2={historyHover.x} y2={H - pad} stroke="rgba(255,255,255,0.2)" strokeWidth="1" strokeDasharray="3,3" />
                <circle cx={historyHover.x} cy={historyHover.y} r="4" fill={chartColor} stroke="#0d0d20" strokeWidth="2" />
                <rect x={tooltipLeft} y={Math.max(2, historyHover.y - 40)} width="128" height="36" rx="6" fill="#0d0d20" stroke="rgba(255,255,255,0.15)" strokeWidth="0.5" />
                <text x={tooltipLeft + 6} y={Math.max(2, historyHover.y - 40) + 15} fill="white" fontSize="12" fontFamily="monospace" fontWeight="bold">
                  {formatUsd(hoverData?.value)}
                </text>
                <text x={tooltipLeft + 6} y={Math.max(2, historyHover.y - 40) + 29} fill="#9ca3af" fontSize="10.5" fontFamily="sans-serif">
                  {hoverData?.date ? new Date(hoverData.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' }) : ''}
                </text>
              </>
            )}
          </svg>
        ) : (
          <p className="text-[11px] text-gray-500 text-center py-6">Not enough data for this period.</p>
        )}

        {/* Allocation table with gradient proportion bars */}
        <div className="space-y-1">
          {allocWithAddr.map((item) => (
            <div key={item.symbol} className="relative rounded-lg overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 rounded-lg"
                style={{
                  width: `${Math.max(item.pct, 3)}%`,
                  background: `linear-gradient(90deg, ${item.color}55, ${item.colorEnd}30)`,
                  borderRight: `2px solid ${item.color}80`,
                }}
              />
              <div className="relative flex items-center gap-2 px-2 py-1.5">
                <TokenAvatar symbol={item.symbol} address={item.address} />
                <span className="text-xs text-white font-semibold w-[40px] shrink-0">{item.symbol}</span>
                <span className="text-[11px] text-gray-400 font-mono flex-1 text-right">{item.displayPrice != null ? formatPrice(item.displayPrice) : ''}</span>
                <span className="text-xs text-white font-mono font-semibold text-right w-[52px] shrink-0">{formatUsd(item.displayValue)}</span>
                <span className="text-[11px] font-bold w-[28px] text-right shrink-0" style={{ color: item.color }}>{item.pct.toFixed(0)}%</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  /* ──────────── Main wallet view ──────────── */
  return (
    <div className="space-y-3">
      {/* Total card with integrated 30d sparkline */}
      {(() => {
        const has30d = change30d && change30d.sparkline.length >= 2
        const isUp = has30d ? change30d!.pct >= 0 : true
        const neonColor = isUp ? '#10b981' : '#ef4444'
        let sLine = '', sArea = ''
        const SW = 340, SH = 36
        if (has30d) {
          const spark = change30d!.sparkline
          const sMin = Math.min(...spark), sMax = Math.max(...spark)
          const sRange = sMax - sMin || 1
          const sPts = spark.map((v, i) => ({
            x: (i / (spark.length - 1)) * SW,
            y: SH - ((v - sMin) / sRange) * SH,
          }))
          sLine = `M${sPts.map(p => `${p.x},${p.y}`).join(' L')}`
          sArea = `${sLine} L${SW},${SH} L0,${SH} Z`
        }
        return (
          <div
            className="relative rounded-xl overflow-hidden border cursor-pointer transition-colors"
            style={{ borderColor: `${neonColor}30` }}
            onClick={() => setShowOverview(true)}
          >
            <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${neonColor}12 0%, ${neonColor}05 50%, transparent 100%)` }} />
            <div className="relative p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider">Total Value</div>
                  <div className="text-xl font-bold text-white mt-0.5">
                    {totalUsd > 0 ? formatUsd(totalUsd) : '$0.00'}
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">
                    {tokenCount} tokens · {pricedCount} priced
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={`https://www.openpulsechain.com/wallet/${address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="p-1.5 rounded-md text-gray-500 hover:bg-white/5 hover:text-pulse-cyan transition-colors"
                    title="View on OpenPulsechain"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                  <button
                    onClick={(e) => { e.stopPropagation(); loadWallet(address) }}
                    disabled={loading}
                    className="p-1.5 rounded-md text-gray-500 hover:bg-white/5 hover:text-white transition-colors"
                    title="Refresh"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>
              {has30d && (
                <div className="flex items-center gap-3">
                  <svg viewBox={`0 0 ${SW} ${SH}`} className="flex-1 h-9" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="sparkFill30" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={neonColor} stopOpacity="0.25" />
                        <stop offset="100%" stopColor={neonColor} stopOpacity="0.02" />
                      </linearGradient>
                      <filter id="neonGlow30">
                        <feGaussianBlur stdDeviation="2.5" result="blur" />
                        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                      </filter>
                    </defs>
                    <path d={sArea} fill="url(#sparkFill30)" />
                    <path d={sLine} fill="none" stroke={neonColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" filter="url(#neonGlow30)" />
                  </svg>
                  <div className="text-right shrink-0">
                    <div className={`text-sm font-bold ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                      {isUp ? '+' : ''}{change30d!.pct.toFixed(1)}%
                    </div>
                    <div className={`text-[11px] font-mono ${isUp ? 'text-emerald-400/70' : 'text-red-400/70'}`}>
                      {change30d!.amount >= 0 ? '+' : ''}{formatUsd(change30d!.amount)}
                    </div>
                    <div className="text-[9px] text-gray-500">30 jours</div>
                  </div>
                </div>
              )}
              <div className="text-[10px] text-gray-600 font-mono truncate">{address}</div>
            </div>
          </div>
        )
      })()}

      {error && <div className="text-xs text-red-400 bg-red-500/10 rounded-lg p-2">{error}</div>}

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 text-gray-500 animate-spin" />
        </div>
      ) : (
        <div className="space-y-0.5">
          {balances.map((b) => {
            const hasPriceData = b.value_usd != null && b.value_usd > 0
            return (
              <div
                key={b.token_address}
                className="flex items-center gap-2.5 py-2 px-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
                onClick={() => openTokenDetail(b.token_address, b.symbol)}
              >
                <TokenAvatar symbol={b.symbol} address={b.token_address} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-white">{b.symbol}</span>
                    {b.price_usd != null && (
                      <span className="text-[9px] text-gray-400">
                        {formatPrice(b.price_usd)}
                      </span>
                    )}
                    {isScamClone(b) && (
                      <span className="flex items-center gap-0.5 text-[10px] font-bold text-red-400 bg-red-500/15 px-1.5 py-0.5 rounded" title={`Fake ${b.symbol} — real address is ${CANONICAL_ADDRESSES[(b.symbol || '').toUpperCase()]?.[0]?.slice(0, 10)}...`}>
                        <AlertTriangle className="h-3 w-3" /> FAKE
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-gray-400 truncate">
                      {isScamClone(b) ? `${b.name} · ${b.token_address.slice(0, 8)}...` : b.name}
                    </span>
                    {(() => {
                      const leagueSym = LEAGUE_SYMBOL_MAP[(b.symbol || '').toUpperCase()]
                      const r = leagueSym && ranks?.ranks?.[leagueSym]
                      if (!r) return null
                      const emoji = TIER_EMOJI[r.tier] || ''
                      const color = TIER_COLOR[r.tier] || '#6b7280'
                      return (
                        <span
                          className="text-[11px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap"
                          style={{ color, backgroundColor: `${color}25` }}
                          title={`${r.tier} — ${r.balance_pct.toFixed(4)}% of supply`}
                        >
                          #{r.rank}/{r.total_holders} {emoji}
                        </span>
                      )
                    })()}
                  </div>
                </div>

                <div className="text-right shrink-0">
                  {hasPriceData ? (
                    <>
                      <div className="text-xs font-medium text-white">{formatUsd(b.value_usd)}</div>
                      <div className="text-[10px] text-gray-400">{formatBalance(b.balance)}</div>
                    </>
                  ) : (
                    <>
                      <div className="text-xs text-gray-400">{formatBalance(b.balance)}</div>
                      <div className="text-[9px] text-gray-600">no price</div>
                    </>
                  )}
                </div>
              </div>
            )
          })}
          {balances.length === 0 && !loading && (
            <p className="text-center text-xs text-gray-500 py-4">No tokens found</p>
          )}
        </div>
      )}
    </div>
  )
}
