import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { TrendingUp, ArrowUpRight, ArrowDownRight, Loader2, RefreshCw, Search, AlertTriangle, ChevronDown, Network } from 'lucide-react'
import TransactionTraceModal from '../TransactionTraceModal'
import { ShareButton } from '../ui/ShareButton'
import { shortenAddress, formatTimeAgo } from '../../lib/format'
import { useTranslation } from '../../i18n'

const SAFETY_API = import.meta.env.VITE_SAFETY_API_URL || 'https://safety.openpulsechain.com'

interface Swap {
  dex: string
  bought_symbol: string
  bought_address: string
  sold_symbol: string
  sold_address: string
  amount_usd: number
  wallet: string
  timestamp: number
  tx_id?: string
}

interface TopWallet {
  wallet: string
  total_volume_usd: number
  swap_count: number
  top_buys: [string, number][]
  top_sells: [string, number][]
  recent_swaps: Swap[]
}

interface Feed {
  period_hours: number
  total_swaps: number
  unique_wallets: number
  top_wallets: TopWallet[]
  generated_at: string
}

// Period presets for swaps tab (labels resolved at render time via t.smartmoney)
const SWAP_PERIODS = [
  { key: 'period_1h' as const, minutes: 60 },
  { key: 'period_6h' as const, minutes: 360 },
  { key: 'period_24h' as const, minutes: 1440 },
]

// Min USD presets (labels resolved at render time via t.smartmoney)
const MIN_USD_PRESETS = [
  { key: 'min_500' as const, value: 500 },
  { key: 'min_1k' as const, value: 1000 },
  { key: 'min_5k' as const, value: 5000 },
  { key: 'min_10k' as const, value: 10000 },
  { key: 'min_50k' as const, value: 50000 },
]

// Items per page for pagination
const PAGE_SIZE = 30

