import { useState } from 'react'
import { Code, Zap, Copy, Check, Bot, Terminal, Shield, BarChart3, Wallet, Globe, Lock, CheckCircle } from 'lucide-react'
import { useTranslation } from '../../i18n'

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const { t } = useTranslation()
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }}
      className="absolute top-3 right-3 p-1.5 rounded-md bg-gray-800 hover:bg-gray-700 transition-colors text-gray-400 hover:text-white border border-white/10"
      title={t.api.copy_tooltip}
    >
      {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
    </button>
  )
}

function CodeBlock({ code, className = '' }: { code: string; className?: string }) {
  return (
    <div className={`relative bg-gray-950 border border-white/10 rounded-lg p-4 font-mono text-sm overflow-x-auto ${className}`}>
      <CopyButton text={code} />
      <pre className="text-gray-300 whitespace-pre">{code}</pre>
    </div>
  )
}

function ToolRow({ tier, name, desc }: { tier: 'included' | 'pro'; name: string; desc: string }) {
  const badge = tier === 'pro'
    ? <span className="text-[9px] font-bold text-[#00D4FF] bg-[#00D4FF]/10 border border-[#00D4FF]/25 rounded px-1 py-0 leading-tight">PRO</span>
    : null
  return (
    <p className="flex items-center gap-1.5 leading-relaxed">
      {badge}
      <code className="text-gray-300">{name}</code>
      <span>— {desc}</span>
    </p>
  )
}

type ApiTab = 'mcp' | 'rest'

