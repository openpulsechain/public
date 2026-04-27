import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { Github, Menu, X, Search, Loader2, Globe, Network } from 'lucide-react'
import TransactionTraceModal from '../TransactionTraceModal'
import { RpcStatusIndicator } from '../ui/RpcStatusIndicator'
import { Component, type ReactNode, type ErrorInfo } from 'react'
import { supabase } from '../../lib/supabase'
import { useTranslation } from '../../i18n'
import type { Language } from '../../i18n'

class StatusErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  componentDidCatch(_: Error, info: ErrorInfo) { console.error('RpcStatus error:', _, info) }
  render() { return this.state.hasError ? null : this.props.children }
}

interface HeaderProps {
  activePage: string
  onNavigate: (page: string) => void
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/

const NAV_KEYS: Record<string, string> = {
  overview: 'nav_overview',
  dex: 'nav_dex',
  tokens: 'nav_tokens',
  safety: 'nav_safety',
  'smart-money': 'nav_smart_money',
  bridge: 'nav_bridge',
  whales: 'nav_whales',
  leagues: 'nav_leagues',
  intelligence: 'nav_intelligence',
  'heart-law': 'nav_heart_law',
  api: 'nav_api',
}

const PAGES = [
  { id: 'overview', path: '/' },
  { id: 'dex', path: '/dex' },
  { id: 'tokens', path: '/tokens' },
  { id: 'safety', path: '/safety' },
  { id: 'smart-money', path: '/smart-money' },
  { id: 'bridge', path: '/bridge' },
  { id: 'whales', path: '/whales' },
  { id: 'leagues', path: '/leagues' },
  { id: 'intelligence', path: '/intelligence' },
  { id: 'heart-law', path: '/heart-law' },
  { id: 'api', path: '/api' },
]

const LANGUAGES: { code: Language; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
]

function LanguageSelector({ className }: { className?: string }) {
  const { t, language, setLanguage } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className={`relative ${className || ''}`}>
      <button
        onClick={() => setOpen(!open)}
        className="text-gray-400 hover:text-[#00D4FF] transition-colors p-1"
        title={t.header.language}
      >
        <Globe className="h-5 w-5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-32 rounded-lg border border-white/10 bg-gray-950/95 backdrop-blur-xl shadow-2xl overflow-hidden z-50">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              onClick={() => { setLanguage(lang.code); setOpen(false) }}
              className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                language === lang.code
                  ? 'bg-[#8000E0]/20 text-[#00D4FF]'
                  : 'text-gray-300 hover:bg-white/5'
              }`}
            >
              {lang.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface TokenSuggestion {
  address: string
  symbol: string
  name: string
}

export function Header({ activePage }: HeaderProps) {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [suggestions, setSuggestions] = useState<TokenSuggestion[]>([])
  const [selectedIdx, setSelectedIdx] = useState(-1)
  const [traceHash, setTraceHash] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const navigate = useNavigate()

  // Focus input when search opens
  useEffect(() => {
    if (searchOpen && searchRef.current) searchRef.current.focus()
  }, [searchOpen])

  // Keyboard shortcut: / to open search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '/' && !searchOpen && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault()
        setSearchOpen(true)
      }
      if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false)
        setSearchQuery('')
        setSearchError('')
        setSuggestions([])
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [searchOpen])

  // Debounced token name search
  const searchTokens = useCallback((query: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = query.trim()
    if (!q || q.length < 2 || ADDRESS_RE.test(q)) {
      setSuggestions([])
      setSelectedIdx(-1)
      return
    }
    debounceRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from('pulsechain_tokens')
        .select('address, symbol, name')
        .or(`symbol.ilike.%${q}%,name.ilike.%${q}%`)
        .limit(8)
      setSuggestions(data || [])
      setSelectedIdx(-1)
    }, 250)
  }, [])

  function selectSuggestion(token: TokenSuggestion) {
    navigate(`/token/${token.address}`)
    setSearchOpen(false)
    setSearchQuery('')
    setSuggestions([])
    setSearchError('')
  }

  function handleSearchKeyDown(e: React.KeyboardEvent) {
    if (suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIdx(prev => Math.min(prev + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIdx(prev => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter' && selectedIdx >= 0) {
      e.preventDefault()
      selectSuggestion(suggestions[selectedIdx])
    }
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const query = searchQuery.trim()
    if (!query) return

    // If it's a transaction hash, open trace modal
    if (TX_HASH_RE.test(query)) {
      setTraceHash(query.toLowerCase())
      setSearchOpen(false)
      setSearchQuery('')
      setSuggestions([])
      return
    }

    // If it's a valid address, detect type and navigate
    if (ADDRESS_RE.test(query)) {
      const addr = query.toLowerCase()
      setSearching(true)
      setSearchError('')
      setSuggestions([])

      try {
        // Check if it's a token (has token info on Scan API)
        const res = await fetch(`https://api.scan.pulsechain.com/api/v2/tokens/${addr}`)
        if (res.ok) {
          const data = await res.json()
          if (data.type === 'ERC-20' || data.type === 'ERC-721' || data.type === 'ERC-1155' || data.symbol) {
            navigate(`/token/${addr}`)
            setSearchOpen(false)
            setSearchQuery('')
            setSearching(false)
            return
          }
        }
      } catch {
        // Not a token, treat as wallet
      }

      // Default: treat as wallet
      navigate(`/wallet/${addr}`)
      setSearchOpen(false)
      setSearchQuery('')
      setSearching(false)
      return
    }

    // Not an address — try to find token by name/symbol
    if (suggestions.length > 0) {
      selectSuggestion(suggestions[0])
      return
    }

    // Search database directly
    const { data } = await supabase
      .from('pulsechain_tokens')
      .select('address, symbol, name')
      .or(`symbol.ilike.%${query}%,name.ilike.%${query}%`)
      .limit(1)

    if (data && data.length > 0) {
      selectSuggestion(data[0])
      return
    }

    setSearchError(t.header.search_not_found)
  }

  function getNavLabel(pageId: string): string {
    const key = NAV_KEYS[pageId] as keyof typeof t.header
    return key ? t.header[key] : pageId
  }

  return (
    <>
    <header className="border-b border-white/5 bg-gray-950/60 backdrop-blur-xl overflow-visible relative z-40">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-1.5">
        <Link to="/" className="flex items-center gap-1.5">
          <img src="/logo.png" alt="OpenPulsechain" className="h-8 w-auto" />
          <span className="text-lg font-bold bg-gradient-to-r from-[#00D4FF] to-[#8000E0] bg-clip-text text-transparent">OpenPulsechain</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-0.5">
          {PAGES.map((page) => (
            <Link
              key={page.id}
              to={page.path}
              className={`flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                activePage === page.id
                  ? 'bg-[#8000E0]/20 text-[#00D4FF] border border-[#8000E0]/30'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              } ${page.id === 'safety' ? 'text-emerald-400' : ''}`}
            >
              
              {getNavLabel(page.id)}
            </Link>
          ))}
          <button
            onClick={() => setSearchOpen(true)}
            className="ml-3 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:text-white hover:bg-white/5 border border-white/10 transition-colors"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">{t.common.search}</span>
            <kbd className="hidden lg:inline ml-1 text-[10px] text-gray-600 bg-white/5 px-1.5 py-0.5 rounded">/</kbd>
          </button>
          <StatusErrorBoundary><RpcStatusIndicator /></StatusErrorBoundary>
          <a
            href="https://github.com/openpulsechain/public"
            target="_blank"
            rel="noopener noreferrer"
            className="ml-1 text-gray-400 hover:text-[#00D4FF] transition-colors"
          >
            <Github className="h-5 w-5" />
          </a>
          <LanguageSelector className="ml-1" />
        </nav>

        {/* Mobile: status + search + lang + hamburger */}
        <div className="flex items-center gap-2 md:hidden">
          <StatusErrorBoundary><RpcStatusIndicator /></StatusErrorBoundary>
          <button
            onClick={() => setSearchOpen(true)}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <Search className="h-5 w-5" />
          </button>
          <LanguageSelector />
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="text-gray-400 hover:text-white transition-colors"
          >
            {menuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden border-t border-white/5 bg-gray-950/90 backdrop-blur-xl px-4 py-3 space-y-1">
          {PAGES.map((page) => (
            <Link
              key={page.id}
              to={page.path}
              onClick={() => setMenuOpen(false)}
              className={`flex items-center gap-2 w-full rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                activePage === page.id
                  ? 'bg-[#8000E0]/20 text-[#00D4FF]'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              
              {getNavLabel(page.id)}
            </Link>
          ))}
          <a
            href="https://github.com/openpulsechain/public"
            target="_blank"
            rel="noopener noreferrer"
            className="block px-4 py-2.5 text-sm text-gray-400 hover:text-[#00D4FF] transition-colors"
          >
            GitHub
          </a>
        </div>
      )}
    </header>
    {/* Search overlay — rendered via portal to escape header stacking context */}
    {searchOpen && createPortal(
      <div
        className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]"
        onClick={() => { setSearchOpen(false); setSearchQuery(''); setSearchError('') }}
      >
        <div
          className="w-full max-w-lg mx-4 rounded-2xl border border-white/10 bg-gray-950/95 backdrop-blur-xl shadow-2xl p-4"
          onClick={e => e.stopPropagation()}
        >
          <form onSubmit={handleSearch} className="flex items-center gap-3">
            {searching ? (
              <Loader2 className="h-5 w-5 text-[#00D4FF] animate-spin shrink-0" />
            ) : (
              <Search className="h-5 w-5 text-gray-500 shrink-0" />
            )}
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setSearchError(''); searchTokens(e.target.value) }}
              onKeyDown={handleSearchKeyDown}
              placeholder={t.header.search_placeholder}
              className="flex-1 bg-transparent text-white text-lg placeholder-gray-600 outline-none"
              spellCheck={false}
              autoComplete="off"
            />
            <kbd className="text-xs text-gray-600 bg-white/5 px-2 py-1 rounded border border-white/10">ESC</kbd>
          </form>
          {suggestions.length > 0 && (
            <div className="mt-2 border border-white/10 rounded-xl overflow-hidden bg-gray-900/95">
              {suggestions.map((token, i) => (
                <button
                  key={token.address}
                  onClick={() => selectSuggestion(token)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    i === selectedIdx ? 'bg-[#8000E0]/20 text-white' : 'text-gray-300 hover:bg-white/5'
                  } ${i > 0 ? 'border-t border-white/5' : ''}`}
                >
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-sm">{token.symbol}</span>
                    <span className="text-gray-500 text-xs ml-2 truncate">{token.name}</span>
                  </div>
                  <span className="text-[10px] text-gray-600 font-mono shrink-0">{token.address.slice(0, 6)}...{token.address.slice(-4)}</span>
                </button>
              ))}
            </div>
          )}
          {searchError && (
            <p className="mt-3 text-sm text-red-400">{searchError}</p>
          )}
          {TX_HASH_RE.test(searchQuery.trim()) && (
            <div className="mt-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-purple-500/10 border border-purple-500/20">
              <Network className="w-4 h-4 text-purple-400" />
              <span className="text-xs text-purple-300">Transaction hash detected — press Enter to view trace</span>
            </div>
          )}
          <p className="mt-3 text-xs text-gray-600">
            {t.header.search_hint}
          </p>
        </div>
      </div>,
      document.body
    )}
    {traceHash && (
      <TransactionTraceModal txHash={traceHash} onClose={() => setTraceHash(null)} />
    )}
    </>
  )
}
