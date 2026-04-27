import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Crown, Users, Loader2, ChevronDown, ChevronRight, ChevronLeft, Link2, ExternalLink, Copy, Check, GitBranch, Search, AlertTriangle, Info, ShieldCheck, ShieldQuestion, X } from 'lucide-react'
import { ShareButton } from '../ui/ShareButton'
import { useHolderLeagues, useTokenPrices } from '../../hooks/useSupabase'
import { supabase } from '../../lib/supabase'
import { FundingGraphContent, FundingGraphModal } from '../FundingGraphModal'
import { useTranslation } from '../../i18n'
import type { HolderLeagueCurrent, HolderLeagueAddress, HolderLeagueFamily } from '../../types'

const SCAN_URL = 'https://scan.mypinata.cloud/ipfs/bafybeienxyoyrhn5tswclvd3gdjy5mtkkwmu37aqtml6onbf7xnb3o22pe/#'

const TIERS = [
  { key: 'poseidon', emoji: '\u{1F30A}', pct: 10, color: '#fbbf24' },
  { key: 'whale', emoji: '\u{1F40B}', pct: 1, color: '#a855f7' },
  { key: 'shark', emoji: '\u{1F988}', pct: 0.1, color: '#22d3ee' },
  { key: 'dolphin', emoji: '\u{1F42C}', pct: 0.01, color: '#3b82f6' },
  { key: 'squid', emoji: '\u{1F991}', pct: 0.001, color: '#10b981' },
  { key: 'turtle', emoji: '\u{1F422}', pct: 0.0001, color: '#6b7280' },
] as const

const TOKEN_ORDER = ['PLS', 'PLSX', 'HEX', 'INC', 'PRVX'] as const
const TOKEN_COLORS: Record<string, string> = {
  PLS: '#00D4FF',
  PLSX: '#8000E0',
  HEX: '#FF6B35',
  INC: '#10b981',
  PRVX: '#f59e0b',
}
const TOKEN_LOGOS: Record<string, string> = {
  PLS: '/tokens/pls.png',
  PLSX: '/tokens/plsx.png',
  HEX: '/tokens/phex.png',
  INC: '/tokens/inc.png',
  PRVX: '/tokens/prvx.png',
}
const TOKEN_DESC_KEYS: Record<string, string> = {
  PLS: 'token_pls_desc',
  PLSX: 'token_plsx_desc',
  HEX: 'token_phex_desc',
  INC: 'token_inc_desc',
  PRVX: 'token_prvx_desc',
}

