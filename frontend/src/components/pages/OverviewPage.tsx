import { useMemo, useState, useRef, useEffect } from 'react'
import { DollarSign, TrendingUp, Fuel, Box, ChevronDown, ChevronUp, Info, ExternalLink, Copy, Check, Coins } from 'lucide-react'
import { KpiCard } from '../cards/KpiCard'
import { AreaChartComponent } from '../charts/AreaChart'
import { Spinner } from '../ui/Spinner'
import { TimeRangeSelector } from '../ui/TimeRangeSelector'
import { useNetworkTvl, useNetworkDexVolume, useTokenPrices, useNetworkSnapshot, usePulsexDefillamaTvl, usePulsexDefillamaVolume } from '../../hooks/useSupabase'
import { useLivePlsPrice } from '../../hooks/useLivePlsPrice'
import { useLiveChainStats } from '../../hooks/useLiveChainStats'
import { useLiveDefiLlama } from '../../hooks/useLiveDefiLlama'
import { useLiveTokenPricesOverview } from '../../hooks/useLiveTokenPricesOverview'
import { formatUsd, formatNumber, formatGwei } from '../../lib/format'
import { useStablecoinSupply } from '../../hooks/useStablecoinSupply'
import { useTranslation } from '../../i18n'

// DexScreener-style subscript zero compression for small prices
const SUBSCRIPT_DIGITS = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉']
function toSubscript(n: number): string {
  return String(n).split('').map(d => SUBSCRIPT_DIGITS[parseInt(d)]).join('')
}
function formatPlsPrice(price: number): string {
  if (price >= 0.01) return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
  if (price === 0) return '$0'
  const str = price.toFixed(20)
  const afterDot = str.split('.')[1] || ''
  let zeros = 0
  for (const c of afterDot) {
    if (c === '0') zeros++
    else break
  }
  if (zeros >= 3) {
    const significant = afterDot.slice(zeros, zeros + 4).replace(/0+$/, '')
    return `$0.0${toSubscript(zeros)}${significant || '0'}`
  }
  return `$${price.toFixed(6)}`
}

type DataSource = 'all' | 'pulsex'

// Standard gas limits for common operations on PulseChain
// `key` is used to look up the translated label via t.overview[key]
const GAS_ESTIMATES = [
  { key: 'gas_pls_send' as const, gasLimit: 21000 },
  { key: 'gas_token_transfer' as const, gasLimit: 65000 },
  { key: 'gas_token_approval' as const, gasLimit: 46000 },
  { key: 'gas_dex_swap' as const, gasLimit: 200000 },
  { key: 'gas_add_liquidity' as const, gasLimit: 300000 },
  { key: 'gas_bridge_transfer' as const, gasLimit: 250000 },
]

function LiveIndicator() {
  const { t } = useTranslation()
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
      <span>({t.common.live})</span>
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
      </span>
    </span>
  )
}

function SourceSelector({ value, onChange }: { value: DataSource; onChange: (v: DataSource) => void }) {
  const { t } = useTranslation()
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as DataSource)}
        className="appearance-none bg-white/5 border border-white/10 rounded-lg px-3 py-1 pr-7 text-xs text-gray-300 cursor-pointer hover:bg-white/10 transition-colors focus:outline-none focus:border-[#00D4FF]/50"
      >
        <option value="all">{t.overview.source_all}</option>
        <option value="pulsex">{t.overview.source_pulsex}</option>
      </select>
      <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500 pointer-events-none" />
    </div>
  )
}

