import { useState } from 'react'
import { Key, Settings, Trash2, Shield, Loader2 } from 'lucide-react'

const BILLING_API = import.meta.env.VITE_BILLING_API_URL || ''

interface KeyInfo {
  status: string
  tier: string
  email: string
  created_at: string
  portal_url: string | null
}

export function ManageKeyPage() {
  const [apiKey, setApiKey] = useState('')
  const [keyInfo, setKeyInfo] = useState<KeyInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [revoking, setRevoking] = useState(false)
  const [revoked, setRevoked] = useState(false)

  const lookup = async () => {
    if (!apiKey.startsWith('sk-opk-')) {
      setError('Key must start with sk-opk-')
      return
    }
    setError(null)
    setLoading(true)
    try {
      const res = await fetch(`${BILLING_API}/api/billing/manage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey }),
      })
      const data = await res.json()
      if (res.ok) {
        setKeyInfo(data)
      } else {
        setError(data.detail || 'Key not found')
      }
    } catch {
      setError('Connection error')
    } finally {
      setLoading(false)
    }
  }

  const revokeKey = async () => {
    if (!confirm('Are you sure? This will permanently revoke your API key.')) return
    setRevoking(true)
    try {
      const res = await fetch(`${BILLING_API}/api/billing/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey }),
      })
      if (res.ok) {
        setRevoked(true)
        setKeyInfo(null)
      }
    } catch {
      setError('Failed to revoke')
    } finally {
      setRevoking(false)
    }
  }

  return (
    <div className="max-w-xl mx-auto py-16 px-4">
      <div className="bg-[#1a1a2e]/80 border border-gray-800 rounded-xl p-8">
        <div className="text-center mb-8">
          <Shield className="w-12 h-12 text-purple-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white">Manage API Key</h1>
          <p className="text-gray-400 mt-1">Enter your API key to manage your subscription</p>
        </div>

        {revoked ? (
          <div className="text-center py-8">
            <Trash2 className="w-12 h-12 text-red-400 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">Key Revoked</h2>
            <p className="text-gray-400">Your API key has been permanently revoked.</p>
          </div>
        ) : !keyInfo ? (
          <>
            <div className="mb-4">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-opk-..."
                className="w-full bg-black/50 border border-gray-700 rounded-lg p-3 text-white font-mono text-sm focus:border-purple-500 focus:outline-none"
                onKeyDown={(e) => e.key === 'Enter' && lookup()}
              />
            </div>
            {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
            <button
              onClick={lookup}
              disabled={loading || !apiKey}
              className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 text-white py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
              {loading ? 'Looking up...' : 'Look up key'}
            </button>
          </>
        ) : (
          <>
            <div className="space-y-3 mb-6">
              <div className="flex justify-between py-2 border-b border-gray-800">
                <span className="text-gray-400">Status</span>
                <span className={keyInfo.status === 'active' ? 'text-green-400' : 'text-red-400'}>
                  {keyInfo.status}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-gray-800">
                <span className="text-gray-400">Tier</span>
                <span className="text-white">{keyInfo.tier}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-gray-800">
                <span className="text-gray-400">Email</span>
                <span className="text-white">{keyInfo.email}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-gray-800">
                <span className="text-gray-400">Created</span>
                <span className="text-white">{new Date(keyInfo.created_at).toLocaleDateString()}</span>
              </div>
            </div>

            <div className="space-y-3">
              {keyInfo.portal_url && (
                <a
                  href={keyInfo.portal_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 w-full p-3 bg-purple-600/20 border border-purple-500/30 rounded-lg hover:bg-purple-600/30 transition-colors"
                >
                  <Settings className="w-5 h-5 text-purple-400" />
                  <div>
                    <p className="text-white text-sm font-medium">Manage Subscription</p>
                    <p className="text-gray-500 text-xs">Cancel, update payment, view invoices</p>
                  </div>
                </a>
              )}

              <button
                onClick={revokeKey}
                disabled={revoking}
                className="flex items-center gap-3 w-full p-3 bg-red-500/10 border border-red-500/30 rounded-lg hover:bg-red-500/20 transition-colors text-left"
              >
                <Trash2 className="w-5 h-5 text-red-400" />
                <div>
                  <p className="text-red-400 text-sm font-medium">
                    {revoking ? 'Revoking...' : 'Revoke API Key'}
                  </p>
                  <p className="text-gray-500 text-xs">Permanently disable this key</p>
                </div>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
