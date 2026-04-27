import { useState, useMemo } from 'react'
import { ExternalLink, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, AlertTriangle, Heart, Repeat2, Search, Copy, Check, Brain } from 'lucide-react'
import { ShareButton } from '../ui/ShareButton'
import { useIntelConclusions, useLlmAnalyses, useResearchTweets } from '../../hooks/useSupabase'
import { shortenAddress, formatDate, formatTimeAgo } from '../../lib/format'
import { useTranslation } from '../../i18n'
import type { IntelConclusion, LlmAnalysis, ResearchTweet } from '../../types'

const SCAN_URL = 'https://scan.mypinata.cloud/ipfs/bafybeienxyoyrhn5tswclvd3gdjy5mtkkwmu37aqtml6onbf7xnb3o22pe/#/address'

type RiskFilter = 'all' | 'critical' | 'high' | 'medium' | 'low'
type TypeFilter = 'all' | 'address_profile' | 'event'

const RISK_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

const RISK_COLORS: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-300 border-red-500/40',
  high: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
  medium: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
  low: 'bg-green-500/20 text-green-300 border-green-500/40',
}

const SENTIMENT_COLORS: Record<string, string> = {
  warning: 'bg-orange-500/20 text-orange-300',
  bearish: 'bg-red-500/20 text-red-300',
  bullish: 'bg-green-500/20 text-green-300',
  neutral: 'bg-gray-500/20 text-gray-300',
  accusation: 'bg-rose-500/20 text-rose-300',
}

const ACTION_COLORS: Record<string, string> = {
  dump: 'bg-red-500/20 text-red-300',
  manipulate: 'bg-purple-500/20 text-purple-300',
  bridge: 'bg-blue-500/20 text-blue-300',
  redistribute: 'bg-amber-500/20 text-amber-300',
  tornado_funded: 'bg-rose-500/20 text-rose-300',
  accumulate: 'bg-emerald-500/20 text-emerald-300',
  swap: 'bg-cyan-500/20 text-cyan-300',
}

const PER_PAGE = 30

