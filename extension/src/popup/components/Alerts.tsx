import { useState, useEffect } from 'react'
import { AlertTriangle, RefreshCw, Loader2, ExternalLink, Shield } from 'lucide-react'
import { getRecentAlerts, type ScamAlert } from '../../lib/api'
import { shortenAddress, timeAgo } from '../../lib/format'

function alertIcon(type: string) {
  switch (type) {
    case 'lp_removal': return '🔴'
    case 'whale_dump': return '🐋'
    case 'mint_event': return '🪙'
    default: return '⚠️'
  }
}

function alertColor(level: string) {
  switch (level?.toLowerCase()) {
    case 'critical': return 'border-red-500/30 bg-red-500/5'
    case 'high': return 'border-orange-500/30 bg-orange-500/5'
    case 'medium': return 'border-amber-500/30 bg-amber-500/5'
    default: return 'border-white/5 bg-gray-800/30'
  }
}

function parseAlertDetail(alert: ScamAlert): string {
  try {
    if (alert.data) {
      const parsed = typeof alert.data === 'string' ? JSON.parse(alert.data) : alert.data
      if (parsed.message) return parsed.message
      if (parsed.detail) return parsed.detail
      // Build summary from data
      const parts: string[] = []
      if (parsed.token_symbol) parts.push(parsed.token_symbol)
      if (parsed.amount_usd) parts.push(`$${Number(parsed.amount_usd).toLocaleString('en-US')}`)
      if (parsed.pair_symbol) parts.push(`Pair: ${parsed.pair_symbol}`)
      if (parts.length > 0) return parts.join(' · ')
    }
  } catch { /* ignore */ }
  return `${alert.alert_type.replace(/_/g, ' ')} on ${shortenAddress(alert.token_address)}`
}

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'honeypot', label: 'Honeypots' },
  { key: 'lp_removal', label: 'LP Removals' },
  { key: 'whale_dump', label: 'Whale Dumps' },
  { key: 'mint_event', label: 'Suspicious Mints' },
] as const

export function Alerts() {
  const [alerts, setAlerts] = useState<ScamAlert[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('all')

  const filtered = filter === 'all' ? (alerts || []) : (alerts || []).filter(a => a.alert_type === filter)

  const loadAlerts = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await getRecentAlerts(30)
      setAlerts(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAlerts()
  }, [])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-red-400" />
          <h2 className="text-sm font-semibold text-white">Alert Radar</h2>
        </div>
        <button
          onClick={loadAlerts}
          disabled={loading}
          className="text-gray-500 hover:text-white transition-colors"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <p className="text-xs text-gray-500">
        Real-time alerts: LP removals, whale dumps, suspicious activity.
      </p>

      {/* Filter tabs */}
      <div className="flex gap-1 overflow-x-auto pb-0.5 -mx-1 px-1">
        {FILTERS.map((f) => {
          const count = f.key === 'all' ? (alerts?.length ?? 0) : (alerts?.filter(a => a.alert_type === f.key)?.length ?? 0)
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`shrink-0 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                filter === f.key
                  ? 'bg-pulse-cyan/15 text-pulse-cyan border border-pulse-cyan/30'
                  : 'text-gray-500 hover:text-gray-300 border border-transparent'
              }`}
            >
              {f.label}{!loading && count > 0 ? ` (${count})` : ''}
            </button>
          )
        })}
      </div>

      {error && <div className="text-xs text-red-400 bg-red-500/10 rounded-lg p-2">{error}</div>}

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 text-gray-500 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8">
          <Shield className="h-8 w-8 text-emerald-500/30 mx-auto mb-2" />
          <p className="text-xs text-gray-500">{filter === 'all' ? 'No recent alerts — all clear' : 'No alerts in this category'}</p>
        </div>
      ) : (
        <div className="space-y-1.5 max-h-[340px] overflow-y-auto">
          {filtered.map((alert) => (
            <div
              key={alert.id}
              className={`rounded-lg p-2.5 border transition-colors ${alertColor(alert.severity)}`}
            >
              <div className="flex items-start gap-2">
                <span className="text-sm mt-0.5">{alertIcon(alert.alert_type)}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-sm font-medium text-white">
                      {shortenAddress(alert.token_address)}
                    </span>
                    <span className="text-xs text-gray-500">{timeAgo(alert.created_at)}</span>
                  </div>
                  <div className="text-xs text-gray-400 leading-relaxed">
                    {parseAlertDetail(alert)}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                      alert.severity === 'critical' ? 'bg-red-500/20 text-red-300' :
                      alert.severity === 'high' ? 'bg-orange-500/20 text-orange-300' :
                      'bg-amber-500/20 text-amber-300'
                    }`}>
                      {alert.severity?.toUpperCase()}
                    </span>
                    <span className="text-[10px] text-gray-600">
                      {alert.alert_type.replace(/_/g, ' ')}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <a
        href="https://www.openpulsechain.com/alerts"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-1 text-xs text-pulse-cyan hover:underline pt-1"
      >
        Full Alert Radar <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  )
}
