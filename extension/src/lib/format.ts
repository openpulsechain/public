export function formatUsd(value: number | null | undefined): string {
  if (value == null) return '--'
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`
  if (abs >= 1) return `${sign}$${abs.toFixed(2)}`
  if (abs >= 0.01) return `${sign}$${abs.toFixed(4)}`
  return `${sign}$${abs.toFixed(6)}`
}

// Unicode subscript digits for DexScreener-style zero compression
const SUBSCRIPT_DIGITS = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉']
function toSubscript(n: number): string {
  return String(n).split('').map(d => SUBSCRIPT_DIGITS[parseInt(d)]).join('')
}

/** Format token price with subscript zero notation for very small values.
 *  e.g. 0.00007596 → "$0.0₄7596"  (4 leading zeros compressed) */
export function formatPrice(price: number | null | undefined): string {
  if (price == null) return '--'
  if (price > 1e15) return '$∞'
  if (price >= 0.01) return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
  if (price === 0) return '$0'
  const str = price.toFixed(20)
  const afterDot = str.split('.')[1] || ''
  let zeros = 0
  for (const c of afterDot) {
    if (c === '0') zeros++
    else break
  }
  if (zeros >= 3) {
    const significant = afterDot.slice(zeros, zeros + 4).replace(/0+$/, '')
    return `$0.0${toSubscript(zeros)}${significant || '0'}`
  }
  return `$${price.toFixed(6)}`
}

export function shortenAddress(addr: string, chars = 4): string {
  if (!addr) return ''
  return `${addr.slice(0, chars + 2)}...${addr.slice(-chars)}`
}

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
