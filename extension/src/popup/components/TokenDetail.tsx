import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { ArrowLeft, Loader2, TrendingUp, TrendingDown, ExternalLink, Shield, Droplets, Users, MessageCircle, ArrowUpDown, AlertTriangle } from 'lucide-react'
import { useStore } from '../../lib/store'
import { getTokenPrice, getTokenHistory, getTokenSafety, getSmartMoneySwaps, gradeColor, type TokenPriceInfo, type PriceHistoryPoint, type SafetyScore, type SmartMoneySwap } from '../../lib/api'
import { formatUsd, formatPrice, shortenAddress, timeAgo } from '../../lib/format'

// Core token address → display ticker + logo
const CORE_TICKERS: Record<string, { symbol: string; logo: string }> = {
  '0xa1077a294dde1b09bb078844df40758a5d0f9a27': { symbol: 'PLS', logo: 'https://tokens.app.pulsex.com/images/tokens/0xA1077a294dDE1B09bB078844df40758a5D0f9a27.png' },
  '0x2b591e99afe9f32eaa6214f7b7629768c40eeb39': { symbol: 'HEX', logo: 'https://tokens.app.pulsex.com/images/tokens/0x2b591e99afE9f32eAA6214f7B7629768c40Eeb39.png' },
  '0x95b303987a60c71504d99aa1b13b4da07b0790ab': { symbol: 'PLSX', logo: 'https://tokens.app.pulsex.com/images/tokens/0x95B303987A60C71504D99Aa1b13B4DA07b0790ab.png' },
  '0x2fa878ab3f87cc1c9737fc071108f904c0b0c95d': { symbol: 'INC', logo: 'https://tokens.app.pulsex.com/images/tokens/0x2fa878Ab3F87CC1C9737Fc071108F904c0B0C95d.png' },
  '0xf6f8db0aba00007681f8faf16a0fda1c9b030b11': { symbol: 'PRVX', logo: '/icons/prvx.png' },
}

// Core token address → symbol for tweet search (may differ from display ticker)
const CORE_SYMBOLS: Record<string, string> = {
  '0xa1077a294dde1b09bb078844df40758a5d0f9a27': 'WPLS',
  '0x2b591e99afe9f32eaa6214f7b7629768c40eeb39': 'HEX',
  '0x95b303987a60c71504d99aa1b13b4da07b0790ab': 'PLSX',
  '0x2fa878ab3f87cc1c9737fc071108f904c0b0c95d': 'INC',
  '0xf6f8db0aba00007681f8faf16a0fda1c9b030b11': 'PRVX',
}

type TimeRange = '7d' | '30d' | '90d' | '1y'
const RANGES: { label: string; value: TimeRange; days: number }[] = [
  { label: '7D', value: '7d', days: 7 },
  { label: '30D', value: '30d', days: 30 },
  { label: '90D', value: '90d', days: 90 },
  { label: '1Y', value: '1y', days: 365 },
]

