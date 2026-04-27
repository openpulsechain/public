import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Link } from 'react-router-dom'
import { Shield, Search, AlertTriangle, CheckCircle, XCircle, Loader2, TrendingDown, Coins, Clock, ExternalLink, Bug, Info } from 'lucide-react'
import { ShareButton } from '../ui/ShareButton'
import { ScoringMethodologyModal } from '../ScoringMethodologyModal'
import { useTranslation } from '../../i18n'
import { SafetyVerdictGrid } from '../safety/SafetyVerdictGrid'
import { parseSafetyPayload, reportSafetyContractWarning } from '../../lib/safetyContract'

const SAFETY_API = import.meta.env.VITE_SAFETY_API_URL || 'https://safety.openpulsechain.com'

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
import { supabase } from '../../lib/supabase'
import { formatTimeAgo } from '../../lib/format'
import { TokenLogo } from '../ui/TokenLogo'

// ─── Interfaces ────────────────────────────────────────────────────────

interface SafetyEntry {
  token_address: string
  score: number
  grade: string
  risks: string[]
  is_honeypot: boolean | null
  total_liquidity_usd: number
  holder_count: number
  top10_pct: number
  buy_tax_pct: number | null
  sell_tax_pct: number | null
  analyzed_at: string
}

interface TokenName {
  address: string
  symbol: string
  name: string
}

interface Alert {
  id: number
  alert_type: string
  severity: string
  token_address: string | null
  pair_address: string | null
  data: Record<string, unknown>
  created_at: string
}

interface ScamSignal {
  signal: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  detail: string
}

interface ScamAnalysis {
  scam_score: number
  risk_level: 'critical' | 'high' | 'medium' | 'low'
  signals: ScamSignal[]
}

// ─── Constants ─────────────────────────────────────────────────────────

const GRADE_COLORS: Record<string, string> = {
  A: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
  B: 'text-green-400 bg-green-400/10 border-green-400/30',
  C: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30',
  D: 'text-orange-400 bg-orange-400/10 border-orange-400/30',
  F: 'text-red-400 bg-red-400/10 border-red-400/30',
}

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-red-500/10 text-red-400 border-red-500/20',
  high: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  medium: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  low: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  honeypot: <Bug className="h-4 w-4" />,
  lp_removal: <TrendingDown className="h-4 w-4" />,
  whale_dump: <Coins className="h-4 w-4" />,
  mint_event: <AlertTriangle className="h-4 w-4" />,
  flagged_activity: <Shield className="h-4 w-4" />,
}

const SCAM_SIGNAL_LABELS: Record<string, string> = {
  near_zero_liquidity: 'No Liquidity',
  very_low_liquidity: 'Low Liquidity',
  low_liquidity: 'Low Liquidity',
  extreme_concentration: 'Whale Dominated',
  high_concentration: 'Concentrated Supply',
  concentrated_supply: 'Concentrated Supply',
  brand_new_token: 'Brand New',
  very_new_token: 'Very New',
  no_activity: 'No Activity',
  low_activity: 'Low Activity',
  unverified_contract: 'Unverified',
  mintable_active_owner: 'Mintable',
  serial_rugger: 'Serial Rugger',
  risky_deployer: 'Risky Deployer',
  flagged_deployer: 'Flagged Deployer',
  negative_intel: 'Negative Intel',
  heavy_lp_removals: 'LP Drain',
  lp_removals: 'LP Removals',
  lp_removal: 'LP Removal',
  unverified_whale: 'Hidden Code + Whale',
  critical_alerts: 'Critical Alerts',
  high_alerts: 'Active Alerts',
  many_alerts: 'Multiple Alerts',
}

const SCAM_SEVERITY_PILL: Record<string, string> = {
  critical: 'bg-red-500/15 text-red-400 border-red-500/30',
  high: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  medium: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  low: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
}

// ─── Main component ───────────────────────────────────────────────────

