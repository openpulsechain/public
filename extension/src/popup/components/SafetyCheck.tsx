import { useState, useCallback, useRef, useEffect } from 'react'
import { Shield, Search, AlertTriangle, CheckCircle, XCircle, ExternalLink, Loader2, ArrowLeft } from 'lucide-react'
import { getTokenSafety, getDeployerReputation, searchTokens, gradeColor, type SafetyScore, type DeployerReputation, type TokenSuggestion, type ScamAnalysis } from '../../lib/api'
import { formatUsd, shortenAddress } from '../../lib/format'
import { TOKEN_REGISTRY } from '../../lib/token-registry'

// Resolve symbol from registry
function getSymbol(address: string): string | undefined {
  return TOKEN_REGISTRY[address.toLowerCase()]?.symbol
}

// Resolve display symbol from safety response (API returns both token_symbol and symbol)
function getDisplaySymbol(safety: { token_address: string; token_symbol?: string | null; symbol?: string | null }): string {
  return safety.token_symbol || safety.symbol || getSymbol(safety.token_address) || shortenAddress(safety.token_address)
}

// Logo cascade: PulseX (with correct checksum) → Piteas GitHub → DexScreener
function SafetyTokenLogo({ address, symbol, size = 'h-5 w-5' }: { address: string; symbol?: string; size?: string }) {
  const addr = address?.toLowerCase() || ''
  const entry = TOKEN_REGISTRY[addr]
  const checksum = entry?.checksum || address

  const urls = [
    `https://tokens.app.pulsex.com/images/tokens/${checksum}.png`,
    `https://raw.githubusercontent.com/piteasio/app-tokens/main/token-logo/${checksum}.png`,
    `https://dd.dexscreener.com/ds-data/tokens/pulsechain/${addr}.png`,
  ]

  const [urlIndex, setUrlIndex] = useState(0)
  const [failed, setFailed] = useState(false)

  useEffect(() => { setUrlIndex(0); setFailed(false) }, [address])

  const initial = (symbol || entry?.symbol || '?')[0].toUpperCase()
  const COLORS = ['#FF6B6B','#4ECDC4','#45B7D1','#96CEB4','#FFEAA7','#DDA0DD','#98D8C8','#F7DC6F','#BB8FCE','#85C1E9']
  const color = COLORS[addr.charCodeAt(addr.length - 1) % COLORS.length]

  if (failed || urlIndex >= urls.length) return (
    <div className={`${size} rounded-full shrink-0 flex items-center justify-center text-[8px] font-bold`}
      style={{ backgroundColor: `${color}25`, color }}>
      {initial}
    </div>
  )
  return (
    <img
      src={urls[urlIndex]}
      alt=""
      className={`${size} rounded-full bg-gray-800 shrink-0`}
      onError={() => {
        if (urlIndex + 1 < urls.length) setUrlIndex(urlIndex + 1)
        else setFailed(true)
      }}
    />
  )
}

// Canonical token registry — resolve symbol → address
const CANONICAL_TOKENS: Record<string, string> = {
  'PLS': '0xa1077a294dde1b09bb078844df40758a5d0f9a27',
  'WPLS': '0xa1077a294dde1b09bb078844df40758a5d0f9a27',
  'HEX': '0x2b591e99afe9f32eaa6214f7b7629768c40eeb39',
  'PHEX': '0x2b591e99afe9f32eaa6214f7b7629768c40eeb39',
  'PLSX': '0x95b303987a60c71504d99aa1b13b4da07b0790ab',
  'INC': '0x2fa878ab3f87cc1c9737fc071108f904c0b0c95d',
  'PRVX': '0xf6f8db0aba00007681f8faf16a0fda1c9b030b11',
  'PVRX': '0xf6f8db0aba00007681f8faf16a0fda1c9b030b11',
  'HDRN': '0x3819f64f282bf135d62168c1e513280daf905e06',
  'HEDRON': '0x3819f64f282bf135d62168c1e513280daf905e06',
  'LOAN': '0x9159f1d2a9f51998fc9ab03fbd8f265ab14a1b3b',
  'DAI': '0xefd766ccb38eaf1dfd701853bfce31359239f305',
  'WETH': '0x02dcdd04e3f455d838cd1249292c58f3b79e3c3c',
  'USDC': '0x15d38573d2feeb82e7ad5187ab8c1d52810b1f07',
  'USDT': '0x0cb6f5a34ad42ec934882a05265a7d5f59b51a2f',
  'WBTC': '0xb17d901469b9208b17d916112988a3fed19b5ca1',
  'EHEX': '0x57fde0a71132198bbec939b98976993d8d89d225',
  'MINT': '0x832396a5e87efd5e437a7134e25e3e2c05c963be',
  'MAXI': '0x0d86eb9f43c57f6ff3bc9e23d8f9d82503f0e84b',
}

