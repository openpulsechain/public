import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { ArrowDownUp, Coins, Hash, DollarSign, Globe, Lock, RefreshCw, Search, AlertTriangle, Copy, Check } from 'lucide-react'
import { ShareButton } from '../ui/ShareButton'
import { useTranslation } from '../../i18n'

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

import { KpiCard } from '../cards/KpiCard'
import { TokenTable } from '../cards/TokenTable'
import { ChainTable } from '../cards/ChainTable'
import { BarChartComponent } from '../charts/BarChart'
import { AreaChartComponent } from '../charts/AreaChart'
import { PieChartComponent } from '../charts/PieChart'
import { Tabs } from '../ui/Tabs'
import { TimeRangeSelector } from '../ui/TimeRangeSelector'
import {
  useBridgeDailyStats, useBridgeTokenStats, useBridgeTransfers, useBridgeWhales, useBridgeTvl,
  useHyperlaneDailyStats, useHyperlaneChainStats, useHyperlaneTransfers, useHyperlaneWhales,
} from '../../hooks/useSupabase'
import { formatUsd, formatNumber, formatDate } from '../../lib/format'
import type { BridgeTransfer, HyperlaneTransfer } from '../../types'

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Known stablecoin decimals (USDC, USDT, etc.) */
const KNOWN_DECIMALS: Record<string, number> = {
  USDC: 6, USDT: 6, WBTC: 8, GUSD: 2, EURS: 2,
}

function formatAmount(raw: string | null, decimals: number | null, symbol: string | null): string {
  if (!raw) return '--'
  // Use provided decimals, fall back to known decimals, then default 18
  const dec = decimals ?? (symbol ? KNOWN_DECIMALS[symbol.toUpperCase()] : undefined) ?? 18
  const val = Number(raw) / Math.pow(10, dec)
  if (!isFinite(val) || val > 1e18) return '--'
  if (val >= 1_000_000) return `${(val / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 1 })}M`
  if (val >= 1_000) return `${(val / 1_000).toLocaleString('en-US', { maximumFractionDigits: 1 })}K`
  if (val >= 1) return val.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return val.toLocaleString('en-US', { maximumFractionDigits: 6 })
}

const EXPLORER_URLS: Record<number, { name: string; url: string }> = {
  1: { name: 'ETH', url: 'https://etherscan.io/tx/' },
  10: { name: 'OP', url: 'https://optimistic.etherscan.io/tx/' },
  56: { name: 'BSC', url: 'https://bscscan.com/tx/' },
  100: { name: 'GNOSIS', url: 'https://gnosisscan.io/tx/' },
  137: { name: 'POLY', url: 'https://polygonscan.com/tx/' },
  250: { name: 'FTM', url: 'https://ftmscan.com/tx/' },
  369: { name: 'PLS', url: 'https://scan.mypinata.cloud/ipfs/bafybeienxyoyrhn5tswclvd3gdjy5mtkkwmu37aqtml6onbf7xnb3o22pe/#/tx/' },
  1301: { name: 'UNI', url: 'https://uniscan.xyz/tx/' },
  8453: { name: 'BASE', url: 'https://basescan.org/tx/' },
  42161: { name: 'ARB', url: 'https://arbiscan.io/tx/' },
  43114: { name: 'AVAX', url: 'https://subnets.avax.network/c-chain/tx/' },
}

const CHAIN_ABBREV: Record<string, string> = {
  ethereum: 'ETH', optimism: 'OP', bsc: 'BSC', gnosis: 'GNO',
  unichain: 'UNI', polygon: 'POLY', fantom: 'FTM', pulsechain: 'PLS',
  sei: 'SEI', base: 'BASE', arbitrum: 'ARB', avalanche: 'AVAX',
}

function chainLabel(name: string | null): string {
  if (!name) return '?'
  return CHAIN_ABBREV[name.toLowerCase()] || name.toUpperCase()
}

// BRIDGE_TABS moved inside component for i18n access

const WHALE_THRESHOLDS = [1000, 5000, 10000, 25000, 50000, 100000]

// ─── Shared sub-components ──────────────────────────────────────────────────

