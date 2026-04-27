import { useState, useMemo, useEffect, useRef, Fragment } from 'react'
import { ExternalLink, ChevronDown, ChevronUp, Link2, Search, Copy, Check, RefreshCw, AlertTriangle, ChevronLeft, ChevronRight, ArrowUpDown } from 'lucide-react'

function WhaleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" stroke="currentColor">
      <path d="M12 4C10 4 8.5 6 7.5 8.5C6.5 7 5 6 3.5 5.5C3.2 5.4 3 5.7 3.2 5.9C4.5 7.5 5.5 9.5 6 12L7 12C7.5 9.5 9 7 10.5 5.5L10.5 14L13.5 14L13.5 5.5C15 7 16.5 9.5 17 12L18 12C18.5 9.5 19.5 7.5 20.8 5.9C21 5.7 20.8 5.4 20.5 5.5C19 6 17.5 7 16.5 8.5C15.5 6 14 4 12 4Z" fill="currentColor" stroke="none" />
      <path d="M3 16.5Q6 15 9 16.5Q12 18 15 16.5Q18 15 21 16.5" fill="none" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M4 19Q7 17.5 10 19Q13 20.5 16 19Q19 17.5 22 19" fill="none" strokeWidth="1" strokeLinecap="round" opacity="0.6" />
      <path d="M5 21.2Q8 19.8 11 21.2Q14 22.5 17 21.2Q20 19.8 23 21.2" fill="none" strokeWidth="0.7" strokeLinecap="round" opacity="0.3" />
    </svg>
  )
}
import { ShareButton } from '../ui/ShareButton'
import { useWhaleAddresses, useWhaleHoldings, useWhaleLinks } from '../../hooks/useSupabase'
import { formatUsd } from '../../lib/format'
import { useTranslation } from '../../i18n'
import type { WhaleAddress, WhaleHolding, WhaleLink } from '../../types'

const SCAN_URL = 'https://scan.mypinata.cloud/ipfs/bafybeienxyoyrhn5tswclvd3gdjy5mtkkwmu37aqtml6onbf7xnb3o22pe/#/address'

const PAGE_SIZE = 30

// ─── Token badge colors ────────────────────────────────────────────────────
const TOKEN_COLORS: Record<string, string> = {
  HEX: 'bg-pink-500/20 text-pink-300 border-pink-500/30',
  PLSX: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  INC: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  WPLS: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
  DAI: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  WETH: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  USDC: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  USDT: 'bg-green-500/20 text-green-300 border-green-500/30',
  WBTC: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
}
const DEFAULT_TOKEN_COLOR = 'bg-gray-500/20 text-gray-300 border-gray-500/30'

function TokenBadge({ symbol, value }: { symbol: string; value?: number }) {
  const color = TOKEN_COLORS[symbol.toUpperCase()] || DEFAULT_TOKEN_COLOR
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium border ${color}`}>
      {symbol}
      {value != null && <span className="opacity-70">{formatUsd(value)}</span>}
    </span>
  )
}

// ─── Shared sub-components ──────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const { t } = useTranslation()
  return (
    <button
      onClick={e => { e.preventDefault(); e.stopPropagation(); navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      className="shrink-0 p-0.5 rounded hover:bg-white/10 transition-colors cursor-pointer"
      title={t.common.copy_address}
    >
      {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3 text-gray-600 hover:text-[#00D4FF]" />}
    </button>
  )
}

function AddressLink({ address, full }: { address: string; full?: boolean }) {
  return (
    <a
      href={`${SCAN_URL}/${address}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 font-mono text-sm text-[#00D4FF] hover:text-white transition-colors"
      onClick={e => e.stopPropagation()}
    >
      {full ? address : `${address.slice(0, 6)}...${address.slice(-4)}`}
      <ExternalLink className="h-3 w-3 opacity-50 shrink-0" />
    </a>
  )
}

const LINK_COLORS: Record<string, string> = {
  common_funder: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  same_funder: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  direct_transfer: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  token_transfer: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  bridge_funded: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
  bridge_siblings: 'bg-pink-500/20 text-pink-300 border-pink-500/30',
  bridge_user: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
}

