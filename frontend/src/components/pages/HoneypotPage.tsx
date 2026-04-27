import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Shield, Search, Loader2, AlertTriangle, CheckCircle, XCircle, ExternalLink } from 'lucide-react'

const SAFETY_API = import.meta.env.VITE_SAFETY_API_URL || 'https://safety.openpulsechain.com'
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

interface HoneypotResult {
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

interface TokenMeta {
  symbol: string | null
  name: string | null
  score: number | null
  grade: string | null
}

const GRADE_COLORS: Record<string, string> = {
  A: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  B: 'text-blue-400 border-blue-500/30 bg-blue-500/10',
  C: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  D: 'text-orange-400 border-orange-500/30 bg-orange-500/10',
  F: 'text-red-400 border-red-500/30 bg-red-500/10',
}

const SIGNAL_LABELS: Record<string, string> = {
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

const RISK_CONFIG: Record<ScamAnalysis['risk_level'], { bg: string; border: string; text: string; label: string }> = {
  critical: { bg: 'bg-red-500/20', border: 'border-red-500/40', text: 'text-red-400', label: 'CRITICAL RISK \u2014 Likely Scam' },
  high: { bg: 'bg-orange-500/20', border: 'border-orange-500/40', text: 'text-orange-400', label: 'HIGH RISK' },
  medium: { bg: 'bg-yellow-500/15', border: 'border-yellow-500/40', text: 'text-yellow-400', label: 'MEDIUM RISK' },
  low: { bg: 'bg-emerald-500/15', border: 'border-emerald-500/30', text: 'text-emerald-400', label: 'LOW RISK' },
}

const SEVERITY_PILL: Record<ScamSignal['severity'], string> = {
  critical: 'bg-red-500/15 text-red-400 border-red-500/30',
  high: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  medium: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
  low: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
}

export function HoneypotPage() {
  const navigate = useNavigate()
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<HoneypotResult | null>(null)
  const [meta, setMeta] = useState<TokenMeta | null>(null)
  const [scamAnalysis, setScamAnalysis] = useState<ScamAnalysis | null>(null)
  const [checkedAddress, setCheckedAddress] = useState<string | null>(null)

  const handleCheck = async () => {
    const addr = input.trim().toLowerCase()
    if (!ADDRESS_RE.test(addr)) {
      setError('Enter a valid PulseChain token address (0x...)')
      return
    }
    setError(null)
    setResult(null)
    setMeta(null)
    setScamAnalysis(null)
    setLoading(true)
    setCheckedAddress(addr)

    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 30000)
      const res = await fetch(`${SAFETY_API}/api/v1/token/${addr}/safety?fresh=true`, { signal: ctrl.signal, cache: 'no-store' })
      clearTimeout(t)
      if (!res.ok) throw new Error(`API error ${res.status}`)
      const json = await res.json()
      const hp = json.data?.honeypot
      if (!hp) throw new Error('No honeypot data returned')
      setResult(hp)
      setMeta({
        symbol: json.data?.token_symbol ?? null,
        name: json.data?.token_name ?? null,
        score: json.data?.score ?? null,
        grade: json.data?.grade ?? null,
      })
      if (json.data?.scam_analysis) {
        setScamAnalysis(json.data.scam_analysis)
      }
    } catch (e: any) {
      setError(e.message || 'Analysis failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-8 max-w-3xl mx-auto">
      {/* Hero */}
      <div className="text-center space-y-4 pt-8">
        <div className="flex items-center justify-center gap-3">
          <Shield className="h-10 w-10 text-[#00D4FF]" />
          <h1 className="text-4xl font-black bg-gradient-to-r from-[#00D4FF] to-[#8000E0] bg-clip-text text-transparent">
            Honeypot Checker
          </h1>
        </div>
        <p className="text-gray-400 text-lg max-w-xl mx-auto">
          Detect honeypot tokens on PulseChain. Simulates a buy and sell transaction on-chain to determine if a token can actually be sold.
        </p>
      </div>

      {/* Input */}
      <div className="rounded-2xl border-2 border-[#00D4FF]/20 bg-gray-900/80 p-6 space-y-4">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-500" />
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCheck()}
              placeholder="Enter token address (0x...)"
              className="w-full pl-10 pr-4 py-3 rounded-xl bg-gray-800 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-[#00D4FF]/50 font-mono text-sm"
            />
          </div>
          <button
            onClick={handleCheck}
            disabled={loading}
            className="px-6 py-3 rounded-xl bg-[#00D4FF]/20 border border-[#00D4FF]/30 text-[#00D4FF] font-bold hover:bg-[#00D4FF]/30 transition-colors disabled:opacity-50 flex items-center gap-2 whitespace-nowrap"
          >
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Shield className="h-5 w-5" />}
            {loading ? 'Checking...' : 'CHECK FOR HONEYPOT'}
          </button>
        </div>
        {error && (
          <p className="text-red-400 text-sm flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4" /> {error}
          </p>
        )}
      </div>

      {/* Results */}
      {result && checkedAddress && (
        <div className="space-y-5 animate-in fade-in-0 slide-in-from-bottom-2">
          {/* Token info bar */}
          {meta && (
            <div className="flex items-center justify-between px-4">
              <div className="flex items-center gap-2">
                <span className="text-white font-bold text-lg">{meta.symbol || '???'}</span>
                {meta.name && <span className="text-gray-500 text-sm">{meta.name}</span>}
                <button
                  onClick={() => navigate(`/token/${checkedAddress}`)}
                  className="text-[10px] text-[#00D4FF]/60 hover:text-[#00D4FF] ml-2 flex items-center gap-0.5"
                >
                  Full safety report <ExternalLink className="h-2.5 w-2.5" />
                </button>
              </div>
              {meta.grade && (
                <span className={`px-2.5 py-0.5 rounded-lg border text-sm font-bold ${GRADE_COLORS[meta.grade] || ''}`}>
                  {meta.score}/100 — Grade {meta.grade}
                </span>
              )}
            </div>
          )}

          {/* Dual Verdict: Honeypot + Scam side by side */}
          <div className={`grid gap-3 ${scamAnalysis && (scamAnalysis.signals.length > 0 || scamAnalysis.scam_score >= 50) ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {/* Honeypot verdict */}
            <div className={`rounded-2xl px-6 py-5 text-center ${
              result.is_honeypot === true
                ? 'bg-red-500/20 border-2 border-red-500/40'
                : result.is_honeypot === false
                  ? 'bg-emerald-500/15 border-2 border-emerald-500/30'
                  : 'bg-gray-700/30 border-2 border-gray-600/30'
            }`}>
              <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Honeypot Check</div>
              <div className={`text-xl font-black tracking-wide ${
                result.is_honeypot === true ? 'text-red-400' : result.is_honeypot === false ? 'text-emerald-400' : 'text-gray-400'
              }`}>
                {result.is_honeypot === true ? 'HONEYPOT' : result.is_honeypot === false ? 'NOT A HONEYPOT' : 'INCONCLUSIVE'}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {result.is_honeypot === true
                  ? 'Cannot be sold'
                  : result.is_honeypot === false
                    ? 'Can be bought and sold'
                    : 'Manual verification needed'}
              </p>
            </div>

            {/* Scam risk verdict */}
            {scamAnalysis && (scamAnalysis.signals.length > 0 || scamAnalysis.scam_score >= 50) && (() => {
              const risk = RISK_CONFIG[scamAnalysis.risk_level]
              return (
                <div className={`rounded-2xl px-6 py-5 text-center ${risk.bg} border-2 ${risk.border}`}>
                  <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Scam Analysis</div>
                  <div className={`text-xl font-black tracking-wide ${risk.text}`}>
                    {risk.label}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Scam Score: {scamAnalysis.scam_score}/100
                  </p>
                </div>
              )
            })()}
          </div>

          {/* Scam signals pills */}
          {scamAnalysis && scamAnalysis.signals.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {scamAnalysis.signals.map((s, i) => (
                <span
                  key={i}
                  className={`text-xs px-2.5 py-1 rounded-full border font-medium ${SEVERITY_PILL[s.severity]}`}
                >
                  {SIGNAL_LABELS[s.signal] || s.signal.replace(/_/g, ' ')} — {s.detail}
                </span>
              ))}
            </div>
          )}

          {/* Tax grid */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Buy Tax', value: result.buy_tax_pct, color: (v: number) => v > 10 ? 'text-orange-400' : 'text-white' },
              { label: 'Sell Tax', value: result.sell_tax_pct, color: (v: number) => v > 10 ? 'text-red-400' : 'text-white' },
              { label: 'Transfer Tax', value: result.transfer_tax_pct, color: (v: number) => v > 0 ? 'text-amber-400' : 'text-white' },
            ].map(t => (
              <div key={t.label} className="rounded-xl bg-gray-800/60 border border-white/5 p-4 text-center">
                <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">{t.label}</div>
                <div className={`text-2xl font-bold ${t.value != null ? t.color(t.value) : 'text-gray-600'}`}>
                  {t.value != null ? `${t.value}%` : '-'}
                </div>
              </div>
            ))}
          </div>

          {/* Gas */}
          {(result.buy_gas != null || result.sell_gas != null) && (
            <div className="rounded-xl bg-gray-800/40 border border-white/5 p-4 grid grid-cols-2 gap-4 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Buy Gas</span>
                <span className={result.buy_gas && result.buy_gas > 2_000_000 ? 'text-orange-400' : 'text-gray-300'}>
                  {result.buy_gas?.toLocaleString('en-US') ?? '-'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Sell Gas</span>
                <span className={result.sell_gas && result.sell_gas > 3_500_000 ? 'text-red-400' : 'text-gray-300'}>
                  {result.sell_gas?.toLocaleString('en-US') ?? '-'}
                </span>
              </div>
            </div>
          )}

          {/* Limits */}
          {(result.max_tx_amount || result.max_wallet_amount) && (
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-4 space-y-2">
              <h4 className="text-xs font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" /> Transaction Limits
              </h4>
              <div className="space-y-1 text-sm">
                {result.max_tx_amount && <div className="flex justify-between"><span className="text-gray-400">Max Transaction</span><span className="text-amber-300 font-mono text-xs">{result.max_tx_amount}</span></div>}
                {result.max_wallet_amount && <div className="flex justify-between"><span className="text-gray-400">Max Wallet</span><span className="text-amber-300 font-mono text-xs">{result.max_wallet_amount}</span></div>}
              </div>
            </div>
          )}

          {/* Tax by amount */}
          {result.tax_by_amount && Object.keys(result.tax_by_amount).length > 0 && (
            <div className="rounded-xl bg-gray-800/40 border border-white/5 p-4 space-y-2">
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                Tax by Amount
                {result.dynamic_tax && (
                  <span className="text-[10px] bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full border border-amber-500/30">DYNAMIC TAX</span>
                )}
              </h4>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-white/5">
                    <th className="text-left py-1.5">Amount (PLS)</th>
                    <th className="text-right py-1.5">Buy Tax</th>
                    <th className="text-right py-1.5">Sell Tax</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(result.tax_by_amount).map(([amt, taxes]) => (
                    <tr key={amt} className="border-b border-white/5">
                      <td className="py-1.5 text-gray-300 font-mono">{amt}</td>
                      <td className="py-1.5 text-right">
                        {taxes.error ? <span className="text-gray-600">Failed</span> : taxes.buy_tax != null ? <span className={taxes.buy_tax > 10 ? 'text-orange-400' : 'text-gray-300'}>{taxes.buy_tax}%</span> : <span>-</span>}
                      </td>
                      <td className="py-1.5 text-right">
                        {taxes.error ? <span className="text-gray-600">Failed</span> : taxes.sell_tax != null ? <span className={taxes.sell_tax > 10 ? 'text-red-400' : 'text-gray-300'}>{taxes.sell_tax}%</span> : <span>-</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Holder analysis */}
          {result.holder_analysis && result.holder_analysis.holders_tested > 0 && (
            <div className="rounded-xl bg-gray-800/40 border border-white/5 p-4 space-y-3">
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Holder Sell Analysis</h4>
              <div className="grid grid-cols-4 gap-3 text-center">
                <div>
                  <div className="text-lg font-bold text-white">{result.holder_analysis.holders_tested}</div>
                  <div className="text-[10px] text-gray-500">Tested</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-emerald-400">{result.holder_analysis.successful}</div>
                  <div className="text-[10px] text-gray-500">Can Sell</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-red-400">{result.holder_analysis.failed}</div>
                  <div className="text-[10px] text-gray-500">Blocked</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-amber-400">{result.holder_analysis.siphoned}</div>
                  <div className="text-[10px] text-gray-500">Siphoned</div>
                </div>
              </div>
              {result.holder_analysis.holder_results.length > 0 && (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 border-b border-white/5">
                      <th className="text-left py-1">Holder</th>
                      <th className="text-right py-1">Supply %</th>
                      <th className="text-right py-1">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.holder_analysis.holder_results.slice(0, 10).map((h, i) => (
                      <tr key={i} className="border-b border-white/5">
                        <td className="py-1 font-mono text-gray-400">{h.address.slice(0, 6)}...{h.address.slice(-4)} {h.is_contract ? <span className="text-[9px] text-gray-600 ml-1">Contract</span> : ''}</td>
                        <td className="py-1 text-right text-gray-300">{h.pct_supply?.toFixed(2)}%</td>
                        <td className="py-1 text-right">
                          {h.can_transfer === true ? (
                            <span className="inline-flex items-center gap-0.5 text-emerald-400"><CheckCircle className="h-3 w-3" /> OK</span>
                          ) : h.can_transfer === false ? (
                            <span className="inline-flex items-center gap-0.5 text-red-400"><XCircle className="h-3 w-3" /> Blocked</span>
                          ) : (
                            <span className="text-gray-600">?</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Flags */}
          {result.flags.length > 0 && (
            <div className="rounded-xl bg-gray-800/40 border border-white/5 p-4 space-y-2">
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Warning Flags</h4>
              <div className="flex flex-wrap gap-2">
                {result.flags.map((flag, i) => (
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
          <div className="rounded-xl bg-gray-800/30 border border-white/5 p-4 space-y-2">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Technical Risks & Limitations</h4>
            <ul className="text-[11px] text-gray-600 space-y-1 list-disc list-inside">
              <li>Gas estimation may fail for tokens requiring specific approvals</li>
              <li>Max TX/Wallet detection only works for tokens with public getter functions</li>
              <li>Dynamic tax tests 4 amounts (0.1, 1, 10, 100 PLS) — edge cases possible</li>
              <li>Transfer tax inferred from bytecode — may not capture all implementations</li>
              <li>Holder sell test simulates transfer(), not router swap — a token could allow transfers but block sells</li>
            </ul>
          </div>

          {/* Footer */}
          <div className="text-center space-y-1 pb-4">
            <p className="text-[10px] text-gray-600">
              Router: {result.router ?? 'Unknown'} | Simulated via FeeChecker on PulseX V1 + V2
            </p>
            <p className="text-[10px] text-amber-500/70">
              This is not a foolproof method. Just because it's not a honeypot now, does not mean it won't change.
            </p>
          </div>
        </div>
      )}

      {/* Explainer (shown when no result) */}
      {!result && !loading && (
        <div className="space-y-6 text-center">
          <div className="rounded-xl border border-white/5 bg-gray-900/40 p-6 max-w-xl mx-auto">
            <p className="text-sm text-gray-400">
              Detect honeypot tokens on the PulseChain. Honeypot detector simulates a buy and a sell transaction to determine if the token is a honeypot or not.
              To prevent getting tricked, honeypot detector performs extra checks to minimize false results.
              Detect honeypots on PulseChain with the highest accuracy.
            </p>
            <p className="text-sm text-amber-500/70 mt-3">
              This is not a foolproof method. Just because it's not a honeypot now, does not mean it won't change!
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
