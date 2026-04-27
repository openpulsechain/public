import { useState, useEffect, useMemo } from 'react'
import { RefreshCw, Loader2, ExternalLink, AlertTriangle, Globe, Clock } from 'lucide-react'
import { getBridgeStats, getHyperlaneStats, type BridgeSnapshot, type HyperlaneStats } from '../../lib/api'
import { formatUsd } from '../../lib/format'

type BridgeTab = 'all' | 'omnibridge' | 'hyperlane'

// Animated block that moves across the bridge lane
function BridgeBlock({ direction, index, speed }: { direction: 'in' | 'out'; index: number; speed: number }) {
  const isIn = direction === 'in'
  const delay = index * 1.2
  const duration = Math.max(2, 6 / speed)
  return (
    <div
      className={`absolute top-0 w-[7px] h-[7px] rounded-sm ${isIn ? 'bg-emerald-400/80' : 'bg-red-400/80'}`}
      style={{ animation: `bridge-${isIn ? 'in' : 'out'} ${duration}s linear infinite`, animationDelay: `${delay}s` }}
    />
  )
}

function EthLogo() {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="w-12 h-12 rounded-full bg-[#627eea]/15 border border-[#627eea]/30 flex items-center justify-center">
        <svg width="24" height="24" viewBox="0 0 256 417" fill="none">
          <path d="M127.961 0L125.166 9.5V285.168L127.961 287.958L255.923 212.32L127.961 0Z" fill="#627eea" fillOpacity="0.8"/>
          <path d="M127.962 0L0 212.32L127.962 287.958V154.159V0Z" fill="#627eea"/>
          <path d="M127.961 312.187L126.386 314.107V412.306L127.961 416.905L255.999 236.587L127.961 312.187Z" fill="#627eea" fillOpacity="0.8"/>
          <path d="M127.962 416.905V312.187L0 236.587L127.962 416.905Z" fill="#627eea"/>
        </svg>
      </div>
      <span className="text-[10px] text-gray-400 font-medium">Ethereum</span>
    </div>
  )
}

function PlsLogo() {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="w-12 h-12 rounded-full bg-[#00D4FF]/10 border border-[#00D4FF]/30 flex items-center justify-center overflow-hidden">
        <img src="https://tokens.app.pulsex.com/images/tokens/0xA1077a294dDE1B09bB078844df40758a5D0f9a27.png" alt="PulseChain" className="w-9 h-9 rounded-full" />
      </div>
      <span className="text-[10px] text-gray-400 font-medium">PulseChain</span>
    </div>
  )
}