function formatSupply(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}T`
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return n.toFixed(0)
}

function formatPct(pct: number): string {
  return `${pct.toFixed(pct >= 1 ? 0 : pct >= 0.01 ? 2 : pct >= 0.001 ? 3 : 4)}%`
}

function tokensRequired(totalSupply: number, pct: number): string {
  return formatSupply(totalSupply * pct / 100)
}

const TOKEN_DECIMALS: Record<string, number> = {
  PLS: 18, PLSX: 18, HEX: 8, INC: 18, PRVX: 18,
}

const PAGE_SIZE = 100

// System contracts excluded from "See all holders" — not real holders
const SYSTEM_CONTRACTS = [
  '0x0000000000000000000000000000000000000000', // zero/null address
  '0x000000000000000000000000000000000000dead', // dead/burn
  '0x0000000000000000000000000000000000000369', // PulseChain burn
  '0xa1077a294dde1b09bb078844df40758a5d0f9a27', // WPLS contract
  '0x95b303987a60c71504d99aa1b13b4da07b0790ab', // PLSX contract
  '0x2b591e99afe9f32eaa6214f7b7629768c40eeb39', // HEX contract
  '0x2fa878ab3f87cc1c9737fc071108f904c0b0c95d', // INC contract
  '0x98bf93ebf5c380c0e6ae8e192a7e2ae08edacc02', // PulseX V1 Router
  '0x165c3410fc91ef562c50559f7d2289febed552d9', // PulseX V2 Router
  '0x29ea7545def87022badc76323f373ea1e707c523', // PulseX Factory
  '0xb2ca4a66d3e57a5a9a12043b6bad28249fe302d4', // MasterChef
  '0x1715a3e4a142d8b698131108995174f37aeba10d', // OmniBridge ETH
  '0xbeb6a26ffa386bfc03368e8243193c56db062577', // OmniBridge PLS
  '0x8bca0149752de7271360b69789e6be8c47f86b8c', // HEX burn address
]

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

function formatBalance(balanceRaw: string, decimals: number): string {
  // Convert raw balance string to human-readable
  const raw = BigInt(balanceRaw)
  const divisor = BigInt(10 ** decimals)
  const whole = raw / divisor
  const frac = raw % divisor
  const fracStr = frac.toString().padStart(decimals, '0').slice(0, 2)
  const wholeStr = whole.toLocaleString('en-US').replace(/,/g, ' ')
  return frac > 0n ? `${wholeStr}.${fracStr}` : wholeStr
}

function formatUsd(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`
  if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`
  if (value >= 1) return `$${value.toFixed(2)}`
  if (value >= 0.01) return `$${value.toFixed(4)}`
  return `$${value.toFixed(6)}`
}

// ── All holders modal ────────────────────────────────────────

function AllHoldersModal({
  tokenSymbol,
  totalHolders,
  priceUsd,
  onClose,
}: {
  tokenSymbol: string
  totalHolders: number
  priceUsd: number | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [holders, setHolders] = useState<HolderLeagueAddress[]>([])
  const [motherAddresses, setMotherAddresses] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [totalCount, setTotalCount] = useState(totalHolders)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResult, setSearchResult] = useState<HolderLeagueAddress | null | undefined>(undefined) // undefined = not searched, null = not found
  const modalRef = useRef<HTMLDivElement>(null)
  const decimals = TOKEN_DECIMALS[tokenSymbol] ?? 18

  // Internal view state: 'holders' or 'graph'
  const [view, setView] = useState<'holders' | 'graph'>('holders')
  const [graphAddress, setGraphAddress] = useState<string | null>(null)

  const onClickAddress = (addr: string) => {
    setGraphAddress(addr)
    setView('graph')
  }

  const onBackToHolders = () => {
    setView('holders')
    setGraphAddress(null)
  }

  // Close on Escape + lock body scroll
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (view === 'graph') { onBackToHolders() } else { onClose() }
      }
    }
    window.addEventListener('keydown', handleKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', handleKey)
      document.body.style.overflow = ''
    }
  }, [onClose, view])

  // Load family data once
  useEffect(() => {
    async function loadFamilies() {
      const { data } = await supabase.from('holder_league_families')
        .select('*')
        .eq('token_symbol', tokenSymbol)
      if (data) {
        const mothers = new Set<string>()
        for (const f of data) {
          mothers.add(f.mother_address)
        }
        setMotherAddresses(mothers)
      }
    }
    loadFamilies()
  }, [tokenSymbol])

  // Load page of holders
  const loadPage = useCallback(async (pageNum: number) => {
    setLoading(true)
    const from = pageNum * PAGE_SIZE
    const to = from + PAGE_SIZE - 1

    const { data, count } = await supabase.from('holder_league_addresses')
      .select('*', { count: 'exact' })
      .eq('token_symbol', tokenSymbol)
      .not('holder_address', 'in', `(${SYSTEM_CONTRACTS.join(',')})`)
      .order('balance_pct', { ascending: false })
      .range(from, to)

    setHolders(data || [])
    if (count != null) setTotalCount(count)
    setLoading(false)
  }, [tokenSymbol])

  useEffect(() => { loadPage(page) }, [page, loadPage])

  // Search handler — also computes the rank
  const [searchRank, setSearchRank] = useState<number>(-1)
  const handleSearch = useCallback(async () => {
    const q = searchQuery.trim().toLowerCase()
    if (!q || q.length < 3) {
      setSearchResult(undefined)
      setSearchRank(-1)
      return
    }
    setLoading(true)
    const { data } = await supabase.from('holder_league_addresses')
      .select('*')
      .eq('token_symbol', tokenSymbol)
      .eq('holder_address', q)
      .limit(1)

    if (data && data.length > 0) {
      setSearchResult(data[0])
      // Compute rank: count addresses with higher balance_pct
      const { count } = await supabase.from('holder_league_addresses')
        .select('*', { count: 'exact', head: true })
        .eq('token_symbol', tokenSymbol)
        .gt('balance_pct', data[0].balance_pct)
        .not('holder_address', 'in', `(${SYSTEM_CONTRACTS.join(',')})`)
      setSearchRank((count ?? 0) + 1)
    } else {
      setSearchResult(null)
      setSearchRank(-1)
    }
    setLoading(false)
  }, [searchQuery, tokenSymbol])

  const clearSearch = () => {
    setSearchQuery('')
    setSearchResult(undefined)
    setSearchRank(-1)
  }

  const getFamilyStatus = (holder: HolderLeagueAddress): 'mother' | 'daughter' | 'single' => {
    if (!holder.family_id) return 'single'
    if (motherAddresses.has(holder.holder_address)) return 'mother'
    return 'daughter'
  }

  const getHolderRank = (index: number): number => {
    return page * PAGE_SIZE + index + 1
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)
  const color = TOKEN_COLORS[tokenSymbol] || '#00D4FF'

  const renderRow = (holder: HolderLeagueAddress, rank: number, highlight = false) => {
    const status = getFamilyStatus(holder)
    const balanceHuman = parseFloat(holder.balance_raw) / (10 ** decimals)
    const usdValue = priceUsd ? balanceHuman * priceUsd : null

    return (
      <tr key={holder.holder_address + (highlight ? '-search' : '')} className={`border-b transition-colors ${highlight ? 'border-[#8000E0]/30 bg-[#8000E0]/10' : 'border-white/[0.03] hover:bg-white/[0.02]'}`}>
        <td className="py-2 px-3 text-xs text-gray-500 text-center font-mono">{rank > 0 ? rank : '—'}</td>
        <td className="py-2 px-3">
          <span className="inline-flex items-center gap-1.5 font-mono text-xs">
            <span className="text-white hidden sm:inline">{holder.holder_address}</span>
            <span className="text-white sm:hidden">{shortAddr(holder.holder_address)}</span>
            <CopyAddr address={holder.holder_address} />
            <a
              href={`${SCAN_URL}/address/${holder.holder_address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-600 hover:text-[#00D4FF] transition-colors"
              title={t.leagues.view_on_scan}
            >
              <ExternalLink className="h-3 w-3" />
            </a>
            <button
              className="text-gray-600 hover:text-purple-400 transition-colors"
              onClick={() => onClickAddress(holder.holder_address)}
              title={t.leagues.funding_genealogy}
            >
              <GitBranch className="h-3 w-3" />
            </button>
          </span>
        </td>
        <td className="py-2 px-3 text-right text-xs font-mono text-gray-300">
          {formatBalance(holder.balance_raw, decimals)}
        </td>
        <td className="py-2 px-3 text-right text-xs font-mono text-gray-400">
          {usdValue != null ? formatUsd(usdValue) : '—'}
        </td>
        <td className="py-2 px-3 text-center">
          {status === 'mother' && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-500/20 text-purple-300">
              {t.leagues.all_holders_mother}
            </span>
          )}
          {status === 'daughter' && (
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-gray-500/20 text-gray-400">
              {t.leagues.all_holders_daughter}
            </span>
          )}
          {status === 'single' && (
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-white/5 text-gray-600">
              {t.leagues.all_holders_single}
            </span>
          )}
        </td>
      </tr>
    )
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" onClick={onClose}>
      <div
        ref={modalRef}
        onClick={e => e.stopPropagation()}
        className="relative border border-white/10 rounded-2xl w-full flex flex-col overflow-hidden"
        style={{
          maxWidth: '90rem',
          height: '85vh',
          background: view === 'graph' ? '#1c1b22' : '#111827',
          boxShadow: '0 0 60px rgba(124,58,237,0.08), 0 25px 50px rgba(0,0,0,0.5)',
        }}
      >
        {view === 'holders' ? (
          <>
            {/* ─── Holders view ─── */}
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0" style={{ background: `linear-gradient(135deg, ${color}10, transparent)` }}>
              <div className="flex items-center gap-3">
                {TOKEN_LOGOS[tokenSymbol] && (
                  <img src={TOKEN_LOGOS[tokenSymbol]} alt={tokenSymbol} className="h-8 w-8 rounded-full" />
                )}
                <div>
                  <h2 className="text-lg font-bold text-white">{tokenSymbol} — {t.leagues.all_holders_title}</h2>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-gray-500">{totalCount.toLocaleString('en-US')} {t.leagues.addresses_count}</p>
                    {priceUsd != null && (
                      <span className="text-xs font-mono" style={{ color }}>
                        {priceUsd < 0.01
                          ? `$${parseFloat(priceUsd.toPrecision(4))}`
                          : `$${priceUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        }
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
                <X className="h-5 w-5 text-gray-400" />
              </button>
            </div>

            {/* Search bar */}
            <div className="px-5 py-3 border-b border-white/5 shrink-0">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-gray-500 shrink-0" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => { setSearchQuery(e.target.value); if (!e.target.value.trim()) clearSearch() }}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  placeholder={t.leagues.all_holders_search}
                  className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 outline-none font-mono"
                />
                {searchQuery && (
                  <button onClick={clearSearch} className="p-1 hover:bg-white/10 rounded transition-colors">
                    <X className="h-3 w-3 text-gray-500" />
                  </button>
                )}
                <button
                  onClick={handleSearch}
                  disabled={searchQuery.trim().length < 3}
                  className="rounded-lg bg-[#8000E0]/20 px-3 py-1.5 text-xs text-[#00D4FF] hover:bg-[#8000E0]/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {t.common.search}
                </button>
              </div>
            </div>

            {/* Search result — aligned with table columns, stays in search area */}
            {searchResult !== undefined && (
              <div className="border-b border-[#8000E0]/30 bg-[#8000E0]/10 shrink-0">
                {searchResult === null ? (
                  <p className="text-sm text-gray-500 px-5 py-2">{t.leagues.all_holders_no_results}</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#8000E0]/20 text-xs text-gray-500 uppercase tracking-wider">
                        <th className="py-1.5 px-3 text-center w-12">#</th>
                        <th className="py-1.5 px-3 text-left">{t.leagues.all_holders_address}</th>
                        <th className="py-1.5 px-3 text-right">{t.leagues.all_holders_balance}</th>
                        <th className="py-1.5 px-3 text-right">{t.leagues.all_holders_value}</th>
                        <th className="py-1.5 px-3 text-center w-20">{t.leagues.all_holders_family}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {renderRow(searchResult, searchRank, true)}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* Table */}
            <div className="flex-1 overflow-auto min-h-0">
              {loading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
                  <span className="ml-2 text-sm text-gray-500">{t.leagues.all_holders_loading}</span>
                </div>
              ) : holders.length === 0 ? (
                <div className="text-center py-16 text-sm text-gray-500">{t.leagues.all_holders_no_results}</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-900 z-10">
                    <tr className="border-b border-white/10 text-xs text-gray-500 uppercase tracking-wider">
                      <th className="py-2 px-3 text-center w-12">{t.leagues.all_holders_rank}</th>
                      <th className="py-2 px-3 text-left">{t.leagues.all_holders_address}</th>
                      <th className="py-2 px-3 text-right">{t.leagues.all_holders_balance}</th>
                      <th className="py-2 px-3 text-right">{t.leagues.all_holders_value}</th>
                      <th className="py-2 px-3 text-center w-20">{t.leagues.all_holders_family}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {holders.map((h, i) => renderRow(h, getHolderRank(i)))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-white/10 bg-white/[0.01] shrink-0">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="flex items-center gap-1 rounded-lg bg-white/5 px-3 py-1.5 text-xs text-gray-400 hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="h-3 w-3" />
                  {t.leagues.all_holders_prev}
                </button>
                <span className="text-xs text-gray-500">
                  {t.leagues.all_holders_page} {page + 1} {t.leagues.all_holders_of} {totalPages.toLocaleString('en-US')}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="flex items-center gap-1 rounded-lg bg-white/5 px-3 py-1.5 text-xs text-gray-400 hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {t.leagues.all_holders_next}
                  <ChevronRight className="h-3 w-3" />
                </button>
              </div>
            )}
          </>
        ) : (
          /* ─── Graph view (embedded FundingGraphContent) ─── */
          graphAddress && (
            <FundingGraphContent
              address={graphAddress}
              tokenSymbol={tokenSymbol}
              onClose={onClose}
              onBack={onBackToHolders}
            />
          )
        )}
      </div>
    </div>,
    document.body
  )
}

function CopyAddr({ address }: { address: string }) {
  const [copied, setCopied] = useState(false)
  const { t } = useTranslation()
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

function AddressLink({ address, onClickAddress }: { address: string; onClickAddress?: (addr: string) => void }) {
  const { t } = useTranslation()
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-xs">
      <button
        className="text-[#00D4FF] hover:underline cursor-pointer flex items-center gap-1"
        onClick={(e) => {
          e.stopPropagation()
          if (onClickAddress) onClickAddress(address)
        }}
        title={t.leagues.funding_genealogy}
      >
        <GitBranch className="h-3 w-3" />
        {shortAddr(address)}
      </button>
      <CopyAddr address={address} />
      <a
        href={`${SCAN_URL}/address/${address}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-gray-600 hover:text-[#00D4FF] transition-colors"
        onClick={e => e.stopPropagation()}
        title={t.leagues.view_on_scan}
      >
        <ExternalLink className="h-3 w-3" />
      </a>
    </span>
  )
}

// ── Address search component ────────────────────────────────

function AddressSearchResult({ address, onClickAddress }: { address: string; onClickAddress: (addr: string) => void }) {
  const { t } = useTranslation()
  const [results, setResults] = useState<{ token: string; tier: string; pct: number }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function search() {
      setLoading(true)
      const { data } = await supabase.from('holder_league_addresses')
        .select('token_symbol, tier, balance_pct')
        .eq('holder_address', address.toLowerCase())
      setResults((data || []).map(r => ({ token: r.token_symbol, tier: r.tier, pct: r.balance_pct })))
      setLoading(false)
    }
    search()
  }, [address])

  if (loading) return <div className="flex items-center gap-2 py-3"><Loader2 className="h-4 w-4 animate-spin text-gray-500" /><span className="text-sm text-gray-500">{t.leagues.searching}</span></div>

  if (results.length === 0) return <div className="py-3 text-sm text-gray-500">{t.leagues.address_not_found}</div>

  return (
    <div className="space-y-2 py-2">
      <div className="flex items-center gap-2 text-sm">
        <AddressLink address={address} onClickAddress={onClickAddress} />
      </div>
      <div className="flex flex-wrap gap-2">
        {results.map(r => {
          const tier = TIERS.find(t => t.key === r.tier)
          const color = TOKEN_COLORS[r.token] || '#00D4FF'
          return (
            <div key={`${r.token}-${r.tier}`} className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5">
              {TOKEN_LOGOS[r.token] && <img src={TOKEN_LOGOS[r.token]} alt={r.token} className="h-4 w-4 rounded-full" />}
              <span className="text-xs font-medium" style={{ color }}>{r.token}</span>
              {tier && <span className="text-xs" style={{ color: tier.color }}>{tier.emoji} {t.leagues[`tier_${tier.key}` as keyof typeof t.leagues]}</span>}
              <span className="text-[10px] text-gray-500 font-mono">{r.pct.toFixed(4)}%</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Expandable tier row with holders ────────────────────────

function TierHoldersList({ tokenSymbol, tierKey, onClickAddress }: { tokenSymbol: string; tierKey: string; onClickAddress: (addr: string) => void }) {
  const { t } = useTranslation()
  const [holders, setHolders] = useState<HolderLeagueAddress[]>([])
  const [families, setFamilies] = useState<HolderLeagueFamily[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedFamilies, setExpandedFamilies] = useState<Set<string>>(new Set())

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [holdersRes, familiesRes] = await Promise.all([
        supabase.from('holder_league_addresses')
          .select('*')
          .eq('token_symbol', tokenSymbol)
          .eq('tier', tierKey)
          .order('balance_pct', { ascending: false })
          .limit(200),
        supabase.from('holder_league_families')
          .select('*')
          .eq('token_symbol', tokenSymbol)
          .eq('combined_tier', tierKey)
          .order('combined_balance_pct', { ascending: false })
          .limit(50),
      ])
      setHolders(holdersRes.data || [])
      setFamilies(familiesRes.data || [])
      setLoading(false)
    }
    load()
  }, [tokenSymbol, tierKey])

  const toggleFamily = (familyId: string) => {
    setExpandedFamilies(prev => {
      const next = new Set(prev)
      if (next.has(familyId)) next.delete(familyId)
      else next.add(familyId)
      return next
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-gray-500" />
      </div>
    )
  }

  if (holders.length === 0) {
    return (
      <div className="text-center py-4 text-sm text-gray-500">
        {t.leagues.no_holder_data}
      </div>
    )
  }

  // Group holders: families first, then solo
  const familyIds = new Set(families.map(f => f.family_id))
  const familyHolders = new Map<string, HolderLeagueAddress[]>()
  const soloHolders: HolderLeagueAddress[] = []

  for (const h of holders) {
    if (h.family_id && familyIds.has(h.family_id)) {
      if (!familyHolders.has(h.family_id)) familyHolders.set(h.family_id, [])
      familyHolders.get(h.family_id)!.push(h)
    } else {
      soloHolders.push(h)
    }
  }

  return (
    <div className="space-y-1 px-4 pb-4">
      {/* Families */}
      {families.map(family => {
        const members = familyHolders.get(family.family_id) || []
        const isExpanded = expandedFamilies.has(family.family_id)
        const mother = members.find(m => m.holder_address === family.mother_address)
        const daughters = members.filter(m => m.holder_address !== family.mother_address)

        return (
          <div key={family.family_id} className="rounded-lg border border-purple-500/20 bg-purple-500/5 overflow-hidden">
            <button
              onClick={() => toggleFamily(family.family_id)}
              className="w-full flex items-center gap-3 px-3 py-2 hover:bg-purple-500/10 transition-colors text-left"
            >
              {isExpanded
                ? <ChevronDown className="h-4 w-4 text-purple-400 shrink-0" />
                : <ChevronRight className="h-4 w-4 text-purple-400 shrink-0" />
              }
              <Link2 className="h-3.5 w-3.5 text-purple-400 shrink-0" />
              <span className="text-xs text-purple-300 font-medium">
                {t.leagues.family_label} ({1 + family.daughter_count} {t.leagues.addresses_count})
              </span>
              {family.confidence_score != null && (
                family.confidence_score >= 0.70
                  ? <span title={`${t.leagues.heuristic_confirmed} (${Math.round(family.confidence_score * 100)}%)`}><ShieldCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" /></span>
                  : <span title={`${t.leagues.heuristic_probable} (${Math.round(family.confidence_score * 100)}%)`}><ShieldQuestion className="h-3.5 w-3.5 text-amber-400 shrink-0" /></span>
              )}
              <span className="text-xs text-gray-500 ml-auto">
                Combined: {family.combined_balance_pct.toFixed(4)}%
                {family.combined_tier !== family.individual_tier && (
                  <span className="ml-2 text-amber-400">
                    {family.individual_tier} → {family.combined_tier}
                  </span>
                )}
              </span>
            </button>
            {isExpanded && (
              <div className="border-t border-purple-500/10 px-3 py-2 space-y-1.5">
                {/* Mother */}
                {mother && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 text-[10px] font-bold">{t.leagues.mother_role}</span>
                    <AddressLink address={mother.holder_address} onClickAddress={onClickAddress} />
                    <span className="text-gray-400 ml-auto font-mono">{mother.balance_pct.toFixed(4)}%</span>
                  </div>
                )}
                {/* Daughters */}
                {daughters.map(d => (
                  <div key={d.holder_address} className="flex items-center gap-2 text-xs pl-6">
                    <span className="px-1.5 py-0.5 rounded bg-gray-500/20 text-gray-400 text-[10px]">{t.leagues.child_role}</span>
                    <AddressLink address={d.holder_address} onClickAddress={onClickAddress} />
                    <span className="text-gray-500 ml-auto font-mono">{d.balance_pct.toFixed(4)}%</span>
                  </div>
                ))}
                {/* Link types */}
                {family.link_types && family.link_types.length > 0 && (
                  <div className="flex gap-1.5 pt-1">
                    {family.link_types.map(lt => (
                      <span key={lt} className="px-1.5 py-0.5 rounded text-[10px] bg-white/5 text-gray-500 border border-white/5 whitespace-nowrap">
                        {lt.replace('_', ' ')}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* Solo holders */}
      {soloHolders.map(h => (
        <div key={h.holder_address} className="flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-white/[0.02] transition-colors">
          <AddressLink address={h.holder_address} onClickAddress={onClickAddress} />
          <span className="text-xs text-gray-500 ml-auto font-mono">{h.balance_pct.toFixed(4)}%</span>
        </div>
      ))}

      {holders.length >= 200 && (
        <p className="text-center text-[10px] text-gray-600 pt-2">{t.leagues.showing_top_200}</p>
      )}
    </div>
  )
}

// ── Live price with flash animation ─────────────────────────

function LivePrice({ priceUsd }: { priceUsd: number | null }) {
  const prevPriceRef = useRef<number | null>(null)
  const [flashColor, setFlashColor] = useState<'none' | 'up' | 'down'>('none')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (priceUsd == null) return
    const prev = prevPriceRef.current
    if (prev != null && priceUsd !== prev) {
      const dir = priceUsd > prev ? 'up' : 'down'
      setFlashColor(dir)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setFlashColor('none'), 4000)
    }
    prevPriceRef.current = priceUsd
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [priceUsd])

  if (priceUsd == null) return null

  const formatted = priceUsd < 0.01
    ? `$${parseFloat(priceUsd.toPrecision(4))}`
    : `$${priceUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const colorValue = flashColor === 'up' ? '#10b981' : flashColor === 'down' ? '#ef4444' : '#ffffff'

  return (
    <p className="text-xs font-mono mt-0.5 flex items-center gap-1.5" style={{ color: colorValue, transition: 'color 1s ease-in-out' }}>
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
      </span>
      Price: {formatted}
    </p>
  )
}

// ── Token card ──────────────────────────────────────────────

function TokenCard({ league, onClickAddress, onSeeAllHolders, priceUsd }: { league: HolderLeagueCurrent; onClickAddress: (addr: string) => void; onSeeAllHolders: (tokenSymbol: string) => void; priceUsd: number | null }) {
  const { t } = useTranslation()
  const color = TOKEN_COLORS[league.token_symbol] || '#00D4FF'
  const [expandedTier, setExpandedTier] = useState<string | null>(null)

  const isPending = league.total_holders === 0 && !league.updated_at

  return (
    <div className="rounded-2xl border border-white/5 bg-white/[0.02] backdrop-blur-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-white/5" style={{ background: `linear-gradient(135deg, ${color}10, transparent)` }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {TOKEN_LOGOS[league.token_symbol] && (
              <img src={TOKEN_LOGOS[league.token_symbol]} alt={league.token_symbol} className="h-10 w-10 rounded-full" />
            )}
            <div>
              <h3 className="text-lg font-bold text-white">{league.token_symbol} {t.leagues.holders_suffix}</h3>
              <p className="text-xs text-gray-400">{TOKEN_DESC_KEYS[league.token_symbol] ? t.leagues[TOKEN_DESC_KEYS[league.token_symbol] as keyof typeof t.leagues] : t.leagues.token_holders_fallback}</p>
              <LivePrice priceUsd={priceUsd} />
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-white">{isPending ? '—' : league.total_holders.toLocaleString('en-US')}</div>
            <div className="text-xs text-gray-500">{isPending ? t.leagues.awaiting_scrape : t.leagues.addresses_count}</div>
            {!isPending && league.total_entities != null && league.total_entities > 0 && league.total_entities < league.total_holders && (
              <div className="text-xs text-emerald-400 mt-0.5">~{league.total_entities.toLocaleString('en-US')} {t.leagues.entities_label}</div>
            )}
            {!isPending && (
              <button
                onClick={() => onSeeAllHolders(league.token_symbol)}
                className="mt-2 rounded-lg bg-white/5 border border-white/10 px-3 py-1 text-xs text-[#00D4FF] hover:bg-white/10 transition-colors"
              >
                {t.leagues.see_all_holders}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tiers — desktop */}
      <div className="hidden sm:block">
        <div className="grid grid-cols-5 text-xs text-gray-500 uppercase tracking-wider px-5 py-3">
          <span>{t.leagues.table_league}</span>
          <span className="text-right">{t.leagues.table_supply_pct}</span>
          <span className="text-right">{t.leagues.table_tokens_required}</span>
          <span className="text-right">{t.leagues.table_addresses}</span>
          <span className="text-right">{t.leagues.table_entities}</span>
        </div>
        {TIERS.map((tier) => {
          const count = league[`${tier.key}_count` as keyof HolderLeagueCurrent] as number
          const isExpanded = expandedTier === tier.key

          const entityCount = league[`${tier.key}_entities` as keyof HolderLeagueCurrent] as number | null
          const entityReady = league.total_entities != null && league.total_entities > 0

          return (
            <div key={tier.key}>
              <div
                className={`grid grid-cols-5 items-center border-t border-white/[0.03] transition-colors cursor-pointer px-5 py-3 ${
                  isExpanded ? 'bg-white/[0.03]' : 'hover:bg-white/[0.02]'
                }`}
                onClick={() => setExpandedTier(isExpanded ? null : tier.key)}
              >
                <div className="flex items-center gap-2">
                  {isExpanded
                    ? <ChevronDown className="h-3.5 w-3.5 text-gray-500" />
                    : <ChevronRight className="h-3.5 w-3.5 text-gray-500" />
                  }
                  <span className="text-lg">{tier.emoji}</span>
                  <span className="text-sm font-medium" style={{ color: tier.color }}>{t.leagues[`tier_${tier.key}` as keyof typeof t.leagues]}</span>
                </div>
                <div className="text-right text-sm text-gray-400">{formatPct(tier.pct)}</div>
                <div className="text-right text-sm text-gray-300 font-mono">
                  {tokensRequired(league.total_supply_human, tier.pct)}
                </div>
                <div className="text-right">
                  <span className="text-sm font-bold" style={{ color }}>
                    {count.toLocaleString('en-US')}
                  </span>
                </div>
                <div className="text-right">
                  {entityReady ? (
                    <span className="text-sm font-bold text-emerald-400">
                      {(entityCount ?? count).toLocaleString('en-US')}
                    </span>
                  ) : (
                    <span className="text-sm text-gray-600">—</span>
                  )}
                </div>
              </div>
              {isExpanded && (
                <div className="bg-white/[0.01] border-t border-white/[0.03]">
                  <TierHoldersList tokenSymbol={league.token_symbol} tierKey={tier.key} onClickAddress={onClickAddress} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Tiers — mobile cards */}
      <div className="sm:hidden divide-y divide-white/[0.03]">
        {TIERS.map((tier) => {
          const count = league[`${tier.key}_count` as keyof HolderLeagueCurrent] as number
          const isExpanded = expandedTier === tier.key

          return (
            <div key={tier.key}>
              <div
                className={`px-4 py-3 transition-colors cursor-pointer ${isExpanded ? 'bg-white/[0.03]' : 'hover:bg-white/[0.02]'}`}
                onClick={() => setExpandedTier(isExpanded ? null : tier.key)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {isExpanded
                      ? <ChevronDown className="h-3.5 w-3.5 text-gray-500" />
                      : <ChevronRight className="h-3.5 w-3.5 text-gray-500" />
                    }
                    <span className="text-lg">{tier.emoji}</span>
                    <span className="text-sm font-medium" style={{ color: tier.color }}>{t.leagues[`tier_${tier.key}` as keyof typeof t.leagues]}</span>
                  </div>
                  <span className="text-sm font-bold" style={{ color }}>{count.toLocaleString('en-US')}</span>
                </div>
                <div className="flex items-center gap-4 mt-1 ml-9 text-xs text-gray-500">
                  <span>≥ {formatPct(tier.pct)}</span>
                  <span className="font-mono text-gray-400">{tokensRequired(league.total_supply_human, tier.pct)} {t.leagues.tokens_suffix}</span>
                </div>
              </div>
              {isExpanded && (
                <div className="bg-white/[0.01] border-t border-white/[0.03]">
                  <TierHoldersList tokenSymbol={league.token_symbol} tierKey={tier.key} onClickAddress={onClickAddress} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Cross-token comparison table ────────────────────────────

function ComparisonTable({ leagues }: { leagues: HolderLeagueCurrent[] }) {
  const { t } = useTranslation()
  if (leagues.length < 2) return null

  return (
    <div className="rounded-2xl border border-white/5 bg-white/[0.02] backdrop-blur-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-white/5">
        <h2 className="text-lg font-bold text-white">{t.leagues.cross_token_title}</h2>
        <p className="text-xs text-gray-400 mt-1">{t.leagues.cross_token_desc}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5 text-xs text-gray-500 uppercase tracking-wider">
              <th className="py-3 px-4 text-left">{t.leagues.table_tier}</th>
              {leagues.map(l => (
                <th key={l.token_symbol} className="py-3 px-4 text-center">
                  <div className="flex items-center justify-center gap-1.5">
                    {TOKEN_LOGOS[l.token_symbol] && <img src={TOKEN_LOGOS[l.token_symbol]} alt={l.token_symbol} className="h-4 w-4 rounded-full" />}
                    <span style={{ color: TOKEN_COLORS[l.token_symbol] }}>{l.token_symbol}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TIERS.map(tier => (
              <tr key={tier.key} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                <td className="py-2.5 px-4">
                  <div className="flex items-center gap-2">
                    <span>{tier.emoji}</span>
                    <span className="text-sm" style={{ color: tier.color }}>{t.leagues[`tier_${tier.key}` as keyof typeof t.leagues]}</span>
                  </div>
                </td>
                {leagues.map(l => {
                  const entityCount = l[`${tier.key}_entities` as keyof HolderLeagueCurrent] as number | null
                  const addrCount = l[`${tier.key}_count` as keyof HolderLeagueCurrent] as number
                  const entityReady = l.total_entities != null && l.total_entities > 0
                  const display = entityReady ? (entityCount ?? addrCount) : addrCount
                  return (
                    <td key={l.token_symbol} className="py-2.5 px-4 text-center font-bold text-white">
                      {display > 0 ? display.toLocaleString('en-US') : <span className="text-gray-600">0</span>}
                    </td>
                  )
                })}
              </tr>
            ))}
            <tr className="border-t border-white/10">
              <td className="py-2.5 px-4 text-sm font-semibold text-gray-400">Total</td>
              {leagues.map(l => {
                const entityReady = l.total_entities != null && l.total_entities > 0
                return (
                  <td key={l.token_symbol} className="py-2.5 px-4 text-center text-sm font-bold" style={{ color: TOKEN_COLORS[l.token_symbol] }}>
                    {(entityReady ? l.total_entities! : l.total_holders).toLocaleString('en-US')}
                  </td>
                )
              })}
            </tr>
            <tr className="border-t border-white/[0.03]">
              <td className="py-2.5 px-4 text-sm text-gray-500">{t.leagues.kpi_addresses}</td>
              {leagues.map(l => (
                <td key={l.token_symbol} className="py-2.5 px-4 text-center text-sm text-gray-500">
                  {l.total_holders.toLocaleString('en-US')}
                </td>
              ))}
            </tr>
            {leagues.some(l => l.family_count != null && l.family_count > 0) && (
              <tr className="border-t border-white/[0.03]">
                <td className="py-2.5 px-4 text-sm text-gray-500">{t.leagues.families_label}</td>
                {leagues.map(l => (
                  <td key={l.token_symbol} className="py-2.5 px-4 text-center text-sm text-emerald-400/60">
                    {(l.family_count ?? 0) > 0 ? l.family_count : '—'}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Main page ───────────────────────────────────────────────

export function LeaguesPage() {
  const { t } = useTranslation()
  const { data: leagues, loading, error } = useHolderLeagues()
  const { data: tokenPrices } = useTokenPrices()
  const [modalAddress, setModalAddress] = useState<string | null>(null)
  const [modalTokenSymbol, setModalTokenSymbol] = useState<string>('PLS')
  const [allHoldersToken, setAllHoldersToken] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchAddr, setSearchAddr] = useState<string | null>(null)

  const TOKEN_ADDRESSES: Record<string, string> = {
    PLS: '0xa1077a294dde1b09bb078844df40758a5d0f9a27',
    PLSX: '0x95b303987a60c71504d99aa1b13b4da07b0790ab',
    HEX: '0x2b591e99afe9f32eaa6214f7b7629768c40eeb39',
    INC: '0x2fa878ab3f87cc1c9737fc071108f904c0b0c95d',
    PRVX: '0xf6f8db0aba00007681f8faf16a0fda1c9b030b11',
  }

  const sorted = useMemo(() =>
    TOKEN_ORDER.map((sym) => {
      const found = leagues.find((l) => l.token_symbol === sym)
      if (found) return found
      // Placeholder for tokens not yet scraped
      return {
        token_symbol: sym,
        token_address: TOKEN_ADDRESSES[sym] || '',
        total_holders: 0,
        total_supply: '0',
        total_supply_human: 0,
        poseidon_count: 0,
        whale_count: 0,
        shark_count: 0,
        dolphin_count: 0,
        squid_count: 0,
        turtle_count: 0,
        total_entities: null,
        poseidon_entities: null,
        whale_entities: null,
        shark_entities: null,
        dolphin_entities: null,
        squid_entities: null,
        turtle_entities: null,
        family_count: null,
        updated_at: '',
      } as HolderLeagueCurrent
    }),
    [leagues]
  )

  // Aggregate KPIs from all tokens
  const totalHolders = sorted.reduce((sum, l) => sum + l.total_holders, 0)
  const totalWhales = sorted.reduce((sum, l) => sum + l.whale_count, 0)
  const totalSharks = sorted.reduce((sum, l) => sum + l.shark_count, 0)
  const totalPoseidons = sorted.reduce((sum, l) => sum + l.poseidon_count, 0)
  // Entity data is "ready" only if scraper has run with new code (total_entities > 0)
  const hasEntityData = sorted.some(l => l.total_entities != null && l.total_entities > 0)
  const totalEntities = hasEntityData ? sorted.reduce((sum, l) => sum + (l.total_entities ?? l.total_holders), 0) : 0
  const totalFamilies = hasEntityData ? sorted.reduce((sum, l) => sum + (l.family_count ?? 0), 0) : 0

  // Build price map: token_symbol -> price_usd
  const priceMap = useMemo(() => {
    const map: Record<string, number> = {}
    const symbolMap: Record<string, string> = { PLS: 'PLS', PLSX: 'PLSX', HEX: 'HEX', INC: 'INC', PRVX: 'PRVX' }
    for (const [sym, addr] of Object.entries(TOKEN_ADDRESSES)) {
      const tp = tokenPrices.find(p =>
        p.id?.toLowerCase() === addr.toLowerCase() ||
        p.address?.toLowerCase() === addr.toLowerCase() ||
        p.symbol?.toUpperCase() === (symbolMap[sym] ?? sym).toUpperCase()
      )
      if (tp?.price_usd) map[sym] = tp.price_usd
    }
    return map
  }, [tokenPrices])

  const handleSearch = () => {
    const q = searchQuery.trim().toLowerCase()
    if (q.length === 42 && q.startsWith('0x')) {
      setSearchAddr(q)
    } else {
      setSearchAddr(null)
    }
  }

  // Error state
  if (error && sorted.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">{t.leagues.title}</h1>
            <p className="text-gray-400 mt-1">{t.leagues.description}</p>
          </div>
          <ShareButton title={t.leagues.title} text={t.leagues.description} />
        </div>
        <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-6 text-center space-y-3">
          <AlertTriangle className="h-8 w-8 text-orange-400 mx-auto" />
          <p className="text-orange-400">{t.leagues.failed_to_load}</p>
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
      <div className="rounded-2xl border border-white/5 bg-gradient-to-br from-amber-500/5 via-purple-500/5 to-cyan-500/5 backdrop-blur-sm p-5 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-xl bg-amber-400/10 border border-amber-400/20">
                <Crown className="h-6 w-6 text-amber-400" />
              </div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-amber-300 to-purple-400 bg-clip-text text-transparent">
                {t.leagues.title}
              </h1>
              <ShareButton title={t.leagues.title} text={t.leagues.description} />
            </div>
            <p className="text-gray-400 max-w-xl text-sm whitespace-pre-line">
              {t.leagues.hero_description}
            </p>
          </div>
          {sorted.length > 0 && (
            <div className="flex flex-wrap gap-3">
              <div className="text-center px-4 py-2 rounded-xl bg-white/[0.03] border border-white/5">
                <div className="text-lg font-bold text-white">{totalHolders.toLocaleString('en-US')}</div>
                <div className="text-[10px] text-gray-500 uppercase tracking-wider">{t.leagues.kpi_addresses}</div>
                {hasEntityData && totalEntities < totalHolders && (
                  <div className="text-[10px] text-emerald-400 mt-0.5">~{totalEntities.toLocaleString('en-US')} {t.leagues.entities_label}</div>
                )}
              </div>
              <div className="text-center px-4 py-2 rounded-xl bg-amber-500/5 border border-amber-500/10">
                <div className="text-lg font-bold text-amber-400">{totalPoseidons}</div>
                <div className="text-[10px] text-gray-500 uppercase tracking-wider">{t.leagues.tier_poseidon}s</div>
              </div>
              <div className="text-center px-4 py-2 rounded-xl bg-purple-500/5 border border-purple-500/10">
                <div className="text-lg font-bold text-purple-400">{totalWhales}</div>
                <div className="text-[10px] text-gray-500 uppercase tracking-wider">{t.leagues.tier_whale}s</div>
              </div>
              <div className="text-center px-4 py-2 rounded-xl bg-cyan-500/5 border border-cyan-500/10">
                <div className="text-lg font-bold text-cyan-400">{totalSharks}</div>
                <div className="text-[10px] text-gray-500 uppercase tracking-wider">{t.leagues.tier_shark}s</div>
              </div>
              {hasEntityData && totalFamilies > 0 && (
                <div className="text-center px-4 py-2 rounded-xl bg-emerald-500/5 border border-emerald-500/10">
                  <div className="text-lg font-bold text-emerald-400">{totalFamilies}</div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider">{t.leagues.kpi_families}</div>
                </div>
              )}
            </div>
          )}
        </div>
        {sorted.length > 0 && sorted[0].updated_at && (
          <div className="mt-3 text-[10px] text-gray-600">
            {t.leagues.data_source_info} {new Date(sorted[0].updated_at).toLocaleString('en-US')}
          </div>
        )}
      </div>

      {/* Address search */}
      <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-gray-500 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); if (e.target.value.trim().length !== 42) setSearchAddr(null) }}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder={t.leagues.search_placeholder}
            className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 outline-none"
          />
          <button
            onClick={handleSearch}
            disabled={searchQuery.trim().length !== 42}
            className="rounded-lg bg-[#8000E0]/20 px-3 py-1.5 text-xs text-[#00D4FF] hover:bg-[#8000E0]/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {t.common.search}
          </button>
        </div>
        {searchAddr && (
          <AddressSearchResult address={searchAddr} onClickAddress={setModalAddress} />
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-32">
          <Loader2 className="h-8 w-8 animate-spin text-[#00D4FF]" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <Users className="h-12 w-12 text-gray-600 mb-4" />
          <h2 className="text-lg font-semibold text-gray-400 mb-2">{t.leagues.no_data_title}</h2>
          <p className="text-sm text-gray-500">{t.leagues.no_data_desc}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {sorted.map((league) => (
              <TokenCard key={league.token_symbol} league={league} onClickAddress={(addr) => { setModalAddress(addr); setModalTokenSymbol(league.token_symbol) }} onSeeAllHolders={setAllHoldersToken} priceUsd={priceMap[league.token_symbol] ?? null} />
            ))}
          </div>

          {/* Cross-token comparison */}
          <ComparisonTable leagues={sorted} />
        </>
      )}

      {/* Methodology */}
      {hasEntityData && (
        <div className="rounded-2xl border border-white/5 bg-white/[0.02] backdrop-blur-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-white/5">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-gray-400" />
              <h2 className="text-sm font-bold text-white">{t.leagues.methodology_title}</h2>
            </div>
          </div>
          <div className="px-5 py-4 space-y-3 text-xs text-gray-400 leading-relaxed">
            <p>
              <span className="text-white font-medium">{t.leagues.methodology_addresses}</span> {t.leagues.methodology_addresses_desc}
            </p>
            <p>
              <span className="text-emerald-400 font-medium">{t.leagues.methodology_entities}</span> {t.leagues.methodology_entities_desc}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pl-2">
              <div className="flex items-start gap-2">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" />
                <span><span className="text-emerald-300">{t.leagues.heuristic_confirmed}</span> — {t.leagues.heuristic_confirmed_desc}</span>
              </div>
              <div className="flex items-start gap-2">
                <ShieldQuestion className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
                <span><span className="text-amber-300">{t.leagues.heuristic_probable}</span> — {t.leagues.heuristic_probable_desc}</span>
              </div>
            </div>
            <p className="text-gray-500">
              {t.leagues.methodology_note}
            </p>
          </div>
        </div>
      )}

      {/* Token logos row — moved to shared Footer component */}

      {/* Funding graph modal */}
      {modalAddress && (
        <FundingGraphModal
          address={modalAddress}
          tokenSymbol={modalTokenSymbol}
          onClose={() => setModalAddress(null)}
        />
      )}

      {/* All holders modal */}
      {allHoldersToken && (
        <AllHoldersModal
          tokenSymbol={allHoldersToken}
          totalHolders={sorted.find(l => l.token_symbol === allHoldersToken)?.total_holders ?? 0}
          priceUsd={priceMap[allHoldersToken] ?? null}
          onClose={() => setAllHoldersToken(null)}
        />
      )}
    </div>
  )
}