function LinkBadge({ type }: { type: string }) {
  const { t } = useTranslation()
  const color = LINK_COLORS[type] || 'bg-gray-500/20 text-gray-300 border-gray-500/30'
  const linkLabels: Record<string, string> = {
    common_funder: t.whales.link_common_funder,
    same_funder: t.whales.link_same_funder,
    direct_transfer: t.whales.link_direct_transfer,
    token_transfer: t.whales.link_token_transfer,
    bridge_funded: t.whales.link_bridge_funded,
    bridge_siblings: t.whales.link_bridge_siblings,
    bridge_user: t.whales.link_bridge_user,
  }
  const label = linkLabels[type] || type.replace(/_/g, ' ')
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium border whitespace-nowrap ${color}`}>
      {label}
    </span>
  )
}

// ─── Sort types ─────────────────────────────────────────────────────────────
type SortKey = 'total_usd' | 'token_count'
type SortDir = 'asc' | 'desc'

function SortHeader({ label, sortKey, currentKey, onSort, className }: {
  label: string; sortKey: SortKey; currentKey: SortKey; currentDir: SortDir; onSort: (k: SortKey) => void; className?: string
}) {
  const active = currentKey === sortKey
  return (
    <th
      className={`py-3 px-3 cursor-pointer select-none hover:text-white transition-colors ${className || ''}`}
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown className={`h-3 w-3 ${active ? 'text-[#00D4FF]' : 'opacity-40'}`} />
      </span>
    </th>
  )
}

// ─── Expanded row ───────────────────────────────────────────────────────────

interface ExpandedWhaleProps {
  whale: WhaleAddress
  holdings: WhaleHolding[]
  links: WhaleLink[]
}

function ExpandedWhaleRow({ whale, holdings, links }: ExpandedWhaleProps) {
  const { t } = useTranslation()
  const whaleHoldings = holdings.filter(h => h.address === whale.address)
    .sort((a, b) => b.balance_usd - a.balance_usd)

  const whaleLinks = links.filter(
    l => l.address_from === whale.address || l.address_to === whale.address
  )

  const connectionMap = new Map<string, WhaleLink[]>()
  for (const link of whaleLinks) {
    const other = link.address_from === whale.address ? link.address_to : link.address_from
    if (!connectionMap.has(other)) connectionMap.set(other, [])
    connectionMap.get(other)!.push(link)
  }

  return (
    <tr className="bg-white/[0.03] border-b border-white/10">
      {/* # — empty */}
      <td className="py-3 px-3"></td>

      {/* Under ADDRESS — Holdings title + token symbols */}
      <td className="py-3 px-3 align-top">
        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">{t.whales.holdings_section}</h4>
        <div className="space-y-1">
          {whaleHoldings.map(h => (
            <div key={h.token_address} className="text-sm text-gray-300">
              {h.token_symbol} <span className="text-gray-500 text-xs">({h.balance.toLocaleString('en-US', { maximumFractionDigits: 0 })})</span>
            </div>
          ))}
        </div>
      </td>

      {/* Under VALUE — USD values */}
      <td className="py-3 px-3 align-top text-center">
        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">&nbsp;</h4>
        <div className="space-y-1">
          {whaleHoldings.map(h => (
            <div key={h.token_address} className="text-sm whitespace-nowrap">
              <span className="text-white font-medium">{formatUsd(h.balance_usd)}</span>
            </div>
          ))}
        </div>
      </td>

      {/* Under TOKENS — empty */}
      <td className="py-3 px-3"></td>

      {/* Under TOP HOLDINGS — Connections */}
      <td className="py-3 px-3 align-top text-center">
        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
          {t.whales.connections_section} ({connectionMap.size})
        </h4>
        {connectionMap.size === 0 ? (
          <p className="text-sm text-gray-500">{t.whales.no_connections}</p>
        ) : (
          <div className="space-y-1.5 max-h-48 overflow-y-auto text-left">
            {Array.from(connectionMap.entries()).slice(0, 20).map(([addr, addrLinks]) => (
              <div key={addr} className="flex items-center gap-2 text-sm">
                <AddressLink address={addr} />
                <CopyButton text={addr} />
                <div className="flex flex-wrap gap-1">
                  {addrLinks.map((l, i) => (
                    <LinkBadge key={i} type={l.link_type} />
                  ))}
                </div>
              </div>
            ))}
            {connectionMap.size > 20 && (
              <p className="text-xs text-gray-500">+{connectionMap.size - 20} {t.common.more}</p>
            )}
          </div>
        )}
      </td>

      {/* Chevron — empty */}
      <td className="py-3 px-3"></td>
    </tr>
  )
}

// ─── Mobile whale card ──────────────────────────────────────────────────────

function WhaleCard({ whale, idx, holdings, links, connectedAddresses, expanded, onToggle }: {
  whale: WhaleAddress; idx: number; holdings: WhaleHolding[]; links: WhaleLink[]
  connectedAddresses: Set<string>; expanded: string | null; onToggle: (addr: string) => void
}) {
  const { t } = useTranslation()
  const isExpanded = expanded === whale.address
  const hasLinks = connectedAddresses.has(whale.address)
  const whaleHoldings = holdings.filter(h => h.address === whale.address).sort((a, b) => b.balance_usd - a.balance_usd)

  const whaleLinks = links.filter(l => l.address_from === whale.address || l.address_to === whale.address)
  const connectionMap = new Map<string, WhaleLink[]>()
  for (const link of whaleLinks) {
    const other = link.address_from === whale.address ? link.address_to : link.address_from
    if (!connectionMap.has(other)) connectionMap.set(other, [])
    connectionMap.get(other)!.push(link)
  }

  return (
    <div className="border-b border-white/5 py-3 px-1">
      <div className="flex items-start justify-between cursor-pointer" onClick={() => onToggle(whale.address)}>
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">#{idx}</span>
            <div className="flex items-center gap-1 min-w-0">
              <a
                href={`${SCAN_URL}/${whale.address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs text-[#00D4FF] hover:text-white transition-colors truncate"
                onClick={e => e.stopPropagation()}
              >
                {`${whale.address.slice(0, 10)}...${whale.address.slice(-6)}`}
              </a>
              <CopyButton text={whale.address} />
            </div>
            {whale.is_contract && (
              <span className="rounded bg-gray-700/50 px-1 py-0.5 text-[9px] text-gray-400 shrink-0">{t.whales.contract_badge}</span>
            )}
            {hasLinks && <Link2 className="h-3 w-3 text-purple-400 shrink-0" />}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-white">{formatUsd(whale.total_usd)}</span>
            <span className={`text-xs ${whale.token_count >= 2 ? 'text-[#00D4FF]' : 'text-gray-500'}`}>{whale.token_count} {whale.token_count > 1 ? t.whales.tokens_plural : t.whales.token_singular}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {whaleHoldings.slice(0, 4).map(h => (
              <TokenBadge key={h.token_address} symbol={h.token_symbol} />
            ))}
            {whaleHoldings.length > 4 && <span className="text-[10px] text-gray-500">+{whaleHoldings.length - 4}</span>}
          </div>
        </div>
        <div className="shrink-0 ml-2 mt-1">
          {isExpanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
        </div>
      </div>

      {isExpanded && (
        <div className="mt-3 space-y-3">
          {/* Holdings detail */}
          <div>
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">{t.whales.holdings_section}</h4>
            <div className="space-y-1">
              {whaleHoldings.map(h => (
                <div key={h.token_address} className="flex items-center justify-between text-xs">
                  <span className="text-gray-300">{h.token_symbol}</span>
                  <div className="text-right">
                    <span className="text-white">{formatUsd(h.balance_usd)}</span>
                    <span className="text-gray-500 ml-1.5">({h.balance.toLocaleString('en-US', { maximumFractionDigits: 0 })})</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* Connections */}
          {connectionMap.size > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">{t.whales.connections_section} ({connectionMap.size})</h4>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {Array.from(connectionMap.entries()).slice(0, 10).map(([addr, addrLinks]) => (
                  <div key={addr} className="flex items-center gap-2 text-xs">
                    <AddressLink address={addr} />
                    <div className="flex flex-wrap gap-0.5">
                      {addrLinks.map((l, i) => <LinkBadge key={i} type={l.link_type} />)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main page ──────────────────────────────────────────────────────────────

export function WhalesPage() {
  const { t } = useTranslation()
  const whales = useWhaleAddresses()
  const holdings = useWhaleHoldings()
  const links = useWhaleLinks()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'multi' | 'connected'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)
  const [sortKey, setSortKey] = useState<SortKey>('total_usd')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const loading = whales.loading || holdings.loading || links.loading
  const error = whales.error || holdings.error || links.error

  // Auto-refresh timestamp every 5min
  useEffect(() => {
    const tick = () => setLastRefresh(new Date())
    refreshTimer.current = setInterval(tick, 5 * 60_000)
    const onVis = () => { if (document.visibilityState === 'visible') tick() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      if (refreshTimer.current) clearInterval(refreshTimer.current)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  // Build set of addresses that have connections
  const connectedAddresses = useMemo(() => {
    const set = new Set<string>()
    for (const l of links.data) {
      set.add(l.address_from)
      set.add(l.address_to)
    }
    return set
  }, [links.data])

  // Build holdings map for search
  const holdingsByAddress = useMemo(() => {
    const map = new Map<string, WhaleHolding[]>()
    for (const h of holdings.data) {
      if (!map.has(h.address)) map.set(h.address, [])
      map.get(h.address)!.push(h)
    }
    return map
  }, [holdings.data])

  // Filtered + searched + sorted
  const filtered = useMemo(() => {
    let list = whales.data
    if (filter === 'multi') list = list.filter(w => w.token_count >= 2)
    if (filter === 'connected') list = list.filter(w => connectedAddresses.has(w.address))

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      list = list.filter(w => {
        if (w.address.toLowerCase().includes(q)) return true
        if (w.top_tokens?.toLowerCase().includes(q)) return true
        const wh = holdingsByAddress.get(w.address) || []
        return wh.some(h => h.token_symbol.toLowerCase().includes(q))
      })
    }

    list = [...list].sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      return sortDir === 'desc' ? bv - av : av - bv
    })

    return list
  }, [whales.data, filter, connectedAddresses, searchQuery, holdingsByAddress, sortKey, sortDir])

  // Reset page on filter/search change
  useEffect(() => { setPage(1) }, [filter, searchQuery, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // Stats
  const totalValue = useMemo(() => whales.data.reduce((s, w) => s + w.total_usd, 0), [whales.data])
  const multiTokenWhales = useMemo(() => whales.data.filter(w => w.token_count >= 2).length, [whales.data])
  const clusterCount = useMemo(() => {
    const funders = new Set(links.data.filter(l => l.link_type === 'common_funder').map(l => l.address_from))
    return funders.size
  }, [links.data])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const handleToggle = (addr: string) => setExpanded(prev => prev === addr ? null : addr)

  // Error state
  if (error && whales.data.length === 0) {
    return (
      <div className="space-y-6">
        <div className="rounded-2xl border border-white/5 bg-gradient-to-br from-cyan-500/5 via-purple-500/5 to-blue-500/5 backdrop-blur-sm p-5 sm:p-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-xl bg-cyan-400/10 border border-cyan-400/20">
              <WhaleIcon className="h-6 w-6 text-cyan-400" />
            </div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-cyan-300 to-purple-400 bg-clip-text text-transparent">{t.whales.title}</h1>
            <ShareButton title={t.whales.title} text={t.whales.subtitle} />
          </div>
          <p className="text-gray-400 max-w-xl text-sm">{t.whales.subtitle}</p>
        </div>
        <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-6 text-center space-y-3">
          <AlertTriangle className="h-8 w-8 text-orange-400 mx-auto" />
          <p className="text-orange-400">{t.whales.error_load}</p>
          <button onClick={() => window.location.reload()} className="rounded-lg bg-orange-500/20 px-4 py-2 text-sm text-orange-300 hover:bg-orange-500/30 transition-colors">
            <RefreshCw className="h-4 w-4 inline mr-1.5" />{t.whales.retry}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Hero header */}
      <div className="rounded-2xl border border-white/5 bg-gradient-to-br from-cyan-500/5 via-purple-500/5 to-blue-500/5 backdrop-blur-sm p-5 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-xl bg-cyan-400/10 border border-cyan-400/20">
                <WhaleIcon className="h-6 w-6 text-cyan-400" />
              </div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-cyan-300 to-purple-400 bg-clip-text text-transparent">
                {t.whales.title}
              </h1>
              <ShareButton title={t.whales.title} text={t.whales.subtitle} />
            </div>
            <p className="text-gray-400 max-w-xl text-sm">
              {t.whales.description}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="text-center px-4 py-2 rounded-xl bg-white/[0.03] border border-white/5">
              <div className="text-lg font-bold text-white">{whales.data.length.toLocaleString('en-US')}</div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider">{t.whales.total_whales_kpi}</div>
            </div>
            <div className="text-center px-4 py-2 rounded-xl bg-cyan-500/5 border border-cyan-500/10">
              <div className="text-lg font-bold text-[#00D4FF]">{formatUsd(totalValue)}</div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider">{t.whales.tracked_value_kpi}</div>
            </div>
            <div className="text-center px-4 py-2 rounded-xl bg-purple-500/5 border border-purple-500/10">
              <div className="text-lg font-bold text-purple-400">{multiTokenWhales.toLocaleString('en-US')}</div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider">{t.whales.multi_token_kpi}</div>
            </div>
            <div className="text-center px-4 py-2 rounded-xl bg-emerald-500/5 border border-emerald-500/10">
              <div className="text-lg font-bold text-emerald-400">{clusterCount}</div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider">{t.whales.funding_clusters_kpi}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Filter tabs + search */}
      <div className="flex flex-wrap items-center gap-2">
        {[
          { key: 'all' as const, label: t.whales.filter_all },
          { key: 'multi' as const, label: t.whales.filter_multi_token },
          { key: 'connected' as const, label: t.whales.filter_connected },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              filter === f.key
                ? 'bg-[#8000E0]/20 text-[#00D4FF] border border-[#8000E0]/30'
                : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
            }`}
          >
            {f.label}
          </button>
        ))}
        <div className="flex items-center gap-2 ml-auto">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={t.whales.search_placeholder}
              className="rounded-lg border border-white/10 bg-white/5 pl-8 pr-3 py-1.5 text-sm text-white placeholder-gray-500 outline-none focus:border-[#8000E0]/40 w-48 sm:w-56"
            />
          </div>
          <span className="text-xs text-gray-500 whitespace-nowrap">{filtered.length} {filtered.length !== 1 ? t.common.results : t.common.result}</span>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400">
        <span className="flex items-center gap-1"><Link2 className="h-3 w-3" /> {t.whales.connection_types_label}</span>
        <LinkBadge type="common_funder" />
        <LinkBadge type="same_funder" />
        <LinkBadge type="direct_transfer" />
        <LinkBadge type="token_transfer" />
        <LinkBadge type="bridge_funded" />
        <LinkBadge type="bridge_siblings" />
        <LinkBadge type="bridge_user" />
      </div>

      {loading ? (
        <div className="py-20 text-center">
          <RefreshCw className="h-6 w-6 text-gray-500 animate-spin mx-auto mb-2" />
          <p className="text-gray-500 text-sm">{t.whales.loading}</p>
        </div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="sm:hidden">
            {paged.length === 0 ? (
              <div className="py-8 text-center text-gray-500 text-sm">{t.whales.no_results}</div>
            ) : (
              <div className="rounded-xl border border-white/5 bg-white/[0.03] divide-y divide-white/5 px-2">
                {paged.map((whale, idx) => (
                  <WhaleCard
                    key={whale.address}
                    whale={whale}
                    idx={(page - 1) * PAGE_SIZE + idx + 1}
                    holdings={holdings.data}
                    links={links.data}
                    connectedAddresses={connectedAddresses}
                    expanded={expanded}
                    onToggle={handleToggle}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Desktop table */}
          <div className="rounded-xl border border-white/5 bg-white/[0.03] overflow-hidden hidden sm:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm table-fixed">
                <thead>
                  <tr className="border-b border-white/5 text-xs text-gray-400 uppercase tracking-wider">
                    <th className="py-3 px-3 text-center w-[50px]">#</th>
                    <th className="py-3 px-3 text-left">{t.whales.table_address}</th>
                    <SortHeader label={t.whales.table_value} sortKey="total_usd" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} className="text-center w-[130px]" />
                    <SortHeader label={t.whales.table_tokens} sortKey="token_count" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} className="text-center w-[90px]" />
                    <th className="py-3 px-3 text-center w-[300px]">{t.whales.table_top_holdings}</th>
                    <th className="py-3 px-3 w-[30px]"></th>
                  </tr>
                </thead>
                <tbody>
                  {paged.length === 0 ? (
                    <tr><td colSpan={6} className="py-8 text-center text-gray-500 text-sm">{t.whales.no_results}</td></tr>
                  ) : paged.map((whale, idx) => {
                    const isExpanded = expanded === whale.address
                    const hasLinks = connectedAddresses.has(whale.address)
                    const whaleHoldings = (holdingsByAddress.get(whale.address) || []).sort((a, b) => b.balance_usd - a.balance_usd)
                    return (
                      <Fragment key={whale.address}>
                        <tr
                          onClick={() => handleToggle(whale.address)}
                          className={`border-b border-white/[0.03] cursor-pointer transition-colors ${
                            isExpanded ? 'bg-white/[0.04]' : 'hover:bg-white/[0.02]'
                          }`}
                        >
                          <td className="py-2.5 px-3 text-center text-gray-500">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                          <td className="py-2.5 px-3 text-left">
                            <div className="flex items-center gap-2">
                              <AddressLink address={whale.address} full />
                              <CopyButton text={whale.address} />
                              {whale.is_contract && (
                                <span className="rounded bg-gray-700/50 px-1 py-0.5 text-[10px] text-gray-400 shrink-0">{t.whales.contract_badge}</span>
                              )}
                              {hasLinks && <Link2 className="h-3.5 w-3.5 text-purple-400 shrink-0" />}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-center font-medium text-white whitespace-nowrap">
                            {formatUsd(whale.total_usd)}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <span className={`${whale.token_count >= 2 ? 'text-[#00D4FF]' : 'text-gray-400'}`}>
                              {whale.token_count}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <div className="flex items-center justify-center gap-1 flex-wrap">
                              {whaleHoldings.slice(0, 4).map(h => (
                                <TokenBadge key={h.token_address} symbol={h.token_symbol} value={h.balance_usd} />
                              ))}
                              {whaleHoldings.length > 4 && <span className="text-[10px] text-gray-500">+{whaleHoldings.length - 4}</span>}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            {isExpanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                          </td>
                        </tr>
                        {isExpanded && (
                          <ExpandedWhaleRow whale={whale} holdings={holdings.data} links={links.data} />
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                  let pageNum: number
                  if (totalPages <= 7) {
                    pageNum = i + 1
                  } else if (page <= 4) {
                    pageNum = i + 1
                  } else if (page >= totalPages - 3) {
                    pageNum = totalPages - 6 + i
                  } else {
                    pageNum = page - 3 + i
                  }
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setPage(pageNum)}
                      className={`rounded-lg px-3 py-1 text-sm font-medium transition-colors ${
                        page === pageNum
                          ? 'bg-[#8000E0]/30 text-[#00D4FF] border border-[#8000E0]/40'
                          : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      {pageNum}
                    </button>
                  )
                })}
              </div>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Last refresh */}
          <p className="text-center text-xs text-gray-600">
            {t.common.last_updated} {lastRefresh.toLocaleTimeString()}
          </p>
        </>
      )}

    </div>
  )
}