export function SafetyDashboardPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') === 'alerts' ? 'alerts' : 'scanner'

  // Scanner state
  const [scores, setScores] = useState<SafetyEntry[]>([])
  const [tokenNames, setTokenNames] = useState<Record<string, TokenName>>({})
  const [loading, setLoading] = useState(true)
  const [searchAddress, setSearchAddress] = useState('')
  const [filter, setFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [stats, setStats] = useState({ total: 0, honeypots: 0, safe: 0, risky: 0, scams: 0 })
  const [methodologyOpen, setMethodologyOpen] = useState(false)

  // Alerts state
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [alertsLoading, setAlertsLoading] = useState(true)
  const [alertFilter, setAlertFilter] = useState<string>('all')

  // Flagged wallets from known_addresses
  const [flaggedWallets, setFlaggedWallets] = useState<{ address: string; label: string; risk_level: string; category: string; source: string }[]>([])
  const [flaggedCount, setFlaggedCount] = useState(0)

  // Honeypot analysis popup
  const [hpOpen, setHpOpen] = useState(false)
  const [hpAddr, setHpAddr] = useState('')
  const [hpLoading, setHpLoading] = useState(false)
  const [hpData, setHpData] = useState<HoneypotDetail | null>(null)
  const [hpToken, setHpToken] = useState<TokenName | null>(null)
  const [hpError, setHpError] = useState<string | null>(null)
  const [scamAnalysis, setScamAnalysis] = useState<ScamAnalysis | null>(null)

  // Token name autocomplete for checker
  const [checkerSuggestions, setCheckerSuggestions] = useState<TokenName[]>([])
  const [checkerSelectedIdx, setCheckerSelectedIdx] = useState(-1)
  const checkerDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load scanner data
  useEffect(() => {
    loadScores()
  }, [])

  // Load alerts + auto-refresh
  useEffect(() => {
    loadAlerts()
    loadFlaggedWallets()
    const interval = setInterval(() => loadAlerts(), 120_000)
    return () => clearInterval(interval)
  }, [])

  async function loadScores() {
    setLoading(true)

    // Source de vérité unique : /stats retourne les compteurs réels sur TOUTE la table
    let statsLoaded = false
    try {
      const safetyApi = import.meta.env.VITE_SAFETY_API_URL || 'https://safety.openpulsechain.com'
      const statsRes = await fetch(`${safetyApi}/api/v1/tokens/safety/stats`)
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
    } catch { /* stats non-blocking — fallback below */ }

    // Charger le tableau (top 200 par liquidité pour l'affichage)
    const { data } = await supabase
      .from('token_safety_scores')
      .select('token_address, score, grade, risks, is_honeypot, total_liquidity_usd, holder_count, top10_pct, buy_tax_pct, sell_tax_pct, analyzed_at')
      .order('total_liquidity_usd', { ascending: false })
      .limit(200)

    const entries = data || []
    setScores(entries)

    // Fallback stats uniquement si /stats n'a pas répondu
    if (!statsLoaded && entries.length > 0) {
      const safe = entries.filter(e => e.score >= 60).length
      const risky = entries.length - safe
      const honeypots = entries.filter(e => e.is_honeypot === true).length
      setStats({ total: entries.length, honeypots, safe, risky, scams: 0 })
    }

    const addresses = entries.map(e => e.token_address)
    if (addresses.length > 0) {
      const { data: tokens } = await supabase
        .from('pulsechain_tokens')
        .select('address, symbol, name')
        .in('address', addresses)

      const map: Record<string, TokenName> = {}
      for (const t of tokens || []) {
        map[t.address] = t
      }
      setTokenNames(map)
    }

    setLoading(false)
  }

  async function loadAlerts() {
    setAlertsLoading(true)
    const { data } = await supabase
      .from('scam_radar_alerts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)

    setAlerts(data || [])
    setAlertsLoading(false)
  }

  async function loadFlaggedWallets() {
    // Get total count
    const { count } = await supabase
      .from('known_addresses')
      .select('*', { count: 'exact', head: true })
    setFlaggedCount(count || 0)

    // PulseChain-relevant sources first (manual research, OFAC sanctions, scam databases)
    // Exclude generic Etherscan phishing labels (forta_etherscan) — not PulseChain-specific
    const { data: pulsechain } = await supabase
      .from('known_addresses')
      .select('address, label, risk_level, category, source')
      .in('source', ['intelligence_study', 'ofac', 'scamsniffer'])
      .in('risk_level', ['HIGH', 'CRITICAL'])
      .order('source', { ascending: true })
      .limit(100)

    // If not enough PulseChain-specific results, fill with other sources
    const pcResults = pulsechain || []
    if (pcResults.length < 50) {
      const { data: others } = await supabase
        .from('known_addresses')
        .select('address, label, risk_level, category, source')
        .not('source', 'in', '("intelligence_study","ofac","scamsniffer")')
        .in('risk_level', ['HIGH', 'CRITICAL'])
        .order('created_at', { ascending: false })
        .limit(50 - pcResults.length)
      setFlaggedWallets([...pcResults, ...(others || [])])
    } else {
      setFlaggedWallets(pcResults)
    }
  }

  const searchCheckerTokens = useCallback((query: string) => {
    if (checkerDebounceRef.current) clearTimeout(checkerDebounceRef.current)
    const q = query.trim()
    if (!q || q.length < 2 || /^0x[0-9a-f]{40}$/i.test(q)) {
      setCheckerSuggestions([])
      setCheckerSelectedIdx(-1)
      return
    }
    checkerDebounceRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from('pulsechain_tokens')
        .select('address, symbol, name')
        .or(`symbol.ilike.%${q}%,name.ilike.%${q}%`)
        .limit(8)
      setCheckerSuggestions(data || [])
      setCheckerSelectedIdx(-1)
    }, 250)
  }, [])

  function selectCheckerToken(token: TokenName) {
    setSearchAddress(token.address)
    setCheckerSuggestions([])
    // Auto-trigger analysis
    analyzeAddress(token.address)
  }

  function handleCheckerKeyDown(e: React.KeyboardEvent) {
    if (checkerSuggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCheckerSelectedIdx(prev => Math.min(prev + 1, checkerSuggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCheckerSelectedIdx(prev => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter' && checkerSelectedIdx >= 0) {
      e.preventDefault()
      selectCheckerToken(checkerSuggestions[checkerSelectedIdx])
    }
  }

  function analyzeAddress(address: string) {
    const addr = address.trim().toLowerCase()
    if (!/^0x[0-9a-f]{40}$/i.test(addr)) return

    setHpAddr(addr)
    setHpOpen(true)
    setHpLoading(true)
    setHpData(null)
    setHpToken(null)
    setHpError(null)
    setScamAnalysis(null)
    setCheckerSuggestions([])

    // Fetch token name in parallel
    supabase.from('pulsechain_tokens').select('address, symbol, name').eq('address', addr).single()
      .then(({ data }) => { if (data) setHpToken(data) })

    // Unified contract parser — handles fresh path, hydrated cache, and old
    // cache shapes. Emits telemetry if scam_analysis is missing.
    const applyPayload = (data: unknown, source: string) => {
      const parsed = parseSafetyPayload(data)
      if (parsed.warnings.length > 0) {
        reportSafetyContractWarning(source, parsed.warnings, addr)
      }
      if (parsed.scam) setScamAnalysis({
        scam_score: parsed.scam.scam_score,
        risk_level: parsed.scam.risk_level,
        signals: [],
      })
    }

    // Step 1: Try cached analysis
    const runAnalysis = async () => {
      try {
        const ctrl1 = new AbortController()
        const t1 = setTimeout(() => ctrl1.abort(), 10000)
        const res1 = await fetch(`${SAFETY_API}/api/v1/token/${addr}/safety`, { signal: ctrl1.signal, cache: 'no-store' })
        clearTimeout(t1)
        if (res1.ok) {
          const json1 = await res1.json()
          const d = json1.data
          if (d?.honeypot && d.honeypot.is_honeypot !== undefined) {
            setHpData(d.honeypot)
            applyPayload(d, 'dashboard_cache_hit')
            // Preserve full signals array from fresh payload
            if (d.scam_analysis?.signals) {
              setScamAnalysis(d.scam_analysis)
            }
            setHpLoading(false)
            return
          }
          if (d && d.is_honeypot !== undefined) {
            setHpData({
              is_honeypot: d.is_honeypot,
              buy_tax_pct: d.buy_tax_pct ?? null,
              sell_tax_pct: d.sell_tax_pct ?? null,
              transfer_tax_pct: null, buy_gas: null, sell_gas: null,
              max_tx_amount: null, max_wallet_amount: null,
              dynamic_tax: false, tax_by_amount: null,
              flags: [], router: null, error: null,
            })
            applyPayload(d, 'dashboard_cache_row')
            if (d.scam_analysis?.signals) {
              setScamAnalysis(d.scam_analysis)
            }
            setHpLoading(false)
            return
          }
        }
      } catch { /* cache miss */ }

      // Step 2: Fresh analysis
      try {
        const ctrl2 = new AbortController()
        const t2 = setTimeout(() => ctrl2.abort(), 90000)
        const res2 = await fetch(`${SAFETY_API}/api/v1/token/${addr}/safety?fresh=true`, { signal: ctrl2.signal, cache: 'no-store' })
        clearTimeout(t2)
        if (!res2.ok) throw new Error(`API ${res2.status}`)
        const json2 = await res2.json()
        const d2 = json2.data
        applyPayload(d2, 'dashboard_fresh')
        if (d2?.scam_analysis?.signals) {
          setScamAnalysis(d2.scam_analysis)
        }
        if (d2?.honeypot) setHpData(d2.honeypot)
        else if (d2 && d2.is_honeypot !== undefined) {
          setHpData({
            is_honeypot: d2.is_honeypot,
            buy_tax_pct: d2.buy_tax_pct ?? null,
            sell_tax_pct: d2.sell_tax_pct ?? null,
            transfer_tax_pct: null, buy_gas: null, sell_gas: null,
            max_tx_amount: null, max_wallet_amount: null,
            dynamic_tax: false, tax_by_amount: null,
            flags: [], router: null, error: null,
          })
        } else {
          setHpError(t.safety.no_honeypot_data)
        }
      } catch {
        setHpError(t.safety.api_unavailable)
      }
      setHpLoading(false)
    }

    runAnalysis()
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const raw = searchAddress.trim()

    // If it's a valid address, analyze directly
    if (/^0x[0-9a-f]{40}$/i.test(raw)) {
      analyzeAddress(raw)
      return
    }

    // If there are suggestions, pick the first one
    if (checkerSuggestions.length > 0) {
      selectCheckerToken(checkerSuggestions[0])
      return
    }

    // Try to find by name/symbol
    if (raw.length >= 2) {
      const { data } = await supabase
        .from('pulsechain_tokens')
        .select('address, symbol, name')
        .or(`symbol.ilike.%${raw}%,name.ilike.%${raw}%`)
        .limit(1)
      if (data && data.length > 0) {
        selectCheckerToken(data[0])
        return
      }
    }

    // Nothing found
    setHpError(t.safety.no_token_found)
  }

  function setTab(tab: string) {
    setSearchParams(tab === 'scanner' ? {} : { tab })
  }

  const filteredScores = scores.filter(s => {
    if (filter === 'safe') return s.score >= 60
    if (filter === 'risky') return s.score < 60
    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      const token = tokenNames[s.token_address]
      const sym = token?.symbol?.toLowerCase() || ''
      const name = token?.name?.toLowerCase() || ''
      const addr = s.token_address.toLowerCase()
      if (!sym.includes(q) && !name.includes(q) && !addr.includes(q)) return false
    }
    return true
  })

  const filteredAlerts = alerts.filter(a => {
    if (alertFilter === 'all') return true
    return a.alert_type === alertFilter
  })

  // Last alert timestamp for "last scan" indicator
  const lastAlertTime = alerts.length > 0 ? alerts[0].created_at : null

  return (
    <div className="space-y-6">
      {/* Hero header */}
      <div className="rounded-2xl border border-white/5 bg-gradient-to-br from-cyan-500/5 via-purple-500/5 to-blue-500/5 backdrop-blur-sm p-5 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-xl bg-cyan-400/10 border border-cyan-400/20">
                <Shield className="h-6 w-6 text-[#00D4FF]" />
              </div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-[#00D4FF] to-[#8000E0] bg-clip-text text-transparent">
                {t.safety.title}
              </h1>
              <ShareButton title={t.safety.title} text={t.safety.description} />
            </div>
            <p className="text-gray-400 max-w-xl text-sm">
              {t.safety.description}
            </p>
          </div>
        </div>
      </div>

      {/* Honeypot checker input */}
      <div className="rounded-2xl border-2 border-[#00D4FF]/20 bg-gray-900/80 p-5">
        <form onSubmit={handleSearch} className="relative flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-500" />
            <input
              type="text"
              value={searchAddress}
              onChange={e => { setSearchAddress(e.target.value); setHpError(null); searchCheckerTokens(e.target.value) }}
              onKeyDown={handleCheckerKeyDown}
              placeholder={t.safety.search_placeholder}
              className="w-full pl-10 pr-4 py-3 rounded-xl bg-gray-800 border border-white/10 text-gray-100 placeholder-gray-500 focus:border-[#00D4FF]/50 focus:outline-none transition-colors text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={hpLoading}
            className="px-6 py-3 rounded-xl bg-[#00D4FF]/20 border border-[#00D4FF]/30 text-[#00D4FF] font-bold hover:bg-[#00D4FF]/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 whitespace-nowrap"
          >
            {hpLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Shield className="h-5 w-5" />}
            {hpLoading ? t.safety.analyzing : t.safety.analyze_button}
          </button>
          {checkerSuggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 z-50 border border-white/10 rounded-xl overflow-hidden bg-gray-900 backdrop-blur-xl shadow-2xl">
              {checkerSuggestions.map((token, i) => (
                <button
                  key={token.address}
                  type="button"
                  onClick={() => selectCheckerToken(token)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    i === checkerSelectedIdx ? 'bg-[#8000E0]/20 text-white' : 'text-gray-300 hover:bg-white/5'
                  } ${i > 0 ? 'border-t border-white/5' : ''}`}
                >
                  <TokenLogo address={token.address} />
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-sm">{token.symbol}</span>
                    {token.name && <span className="text-gray-500 text-xs ml-2">{token.name}</span>}
                  </div>
                  <span className="text-[10px] text-gray-600 font-mono shrink-0">{token.address.slice(0, 6)}...{token.address.slice(-4)}</span>
                </button>
              ))}
            </div>
          )}
        </form>
        {hpError && !hpOpen && (
          <p className="mt-2 text-sm text-red-400">{hpError}</p>
        )}
      </div>

      {/* Explainer (shown when no analysis is active) */}
      {!hpOpen && !hpLoading && (
        <div className="space-y-6 text-center">
          <div className="rounded-xl border border-white/5 bg-gray-900/40 p-6">
            <p className="text-sm text-gray-400">
              {t.safety.explainer_text}
            </p>
            <p className="text-sm text-amber-500/70 mt-3">
              {t.safety.honeypot_disclaimer}
            </p>
          </div>
        </div>
      )}

      {/* Inline honeypot results (no popup) */}
      {hpOpen && !hpLoading && (hpData || hpError) && (
        <div className="space-y-4 animate-in fade-in-0 slide-in-from-bottom-2">
          {/* Token info bar */}
          {hpToken && (
            <div className="flex items-center justify-between px-2">
              <div className="flex items-center gap-2">
                <TokenLogo address={hpAddr} />
                <span className="text-white font-bold text-lg">{hpToken.symbol}</span>
                {hpToken.name && <span className="text-gray-500 text-sm">{hpToken.name}</span>}
                <Link
                  to={`/token/${hpAddr}`}
                  className="text-[10px] text-[#00D4FF]/60 hover:text-[#00D4FF] ml-2 flex items-center gap-0.5"
                >
                  {t.safety.full_report_link} <ExternalLink className="h-2.5 w-2.5" />
                </Link>
              </div>
              <button onClick={() => setHpOpen(false)} className="text-gray-500 hover:text-white text-sm">&times; {t.safety.close}</button>
            </div>
          )}

          {hpError ? (
            <div className="text-center py-6 space-y-3 rounded-xl border border-white/5 bg-gray-900/50">
              <XCircle className="h-8 w-8 text-red-400 mx-auto" />
              <p className="text-sm text-gray-400">{hpError}</p>
              <Link to={`/token/${hpAddr}`} className="inline-flex items-center gap-1.5 text-sm text-[#00D4FF] hover:underline">
                {t.safety.full_report_link} <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
          ) : hpData ? (() => {
            const hp = hpData
            return (
              <div className="space-y-4">
                <SafetyVerdictGrid
                  hp={hp}
                  scam={scamAnalysis}
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

                {/* Scam signals pills */}
                {scamAnalysis && scamAnalysis.signals.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {scamAnalysis.signals.map((s, i) => (
                      <span
                        key={i}
                        className={`text-xs px-2.5 py-1 rounded-full border font-medium ${SCAM_SEVERITY_PILL[s.severity] || SCAM_SEVERITY_PILL.medium}`}
                      >
                        {SCAM_SIGNAL_LABELS[s.signal] || s.signal.replace(/_/g, ' ')} — {s.detail}
                      </span>
                    ))}
                  </div>
                )}

                {/* Tax grid */}
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: t.safety.buy_tax, value: hp.buy_tax_pct, color: (v: number) => v > 10 ? 'text-orange-400' : 'text-white' },
                    { label: t.safety.sell_tax, value: hp.sell_tax_pct, color: (v: number) => v > 10 ? 'text-red-400' : 'text-white' },
                    { label: t.safety.transfer_tax, value: hp.transfer_tax_pct, color: (v: number) => v > 0 ? 'text-amber-400' : 'text-white' },
                  ].map(tx => (
                    <div key={tx.label} className="rounded-lg bg-gray-800/60 border border-white/5 p-3 text-center">
                      <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">{tx.label}</div>
                      <div className={`text-xl font-bold ${tx.value != null ? tx.color(tx.value) : 'text-gray-600'}`}>
                        {tx.value != null ? `${tx.value}%` : '-'}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Gas */}
                {(hp.buy_gas != null || hp.sell_gas != null) && (
                  <div className="rounded-lg bg-gray-800/40 border border-white/5 p-3 grid grid-cols-2 gap-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-400">{t.safety.buy_gas}</span>
                      <span className={hp.buy_gas && hp.buy_gas > 2_000_000 ? 'text-orange-400' : 'text-gray-300'}>
                        {hp.buy_gas?.toLocaleString('en-US') ?? '-'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">{t.safety.sell_gas}</span>
                      <span className={hp.sell_gas && hp.sell_gas > 3_500_000 ? 'text-red-400' : 'text-gray-300'}>
                        {hp.sell_gas?.toLocaleString('en-US') ?? '-'}
                      </span>
                    </div>
                  </div>
                )}

                {/* Limits */}
                {(hp.max_tx_amount || hp.max_wallet_amount) && (
                  <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 space-y-1">
                    <h4 className="text-xs font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5" /> {t.safety.limits_title}
                    </h4>
                    <div className="space-y-1 text-sm">
                      {hp.max_tx_amount && <div className="flex justify-between"><span className="text-gray-400">{t.safety.max_transaction}</span><span className="text-amber-300 font-mono text-xs">{hp.max_tx_amount}</span></div>}
                      {hp.max_wallet_amount && <div className="flex justify-between"><span className="text-gray-400">{t.safety.max_wallet}</span><span className="text-amber-300 font-mono text-xs">{hp.max_wallet_amount}</span></div>}
                    </div>
                  </div>
                )}

                {/* Flags */}
                {(hp.flags ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {hp.flags.map((flag, i) => (
                      <span key={i} className={`text-xs px-2.5 py-1 rounded-full border font-medium ${
                        ['honeypot', 'extreme_tax'].includes(flag) ? 'bg-red-500/15 text-red-400 border-red-500/30'
                          : ['high_buy_tax', 'high_sell_tax', 'high_gas', 'dynamic_tax'].includes(flag) ? 'bg-orange-500/15 text-orange-400 border-orange-500/30'
                          : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                      }`}>
                        {flag.replace(/_/g, ' ')}
                      </span>
                    ))}
                  </div>
                )}

                {/* Footer */}
                <div className="flex items-center justify-between text-[10px] text-gray-500">
                  <span>{t.safety.router_label} {hp.router ?? t.safety.unknown} | {t.safety.router_via}</span>
                  <span className="text-amber-500/70">{t.safety.honeypot_disclaimer}</span>
                </div>

                {/* Full report link */}
                <div className="text-center">
                  <Link
                    to={`/token/${hpAddr}`}
                    className="inline-flex items-center gap-2 text-sm font-semibold text-[#00D4FF] hover:text-white rounded-lg border border-[#00D4FF]/30 bg-[#00D4FF]/5 hover:bg-[#00D4FF]/10 px-6 py-2.5 transition-colors"
                  >
                    {t.safety.full_report_link} <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            )
          })() : null}
        </div>
      )}

      {/* Loading spinner for analysis */}
      {hpOpen && hpLoading && (
        <div className="flex flex-col items-center justify-center py-8 gap-3 rounded-xl border border-white/5 bg-gray-900/50">
          <Loader2 className="h-8 w-8 animate-spin text-[#00D4FF]" />
          <span className="text-sm text-gray-400 animate-pulse">{t.safety.simulation_loading}</span>
        </div>
      )}

      {/* Tab switcher: Scanner / Alerts */}
      <div className="flex gap-2 border-b border-white/5 pb-1">
        <button
          onClick={() => setTab('scanner')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-t-lg text-sm font-medium transition-colors ${
            activeTab === 'scanner'
              ? 'bg-[#8000E0]/20 text-[#00D4FF] border border-[#8000E0]/30 border-b-0'
              : 'text-gray-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <Shield className="h-4 w-4" />
          {t.safety.tab_scanner}
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 text-gray-500">{stats.total.toLocaleString('en-US')}</span>
        </button>
        <button
          onClick={() => setTab('alerts')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-t-lg text-sm font-medium transition-colors ${
            activeTab === 'alerts'
              ? 'bg-[#8000E0]/20 text-[#00D4FF] border border-[#8000E0]/30 border-b-0'
              : 'text-gray-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <AlertTriangle className="h-4 w-4" />
          {t.safety.tab_alerts}
          {alerts.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-500/15 text-orange-400 border border-orange-500/20">
              {alerts.length}
            </span>
          )}
        </button>
      </div>

      {/* ═══ SCANNER TAB ═══ */}
      {activeTab === 'scanner' && (
        <>
          {/* Stats — partition (Total/Safe/Risky) + risky subsets (Honeypots/Scams) */}
          {(() => {
            const pct = (n: number) => stats.total > 0 ? `${Math.round((n / stats.total) * 100)}%` : ''
            return (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                <div className="rounded-xl border border-white/5 bg-gray-900/50 p-4 text-center">
                  <p className="text-2xl font-bold">{stats.total.toLocaleString('en-US')}</p>
                  <p className="text-xs text-gray-400 mt-1">{t.safety.stats_analyzed}</p>
                </div>
                <div className="rounded-xl border border-emerald-500/10 bg-emerald-500/5 p-4 text-center">
                  <p className="text-2xl font-bold text-emerald-400">{stats.safe.toLocaleString('en-US')}</p>
                  <p className="text-xs text-gray-400 mt-1">{t.safety.stats_safe} <span className="text-gray-500">· {pct(stats.safe)}</span></p>
                </div>
                <div className="rounded-xl border border-orange-500/10 bg-orange-500/5 p-4 text-center">
                  <p className="text-2xl font-bold text-orange-400">{stats.risky.toLocaleString('en-US')}</p>
                  <p className="text-xs text-gray-400 mt-1">{t.safety.stats_risky} <span className="text-gray-500">· {pct(stats.risky)}</span></p>
                </div>
                <div
                  className="rounded-xl border border-amber-500/15 bg-amber-500/5 p-4 text-center cursor-help"
                  title={t.safety.stats_tooltip_honeypots}
                >
                  <p className="text-2xl font-bold text-amber-400">{stats.honeypots.toLocaleString('en-US')}</p>
                  <p className="text-xs text-gray-400 mt-1">{t.safety.stats_honeypots} <span className="text-gray-500">· {pct(stats.honeypots)}</span></p>
                </div>
                <div
                  className="rounded-xl border border-red-500/25 bg-red-500/10 p-4 text-center cursor-help"
                  title={t.safety.stats_tooltip_scams}
                >
                  <p className="text-2xl font-bold text-red-400">{stats.scams.toLocaleString('en-US')}</p>
                  <p className="text-xs text-gray-400 mt-1">{t.safety.stats_scams} <span className="text-gray-500">· {pct(stats.scams)}</span></p>
                </div>
              </div>
            )
          })()}

          {/* Filter tabs + search */}
          <div className="flex items-center gap-2 flex-wrap">
            {[
              { id: 'all', label: t.common.all },
              { id: 'safe', label: t.safety.filter_safe },
              { id: 'risky', label: t.safety.filter_risky },
            ].map(f => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  filter === f.id
                    ? 'bg-[#8000E0]/20 text-[#00D4FF] border border-[#8000E0]/30'
                    : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
              >
                {f.label}
              </button>
            ))}
            <button
              onClick={() => setMethodologyOpen(true)}
              className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs text-gray-400 hover:text-[#00D4FF] border border-white/10 hover:border-[#00D4FF]/30 bg-white/[0.02] transition-colors"
              title="How grades are calculated"
            >
              <Info className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Scoring methodology</span>
            </button>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
              <input
                type="text"
                placeholder={t.safety.filter_search_placeholder}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#00D4FF]/50 w-48"
              />
            </div>
          </div>

          {/* Table */}
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-[#00D4FF]" />
            </div>
          ) : filteredScores.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <Shield className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>{t.safety.no_scores}</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-white/5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5 bg-gray-900/50">
                    <th className="text-left px-4 py-3 text-gray-400 font-medium">{t.safety.table_token}</th>
                    <th className="text-center px-4 py-3 text-gray-400 font-medium">{t.common.score}</th>
                    <th className="text-center px-4 py-3 text-gray-400 font-medium">{t.common.grade}</th>
                    <th className="text-center px-4 py-3 text-gray-400 font-medium">{t.safety.table_honeypot}</th>
                    <th className="text-right px-4 py-3 text-gray-400 font-medium">{t.common.liquidity}</th>
                    <th className="text-right px-4 py-3 text-gray-400 font-medium">{t.common.holders}</th>
                    <th className="text-center px-4 py-3 text-gray-400 font-medium">{t.safety.table_tax}</th>
                    <th className="text-right px-4 py-3 text-gray-400 font-medium">{t.safety.table_risks}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredScores.map(entry => {
                    const token = tokenNames[entry.token_address]
                    return (
                      <tr
                        key={entry.token_address}
                        className="border-b border-white/5 hover:bg-white/5 cursor-pointer transition-colors"
                        onClick={() => navigate(`/token/${entry.token_address}`)}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <TokenLogo address={entry.token_address} />
                            <div>
                              <div className="font-medium">{token?.symbol || entry.token_address.slice(0, 10) + '...'}</div>
                              {token && <div className="text-xs text-gray-500">{token.name}</div>}
                            </div>
                          </div>
                        </td>
                        <td className="text-center px-4 py-3 font-bold">{entry.score}</td>
                        <td className="text-center px-4 py-3">
                          <span className={`inline-block w-8 text-center rounded border text-xs font-bold py-0.5 ${GRADE_COLORS[entry.grade]}`}>
                            {entry.grade}
                          </span>
                        </td>
                        <td className="text-center px-4 py-3">
                          {entry.is_honeypot === true ? (
                            <XCircle className="h-5 w-5 text-red-400 mx-auto" />
                          ) : entry.is_honeypot === false ? (
                            <CheckCircle className="h-5 w-5 text-emerald-400 mx-auto" />
                          ) : (
                            <span className="text-gray-500">?</span>
                          )}
                        </td>
                        <td className="text-right px-4 py-3">${(entry.total_liquidity_usd || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}</td>
                        <td className="text-right px-4 py-3">{(entry.holder_count || 0).toLocaleString('en-US')}</td>
                        <td className="text-center px-4 py-3 text-xs">
                          {entry.buy_tax_pct != null || entry.sell_tax_pct != null ? (
                            <span className={
                              (entry.sell_tax_pct || 0) > 10 ? 'text-red-400' :
                              (entry.sell_tax_pct || 0) > 5 ? 'text-orange-400' : 'text-gray-400'
                            }>
                              {entry.buy_tax_pct ?? '?'}/{entry.sell_tax_pct ?? '?'}%
                            </span>
                          ) : '-'}
                        </td>
                        <td className="text-right px-4 py-3">
                          {entry.risks?.length > 0 ? (
                            <span className="inline-flex items-center gap-1 text-orange-400">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              {entry.risks.length}
                            </span>
                          ) : (
                            <CheckCircle className="h-4 w-4 text-emerald-400 inline" />
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ═══ ALERTS TAB ═══ */}
      {activeTab === 'alerts' && (
        <>
          {/* Last scan indicator */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              {t.safety.alerts_description}
            </p>
            <div className="flex items-center gap-1.5 text-xs text-gray-500 whitespace-nowrap">
              {lastAlertTime ? (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                  </span>
                  <span>{t.safety.last_alert} {formatTimeAgo(lastAlertTime)}</span>
                </>
              ) : (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-gray-500" />
                  </span>
                  <span>{t.safety.no_recent_alerts}</span>
                </>
              )}
              <span className="text-gray-600 ml-1">| {t.safety.auto_refresh_note}</span>
            </div>
          </div>

          {/* Alert filter tabs */}
          <div className="flex gap-2 flex-wrap">
            {[
              { id: 'all', label: t.common.all },
              { id: 'honeypot', label: t.safety.filter_honeypots },
              { id: 'lp_removal', label: t.safety.filter_lp_removals },
              { id: 'whale_dump', label: t.safety.filter_whale_dumps },
              { id: 'mint_event', label: t.safety.filter_suspicious_mints },
              { id: 'flagged_activity', label: `Flagged Wallets${flaggedCount ? ` (${flaggedCount.toLocaleString('en-US')})` : ''}` },
            ].map(f => (
              <button
                key={f.id}
                onClick={() => setAlertFilter(f.id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  alertFilter === f.id
                    ? 'bg-[#8000E0]/20 text-[#00D4FF] border border-[#8000E0]/30'
                    : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Flagged Wallets database view */}
          {alertFilter === 'flagged_activity' && filteredAlerts.length === 0 && flaggedWallets.length > 0 ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-[#8000E0]/20 bg-[#8000E0]/5 p-4 mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="h-5 w-5 text-[#00D4FF]" />
                  <span className="font-medium text-[#00D4FF]">{flaggedCount.toLocaleString('en-US')} wallets monitored</span>
                </div>
                <p className="text-sm text-gray-400">
                  Sources: OFAC, ScamSniffer, eth-labels, Forta, Intel. Active monitoring on PulseChain — alerts appear when flagged wallets transact.
                </p>
              </div>
              {flaggedWallets.map((w, i) => (
                <div
                  key={`${w.address}-${i}`}
                  className="rounded-xl border border-white/5 bg-gray-900/50 p-4 hover:bg-gray-900/70 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-lg border ${
                      w.risk_level === 'CRITICAL' ? 'bg-red-500/20 text-red-300 border-red-500/40' :
                      w.risk_level === 'HIGH' ? 'bg-orange-500/20 text-orange-300 border-orange-500/40' :
                      'bg-yellow-500/20 text-yellow-300 border-yellow-500/40'
                    }`}>
                      <Shield className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-sm">{w.label || w.category}</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs border ${
                          w.risk_level === 'CRITICAL' ? 'bg-red-500/20 text-red-300 border-red-500/40' :
                          'bg-orange-500/20 text-orange-300 border-orange-500/40'
                        }`}>
                          {w.risk_level}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-xs border ${
                          w.source === 'intelligence_study' ? 'bg-[#8000E0]/20 text-[#00D4FF] border-[#8000E0]/40' :
                          w.source === 'ofac' ? 'bg-red-500/20 text-red-300 border-red-500/40' :
                          w.source === 'scamsniffer' ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' :
                          'bg-gray-700/50 text-gray-400 border-gray-600/30'
                        }`}>
                          {w.source === 'intelligence_study' ? 'PulseChain Intel' :
                           w.source === 'ofac' ? 'OFAC Sanctioned' :
                           w.source === 'scamsniffer' ? 'ScamSniffer' :
                           w.source === 'eth_labels' ? 'eth-labels' :
                           w.source}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 font-mono truncate">{w.address}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : alertsLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-[#00D4FF]" />
            </div>
          ) : filteredAlerts.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <Shield className="h-12 w-12 mx-auto mb-3 text-emerald-400/30" />
              <p className="text-lg font-medium text-gray-400">{t.safety.no_alerts_message}</p>
              <p className="text-sm mt-1">{t.safety.no_alerts_hint}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredAlerts.map(alert => {
                const data = typeof alert.data === 'string' ? JSON.parse(alert.data) : alert.data
                return (
                  <div
                    key={alert.id}
                    className="rounded-xl border border-white/5 bg-gray-900/50 p-4 hover:bg-gray-900/70 transition-colors cursor-pointer"
                    onClick={() => {
                      const tokenAddr = (data.token0_address || data.token_address || alert.token_address) as string | undefined
                      if (tokenAddr) navigate(`/token/${tokenAddr}`)
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-lg border ${SEVERITY_STYLES[alert.severity] || SEVERITY_STYLES.medium}`}>
                        {TYPE_ICONS[alert.alert_type] || <AlertTriangle className="h-4 w-4" />}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium">
                            {({
                              honeypot: t.safety.alert_honeypot,
                              lp_removal: t.safety.type_lp_removal,
                              whale_dump: t.safety.type_whale_dump,
                              mint_event: t.safety.filter_suspicious_mints,
                              flagged_activity: 'Flagged Wallet Activity',
                            } as Record<string, string>)[alert.alert_type] || alert.alert_type}
                          </span>
                          <span className={`px-2 py-0.5 rounded-full text-xs border ${SEVERITY_STYLES[alert.severity]}`}>
                            {({
                              critical: t.safety.severity_critical,
                              high: t.safety.severity_high,
                              medium: t.safety.severity_medium,
                              low: t.safety.severity_low,
                            } as Record<string, string>)[alert.severity] || alert.severity}
                          </span>
                        </div>

                        {alert.alert_type === 'lp_removal' && (
                          <p className="text-sm text-gray-400">
                            <span className="text-gray-200">${Number(data.amount_usd || 0).toLocaleString('en-US')}</span> {t.safety.lp_removed_from}
                            {data.pct_of_pool ? <span className="text-red-400 font-medium"> ({data.pct_of_pool as number}% {t.safety.of_pool})</span> : null}
                            {' '}<span className="text-gray-200">{data.token0_symbol as string}/{data.token1_symbol as string}</span> {t.safety.lp_on_dex} {data.dex as string}
                          </p>
                        )}

                        {alert.alert_type === 'whale_dump' && (
                          <p className="text-sm text-gray-400">
                            <span className="text-gray-200">{data.pct_of_supply as string}%</span> {t.safety.whale_supply_pct}
                          </p>
                        )}

                        {alert.alert_type === 'flagged_activity' && (
                          <div className="text-sm text-gray-400">
                            <span className="text-red-400 font-medium">{data.label as string}</span>
                            {' — '}{data.tx_count as number} tx, {data.transfer_count as number} transfers
                            {(data.tokens_involved as string[] || []).length > 0 && (
                              <span className="text-gray-300"> ({(data.tokens_involved as string[]).join(', ')})</span>
                            )}
                          </div>
                        )}

                        {alert.alert_type === 'honeypot' && (
                          <p className="text-sm text-gray-400">
                            Token <span className="text-gray-200">{data.token_symbol as string}</span> detected as honeypot (score {data.score as number}/100)
                          </p>
                        )}

                        {alert.alert_type === 'mint_event' && (
                          <p className="text-sm text-gray-400">
                            <span className="text-gray-200">{data.pct_of_supply as string}%</span> of supply minted on <span className="text-gray-200">{data.token_symbol as string}</span>
                          </p>
                        )}

                        {data.sender && (
                          <p className="text-xs text-gray-500 font-mono mt-1 truncate">
                            {t.safety.by_label} {data.sender as string}
                          </p>
                        )}

                        {data.flagged_address && (
                          <p className="text-xs text-gray-500 font-mono mt-1 truncate">
                            {data.flagged_address as string}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-1 text-xs text-gray-500 whitespace-nowrap">
                        <Clock className="h-3 w-3" />
                        {formatTimeAgo(alert.created_at)}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* Scoring methodology modal */}
      <ScoringMethodologyModal open={methodologyOpen} onClose={() => setMethodologyOpen(false)} />
    </div>
  )
}