function EmptyWhaleState({ threshold }: { threshold: number }) {
  const { t } = useTranslation()
  const label = threshold >= 1000 ? `$${threshold / 1000}K` : `$${threshold}`
  return (
    <div className="py-8 text-center text-gray-500 text-sm">
      {t.bridge.no_whale_transfers.replace('{threshold}', label)}
    </div>
  )
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-4 flex items-center gap-3">
      <AlertTriangle className="h-5 w-5 text-orange-400 shrink-0" />
      <div className="flex-1">
        <p className="text-sm text-orange-400">{message}</p>
      </div>
      <button onClick={onRetry} className="text-xs text-orange-400/70 hover:text-orange-300 underline shrink-0">{t.bridge.retry}</button>
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={e => { e.preventDefault(); e.stopPropagation(); navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      className="shrink-0 p-0.5 rounded hover:bg-white/10 transition-colors cursor-pointer"
      title={t.bridge.copy_address}
    >
      {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3 text-gray-600 hover:text-[#00D4FF]" />}
    </button>
  )
}

function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500" />
      <input
        type="text"
        placeholder={placeholder || 'Filter...'}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="pl-8 pr-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#00D4FF]/50 w-36"
      />
    </div>
  )
}

// ─── OmniBridge Whale Table ─────────────────────────────────────────────────

function OmniWhaleTable({ data, compact, searchQuery }: { data: BridgeTransfer[]; compact?: boolean; searchQuery?: string }) {
  const { t } = useTranslation()
  const filtered = searchQuery?.trim()
    ? data.filter(tx => {
        const q = searchQuery.trim().toLowerCase()
        return (tx.token_symbol?.toLowerCase().includes(q)) || tx.user_address.toLowerCase().includes(q)
      })
    : data

  const items = compact ? filtered.slice(0, 10) : filtered

  if (items.length === 0) return <div className="py-6 text-center text-gray-500 text-sm">{t.bridge.no_matching_transfers}</div>

  return (
    <>
      {/* Mobile cards */}
      <div className="sm:hidden divide-y divide-white/5">
        {items.map(tx => (
          <div key={tx.id} className="py-2.5 px-1 space-y-1">
            <div className="flex items-center justify-between">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                tx.direction === 'deposit' ? 'bg-[#00D4FF]/10 text-[#00D4FF]' : 'bg-[#FF0040]/10 text-[#FF0040]'
              }`}>{tx.direction === 'deposit' ? 'ETH → PLS' : 'PLS → ETH'}</span>
              <span className="font-bold text-white text-sm">{formatUsd(tx.amount_usd)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400">{tx.token_symbol || '--'}</span>
              <span className="text-gray-500">{formatDate(tx.block_timestamp)}</span>
            </div>
            <div className="flex items-center gap-1 text-xs">
              <span className="text-gray-500 font-mono truncate">{tx.user_address}</span>
              <CopyButton text={tx.user_address} />
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="overflow-x-auto hidden sm:block">
        <table className="w-full text-sm table-fixed">
          <thead>
            <tr className="border-b border-white/10 text-gray-400">
              <th className="py-3 px-3 text-left w-[120px]">{t.bridge.table_direction}</th>
              <th className="py-3 px-3 text-center w-[110px]">{t.bridge.table_amount}</th>
              <th className="py-3 px-3 text-center w-[80px]">{t.bridge.table_token}</th>
              <th className="py-3 px-3 text-center">{t.bridge.table_wallet}</th>
              <th className="py-3 px-3 text-center w-[130px]">{t.bridge.table_time}</th>
              {!compact && <th className="py-3 px-3 text-center w-[70px]">{t.bridge.table_tx}</th>}
            </tr>
          </thead>
          <tbody>
            {items.map(tx => (
              <tr key={tx.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                <td className="py-2.5 px-3 text-left whitespace-nowrap">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    tx.direction === 'deposit' ? 'bg-[#00D4FF]/10 text-[#00D4FF]' : 'bg-[#FF0040]/10 text-[#FF0040]'
                  }`}>{tx.direction === 'deposit' ? 'ETH → PLS' : 'PLS → ETH'}</span>
                </td>
                <td className="py-2.5 px-3 text-center font-bold text-white">{formatUsd(tx.amount_usd)}</td>
                <td className="py-2.5 px-3 text-center text-gray-400">{tx.token_symbol || '--'}</td>
                <td className="py-2.5 px-3 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <span className="font-mono text-sm text-gray-500">{tx.user_address}</span>
                    <CopyButton text={tx.user_address} />
                  </div>
                </td>
                <td className="py-2.5 px-3 text-center text-sm text-gray-500 whitespace-nowrap">{formatDate(tx.block_timestamp)}</td>
                {!compact && (
                  <td className="py-2.5 px-3 text-center">
                    <span className="flex gap-1 justify-center">
                      {tx.tx_hash_eth && <a href={`https://etherscan.io/tx/${tx.tx_hash_eth}`} target="_blank" rel="noopener noreferrer" className="text-xs text-[#4040E0] hover:text-[#00D4FF] transition-colors">ETH</a>}
                      {tx.tx_hash_pls && <a href={`https://scan.mypinata.cloud/ipfs/bafybeienxyoyrhn5tswclvd3gdjy5mtkkwmu37aqtml6onbf7xnb3o22pe/#/tx/${tx.tx_hash_pls}`} target="_blank" rel="noopener noreferrer" className="text-xs text-[#8000E0] hover:text-[#D000C0] transition-colors">PLS</a>}
                    </span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ─── Hyperlane Whale Table ──────────────────────────────────────────────────

function HlWhaleTable({ data, compact, searchQuery }: { data: HyperlaneTransfer[]; compact?: boolean; searchQuery?: string }) {
  const { t } = useTranslation()
  const filtered = searchQuery?.trim()
    ? data.filter(tx => {
        const q = searchQuery.trim().toLowerCase()
        return (tx.token_symbol?.toLowerCase().includes(q)) || (tx.origin_tx_sender?.toLowerCase().includes(q))
      })
    : data

  const items = compact ? filtered.slice(0, 10) : filtered

  if (items.length === 0) return <div className="py-6 text-center text-gray-500 text-sm">{t.bridge.no_matching_transfers}</div>

  return (
    <>
      {/* Mobile cards */}
      <div className="sm:hidden divide-y divide-white/5">
        {items.map(tx => (
          <div key={tx.id} className="py-2.5 px-1 space-y-1">
            <div className="flex items-center justify-between">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                tx.direction === 'inbound' ? 'bg-[#00D4FF]/10 text-[#00D4FF]' : 'bg-[#FF0040]/10 text-[#FF0040]'
              }`}>{tx.direction === 'inbound'
                ? `${chainLabel(tx.origin_chain_name)} → PLS`
                : `PLS → ${chainLabel(tx.destination_chain_name)}`}</span>
              <span className="font-bold text-white text-sm">{formatUsd(tx.amount_usd)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400">{tx.token_symbol || '--'}</span>
              <span className={`${tx.is_delivered ? 'text-emerald-400' : 'text-yellow-400'}`}>
                {tx.is_delivered ? t.bridge.status_delivered : t.bridge.status_pending}
              </span>
            </div>
            <div className="flex items-center gap-1 text-xs">
              <span className="text-gray-500 font-mono truncate">{tx.origin_tx_sender || ''}</span>
              {tx.origin_tx_sender && <CopyButton text={tx.origin_tx_sender} />}
              <span className="text-gray-500 ml-auto">{formatDate(tx.send_occurred_at)}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="overflow-x-auto hidden sm:block">
        <table className="w-full text-sm table-fixed">
          <thead>
            <tr className="border-b border-white/10 text-gray-400">
              <th className="py-3 px-3 text-left w-[120px]">{t.bridge.table_route}</th>
              <th className="py-3 px-3 text-center w-[110px]">{t.bridge.table_amount}</th>
              <th className="py-3 px-3 text-center w-[80px]">{t.bridge.table_token}</th>
              <th className="py-3 px-3 text-center">{t.bridge.table_wallet}</th>
              <th className="py-3 px-3 text-center w-[130px]">{t.bridge.table_time}</th>
              {!compact && <th className="py-3 px-3 text-center w-[70px]">{t.bridge.table_tx}</th>}
            </tr>
          </thead>
          <tbody>
            {items.map(tx => (
              <tr key={tx.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                <td className="py-2.5 px-3 text-left whitespace-nowrap">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    tx.direction === 'inbound' ? 'bg-[#00D4FF]/10 text-[#00D4FF]' : 'bg-[#FF0040]/10 text-[#FF0040]'
                  }`}>{tx.direction === 'inbound'
                    ? `${chainLabel(tx.origin_chain_name)} → PLS`
                    : `PLS → ${chainLabel(tx.destination_chain_name)}`}</span>
                </td>
                <td className="py-2.5 px-3 text-center font-bold text-white">{formatUsd(tx.amount_usd)}</td>
                <td className="py-2.5 px-3 text-center text-gray-400">{tx.token_symbol || '--'}</td>
                <td className="py-2.5 px-3 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <span className="font-mono text-sm text-gray-500">{tx.origin_tx_sender || '--'}</span>
                    {tx.origin_tx_sender && <CopyButton text={tx.origin_tx_sender} />}
                  </div>
                </td>
                <td className="py-2.5 px-3 text-center text-sm text-gray-500 whitespace-nowrap">{formatDate(tx.send_occurred_at)}</td>
                {!compact && (
                  <td className="py-2.5 px-3 text-center">
                    <span className="flex gap-1 justify-center">
                      {tx.origin_tx_hash && (() => {
                        const exp = EXPLORER_URLS[tx.origin_chain_id]
                        return exp ? <a href={`${exp.url}${tx.origin_tx_hash}`} target="_blank" rel="noopener noreferrer" className="text-xs text-[#4040E0] hover:text-[#00D4FF] transition-colors">{exp.name}</a> : null
                      })()}
                      {tx.destination_tx_hash && (() => {
                        const exp = EXPLORER_URLS[tx.destination_chain_id]
                        return exp ? <a href={`${exp.url}${tx.destination_tx_hash}`} target="_blank" rel="noopener noreferrer" className="text-xs text-[#8000E0] hover:text-[#D000C0] transition-colors">{exp.name}</a> : null
                      })()}
                    </span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ─── OmniBridge Transfers Table ─────────────────────────────────────────────

function OmniTransfersTable({ data, searchQuery }: { data: BridgeTransfer[]; searchQuery: string }) {
  const { t } = useTranslation()
  const filtered = searchQuery.trim()
    ? data.filter(tx => {
        const q = searchQuery.trim().toLowerCase()
        return (tx.token_symbol?.toLowerCase().includes(q)) || tx.user_address.toLowerCase().includes(q)
      })
    : data

  if (filtered.length === 0) return <div className="py-8 text-center text-gray-500 text-sm">{searchQuery.trim() ? t.bridge.no_matching_transfers : t.bridge.no_transfers_available}</div>

  return (
    <>
      {/* Mobile cards */}
      <div className="sm:hidden divide-y divide-white/5">
        {filtered.map(tx => (
          <div key={tx.id} className="py-2.5 px-1 space-y-1">
            <div className="flex items-center justify-between">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                tx.direction === 'deposit' ? 'bg-[#00D4FF]/10 text-[#00D4FF]' : 'bg-[#FF0040]/10 text-[#FF0040]'
              }`}>{tx.direction === 'deposit' ? 'ETH → PLS' : 'PLS → ETH'}</span>
              <span className="text-white text-sm font-mono">{formatAmount(tx.amount_raw, tx.token_decimals, tx.token_symbol)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-white">{tx.token_symbol || '--'}</span>
              <span className={`${tx.status === 'executed' ? 'text-emerald-400' : 'text-yellow-400'}`}>{tx.status}</span>
            </div>
            <div className="flex items-center gap-1 text-xs">
              <span className="text-gray-500 font-mono truncate">{tx.user_address}</span>
              <CopyButton text={tx.user_address} />
              <span className="text-gray-500 ml-auto shrink-0">{formatDate(tx.block_timestamp)}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="overflow-x-auto hidden sm:block">
        <table className="w-full text-sm table-fixed">
          <thead>
            <tr className="border-b border-white/10 text-gray-400">
              <th className="py-3 px-3 text-left w-[120px]">{t.bridge.table_direction}</th>
              <th className="py-3 px-3 text-center w-[80px]">{t.bridge.table_token}</th>
              <th className="py-3 px-3 text-center w-[110px]">{t.bridge.table_amount}</th>
              <th className="py-3 px-3 text-center">{t.bridge.table_user}</th>
              <th className="py-3 px-3 text-center w-[80px]">{t.bridge.table_status}</th>
              <th className="py-3 px-3 text-center w-[130px]">{t.bridge.table_time}</th>
              <th className="py-3 px-3 text-center w-[70px]">{t.bridge.table_tx}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(tx => (
              <tr key={tx.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                <td className="py-2.5 px-3 text-left whitespace-nowrap">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    tx.direction === 'deposit' ? 'bg-[#00D4FF]/10 text-[#00D4FF]' : 'bg-[#FF0040]/10 text-[#FF0040]'
                  }`}>{tx.direction === 'deposit' ? 'ETH → PLS' : 'PLS → ETH'}</span>
                </td>
                <td className="py-2.5 px-3 text-center text-white">{tx.token_symbol || '--'}</td>
                <td className="py-2.5 px-3 text-center text-gray-300 font-mono">{formatAmount(tx.amount_raw, tx.token_decimals, tx.token_symbol)}</td>
                <td className="py-2.5 px-3 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <span className="font-mono text-sm text-gray-400">{tx.user_address}</span>
                    <CopyButton text={tx.user_address} />
                  </div>
                </td>
                <td className="py-2.5 px-3 text-center">
                  <span className={`text-sm ${tx.status === 'executed' ? 'text-emerald-400' : 'text-yellow-400'}`}>{tx.status}</span>
                </td>
                <td className="py-2.5 px-3 text-center text-gray-400 text-sm whitespace-nowrap">{formatDate(tx.block_timestamp)}</td>
                <td className="py-2.5 px-3 text-center">
                  <span className="flex gap-1 justify-center">
                    {tx.tx_hash_eth && <a href={`https://etherscan.io/tx/${tx.tx_hash_eth}`} target="_blank" rel="noopener noreferrer" className="text-xs text-[#4040E0] hover:text-[#00D4FF] transition-colors">ETH</a>}
                    {tx.tx_hash_eth && tx.tx_hash_pls && <span className="text-gray-600">|</span>}
                    {tx.tx_hash_pls && <a href={`https://scan.mypinata.cloud/ipfs/bafybeienxyoyrhn5tswclvd3gdjy5mtkkwmu37aqtml6onbf7xnb3o22pe/#/tx/${tx.tx_hash_pls}`} target="_blank" rel="noopener noreferrer" className="text-xs text-[#8000E0] hover:text-[#D000C0] transition-colors">PLS</a>}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ─── Hyperlane Transfers Table ──────────────────────────────────────────────

function HlTransfersTable({ data, searchQuery }: { data: HyperlaneTransfer[]; searchQuery: string }) {
  const { t } = useTranslation()
  const filtered = searchQuery.trim()
    ? data.filter(tx => {
        const q = searchQuery.trim().toLowerCase()
        return (tx.token_symbol?.toLowerCase().includes(q)) || (tx.origin_tx_sender?.toLowerCase().includes(q))
      })
    : data

  if (filtered.length === 0) return <div className="py-8 text-center text-gray-500 text-sm">{searchQuery.trim() ? t.bridge.no_matching_transfers : t.bridge.no_transfers_available}</div>

  return (
    <>
      {/* Mobile cards */}
      <div className="sm:hidden divide-y divide-white/5">
        {filtered.map(tx => (
          <div key={tx.id} className="py-2.5 px-1 space-y-1">
            <div className="flex items-center justify-between">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                tx.direction === 'inbound' ? 'bg-[#00D4FF]/10 text-[#00D4FF]' : 'bg-[#FF0040]/10 text-[#FF0040]'
              }`}>{tx.direction === 'inbound'
                ? `${chainLabel(tx.origin_chain_name)} → PLS`
                : `PLS → ${chainLabel(tx.destination_chain_name)}`}</span>
              <span className="text-white text-sm">{tx.amount_usd != null ? formatUsd(tx.amount_usd) : '--'}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-white">{tx.token_symbol || '--'}</span>
              <span className={`${tx.is_delivered ? 'text-emerald-400' : 'text-yellow-400'}`}>
                {tx.is_delivered ? t.bridge.status_delivered : t.bridge.status_pending}
              </span>
            </div>
            <div className="flex items-center gap-1 text-xs">
              <span className="text-gray-500 font-mono truncate">{tx.origin_tx_sender || '--'}</span>
              {tx.origin_tx_sender && <CopyButton text={tx.origin_tx_sender} />}
              <span className="text-gray-500 ml-auto shrink-0">{formatDate(tx.send_occurred_at)}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="overflow-x-auto hidden sm:block">
        <table className="w-full text-sm table-fixed">
          <thead>
            <tr className="border-b border-white/10 text-gray-400">
              <th className="py-3 px-3 text-left w-[120px]">{t.bridge.table_route}</th>
              <th className="py-3 px-3 text-center w-[80px]">{t.bridge.table_token}</th>
              <th className="py-3 px-3 text-center w-[110px]">{t.bridge.table_amount}</th>
              <th className="py-3 px-3 text-center">{t.bridge.table_user}</th>
              <th className="py-3 px-3 text-center w-[80px]">{t.bridge.table_status}</th>
              <th className="py-3 px-3 text-center w-[130px]">{t.bridge.table_time}</th>
              <th className="py-3 px-3 text-center w-[70px]">{t.bridge.table_tx}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(tx => (
              <tr key={tx.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                <td className="py-2.5 px-3 text-left whitespace-nowrap">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    tx.direction === 'inbound' ? 'bg-[#00D4FF]/10 text-[#00D4FF]' : 'bg-[#FF0040]/10 text-[#FF0040]'
                  }`}>{tx.direction === 'inbound'
                    ? `${chainLabel(tx.origin_chain_name)} → PLS`
                    : `PLS → ${chainLabel(tx.destination_chain_name)}`}</span>
                </td>
                <td className="py-2.5 px-3 text-center text-white">{tx.token_symbol || '--'}</td>
                <td className="py-2.5 px-3 text-center text-gray-300 font-mono">{tx.amount_usd != null ? formatUsd(tx.amount_usd) : '--'}</td>
                <td className="py-2.5 px-3 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <span className="font-mono text-sm text-gray-400">{tx.origin_tx_sender || '--'}</span>
                    {tx.origin_tx_sender && <CopyButton text={tx.origin_tx_sender} />}
                  </div>
                </td>
                <td className="py-2.5 px-3 text-center">
                  <span className={`text-sm ${tx.is_delivered ? 'text-emerald-400' : 'text-yellow-400'}`}>
                    {tx.is_delivered ? t.bridge.status_delivered : t.bridge.status_pending}
                  </span>
                </td>
                <td className="py-2.5 px-3 text-center text-gray-400 text-sm whitespace-nowrap">{formatDate(tx.send_occurred_at)}</td>
                <td className="py-2.5 px-3 text-center">
                  <span className="flex gap-1 justify-center">
                    {tx.origin_tx_hash && (() => {
                      const exp = EXPLORER_URLS[tx.origin_chain_id]
                      return exp ? <a href={`${exp.url}${tx.origin_tx_hash}`} target="_blank" rel="noopener noreferrer" className="text-xs text-[#4040E0] hover:text-[#00D4FF] transition-colors">{exp.name}</a> : null
                    })()}
                    {tx.destination_tx_hash && (() => {
                      const exp = EXPLORER_URLS[tx.destination_chain_id]
                      return exp ? <a href={`${exp.url}${tx.destination_tx_hash}`} target="_blank" rel="noopener noreferrer" className="text-xs text-[#8000E0] hover:text-[#D000C0] transition-colors">{exp.name}</a> : null
                    })()}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function BridgePage() {
  const { t } = useTranslation()
  const BRIDGE_TABS = [
    { id: 'all', label: t.bridge.filter_all },
    { id: 'omni', label: t.bridge.filter_omnibridge },
    { id: 'hyperlane', label: t.bridge.filter_hyperlane },
  ]
  const [activeTab, setActiveTab] = useState('all')
  const [omniWhaleMin, setOmniWhaleMin] = useState(50000)
  const [hlWhaleMin, setHlWhaleMin] = useState(10000)
  const [omniRange, setOmniRange] = useState<number | null>(90)
  const [omniFlowRange, setOmniFlowRange] = useState<number | null>(180)
  const [hlRange, setHlRange] = useState<number | null>(90)
  const [hlFlowRange, setHlFlowRange] = useState<number | null>(180)

  // Search filters
  const [whaleSearch, setWhaleSearch] = useState('')
  const [transferSearch, setTransferSearch] = useState('')

  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const doRefresh = useCallback(() => {
    setLastRefresh(new Date())
  }, [])

  // Visibility-aware auto-refresh every 2 minutes
  useEffect(() => {
    setLastRefresh(new Date())

    const startPolling = () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      intervalRef.current = setInterval(doRefresh, 120_000)
    }

    const handleVisibility = () => {
      if (document.hidden) {
        if (intervalRef.current) clearInterval(intervalRef.current)
        intervalRef.current = null
      } else {
        doRefresh()
        startPolling()
      }
    }

    startPolling()
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [doRefresh])

  // Bridge TVL (from on-chain balances)
  const tvl = useBridgeTvl()

  // OmniBridge data
  const daily = useBridgeDailyStats()
  const tokens = useBridgeTokenStats()
  const transfers = useBridgeTransfers()
  const whales = useBridgeWhales(omniWhaleMin)

  // Hyperlane data
  const hlDaily = useHyperlaneDailyStats()
  const hlChains = useHyperlaneChainStats()
  const hlTransfers = useHyperlaneTransfers()
  const hlWhales = useHyperlaneWhales(hlWhaleMin)

  // Aggregate error state
  const hasError = daily.error || tokens.error || hlDaily.error
  const anyLoading = daily.loading && tokens.loading && hlDaily.loading

  // OmniBridge KPIs
  const omniKpis = useMemo(() => {
    if (!daily.data.length) return null
    const totalDeposits = daily.data.reduce((s, d) => s + d.deposit_volume_usd, 0)
    const totalWithdrawals = daily.data.reduce((s, d) => s + d.withdrawal_volume_usd, 0)
    const totalTxs = daily.data.reduce((s, d) => s + d.deposit_count + d.withdrawal_count, 0)
    const last30 = daily.data.slice(-30)
    const volume30d = last30.reduce((s, d) => s + d.deposit_volume_usd + d.withdrawal_volume_usd, 0)
    return { totalVolume: totalDeposits + totalWithdrawals, totalTxs, volume30d }
  }, [daily.data])

  // Hyperlane KPIs
  const hlKpis = useMemo(() => {
    if (!hlDaily.data.length) return null
    const totalVolume = hlDaily.data.reduce((s, d) => s + d.inbound_volume_usd + d.outbound_volume_usd, 0)
    const totalTxs = hlDaily.data.reduce((s, d) => s + d.inbound_count + d.outbound_count, 0)
    const last30 = hlDaily.data.slice(-30)
    const volume30d = last30.reduce((s, d) => s + d.inbound_volume_usd + d.outbound_volume_usd, 0)
    const connectedChains = new Set(hlChains.data.map(c => c.chain_id)).size
    return { totalVolume, totalTxs, volume30d, connectedChains }
  }, [hlDaily.data, hlChains.data])

  // OmniBridge charts
  const dailyRecent = omniRange ? daily.data.slice(-omniRange) : daily.data
  const cumulativeFlow = useMemo(() => {
    let cumul = 0
    return daily.data.map(d => {
      cumul += d.net_flow_usd
      return { date: d.date, cumulative_net_flow: cumul }
    })
  }, [daily.data])
  const cumulativeRecent = omniFlowRange ? cumulativeFlow.slice(-omniFlowRange) : cumulativeFlow
  const pieData = useMemo(() => {
    return tokens.data.slice(0, 8).map(t => ({
      name: t.token_symbol || t.token_address.slice(0, 8),
      value: t.total_deposit_volume_usd + t.total_withdrawal_volume_usd,
    }))
  }, [tokens.data])

  // Hyperlane charts
  const hlDailyRecent = hlRange ? hlDaily.data.slice(-hlRange) : hlDaily.data
  const hlCumulativeFlow = useMemo(() => {
    let cumul = 0
    return hlDaily.data.map(d => {
      cumul += d.net_flow_usd
      return { date: d.date, cumulative_net_flow: cumul }
    })
  }, [hlDaily.data])
  const hlCumulativeRecent = hlFlowRange ? hlCumulativeFlow.slice(-hlFlowRange) : hlCumulativeFlow
  const hlPieData = useMemo(() => {
    return hlChains.data.slice(0, 8).map(c => ({
      name: c.chain_name || `Chain ${c.chain_id}`,
      value: c.total_inbound_volume_usd + c.total_outbound_volume_usd,
    }))
  }, [hlChains.data])

  // Bridge TVL KPIs
  const totalTvl = useMemo(() => {
    if (!tvl.data.length) return 0
    return tvl.data.reduce((s, t) => s + t.tvl_usd, 0)
  }, [tvl.data])

  const topTvlTokens = useMemo(() => tvl.data.slice(0, 10), [tvl.data])

  // Volume change metrics (7d and 30d)
  const volumeChanges = useMemo(() => {
    if (!daily.data.length) return null
    const now = daily.data.slice(-7)
    const prev7 = daily.data.slice(-14, -7)
    const now30 = daily.data.slice(-30)
    const prev30 = daily.data.slice(-60, -30)
    const vol7 = now.reduce((s, d) => s + d.deposit_volume_usd + d.withdrawal_volume_usd, 0)
    const volPrev7 = prev7.reduce((s, d) => s + d.deposit_volume_usd + d.withdrawal_volume_usd, 0)
    const vol30 = now30.reduce((s, d) => s + d.deposit_volume_usd + d.withdrawal_volume_usd, 0)
    const volPrev30 = prev30.reduce((s, d) => s + d.deposit_volume_usd + d.withdrawal_volume_usd, 0)
    const pct7 = volPrev7 > 0 ? ((vol7 - volPrev7) / volPrev7) * 100 : 0
    const pct30 = volPrev30 > 0 ? ((vol30 - volPrev30) / volPrev30) * 100 : 0
    return { vol7, pct7, vol30, pct30 }
  }, [daily.data])

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Hero header */}
      <div className="rounded-2xl border border-white/5 bg-gradient-to-br from-cyan-500/5 via-blue-500/5 to-purple-500/5 backdrop-blur-sm p-5 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-xl bg-cyan-400/10 border border-cyan-400/20">
                <Lock className="h-6 w-6 text-cyan-400" />
              </div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-cyan-300 to-blue-400 bg-clip-text text-transparent">
                {t.bridge.title}
              </h1>
              <ShareButton title={t.bridge.title} text="PulseChain bridge flows and whale alerts" />
            </div>
            <p className="text-gray-400 max-w-xl text-sm">
              {t.bridge.description}
              {lastRefresh && <span className="text-gray-600 ml-2">{t.bridge.last} {lastRefresh.toLocaleTimeString()}</span>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {totalTvl > 0 && (
              <div className="text-center px-4 py-2 rounded-xl bg-cyan-500/5 border border-cyan-500/10">
                <div className="text-lg font-bold text-[#00D4FF]">{formatUsd(totalTvl)}</div>
                <div className="text-[10px] text-gray-500 uppercase tracking-wider">{t.bridge.bridge_tvl}</div>
              </div>
            )}
            <button
              onClick={doRefresh}
              disabled={anyLoading}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors disabled:opacity-50 text-sm"
            >
              <RefreshCw className={`h-4 w-4 ${anyLoading ? 'animate-spin' : ''}`} />
              {t.bridge.refresh}
            </button>
            <a
              href="https://dune.com/openpulsechain/pulsechain-bridge-analytics"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-[#8000E0]/30 bg-[#8000E0]/10 px-3 py-1.5 text-sm text-[#00D4FF] hover:bg-[#8000E0]/20 transition-colors"
            >
              {t.bridge.dune_dashboard}
            </a>
          </div>
        </div>
      </div>

      {/* Error banner */}
      {hasError && <ErrorBanner message={t.bridge.error_partial} onRetry={doRefresh} />}

      <Tabs tabs={BRIDGE_TABS} active={activeTab} onChange={setActiveTab} />

      {/* ====================== ALL BRIDGES ====================== */}
      {activeTab === 'all' && (
        <>
          {/* Bridge TVL Hero */}
          {totalTvl > 0 && (
            <div className="rounded-xl border border-[#00D4FF]/20 bg-gradient-to-r from-[#00D4FF]/5 to-[#8000E0]/5 backdrop-blur-sm p-6">
              <div className="flex items-center gap-3 mb-1">
                <Lock className="h-6 w-6 text-[#00D4FF]" />
                <h2 className="text-lg font-semibold text-gray-400">{t.bridge.bridge_tvl}</h2>
              </div>
              <div className="text-3xl sm:text-4xl font-bold text-white">{formatUsd(totalTvl)}</div>
              <p className="text-xs text-gray-500 mt-1">{t.bridge.tvl_description}</p>
              {volumeChanges && (
                <div className="flex flex-wrap gap-4 sm:gap-6 mt-3">
                  <div>
                    <span className="text-xs text-gray-500">{t.bridge.volume_7d}</span>
                    <span className="text-sm font-medium text-white">{formatUsd(volumeChanges.vol7)}</span>
                    <span className={`ml-1 text-xs font-medium ${volumeChanges.pct7 >= 0 ? 'text-emerald-400' : 'text-[#FF0040]'}`}>
                      {volumeChanges.pct7 >= 0 ? '+' : ''}{volumeChanges.pct7.toFixed(1)}%
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">{t.bridge.volume_30d_label}</span>
                    <span className="text-sm font-medium text-white">{formatUsd(volumeChanges.vol30)}</span>
                    <span className={`ml-1 text-xs font-medium ${volumeChanges.pct30 >= 0 ? 'text-emerald-400' : 'text-[#FF0040]'}`}>
                      {volumeChanges.pct30 >= 0 ? '+' : ''}{volumeChanges.pct30.toFixed(1)}%
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <KpiCard title={t.bridge.kpi_total_volume} value={formatUsd((omniKpis?.totalVolume ?? 0) + (hlKpis?.totalVolume ?? 0))} subtitle={t.bridge.subtitle_all_bridges} icon={<DollarSign className="h-5 w-5" />} />
            <KpiCard title={t.bridge.kpi_30d_volume} value={formatUsd((omniKpis?.volume30d ?? 0) + (hlKpis?.volume30d ?? 0))} subtitle={t.bridge.subtitle_last_30d} icon={<ArrowDownUp className="h-5 w-5" />} />
            <KpiCard title={t.bridge.kpi_total_transactions} value={formatNumber((omniKpis?.totalTxs ?? 0) + (hlKpis?.totalTxs ?? 0))} icon={<Hash className="h-5 w-5" />} />
            <KpiCard title={t.bridge.kpi_omnibridge_volume} value={formatUsd(omniKpis?.totalVolume ?? 0)} subtitle={`Hyperlane: ${formatUsd(hlKpis?.totalVolume ?? 0)}`} icon={<Globe className="h-5 w-5" />} />
          </div>

          {/* OmniBridge Whale Alerts */}
          <div className="rounded-xl border border-[#FF0040]/20 bg-gray-900/40 backdrop-blur-sm p-5">
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <WhaleIcon className="h-5 w-5 text-[#FF0040]" />
              <h2 className="text-lg font-semibold text-white">{t.bridge.omnibridge_whale_alerts}</h2>
              <div className="flex items-center gap-2 ml-auto">
                <SearchInput value={whaleSearch} onChange={setWhaleSearch} placeholder={t.bridge.search_placeholder} />
                <select value={omniWhaleMin} onChange={e => setOmniWhaleMin(Number(e.target.value))}
                  className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-gray-400 outline-none focus:border-[#FF0040]/40">
                  {WHALE_THRESHOLDS.map(v => <option key={v} value={v}>≥ ${v >= 1000 ? `${v / 1000}K` : v}</option>)}
                </select>
              </div>
            </div>
            {whales.data.length > 0
              ? <OmniWhaleTable data={whales.data} compact searchQuery={whaleSearch} />
              : <EmptyWhaleState threshold={omniWhaleMin} />}
          </div>

          {/* Hyperlane Whale Alerts */}
          <div className="rounded-xl border border-[#4040E0]/20 bg-gray-900/40 backdrop-blur-sm p-5">
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <WhaleIcon className="h-5 w-5 text-[#4040E0]" />
              <h2 className="text-lg font-semibold text-white">{t.bridge.hyperlane_whale_alerts}</h2>
              <div className="flex items-center gap-2 ml-auto">
                <SearchInput value={whaleSearch} onChange={setWhaleSearch} placeholder={t.bridge.search_placeholder} />
                <select value={hlWhaleMin} onChange={e => setHlWhaleMin(Number(e.target.value))}
                  className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-gray-400 outline-none focus:border-[#4040E0]/40">
                  {WHALE_THRESHOLDS.map(v => <option key={v} value={v}>≥ ${v >= 1000 ? `${v / 1000}K` : v}</option>)}
                </select>
              </div>
            </div>
            {hlWhales.data.length > 0
              ? <HlWhaleTable data={hlWhales.data} compact searchQuery={whaleSearch} />
              : <EmptyWhaleState threshold={hlWhaleMin} />}
          </div>

          {/* Top Tokens by TVL */}
          {topTvlTokens.length > 0 && (
            <div className="rounded-xl border border-white/5 bg-gray-900/40 backdrop-blur-sm p-5">
              <div className="flex items-center gap-2 mb-4">
                <Lock className="h-5 w-5 text-[#00D4FF]" />
                <h2 className="text-lg font-semibold text-white">{t.bridge.top_tokens_tvl}</h2>
              </div>
              {/* Mobile cards */}
              <div className="sm:hidden divide-y divide-white/5">
                {topTvlTokens.map((t, i) => (
                  <div key={t.token_symbol} className="py-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500 text-xs w-5">{i + 1}</span>
                      <span className="font-medium text-white">{t.token_symbol}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-white text-sm">{formatUsd(t.tvl_usd)}</span>
                      <span className="text-gray-500 text-xs ml-2">{t.pct_of_total != null ? `${t.pct_of_total.toFixed(1)}%` : ''}</span>
                    </div>
                  </div>
                ))}
              </div>
              {/* Desktop table */}
              <div className="overflow-x-auto hidden sm:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-gray-400">
                      <th className="py-3 px-3 text-left w-[50px]">#</th>
                      <th className="py-3 px-3 text-left">{t.bridge.table_token}</th>
                      <th className="py-3 px-3 text-center">{t.bridge.table_tvl}</th>
                      <th className="py-3 px-3 text-center">{t.bridge.table_pct_total}</th>
                      <th className="py-3 px-3 text-center">{t.bridge.table_price}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topTvlTokens.map((t, i) => (
                      <tr key={t.token_symbol} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="py-2.5 px-3 text-left text-gray-500">{i + 1}</td>
                        <td className="py-2.5 px-3 text-left font-medium text-white">{t.token_symbol}</td>
                        <td className="py-2.5 px-3 text-center text-white">{formatUsd(t.tvl_usd)}</td>
                        <td className="py-2.5 px-3 text-center text-gray-400">{t.pct_of_total != null ? `${t.pct_of_total.toFixed(1)}%` : '--'}</td>
                        <td className="py-2.5 px-3 text-center text-gray-400">
                          {t.price_usd > 0
                            ? t.price_usd < 0.01 ? `$${t.price_usd.toFixed(6)}` : `$${t.price_usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            : '--'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ====================== OMNIBRIDGE ====================== */}
      {activeTab === 'omni' && (
        <>
          {omniKpis && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <KpiCard title={t.bridge.kpi_total_volume} value={formatUsd(omniKpis.totalVolume)} subtitle={t.bridge.subtitle_all_time} icon={<DollarSign className="h-5 w-5" />} />
              <KpiCard title={t.bridge.kpi_30d_volume} value={formatUsd(omniKpis.volume30d)} subtitle={t.bridge.subtitle_last_30d} icon={<ArrowDownUp className="h-5 w-5" />} />
              <KpiCard title={t.bridge.kpi_total_transactions} value={formatNumber(omniKpis.totalTxs)} icon={<Hash className="h-5 w-5" />} />
              <KpiCard title={t.bridge.kpi_tokens_tracked} value={formatNumber(tokens.data.length)} icon={<Coins className="h-5 w-5" />} />
            </div>
          )}

          <div className="rounded-xl border border-[#FF0040]/20 bg-gray-900/40 backdrop-blur-sm p-5">
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <WhaleIcon className="h-5 w-5 text-[#FF0040]" />
              <h2 className="text-lg font-semibold text-white">{t.bridge.whale_alerts}</h2>
              <div className="flex items-center gap-2 ml-auto">
                <SearchInput value={whaleSearch} onChange={setWhaleSearch} placeholder={t.bridge.search_placeholder} />
                <select value={omniWhaleMin} onChange={e => setOmniWhaleMin(Number(e.target.value))}
                  className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-gray-400 outline-none focus:border-[#FF0040]/40">
                  {WHALE_THRESHOLDS.map(v => <option key={v} value={v}>≥ ${v >= 1000 ? `${v / 1000}K` : v}</option>)}
                </select>
              </div>
            </div>
            {whales.data.length > 0
              ? <OmniWhaleTable data={whales.data} searchQuery={whaleSearch} />
              : <EmptyWhaleState threshold={omniWhaleMin} />}
          </div>

          <div className="rounded-xl border border-white/5 bg-gray-900/40 backdrop-blur-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">{t.bridge.daily_deposits_withdrawals}</h2>
              <TimeRangeSelector value={omniRange} onChange={setOmniRange} />
            </div>
            {dailyRecent.length > 0 ? (
              <BarChartComponent data={dailyRecent} xKey="date" bars={[
                { key: 'deposit_volume_usd', color: '#00D4FF', name: t.bridge.deposits },
                { key: 'withdrawal_volume_usd', color: '#FF0040', name: t.bridge.withdrawals },
              ]} />
            ) : <p className="py-12 text-center text-gray-500">{t.bridge.no_daily_data}</p>}
          </div>

          <div className="rounded-xl border border-white/5 bg-gray-900/40 backdrop-blur-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">{t.bridge.cumulative_net_flow}</h2>
              <TimeRangeSelector value={omniFlowRange} onChange={setOmniFlowRange} />
            </div>
            {cumulativeRecent.length > 0 ? (
              <AreaChartComponent data={cumulativeRecent} xKey="date" yKey="cumulative_net_flow" color="#00D4FF" />
            ) : <p className="py-12 text-center text-gray-500">{t.bridge.no_flow_data}</p>}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-white/5 bg-gray-900/40 backdrop-blur-sm p-5">
              <h2 className="mb-4 text-lg font-semibold text-white">{t.bridge.top_tokens_volume}</h2>
              {pieData.length > 0 ? <PieChartComponent data={pieData} /> : <p className="py-12 text-center text-gray-500">{t.bridge.no_token_data}</p>}
            </div>
            <div className="rounded-xl border border-white/5 bg-gray-900/40 backdrop-blur-sm p-5">
              <h2 className="mb-4 text-lg font-semibold text-white">{t.bridge.token_breakdown}</h2>
              <div className="max-h-[350px] overflow-y-auto">
                <TokenTable data={tokens.data.slice(0, 20)} />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-white/5 bg-gray-900/40 backdrop-blur-sm p-5">
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <h2 className="text-lg font-semibold text-white">{t.bridge.recent_transfers}</h2>
              <div className="ml-auto">
                <SearchInput value={transferSearch} onChange={setTransferSearch} placeholder={t.bridge.search_placeholder} />
              </div>
            </div>
            <OmniTransfersTable data={transfers.data} searchQuery={transferSearch} />
          </div>
        </>
      )}

      {/* ====================== HYPERLANE ====================== */}
      {activeTab === 'hyperlane' && (
        <>
          {hlKpis && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <KpiCard title={t.bridge.kpi_total_volume} value={formatUsd(hlKpis.totalVolume)} subtitle={t.bridge.subtitle_all_time} icon={<DollarSign className="h-5 w-5" />} />
              <KpiCard title={t.bridge.kpi_30d_volume} value={formatUsd(hlKpis.volume30d)} subtitle={t.bridge.subtitle_last_30d} icon={<ArrowDownUp className="h-5 w-5" />} />
              <KpiCard title={t.bridge.kpi_total_transfers} value={formatNumber(hlKpis.totalTxs)} icon={<Hash className="h-5 w-5" />} />
              <KpiCard title={t.bridge.kpi_connected_chains} value={formatNumber(hlKpis.connectedChains)} icon={<Globe className="h-5 w-5" />} />
            </div>
          )}

          <div className="rounded-xl border border-[#4040E0]/20 bg-gray-900/40 backdrop-blur-sm p-5">
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <WhaleIcon className="h-5 w-5 text-[#4040E0]" />
              <h2 className="text-lg font-semibold text-white">{t.bridge.whale_alerts}</h2>
              <div className="flex items-center gap-2 ml-auto">
                <SearchInput value={whaleSearch} onChange={setWhaleSearch} placeholder={t.bridge.search_placeholder} />
                <select value={hlWhaleMin} onChange={e => setHlWhaleMin(Number(e.target.value))}
                  className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-gray-400 outline-none focus:border-[#4040E0]/40">
                  {WHALE_THRESHOLDS.map(v => <option key={v} value={v}>≥ ${v >= 1000 ? `${v / 1000}K` : v}</option>)}
                </select>
              </div>
            </div>
            {hlWhales.data.length > 0
              ? <HlWhaleTable data={hlWhales.data} searchQuery={whaleSearch} />
              : <EmptyWhaleState threshold={hlWhaleMin} />}
          </div>

          <div className="rounded-xl border border-white/5 bg-gray-900/40 backdrop-blur-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">{t.bridge.daily_inbound_outbound}</h2>
              <TimeRangeSelector value={hlRange} onChange={setHlRange} />
            </div>
            {hlDailyRecent.length > 0 ? (
              <BarChartComponent data={hlDailyRecent} xKey="date" bars={[
                { key: 'inbound_volume_usd', color: '#00D4FF', name: t.bridge.inbound },
                { key: 'outbound_volume_usd', color: '#FF0040', name: t.bridge.outbound },
              ]} />
            ) : <p className="py-12 text-center text-gray-500">{t.bridge.no_daily_data}</p>}
          </div>

          <div className="rounded-xl border border-white/5 bg-gray-900/40 backdrop-blur-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">{t.bridge.cumulative_net_flow}</h2>
              <TimeRangeSelector value={hlFlowRange} onChange={setHlFlowRange} />
            </div>
            {hlCumulativeRecent.length > 0 ? (
              <AreaChartComponent data={hlCumulativeRecent} xKey="date" yKey="cumulative_net_flow" color="#4040E0" />
            ) : <p className="py-12 text-center text-gray-500">{t.bridge.no_flow_data}</p>}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-white/5 bg-gray-900/40 backdrop-blur-sm p-5">
              <h2 className="mb-4 text-lg font-semibold text-white">{t.bridge.volume_by_chain}</h2>
              {hlPieData.length > 0 ? <PieChartComponent data={hlPieData} /> : <p className="py-12 text-center text-gray-500">{t.bridge.no_chain_data}</p>}
            </div>
            <div className="rounded-xl border border-white/5 bg-gray-900/40 backdrop-blur-sm p-5">
              <h2 className="mb-4 text-lg font-semibold text-white">{t.bridge.chain_breakdown}</h2>
              <div className="max-h-[350px] overflow-y-auto">
                <ChainTable data={hlChains.data} />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-white/5 bg-gray-900/40 backdrop-blur-sm p-5">
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <h2 className="text-lg font-semibold text-white">{t.bridge.recent_transfers}</h2>
              <div className="ml-auto">
                <SearchInput value={transferSearch} onChange={setTransferSearch} placeholder={t.bridge.search_placeholder} />
              </div>
            </div>
            <HlTransfersTable data={hlTransfers.data} searchQuery={transferSearch} />
          </div>
        </>
      )}

    </div>
  )
}