export function ApiPage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<ApiTab>('mcp')

  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="text-center space-y-4 pt-4">
        <h1 className="text-4xl font-bold bg-gradient-to-r from-[#00D4FF] to-[#8000E0] bg-clip-text text-transparent">
          {t.api.title}
        </h1>
        <p className="text-gray-400 text-lg max-w-2xl mx-auto">
          {t.api.description}
        </p>
      </div>

      {/* Tab navigation */}
      <div className="flex justify-center">
        <div className="inline-flex rounded-xl border border-white/10 bg-white/[0.03] p-1 gap-1">
          <button
            onClick={() => setTab('mcp')}
            className={`flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-all ${
              tab === 'mcp'
                ? 'bg-[#8000E0]/20 text-[#8000E0] border border-[#8000E0]/30'
                : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
            }`}
          >
            <Bot className="h-4 w-4" />
            MCP Server
          </button>
          <button
            onClick={() => setTab('rest')}
            className={`flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-all ${
              tab === 'rest'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
            }`}
          >
            <Zap className="h-4 w-4" />
            REST API
            <span className="rounded-full bg-[#00D4FF]/20 text-[#00D4FF] border border-[#00D4FF]/30 px-1.5 py-0.5 text-[10px] font-bold leading-none">€29/mo</span>
          </button>
        </div>
      </div>

      {/* ═══ MCP TAB ═══ */}
      {tab === 'mcp' && (
        <div className="space-y-8">
          <section className="rounded-2xl border border-[#8000E0]/30 bg-gradient-to-br from-[#8000E0]/5 to-[#00D4FF]/5 p-6 space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-[#8000E0]/20 p-2.5">
                  <Bot className="h-6 w-6 text-[#8000E0]" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">{t.api.mcp_title}</h2>
                  <p className="text-sm text-gray-400">{t.api.mcp_subtitle}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400">
                  11 Included
                </span>
                <span className="rounded-full border border-[#00D4FF]/30 bg-[#00D4FF]/10 px-3 py-1 text-xs font-medium text-[#00D4FF]">
                  + 9 PRO
                </span>
              </div>
            </div>

            {/* What is MCP */}
            <div className="rounded-xl border border-white/5 bg-white/[0.03] p-4 text-sm text-gray-400">
              <strong className="text-gray-300">{t.api.mcp_what_is}</strong>{' '}
              {t.api.mcp_what_is_desc}
            </div>

            {/* Installation — Standard (no API key) */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-emerald-400" />
                <h3 className="text-sm font-semibold text-white">Standard — no API key required</h3>
                <span className="rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-bold">11 TOOLS</span>
              </div>
              <p className="text-xs text-gray-500">Claude Desktop / Claude Code — <code className="text-[#00D4FF]">settings.json</code></p>
              <CodeBlock code={`{
  "mcpServers": {
    "openpulsechain": {
      "command": "npx",
      "args": ["-y", "@openpulsechain/mcp-server"]
    }
  }
}`} />
            </div>

            {/* Installation — Pro tier */}
            <div className="space-y-3 rounded-xl border border-[#00D4FF]/20 bg-[#00D4FF]/5 p-4">
              <div className="flex items-center gap-2">
                <Lock className="h-4 w-4 text-[#00D4FF]" />
                <h3 className="text-sm font-semibold text-white">Pro tier — unlock 9 advanced tools</h3>
                <span className="rounded-full bg-[#00D4FF]/15 text-[#00D4FF] border border-[#00D4FF]/30 px-2 py-0.5 text-[10px] font-bold">WITH API KEY</span>
              </div>
              <p className="text-xs text-gray-400">
                Add the <code className="text-[#00D4FF]">OPENPULSECHAIN_API_KEY</code> environment variable to unlock AML checks, deployer reputation, smart money feed, wallet tracking, funding tree, and more — no code change needed.
              </p>
              <CodeBlock code={`{
  "mcpServers": {
    "openpulsechain": {
      "command": "npx",
      "args": ["-y", "@openpulsechain/mcp-server"],
      "env": {
        "OPENPULSECHAIN_API_KEY": "sk-opk-..."
      }
    }
  }
}`} />
              <button
                onClick={() => setTab('rest')}
                className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#00D4FF] to-[#8000E0] px-4 py-2 text-xs font-semibold text-white hover:opacity-90 transition-opacity"
              >
                Get an API key →
              </button>
            </div>

            <p className="text-xs text-amber-400/70 italic">npm package not yet published — available when the GitHub repo goes public.</p>

            {/* Tools grid */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Code className="h-4 w-4 text-[#00D4FF]" />
                <h3 className="text-sm font-semibold text-white">{t.api.mcp_tools_title}</h3>
                <span className="text-[10px] text-gray-500 ml-auto">
                  Included — public data
                  <span className="mx-2">·</span>
                  <span className="text-[#00D4FF] font-semibold">PRO</span> — requires API key
                </span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-emerald-400">
                    <BarChart3 className="h-4 w-4" />
                    {t.api.mcp_cat_tokens}
                  </div>
                  <div className="space-y-1 text-xs text-gray-500">
                    <ToolRow tier="included" name="get_token_price" desc="Price, 24h change, volume, mcap" />
                    <ToolRow tier="included" name="get_token_info" desc="Full token details" />
                    <ToolRow tier="included" name="get_token_history" desc="Historical OHLCV data (30d without API key)" />
                    <ToolRow tier="included" name="get_top_tokens" desc="Top tokens by volume/liquidity" />
                    <ToolRow tier="included" name="get_top_pairs" desc="Top PulseX trading pairs" />
                    <ToolRow tier="included" name="get_market_overview" desc="TVL, volume, top movers" />
                  </div>
                </div>
                <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-red-400">
                    <Shield className="h-4 w-4" />
                    {t.api.mcp_cat_safety}
                  </div>
                  <div className="space-y-1 text-xs text-gray-500">
                    <ToolRow tier="included" name="get_token_safety" desc="Honeypot, tax, ownership analysis" />
                    <ToolRow tier="included" name="get_token_liquidity" desc="Liquidity breakdown" />
                    <ToolRow tier="included" name="get_honeypots" desc="Recent honeypot detections" />
                    <ToolRow tier="pro" name="check_address_risk" desc="AML/OFAC/exploit check" />
                    <ToolRow tier="pro" name="get_deployer_reputation" desc="Rug pattern detection" />
                    <ToolRow tier="pro" name="get_scam_alerts" desc="Real-time scam radar" />
                  </div>
                </div>
                <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-yellow-400">
                    <Wallet className="h-4 w-4" />
                    {t.api.mcp_cat_smart_money}
                  </div>
                  <div className="space-y-1 text-xs text-gray-500">
                    <ToolRow tier="pro" name="get_smart_money_feed" desc="Whale activity feed" />
                    <ToolRow tier="pro" name="get_recent_swaps" desc="Large DEX swaps" />
                    <ToolRow tier="pro" name="get_wallet_balances" desc="Wallet token holdings" />
                    <ToolRow tier="pro" name="get_wallet_swaps" desc="Wallet swap history" />
                    <ToolRow tier="pro" name="get_funding_tree" desc="Trace funding sources" />
                  </div>
                </div>
                <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-cyan-400">
                    <Globe className="h-4 w-4" />
                    {t.api.mcp_cat_bridge}
                  </div>
                  <div className="space-y-1 text-xs text-gray-500">
                    <ToolRow tier="included" name="get_bridge_stats" desc="Bridge inflows/outflows" />
                    <ToolRow tier="included" name="get_holder_leagues" desc="Aggregated holder tiers" />
                    <ToolRow tier="pro" name="get_holder_rank" desc="Wallet rank across tokens" />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 text-xs text-gray-500">
              <a href="https://github.com/openpulsechain/openpulsechain/tree/main/mcp-server" target="_blank" rel="noopener noreferrer" className="text-[#00D4FF] hover:underline">GitHub</a>
              <span>•</span>
              <a href="https://modelcontextprotocol.io" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white hover:underline">MCP Protocol Spec</a>
              <span>•</span>
              <a href="https://www.npmjs.com/package/@openpulsechain/mcp-server" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white hover:underline">npm</a>
            </div>
          </section>
        </div>
      )}

      {/* ═══ REST API TAB ═══ */}
      {tab === 'rest' && (
        <div className="space-y-8">
          {/* Pricing Card */}
          <section className="rounded-2xl border border-[#00D4FF]/20 bg-gradient-to-br from-[#00D4FF]/5 to-[#8000E0]/5 p-8">
            <div className="flex flex-col md:flex-row items-start md:items-center gap-8">
              {/* Left — Price */}
              <div className="flex-shrink-0 text-center md:text-left">
                <div className="flex items-baseline gap-1 justify-center md:justify-start">
                  <span className="text-5xl font-bold bg-gradient-to-r from-[#00D4FF] to-[#8000E0] bg-clip-text text-transparent">{t.api.pricing_price}</span>
                  <span className="text-lg text-gray-400">{t.api.pricing_period}</span>
                </div>
                <p className="text-sm text-gray-400 mt-2 max-w-xs">{t.api.pricing_desc}</p>
                <button
                  disabled
                  className="mt-4 w-full md:w-auto rounded-xl bg-gradient-to-r from-[#00D4FF] to-[#8000E0] px-8 py-2.5 text-sm font-semibold text-white opacity-60 cursor-not-allowed"
                >
                  {t.api.pricing_coming_soon}
                </button>
              </div>

              {/* Right — Features */}
              <div className="flex-1 space-y-3">
                <h3 className="text-sm font-semibold text-white uppercase tracking-wider">{t.api.pricing_title}</h3>
                <div className="space-y-2">
                  {[
                    t.api.pricing_feat_endpoints,
                    t.api.pricing_feat_rate,
                    t.api.pricing_feat_key,
                    t.api.pricing_feat_support,
                    t.api.pricing_feat_docs,
                  ].map((feat) => (
                    <div key={feat} className="flex items-center gap-2.5">
                      <CheckCircle className="h-4 w-4 text-emerald-400 flex-shrink-0" />
                      <span className="text-sm text-gray-300">{feat}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* MCP bonus notice */}
            <div className="mt-6 pt-4 border-t border-white/5 text-sm text-gray-400">
              <div className="flex items-start gap-2">
                <Bot className="h-4 w-4 text-[#8000E0] flex-shrink-0 mt-0.5" />
                <div>
                  <strong className="text-white">Bonus:</strong> your API key also unlocks the{' '}
                  <button onClick={() => setTab('mcp')} className="text-[#8000E0] hover:underline font-medium">MCP Pro tier</button>
                  {' '}(9 extra AI tools — AML checks, smart money feed, funding tree, forensic analysis).
                  No extra purchase required.
                </div>
              </div>
            </div>
          </section>

          {/* What's included — categories overview (no endpoints/URLs exposed) */}
          <section className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-[#00D4FF]/20 p-2.5">
                <Lock className="h-6 w-6 text-[#00D4FF]" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">{t.api.rest_api_title}</h2>
                <p className="text-sm text-gray-400">{t.api.rest_api_intro}</p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {[
                { icon: <BarChart3 className="h-4 w-4" />, color: 'text-emerald-400', title: 'Token Data API', items: [
                  'Token list, search & filtering',
                  'Live prices from PulseX Subgraph',
                  'Historical OHLCV data',
                  'Top trading pairs',
                  'Market overview (TVL, volume, movers)',
                ]},
                { icon: <Shield className="h-4 w-4" />, color: 'text-red-400', title: 'Token Safety API', items: [
                  'Safety scores (honeypot, contract, LP, holders)',
                  'Batch safety analysis',
                  'Scam alert radar',
                  'Deployer reputation & rug detection',
                ]},
                { icon: <Wallet className="h-4 w-4" />, color: 'text-yellow-400', title: 'Smart Money & Wallets', items: [
                  'Smart money feed (top wallets)',
                  'Large swap tracking',
                  'Wallet holdings & swap history',
                ]},
                { icon: <Globe className="h-4 w-4" />, color: 'text-cyan-400', title: 'Bridge & Leagues', items: [
                  'Holder league rankings',
                  'Historical league snapshots',
                  'Bridge analytics (coming soon)',
                ]},
              ].map((cat) => (
                <div key={cat.title} className="rounded-xl border border-white/5 bg-white/[0.02] p-4 space-y-2">
                  <div className={`flex items-center gap-2 text-sm font-medium ${cat.color}`}>
                    {cat.icon}
                    {cat.title}
                  </div>
                  <div className="space-y-1">
                    {cat.items.map((item) => (
                      <p key={item} className="text-xs text-gray-500">{item}</p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* Links (always visible) */}
      <section className="flex flex-wrap gap-3 pb-6">
        <a
          href="https://github.com/openpulsechain/openpulsechain"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-4 py-2 text-sm text-gray-300 hover:bg-white/5 transition-colors"
        >
          {t.api.link_github}
        </a>
      </section>
    </div>
  )
}