function resolveTokenInput(input: string | undefined | null): string | null {
  if (!input) return null
  const trimmed = input.trim()
  if (trimmed.match(/^0x[a-fA-F0-9]{40}$/)) return trimmed.toLowerCase()
  const upper = trimmed.toUpperCase()
  return CANONICAL_TOKENS[upper] || null
}

interface BatchEntry {
  token_address: string
  score: number
  grade: string
  risks: string[]
  is_honeypot: boolean | null
  is_verified: boolean | null
  total_liquidity_usd: number
  holder_count: number
  top10_pct: number
  analyzed_at: string
}

const SAFETY_API = 'https://safety.openpulsechain.com'

export function SafetyCheck() {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [safety, setSafety] = useState<SafetyScore | null>(null)
  const [scamAnalysis, setScamAnalysis] = useState<ScamAnalysis | null>(null)
  const [deployer, setDeployer] = useState<DeployerReputation | null>(null)
  const [suggestions, setSuggestions] = useState<TokenSuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Scanner list state
  const [batchTokens, setBatchTokens] = useState<BatchEntry[]>([])
  const [batchLoading, setBatchLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'safe' | 'risky'>('all')
  const [tokenNames, setTokenNames] = useState<Record<string, string>>({})
  const [stats, setStats] = useState({ total: 0, safe: 0, risky: 0, honeypots: 0, scams: 0 })

  // Load stats (source de vérité) + batch list on mount
  useEffect(() => {
    (async () => {
      let statsLoaded = false
      try {
        // 1. Stats réels depuis /stats (toute la table)
        try {
          const statsRes = await fetch(`${SAFETY_API}/api/v1/tokens/safety/stats`)
          if (statsRes.ok) {
            const s = await statsRes.json()
            if (s.analyzed > 0) {
              const scams = (s.scam?.total_high_or_critical) ?? ((s.scam?.critical || 0) + (s.scam?.high || 0))
              setStats({
                total: s.analyzed,
                safe: s.safe || 0,
                risky: s.risky || 0,
                honeypots: s.honeypots || 0,
                scams,
              })
              statsLoaded = true
            }
          }
        } catch { /* non-blocking */ }

        // 2. Top 200 tokens par liquidité pour le tableau
        const res = await fetch(`${SAFETY_API}/api/v1/tokens/safety/batch?limit=200`)
        if (res.ok) {
          const json = await res.json()
          const entries: BatchEntry[] = (json.data || []).filter((t: BatchEntry) => t?.token_address)
          setBatchTokens(entries)

          // Fallback stats uniquement si /stats n'a pas répondu
          if (!statsLoaded && entries.length > 0) {
            setStats({
              total: entries.length,
              safe: entries.filter(t => t.score >= 60).length,
              risky: entries.filter(t => t.score < 60).length,
              honeypots: entries.filter(t => t.is_honeypot === true).length,
              scams: 0,
            })
          }

          // Resolve names for tokens not in registry
          const unknown = entries.filter(t => !getSymbol(t.token_address))
          if (unknown.length > 0) {
            const names: Record<string, string> = {}
            await Promise.allSettled(
              unknown.map(async (t) => {
                const addr = t.token_address.toLowerCase()
                try {
                  const r = await fetch(`https://api.openpulsechain.com/api/v1/tokens/${t.token_address}`)
                  if (r.ok) {
                    const d = await r.json()
                    if (d.data?.symbol) { names[addr] = d.data.symbol; return }
                  }
                } catch { /* skip */ }
                try {
                  const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${t.token_address}`)
                  if (r.ok) {
                    const d = await r.json()
                    const pair = d.pairs?.[0]
                    if (pair?.baseToken?.symbol) names[addr] = pair.baseToken.symbol
                  }
                } catch { /* skip */ }
              })
            )
            setTokenNames(names)
          }
        }
      } catch { /* silent */ }
      setBatchLoading(false)
    })()
  }, [])

  const filtered = batchTokens.filter(t => {
    if (filter === 'safe') return t.score >= 60
    if (filter === 'risky') return t.score < 60
    return true
  })

  // Debounced search for suggestions
  const onInputChange = useCallback((value: string) => {
    setInput(value)
    setError(null)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = value.trim()
    if (!q || q.length < 2 || q.match(/^0x[a-fA-F0-9]{40}$/)) {
      setSuggestions([])
      setShowSuggestions(false)
      return
    }
    const canonical = resolveTokenInput(q)
    if (canonical) { setSuggestions([]); setShowSuggestions(false); return }
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await searchTokens(q)
        setSuggestions(results)
        setShowSuggestions(results.length > 0)
      } catch {
        setSuggestions([])
        setShowSuggestions(false)
      }
    }, 300)
  }, [])

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [])

  const checkByAddress = useCallback(async (addr: string) => {
    setShowSuggestions(false)
    setSuggestions([])
    setLoading(true)
    setError(null)
    setSafety(null)
    setScamAnalysis(null)
    setDeployer(null)
    try {
      // Timeout 15s to avoid infinite spinner
      const timeout = new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('Analysis timeout — try again or view on site')), 15000)
      )
      const result = await Promise.race([getTokenSafety(addr), timeout])
      if (!result || typeof result.score !== 'number') {
        throw new Error('Token not found or not yet analyzed')
      }
      // Fallback: inject the searched address if the API didn't return one
      if (!result.token_address) result.token_address = addr
      // Normalize: ensure arrays are arrays, numbers are numbers
      result.risks = Array.isArray(result.risks) ? result.risks : []
      result.contract_dangers = Array.isArray(result.contract_dangers) ? result.contract_dangers : []
      result.score = Number(result.score) || 0
      result.honeypot_score = Number(result.honeypot_score) || 0
      result.contract_score = Number(result.contract_score) || 0
      result.lp_score = Number(result.lp_score) || 0
      result.holders_score = Number(result.holders_score) || 0
      result.holder_count = Number(result.holder_count) || 0
      result.top1_pct = Number(result.top1_pct) || 0
      result.top10_pct = Number(result.top10_pct) || 0
      result.total_liquidity_usd = Number(result.total_liquidity_usd) || 0
      result.age_days = Number(result.age_days) || 0
      setSafety(result)
      // Parse scam_analysis from analysis_details
      try {
        if (result.analysis_details) {
          const details = typeof result.analysis_details === 'string' ? JSON.parse(result.analysis_details) : result.analysis_details
          if (details?.scam_analysis) {
            setScamAnalysis({
              scam_score: Number(details.scam_analysis.scam_score) || 0,
              risk_level: details.scam_analysis.risk_level || 'low',
              signals: Array.isArray(details.scam_analysis.signals) ? details.scam_analysis.signals : [],
            })
          }
        }
      } catch { /* scam parsing failed — non-blocking */ }
      // Deployer info in background (non-blocking)
      getDeployerReputation(addr).then(dep => setDeployer(dep)).catch(() => {})
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to check token')
    } finally {
      setLoading(false)
    }
  }, [])

  const handleCheck = useCallback(() => {
    const q = input.trim()
    if (!q) return
    if (q.match(/^0x[a-fA-F0-9]{40}$/)) { checkByAddress(q.toLowerCase()); return }
    const canonical = resolveTokenInput(q)
    if (canonical) { checkByAddress(canonical); return }
    if (suggestions.length > 0) {
      setInput(suggestions[0].symbol)
      checkByAddress(suggestions[0].address.toLowerCase())
      return
    }
    setError('Token not found. Paste the 0x address to run on-chain analysis.')
  }, [input, suggestions, checkByAddress])

  const selectSuggestion = (s: TokenSuggestion) => {
    setInput(s.symbol)
    setShowSuggestions(false)
    setSuggestions([])
    checkByAddress(s.address.toLowerCase())
  }

  const goBack = () => { setSafety(null); setScamAnalysis(null); setDeployer(null); setInput(''); setError(null) }

  return (
    <div className="space-y-2.5">
      {/* Header */}
      <div className="flex items-center gap-2">
        {safety && (
          <button onClick={goBack} className="text-gray-400 hover:text-white transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <Shield className="h-4 w-4 text-pulse-cyan" />
        <h2 className="text-sm font-semibold text-white">Token Safety Check</h2>
      </div>

      {/* Search bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500 z-10" />
          <input
            type="text"
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCheck()}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            placeholder="Token name or address (0x...)"
            className="w-full bg-gray-800/60 border border-white/10 rounded-lg pl-8 pr-3 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-pulse-cyan/50"
          />
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-gray-900 border border-white/10 rounded-lg overflow-hidden z-50 shadow-xl">
              {suggestions.map((s) => (
                <button
                  key={s.address}
                  onMouseDown={() => selectSuggestion(s)}
                  className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-white font-medium">{s.symbol}</span>
                    <span className="text-gray-500 truncate max-w-[120px]">{s.name}</span>
                  </div>
                  <span className="text-gray-600 font-mono text-[10px]">{shortenAddress(s.address)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={handleCheck}
          disabled={loading}
          className="px-3 py-2 rounded-lg bg-gradient-to-r from-pulse-cyan to-pulse-purple text-white text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Check'}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 rounded-lg p-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Loading analysis */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-6 space-y-2">
          <Loader2 className="h-6 w-6 text-pulse-cyan animate-spin" />
          <div className="text-xs text-white font-medium">Analyzing token safety...</div>
          <div className="w-40 h-1 bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full bg-pulse-cyan/60 rounded-full animate-pulse" style={{ width: '70%' }} />
          </div>
        </div>
      )}

      {/* ════ DETAIL VIEW ════ */}
      {safety && (
        <div className="space-y-2.5">
          {/* Token header — symbol + score + grade */}
          <div className="flex items-center justify-between bg-gray-800/40 rounded-xl p-3 border border-white/5">
            <div className="flex items-center gap-2">
              <SafetyTokenLogo address={safety.token_address} symbol={getDisplaySymbol(safety)} size="h-6 w-6" />
              <div>
                <div className="text-xs text-gray-400">{getDisplaySymbol(safety)}</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-2xl font-bold text-white">{safety.score ?? '--'}</span>
                  <span className="text-xs text-gray-500">/ 100</span>
                </div>
              </div>
            </div>
            <div
              className="text-3xl font-bold px-3 py-1 rounded-lg"
              style={{ color: gradeColor(safety.grade || 'F'), backgroundColor: `${gradeColor(safety.grade || 'F')}15` }}
            >
              {safety.grade || '?'}
            </div>
          </div>

          {/* ══════════════════════════════════════════════════════ */}
          {/* INVARIANT — DO NOT BREAK                                */}
          {/* Both cards (Honeypot + Scam) MUST ALWAYS render.        */}
          {/* Enforced by scripts/safety-invariant-check.mjs.         */}
          {/* If scam data is missing → show "NO DATA" state, NEVER   */}
          {/* hide the card. See frontend SafetyVerdictGrid.tsx.      */}
          {/* ══════════════════════════════════════════════════════ */}
          <div className="grid grid-cols-2 gap-2" data-testid="safety-verdict-grid">
            {/* Honeypot Check */}
            <div data-testid="safety-verdict-honeypot" className={`rounded-xl p-3 text-center border-2 ${
              safety.is_honeypot === true ? 'bg-red-500/20 border-red-500/40'
                : safety.is_honeypot === false ? 'bg-emerald-500/15 border-emerald-500/30'
                : 'bg-gray-700/30 border-gray-600/30'
            }`}>
              <div className="text-[9px] text-gray-500 uppercase tracking-widest mb-1">Honeypot Check</div>
              <div className={`text-sm font-black ${
                safety.is_honeypot === true ? 'text-red-400'
                  : safety.is_honeypot === false ? 'text-emerald-400'
                  : 'text-gray-400'
              }`}>
                {safety.is_honeypot === true ? 'HONEYPOT' : safety.is_honeypot === false ? 'NOT A HONEYPOT' : 'INCONCLUSIVE'}
              </div>
              <p className="text-[10px] text-gray-500 mt-1">
                {safety.is_honeypot === true ? 'Cannot sell this token'
                  : safety.is_honeypot === false ? 'Can be bought and sold'
                  : 'Could not determine'}
              </p>
            </div>

            {/* Scam Analysis */}
            <div data-testid="safety-verdict-scam" className={`rounded-xl p-3 text-center border-2 ${
              scamAnalysis
                ? scamAnalysis.risk_level === 'critical' ? 'bg-red-500/20 border-red-500/40'
                  : scamAnalysis.risk_level === 'high' ? 'bg-orange-500/20 border-orange-500/40'
                  : scamAnalysis.risk_level === 'medium' ? 'bg-amber-500/20 border-amber-500/40'
                  : 'bg-emerald-500/15 border-emerald-500/30'
                : 'bg-gray-700/30 border-gray-600/30'
            }`}>
              <div className="text-[9px] text-gray-500 uppercase tracking-widest mb-1">Scam Analysis</div>
              <div className={`text-sm font-black ${
                scamAnalysis
                  ? scamAnalysis.risk_level === 'critical' ? 'text-red-400'
                    : scamAnalysis.risk_level === 'high' ? 'text-orange-400'
                    : scamAnalysis.risk_level === 'medium' ? 'text-amber-400'
                    : 'text-emerald-400'
                  : 'text-gray-400'
              }`}>
                {scamAnalysis
                  ? scamAnalysis.risk_level === 'critical' ? 'CRITICAL RISK'
                    : scamAnalysis.risk_level === 'high' ? 'HIGH RISK'
                    : scamAnalysis.risk_level === 'medium' ? 'MEDIUM RISK'
                    : 'LOW RISK'
                  : 'NO DATA'}
              </div>
              <p className="text-[10px] text-gray-500 mt-1">
                {scamAnalysis ? `Scam Score: ${scamAnalysis.scam_score}/100` : 'Analysis unavailable'}
              </p>
            </div>
          </div>

          {/* Scam signals */}
          {scamAnalysis && scamAnalysis.signals.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {scamAnalysis.signals.map((s, i) => (
                <span key={i} className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${
                  s.severity === 'critical' ? 'bg-red-500/15 border-red-500/30 text-red-300'
                    : s.severity === 'high' ? 'bg-orange-500/15 border-orange-500/30 text-orange-300'
                    : 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                }`}>
                  {s.signal.replace(/_/g, ' ')} — {s.detail}
                </span>
              ))}
            </div>
          )}

          {/* Risk warnings */}
          {safety.risks?.length > 0 && (
            <div className="space-y-1">
              {safety.risks.map((risk, i) => (
                <div key={i} className="flex items-start gap-2 text-xs bg-red-500/5 border border-red-500/10 rounded-lg p-2">
                  <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
                  <span className="text-red-300">{risk}</span>
                </div>
              ))}
            </div>
          )}

          {/* Sub-scores — 4 modules inline */}
          <div className="grid grid-cols-4 gap-1">
            <ScoreBox label="Honeypot" score={safety.honeypot_score ?? 0} max={30} detail={safety.is_honeypot ? 'HONEYPOT' : 'Safe'} danger={!!safety.is_honeypot} />
            <ScoreBox label="Contract" score={safety.contract_score ?? 0} max={25} detail={safety.is_verified ? 'Verified' : 'Unverified'} danger={!safety.is_verified} />
            <ScoreBox label="Liquidity" score={safety.lp_score ?? 0} max={20} detail={formatUsd(safety.total_liquidity_usd ?? 0)} danger={(safety.total_liquidity_usd ?? 0) < 1000} />
            <ScoreBox label="Holders" score={safety.holders_score ?? 0} max={15} detail={`${(safety.holder_count ?? 0).toLocaleString('en-US')}`} danger={(safety.top1_pct ?? 0) > 50} />
          </div>

          {/* Contract details */}
          <div className="bg-gray-800/30 rounded-lg p-2.5 space-y-1.5 text-xs">
            <div className="font-medium text-gray-300 mb-1">Contract Analysis</div>
            <Detail label="Ownership" value={safety.ownership_renounced ? 'Renounced' : 'Active'} ok={safety.ownership_renounced} />
            <Detail label="Mint Function" value={safety.has_mint ? 'Yes' : 'No'} ok={!safety.has_mint} />
            <Detail label="Blacklist" value={safety.has_blacklist ? 'Yes' : 'No'} ok={!safety.has_blacklist} />
            <Detail label="Proxy" value={safety.is_proxy ? 'Yes (upgradeable)' : 'No'} ok={!safety.is_proxy} />
            <Detail label="Token Age" value={`${safety.age_days ?? 0} days`} ok={(safety.age_days ?? 0) > 7} />
            {safety.buy_tax_pct != null && <Detail label="Buy Tax" value={`${Number(safety.buy_tax_pct).toFixed(1)}%`} ok={safety.buy_tax_pct < 5} />}
            {safety.sell_tax_pct != null && <Detail label="Sell Tax" value={`${Number(safety.sell_tax_pct).toFixed(1)}%`} ok={safety.sell_tax_pct < 10} />}
          </div>

          {/* Deployer reputation */}
          {deployer && (
            <div className="bg-gray-800/30 rounded-lg p-2.5 text-xs space-y-1.5">
              <div className="font-medium text-gray-300 mb-1">Deployer Reputation</div>
              <Detail label="Tokens Deployed" value={String(Number(deployer.tokens_deployed) || 0)} />
              <Detail label="Dead Tokens" value={String(Number(deployer.tokens_dead) || 0)} ok={(Number(deployer.dead_ratio) || 0) < 0.5} />
              <Detail label="Dead Ratio" value={`${((Number(deployer.dead_ratio) || 0) * 100).toFixed(0)}%`} ok={(Number(deployer.dead_ratio) || 0) < 0.5} />
              <div className="flex items-center gap-1.5 mt-1">
                <span className="text-gray-500">Risk Level:</span>
                <span className={`font-medium ${deployer.risk_level === 'low' ? 'text-emerald-400' : deployer.risk_level === 'medium' ? 'text-amber-400' : 'text-red-400'}`}>
                  {(deployer.risk_level || 'unknown').toUpperCase()}
                </span>
              </div>
            </div>
          )}

          {/* Link to full report */}
          <a
            href={`https://www.openpulsechain.com/token/${safety.token_address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 text-xs text-pulse-cyan hover:underline py-1"
          >
            Full report on OpenPulsechain <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}

      {/* ════ SCANNER LIST VIEW ════ */}
      {!safety && !loading && (
        <>
          {/* Stats bar — 5 cards inline (Total + Safe/Risky partition + Honeypot/Scam subsets) */}
          {(() => {
            const pct = (n: number) => stats.total > 0 ? `${Math.round((n / stats.total) * 100)}%` : ''
            return (
              <div className="grid grid-cols-5 gap-1">
                <div className="bg-gray-800/40 rounded-lg p-1.5 text-center border border-white/5">
                  <div className="text-sm font-bold text-white leading-tight">{stats.total.toLocaleString('en-US')}</div>
                  <div className="text-[9px] text-gray-500 uppercase leading-tight">Total</div>
                </div>
                <div className="bg-emerald-500/5 rounded-lg p-1.5 text-center border border-emerald-500/15">
                  <div className="text-sm font-bold text-emerald-400 leading-tight">{stats.safe.toLocaleString('en-US')}</div>
                  <div className="text-[9px] text-gray-500 uppercase leading-tight">Safe · {pct(stats.safe)}</div>
                </div>
                <div className="bg-orange-500/5 rounded-lg p-1.5 text-center border border-orange-500/15">
                  <div className="text-sm font-bold text-orange-400 leading-tight">{stats.risky.toLocaleString('en-US')}</div>
                  <div className="text-[9px] text-gray-500 uppercase leading-tight">Risky · {pct(stats.risky)}</div>
                </div>
                <div
                  className="bg-amber-500/5 rounded-lg p-1.5 text-center border border-amber-500/15 cursor-help"
                  title="Subset of Risky — tokens that cannot be sold."
                >
                  <div className="text-sm font-bold text-amber-400 leading-tight">{stats.honeypots.toLocaleString('en-US')}</div>
                  <div className="text-[9px] text-gray-500 uppercase leading-tight">HP · {pct(stats.honeypots)}</div>
                </div>
                <div
                  className="bg-red-500/10 rounded-lg p-1.5 text-center border border-red-500/25 cursor-help"
                  title="Subset of Risky — non-honeypot tokens flagged with critical or high scam risk."
                >
                  <div className="text-sm font-bold text-red-400 leading-tight">{stats.scams.toLocaleString('en-US')}</div>
                  <div className="text-[9px] text-gray-500 uppercase leading-tight">Scams · {pct(stats.scams)}</div>
                </div>
              </div>
            )
          })()}

          {/* Filter tabs */}
          <div className="flex gap-1">
            {(['all', 'safe', 'risky'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors ${
                  filter === f
                    ? 'bg-pulse-cyan/20 text-pulse-cyan border border-pulse-cyan/30'
                    : 'text-gray-500 hover:text-white hover:bg-white/5'
                }`}
              >
                {f === 'all' ? 'All' : f === 'safe' ? 'Safe' : 'Risky'}
              </button>
            ))}
          </div>

          {/* Token list */}
          {batchLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 text-gray-500 animate-spin" />
            </div>
          ) : (
            <div className="max-h-[320px] overflow-y-auto space-y-1">
              {filtered.map((t) => {
                const symbol = getSymbol(t.token_address) || tokenNames[t.token_address.toLowerCase()]
                const riskCount = t.risks?.length || 0
                return (
                  <button
                    key={t.token_address}
                    onClick={() => checkByAddress(t.token_address)}
                    className="w-full flex items-center gap-2 bg-gray-800/30 rounded-lg px-2.5 py-2 border border-white/5 hover:border-pulse-cyan/30 hover:bg-gray-800/50 transition-colors text-left"
                  >
                    <SafetyTokenLogo address={t.token_address} symbol={symbol} size="h-5 w-5" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-white truncate">
                        {symbol || shortenAddress(t.token_address)}
                      </div>
                    </div>
                    <div className="text-xs font-bold text-white w-8 text-right">{t.score}</div>
                    <div
                      className="text-[10px] font-bold w-5 text-center rounded"
                      style={{ color: gradeColor(t.grade), backgroundColor: `${gradeColor(t.grade)}15` }}
                    >
                      {t.grade}
                    </div>
                    <div className="w-4 flex justify-center">
                      {t.is_honeypot === false
                        ? <CheckCircle className="h-3 w-3 text-emerald-400" />
                        : t.is_honeypot === true
                        ? <XCircle className="h-3 w-3 text-red-400" />
                        : <span className="text-[10px] text-gray-600">—</span>
                      }
                    </div>
                    <div className="text-[10px] text-gray-400 w-16 text-right truncate">
                      {formatUsd(t.total_liquidity_usd)}
                    </div>
                    <div className="text-[10px] text-gray-400 w-10 text-right">
                      {t.holder_count?.toLocaleString('en-US') || '—'}
                    </div>
                    <div className="w-5 flex justify-center">
                      {riskCount > 0
                        ? <span className="text-[10px] text-amber-400">⚠{riskCount}</span>
                        : <CheckCircle className="h-3 w-3 text-emerald-400" />
                      }
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {/* Link to site */}
          <a
            href="https://www.openpulsechain.com/safety"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1 text-xs text-pulse-cyan hover:underline pt-1"
          >
            Full scanner on OpenPulsechain <ExternalLink className="h-3 w-3" />
          </a>
        </>
      )}
    </div>
  )
}

function ScoreBox({ label, score, max, detail, danger }: { label: string; score: number; max: number; detail: string; danger?: boolean }) {
  const pct = max > 0 ? score / max : 0
  const color = pct >= 0.7 ? 'text-emerald-400' : pct >= 0.4 ? 'text-amber-400' : 'text-red-400'
  return (
    <div className="bg-gray-800/30 rounded-lg px-1.5 py-1.5 border border-white/5 min-w-0" title={detail}>
      <div className="text-[10px] text-gray-500 truncate leading-tight">{label}</div>
      <div className="flex items-baseline justify-center gap-0.5 my-1">
        <span className={`text-2xl font-bold leading-none ${color}`}>{score}</span>
        <span className="text-[10px] text-gray-600">/{max}</span>
      </div>
      <div className={`text-[10px] truncate leading-tight ${danger ? 'text-red-400' : 'text-gray-400'}`}>{detail}</div>
    </div>
  )
}

function Detail({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-500">{label}</span>
      <span className={`flex items-center gap-1 ${ok === true ? 'text-emerald-400' : ok === false ? 'text-red-400' : 'text-gray-300'}`}>
        {ok === true && <CheckCircle className="h-3 w-3" />}
        {ok === false && <XCircle className="h-3 w-3" />}
        {value}
      </span>
    </div>
  )
}
