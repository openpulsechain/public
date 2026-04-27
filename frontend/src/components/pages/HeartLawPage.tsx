import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import {
  Calculator, BookOpen, ChevronDown, ChevronUp,
  AlertTriangle, RefreshCw, Settings, Plus, X, Info, Layers, TrendingUp,
  Shield, BarChart3,
} from 'lucide-react'
import { ShareButton } from '../ui/ShareButton'
import { usePulseXPoolReserves } from '../../hooks/usePulseXPoolReserves'
import {
  runSimulation,
  formatPrice,
  formatMultiplier,
  formatWithSpaces,
  realisticMultiplier,

  type SimulationInput,
  type SimulationResult,
  type PoolState,
} from '../../lib/heartLawEngine'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from 'recharts'
import { useTranslation } from '../../i18n'
import { useLiveTokenPricesOverview } from '../../hooks/useLiveTokenPricesOverview'

// ─── Constants ───

type SimMode = 'even' | 'hex-plsx' | 'custom'
type ResultTab = 'results' | 'liquidity'

const TOKENS = ['HEX', 'PLSX', 'PLS', 'INC'] as const
type Token = typeof TOKENS[number]

const TOKEN_COLORS: Record<string, string> = {
  PLS: '#00D4FF',
  HEX: '#FF6B35',
  PLSX: '#8000E0',
  INC: '#00E676',
}

const TOKEN_LOGOS: Record<string, string> = {
  PLS: '/tokens/pls.png',
  HEX: '/tokens/phex.png',
  PLSX: '/tokens/plsx.png',
  INC: '/tokens/inc.png',
}

// ─── Utility Components ───

function TokenBadge({ token }: { token: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-xs font-semibold border"
      style={{
        backgroundColor: `${TOKEN_COLORS[token]}15`,
        borderColor: `${TOKEN_COLORS[token]}40`,
        color: TOKEN_COLORS[token],
      }}
    >
      <img src={TOKEN_LOGOS[token]} alt={token} className="w-4 h-4 rounded-full" />
      {token}
    </span>
  )
}

function InfoTooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false)
  return (
    <span className="relative inline-block">
      <Info
        className="h-3.5 w-3.5 text-gray-500 cursor-help"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
      />
      {show && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 rounded-lg bg-gray-900 border border-white/10 text-xs text-gray-300 whitespace-normal w-64 z-50 shadow-xl">
          {text}
        </span>
      )}
    </span>
  )
}


// ─── Liquidity Tab ───

