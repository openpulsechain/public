import { useState, useEffect } from 'react'
import { Search, Wallet, ArrowLeftRight, AlertTriangle, Loader2, Shield, TrendingUp, TrendingDown } from 'lucide-react'
import { useStore } from '../../lib/store'
import { getBridgeStats, getRecentAlerts, getTokenPrice, getWalletBalances, getTokenHistory, type BridgeSnapshot, type ScamAlert, type TokenPriceInfo } from '../../lib/api'
import { formatUsd, formatPrice, shortenAddress, timeAgo } from '../../lib/format'
import { checkChromeSecurity, type ChromeSecurityStatus } from '../../lib/chrome-security'

// Richard Heart's 5 tokens — live prices on home
const RICHARD_TOKENS = [
  { symbol: 'PLS', address: '0xa1077a294dde1b09bb078844df40758a5d0f9a27', color: '#00D4FF', logo: 'https://tokens.app.pulsex.com/images/tokens/0xA1077a294dDE1B09bB078844df40758a5D0f9a27.png' },
  { symbol: 'HEX', address: '0x2b591e99afe9f32eaa6214f7b7629768c40eeb39', color: '#FF6B35', logo: 'https://tokens.app.pulsex.com/images/tokens/0x2b591e99afE9f32eAA6214f7B7629768c40Eeb39.png' },
  { symbol: 'PLSX', address: '0x95b303987a60c71504d99aa1b13b4da07b0790ab', color: '#8000E0', logo: 'https://tokens.app.pulsex.com/images/tokens/0x95B303987A60C71504D99Aa1b13B4DA07b0790ab.png' },
  { symbol: 'INC', address: '0x2fa878ab3f87cc1c9737fc071108f904c0b0c95d', color: '#10b981', logo: 'https://tokens.app.pulsex.com/images/tokens/0x2fa878Ab3F87CC1C9737Fc071108F904c0B0C95d.png' },
  { symbol: 'PRVX', address: '0xf6f8db0aba00007681f8faf16a0fda1c9b030b11', color: '#f59e0b', logo: '/icons/prvx.png' },
]