function DataSourceNote({ source, type }: { source: DataSource; type: 'tvl' | 'volume' }) {
  const [open, setOpen] = useState(false)
  const { t } = useTranslation()

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
      >
        <Info className="h-3 w-3" />
        <span>{t.overview.data_source_label}</span>
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-2 rounded-lg bg-white/5 border border-white/10 p-4 text-xs text-gray-400 space-y-3">
          {type === 'tvl' ? (
            <>
              <div className="rounded bg-gray-800/50 border border-white/5 p-3">
                <p className="text-gray-300 font-medium mb-1">{t.overview.tvl_title}</p>
                <p>{t.overview.tvl_definition}</p>
              </div>

              <p className="font-medium text-gray-300">
                {source === 'all'
                  ? t.overview.tvl_all_label
                  : t.overview.tvl_pulsex_label}
              </p>
              <p>
                {source === 'all'
                  ? t.overview.tvl_all_desc
                  : t.overview.tvl_pulsex_desc}
              </p>

              <div>
                <p className="font-medium text-gray-300 mb-2">{t.overview.cross_source_title}</p>
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="py-1 pr-3 text-gray-500 font-medium">Source</th>
                      <th className="py-1 pr-3 text-right text-gray-500 font-medium">TVL</th>
                      <th className="py-1 text-gray-500 font-medium">{t.overview.cross_source_scope}</th>
                    </tr>
                  </thead>
                  <tbody className="text-gray-400">
                    <tr className="border-b border-white/5">
                      <td className="py-1 pr-3">DefiLlama "PulseChain"</td>
                      <td className="py-1 pr-3 text-right font-mono text-white">$66.94M</td>
                      <td className="py-1">{t.overview.cross_all_protocols}</td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="py-1 pr-3">DefiLlama "PulseX"</td>
                      <td className="py-1 pr-3 text-right font-mono text-white">$48.79M</td>
                      <td className="py-1">{t.overview.cross_pulsex_scope}</td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="py-1 pr-3">Subgraph V1 (raw)</td>
                      <td className="py-1 pr-3 text-right font-mono text-amber-400">$31.74M</td>
                      <td className="py-1">{t.overview.cross_v1_scope}</td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="py-1 pr-3">Subgraph V2 (raw)</td>
                      <td className="py-1 pr-3 text-right font-mono text-amber-400">$20.59M</td>
                      <td className="py-1">{t.overview.cross_v2_scope}</td>
                    </tr>
                    <tr>
                      <td className="py-1 pr-3">V1+V2 subgraph combined</td>
                      <td className="py-1 pr-3 text-right font-mono text-amber-400">$52.33M</td>
                      <td className="py-1">{t.overview.cross_combined_scope}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="rounded bg-amber-500/5 border border-amber-500/15 p-2.5 text-[11px]">
                <p className="text-amber-400 font-medium mb-1">{t.overview.spam_warning_title}</p>
                <p className="text-gray-400">
                  {t.overview.spam_warning_desc}
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="rounded bg-gray-800/50 border border-white/5 p-3">
                <p className="text-gray-300 font-medium mb-1">{t.overview.volume_what_title}</p>
                <p>
                  {t.overview.volume_what_desc}
                </p>
              </div>

              <p className="font-medium text-gray-300">
                {source === 'all'
                  ? t.overview.volume_all_label
                  : t.overview.volume_pulsex_label}
              </p>
              <p>
                {source === 'all'
                  ? t.overview.volume_all_desc
                  : t.overview.volume_pulsex_desc}
              </p>

              <div>
                <p className="font-medium text-gray-300 mb-2">{t.overview.volume_breakdown_title}</p>
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="py-1 pr-3 text-gray-500 font-medium">{t.overview.volume_table_dex}</th>
                      <th className="py-1 text-right text-gray-500 font-medium">{t.overview.volume_table_24h}</th>
                    </tr>
                  </thead>
                  <tbody className="text-gray-400">
                    <tr className="border-b border-white/5">
                      <td className="py-1 pr-3">PulseX V1</td>
                      <td className="py-1 text-right font-mono text-white">$1,778,074</td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="py-1 pr-3">PulseX V2</td>
                      <td className="py-1 text-right font-mono text-white">$1,676,205</td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="py-1 pr-3">PulseX StableSwap</td>
                      <td className="py-1 text-right font-mono text-white">$355,246</td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="py-1 pr-3">9mm V3</td>
                      <td className="py-1 text-right font-mono text-white">$347,366</td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="py-1 pr-3">PHUX</td>
                      <td className="py-1 text-right font-mono text-white">$89,181</td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="py-1 pr-3">9mm V2</td>
                      <td className="py-1 text-right font-mono text-white">$288</td>
                    </tr>
                    <tr className="border-t border-white/10 font-medium">
                      <td className="py-1 pr-3 text-gray-300">{t.overview.volume_total_label}</td>
                      <td className="py-1 text-right font-mono text-[#00D4FF]">$4,246,360</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <p className="text-gray-500">
                {t.overview.volume_source_note}
              </p>
            </>
          )}

          <p className="text-gray-600 text-[10px] pt-1 border-t border-white/5">
            {t.overview.historical_data_note}
          </p>
        </div>
      )}
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const { t } = useTranslation()
  return (
    <button
      onClick={(e) => {
        e.preventDefault()
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      className="shrink-0 p-0.5 rounded hover:bg-white/10 transition-colors cursor-pointer"
      title={t.overview.copy_address}
    >
      {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3 text-gray-600 hover:text-[#00D4FF]" />}
    </button>
  )
}

export function OverviewPage() {
  const { t } = useTranslation()
  const tvl = useNetworkTvl()
  const dex = useNetworkDexVolume()
  const prices = useTokenPrices()
  const snapshot = useNetworkSnapshot()
  const livePls = useLivePlsPrice()
  const liveChain = useLiveChainStats()
  const liveLL = useLiveDefiLlama()

  const liveTokens = useLiveTokenPricesOverview()
  const stablecoins = useStablecoinSupply()
  const [stableExpanded, setStableExpanded] = useState(false)

  // PulseX DefiLlama historical data from database (sovereign)
  const pulsexLLTvl = usePulsexDefillamaTvl()
  const pulsexLLVol = usePulsexDefillamaVolume()

  // Source selection
  const [tvlSource, setTvlSource] = useState<DataSource>('all')
  const [volSource, setVolSource] = useState<DataSource>('all')

  const latestTvl = tvl.data.length > 0 ? tvl.data[tvl.data.length - 1] : null
  const latestSnapshot = snapshot.data.length > 0 ? snapshot.data[0] : null
  const plsPrice = prices.data.find((p) => p.symbol === 'PLS')

  // Use live subgraph price (max precision), fallback to cached
  const plsPriceUsd = livePls.price ?? plsPrice?.price_usd ?? null

  // Live chain stats with fallback to cached snapshot
  const liveGasPriceGwei = liveChain.stats?.gasPriceGwei ?? latestSnapshot?.gas_price_gwei ?? null
  const liveBaseFeeGwei = liveChain.stats?.baseFeeGwei ?? latestSnapshot?.base_fee_gwei ?? null
  const liveBlockNumber = liveChain.stats?.blockNumber ?? latestSnapshot?.block_number ?? null

  // Gas estimates computed from gas price + PLS price (live)
  const gasEstimates = useMemo(() => {
    if (!liveGasPriceGwei || !plsPriceUsd) return null
    return GAS_ESTIMATES.map((e) => {
      const costPls = (liveGasPriceGwei * e.gasLimit) / 1e9
      const costUsd = costPls * plsPriceUsd
      return { ...e, costPls, costUsd }
    })
  }, [liveGasPriceGwei, plsPriceUsd])

  const [tvlRange, setTvlRange] = useState<number | null>(null)
  const [dexRange, setDexRange] = useState<number | null>(null)

  // Today's date in YYYY-MM-DD (UTC)
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), [])

  // --- TVL data based on source ---
  const liveTvl = tvlSource === 'all' ? liveLL.tvlAll : liveLL.tvlPulsex
  const tvlBaseData = tvlSource === 'all' ? tvl.data : pulsexLLTvl.data

  const tvlWithLive = useMemo(() => {
    if (!liveTvl || tvlBaseData.length === 0) return tvlBaseData
    const hist = [...tvlBaseData]
    const last = hist[hist.length - 1]
    if (last.date === todayStr) {
      hist[hist.length - 1] = { ...last, tvl_usd: liveTvl }
    } else {
      hist.push({ date: todayStr, tvl_usd: liveTvl })
    }
    return hist
  }, [tvlBaseData, liveTvl, todayStr])

  const tvlRecent = tvlRange ? tvlWithLive.slice(-tvlRange) : tvlWithLive

  // --- Volume data based on source ---
  const liveVol = volSource === 'all' ? liveLL.volumeAll : liveLL.volumePulsex
  const volBaseData = volSource === 'all' ? dex.data : pulsexLLVol.data

  const dexWithLive = useMemo(() => {
    if (!liveVol || volBaseData.length === 0) return volBaseData
    const hist = [...volBaseData]
    const last = hist[hist.length - 1]
    if (last.date === todayStr) {
      hist[hist.length - 1] = { ...last, volume_usd: liveVol }
    } else {
      hist.push({ date: todayStr, volume_usd: liveVol })
    }
    return hist
  }, [volBaseData, liveVol, todayStr])

  const dexRecent = dexRange ? dexWithLive.slice(-dexRange) : dexWithLive

  // --- KPI TVL value: always show "All PulseChain" ---
  const kpiTvl = liveLL.tvlAll ?? (latestTvl ? latestTvl.tvl_usd : null)

  // Track previous prices for flash effect
  const prevPricesRef = useRef<Map<string, number>>(new Map())
  const [priceFlash, setPriceFlash] = useState<Map<string, 'up' | 'down'>>(new Map())
  const flashTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Map live token data for display (already sorted by volume 24h in hook)
  const sortedPrices = useMemo(() => {
    return liveTokens.data.map((t) => {
      const cached = prices.data.find(p => p.address?.toLowerCase() === t.token_address.toLowerCase() || p.id?.toLowerCase() === t.token_address.toLowerCase())
      return {
        id: t.token_address,
        symbol: t.token_symbol || cached?.symbol || '???',
        name: cached?.name || null,
        price_usd: t.price_usd,
        market_cap_usd: t.market_cap_usd,
        volume_24h_usd: t.total_volume_24h_usd,
        price_change_24h_pct: t.price_change_24h,
        address: t.token_address,
        source: 'live' as const,
        last_updated: t.last_updated,
        isLive: true,
        chart_url: t.chart_url,
      }
    })
  }, [liveTokens.data, prices.data])

  // Detect price changes and trigger flash
  useEffect(() => {
    const newFlashes = new Map<string, 'up' | 'down'>()
    for (const token of sortedPrices) {
      if (token.price_usd == null) continue
      const prev = prevPricesRef.current.get(token.id)
      if (prev != null && token.price_usd !== prev) {
        const dir = token.price_usd > prev ? 'up' : 'down'
        newFlashes.set(token.id, dir)
        // Clear existing timer for this token
        const existing = flashTimers.current.get(token.id)
        if (existing) clearTimeout(existing)
        // Auto-clear flash after 3s
        flashTimers.current.set(token.id, setTimeout(() => {
          setPriceFlash(prev => {
            const next = new Map(prev)
            next.delete(token.id)
            return next
          })
          flashTimers.current.delete(token.id)
        }, 3000))
      }
      prevPricesRef.current.set(token.id, token.price_usd)
    }
    if (newFlashes.size > 0) {
      setPriceFlash(prev => {
        const next = new Map(prev)
        for (const [k, v] of newFlashes) next.set(k, v)
        return next
      })
    }
  }, [sortedPrices])

  if (tvl.loading && prices.loading) return <Spinner />

  const tvlIsLoading = tvlSource === 'pulsex' && pulsexLLTvl.loading
  const volIsLoading = volSource === 'pulsex' && pulsexLLVol.loading

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="rounded-xl border border-white/5 bg-gray-900/30 backdrop-blur-sm p-6 sm:p-8 text-center">
        <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-[#00D4FF] to-[#8000E0] bg-clip-text text-transparent">
          {t.overview.hero_title}
        </h1>
        <p className="mt-2 text-gray-400 max-w-xl mx-auto">
          {t.overview.hero_subtitle}
        </p>
        <div className="flex flex-wrap justify-center gap-3 mt-4">
          <span className="rounded-full bg-white/5 border border-emerald-500/30 px-3 py-1 text-xs text-emerald-400">{t.overview.badge_token_safety}</span>
          <span className="rounded-full bg-white/5 border border-blue-500/30 px-3 py-1 text-xs text-blue-400">{t.overview.badge_smart_money}</span>
          <span className="rounded-full bg-white/5 border border-red-500/30 px-3 py-1 text-xs text-red-400">{t.overview.badge_scam_radar}</span>
          <span className="rounded-full bg-white/5 border border-gray-400/30 px-3 py-1 text-xs text-gray-300">{t.overview.badge_free_api}</span>
          <span className="rounded-full bg-white/5 border border-amber-500/30 px-3 py-1 text-xs text-amber-400">{t.overview.badge_2500_tokens}</span>
          <span className="rounded-full bg-white/5 border border-gray-400/30 px-3 py-1 text-xs text-gray-300">{t.overview.badge_open_source}</span>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <KpiCard
          title={t.overview.kpi_pls_price}
          titleSuffix={<LiveIndicator />}
          value={plsPriceUsd ? formatPlsPrice(plsPriceUsd) : '--'}
          trend={plsPrice?.price_change_24h_pct ?? undefined}
          subtitle={t.overview.kpi_24h_change}
          icon={<DollarSign className="h-5 w-5" />}
        />
        <KpiCard
          title={t.overview.kpi_chain_tvl}
          titleSuffix={liveLL.tvlAll ? <LiveIndicator /> : undefined}
          value={kpiTvl ? formatUsd(kpiTvl) : '--'}
          subtitle={t.overview.kpi_all_protocols}
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <KpiCard
          title={t.overview.kpi_gas_price}
          titleSuffix={<LiveIndicator />}
          value={liveGasPriceGwei ? `${formatGwei(liveGasPriceGwei)} Gwei` : '--'}
          subtitle={liveBaseFeeGwei ? `Base: ${formatGwei(liveBaseFeeGwei)}` : ''}
          icon={<Fuel className="h-5 w-5" />}
        />
        <KpiCard
          title={t.overview.kpi_latest_block}
          titleSuffix={<LiveIndicator />}
          value={liveBlockNumber ? formatNumber(liveBlockNumber) : '--'}
          subtitle={t.overview.kpi_block_time}
          icon={<Box className="h-5 w-5" />}
        />
        {/* Stablecoin Market Cap — expandable */}
        <div
          className="col-span-2 lg:col-span-1 rounded-xl border border-white/5 bg-gray-900/40 backdrop-blur-sm p-5 cursor-pointer hover:border-white/10 transition-colors"
          onClick={() => setStableExpanded(prev => !prev)}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400 flex items-center gap-1.5">
              {t.overview.kpi_stablecoin_mcap}
            </span>
            <span className="rounded-lg bg-emerald-500/10 p-1.5 text-emerald-400">
              <Coins className="h-5 w-5" />
            </span>
          </div>
          <div className="mt-2 text-2xl font-bold text-white">
            {stablecoins.totalMcap > 0 ? formatUsd(stablecoins.totalMcap) : '--'}
          </div>
          <div className="mt-1 flex items-center gap-1 text-sm text-gray-500">
            {stablecoins.coins.length} stablecoins
            {stableExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </div>
        </div>
      </div>

      {/* Stablecoin detail table */}
      {stableExpanded && stablecoins.coins.length > 0 && (
        <div className="rounded-xl border border-white/5 bg-gray-900/40 backdrop-blur-sm p-5 -mt-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 text-xs border-b border-white/5">
                <th className="text-left py-2 font-medium">Token</th>
                <th className="text-right py-2 font-medium">Supply</th>
                <th className="text-right py-2 font-medium">USD Value</th>
              </tr>
            </thead>
            <tbody>
              {stablecoins.coins.map(c => (
                <tr key={c.address} className="border-b border-white/5 last:border-0">
                  <td className="py-3">
                    <div className="flex items-center gap-2.5">
                      <img src={c.logo} alt={c.symbol} className="w-6 h-6 rounded-full bg-gray-800" onError={e => { (e.target as HTMLImageElement).src = '/tokens/pls.png' }} />
                      <div>
                        <span className="font-medium text-white">{c.symbol}</span>
                        <span className="text-gray-500 text-xs ml-1.5">{c.name}</span>
                      </div>
                    </div>
                  </td>
                  <td className="text-right text-white font-mono">{formatNumber(Math.round(c.supply))}</td>
                  <td className="text-right text-emerald-400 font-mono">{formatUsd(c.marketCap)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Token Prices Table */}
      <div className="rounded-xl border border-white/5 bg-gray-900/40 backdrop-blur-sm p-5">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">{t.overview.token_prices_title}</h2>
          <span className="text-[11px] text-gray-500 flex items-center gap-1.5">
            {liveTokens.data.length > 0 && (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                </span>
                <span>{t.overview.live_tradingview}</span>
              </>
            )}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-gray-400">
                <th className="py-3">{t.overview.table_token}</th>
                <th className="py-3 text-center">{t.overview.table_price}</th>
                <th className="py-3 text-center">{t.overview.table_24h_change}</th>
                <th className="py-3 text-center" title="Fully Diluted Valuation = Total Supply × Price">
                  <span className="hidden sm:inline">{t.overview.table_market_cap}</span>
                  <span className="sm:hidden">{t.overview.table_mcap}</span>
                  <span className="text-xs text-gray-500 ml-1" title="Fully Diluted Valuation for PulseChain tokens, Circulating for CoinGecko tokens">*</span>
                </th>
                <th className="py-3 text-center" title="24h trading volume from PulseX tokenDayDatas">{t.overview.table_volume_24h}</th>
                <th className="py-3 text-center">{t.overview.table_chart}</th>
              </tr>
            </thead>
            <tbody>
              {sortedPrices.map((token) => (
                <tr key={token.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                  <td className="py-2.5 pr-4">
                    <div className="flex items-center gap-2">
                      <img
                        src={`/tokens/${{ WPLS: 'pls', HEX: 'phex', PLSX: 'plsx', INC: 'inc', PRVX: 'prvx' }[token.symbol] || token.symbol.toLowerCase()}.png`}
                        alt={token.symbol}
                        className="h-7 w-7 rounded-full bg-gray-800 border border-white/10 shrink-0"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                      />
                      <div>
                        <span className="font-medium text-white">{token.symbol}</span>
                        <span className="text-gray-500 ml-1.5">{token.name}</span>
                      </div>
                    </div>
                    {token.address && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <a
                          href={`https://scan.mypinata.cloud/ipfs/bafybeienxyoyrhn5tswclvd3gdjy5mtkkwmu37aqtml6onbf7xnb3o22pe/#/address/${token.address}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-gray-600 hover:text-[#00D4FF] font-mono transition-colors"
                        >
                          {token.address}
                        </a>
                        <CopyButton text={token.address} />
                      </div>
                    )}
                  </td>
                  <td className={`py-2.5 text-center transition-colors duration-700 ${
                    priceFlash.get(token.id) === 'up' ? 'text-emerald-400'
                    : priceFlash.get(token.id) === 'down' ? 'text-red-400'
                    : 'text-white'
                  }`}>
                    {token.price_usd != null
                      ? formatPlsPrice(token.price_usd)
                      : '--'}
                  </td>
                  <td className={`py-2.5 text-center ${
                    (token.price_change_24h_pct ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    {token.price_change_24h_pct != null
                      ? `${token.price_change_24h_pct >= 0 ? '+' : ''}${token.price_change_24h_pct.toFixed(2)}%`
                      : '--'}
                  </td>
                  <td className="py-2.5 text-center text-gray-300">
                    {token.market_cap_usd != null ? formatUsd(token.market_cap_usd) : '--'}
                  </td>
                  <td className="py-2.5 text-center text-gray-300">
                    {(token.volume_24h_usd ?? 0) > 0 ? formatUsd(token.volume_24h_usd!) : <span className="text-gray-600">--</span>}
                  </td>
                  <td className="py-2.5 text-center">
                    {token.chart_url ? (
                      <a
                        href={token.chart_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-[#00D4FF]/70 hover:text-[#00D4FF] transition-colors"
                      >
                        <span>{t.overview.price_link}</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <span className="text-gray-600">--</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details className="mt-4 rounded-lg bg-white/5 border border-white/10 text-xs text-gray-500">
          <summary className="px-4 py-3 cursor-pointer hover:bg-white/5 transition-colors text-gray-400 font-medium flex items-center gap-1.5">
            <Info className="h-3.5 w-3.5" />
            {t.overview.about_methodology}
          </summary>
          <div className="px-4 pb-4 space-y-2">
            <div className="rounded bg-gray-800/50 border border-white/5 p-3">
              <p className="text-xs text-gray-400">
                <strong className="text-gray-300">PLS</strong> (Wrapped Pulse), <strong className="text-gray-300">HEX</strong>, <strong className="text-gray-300">PLSX</strong> (PulseX), <strong className="text-gray-300">INC</strong> (Incentive), <strong className="text-gray-300">PRVX</strong> (ProveX) — {t.overview.methodology_tokens_desc} <strong className="text-gray-300">{t.overview.methodology_tokens_founder}</strong>{t.overview.methodology_tokens_suffix} <a href="/tokens" className="text-[#00D4FF]/70 hover:text-[#00D4FF] transition-colors">{t.overview.methodology_tokens_page}</a> {t.overview.methodology_tokens_page_suffix}
              </p>
            </div>
            <p className="font-medium text-gray-400">{t.overview.methodology_title}</p>
            <ul className="space-y-1 list-disc list-inside">
              <li><strong className="text-gray-400">{t.overview.methodology_prices_label}</strong> {t.overview.methodology_prices_desc}</li>
              <li><strong className="text-gray-400">{t.overview.methodology_mcap_label}</strong> {t.overview.methodology_mcap_desc}</li>
              <li><strong className="text-gray-400">{t.overview.methodology_volume_label}</strong> {t.overview.methodology_volume_desc}</li>
              <li><strong className="text-gray-400">{t.overview.methodology_change_label}</strong> {t.overview.methodology_change_desc}</li>
            </ul>
            <p className="text-gray-600 pt-1">
              {t.overview.methodology_footer} <a href="https://scan.mypinata.cloud/ipfs/bafybeienxyoyrhn5tswclvd3gdjy5mtkkwmu37aqtml6onbf7xnb3o22pe/#/" target="_blank" rel="noopener noreferrer" className="text-[#00D4FF]/50 hover:text-[#00D4FF] transition-colors">PulseChain Explorer</a> {t.overview.methodology_footer_suffix}
              {t.common.disclaimer}
            </p>
          </div>
        </details>
      </div>

      {/* TVL Chart */}
      <div className="rounded-xl border border-white/5 bg-gray-900/40 backdrop-blur-sm p-5">
        <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-white">{t.overview.tvl_section_title}</h2>
            {liveTvl && <LiveIndicator />}
          </div>
          <div className="flex items-center gap-2">
            <SourceSelector value={tvlSource} onChange={setTvlSource} />
            <TimeRangeSelector value={tvlRange} onChange={setTvlRange} />
          </div>
        </div>
        {tvlIsLoading ? (
          <div className="flex justify-center py-20"><Spinner /></div>
        ) : tvlRecent.length > 0 ? (
          <AreaChartComponent data={tvlRecent} xKey="date" yKey="tvl_usd" color="#00D4FF" liveDot={!!liveTvl} />
        ) : (
          <p className="py-12 text-center text-gray-500">{t.overview.no_tvl_data}</p>
        )}
        <DataSourceNote source={tvlSource} type="tvl" />
      </div>

      {/* DEX Volume Chart */}
      <div className="rounded-xl border border-white/5 bg-gray-900/40 backdrop-blur-sm p-5">
        <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-white">{t.overview.dex_volume_title}</h2>
            {liveVol && <LiveIndicator />}
          </div>
          <div className="flex items-center gap-2">
            <SourceSelector value={volSource} onChange={setVolSource} />
            <TimeRangeSelector value={dexRange} onChange={setDexRange} />
          </div>
        </div>
        {volIsLoading ? (
          <div className="flex justify-center py-20"><Spinner /></div>
        ) : dexRecent.length > 0 ? (
          <AreaChartComponent data={dexRecent} xKey="date" yKey="volume_usd" color="#8000E0" liveDot={!!liveVol} />
        ) : (
          <p className="py-12 text-center text-gray-500">{t.overview.no_dex_data}</p>
        )}
        <DataSourceNote source={volSource} type="volume" />
      </div>

      {/* Gas Estimates */}
      {gasEstimates && (
        <div className="rounded-xl border border-white/5 bg-gray-900/40 backdrop-blur-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <Fuel className="h-5 w-5 text-[#00D4FF]" />
            <h2 className="text-lg font-semibold text-white">{t.overview.gas_estimates_title}</h2>
            <LiveIndicator />
            <span className="text-xs text-gray-500">@ {formatGwei(liveGasPriceGwei!)} Gwei</span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {gasEstimates.map((e) => (
              <div key={e.key} className="rounded-lg bg-white/5 p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-xs text-gray-400">{t.overview[e.key]}</span>
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
                  </span>
                </div>
                <div className="text-sm font-medium text-white">
                  {e.costPls < 1
                    ? e.costPls.toFixed(4)
                    : e.costPls.toLocaleString('en-US', { maximumFractionDigits: 1 })} PLS
                </div>
                <div className="text-xs text-gray-500">
                  ${e.costUsd < 0.01 ? e.costUsd.toFixed(6) : e.costUsd.toFixed(4)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}