// SVG price chart with hover tooltip
function PriceChart({ data, color }: { data: PriceHistoryPoint[]; color: string }) {
  const [hover, setHover] = useState<{ idx: number; x: number; y: number } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  if (data.length < 2) return <div className="h-32 flex items-center justify-center text-xs text-gray-500">Not enough data</div>

  const prices = data.map(d => d.price_usd)
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const range = max - min || 1

  const W = 340
  const H = 120
  const pad = 4

  const coords = data.map((d, i) => ({
    x: pad + (i / (data.length - 1)) * (W - pad * 2),
    y: H - pad - ((d.price_usd - min) / range) * (H - pad * 2),
  }))

  const linePath = `M${coords.map(c => `${c.x},${c.y}`).join(' L')}`
  const areaPath = `${linePath} L${W - pad},${H} L${pad},${H} Z`

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const mouseX = ((e.clientX - rect.left) / rect.width) * W
    // Find closest data point
    let closest = 0
    let closestDist = Infinity
    for (let i = 0; i < coords.length; i++) {
      const dist = Math.abs(coords[i].x - mouseX)
      if (dist < closestDist) { closestDist = dist; closest = i }
    }
    setHover({ idx: closest, x: coords[closest].x, y: coords[closest].y })
  }

  const hoverData = hover ? data[hover.idx] : null
  const tooltipLeft = hover ? (hover.x > W * 0.65 ? hover.x - 136 : hover.x + 8) : 0

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-32 cursor-crosshair"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHover(null)}
    >
      <defs>
        <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#chartGrad)" />
      <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

      {hover && (
        <>
          {/* Vertical line */}
          <line x1={hover.x} y1={pad} x2={hover.x} y2={H - pad} stroke="rgba(255,255,255,0.2)" strokeWidth="1" strokeDasharray="3,3" />
          {/* Dot */}
          <circle cx={hover.x} cy={hover.y} r="4" fill={color} stroke="#0d0d20" strokeWidth="2" />
          {/* Tooltip background */}
          <rect x={tooltipLeft} y={Math.max(2, hover.y - 40)} width="128" height="36" rx="6" fill="#0d0d20" stroke="rgba(255,255,255,0.15)" strokeWidth="0.5" />
          {/* Price text */}
          <text x={tooltipLeft + 6} y={Math.max(2, hover.y - 40) + 15} fill="white" fontSize="12" fontFamily="monospace" fontWeight="bold">
            {formatPrice(hoverData?.price_usd)}
          </text>
          {/* Date text */}
          <text x={tooltipLeft + 6} y={Math.max(2, hover.y - 40) + 29} fill="#9ca3af" fontSize="10.5" fontFamily="sans-serif">
            {hoverData?.date ? new Date(hoverData.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' }) : ''}
          </text>
        </>
      )}
    </svg>
  )
}