export function SmartMoneyPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [feed, setFeed] = useState<Feed | null>(null)
  const [recentSwaps, setRecentSwaps] = useState<Swap[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'wallets' | 'swaps'>('swaps')
  const [traceHash, setTraceHash] = useState<string | null>(null)

  // Filters
  const [swapPeriod, setSwapPeriod] = useState(360) // minutes
  const [minUsd, setMinUsd] = useState(1000)
  const [tokenFilter, setTokenFilter] = useState('')

  // Pagination
  const [swapPage, setSwapPage] = useState(1)
  const [walletPage, setWalletPage] = useState(1)

  // Last refresh timestamp
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  // Abort controller for cleanup
  const abortRef = useRef<AbortController | null>(null)

  // Visibility-aware polling
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadData = useCallback(async (showLoading = true) => {
    // Abort previous request
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    if (showLoading) setLoading(true)
    setError(null)

    try {
      const feedMinUsd = Math.max(minUsd, 5000) // feed always uses >= 5000
      const [feedRes, swapsRes] = await Promise.all([
        fetch(`${SAFETY_API}/api/v1/smart-money/feed?hours=24&min_usd=${feedMinUsd}`, { signal: controller.signal })
          .then(r => { if (!r.ok) throw new Error(`Feed: ${r.status}`); return r.json() })
          .catch(e => { if (e.name !== 'AbortError') throw e; return null }),
        fetch(`${SAFETY_API}/api/v1/smart-money/swaps?minutes=${swapPeriod}&min_usd=${minUsd}`, { signal: controller.signal })
          .then(r => { if (!r.ok) throw new Error(`Swaps: ${r.status}`); return r.json() })
          .catch(e => { if (e.name !== 'AbortError') throw e; return null }),
      ])
      if (controller.signal.aborted) return
      if (feedRes?.top_wallets) setFeed(feedRes)
      if (swapsRes?.data) setRecentSwaps(swapsRes.data)
      if (!feedRes?.top_wallets && !swapsRes?.data) {
        setError(t.smartmoney.connection_error)
      }
      setLastRefresh(new Date())
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setError(t.smartmoney.connection_error)
      }
    }
    if (!controller.signal.aborted) setLoading(false)
  }, [swapPeriod, minUsd, t])

  // Initial load + polling with visibility awareness
  useEffect(() => {
    loadData()

    const startPolling = () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      intervalRef.current = setInterval(() => loadData(false), 60_000)
    }

    const handleVisibility = () => {
      if (document.hidden) {
        if (intervalRef.current) clearInterval(intervalRef.current)
        intervalRef.current = null
      } else {
        loadData(false)
        startPolling()
      }
    }

    startPolling()
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      if (abortRef.current) abortRef.current.abort()
      if (intervalRef.current) clearInterval(intervalRef.current)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [loadData])

  // Reset pagination when filters change
  useEffect(() => { setSwapPage(1) }, [tokenFilter, swapPeriod, minUsd])
  useEffect(() => { setWalletPage(1) }, [tokenFilter])

  // Filter swaps by token symbol
  const filteredSwaps = tokenFilter.trim()
    ? recentSwaps.filter(s => {
        const q = tokenFilter.trim().toLowerCase()
        return s.bought_symbol.toLowerCase().includes(q) || s.sold_symbol.toLowerCase().includes(q)
      })
    : recentSwaps

  // Filter wallets by token in top buys/sells
  const filteredWallets = feed?.top_wallets
    ? tokenFilter.trim()
      ? feed.top_wallets.filter(w => {
          const q = tokenFilter.trim().toLowerCase()
          return w.top_buys.some(([s]) => s.toLowerCase().includes(q)) ||
                 w.top_sells.some(([s]) => s.toLowerCase().includes(q))
        })
      : feed.top_wallets
    : []

  // Paginated slices
  const paginatedSwaps = filteredSwaps.slice(0, swapPage * PAGE_SIZE)
  const paginatedWallets = filteredWallets.slice(0, walletPage * PAGE_SIZE)
  const hasMoreSwaps = paginatedSwaps.length < filteredSwaps.length
  const hasMoreWallets = paginatedWallets.length < filteredWallets.length

  const periodEntry = SWAP_PERIODS.find(p => p.minutes === swapPeriod)
  const periodLabel = periodEntry ? (t.smartmoney as any)[periodEntry.key] : `${swapPeriod / 60}h`

  if (!SAFETY_API) {
    return (
      <div className="text-center py-20">
        <TrendingUp className="h-12 w-12 text-gray-600 mx-auto mb-3" />
        <p className="text-gray-400">{t.smartmoney.api_not_configured}</p>
        <p className="text-gray-500 text-sm mt-1">{t.smartmoney.api_set_env}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Hero header */}
      <div className="rounded-2xl border border-white/5 bg-gradient-to-br from-emerald-500/5 via-purple-500/5 to-cyan-500/5 backdrop-blur-sm p-5 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-xl bg-emerald-400/10 border border-emerald-400/20">
                <TrendingUp className="h-6 w-6 text-emerald-400" />
              </div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-emerald-300 to-purple-400 bg-clip-text text-transparent">
                {t.smartmoney.title}
              </h1>
              <ShareButton title={t.smartmoney.title} text={t.smartmoney.description} />
            </div>
            <p className="text-gray-400 max-w-xl text-sm">
              {t.smartmoney.description}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {feed && (
              <>
                <div className="text-center px-4 py-2 rounded-xl bg-white/[0.03] border border-white/5">
                  <div className="text-lg font-bold text-white">{feed.total_swaps.toLocaleString('en-US')}</div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider">{t.smartmoney.total_swaps}</div>
                </div>
                <div className="text-center px-4 py-2 rounded-xl bg-emerald-500/5 border border-emerald-500/10">
                  <div className="text-lg font-bold text-emerald-400">{feed.unique_wallets.toLocaleString('en-US')}</div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider">{t.smartmoney.unique_wallets}</div>
                </div>
                <div className="text-center px-4 py-2 rounded-xl bg-cyan-500/5 border border-cyan-500/10">
                  <div className="text-lg font-bold text-[#00D4FF]">${feed.top_wallets.reduce((s, w) => s + w.total_volume_usd, 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider">{t.common.volume}</div>
                </div>
              </>
            )}
            <div className="flex flex-col items-center gap-1">
              <button
                onClick={() => loadData()}
                disabled={loading}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors disabled:opacity-50 text-sm"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> {t.common.refresh}
              </button>
              {lastRefresh && <span className="text-[10px] text-gray-600">{lastRefresh.toLocaleTimeString()}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs + Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        {/* Tab buttons */}
        <div className="flex gap-2">
          <button
            onClick={() => setTab('swaps')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === 'swaps' ? 'bg-[#8000E0]/20 text-[#00D4FF] border border-[#8000E0]/30' : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
            }`}
          >
            {t.smartmoney.tab_swaps} ({periodLabel})
          </button>
          <button
            onClick={() => setTab('wallets')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === 'wallets' ? 'bg-[#8000E0]/20 text-[#00D4FF] border border-[#8000E0]/30' : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
            }`}
          >
            {t.smartmoney.tab_wallets}
          </button>
        </div>

        {/* Filters row */}
        <div className="flex items-center gap-2 sm:ml-auto flex-wrap">
          {/* Token search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500" />
            <input
              type="text"
              placeholder={t.smartmoney.filter_token_placeholder}
              value={tokenFilter}
              onChange={e => setTokenFilter(e.target.value)}
              className="pl-8 pr-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#00D4FF]/50 w-36"
            />
          </div>

          {/* Period selector (swaps tab only) */}
          {tab === 'swaps' && (
            <div className="flex rounded-lg border border-white/10 overflow-hidden">
              {SWAP_PERIODS.map(p => (
                <button
                  key={p.minutes}
                  onClick={() => setSwapPeriod(p.minutes)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    swapPeriod === p.minutes
                      ? 'bg-[#00D4FF]/20 text-[#00D4FF]'
                      : 'text-gray-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {(t.smartmoney as any)[p.key]}
                </button>
              ))}
            </div>
          )}

          {/* Min USD selector */}
          <div className="relative group">
            <button className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-gray-400 hover:text-white transition-colors">
              {(() => { const found = MIN_USD_PRESETS.find(p => p.value === minUsd); return found ? (t.smartmoney as any)[found.key] : `$${(minUsd / 1000).toFixed(0)}K+` })()}
              <ChevronDown className="h-3 w-3" />
            </button>
            <div className="absolute right-0 top-full mt-1 bg-gray-900 border border-white/10 rounded-lg shadow-xl z-20 hidden group-hover:block min-w-[100px]">
              {MIN_USD_PRESETS.map(p => (
                <button
                  key={p.value}
                  onClick={() => setMinUsd(p.value)}
                  className={`block w-full text-left px-3 py-2 text-xs transition-colors ${
                    minUsd === p.value ? 'text-[#00D4FF] bg-[#00D4FF]/10' : 'text-gray-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {(t.smartmoney as any)[p.key]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Error state */}
      {error && !loading && (
        <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-4 flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-orange-400 shrink-0" />
          <div>
            <p className="text-sm text-orange-400">{error}</p>
            <button onClick={() => loadData()} className="text-xs text-orange-400/70 hover:text-orange-300 mt-1 underline">
              {t.common.refresh}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-[#00D4FF]" />
        </div>
      ) : tab === 'swaps' ? (
        /* ── Recent Swaps Table ── */
        filteredSwaps.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            {tokenFilter.trim()
              ? t.smartmoney.no_swaps_filter
              : t.smartmoney.no_swaps_period}
          </div>
        ) : (
          <>
            <div className="rounded-xl border border-white/5 overflow-hidden">
              {/* Mobile: card layout */}
              <div className="sm:hidden divide-y divide-white/5">
                {paginatedSwaps.map((swap, i) => (
                  <div key={swap.tx_id || i} className="p-3 hover:bg-white/5 transition-colors">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-red-400 flex items-center gap-0.5 text-sm">
                          <ArrowDownRight className="h-3.5 w-3.5" />
                          {swap.sold_symbol}
                        </span>
                        <span className="text-gray-600">→</span>
                        <span
                          className="text-emerald-400 flex items-center gap-0.5 text-sm cursor-pointer hover:underline"
                          onClick={() => navigate(`/token/${swap.bought_address}`)}
                        >
                          <ArrowUpRight className="h-3.5 w-3.5" />
                          {swap.bought_symbol}
                        </span>
                      </div>
                      <span className="font-medium text-white text-sm">
                        ${swap.amount_usd.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span
                        className="text-gray-500 font-mono cursor-pointer hover:text-[#00D4FF]"
                        onClick={() => navigate(`/wallet/${swap.wallet}`)}
                      >
                        {shortenAddress(swap.wallet)}
                      </span>
                      <div className="flex items-center gap-2">
                        {swap.tx_id && (
                          <button
                            onClick={() => setTraceHash(swap.tx_id!.split('-')[0])}
                            className="text-purple-400/60 hover:text-purple-300 transition-colors"
                            title="View transaction trace"
                          >
                            <Network className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <span className="text-gray-500">{formatTimeAgo(swap.timestamp)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop: table layout */}
              <table className="w-full text-sm hidden sm:table" style={{ tableLayout: 'fixed' }}>
                <thead>
                  <tr className="border-b border-white/5 bg-gray-900/50">
                    <th style={{ width: '15%' }} className="text-left px-3 py-3 text-gray-400 font-medium">{t.smartmoney.table_swap}</th>
                    <th style={{ width: '10%' }} className="text-right px-3 py-3 text-gray-400 font-medium">{t.smartmoney.table_amount}</th>
                    <th style={{ width: '20%' }} className="text-left px-3 py-3 text-gray-400 font-medium">{t.smartmoney.table_wallet}</th>
                    <th style={{ width: '15%' }} className="text-left px-3 py-3 text-gray-400 font-medium hidden md:table-cell">{t.smartmoney.table_dex}</th>
                    <th style={{ width: '15%' }} className="text-center px-3 py-3 text-gray-400 font-medium hidden lg:table-cell">Transaction</th>
                    <th style={{ width: '10%' }} className="text-right px-3 py-3 text-gray-400 font-medium">{t.smartmoney.table_time}</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedSwaps.map((swap, i) => (
                    <tr
                      key={swap.tx_id || i}
                      className="border-b border-white/5 hover:bg-white/5 transition-colors"
                    >
                      <td className="px-3 py-3 truncate">
                        <div className="flex items-center gap-1 overflow-hidden">
                          <span className="text-red-400 flex items-center gap-0.5 shrink-0">
                            <ArrowDownRight className="h-3.5 w-3.5 shrink-0" />
                            <span
                              className="cursor-pointer hover:underline truncate"
                              onClick={() => navigate(`/token/${swap.sold_address}`)}
                            >
                              {swap.sold_symbol}
                            </span>
                          </span>
                          <span className="text-gray-600 shrink-0">→</span>
                          <span className="text-emerald-400 flex items-center gap-0.5 min-w-0">
                            <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
                            <span
                              className="cursor-pointer hover:underline truncate"
                              onClick={() => navigate(`/token/${swap.bought_address}`)}
                            >
                              {swap.bought_symbol}
                            </span>
                          </span>
                        </div>
                      </td>
                      <td className="text-right px-3 py-3 font-medium text-white whitespace-nowrap">
                        ${swap.amount_usd.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className="text-gray-500 font-mono cursor-pointer hover:text-[#00D4FF] transition-colors"
                          onClick={() => navigate(`/wallet/${swap.wallet}`)}
                        >
                          {shortenAddress(swap.wallet)}
                        </span>
                      </td>
                      <td className="px-3 py-3 hidden md:table-cell text-gray-500 truncate">
                        {swap.dex}
                      </td>
                      <td className="text-center px-3 py-3 hidden lg:table-cell">
                        {swap.tx_id && (
                          <button
                            onClick={() => setTraceHash(swap.tx_id!.split('-')[0])}
                            className="text-purple-400/50 hover:text-purple-300 transition-colors"
                            title="View transaction trace"
                          >
                            <Network className="w-4 h-4 mx-auto" />
                          </button>
                        )}
                      </td>
                      <td className="text-right px-3 py-3 text-gray-500 whitespace-nowrap">
                        {formatTimeAgo(swap.timestamp)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Load more */}
            {hasMoreSwaps && (
              <div className="text-center pt-2">
                <button
                  onClick={() => setSwapPage(p => p + 1)}
                  className="px-6 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                >
                  {t.smartmoney.load_more} ({filteredSwaps.length - paginatedSwaps.length} {t.smartmoney.remaining})
                </button>
              </div>
            )}

            <p className="text-xs text-gray-600 text-center">
              {t.smartmoney.showing} {paginatedSwaps.length} {t.smartmoney.of} {filteredSwaps.length} {t.smartmoney.swaps_label}
            </p>
          </>
        )
      ) : (
        /* ── Top Wallets Table ── */
        filteredWallets.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            {tokenFilter.trim()
              ? t.smartmoney.no_wallets_filter
              : t.smartmoney.no_smart_money_data}
          </div>
        ) : (
          <>
            <div className="rounded-xl border border-white/5 overflow-hidden">
              {/* Mobile: card layout */}
              <div className="sm:hidden divide-y divide-white/5">
                {paginatedWallets.map((wallet, i) => (
                  <div
                    key={wallet.wallet}
                    className="p-3 hover:bg-white/5 cursor-pointer transition-colors"
                    onClick={() => navigate(`/wallet/${wallet.wallet}`)}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500 font-bold text-xs w-5">{i + 1}</span>
                        <span className="font-mono text-[#00D4FF] text-sm">{shortenAddress(wallet.wallet)}</span>
                      </div>
                      <span className="font-medium text-white text-sm">
                        ${wallet.total_volume_usd.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 ml-7">
                      <span className="text-xs text-gray-500">{wallet.swap_count} {t.smartmoney.swap_count}</span>
                      <div className="flex gap-1">
                        {wallet.top_buys.slice(0, 2).map(([symbol]) => (
                          <span key={symbol} className="text-emerald-400 text-[10px] bg-emerald-400/10 px-1.5 py-0.5 rounded">{symbol}</span>
                        ))}
                        {wallet.top_sells.slice(0, 2).map(([symbol]) => (
                          <span key={symbol} className="text-red-400 text-[10px] bg-red-400/10 px-1.5 py-0.5 rounded">{symbol}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop: table layout */}
              <table className="w-full text-sm hidden sm:table">
                <thead>
                  <tr className="border-b border-white/5 bg-gray-900/50">
                    <th className="text-left px-4 py-3 text-gray-400 font-medium w-8">{t.smartmoney.table_rank}</th>
                    <th className="text-left px-4 py-3 text-gray-400 font-medium">{t.smartmoney.table_wallet}</th>
                    <th className="text-right px-4 py-3 text-gray-400 font-medium">{t.common.volume}</th>
                    <th className="text-right px-4 py-3 text-gray-400 font-medium">{t.smartmoney.swap_count}</th>
                    <th className="text-left px-4 py-3 text-gray-400 font-medium hidden md:table-cell">{t.smartmoney.top_buys}</th>
                    <th className="text-left px-4 py-3 text-gray-400 font-medium hidden lg:table-cell">{t.smartmoney.top_sells}</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedWallets.map((wallet, i) => (
                    <tr
                      key={wallet.wallet}
                      className="border-b border-white/5 hover:bg-white/5 cursor-pointer transition-colors"
                      onClick={() => navigate(`/wallet/${wallet.wallet}`)}
                    >
                      <td className="px-4 py-3 text-gray-500 font-bold">{i + 1}</td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-[#00D4FF] hover:underline">{shortenAddress(wallet.wallet)}</span>
                      </td>
                      <td className="text-right px-4 py-3 font-medium text-white">
                        ${wallet.total_volume_usd.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                      </td>
                      <td className="text-right px-4 py-3 text-gray-400">{wallet.swap_count}</td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <div className="flex gap-1.5 flex-wrap">
                          {wallet.top_buys.slice(0, 3).map(([symbol]) => (
                            <span key={symbol} className="text-emerald-400 text-xs bg-emerald-400/10 px-1.5 py-0.5 rounded">{symbol}</span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <div className="flex gap-1.5 flex-wrap">
                          {wallet.top_sells.slice(0, 3).map(([symbol]) => (
                            <span key={symbol} className="text-red-400 text-xs bg-red-400/10 px-1.5 py-0.5 rounded">{symbol}</span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Load more */}
            {hasMoreWallets && (
              <div className="text-center pt-2">
                <button
                  onClick={() => setWalletPage(p => p + 1)}
                  className="px-6 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                >
                  {t.smartmoney.load_more} ({filteredWallets.length - paginatedWallets.length} {t.smartmoney.remaining})
                </button>
              </div>
            )}
          </>
        )
      )}


      {traceHash && (
        <TransactionTraceModal txHash={traceHash} onClose={() => setTraceHash(null)} />
      )}
    </div>
  )
}