export function Dashboard() {
  const wallets = useStore((s) => s.wallets)
  const setActiveSection = useStore((s) => s.setActiveSection)
  const openTokenDetail = useStore((s) => s.openTokenDetail)

  // Quick search
  const [searchInput, setSearchInput] = useState('')
  const [searchLoading, setSearchLoading] = useState(false)

  // Wallet summary
  const [walletTotal, setWalletTotal] = useState<number | null>(null)
  const [walletTokenCount, setWalletTokenCount] = useState(0)
  const [walletLoading, setWalletLoading] = useState(false)

  // Bridge
  const [bridge, setBridge] = useState<BridgeSnapshot | null>(null)
  const [bridgeLoading, setBridgeLoading] = useState(true)

  // Alerts
  const [alerts, setAlerts] = useState<ScamAlert[]>([])
  const [alertsLoading, setAlertsLoading] = useState(true)

  // Live prices
  const [prices, setPrices] = useState<Map<string, TokenPriceInfo>>(new Map())
  const [pricesLoading, setPricesLoading] = useState(true)

  // Wallet 30d evolution
  const [wallet30d, setWallet30d] = useState<{ pct: number; amount: number; sparkline: number[] } | null>(null)

  // Chrome security
  const [chromeSecurity, setChromeSecurity] = useState<ChromeSecurityStatus | null>(null)

  useEffect(() => {
    checkChromeSecurity().then(setChromeSecurity).catch(() => {})
  }, [])

  useEffect(() => {
    // Load bridge stats
    getBridgeStats()
      .then((s) => setBridge(s))
      .catch(() => {})
      .finally(() => setBridgeLoading(false))

    // Load recent alerts
    getRecentAlerts(3)
      .then((a) => setAlerts(a.slice(0, 3)))
      .catch(() => {})
      .finally(() => setAlertsLoading(false))

    // Load live prices for Richard tokens
    Promise.allSettled(
      RICHARD_TOKENS.map(async (t) => {
        const info = await getTokenPrice(t.address)
        return { symbol: t.symbol, info }
      })
    ).then((results) => {
      const map = new Map<string, TokenPriceInfo>()
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.info) {
          map.set(r.value.symbol, r.value.info)
        }
      }
      setPrices(map)
      setPricesLoading(false)
    })

    // Load wallet summary if configured
    // (handled separately below)
  }, [])

  useEffect(() => {
    if (wallets.length > 0) {
      setWalletLoading(true)
      getWalletBalances(wallets[0].address)
        .then((balances) => {
          const total = balances.reduce((sum, b) => sum + (b.value_usd || 0), 0)
          setWalletTotal(total)
          setWalletTokenCount(balances.filter((b) => b.balance > 0).length)
          // Compute 30d sparkline
          const pricedTokens = balances.filter(b => b.value_usd != null && b.value_usd > 0).slice(0, 8)
          if (pricedTokens.length > 0) {
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
              if (sparkline.length >= 2 && total > 0) {
                const oldest = sparkline[0]
                const amount = total - oldest
                const pct = oldest > 0 ? (amount / oldest) * 100 : 0
                setWallet30d({ pct, amount, sparkline })
              }
            })
          }
        })
        .catch(() => {
          setWalletTotal(null)
          setWalletTokenCount(0)
        })
        .finally(() => setWalletLoading(false))
    }
  }, [wallets])

  const handleSearch = () => {
    const addr = searchInput.trim().toLowerCase()
    if (!addr.match(/^0x[a-f0-9]{40}$/)) return
    setSearchLoading(true)
    // Navigate to explorer and let it handle the search
    setActiveSection('explorer')
  }

  // Bridge status helpers
  const bridgeStatusDot = () => {
    if (!bridge) return 'bg-gray-500'
    const outVol = bridge.withdrawal_volume_24h
    const inVol = bridge.deposit_volume_24h
    if (outVol > inVol * 3 && outVol > 500000) return 'bg-red-400'
    if (outVol > 2000000 || inVol > 2000000) return 'bg-amber-400'
    return 'bg-emerald-400'
  }

  const bridgeStatusLabel = () => {
    if (!bridge) return 'Loading...'
    const outVol = bridge.withdrawal_volume_24h
    const inVol = bridge.deposit_volume_24h
    if (outVol > inVol * 3 && outVol > 500000) return 'Heavy Outflow'
    if (outVol > 2000000 || inVol > 2000000) return 'High Volume'
    return 'Normal'
  }

  return (
    <div className="space-y-3">
      {/* Chrome Security Alert */}
      {chromeSecurity?.isVulnerable && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 space-y-1">
          <div className="flex items-center gap-2 text-red-400 text-xs font-bold">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Chrome Update Required
          </div>
          <p className="text-[10px] text-red-300/80 leading-tight">
            Your Chrome {chromeSecurity.currentVersion} has known vulnerabilities.
            Update to Chrome {chromeSecurity.minSafeVersion}+ to stay safe.
            {chromeSecurity.cves && ` (${chromeSecurity.cves.join(', ')})`}
          </p>
          <a
            href="chrome://settings/help"
            target="_blank"
            className="inline-block text-[10px] font-medium text-red-400 hover:text-red-300 underline"
          >
            Update Chrome now
          </a>
        </div>
      )}

      {/* Quick Search */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Search token or wallet (0x...)"
            className="w-full bg-gray-800/60 border border-white/10 rounded-lg pl-8 pr-3 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-pulse-cyan/50"
          />
        </div>
        <button
          onClick={handleSearch}
          disabled={searchLoading}
          className="px-3 py-2 rounded-lg bg-gradient-to-r from-pulse-cyan to-pulse-purple text-white text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {searchLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Live Prices — Richard Heart tokens */}
      <div className="bg-gray-800/30 rounded-lg p-2.5 border border-white/5">
        {pricesLoading ? (
          <div className="flex justify-center py-3">
            <Loader2 className="h-4 w-4 text-gray-500 animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-5 gap-1">
            {RICHARD_TOKENS.map((t) => {
              const info = prices.get(t.symbol)
              const pct = info?.price_change_24h_pct ?? 0
              const isUp = pct >= 0
              return (
                <div key={t.symbol} className="flex flex-col items-center gap-1 py-1.5 cursor-pointer hover:bg-white/5 rounded-lg transition-colors" onClick={() => openTokenDetail(t.address)}>
                  {t.logo ? (
                    <img src={t.logo} alt={t.symbol} className="h-7 w-7 rounded-full" />
                  ) : (
                    <div className="h-7 w-7 rounded-full flex items-center justify-center text-[9px] font-bold text-white" style={{ backgroundColor: t.color + '40' }}>
                      {t.symbol.slice(0, 2)}
                    </div>
                  )}
                  <span className="text-[11px] font-medium" style={{ color: t.color }}>{t.symbol}</span>
                  <span className="text-xs text-white font-mono font-semibold">
                    {info?.price_usd != null ? formatPrice(info.price_usd) : '—'}
                  </span>
                  <span className={`text-[11px] flex items-center gap-0.5 ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                    {isUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    {Math.abs(pct).toFixed(1)}%
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Wallet Summary with 30d sparkline */}
      {(() => {
        const has30d = wallet30d && wallet30d.sparkline.length >= 2
        const isUp30d = has30d ? wallet30d.pct >= 0 : true
        const neonColor = has30d ? (isUp30d ? '#10b981' : '#ef4444') : '#00D4FF'
        // Build sparkline
        let sLine = '', sArea = ''
        const SW = 340, SH = 36
        if (has30d) {
          const spark = wallet30d.sparkline
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
            className="relative rounded-lg overflow-hidden cursor-pointer transition-all"
            style={{ border: `1px solid ${neonColor}30` }}
            onClick={() => setActiveSection('portfolio')}
          >
            {/* Background gradient tint */}
            <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${neonColor}12 0%, ${neonColor}05 50%, transparent 100%)` }} />
            <div className="relative p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4" style={{ color: neonColor }} />
                <span className="text-xs font-semibold text-white">Wallet</span>
              </div>
              {wallets.length > 0 ? (
                walletLoading ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 text-gray-500 animate-spin" />
                    <span className="text-xs text-gray-500">Loading...</span>
                  </div>
                ) : (
                  <>
                    <div>
                      <div className="text-lg font-bold text-white">
                        {walletTotal != null ? formatUsd(walletTotal) : '$0.00'}
                      </div>
                      <div className="text-[11px] text-gray-500">
                        {walletTokenCount} tokens · {shortenAddress(wallets[0].address)}
                      </div>
                    </div>
                    {has30d && (
                      <div className="flex items-center gap-3">
                        <svg viewBox={`0 0 ${SW} ${SH}`} className="flex-1 h-9" preserveAspectRatio="none">
                          <defs>
                            <linearGradient id="dashSparkFill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={neonColor} stopOpacity="0.25" />
                              <stop offset="100%" stopColor={neonColor} stopOpacity="0.02" />
                            </linearGradient>
                            <filter id="dashNeonGlow">
                              <feGaussianBlur stdDeviation="2.5" result="blur" />
                              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                            </filter>
                          </defs>
                          <path d={sArea} fill="url(#dashSparkFill)" />
                          <path d={sLine} fill="none" stroke={neonColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" filter="url(#dashNeonGlow)" />
                        </svg>
                        <div className="text-right shrink-0">
                          <div className={`text-sm font-bold ${isUp30d ? 'text-emerald-400' : 'text-red-400'}`}>
                            {isUp30d ? '+' : ''}{wallet30d.pct.toFixed(1)}%
                          </div>
                          <div className={`text-[11px] font-mono ${isUp30d ? 'text-emerald-400/70' : 'text-red-400/70'}`}>
                            {wallet30d.amount >= 0 ? '+' : ''}{formatUsd(wallet30d.amount)}
                          </div>
                          <div className="text-[9px] text-gray-500">30 jours</div>
                        </div>
                      </div>
                    )}
                  </>
                )
              ) : (
                <div className="py-1 text-xs text-pulse-cyan font-medium">
                  + Add your wallet
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* Bridge Status (mini) */}
      <div
        className="bg-gray-800/30 rounded-lg px-3 py-2.5 border border-white/5 flex items-center justify-between cursor-pointer hover:bg-gray-800/40 transition-colors"
        onClick={() => setActiveSection('bridge')}
      >
        <div className="flex items-center gap-2">
          <ArrowLeftRight className="h-4 w-4 text-pulse-cyan" />
          <span className="text-xs font-semibold text-white">Bridge:</span>
          {bridgeLoading ? (
            <Loader2 className="h-3 w-3 text-gray-500 animate-spin" />
          ) : (
            <>
              <span className={`h-2 w-2 rounded-full ${bridgeStatusDot()}`} />
              <span className="text-xs text-gray-300">{bridgeStatusLabel()}</span>
            </>
          )}
        </div>
        {bridge && !bridgeLoading && (
          <div className="text-[11px] text-gray-500">
            In {formatUsd(bridge.deposit_volume_24h)} / Out {formatUsd(bridge.withdrawal_volume_24h)}
          </div>
        )}
      </div>

      {/* Recent Alerts */}
      <div className="bg-gray-800/30 rounded-lg p-3 border border-white/5">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-400" />
            <span className="text-xs font-semibold text-white">Recent Alerts</span>
          </div>
          <button
            onClick={() => setActiveSection('alerts')}
            className="text-[11px] text-pulse-cyan hover:underline"
          >
            View all
          </button>
        </div>
        {alertsLoading ? (
          <div className="flex justify-center py-2">
            <Loader2 className="h-3.5 w-3.5 text-gray-500 animate-spin" />
          </div>
        ) : alerts.length === 0 ? (
          <div className="flex items-center gap-2 py-1">
            <Shield className="h-3.5 w-3.5 text-emerald-500/50" />
            <span className="text-xs text-gray-500">No recent alerts -- all clear</span>
          </div>
        ) : (
          <div className="space-y-1.5">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className="flex items-center justify-between py-1.5 px-2 rounded-md bg-gray-900/40"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`text-xs font-medium ${
                    alert.severity === 'critical' ? 'text-red-400' :
                    alert.severity === 'high' ? 'text-orange-400' : 'text-amber-400'
                  }`}>
                    {alert.alert_type.replace(/_/g, ' ')}
                  </span>
                  <span className="text-[11px] text-gray-500 truncate">
                    {shortenAddress(alert.token_address)}
                  </span>
                </div>
                <span className="text-[11px] text-gray-600 shrink-0 ml-2">{timeAgo(alert.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
