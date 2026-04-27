import { useState, useEffect } from 'react'
import { Users, Loader2, Crown } from 'lucide-react'
import { getHolderLeagues, type LeagueData } from '../../lib/api'

const TIERS = [
  { key: 'poseidon', label: 'Poseidon', emoji: '🌊', pct: 10, color: 'text-amber-400' },
  { key: 'whale', label: 'Whale', emoji: '🐋', pct: 1, color: 'text-purple-400' },
  { key: 'shark', label: 'Shark', emoji: '🦈', pct: 0.1, color: 'text-cyan-400' },
  { key: 'dolphin', label: 'Dolphin', emoji: '🐬', pct: 0.01, color: 'text-blue-400' },
  { key: 'squid', label: 'Squid', emoji: '🦑', pct: 0.001, color: 'text-emerald-400' },
  { key: 'turtle', label: 'Turtle', emoji: '🐢', pct: 0.0001, color: 'text-gray-400' },
] as const

const TOKEN_ORDER = ['PLS', 'PLSX', 'HEX', 'INC', 'PRVX'] as const
const TOKEN_COLORS: Record<string, string> = {
  PLS: '#00D4FF',
  PLSX: '#8000E0',
  HEX: '#FF6B35',
  INC: '#10b981',
  PRVX: '#e040a0',
}
const TOKEN_LOGOS: Record<string, string> = {
  PLS: 'https://tokens.app.pulsex.com/images/tokens/0xA1077a294dDE1B09bB078844df40758a5D0f9a27.png',
  PLSX: 'https://tokens.app.pulsex.com/images/tokens/0x95B303987A60C71504D99Aa1b13B4DA07b0790ab.png',
  HEX: 'https://tokens.app.pulsex.com/images/tokens/0x2b591e99afE9f32eAA6214f7B7629768c40Eeb39.png',
  INC: 'https://tokens.app.pulsex.com/images/tokens/0x2fa878Ab3F87CC1C9737Fc071108F904c0B0C95d.png',
  PRVX: '/icons/prvx.png',
}

function formatSupply(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}T`
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return n.toFixed(0)
}

function formatPct(pct: number): string {
  if (pct >= 1) return `${pct.toFixed(0)}%`
  if (pct >= 0.01) return `${pct}%`
  return `${pct}%`
}

function tokensRequired(totalSupply: number, pct: number): string {
  return formatSupply(totalSupply * pct / 100)
}

export function Leagues() {
  const [leagues, setLeagues] = useState<LeagueData[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedToken, setSelectedToken] = useState<string>('PLS')

  useEffect(() => {
    getHolderLeagues()
      .then(setLeagues)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const selected = leagues.find((l) => l.token_symbol === selectedToken)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <Crown className="h-4 w-4 text-amber-400" />
        <h2 className="text-sm font-semibold text-white">Holder Leagues</h2>
      </div>

      {/* Token selector tabs */}
      <div className="flex gap-1.5">
        {TOKEN_ORDER.map((sym) => (
          <button
            key={sym}
            onClick={() => setSelectedToken(sym)}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              selectedToken === sym
                ? 'text-white border border-white/20'
                : 'bg-gray-800/30 text-gray-400 border border-transparent hover:text-white'
            }`}
            style={
              selectedToken === sym
                ? { backgroundColor: `${TOKEN_COLORS[sym]}20`, borderColor: `${TOKEN_COLORS[sym]}40` }
                : undefined
            }
          >
            {sym}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 text-gray-500 animate-spin" />
        </div>
      ) : !selected ? (
        <div className="text-center py-8">
          <Users className="h-8 w-8 text-gray-600 mx-auto mb-2" />
          <div className="text-xs text-gray-500">No league data available yet</div>
          <div className="text-[11px] text-gray-600 mt-1">Data updates every 6 hours</div>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Token header */}
          <div className="flex items-center justify-between bg-gray-800/40 rounded-xl p-3 border border-white/5">
            <div className="flex items-center gap-2.5">
              <img src={TOKEN_LOGOS[selected.token_symbol] || ''} alt={selected.token_symbol} className="h-8 w-8 rounded-full" />
              <div>
                <div className="text-sm font-bold text-white">{selected.token_symbol} Holders</div>
                <div className="text-[11px] text-gray-500 mt-0.5">
                  {(selected.total_holders ?? 0).toLocaleString('en-US')} total holders
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-gray-400">Supply</div>
              <div className="text-sm font-bold text-white">{formatSupply(selected.total_supply_human)}</div>
            </div>
          </div>

          {/* Tier table */}
          <div className="bg-gray-800/30 rounded-lg border border-white/5 overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-4 gap-1 px-3 py-2 border-b border-white/5 text-[10px] text-gray-500 uppercase tracking-wider">
              <div>League</div>
              <div className="text-right">% Supply</div>
              <div className="text-right">Required</div>
              <div className="text-right"># Holders</div>
            </div>

            {/* Tier rows */}
            {TIERS.map((tier) => {
              const count = selected[`${tier.key}_count` as keyof LeagueData] as number
              return (
                <div
                  key={tier.key}
                  className="grid grid-cols-4 gap-1 px-3 py-2.5 border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm">{tier.emoji}</span>
                    <span className={`text-xs font-medium ${tier.color}`}>{tier.label}</span>
                  </div>
                  <div className="text-xs text-gray-400 text-right self-center">
                    {formatPct(tier.pct)}
                  </div>
                  <div className="text-xs text-gray-300 text-right self-center font-mono">
                    {tokensRequired(selected.total_supply_human, tier.pct)}
                  </div>
                  <div className="text-right self-center">
                    <span
                      className="text-xs font-bold"
                      style={{ color: TOKEN_COLORS[selected.token_symbol] || '#00D4FF' }}
                    >
                      {count.toLocaleString('en-US')}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Last updated */}
          <div className="text-center text-[10px] text-gray-600">
            Updated {new Date(selected.updated_at).toLocaleString('en-US')}
          </div>
        </div>
      )}
    </div>
  )
}
