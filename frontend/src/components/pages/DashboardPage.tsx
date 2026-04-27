import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Copy, Check, Key, FileText, AlertTriangle, Settings, RefreshCw } from 'lucide-react'

const BILLING_API = import.meta.env.VITE_BILLING_API_URL || ''

export function DashboardPage() {
  const [searchParams] = useSearchParams()
  const sessionId = searchParams.get('session_id')

  const [apiKey, setApiKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!sessionId) return

    setLoading(true)
    fetch(`${BILLING_API}/api/billing/retrieve-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
    })
      .then(async (res) => {
        const data = await res.json()
        if (res.ok && data.api_key) {
          setApiKey(data.api_key)
        } else if (res.status === 410) {
          setError('This API key has already been retrieved. If you lost your key, use the regeneration link.')
        } else {
          setError(data.detail || 'Failed to retrieve API key')
        }
      })
      .catch(() => setError('Connection error — please try again'))
      .finally(() => setLoading(false))
  }, [sessionId])

  const copyKey = () => {
    if (!apiKey) return
    navigator.clipboard.writeText(apiKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 3000)
  }

  // No session_id = not coming from checkout
  if (!sessionId) {
    return (
      <div className="max-w-2xl mx-auto py-20 px-4 text-center">
        <Key className="w-12 h-12 text-gray-500 mx-auto mb-4" />
        <h1 className="text-2xl font-bold text-white mb-2">API Dashboard</h1>
        <p className="text-gray-400">
          This page displays your API key after a successful checkout.
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto py-16 px-4">
      <div className="bg-[#1a1a2e]/80 border border-gray-800 rounded-xl p-8">

        {loading && (
          <div className="text-center py-8">
            <div className="animate-spin w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-gray-400">Retrieving your API key...</p>
          </div>
        )}

        {error && (
          <div className="text-center py-8">
            <AlertTriangle className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">Unable to retrieve key</h2>
            <p className="text-gray-400">{error}</p>
          </div>
        )}

        {apiKey && (
          <>
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <Key className="w-8 h-8 text-green-400" />
              </div>
              <h1 className="text-2xl font-bold text-white">Your API Key</h1>
              <p className="text-gray-400 mt-1">Pro subscription active — 120 requests/min</p>
            </div>

            {/* API Key display */}
            <div className="relative group mb-6">
              <div className="bg-black/50 border border-gray-700 rounded-lg p-4 font-mono text-sm text-green-400 break-all pr-12">
                {apiKey}
              </div>
              <button
                onClick={copyKey}
                className="absolute top-3 right-3 p-2 rounded-md bg-gray-800 hover:bg-gray-700 transition-colors"
                title="Copy to clipboard"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-green-400" />
                ) : (
                  <Copy className="w-4 h-4 text-gray-400" />
                )}
              </button>
            </div>

            {/* Warning */}
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-8">
              <p className="text-red-400 text-sm font-medium">
                Save this key now. It will not be shown again.
              </p>
            </div>

            {/* Quick start */}
            <div className="mb-8">
              <h3 className="text-white font-semibold mb-3">Quick Start</h3>
              <div className="bg-black/50 border border-gray-700 rounded-lg p-4 font-mono text-xs text-gray-300 overflow-x-auto">
                <pre>{`curl -H "Authorization: Bearer ${apiKey.slice(0, 20)}..." \\
  https://safety.openpulsechain.com/api/v1/token/0x.../safety`}</pre>
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-3">
              <a
                href={`${BILLING_API}/api/billing/retrieve-invoice?session_id=${sessionId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 w-full p-3 bg-gray-800/50 border border-gray-700 rounded-lg hover:bg-gray-700/50 transition-colors text-left"
              >
                <FileText className="w-5 h-5 text-blue-400" />
                <div>
                  <p className="text-white text-sm font-medium">Download Invoice</p>
                  <p className="text-gray-500 text-xs">PDF receipt for your records</p>
                </div>
              </a>

              <a
                href={`${BILLING_API}/api/billing/portal-redirect?session_id=${sessionId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 w-full p-3 bg-gray-800/50 border border-gray-700 rounded-lg hover:bg-gray-700/50 transition-colors text-left"
              >
                <Settings className="w-5 h-5 text-purple-400" />
                <div>
                  <p className="text-white text-sm font-medium">Manage Subscription</p>
                  <p className="text-gray-500 text-xs">Cancel, update payment method, view invoices</p>
                </div>
              </a>

              <a
                href={`${BILLING_API}/api/billing/request-regeneration-page?session_id=${sessionId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 w-full p-3 bg-gray-800/50 border border-gray-700 rounded-lg hover:bg-gray-700/50 transition-colors text-left"
              >
                <RefreshCw className="w-5 h-5 text-orange-400" />
                <div>
                  <p className="text-white text-sm font-medium">Regenerate API Key</p>
                  <p className="text-gray-500 text-xs">Revoke current key and get a new one</p>
                </div>
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