function RiskBadge({ level }: { level: string }) {
  const color = RISK_COLORS[level] || 'bg-gray-500/20 text-gray-300 border-gray-500/40'
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-semibold uppercase border ${color}`}>
      {level}
    </span>
  )
}

function CopyAddr({ address }: { address: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        navigator.clipboard.writeText(address)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      className="p-0.5 text-gray-500 hover:text-white transition-colors"
      title={t.common.copy_address}
    >
      {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
    </button>
  )
}

function AddressLink({ address }: { address: string }) {
  return (
    <span className="inline-flex items-center gap-1 font-mono text-xs">
      <a
        href={`${SCAN_URL}/${address}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[#00D4FF] hover:text-white transition-colors"
        onClick={e => e.stopPropagation()}
      >
        {shortenAddress(address)}
      </a>
      <CopyAddr address={address} />
      <a
        href={`${SCAN_URL}/${address}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-gray-600 hover:text-[#00D4FF] transition-colors"
        onClick={e => e.stopPropagation()}
      >
        <ExternalLink className="h-3 w-3" />
      </a>
    </span>
  )
}

function ConclusionCard({ conclusion, isExpanded, onToggle, tweets, llmAnalyses }: {
  conclusion: IntelConclusion
  isExpanded: boolean
  onToggle: () => void
  tweets: Map<string, ResearchTweet>
  llmAnalyses: Map<string, LlmAnalysis>
}) {
  const { t } = useTranslation()
  const tweetIds = useMemo(() => {
    if (!Array.isArray(conclusion.evidence)) return []
    const ids = new Set<string>()
    for (const e of conclusion.evidence) ids.add(e.tweet_id)
    return [...ids]
  }, [conclusion.evidence])

  const relatedLlm = useMemo(() => {
    return tweetIds.map(tid => llmAnalyses.get(tid)).filter(Boolean) as LlmAnalysis[]
  }, [tweetIds, llmAnalyses])

  const allAmounts = useMemo(() => {
    const amounts: any[] = []
    for (const llm of relatedLlm) {
      if (llm.amounts_mentioned) amounts.push(...llm.amounts_mentioned)
    }
    return amounts
  }, [relatedLlm])

  const allRelationships = useMemo(() => {
    const rels: any[] = []
    for (const llm of relatedLlm) {
      if (llm.relationships) rels.push(...llm.relationships)
    }
    return rels
  }, [relatedLlm])

  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.03] overflow-hidden">
      <div
        onClick={onToggle}
        className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-white/[0.02] transition-colors"
      >
        <div className="pt-0.5 shrink-0">
          <RiskBadge level={conclusion.risk_level} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-medium text-gray-400 border border-white/5 whitespace-nowrap">
              {conclusion.conclusion_type.replace(/_/g, ' ')}
            </span>
            <span className="text-xs text-gray-500">{conclusion.tweet_count.toLocaleString('en-US')} {t.intelligence.tweets}</span>
            <span className="text-xs text-gray-500 ml-auto flex-shrink-0">{formatDate(conclusion.last_seen)}</span>
          </div>
          <h3 className="text-sm font-medium text-white mb-1">{conclusion.title}</h3>
          <p className={`text-xs text-gray-400 ${isExpanded ? '' : 'line-clamp-2'}`}>
            {conclusion.summary}
          </p>

          {conclusion.tokens_involved && conclusion.tokens_involved.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {conclusion.tokens_involved.map((token, i) => (
                <span key={i} className="rounded bg-[#8000E0]/15 px-1.5 py-0.5 text-[10px] font-medium text-purple-300 border border-[#8000E0]/25">
                  {token}
                </span>
              ))}
            </div>
          )}

          {conclusion.addresses_involved && conclusion.addresses_involved.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {(isExpanded ? conclusion.addresses_involved : conclusion.addresses_involved.slice(0, 3)).map((addr, i) => (
                <AddressLink key={i} address={addr} />
              ))}
              {!isExpanded && conclusion.addresses_involved.length > 3 && (
                <span className="text-xs text-gray-500">+{conclusion.addresses_involved.length - 3} {t.common.more}</span>
              )}
            </div>
          )}
        </div>
        <div className="flex-shrink-0 pt-1">
          {isExpanded ? <ChevronUp className="h-4 w-4 text-gray-500" /> : <ChevronDown className="h-4 w-4 text-gray-500" />}
        </div>
      </div>

      {isExpanded && (
        <div className="border-t border-white/5 px-4 py-3 bg-white/[0.01] space-y-4">
          {relatedLlm.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{t.intelligence.ai_analysis}</h4>
              <div className="space-y-2">
                {relatedLlm.map((llm, i) => (
                  <div key={i} className="rounded-lg bg-white/[0.02] border border-white/5 p-3 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      {llm.sentiment && (
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${SENTIMENT_COLORS[llm.sentiment] || 'bg-gray-500/20 text-gray-300'}`}>
                          {llm.sentiment}
                        </span>
                      )}
                      {llm.action_detected && llm.action_detected !== 'none' && (
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${ACTION_COLORS[llm.action_detected] || 'bg-gray-500/20 text-gray-300'}`}>
                          {llm.action_detected.replace(/_/g, ' ')}
                        </span>
                      )}
                      {llm.risk_level && <RiskBadge level={llm.risk_level} />}
                    </div>
                    {llm.summary && <p className="text-xs text-gray-300">{llm.summary}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {allAmounts.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{t.intelligence.amounts_detected}</h4>
              <div className="flex flex-wrap gap-2">
                {allAmounts.map((a, i) => (
                  <span key={i} className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-2 py-1 text-xs text-amber-300">
                    {a.value || a}{a.token ? ` ${a.token}` : ''}{a.context ? ` (${a.context})` : ''}
                  </span>
                ))}
              </div>
            </div>
          )}

          {allRelationships.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{t.intelligence.address_relationships}</h4>
              <div className="space-y-1">
                {allRelationships.map((r, i) => (
                  <div key={i} className="text-xs flex items-center gap-2 flex-wrap">
                    {r.from && <AddressLink address={r.from} />}
                    <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-gray-400 whitespace-nowrap">{r.type?.replace(/_/g, ' ')}</span>
                    {r.to && <AddressLink address={r.to} />}
                    {r.detail && <span className="text-gray-500">— {r.detail}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {tweetIds.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{t.intelligence.source_tweets}</h4>
              <div className="space-y-2">
                {tweetIds.map(tid => {
                  const tweet = tweets.get(tid)
                  if (!tweet) return null
                  return (
                    <div key={tid} className="rounded-lg bg-white/[0.02] border border-white/5 p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-white">@{tweet.author_username}</span>
                        <a
                          href={tweet.tweet_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-[#00D4FF] hover:text-white transition-colors flex items-center gap-1"
                        >
                          {t.intelligence.view_on_x} <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                      <p className="text-xs text-gray-300 whitespace-pre-wrap line-clamp-4">{tweet.text}</p>
                      <div className="flex items-center gap-3 mt-2 text-[10px] text-gray-500">
                        <span className="flex items-center gap-1"><Heart className="h-3 w-3" /> {tweet.like_count.toLocaleString('en-US')}</span>
                        <span className="flex items-center gap-1"><Repeat2 className="h-3 w-3" /> {tweet.retweet_count.toLocaleString('en-US')}</span>
                        <span>{formatDate(tweet.tweeted_at)}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="flex items-center gap-4 text-xs text-gray-500 pt-2 border-t border-white/5 flex-wrap">
            <span>{t.intelligence.first_seen} {formatDate(conclusion.first_seen)}</span>
            <span>{t.intelligence.last_seen} {formatDate(conclusion.last_seen)}</span>
            <span className={conclusion.is_active ? 'text-green-400' : 'text-gray-500'}>
              {conclusion.is_active ? t.intelligence.active : t.intelligence.inactive}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

export function IntelligencePage() {
  const { t } = useTranslation()
  const conclusions = useIntelConclusions()
  const llmAnalyses = useLlmAnalyses()
  const researchTweets = useResearchTweets()
  const [expanded, setExpanded] = useState<number | null>(null)
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)

  const loading = conclusions.loading || llmAnalyses.loading || researchTweets.loading
  const error = conclusions.error || llmAnalyses.error || researchTweets.error

  // Build lookup maps
  const tweetsMap = useMemo(() => {
    const map = new Map<string, ResearchTweet>()
    for (const t of researchTweets.data) map.set(t.id, t)
    return map
  }, [researchTweets.data])

  const llmMap = useMemo(() => {
    const map = new Map<string, LlmAnalysis>()
    for (const l of llmAnalyses.data) map.set(l.tweet_id, l)
    return map
  }, [llmAnalyses.data])

  // KPIs
  const totalConclusions = conclusions.data.length
  const criticalHighCount = useMemo(
    () => conclusions.data.filter(c => c.risk_level === 'critical' || c.risk_level === 'high').length,
    [conclusions.data]
  )
  const uniqueAddresses = useMemo(() => {
    const set = new Set<string>()
    for (const c of conclusions.data) {
      if (c.addresses_involved) c.addresses_involved.forEach(a => set.add(a))
    }
    return set.size
  }, [conclusions.data])
  const uniqueTokens = useMemo(() => {
    const set = new Set<string>()
    for (const c of conclusions.data) {
      if (c.tokens_involved) c.tokens_involved.forEach(t => set.add(t))
    }
    return set.size
  }, [conclusions.data])

  // Sentiment distribution
  const sentimentCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const a of llmAnalyses.data) {
      if (a.sentiment) counts[a.sentiment] = (counts[a.sentiment] || 0) + 1
    }
    return counts
  }, [llmAnalyses.data])

  // Action breakdown (filter out "none")
  const actionCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const a of llmAnalyses.data) {
      if (a.action_detected && a.action_detected !== 'none') {
        counts[a.action_detected] = (counts[a.action_detected] || 0) + 1
      }
    }
    return counts
  }, [llmAnalyses.data])

  // Last seen date
  const lastUpdated = useMemo(() => {
    if (conclusions.data.length === 0) return null
    return conclusions.data.reduce((latest, c) => {
      const d = new Date(c.last_seen)
      return d > latest ? d : latest
    }, new Date(0))
  }, [conclusions.data])

  // Filter, search & sort
  const filtered = useMemo(() => {
    let list = conclusions.data

    if (riskFilter !== 'all') list = list.filter(c => c.risk_level === riskFilter)
    if (typeFilter !== 'all') list = list.filter(c => c.conclusion_type === typeFilter)

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      list = list.filter(c =>
        c.title.toLowerCase().includes(q) ||
        c.summary.toLowerCase().includes(q) ||
        c.tokens_involved?.some(t => t.toLowerCase().includes(q)) ||
        c.addresses_involved?.some(a => a.toLowerCase().includes(q))
      )
    }

    return [...list].sort((a, b) => {
      // Sort by date (most recent first), then by risk level as tiebreaker
      const dateA = new Date(a.last_seen).getTime()
      const dateB = new Date(b.last_seen).getTime()
      if (dateB !== dateA) return dateB - dateA
      return (RISK_ORDER[a.risk_level] ?? 99) - (RISK_ORDER[b.risk_level] ?? 99)
    })
  }, [conclusions.data, riskFilter, typeFilter, searchQuery])

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  // Reset page on filter change
  const handleFilterChange = (setter: (v: any) => void, value: any) => {
    setter(value)
    setPage(1)
  }

  const totalSentiments = Object.values(sentimentCounts).reduce((s, v) => s + v, 0)

  // Error state
  if (error && conclusions.data.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">{t.intelligence.title}</h1>
            <p className="text-gray-400 mt-1">{t.intelligence.subtitle}</p>
          </div>
          <ShareButton title={t.intelligence.title} text="PulseChain market intelligence: on-chain signals and risk analysis" />
        </div>
        <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-6 text-center space-y-3">
          <AlertTriangle className="h-8 w-8 text-orange-400 mx-auto" />
          <p className="text-orange-400">{t.intelligence.error_load}</p>
          <button onClick={() => window.location.reload()} className="rounded-lg bg-orange-500/20 px-4 py-2 text-sm text-orange-300 hover:bg-orange-500/30 transition-colors">
            {t.common.retry}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Hero header */}
      <div className="rounded-2xl border border-white/5 bg-gradient-to-br from-red-500/5 via-purple-500/5 to-cyan-500/5 backdrop-blur-sm p-5 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-xl bg-red-400/10 border border-red-400/20">
                <Brain className="h-6 w-6 text-red-400" />
              </div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-red-300 to-purple-400 bg-clip-text text-transparent">
                {t.intelligence.title}
              </h1>
              <ShareButton title={t.intelligence.title} text="PulseChain market intelligence: on-chain signals and risk analysis" />
            </div>
            <p className="text-gray-400 max-w-xl text-sm">
              {t.intelligence.description}
            </p>
          </div>
          {totalConclusions > 0 && (
            <div className="flex flex-wrap gap-3">
              <div className="text-center px-4 py-2 rounded-xl bg-white/[0.03] border border-white/5">
                <div className="text-lg font-bold text-white">{totalConclusions}</div>
                <div className="text-[10px] text-gray-500 uppercase tracking-wider">{t.intelligence.conclusions}</div>
              </div>
              <div className="text-center px-4 py-2 rounded-xl bg-red-500/5 border border-red-500/10">
                <div className="text-lg font-bold text-red-400">{criticalHighCount}</div>
                <div className="text-[10px] text-gray-500 uppercase tracking-wider">{t.intelligence.critical_high}</div>
              </div>
              <div className="text-center px-4 py-2 rounded-xl bg-cyan-500/5 border border-cyan-500/10">
                <div className="text-lg font-bold text-[#00D4FF]">{uniqueAddresses}</div>
                <div className="text-[10px] text-gray-500 uppercase tracking-wider">{t.intelligence.addresses}</div>
              </div>
              <div className="text-center px-4 py-2 rounded-xl bg-purple-500/5 border border-purple-500/10">
                <div className="text-lg font-bold text-purple-400">{uniqueTokens}</div>
                <div className="text-[10px] text-gray-500 uppercase tracking-wider">{t.common.tokens}</div>
              </div>
            </div>
          )}
        </div>
        {lastUpdated && (
          <div className="mt-3 text-[10px] text-gray-600">
            {t.intelligence.update_info} &middot; Last: {formatDate(lastUpdated.toISOString())} ({formatTimeAgo(lastUpdated.toISOString())})
          </div>
        )}
      </div>

      {/* Search bar */}
      <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-gray-500 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setPage(1) }}
            placeholder={t.intelligence.search_placeholder}
            className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 outline-none"
          />
          {searchQuery && (
            <button onClick={() => { setSearchQuery(''); setPage(1) }} className="text-xs text-gray-500 hover:text-white transition-colors">
              {t.common.clear}
            </button>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        {([
          { key: 'all' as RiskFilter, label: t.intelligence.filter_all },
          { key: 'critical' as RiskFilter, label: t.intelligence.filter_critical },
          { key: 'high' as RiskFilter, label: t.intelligence.filter_high },
          { key: 'medium' as RiskFilter, label: t.intelligence.filter_medium },
          { key: 'low' as RiskFilter, label: t.intelligence.filter_low },
        ]).map(f => (
          <button
            key={f.key}
            onClick={() => handleFilterChange(setRiskFilter, f.key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              riskFilter === f.key
                ? 'bg-[#8000E0]/20 text-[#00D4FF] border border-[#8000E0]/30'
                : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
            }`}
          >
            {f.label}
          </button>
        ))}

        <span className="text-gray-600 mx-1">|</span>

        {([
          { key: 'all' as TypeFilter, label: t.intelligence.filter_all_types },
          { key: 'address_profile' as TypeFilter, label: t.intelligence.filter_address_profile },
          { key: 'event' as TypeFilter, label: t.intelligence.filter_event },
        ]).map(f => (
          <button
            key={f.key}
            onClick={() => handleFilterChange(setTypeFilter, f.key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              typeFilter === f.key
                ? 'bg-[#8000E0]/20 text-[#00D4FF] border border-[#8000E0]/30'
                : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
            }`}
          >
            {f.label}
          </button>
        ))}

        <span className="ml-auto text-xs text-gray-500">{filtered.length} {t.common.results}</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-32">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-600 border-t-[#00D4FF]" />
        </div>
      ) : (
        <>
          {/* Mobile: stats above conclusions */}
          <div className="lg:hidden space-y-4">
            <SidebarStats
              sentimentCounts={sentimentCounts}
              totalSentiments={totalSentiments}
              actionCounts={actionCounts}
              llmCount={llmAnalyses.data.length}
              highRiskCount={llmAnalyses.data.filter(a => a.risk_level === 'high' || a.risk_level === 'critical').length}
            />
          </div>

          {/* Main content */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Conclusions list */}
            <div className="lg:col-span-2 space-y-3">
              {paginated.length === 0 ? (
                <div className="rounded-xl border border-white/5 bg-white/[0.03] p-8 text-center text-gray-500">
                  {searchQuery ? t.intelligence.no_search_results : t.intelligence.no_filter_results}
                </div>
              ) : (
                paginated.map(c => (
                  <ConclusionCard
                    key={c.id}
                    conclusion={c}
                    isExpanded={expanded === c.id}
                    onToggle={() => setExpanded(expanded === c.id ? null : c.id)}
                    tweets={tweetsMap}
                    llmAnalyses={llmMap}
                  />
                ))
              )}

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 pt-4">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="rounded-lg p-2 text-gray-400 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                    .map((p, idx, arr) => (
                      <span key={p}>
                        {idx > 0 && arr[idx - 1] !== p - 1 && <span className="text-gray-600 px-1">...</span>}
                        <button
                          onClick={() => setPage(p)}
                          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                            page === p
                              ? 'bg-[#8000E0]/20 text-[#00D4FF] border border-[#8000E0]/30'
                              : 'text-gray-400 hover:text-white hover:bg-white/5'
                          }`}
                        >
                          {p}
                        </button>
                      </span>
                    ))}
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="rounded-lg p-2 text-gray-400 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>

            {/* Desktop sidebar */}
            <div className="hidden lg:block">
              <SidebarStats
                sentimentCounts={sentimentCounts}
                totalSentiments={totalSentiments}
                actionCounts={actionCounts}
                llmCount={llmAnalyses.data.length}
                highRiskCount={llmAnalyses.data.filter(a => a.risk_level === 'high' || a.risk_level === 'critical').length}
              />
            </div>
          </div>
        </>
      )}

    </div>
  )
}