export function Bridge() {
  const [stats, setStats] = useState<BridgeSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hyperlane, setHyperlane] = useState<HyperlaneStats | null>(null)
  const [hlLoading, setHlLoading] = useState(true)
  const [tab, setTab] = useState<BridgeTab>('all')
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)

  const loadAll = async () => {
    setLoading(true)
    setError(null)
    try {
      const [omni, hl] = await Promise.allSettled([getBridgeStats(), getHyperlaneStats()])
      if (omni.status === 'fulfilled') setStats(omni.value)
      if (hl.status === 'fulfilled') setHyperlane(hl.value)
      setLastUpdate(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
      setHlLoading(false)
    }
  }

  useEffect(() => { loadAll() }, [])

  // Compute "All Bridges" combined 24h
  const combined24h = useMemo(() => {
    const omniIn = stats?.deposit_volume_24h ?? 0
    const omniOut = stats?.withdrawal_volume_24h ?? 0
    const omniInCount = stats?.deposit_count_24h ?? 0
    const omniOutCount = stats?.withdrawal_count_24h ?? 0
    const hlToday = hyperlane?.daily?.[0]
    const hlIn = hlToday?.inbound_volume_usd ?? 0
    const hlOut = hlToday?.outbound_volume_usd ?? 0
    const hlInCount = hlToday?.inbound_count ?? 0
    const hlOutCount = hlToday?.outbound_count ?? 0
    return {
      inflow: omniIn + hlIn,
      outflow: omniOut + hlOut,
      inflowCount: omniInCount + hlInCount,
      outflowCount: omniOutCount + hlOutCount,
      net: (omniIn + hlIn) - (omniOut + hlOut),
      totalTxs: omniInCount + omniOutCount + hlInCount + hlOutCount,
    }
  }, [stats, hyperlane])

  const { inSpeed, outSpeed, inBlocks, outBlocks } = useMemo(() => {
    const inVol = combined24h.inflow
    const outVol = combined24h.outflow
    const total = inVol + outVol
    if (total === 0) return { inSpeed: 1, outSpeed: 1, inBlocks: 3, outBlocks: 3 }
    const ratio = inVol / (outVol || 1)
    return {
      inSpeed: Math.min(3, Math.max(0.5, ratio)),
      outSpeed: Math.min(3, Math.max(0.5, 1 / ratio)),
      inBlocks: Math.min(6, Math.max(2, Math.round(3 * ratio))),
      outBlocks: Math.min(6, Math.max(2, Math.round(3 / ratio))),
    }
  }, [combined24h])

  const healthLabel = useMemo(() => {
    const { outflow, inflow } = combined24h
    if (outflow > inflow * 3 && outflow > 500000) return { label: 'Heavy Outflow', color: 'text-amber-400' }
    if (outflow > 2000000 || inflow > 2000000) return { label: 'High Volume', color: 'text-yellow-400' }
    return { label: 'Normal', color: 'text-emerald-400' }
  }, [combined24h])

  const TABS: { key: BridgeTab; label: string }[] = [
    { key: 'all', label: 'All Bridges' },
    { key: 'omnibridge', label: 'OmniBridge' },
    { key: 'hyperlane', label: 'Hyperlane' },
  ]

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Bridge Monitor</h2>
        <button onClick={loadAll} disabled={loading} className="text-gray-500 hover:text-white transition-colors">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Animation */}
      <div className="bg-gray-800/40 rounded-xl p-2.5 border border-white/5">
        <div className="flex items-center justify-between">
          <EthLogo />
          <div className="flex-1 mx-3">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-[11px] font-medium text-emerald-400 w-6 shrink-0">IN</span>
              <div className="flex-1 relative h-[8px] overflow-hidden">
                {Array.from({ length: inBlocks }).map((_, i) => <BridgeBlock key={`in-${i}`} direction="in" index={i} speed={inSpeed} />)}
              </div>
            </div>
            <div className="h-px bg-white/5 ml-8" />
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-[11px] font-medium text-red-400 w-6 shrink-0">OUT</span>
              <div className="flex-1 relative h-[8px] overflow-hidden">
                {Array.from({ length: outBlocks }).map((_, i) => <BridgeBlock key={`out-${i}`} direction="out" index={i} speed={outSpeed} />)}
              </div>
            </div>
          </div>
          <PlsLogo />
        </div>
      </div>

      {/* Health + last update */}
      <div className="flex items-center justify-between">
        <span className={`text-xs font-medium ${healthLabel.color}`}>Bridge Status: {healthLabel.label}</span>
        {lastUpdate && (
          <span className="text-[10px] text-gray-600 flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {lastUpdate.toLocaleTimeString()}
          </span>
        )}
      </div>

      {error && <div className="text-xs text-red-400 bg-red-500/10 rounded-lg p-2">{error}</div>}

      {/* Tabs */}
      <div className="flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tab === t.key
                ? 'bg-pulse-cyan/15 text-pulse-cyan border border-pulse-cyan/30'
                : 'text-gray-500 hover:text-gray-300 border border-transparent'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 text-gray-500 animate-spin" /></div>
      ) : (
        <>
          {/* ── ALL BRIDGES ── */}
          {tab === 'all' && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-1.5">
                <div className="bg-gray-800/30 rounded-md p-2.5">
                  <div className="text-xs text-gray-400">Inflow (24h)</div>
                  <div className="text-sm text-emerald-400 font-semibold">{formatUsd(combined24h.inflow)}</div>
                  <div className="text-xs text-gray-500">{combined24h.inflowCount} txs</div>
                </div>
                <div className="bg-gray-800/30 rounded-md p-2.5">
                  <div className="text-xs text-gray-400">Outflow (24h)</div>
                  <div className="text-sm text-red-400 font-semibold">{formatUsd(combined24h.outflow)}</div>
                  <div className="text-xs text-gray-500">{combined24h.outflowCount} txs</div>
                </div>
                <div className="bg-gray-800/30 rounded-md p-2.5">
                  <div className="text-xs text-gray-400">Net Flow (24h)</div>
                  <div className={`text-sm font-semibold ${combined24h.net >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {combined24h.net >= 0 ? '+' : ''}{formatUsd(combined24h.net)}
                  </div>
                </div>
                <div className="bg-gray-800/30 rounded-md p-2.5">
                  <div className="text-xs text-gray-400">Total Txs (24h)</div>
                  <div className="text-sm text-white font-semibold">{combined24h.totalTxs}</div>
                </div>
              </div>
              {stats && (
                <div className="bg-gray-800/30 rounded-lg p-2.5">
                  <div className="text-xs text-gray-400 mb-1.5">7-Day Summary</div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <div className="text-xs text-emerald-400 font-medium">{formatUsd(stats.deposit_volume_7d)}</div>
                      <div className="text-xs text-gray-500">In</div>
                    </div>
                    <div>
                      <div className="text-xs text-red-400 font-medium">{formatUsd(stats.withdrawal_volume_7d)}</div>
                      <div className="text-xs text-gray-500">Out</div>
                    </div>
                    <div>
                      <div className={`text-xs font-medium ${stats.net_flow_7d >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {stats.net_flow_7d >= 0 ? '+' : ''}{formatUsd(stats.net_flow_7d)}
                      </div>
                      <div className="text-xs text-gray-500">Net</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── OMNIBRIDGE ── */}
          {tab === 'omnibridge' && stats && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-1.5">
                <div className="bg-gray-800/30 rounded-md p-2.5">
                  <div className="text-xs text-gray-400">Inflow (24h)</div>
                  <div className="text-sm text-emerald-400 font-semibold">{formatUsd(stats.deposit_volume_24h)}</div>
                  <div className="text-xs text-gray-500">{stats.deposit_count_24h} txs</div>
                </div>
                <div className="bg-gray-800/30 rounded-md p-2.5">
                  <div className="text-xs text-gray-400">Outflow (24h)</div>
                  <div className="text-sm text-red-400 font-semibold">{formatUsd(stats.withdrawal_volume_24h)}</div>
                  <div className="text-xs text-gray-500">{stats.withdrawal_count_24h} txs</div>
                </div>
                <div className="bg-gray-800/30 rounded-md p-2.5">
                  <div className="text-xs text-gray-400">Net Flow (24h)</div>
                  <div className={`text-sm font-semibold ${stats.net_flow_24h >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {stats.net_flow_24h >= 0 ? '+' : ''}{formatUsd(stats.net_flow_24h)}
                  </div>
                </div>
                <div className="bg-gray-800/30 rounded-md p-2.5">
                  <div className="text-xs text-gray-400">Total Txs (24h)</div>
                  <div className="text-sm text-white font-semibold">{stats.tx_count_24h}</div>
                </div>
              </div>
              <div className="bg-gray-800/30 rounded-lg p-2.5">
                <div className="text-xs text-gray-400 mb-1.5">7-Day Summary</div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <div className="text-xs text-emerald-400 font-medium">{formatUsd(stats.deposit_volume_7d)}</div>
                    <div className="text-xs text-gray-500">In</div>
                  </div>
                  <div>
                    <div className="text-xs text-red-400 font-medium">{formatUsd(stats.withdrawal_volume_7d)}</div>
                    <div className="text-xs text-gray-500">Out</div>
                  </div>
                  <div>
                    <div className={`text-xs font-medium ${stats.net_flow_7d >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {stats.net_flow_7d >= 0 ? '+' : ''}{formatUsd(stats.net_flow_7d)}
                    </div>
                    <div className="text-xs text-gray-500">Net</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── HYPERLANE ── */}
          {tab === 'hyperlane' && (
            <div className="space-y-2">
              {hlLoading ? (
                <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 text-gray-500 animate-spin" /></div>
              ) : hyperlane && hyperlane.daily.length > 0 ? (
                <>
                  {(() => {
                    const today = hyperlane.daily[0]
                    return (
                      <div className="grid grid-cols-2 gap-1.5">
                        <div className="bg-gray-800/30 rounded-md p-2.5">
                          <div className="text-xs text-gray-400">Inbound (24h)</div>
                          <div className="text-sm text-emerald-400 font-semibold">{formatUsd(today.inbound_volume_usd)}</div>
                          <div className="text-xs text-gray-500">{today.inbound_count} txs</div>
                        </div>
                        <div className="bg-gray-800/30 rounded-md p-2.5">
                          <div className="text-xs text-gray-400">Outbound (24h)</div>
                          <div className="text-sm text-red-400 font-semibold">{formatUsd(today.outbound_volume_usd)}</div>
                          <div className="text-xs text-gray-500">{today.outbound_count} txs</div>
                        </div>
                      </div>
                    )
                  })()}
                  {hyperlane.chains.length > 0 && (
                    <div className="bg-gray-800/30 rounded-lg p-2.5">
                      <div className="text-xs text-gray-400 mb-1.5">Top Chains (volume)</div>
                      <div className="space-y-1.5">
                        {hyperlane.chains.slice(0, 6).map((c) => (
                          <div key={c.chain_name} className="flex items-center justify-between text-xs">
                            <span className="text-gray-300">{c.chain_name}</span>
                            <span className="text-gray-400 font-mono">{formatUsd(c.total_inbound_volume_usd + c.total_outbound_volume_usd)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-xs text-gray-500 text-center py-4">No Hyperlane data available</div>
              )}
            </div>
          )}
        </>
      )}

      <a
        href="https://www.openpulsechain.com/bridge"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-1 text-xs text-pulse-cyan hover:underline pt-1"
      >
        Full bridge analytics <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  )
}