export function TokenDetail() {
  const address = useStore((s) => s.selectedTokenAddress)
  const passedSymbol = useStore((s) => s.selectedTokenSymbol)
  const setActiveSection = useStore((s) => s.setActiveSection)
  const previousSection = useStore((s) => s.previousSection)

  const [info, setInfo] = useState<TokenPriceInfo | null>(null)
  const [safety, setSafety] = useState<SafetyScore | null>(null)
  const [history, setHistory] = useState<PriceHistoryPoint[]>([])
  const [swaps, setSwaps] = useState<SmartMoneySwap[]>([])
  const [tweets, setTweets] = useState<{ id: string; text: string; author_username: string; like_count: number; tweeted_at: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<TimeRange>('30d')
  const [scamData, setScamData] = useState<{ fakeHolders: number; fakeSupply: string; realHolders: number; realLiquidity: string; realScore: number } | null>(null)

  const selectedRange = RANGES.find(r => r.value === range)!

  // Tweet aliases are now handled by the backend endpoint
  // /api/v1/token/{symbol}/tweets — no database key needed

  // Load data progressively — don't block on slow requests
  useEffect(() => {
    if (!address) return
    setLoading(true)
    setInfo(null); setSafety(null); setHistory([]); setSwaps([]); setTweets([])

    // Fast: price + history (show chart ASAP)
    getTokenPrice(address)
      .then(data => { setInfo(data); setLoading(false) })
      .catch(() => setLoading(false))

    getTokenHistory(address, selectedRange.days)
      .then(setHistory)
      .catch(() => {})

    // Medium: safety (can be slow)
    getTokenSafety(address)
      .then(data => {
        setSafety(data)
        // If this looks like a scam clone, fetch comparison data
        const sym = data?.token_symbol?.toUpperCase() || passedSymbol?.toUpperCase() || ''
        const CANONICAL_ADDRS: Record<string, string> = {
          HEX: '0x2b591e99afe9f32eaa6214f7b7629768c40eeb39',
          PLSX: '0x95b303987a60c71504d99aa1b13b4da07b0790ab',
          PLS: '0xa1077a294dde1b09bb078844df40758a5d0f9a27',
          INC: '0x2fa878ab3f87cc1c9737fc071108f904c0b0c95d',
          USDC: '0x15d38573d2feeb82e7ad5187ab8c1d52810b1f07',
        }
        const realAddr = CANONICAL_ADDRS[sym]
        if (realAddr && realAddr !== address) {
          // Fetch fake token info from Blockscout + real token safety
          Promise.all([
            fetch(`https://api.scan.pulsechain.com/api/v2/tokens/${address}`).then(r => r.ok ? r.json() : null).catch(() => null),
            getTokenSafety(realAddr).catch(() => null),
          ]).then(([fakeInfo, realSafety]) => {
            const parsedHolders = parseInt(fakeInfo?.holders)
            const parsedSupply = parseFloat(fakeInfo?.total_supply)
            setScamData({
              fakeHolders: Number.isFinite(parsedHolders) ? parsedHolders : 0,
              fakeSupply: Number.isFinite(parsedSupply) ? (parsedSupply / 1e18).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '?',
              realHolders: realSafety?.holder_count || 0,
              realLiquidity: realSafety?.total_liquidity_usd ? formatUsd(realSafety.total_liquidity_usd) : '$0',
              realScore: realSafety?.score || 0,
            })
          })
        }
      })
      .catch(() => {})

    // Medium: swaps
    getSmartMoneySwaps(500, 1440)
      .then(all => setSwaps(all.filter(s =>
        s.bought_address?.toLowerCase() === address ||
        s.sold_address?.toLowerCase() === address
      ).slice(0, 10)))
      .catch(() => {})

    // Tweets: core tokens = 10 most recent (no time filter), others = last 24h
    // Uses the backend proxy endpoint (no database key in the extension)
    const SAFETY_API = 'https://safety.openpulsechain.com'
    const knownSym = CORE_SYMBOLS[address]
    const isCore = !!knownSym
    const symPromise = knownSym ? Promise.resolve(knownSym) : getTokenPrice(address).then(t => t?.symbol)
    symPromise.then(sym => {
      if (!sym) return
      const hours = isCore ? 0 : 24
      fetch(`${SAFETY_API}/api/v1/token/${encodeURIComponent(sym)}/tweets?limit=10&hours=${hours}`)
        .then(r => r.ok ? r.json() : { data: [] })
        .then(json => setTweets(json.data || []))
        .catch(() => {})
    })
  }, [address]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reload history only when range changes (not on mount — already loaded above)
  const rangeChangedRef = useRef(false)
  useEffect(() => {
    if (!address) return
    if (!rangeChangedRef.current) { rangeChangedRef.current = true; return }
    getTokenHistory(address, selectedRange.days)
      .then(setHistory)
      .catch(() => setHistory([]))
  }, [address, range, selectedRange.days])

  // Determine token color
  const tokenColor = useMemo(() => {
    const COLORS: Record<string, string> = {
      '0xa1077a294dde1b09bb078844df40758a5d0f9a27': '#00D4FF',
      '0x2b591e99afe9f32eaa6214f7b7629768c40eeb39': '#FF6B35',
      '0x95b303987a60c71504d99aa1b13b4da07b0790ab': '#8000E0',
      '0x2fa878ab3f87cc1c9737fc071108f904c0b0c95d': '#10b981',
      '0xf6f8db0aba00007681f8faf16a0fda1c9b030b11': '#f59e0b',
    }
    return COLORS[address || ''] || '#00D4FF'
  }, [address])

  if (!address) return null

  const pct = info?.price_change_24h_pct ?? 0
  const isUp = pct >= 0

  // Detect scam clones — use symbol from any available source
  const CANONICAL: Record<string, string[]> = {
    HEX: ['0x2b591e99afe9f32eaa6214f7b7629768c40eeb39'],
    PLSX: ['0x95b303987a60c71504d99aa1b13b4da07b0790ab'],
    PLS: ['0xa1077a294dde1b09bb078844df40758a5d0f9a27', '0x0000000000000000000000000000000000000000'],
    INC: ['0x2fa878ab3f87cc1c9737fc071108f904c0b0c95d'],
    USDC: ['0x15d38573d2feeb82e7ad5187ab8c1d52810b1f07'],
    USDT: ['0x0cb6f5a34ad42ec934882a05265a7d5f59b51a2f'],
    DAI: ['0xefd766ccb38eaf1dfd701853bfce31359239f305'],
  }
  const detectedSymbol = info?.symbol?.toUpperCase() || safety?.token_symbol?.toUpperCase() || passedSymbol?.toUpperCase() || ''
  const isFake = CANONICAL[detectedSymbol] ? !CANONICAL[detectedSymbol].includes(address) : false

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <button onClick={() => setActiveSection(previousSection)} className="p-1 rounded hover:bg-white/10 transition-colors">
          <ArrowLeft className="h-4 w-4 text-gray-400" />
        </button>
        {CORE_TICKERS[address]?.logo && (
          <img src={CORE_TICKERS[address].logo} alt="" className="h-6 w-6 rounded-full" />
        )}
        <span className="text-sm font-bold" style={{ color: isFake ? '#ef4444' : tokenColor }}>
          {CORE_TICKERS[address]?.symbol || info?.symbol || passedSymbol || address.slice(0, 8) + '...'}
        </span>
        <a
          href={`https://www.openpulsechain.com/token/${address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-gray-500 hover:text-gray-300"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      {/* FAKE / SCAM warning with comparison */}
      {isFake && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 space-y-2.5">
          <div className="flex items-center gap-2 text-red-400 text-sm font-bold">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Fake Token — Airdrop Scam
          </div>
          <p className="text-[11px] text-red-300/80 leading-relaxed">
            This token copies the symbol <strong className="text-white">{detectedSymbol}</strong> but is NOT the real {detectedSymbol}.
            Do NOT interact — it may drain your wallet.
          </p>

          {/* Comparison table */}
          {scamData && (
            <div className="bg-black/30 rounded-lg overflow-hidden text-[10px]">
              <div className="grid grid-cols-3 gap-px bg-white/5">
                <div className="bg-gray-900/80 p-1.5 text-gray-500 font-medium"></div>
                <div className="bg-gray-900/80 p-1.5 text-red-400 font-bold text-center">This token</div>
                <div className="bg-gray-900/80 p-1.5 text-emerald-400 font-bold text-center">Real {detectedSymbol}</div>

                <div className="bg-gray-900/60 p-1.5 text-gray-400">Holders</div>
                <div className="bg-gray-900/60 p-1.5 text-red-300 text-center font-mono">{scamData.fakeHolders}</div>
                <div className="bg-gray-900/60 p-1.5 text-emerald-300 text-center font-mono">{scamData.realHolders.toLocaleString('en-US')}</div>

                <div className="bg-gray-900/80 p-1.5 text-gray-400">Supply</div>
                <div className="bg-gray-900/80 p-1.5 text-red-300 text-center font-mono">{scamData.fakeSupply}</div>
                <div className="bg-gray-900/80 p-1.5 text-gray-400 text-center">—</div>

                <div className="bg-gray-900/60 p-1.5 text-gray-400">Liquidity</div>
                <div className="bg-gray-900/60 p-1.5 text-red-300 text-center font-bold">$0</div>
                <div className="bg-gray-900/60 p-1.5 text-emerald-300 text-center font-mono">{scamData.realLiquidity}</div>

                <div className="bg-gray-900/80 p-1.5 text-gray-400">Safety</div>
                <div className="bg-gray-900/80 p-1.5 text-red-300 text-center font-bold">{safety?.score ?? '?'}/100 F</div>
                <div className="bg-gray-900/80 p-1.5 text-emerald-300 text-center font-bold">{scamData.realScore}/100 A</div>
              </div>
            </div>
          )}

          <div className="space-y-1 text-[10px] text-gray-400">
            <p>Evidence:</p>
            <ul className="list-disc list-inside space-y-0.5 text-red-300/70">
              {scamData && scamData.fakeHolders < 100 && <li>Only {scamData.fakeHolders} holders (real has {scamData.realHolders.toLocaleString('en-US')})</li>}
              <li>Zero liquidity — cannot be sold</li>
              <li>Not verified on PulseChain Scan</li>
              <li>Airdropped to wallets to bait interaction</li>
            </ul>
          </div>

          <p className="text-[9px] text-gray-600 font-mono">{address}</p>
        </div>
      )}

      {/* Price Card */}
      {info && (
        <div className="bg-gray-800/30 rounded-lg p-3 border border-white/5">
          <div className="flex items-end justify-between mb-2">
            <div>
              <div className="text-2xl font-bold text-white font-mono">
                {formatPrice(info.price_usd)}
              </div>
              <div className={`text-sm flex items-center gap-1 ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                {isUp ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                {isUp ? '+' : ''}{pct.toFixed(2)}% (24h)
              </div>
            </div>
            {safety && (
              <div className="text-right text-[11px] text-gray-400 space-y-0.5">
                <div className="flex items-center gap-1 justify-end"><Droplets className="h-3 w-3" /> {formatUsd(safety.total_liquidity_usd)}</div>
                <div className="flex items-center gap-1 justify-end"><Users className="h-3 w-3" /> {safety.holder_count?.toLocaleString('en-US')} holders</div>
              </div>
            )}
          </div>

          {/* Time range selector */}
          <div className="flex gap-1 mb-2">
            {RANGES.map(r => (
              <button
                key={r.value}
                onClick={() => setRange(r.value)}
                className={`flex-1 text-[10px] font-medium py-1 rounded transition-colors ${
                  range === r.value
                    ? 'text-white bg-white/10'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          {/* Chart */}
          <PriceChart data={history} color={tokenColor} />
        </div>
      )}

      {/* Smart Money — Recent large movements */}
      <div className="bg-gray-800/30 rounded-lg p-3 border border-white/5">
        <div className="flex items-center gap-2 mb-2">
          <ArrowUpDown className="h-4 w-4 text-pulse-cyan" />
          <span className="text-xs font-semibold text-white">Large Movements (24h)</span>
        </div>
        {swaps.length === 0 ? (
          <p className="text-[11px] text-gray-500">No large swaps detected in the last 24h.</p>
        ) : (
          <div className="space-y-1.5">
            {swaps.slice(0, 5).map((s) => {
              const isBuy = s.bought_address?.toLowerCase() === address
              return (
                <div key={s.tx_id} className="flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-1.5">
                    <span className={`font-medium ${isBuy ? 'text-emerald-400' : 'text-red-400'}`}>
                      {isBuy ? 'BUY' : 'SELL'}
                    </span>
                    <span className="text-gray-500">{s.sold_symbol} → {s.bought_symbol}</span>
                    <span className="text-gray-400">{shortenAddress(s.wallet)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-white font-mono">{formatUsd(s.amount_usd)}</span>
                    <span className="text-gray-500">{timeAgo(typeof s.timestamp === 'number' ? new Date(s.timestamp * 1000).toISOString() : String(s.timestamp))}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Tweets */}
      <div className="bg-gray-800/30 rounded-lg p-3 border border-white/5">
        <div className="flex items-center gap-2 mb-2">
          <MessageCircle className="h-4 w-4 text-pulse-cyan" />
          <span className="text-xs font-semibold text-white">Recent Tweets</span>
        </div>
        {tweets.length === 0 ? (
          <p className="text-[11px] text-gray-500">No tweets found.</p>
        ) : (
          <div className="space-y-2">
            {tweets.slice(0, 5).map((t) => (
              <a
                key={t.id}
                href={`https://x.com/_/status/${t.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block p-2 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 transition-colors"
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[11px] font-medium text-pulse-cyan">@{t.author_username}</span>
                  <span className="text-[10px] text-gray-500">{timeAgo(t.tweeted_at)}</span>
                  {t.like_count > 0 && <span className="text-[10px] text-gray-500 ml-auto">♥ {t.like_count}</span>}
                </div>
                <p className="text-[11px] text-gray-300 leading-relaxed line-clamp-2">{t.text}</p>
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Safety Summary (compact) */}
      {safety && (
        <div className="bg-gray-800/30 rounded-lg p-3 border border-white/5">
          <div className="flex items-center gap-2 mb-2">
            <Shield className="h-4 w-4" style={{ color: gradeColor(safety.grade) }} />
            <span className="text-xs font-semibold text-white">Safety Score</span>
            <span className="ml-auto text-lg font-bold" style={{ color: gradeColor(safety.grade) }}>
              {safety.score}/100
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center">
            {[
              { label: 'Contract', score: safety.contract_score, max: 25 },
              { label: 'Honeypot', score: safety.honeypot_score, max: 30 },
              { label: 'Liquidity', score: safety.lp_score, max: 20 },
              { label: 'Holders', score: safety.holders_score, max: 15 },
            ].map(s => (
              <div key={s.label}>
                <div className="text-[10px] text-gray-500">{s.label}</div>
                <div className="text-xs font-bold text-white">{s.score}/{s.max}</div>
              </div>
            ))}
          </div>
          <a
            href={`https://www.openpulsechain.com/token/${address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block mt-2 text-center text-[11px] text-pulse-cyan hover:underline"
          >
            View full safety report →
          </a>
        </div>
      )}
    </div>
  )
}