// ── Sidebar stats component ─────────────────────────────────

function SidebarStats({ sentimentCounts, totalSentiments, actionCounts, llmCount, highRiskCount }: {
  sentimentCounts: Record<string, number>
  totalSentiments: number
  actionCounts: Record<string, number>
  llmCount: number
  highRiskCount: number
}) {
  const { t } = useTranslation()
  const totalActions = Object.values(actionCounts).reduce((s, v) => s + v, 0)

  return (
    <div className="space-y-4">
      {/* Sentiment Overview */}
      <div className="rounded-xl border border-white/5 bg-white/[0.03] p-4">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{t.intelligence.sentiment_distribution}</h3>
        {totalSentiments === 0 ? (
          <p className="text-sm text-gray-500">{t.intelligence.no_sentiment_data}</p>
        ) : (
          <div className="space-y-2">
            {Object.entries(sentimentCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([sentiment, count]) => {
                const pct = Math.round((count / totalSentiments) * 100)
                const color = SENTIMENT_COLORS[sentiment] || 'bg-gray-500/20 text-gray-300'
                return (
                  <div key={sentiment}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className={`rounded px-1.5 py-0.5 font-medium capitalize ${color}`}>
                        {sentiment}
                      </span>
                      <span className="text-gray-400">{count} ({pct}%)</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[#8000E0] to-[#00D4FF] transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
          </div>
        )}
      </div>

      {/* Actions Breakdown */}
      <div className="rounded-xl border border-white/5 bg-white/[0.03] p-4">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{t.intelligence.actions_detected}</h3>
        {totalActions === 0 ? (
          <p className="text-sm text-gray-500">{t.intelligence.no_actions_detected}</p>
        ) : (
          <div className="space-y-2">
            {Object.entries(actionCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([action, count]) => {
                const color = ACTION_COLORS[action] || 'bg-gray-500/20 text-gray-300'
                return (
                  <div key={action} className="flex items-center justify-between">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${color}`}>
                      {action.replace(/_/g, ' ')}
                    </span>
                    <span className="text-sm font-medium text-white">{count}</span>
                  </div>
                )
              })}
          </div>
        )}
      </div>

      {/* LLM Stats */}
      <div className="rounded-xl border border-white/5 bg-white/[0.03] p-4">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{t.intelligence.llm_analysis}</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-gray-500">{t.intelligence.total_analyses}</p>
            <p className="text-lg font-bold text-white">{llmCount}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">{t.intelligence.high_risk}</p>
            <p className="text-lg font-bold text-red-400">{highRiskCount}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">{t.intelligence.actions_found}</p>
            <p className="text-lg font-bold text-purple-400">{totalActions}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">{t.intelligence.sentiments}</p>
            <p className="text-lg font-bold text-[#00D4FF]">{totalSentiments}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
