import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Loader2, Copy, Check, ExternalLink, ArrowDown, GitBranch } from 'lucide-react'

const SAFETY_API = import.meta.env.VITE_SAFETY_API_URL || 'https://safety.openpulsechain.com'
const SCAN_URL = 'https://scan.mypinata.cloud/ipfs/bafybeienxyoyrhn5tswclvd3gdjy5mtkkwmu37aqtml6onbf7xnb3o22pe/#'

interface Funder {
  address: string
  total_pls: number
  tx_count: number
  is_contract: boolean
  label: string | null
  first_tx: string | null
  funders?: Funder[]
}

interface WhaleLink {
  address_from: string
  address_to: string
  link_type: string
  detail: string | null
}

interface FundingTreeData {
  target: string
  target_name: string | null
  target_is_contract: boolean
  funders: Funder[]
  whale_links: WhaleLink[]
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

function formatPls(value: number): string {
  if (value >= 1e12) return `${(value / 1e12).toFixed(1)}T`
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`
  return value.toFixed(0)
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      className="p-0.5 text-gray-600 hover:text-white transition-colors"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
    </button>
  )
}

function nodeColor(funder: Funder): string {
  if (funder.label?.includes('Bridge')) return '#3b82f6'
  if (funder.label?.includes('Mint') || funder.label?.includes('Null')) return '#f59e0b'
  if (funder.is_contract) return '#10b981'
  return '#a855f7'
}

function nodeLabel(funder: Funder): string {
  if (funder.label) return funder.label
  if (funder.is_contract) return 'Contract'
  return 'Wallet'
}

function FunderNode({ funder, depth = 0 }: { funder: Funder; depth?: number }) {
  const color = nodeColor(funder)
  const hasSubFunders = funder.funders && funder.funders.length > 0
  const [expanded, setExpanded] = useState(depth < 1)

  return (
    <div className="flex flex-col items-center">
      {/* Sub-funders (sources of this funder) */}
      {hasSubFunders && expanded && (
        <>
          <div className="flex flex-wrap justify-center gap-3 mb-2">
            {funder.funders!.slice(0, 5).map((sf) => (
              <div key={sf.address} className="flex flex-col items-center">
                <div
                  className="rounded-lg px-2.5 py-1.5 text-[10px] border"
                  style={{ borderColor: `${nodeColor(sf)}40`, background: `${nodeColor(sf)}10` }}
                >
                  <div className="flex items-center gap-1">
                    <span className="font-mono" style={{ color: nodeColor(sf) }}>
                      {shortAddr(sf.address)}
                    </span>
                    <CopyButton text={sf.address} />
                  </div>
                  <div className="text-gray-500 text-center mt-0.5">
                    {nodeLabel(sf)} &middot; {formatPls(sf.total_pls)} PLS
                  </div>
                </div>
                <ArrowDown className="h-3 w-3 text-gray-600 my-1" />
              </div>
            ))}
          </div>
        </>
      )}

      {/* This funder node */}
      <div
        className="rounded-xl px-3 py-2 border cursor-pointer hover:brightness-125 transition-all"
        style={{ borderColor: `${color}40`, background: `${color}10` }}
        onClick={() => hasSubFunders && setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
          <a
            href={`${SCAN_URL}/address/${funder.address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs hover:underline"
            style={{ color }}
            onClick={(e) => e.stopPropagation()}
          >
            {shortAddr(funder.address)}
          </a>
          <CopyButton text={funder.address} />
          <a
            href={`${SCAN_URL}/address/${funder.address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-600 hover:text-white transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <div className="flex items-center justify-between mt-1 text-[10px]">
          <span className="text-gray-400">{nodeLabel(funder)}</span>
          <span className="text-white font-semibold ml-3">{formatPls(funder.total_pls)} PLS</span>
          <span className="text-gray-500 ml-2">({funder.tx_count} tx)</span>
        </div>
        {funder.first_tx && (
          <div className="text-[9px] text-gray-600 mt-0.5">
            First: {new Date(funder.first_tx).toLocaleDateString()}
          </div>
        )}
        {hasSubFunders && (
          <div className="text-[9px] text-center mt-1" style={{ color }}>
            {expanded ? '▲ hide sources' : `▼ ${funder.funders!.length} source${funder.funders!.length > 1 ? 's' : ''}`}
          </div>
        )}
      </div>
    </div>
  )
}

export function FundingTreeModal({
  address,
  tierLabel,
  tokenSymbol,
  onClose,
}: {
  address: string
  tierLabel?: string
  tokenSymbol?: string
  onClose: () => void
}) {
  const [data, setData] = useState<FundingTreeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`${SAFETY_API}/api/v1/address/${address}/funding-tree`)
        if (!res.ok) throw new Error(`API error: ${res.status}`)
        const json = await res.json()
        setData(json)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [address])

  // Close on Escape + lock body scroll
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', handler)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-[5vh] backdrop-blur-md overflow-y-auto"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full max-w-2xl mx-4 mb-10 rounded-2xl border border-white/10 bg-gray-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <div>
            <div className="flex items-center gap-2">
              <GitBranch className="h-5 w-5 text-purple-400" />
              <h2 className="text-base font-bold text-white">Funding Genealogy</h2>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="font-mono text-xs text-[#00D4FF]">{shortAddr(address)}</span>
              <CopyButton text={address} />
              {tierLabel && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 font-medium">
                  {tierLabel}
                </span>
              )}
              {tokenSymbol && (
                <span className="text-[10px] text-gray-500">{tokenSymbol}</span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/5 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-5">
          {loading ? (
            <div className="flex flex-col items-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-purple-400 mb-3" />
              <p className="text-sm text-gray-500">Tracing funding sources on-chain...</p>
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          ) : data ? (
            <div className="space-y-4">
              {/* Funders flow */}
              {data.funders.length > 0 ? (
                <>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-3">
                    Funding Sources ({data.funders.length})
                  </div>
                  <div className="flex flex-wrap justify-center gap-4">
                    {data.funders.map((f) => (
                      <div key={f.address} className="flex flex-col items-center">
                        <FunderNode funder={f} depth={0} />
                        <ArrowDown className="h-4 w-4 text-gray-600 my-2" />
                      </div>
                    ))}
                  </div>

                  {/* Target node */}
                  <div className="flex justify-center">
                    <div className="rounded-xl px-5 py-3 border-2 border-amber-400/40 bg-amber-400/5">
                      <div className="flex items-center gap-2 justify-center">
                        <div className="w-3 h-3 rounded-full bg-amber-400" />
                        <a
                          href={`${SCAN_URL}/address/${data.target}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-sm text-amber-400 hover:underline"
                        >
                          {shortAddr(data.target)}
                        </a>
                        <CopyButton text={data.target} />
                        <ExternalLink className="h-3.5 w-3.5 text-gray-600" />
                      </div>
                      <div className="text-center mt-1">
                        <span className="text-xs text-white font-medium">
                          Target
                          {data.target_name && ` — ${data.target_name}`}
                        </span>
                        {tierLabel && (
                          <span className="text-[10px] text-amber-300 ml-2">{tierLabel}</span>
                        )}
                      </div>
                      {data.target_is_contract && (
                        <div className="text-[9px] text-emerald-400 text-center mt-0.5">Contract</div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-center py-6 text-sm text-gray-500">
                  No incoming transactions found for this address.
                </div>
              )}

              {/* Whale links section */}
              {data.whale_links.length > 0 && (
                <div className="mt-6 pt-4 border-t border-white/5">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                    Known On-Chain Links ({data.whale_links.length})
                  </div>
                  <div className="space-y-1.5">
                    {data.whale_links.map((link, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs bg-white/[0.02] rounded-lg px-3 py-2">
                        <span className="font-mono text-[#00D4FF]">{shortAddr(link.address_from)}</span>
                        <span className="text-gray-600">→</span>
                        <span className="font-mono text-purple-400">{shortAddr(link.address_to)}</span>
                        <span className="px-1.5 py-0.5 rounded text-[9px] bg-white/5 text-gray-400 border border-white/5 ml-auto">
                          {link.link_type.replace('_', ' ')}
                        </span>
                        {link.detail && (
                          <span className="text-[9px] text-gray-600">{link.detail}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Legend */}
              <div className="flex flex-wrap gap-3 pt-4 border-t border-white/5">
                <div className="flex items-center gap-1.5 text-[10px]">
                  <div className="w-2 h-2 rounded-full bg-[#3b82f6]" />
                  <span className="text-gray-500">Bridge</span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px]">
                  <div className="w-2 h-2 rounded-full bg-[#10b981]" />
                  <span className="text-gray-500">Contract</span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px]">
                  <div className="w-2 h-2 rounded-full bg-[#a855f7]" />
                  <span className="text-gray-500">Wallet</span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px]">
                  <div className="w-2 h-2 rounded-full bg-[#f59e0b]" />
                  <span className="text-gray-500">Mint / Null</span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px]">
                  <div className="w-2 h-2 rounded-full bg-[#fbbf24]" />
                  <span className="text-gray-500">Target</span>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  )
}
