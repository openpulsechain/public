import { useState, useEffect } from 'react'
import { ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react'

const SAFETY_API = import.meta.env.VITE_SAFETY_API_URL || 'https://safety.openpulsechain.com'

interface KnownAddress {
  address: string
  label: string
  risk_level: string
  category: string
  source: string
}

interface AmlBadgeProps {
  address: string
  compact?: boolean // Small inline badge vs full card
}

const RISK_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  HIGH: { bg: 'bg-red-500/15', text: 'text-red-400', border: 'border-red-500/30' },
  MEDIUM: { bg: 'bg-yellow-500/15', text: 'text-yellow-400', border: 'border-yellow-500/30' },
  LOW: { bg: 'bg-blue-500/15', text: 'text-blue-400', border: 'border-blue-500/30' },
}

const CATEGORY_LABELS: Record<string, string> = {
  sanctioned: 'OFAC SANCTIONED',
  phishing: 'Known Phishing',
  exploit: 'Known Exploiter',
  dumper: 'Flagged Dumper',
  manipulator: 'Market Manipulator',
  sac: 'Sacrifice Address',
}

// Simple in-memory cache to avoid duplicate fetches
const cache = new Map<string, KnownAddress | null>()

export function AmlBadge({ address, compact = false }: AmlBadgeProps) {
  const [data, setData] = useState<KnownAddress | null | undefined>(undefined) // undefined = loading

  useEffect(() => {
    if (!address) return

    const addr = address.toLowerCase()

    // Check cache first
    if (cache.has(addr)) {
      setData(cache.get(addr) ?? null)
      return
    }

    // Fetch from known_addresses via API (public read)
    fetch(`${SAFETY_API}/api/v1/address/${addr}/risk`)
      .then((r) => {
        if (!r.ok) return null
        return r.json()
      })
      .then((result) => {
        const entry = result?.data ?? null
        cache.set(addr, entry)
        setData(entry)
      })
      .catch(() => {
        cache.set(addr, null)
        setData(null)
      })
  }, [address])

  // Still loading or no data
  if (data === undefined || data === null) return null

  const style = RISK_STYLES[data.risk_level] || RISK_STYLES.MEDIUM
  const categoryLabel = CATEGORY_LABELS[data.category] || data.category || 'Flagged'

  if (compact) {
    return (
      <span
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${style.bg} ${style.text} border ${style.border}`}
        title={`${data.label} (${data.source})`}
      >
        <ShieldAlert className="w-3 h-3" />
        {categoryLabel}
      </span>
    )
  }

  return (
    <div className={`rounded-lg border ${style.border} ${style.bg} px-4 py-3`}>
      <div className="flex items-center gap-2">
        <ShieldAlert className={`w-5 h-5 ${style.text}`} />
        <span className={`font-semibold text-sm ${style.text}`}>{categoryLabel}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${style.bg} ${style.text} border ${style.border}`}>
          {data.risk_level}
        </span>
        <span className="text-[10px] text-gray-500 ml-auto">
          Source: {data.source}
        </span>
      </div>
      <p className="text-xs text-gray-400 mt-1">{data.label}</p>
    </div>
  )
}

export function SafetyGradeBadge({ grade }: { grade: string }) {
  const styles: Record<string, string> = {
    A: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    B: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    C: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
    D: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
    F: 'bg-red-500/15 text-red-400 border-red-500/30',
  }

  const Icon = grade === 'A' || grade === 'B' ? ShieldCheck :
               grade === 'F' || grade === 'D' ? ShieldAlert : ShieldQuestion

  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-bold border ${styles[grade] || styles.C}`}>
      <Icon className="w-3 h-3" />
      {grade}
    </span>
  )
}
