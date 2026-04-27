import { useState } from 'react'
import { Search, Loader2, ExternalLink, Shield, X } from 'lucide-react'
import { getTokenSafety, gradeColor, type SafetyScore } from '../../lib/api'
import { formatUsd, shortenAddress } from '../../lib/format'
import { WalletDetailView } from './WalletDetailView'

type ResultType = 'token' | 'wallet' | null

export function Explorer() {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [resultType, setResultType] = useState<ResultType>(null)
  const [safety, setSafety] = useState<SafetyScore | null>(null)
  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSearch = async () => {
    const addr = input.trim().toLowerCase()
    if (!addr.match(/^0x[a-f0-9]{40}$/)) {
      setError('Enter a valid address (0x...)')
      return
    }
    setLoading(true)
    setError(null)
    setSafety(null)
    setWalletAddress(null)
    setResultType(null)

    // Try as token first — but skip if the Safety API reports it's an EOA
    // (the backend returns a score + "Not a smart contract" risk for wallets)
    try {
      const result = await getTokenSafety(addr)
      const isEOA = Array.isArray(result?.risks) && result!.risks.some(
        (r) => typeof r === 'string' && r.toLowerCase().includes('not a smart contract')
      )
      if (result && result.score != null && !isEOA) {
        setSafety(result)
        setResultType('token')
        setLoading(false)
        return
      }
    } catch {
      // Not a token, fall through to wallet view
    }

    // Wallet path — reuse the shared WalletDetailView component so the
    // exact same backend pipeline + rendering as the native Wallet tab
    // runs inline inside Explorer.
    setWalletAddress(addr)
    setResultType('wallet')
    setLoading(false)
  }

  const clearResult = () => {
    setResultType(null)
    setSafety(null)
    setWalletAddress(null)
    setError(null)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <Search className="h-4 w-4 text-pulse-cyan" />
        <h2 className="text-sm font-semibold text-white">Explorer</h2>
      </div>

      <p className="text-xs text-gray-500">
        Search any PulseChain address — auto-detects tokens vs wallets.
      </p>

      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Token or wallet address (0x...)"
          className="flex-1 bg-gray-800/60 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-pulse-cyan/50"
        />
        <button
          onClick={handleSearch}
          disabled={loading}
          className="px-3 py-2 rounded-lg bg-gradient-to-r from-pulse-cyan to-pulse-purple text-white text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
        </button>
      </div>

      {error && <div className="text-xs text-red-400 bg-red-500/10 rounded-lg p-2">{error}</div>}

      {/* Token result */}
      {resultType === 'token' && safety && (
        <div className="space-y-2">
          <div className="flex items-center justify-between bg-gray-800/40 rounded-xl p-3 border border-white/5">
            <div>
              <div className="flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5" style={{ color: gradeColor(safety.grade) }} />
                <span className="text-xs font-medium text-white">
                  {safety.token_symbol || shortenAddress(safety.token_address)}
                </span>
              </div>
              <div className="text-xs text-gray-500 mt-0.5">{safety.token_name}</div>
            </div>
            <div className="text-right">
              <div className="text-xl font-bold" style={{ color: gradeColor(safety.grade) }}>
                {safety.grade}
              </div>
              <div className="text-xs text-gray-400">{safety.score}/100</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5 text-xs">
            <div className="bg-gray-800/30 rounded-md p-2">
              <div className="text-xs text-gray-500">Liquidity</div>
              <div className="text-white">{formatUsd(safety.total_liquidity_usd)}</div>
            </div>
            <div className="bg-gray-800/30 rounded-md p-2">
              <div className="text-xs text-gray-500">Holders</div>
              <div className="text-white">{(safety.holder_count ?? 0).toLocaleString('en-US')}</div>
            </div>
            <div className="bg-gray-800/30 rounded-md p-2">
              <div className="text-xs text-gray-500">Age</div>
              <div className="text-white">{safety.age_days ?? 0} days</div>
            </div>
            <div className="bg-gray-800/30 rounded-md p-2">
              <div className="text-xs text-gray-500">Honeypot</div>
              <div className={safety.is_honeypot ? 'text-red-400 font-medium' : 'text-emerald-400'}>
                {safety.is_honeypot ? 'YES' : 'No'}
              </div>
            </div>
          </div>

          {safety.risks?.length > 0 && (
            <div className="space-y-1">
              {safety.risks.slice(0, 3).map((r, i) => (
                <div key={i} className="text-xs text-red-300 bg-red-500/5 rounded px-2 py-1">
                  {r}
                </div>
              ))}
            </div>
          )}

          <a
            href={`https://www.openpulsechain.com/token/${safety.token_address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1 text-xs text-pulse-cyan hover:underline"
          >
            Full report <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}

      {/* Wallet result — reuses the exact same component as the Wallet tab */}
      {resultType === 'wallet' && walletAddress && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-gray-500 uppercase tracking-wider">Wallet detected</span>
            <button
              onClick={clearResult}
              className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-white transition-colors"
              title="Clear result"
            >
              <X className="h-3 w-3" /> Clear
            </button>
          </div>
          <WalletDetailView address={walletAddress} />
        </div>
      )}
    </div>
  )
}