function LiquidityTab({ initial, final }: { initial: PoolState; final: PoolState }) {
  const pools = [
    { name: 'PLS / Stables', before: initial.plsStables, after: final.plsStables, keys: ['pls', 'usd'] as const },
    { name: 'PLS / HEX', before: initial.plsHex, after: final.plsHex, keys: ['pls', 'hex'] as const },
    { name: 'PLS / PLSX', before: initial.plsPlsx, after: final.plsPlsx, keys: ['pls', 'plsx'] as const },
    { name: 'PLS / INC', before: initial.plsInc, after: final.plsInc, keys: ['pls', 'inc'] as const },
    { name: 'PLSX / INC', before: initial.plsxInc, after: final.plsxInc, keys: ['plsx', 'inc'] as const },
  ]

  function fmtReserve(v: number): string {
    if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`
    if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`
    return v.toFixed(2)
  }

  return (
    <div className="space-y-3">
      {pools.map(pool => {
        const k0 = pool.keys[0]
        const k1 = pool.keys[1]
        const before0 = (pool.before as Record<string, number>)[k0]
        const after0 = (pool.after as Record<string, number>)[k0]
        const before1 = (pool.before as Record<string, number>)[k1]
        const after1 = (pool.after as Record<string, number>)[k1]
        const change0 = after0 / before0
        const change1 = after1 / before1

        return (
          <div key={pool.name} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
            <p className="text-xs font-semibold text-gray-400 mb-2">{pool.name}</p>
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <p className="text-gray-600 uppercase text-[9px]">{k0.toUpperCase()}</p>
                <p className="font-mono text-gray-400">{fmtReserve(before0)}</p>
                <p className="font-mono text-white">{fmtReserve(after0)}</p>
                <p className={`font-mono text-[10px] ${change0 > 1 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {change0 > 1 ? '+' : ''}{((change0 - 1) * 100).toFixed(1)}%
                </p>
              </div>
              <div>
                <p className="text-gray-600 uppercase text-[9px]">{k1.toUpperCase()}</p>
                <p className="font-mono text-gray-400">{fmtReserve(before1)}</p>
                <p className="font-mono text-white">{fmtReserve(after1)}</p>
                <p className={`font-mono text-[10px] ${change1 > 1 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {change1 > 1 ? '+' : ''}{((change1 - 1) * 100).toFixed(1)}%
                </p>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Educational Sections ───

function EducationalSection() {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState<string | null>(null)
  const toggle = (id: string) => setExpanded(expanded === id ? null : id)

  const sections = [
    {
      id: 'amm',
      icon: <Calculator className="h-5 w-5 text-[#00D4FF]" />,
      title: t.heartlaw.amm_section_title,
      content: (
        <div className="space-y-3 text-sm text-gray-300">
          <p>
            {t.heartlaw.amm_intro}
          </p>
          <div className="rounded-lg bg-black/30 border border-white/10 p-4 font-mono text-center text-lg text-[#00D4FF]">
            x &times; y = k
          </div>
          <p>
            {t.heartlaw.amm_formula}
          </p>
          <p>
            {t.heartlaw.amm_example}
          </p>
          <p className="text-yellow-400/80 text-xs mt-2">
            {t.heartlaw.amm_warning}
          </p>
        </div>
      ),
    },
    {
      id: 'reflexivity',
      icon: <Layers className="h-5 w-5 text-[#8000E0]" />,
      title: t.heartlaw.reflexivity_title,
      content: (
        <div className="space-y-3 text-sm text-gray-300">
          <p>
            {t.heartlaw.reflexivity_intro}
          </p>
          <div className="rounded-lg bg-black/30 border border-white/10 p-4 space-y-2 font-mono text-xs">
            {[t.heartlaw.pool_pls_usdc, t.heartlaw.pool_pls_hex, t.heartlaw.pool_pls_plsx, t.heartlaw.pool_pls_inc, t.heartlaw.pool_plsx_inc].map((p, i) => (
              <div key={i} className="text-gray-400">{p}</div>
            ))}
          </div>
          <p>
            {t.heartlaw.cascade_explanation}
          </p>
          <p className="text-yellow-400/80 text-xs mt-2">
            {t.heartlaw.hearts_law_definition}
          </p>
        </div>
      ),
    },
    {
      id: 'realism',
      icon: <Shield className="h-5 w-5 text-emerald-400" />,
      title: t.heartlaw.realism_title,
      content: (
        <div className="space-y-3 text-sm text-gray-300">
          <p>
            {t.heartlaw.dynamic_sp_desc}
          </p>
          <p>
            {t.heartlaw.lp_withdrawal_desc}
          </p>
          <p>
            {t.heartlaw.mev_tax_desc}
          </p>
        </div>
      ),
    },
    {
      id: 'limitations',
      icon: <AlertTriangle className="h-5 w-5 text-orange-400" />,
      title: t.heartlaw.limitations_title,
      content: (
        <div className="space-y-3 text-sm text-gray-300">
          <p className="font-semibold text-orange-400">
            {t.heartlaw.limitations_warning}
          </p>
          <ul className="list-disc list-inside space-y-2 pl-2 text-gray-400">
            <li>{t.heartlaw.limitation_arbitrage}</li>
            <li>{t.heartlaw.limitation_reflexivity}</li>
            <li>{t.heartlaw.limitation_snapshot}</li>
            <li>{t.heartlaw.limitation_pools}</li>
          </ul>
          <p className="text-red-400/80 text-xs mt-2 font-semibold">
            {t.heartlaw.disclaimer_strong}
          </p>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-2">
      <h2 className="flex items-center gap-2 text-lg font-bold text-white mb-3">
        <BookOpen className="h-5 w-5 text-[#00D4FF]" />
        {t.heartlaw.how_it_works}
      </h2>
      {sections.map(s => (
        <div key={s.id} className="rounded-xl border border-white/5 bg-white/[0.02] overflow-hidden">
          <button
            onClick={() => toggle(s.id)}
            className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
          >
            {s.icon}
            <span className="flex-1 text-sm font-medium text-white">{s.title}</span>
            {expanded === s.id
              ? <ChevronUp className="h-4 w-4 text-gray-500" />
              : <ChevronDown className="h-4 w-4 text-gray-500" />}
          </button>
          {expanded === s.id && (
            <div className="px-4 pb-4 border-t border-white/5 pt-3">{s.content}</div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Simulator UI ───

function AmountInput({
  token, value, onChange, onRemove, removable,
}: {
  token: string; value: number; onChange: (v: number) => void
  onRemove?: () => void; removable?: boolean
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
      <span className="text-gray-500 text-sm">$</span>
      <input
        type="text"
        inputMode="numeric"
        value={value === 0 ? '' : formatWithSpaces(value)}
        onChange={e => {
          const raw = e.target.value.replace(/[^0-9]/g, '')
          onChange(raw ? parseInt(raw) : 0)
        }}
        className="flex-1 bg-transparent text-white text-sm outline-none font-mono min-w-0"
        placeholder="0"
      />
      <TokenBadge token={token} />
      {removable && onRemove && (
        <button onClick={onRemove} className="p-0.5 text-gray-600 hover:text-red-400 transition-colors">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

function PriceChart({ result, tokens }: { result: SimulationResult; tokens: string[] }) {
  const { t } = useTranslation()
  const chartData = useMemo(() => {
    if (!result.chunks.length) return []
    const maxPoints = 50
    const step = Math.max(1, Math.floor(result.chunks.length / maxPoints))
    const data = [
      {
        chunk: 0,
        ...Object.fromEntries(tokens.map(t => [t, 1])),
        ...Object.fromEntries(tokens.map(t => [`${t}_nr`, 1])),
      },
    ]
    for (let i = 0; i < result.chunks.length; i += step) {
      const c = result.chunks[i]
      data.push({
        chunk: c.chunkNumber,
        ...Object.fromEntries(tokens.map(t => [t, c.prices[t as Token] / result.initialPrices[t as Token]])),
        ...Object.fromEntries(tokens.map(t => [`${t}_nr`, c.pricesNoReflexivity[t as Token] / result.initialPrices[t as Token]])),
      })
    }
    const last = result.chunks[result.chunks.length - 1]
    if (data[data.length - 1].chunk !== last.chunkNumber) {
      data.push({
        chunk: last.chunkNumber,
        ...Object.fromEntries(tokens.map(t => [t, last.prices[t as Token] / result.initialPrices[t as Token]])),
        ...Object.fromEntries(tokens.map(t => [`${t}_nr`, last.pricesNoReflexivity[t as Token] / result.initialPrices[t as Token]])),
      })
    }
    return data
  }, [result, tokens])

  if (!chartData.length) return null

  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.03] p-4">
      <h3 className="text-sm font-semibold text-white mb-1">{t.heartlaw.chart_title}</h3>
      <p className="text-[10px] text-gray-500 mb-3">
        {t.heartlaw.chart_legend}
      </p>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="chunk" stroke="#6b7280" tick={{ fontSize: 10 }}
            label={{ value: t.heartlaw.chart_xaxis, position: 'bottom', offset: -5, style: { fill: '#6b7280', fontSize: 10 } }} />
          <YAxis stroke="#6b7280" tick={{ fontSize: 10 }} tickFormatter={v => `${v.toFixed(1)}x`} />
          <Tooltip
            contentStyle={{ backgroundColor: 'rgba(17,24,39,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
            wrapperStyle={{ zIndex: 50 }}
            position={{ x: 60, y: 0 }}
            labelFormatter={v => `${t.heartlaw.chunk_label} #${v}`}
            formatter={(value, name) => {
              const n = String(name ?? '')
              const isNR = n.endsWith('_nr')
              const token = isNR ? n.slice(0, -3) : n
              return [`${Number(value ?? 0).toFixed(3)}x`, isNR ? `${token} ${t.heartlaw.isolated_suffix}` : token]
            }}
          />
          <Legend verticalAlign="top" height={36}
            formatter={(value: string) => {
              const isNR = value.endsWith('_nr')
              return isNR ? `${value.slice(0, -3)} ${t.heartlaw.isolated_suffix}` : value
            }}
          />
          {tokens.map(t => (
            <Line key={t} type="monotone" dataKey={t} stroke={TOKEN_COLORS[t]} strokeWidth={2} dot={false} />
          ))}
          {tokens.map(t => (
            <Line key={`${t}_nr`} type="monotone" dataKey={`${t}_nr`} stroke={TOKEN_COLORS[t]}
              strokeWidth={1} strokeDasharray="5 5" dot={false} opacity={0.4} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Main Page ───

// Map TradingView symbol → Heart Law token name
const SYMBOL_MAP: Record<string, string> = { WPLS: 'PLS', HEX: 'HEX', PLSX: 'PLSX', INC: 'INC' }

export function HeartLawPage() {
  const { t } = useTranslation()
  const { pools, totalReserveUsd, loading, refetch } = usePulseXPoolReserves()

  // Live prices from TradingView (5s polling)
  const { data: liveTokens } = useLiveTokenPricesOverview()
  const livePrices = useMemo(() => {
    const map: Record<string, number> = {}
    for (const item of liveTokens) {
      const tk = SYMBOL_MAP[item.token_symbol || '']
      if (tk && item.price_usd != null) map[tk] = item.price_usd
    }
    return map
  }, [liveTokens])

  // Simulation mode
  const [mode, setMode] = useState<SimMode>('even')
  const [customTokens, setCustomTokens] = useState<string[]>(['HEX', 'PLSX', 'PLS', 'INC'])
  const [amounts, setAmounts] = useState<Record<string, number>>({ HEX: 0, PLSX: 0, PLS: 0, INC: 0 })
  const [reserveAmount, setReserveAmount] = useState(100_000_000)
  const [ethPriceOverride, setEthPriceOverride] = useState(2300)
  const [sellPressure, setSellPressure] = useState<Record<string, number>>({ HEX: 0, PLSX: 0, PLS: 0, INC: 0 })
  const [liquidityReduction, setLiquidityReduction] = useState(0)
  const [ethLive, setEthLive] = useState(true)
  const [includeFees, setIncludeFees] = useState(true)
  const [dynamicSellPressure, setDynamicSellPressure] = useState(false)
  const [lpWithdrawal, setLpWithdrawal] = useState(false)
  const [mevTax, setMevTax] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [ethEditing, setEthEditing] = useState(false)
  const [ethEditValue, setEthEditValue] = useState('')
  const [showReflexive, setShowReflexive] = useState(true)
  const [viewMode, setViewMode] = useState<'amm' | 'realistic'>('amm')
  const [resultTab, setResultTab] = useState<ResultTab>('results')
  const [result, setResult] = useState<SimulationResult | null>(null)

  // Price flash animation (green/red then white) — driven by live TradingView prices
  const prevPricesRef = useRef<Record<string, number>>({})
  const [priceFlash, setPriceFlash] = useState<Map<string, 'up' | 'down'>>(new Map())
  const flashTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    if (Object.keys(livePrices).length === 0) return
    const newFlashes = new Map<string, 'up' | 'down'>()
    for (const tk of TOKENS) {
      const prev = prevPricesRef.current[tk]
      const cur = livePrices[tk]
      if (cur == null) continue
      if (prev != null && cur !== prev) {
        const dir = cur > prev ? 'up' : 'down'
        newFlashes.set(tk, dir)
        const existing = flashTimersRef.current.get(tk)
        if (existing) clearTimeout(existing)
        flashTimersRef.current.set(tk, setTimeout(() => {
          setPriceFlash(p => { const n = new Map(p); n.delete(tk); return n })
          flashTimersRef.current.delete(tk)
        }, 3000))
      }
      prevPricesRef.current[tk] = cur
    }
    if (newFlashes.size > 0) {
      setPriceFlash(p => {
        const n = new Map(p)
        for (const [k, v] of newFlashes) n.set(k, v)
        return n
      })
    }
  }, [livePrices])

  // Fetch live ETH price: Binance → Coinbase → Kraken cascade
  const fetchEthPrice = useCallback(async () => {
    // Binance (fastest, CORS *, USDT ≈ USD)
    try {
      const r = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT')
      if (r.ok) { const d = await r.json(); const p = parseFloat(d.price); if (p > 0) return p }
    } catch { /* next */ }
    // Coinbase (real USD)
    try {
      const r = await fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot')
      if (r.ok) { const d = await r.json(); const p = parseFloat(d.data.amount); if (p > 0) return p }
    } catch { /* next */ }
    // Kraken
    try {
      const r = await fetch('https://api.kraken.com/0/public/Ticker?pair=ETHUSD')
      if (r.ok) { const d = await r.json(); const p = parseFloat(d.result.XETHZUSD.c[0]); if (p > 0) return p }
    } catch { /* all failed */ }
    return null
  }, [])

  // Set initial ETH price + sync from hook fallback
  useEffect(() => {
    fetchEthPrice().then(p => { if (p) setEthPriceOverride(Math.round(p)) })
  }, [fetchEthPrice])

  // Poll ETH every 30s when Live is on
  useEffect(() => {
    if (!ethLive) return
    const interval = setInterval(() => {
      fetchEthPrice().then(p => { if (p) setEthPriceOverride(Math.round(p)) })
    }, 30_000)
    return () => clearInterval(interval)
  }, [ethLive, fetchEthPrice])

  const effectiveAmounts = useMemo(() => {
    if (mode === 'even') {
      const perToken = Math.floor(reserveAmount / 4)
      return { HEX: perToken, PLSX: perToken, PLS: perToken, INC: perToken }
    }
    if (mode === 'hex-plsx') {
      const perToken = Math.floor(reserveAmount / 2)
      return { HEX: perToken, PLSX: perToken, PLS: 0, INC: 0 }
    }
    return amounts
  }, [mode, reserveAmount, amounts])

  const activeTokens = useMemo(() =>
    Object.entries(effectiveAmounts).filter(([, v]) => v > 0).map(([k]) => k),
    [effectiveAmounts]
  )

  const totalAmount = useMemo(() =>
    Object.values(effectiveAmounts).reduce((s, v) => s + v, 0),
    [effectiveAmounts]
  )



  const handleCalculate = useCallback(() => {
    if (!pools) return
    const input: SimulationInput = {
      amounts: effectiveAmounts,
      sellPressure,
      liquidityReduction,
      includeFees,
      dynamicSellPressure,
      lpWithdrawal,
      mevTax,
    }
    const res = runSimulation(pools, input, totalReserveUsd)
    setResult(res)
    setResultTab('results')
  }, [pools, effectiveAmounts, sellPressure, liquidityReduction, includeFees, dynamicSellPressure, lpWithdrawal, mevTax, totalReserveUsd])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-600 border-t-[#00D4FF]" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="rounded-2xl border border-white/5 bg-gradient-to-br from-red-500/5 via-purple-500/5 to-cyan-500/5 backdrop-blur-sm p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          {/* Left: title + description */}
          <div className="flex-shrink-0">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-xl bg-red-400/10 border border-red-400/20">
                <Calculator className="h-6 w-6 text-red-400" />
              </div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-red-300 to-purple-400 bg-clip-text text-transparent">
                {t.heartlaw.title}
              </h1>
              <ShareButton title={t.heartlaw.title} text={t.heartlaw.description} />
              <div className="flex items-center gap-2 text-[10px] text-gray-600 ml-2">
                <span>{t.heartlaw.total_label} ${(totalReserveUsd / 1_000_000).toFixed(1)}M</span>
                <button onClick={refetch} className="flex items-center gap-1 text-gray-500 hover:text-[#00D4FF] transition-colors">
                  <RefreshCw className="h-3 w-3" /> {t.heartlaw.refresh_button}
                </button>
              </div>
            </div>
            <p className="text-gray-400 max-w-xl text-sm">
              {t.heartlaw.description}
            </p>
          </div>
          {/* Right: Live token prices */}
          <div className="grid grid-cols-2 gap-2 flex-shrink-0">
            {TOKENS.map(tk => {
              const flash = priceFlash.get(tk)
              const price = livePrices[tk]
              return (
                <div key={tk} className="flex items-center gap-2 rounded-xl bg-white/[0.04] border border-white/10 px-3 py-2">
                  <img src={TOKEN_LOGOS[tk]} alt={tk} className="w-6 h-6 rounded-full flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1 text-[10px] text-gray-500 font-medium">
                      {tk}
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                      </span>
                    </div>
                    <div className={`text-xs font-bold font-mono transition-colors duration-700 ${
                      flash === 'up' ? 'text-emerald-400'
                      : flash === 'down' ? 'text-red-400'
                      : 'text-white'
                    }`}>
                      {price != null ? formatPrice(price) : '--'}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Simulator Card */}
      <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5 space-y-4">
        {/* Mode tabs */}
        <div className="flex flex-wrap items-center gap-2">
          {([
            { key: 'custom' as SimMode, label: t.heartlaw.mode_custom },
            { key: 'even' as SimMode, label: t.heartlaw.mode_even },
            { key: 'hex-plsx' as SimMode, label: t.heartlaw.mode_hex_plsx },
          ]).map(m => (
            <button
              key={m.key}
              onClick={() => {
                if (m.key === 'custom') {
                  // Pre-fill custom amounts from current effective split
                  const ea = mode === 'even'
                    ? (() => { const p = Math.floor(reserveAmount / 4); return { HEX: p, PLSX: p, PLS: p, INC: p } })()
                    : mode === 'hex-plsx'
                    ? { HEX: Math.floor(reserveAmount / 2), PLSX: Math.floor(reserveAmount / 2), PLS: 0, INC: 0 }
                    : amounts
                  setAmounts(ea)
                  setCustomTokens(Object.entries(ea).filter(([, v]) => v > 0).map(([k]) => k))
                }
                setMode(m.key); setResult(null)
              }}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                mode === m.key
                  ? 'bg-gradient-to-r from-[#8000E0]/30 to-[#FF0040]/30 text-white border border-[#8000E0]/40'
                  : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
              }`}
            >
              {m.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            {mode === 'custom' && (
              <button
                onClick={() => {
                  const available = TOKENS.filter(tk => !customTokens.includes(tk))
                  if (available.length > 0) {
                    setCustomTokens([...customTokens, available[0]])
                    setAmounts(prev => ({ ...prev, [available[0]]: 0 }))
                  }
                }}
                className="rounded-lg p-1.5 text-gray-500 hover:text-[#00D4FF] hover:bg-white/5 transition-colors"
              >
                <Plus className="h-4 w-4" />
              </button>
            )}
            <div className="relative">
              <button
                onClick={() => setShowSettings(!showSettings)}
                className={`rounded-lg p-1.5 transition-colors ${
                  showSettings ? 'text-[#00D4FF] bg-white/5' : 'text-gray-500 hover:text-white hover:bg-white/5'
                }`}
              >
                <Settings className="h-4 w-4" />
              </button>
              {/* Settings popover — click outside to close */}
              {showSettings && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowSettings(false)} />
                </>
              )}
              {showSettings && (
                <div className="absolute right-0 top-full mt-2 w-80 rounded-2xl border border-white/10 bg-gray-950/95 backdrop-blur-xl shadow-2xl p-5 space-y-4 z-50">
                  <h4 className="text-sm font-semibold text-white">{t.heartlaw.settings}</h4>

                  {/* Sell pressure */}
                  <div className="space-y-3">
                    <label className="text-xs text-gray-400 flex items-center gap-1">
                      {t.heartlaw.base_sell_pressure}
                      <InfoTooltip text={t.heartlaw.base_sell_pressure_tooltip} />
                    </label>
                    {TOKENS.map(tk => (
                      <div key={tk} className="flex items-center gap-3">
                        <span className="text-xs w-10" style={{ color: TOKEN_COLORS[tk] }}>{tk}</span>
                        <input type="range" min={0} max={90} value={sellPressure[tk] || 0}
                          onChange={e => { setSellPressure(prev => ({ ...prev, [tk]: parseInt(e.target.value) })); setResult(null) }}
                          className="flex-1 accent-[#8000E0] h-1 rounded-full appearance-none bg-white/10 cursor-pointer"
                        />
                        <span className="text-xs text-gray-400 w-8 text-right">{sellPressure[tk] || 0}%</span>
                      </div>
                    ))}
                  </div>

                  {/* Liquidity reduction */}
                  <div className="space-y-2">
                    <label className="text-xs text-gray-400 flex items-center gap-1">
                      {t.heartlaw.liquidity_reduction}
                      <InfoTooltip text={t.heartlaw.liquidity_reduction_tooltip} />
                    </label>
                    <div className="flex items-center gap-3">
                      <input type="range" min={0} max={50} value={liquidityReduction}
                        onChange={e => { setLiquidityReduction(parseInt(e.target.value)); setResult(null) }}
                        className="flex-1 accent-[#8000E0] h-1 rounded-full appearance-none bg-white/10 cursor-pointer"
                      />
                      <span className="text-xs text-gray-400 w-8 text-right">{liquidityReduction}%</span>
                    </div>
                  </div>

                  {/* Toggles */}
                  <div className="space-y-3 border-t border-white/5 pt-3">
                    {[
                      { label: t.heartlaw.swap_fees, value: includeFees, set: setIncludeFees,
                        tip: t.heartlaw.swap_fees_tooltip },
                      { label: t.heartlaw.dynamic_sp_toggle, value: dynamicSellPressure, set: setDynamicSellPressure,
                        tip: t.heartlaw.dynamic_sp_tooltip },
                      { label: t.heartlaw.lp_withdrawal_toggle, value: lpWithdrawal, set: setLpWithdrawal,
                        tip: t.heartlaw.lp_withdrawal_tooltip },
                      { label: t.heartlaw.mev_tax_toggle, value: mevTax, set: setMevTax,
                        tip: t.heartlaw.mev_tax_tooltip },
                    ].map(toggle => (
                      <div key={toggle.label} className="flex items-center justify-between">
                        <label className="text-xs text-gray-400 flex items-center gap-1">
                          {toggle.label}
                          <InfoTooltip text={toggle.tip} />
                        </label>
                        <button
                          onClick={() => { toggle.set(!toggle.value); setResult(null) }}
                          className={`w-10 h-5 rounded-full transition-colors relative ${toggle.value ? 'bg-[#8000E0]' : 'bg-gray-700'}`}
                        >
                          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${toggle.value ? 'left-5' : 'left-0.5'}`} />
                        </button>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={() => setShowSettings(false)}
                    className="w-full rounded-xl border border-white/10 py-2 text-sm text-gray-300 hover:text-white hover:bg-white/5 transition-colors"
                  >
                    {t.heartlaw.close}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <p className="text-xs text-gray-500">
          {mode === 'even' && t.heartlaw.mode_even_desc}
          {mode === 'hex-plsx' && t.heartlaw.mode_hex_plsx_desc}
          {mode === 'custom' && t.heartlaw.mode_custom_desc}
        </p>

        {/* Token amount inputs */}
        {mode === 'custom' ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {customTokens.map(tk => (
              <AmountInput
                key={tk} token={tk} value={amounts[tk] || 0}
                onChange={v => { setAmounts(prev => ({ ...prev, [tk]: v })); setResult(null) }}
                onRemove={() => { setCustomTokens(customTokens.filter(ct => ct !== tk)); setAmounts(prev => ({ ...prev, [tk]: 0 })) }}
                removable={customTokens.length > 1}
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Object.entries(effectiveAmounts).filter(([, v]) => v > 0).map(([token, amount]) => (
              <div key={token}
                className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 cursor-pointer hover:border-[#8000E0]/40 transition-colors"
                onClick={() => {
                  setCustomTokens(Object.keys(effectiveAmounts).filter(k => effectiveAmounts[k] > 0))
                  setAmounts(Object.fromEntries(Object.entries(effectiveAmounts).filter(([, v]) => v > 0)))
                  setMode('custom')
                }}
                title="Click to edit"
              >
                <span className="text-gray-500 text-sm">$</span>
                <span className="flex-1 text-white text-sm font-mono">{formatWithSpaces(amount)}</span>
                <TokenBadge token={token} />
              </div>
            ))}
          </div>
        )}

        {/* Calculate button */}
        <button
          onClick={handleCalculate}
          disabled={totalAmount === 0 || !pools}
          className="w-full rounded-xl bg-gradient-to-r from-[#8000E0] to-[#FF0040] py-3 text-white font-semibold text-sm
            hover:from-[#9020FF] hover:to-[#FF2060] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {t.heartlaw.calculate_button}
        </button>

        {/* Reserve + ETH sliders (Pampi-style, single line) */}
        <div className="flex items-center gap-3 text-xs">
          {/* Reserve label + input */}
          <span className="flex items-center gap-1.5 shrink-0">
            <InfoTooltip text={t.heartlaw.reserve_info_tooltip} />
            <span className="text-gray-400">{t.heartlaw.reserve_label}</span>
            <span className="text-gray-500">$</span>
            <input
              type="text"
              value={formatWithSpaces(mode === 'custom' ? totalAmount : reserveAmount)}
              onChange={e => {
                const v = parseInt(e.target.value.replace(/\s/g, '')) || 0
                if (mode !== 'custom') { setReserveAmount(Math.max(100_000, Math.min(v, Math.round(ethPriceOverride * 171_000)))); setResult(null) }
              }}
              readOnly={mode === 'custom'}
              className="font-mono text-white font-semibold bg-transparent border-b border-white/20 focus:border-[#8000E0] outline-none w-24 text-xs"
            />
          </span>
          {/* Reserve slider */}
          {mode !== 'custom' && (
            <input
              type="range" min={100_000} max={Math.round(ethPriceOverride * 171_000)} step={100_000}
              value={Math.min(reserveAmount, Math.round(ethPriceOverride * 171_000))}
              onChange={e => { setReserveAmount(parseInt(e.target.value)); setResult(null) }}
              className="flex-1 min-w-[80px] accent-[#8000E0] h-1.5 rounded-full appearance-none bg-white/10 cursor-pointer"
            />
          )}
          {/* ETH label + input + Live */}
          <span className="flex items-center gap-1.5 shrink-0">
            <span className="text-gray-400">ETH</span>
            <span className="text-gray-500">$</span>
            <input
              type="text"
              value={ethEditing ? ethEditValue : formatWithSpaces(ethPriceOverride)}
              onFocus={() => {
                if (ethLive) return
                setEthEditing(true)
                setEthEditValue(String(ethPriceOverride))
              }}
              onChange={e => {
                if (ethLive) return
                setEthEditValue(e.target.value.replace(/[^0-9]/g, ''))
              }}
              onBlur={() => {
                if (!ethEditing) return
                const v = parseInt(ethEditValue) || 0
                const clamped = Math.max(100, Math.min(v, 30_000))
                setEthPriceOverride(clamped)
                if (reserveAmount > clamped * 171_000) setReserveAmount(Math.round(clamped * 171_000))
                setResult(null)
                setEthEditing(false)
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') { setEthEditing(false) }
              }}
              readOnly={ethLive}
              className={`font-mono font-semibold bg-transparent border-b outline-none w-14 text-xs ${
                ethLive ? 'border-green-500/40 text-green-300' : 'border-white/20 focus:border-[#8000E0] text-white'
              }`}
            />
            <label className="flex items-center gap-0.5 cursor-pointer select-none" title="Use live ETH price">
              <input type="checkbox" checked={ethLive} onChange={e => setEthLive(e.target.checked)} className="accent-green-500 h-3 w-3" />
              <span className={`text-[10px] ${ethLive ? 'text-green-400' : 'text-gray-500'}`}>Live</span>
            </label>
          </span>
          {/* ETH slider */}
          <input
            type="range" min={1_000} max={30_000} step={10}
            value={ethPriceOverride} disabled={ethLive}
            onChange={e => {
              const newEth = parseInt(e.target.value)
              setEthPriceOverride(newEth)
              if (reserveAmount > newEth * 171_000) setReserveAmount(Math.round(newEth * 171_000))
              setResult(null)
            }}
            className="flex-1 min-w-[60px] accent-[#8000E0] h-1.5 rounded-full appearance-none bg-white/10 cursor-pointer disabled:opacity-30"
          />
        </div>
      </div>

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h2 className="flex items-center gap-2 text-lg font-bold text-white">
              <TrendingUp className="h-5 w-5 text-emerald-400" />
              {t.heartlaw.results_title}
            </h2>
          </div>

          {/* Summary stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3 text-center">
              <p className="text-xs text-gray-500">{t.heartlaw.total_injected}</p>
              <p className="text-lg font-bold text-white font-mono">${(result.totalInjected / 1_000_000).toFixed(1)}M</p>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3 text-center">
              <p className="text-xs text-gray-500">{t.heartlaw.effective_injected}</p>
              <p className="text-lg font-bold text-emerald-400 font-mono">${(result.effectiveInjected / 1_000_000).toFixed(1)}M</p>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3 text-center">
              <p className="text-xs text-gray-500">{t.heartlaw.swap_chunks}</p>
              <p className="text-lg font-bold text-[#00D4FF] font-mono">{result.chunks.length}</p>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3 text-center">
              <p className="text-xs text-gray-500">
                {result.lpWithdrawnPct > 0 ? t.heartlaw.lp_withdrawn : t.heartlaw.fees_label}
              </p>
              <p className={`text-lg font-bold font-mono ${result.lpWithdrawnPct > 0 ? 'text-orange-400' : 'text-yellow-400'}`}>
                {result.lpWithdrawnPct > 0 ? `${result.lpWithdrawnPct.toFixed(1)}%` : includeFees ? '0.29%' : t.heartlaw.fees_no}
              </p>
            </div>
          </div>

          {/* Dynamic SP info */}
          {dynamicSellPressure && Object.keys(result.dynamicSellPressureApplied).length > 0 && (
            <div className="flex flex-wrap items-center gap-3 text-[10px] text-gray-500">
              <span>{t.heartlaw.avg_sell_pressure}</span>
              {Object.entries(result.dynamicSellPressureApplied).map(([token, sp]) => (
                <span key={token} className="font-mono" style={{ color: TOKEN_COLORS[token] }}>
                  {token} {sp}%
                </span>
              ))}
            </div>
          )}

          {/* Results / Liquidity tabs */}
          <div className="flex gap-2">
            <button
              onClick={() => setResultTab('results')}
              className={`flex-1 rounded-xl py-2 text-sm font-medium transition-colors ${
                resultTab === 'results'
                  ? 'bg-gradient-to-r from-[#8000E0]/30 to-[#FF0040]/30 text-white border border-[#8000E0]/40'
                  : 'text-gray-400 hover:text-white border border-white/5 hover:bg-white/5'
              }`}
            >
              {t.heartlaw.results_tab}
            </button>
            <button
              onClick={() => setResultTab('liquidity')}
              className={`flex-1 rounded-xl py-2 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                resultTab === 'liquidity'
                  ? 'bg-gradient-to-r from-[#8000E0]/30 to-[#FF0040]/30 text-white border border-[#8000E0]/40'
                  : 'text-gray-400 hover:text-white border border-white/5 hover:bg-white/5'
              }`}
            >
              <BarChart3 className="h-4 w-4" /> {t.heartlaw.liquidity_tab}
            </button>
          </div>

          {resultTab === 'results' ? (
            <>
              {/* AMM / Realistic toggle */}
              <div className="flex items-center gap-2">
                {(['amm', 'realistic'] as const).map(v => (
                  <button
                    key={v}
                    onClick={() => setViewMode(v)}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                      viewMode === v
                        ? v === 'realistic'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                          : 'bg-gradient-to-r from-[#8000E0]/30 to-[#FF0040]/30 text-white border border-[#8000E0]/40'
                        : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
                    }`}
                  >
                    {v === 'amm' ? t.heartlaw.view_amm : t.heartlaw.view_realistic}
                  </button>
                ))}
              </div>

              {viewMode === 'realistic' && (
                <p className="text-xs text-emerald-400/70 leading-relaxed">
                  {t.heartlaw.realistic_note}
                </p>
              )}

              {/* Results table */}
              <div className="rounded-xl border border-white/5 bg-white/[0.03]">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="text-left text-xs text-gray-500 font-medium px-5 py-3">{t.heartlaw.table_ticker}</th>
                      <th className="text-right text-xs text-gray-500 font-medium px-5 py-3">{t.heartlaw.table_initial}</th>
                      <th className="text-right text-xs text-gray-500 font-medium px-5 py-3">{t.heartlaw.table_new}</th>
                      <th className="text-right text-xs text-gray-500 font-medium px-5 py-3">{t.heartlaw.table_change}</th>
                      {viewMode === 'realistic' && (
                        <th className="text-right text-xs text-emerald-400/70 font-medium px-5 py-3">{t.heartlaw.table_realistic}</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {TOKENS.map(tk => {
                      const priceData = showReflexive ? result.finalPrices : result.finalPricesNoReflexivity
                      const multData = showReflexive ? result.multipliers : result.multipliersNoReflexivity
                      const injRatio = result.totalInjected / (totalReserveUsd || result.totalInjected * 0.1)
                      const realMult = realisticMultiplier(multData[tk], injRatio)
                      const realPrice = result.initialPrices[tk] * realMult
                      return (
                        <tr key={tk} className="border-b border-white/5 last:border-b-0">
                          <td className="px-5 py-4">
                            <div className="flex items-center gap-2.5">
                              <img src={TOKEN_LOGOS[tk]} alt={tk} className="w-6 h-6 rounded-full flex-shrink-0" />
                              <span className="font-semibold text-white text-sm">{tk}</span>
                            </div>
                          </td>
                          <td className="text-right px-5 py-4 font-mono text-gray-400 text-sm">
                            {formatPrice(result.initialPrices[tk])}
                          </td>
                          <td className="text-right px-5 py-4 font-mono text-white font-semibold text-sm">
                            {formatPrice(viewMode === 'realistic' ? realPrice : priceData[tk])}
                          </td>
                          <td className="text-right px-5 py-4">
                            <span className={`font-mono font-bold text-sm ${viewMode === 'realistic' ? 'text-gray-600 line-through' : ''}`} style={viewMode !== 'realistic' ? { color: TOKEN_COLORS[tk] } : undefined}>
                              {formatMultiplier(multData[tk])}
                            </span>
                          </td>
                          {viewMode === 'realistic' && (
                            <td className="text-right px-5 py-4">
                              <span className="font-mono font-bold text-sm text-emerald-400">
                                {formatMultiplier(realMult)}
                              </span>
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Reflexivity toggle */}
              <div className="flex items-center justify-center gap-3">
                <span className="text-xs text-gray-500">{t.heartlaw.reflexivity_toggle}</span>
                <InfoTooltip text={t.heartlaw.reflexivity_tooltip} />
                <button
                  onClick={() => setShowReflexive(!showReflexive)}
                  className={`w-10 h-5 rounded-full transition-colors relative ${showReflexive ? 'bg-[#8000E0]' : 'bg-gray-700'}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${showReflexive ? 'left-5' : 'left-0.5'}`} />
                </button>
              </div>
            </>
          ) : (
            <LiquidityTab initial={result.initialPoolState} final={result.poolState} />
          )}

          {/* Chart */}
          <PriceChart result={result} tokens={activeTokens.length > 0 ? activeTokens : ['PLS']} />

          {/* Understanding */}
          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
            <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
              <Layers className="h-4 w-4 text-[#8000E0]" />
              {t.heartlaw.understanding_title}
            </h3>
            <div className="space-y-2 text-xs text-gray-400">
              <p>
                {t.heartlaw.understanding_lines}
              </p>
              {dynamicSellPressure && (
                <p className="text-emerald-400/80">
                  {t.heartlaw.understanding_dsp}
                </p>
              )}
              {lpWithdrawal && (
                <p className="text-orange-400/80">
                  {t.heartlaw.understanding_lp}
                </p>
              )}
              <p className="text-gray-500">
                {t.heartlaw.understanding_footer}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Educational Section */}
      <EducationalSection />

      {/* Disclaimer */}
      <p className="text-center text-xs text-gray-600 pt-4">
        {t.heartlaw.disclaimer_full}
      </p>
    </div>
  )
}
