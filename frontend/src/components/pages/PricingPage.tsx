import { useState } from 'react'
import { Check, Zap, Bot, Shield, BarChart3, Wallet, Eye, Bell, Globe, Key, ArrowRight } from 'lucide-react'

const BILLING_API = import.meta.env.VITE_BILLING_API_URL || ''

export function PricingPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleCheckout = async () => {
    if (!email || !email.includes('@')) {
      setError('Valid email required')
      return
    }
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`${BILLING_API}/api/billing/create-checkout-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (res.ok && data.url) {
        window.location.href = data.url
      } else {
        setError(data.detail || 'Failed to create checkout')
      }
    } catch {
      setError('Connection error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-5xl mx-auto py-12 px-4 space-y-12">

      {/* Hero */}
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold bg-gradient-to-r from-[#00D4FF] to-[#8000E0] bg-clip-text text-transparent">
          API Pricing
        </h1>
        <p className="text-gray-400 text-lg max-w-2xl mx-auto">
          PulseChain analytics for developers, bots, and AI agents.
          No account needed — your API key is your identity.
        </p>
      </div>

      {/* Pricing Cards */}
      <div className="grid md:grid-cols-3 gap-6">

        {/* Free */}
        <div className="rounded-2xl border border-gray-800 bg-[#1a1a2e]/50 p-6 space-y-6">
          <div>
            <h2 className="text-xl font-bold text-white">Free</h2>
            <p className="text-gray-500 text-sm mt-1">Public endpoints</p>
          </div>
          <div>
            <span className="text-4xl font-bold text-white">$0</span>
          </div>
          <ul className="space-y-3 text-sm text-gray-400">
            <li className="flex items-start gap-2"><Check className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" /> Token prices, top tokens, market overview</li>
            <li className="flex items-start gap-2"><Check className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" /> Safety scores (cached)</li>
            <li className="flex items-start gap-2"><Check className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" /> Bridge stats, DEX pairs</li>
            <li className="flex items-start gap-2"><Check className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" /> Holder leagues summary</li>
            <li className="flex items-start gap-2"><Check className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" /> 11 MCP tools</li>
            <li className="flex items-start gap-2"><Check className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" /> 20 requests/min</li>
          </ul>
          <div className="pt-2">
            <a
              href="/api"
              className="block w-full text-center py-3 rounded-xl border border-gray-700 text-gray-300 hover:bg-white/5 transition-colors font-medium"
            >
              Get Started
            </a>
          </div>
        </div>

        {/* Pro */}
        <div className="rounded-2xl border-2 border-[#8000E0]/50 bg-gradient-to-b from-[#8000E0]/10 to-[#1a1a2e]/80 p-6 space-y-6 relative">
          <div className="absolute -top-3 left-1/2 -translate-x-1/2">
            <span className="bg-[#8000E0] text-white text-xs font-bold px-3 py-1 rounded-full">RECOMMENDED</span>
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Pro</h2>
            <p className="text-gray-500 text-sm mt-1">Full API + MCP access</p>
          </div>
          <div>
            <span className="text-4xl font-bold text-white">€29</span>
            <span className="text-gray-500 text-sm">/month</span>
          </div>
          <ul className="space-y-3 text-sm text-gray-300">
            <li className="flex items-start gap-2"><Check className="w-4 h-4 text-[#8000E0] mt-0.5 shrink-0" /> Everything in Free</li>
            <li className="flex items-start gap-2"><Shield className="w-4 h-4 text-[#00D4FF] mt-0.5 shrink-0" /> Fresh safety analysis on-demand</li>
            <li className="flex items-start gap-2"><Eye className="w-4 h-4 text-[#00D4FF] mt-0.5 shrink-0" /> Smart money feed + whale tracking</li>
            <li className="flex items-start gap-2"><BarChart3 className="w-4 h-4 text-[#00D4FF] mt-0.5 shrink-0" /> Deployer reputation scoring</li>
            <li className="flex items-start gap-2"><Bell className="w-4 h-4 text-[#00D4FF] mt-0.5 shrink-0" /> Real-time scam alerts</li>
            <li className="flex items-start gap-2"><Wallet className="w-4 h-4 text-[#00D4FF] mt-0.5 shrink-0" /> Wallet balances + swap history</li>
            <li className="flex items-start gap-2"><Globe className="w-4 h-4 text-[#00D4FF] mt-0.5 shrink-0" /> Funding tree tracing</li>
            <li className="flex items-start gap-2"><Bot className="w-4 h-4 text-[#00D4FF] mt-0.5 shrink-0" /> 20 MCP tools (11 + 9 PRO)</li>
            <li className="flex items-start gap-2"><Zap className="w-4 h-4 text-[#00D4FF] mt-0.5 shrink-0" /> 120 requests/min</li>
          </ul>
          <div className="pt-2 space-y-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              className="w-full bg-black/50 border border-gray-700 rounded-lg p-3 text-white text-sm focus:border-[#8000E0] focus:outline-none"
              onKeyDown={(e) => e.key === 'Enter' && handleCheckout()}
            />
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <button
              onClick={handleCheckout}
              disabled={loading}
              className="w-full bg-[#8000E0] hover:bg-[#6b00c0] disabled:bg-gray-700 text-white py-3 rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Key className="w-4 h-4" />
              )}
              {loading ? 'Redirecting to checkout...' : 'Get API Key'}
            </button>
          </div>
        </div>

        {/* x402 */}
        <div className="rounded-2xl border border-gray-800 bg-[#1a1a2e]/50 p-6 space-y-6">
          <div>
            <h2 className="text-xl font-bold text-white">x402</h2>
            <p className="text-gray-500 text-sm mt-1">Pay-per-call for AI agents</p>
          </div>
          <div>
            <span className="text-4xl font-bold text-white">$0.005</span>
            <span className="text-gray-500 text-sm">–$0.02/call</span>
          </div>
          <ul className="space-y-3 text-sm text-gray-400">
            <li className="flex items-start gap-2"><Check className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" /> HTTP 402 micropayments</li>
            <li className="flex items-start gap-2"><Check className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" /> USDC on Base (eip155:8453)</li>
            <li className="flex items-start gap-2"><Check className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" /> No account, no API key</li>
            <li className="flex items-start gap-2"><Check className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" /> Payment = authentication</li>
            <li className="flex items-start gap-2"><Check className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" /> For autonomous trading bots</li>
            <li className="flex items-start gap-2"><Check className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" /> CDP facilitator (Coinbase)</li>
          </ul>
          <div className="pt-2">
            <a
              href="/.well-known/x402"
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full text-center py-3 rounded-xl border border-gray-700 text-gray-300 hover:bg-white/5 transition-colors font-medium"
            >
              View Endpoints
            </a>
          </div>
        </div>
      </div>

      {/* x402 Pricing Table */}
      <div className="rounded-2xl border border-gray-800 bg-[#1a1a2e]/50 p-6 space-y-4">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <Zap className="w-5 h-5 text-[#00D4FF]" />
          x402 Pay-per-call Pricing
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-500">
                <th className="text-left py-2 font-medium">Endpoint</th>
                <th className="text-right py-2 font-medium">Price/call</th>
              </tr>
            </thead>
            <tbody className="text-gray-300">
              <tr className="border-b border-gray-800/50"><td className="py-2"><code>token/*/safety</code></td><td className="text-right text-[#00D4FF]">$0.01</td></tr>
              <tr className="border-b border-gray-800/50"><td className="py-2"><code>deployer/*</code></td><td className="text-right text-[#00D4FF]">$0.02</td></tr>
              <tr className="border-b border-gray-800/50"><td className="py-2"><code>smart-money/feed</code></td><td className="text-right text-[#00D4FF]">$0.02</td></tr>
              <tr className="border-b border-gray-800/50"><td className="py-2"><code>smart-money/swaps</code></td><td className="text-right text-[#00D4FF]">$0.01</td></tr>
              <tr className="border-b border-gray-800/50"><td className="py-2"><code>alerts/recent</code></td><td className="text-right text-[#00D4FF]">$0.01</td></tr>
              <tr className="border-b border-gray-800/50"><td className="py-2"><code>address/*/risk</code></td><td className="text-right text-[#00D4FF]">$0.01</td></tr>
              <tr className="border-b border-gray-800/50"><td className="py-2"><code>wallet/*/balances</code></td><td className="text-right text-[#00D4FF]">$0.005</td></tr>
              <tr className="border-b border-gray-800/50"><td className="py-2"><code>wallet/*/swaps</code></td><td className="text-right text-[#00D4FF]">$0.005</td></tr>
              <tr className="border-b border-gray-800/50"><td className="py-2"><code>token/*/liquidity</code></td><td className="text-right text-[#00D4FF]">$0.005</td></tr>
              <tr><td className="py-2"><code>leagues/*/holders</code></td><td className="text-right text-[#00D4FF]">$0.005</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Manage key link */}
      <div className="text-center">
        <a href="/manage" className="text-gray-500 hover:text-gray-300 text-sm flex items-center justify-center gap-1 transition-colors">
          Already have a key? <ArrowRight className="w-3 h-3" /> Manage your subscription
        </a>
      </div>
    </div>
  )
}
