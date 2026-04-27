// Content script (ISOLATED world) — bridges between page script and background service worker
// Handles safety API calls and displays warning UI

// Inject styles programmatically (avoids CRXJS CSS bundling issues)
const style = document.createElement('style')
style.textContent = `
.op-tx-warning-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.7);backdrop-filter:blur(4px);z-index:999999;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
.op-tx-warning-card{background:#111827;border:1px solid rgba(239,68,68,.3);border-radius:16px;padding:24px;max-width:420px;width:90%;color:#e5e7eb;box-shadow:0 25px 50px rgba(0,0,0,.5)}
.op-tx-warning-card h3{color:#ef4444;font-size:18px;font-weight:700;margin:0 0 12px}
.op-tx-warning-card .risks{background:rgba(239,68,68,.1);border-radius:8px;padding:12px;margin:12px 0}
.op-tx-warning-card .risk-item{color:#fca5a5;font-size:13px;padding:4px 0}
.op-tx-warning-card .score-badge{display:inline-flex;align-items:center;gap:4px;padding:4px 12px;border-radius:8px;font-weight:700;font-size:20px}
.op-tx-warning-card .actions{display:flex;gap:12px;margin-top:16px}
.op-tx-warning-card button{flex:1;padding:10px 16px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;border:none;transition:opacity .2s}
.op-tx-warning-card button:hover{opacity:.85}
.op-tx-warning-card .btn-cancel{background:#ef4444;color:#fff}
.op-tx-warning-card .btn-proceed{background:rgba(255,255,255,.1);color:#9ca3af;border:1px solid rgba(255,255,255,.1)}
`
document.documentElement.appendChild(style)

interface SafetyData {
  score: number
  grade: string
  is_honeypot: boolean
  risks: string[]
  token_symbol?: string
  has_mint: boolean
  has_blacklist: boolean
  is_verified: boolean
  ownership_renounced: boolean
  total_liquidity_usd: number
  age_days: number
}

function gradeColorHex(grade: string): string {
  switch (grade) {
    case 'A': return '#10b981'
    case 'B': return '#22d3ee'
    case 'C': return '#f59e0b'
    case 'D': return '#f97316'
    case 'F': return '#ef4444'
    default: return '#6b7280'
  }
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`
}

function escapeHtml(str: string): string {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

async function checkSafety(address: string): Promise<SafetyData | null> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'CHECK_TOKEN_SAFETY', address },
      (response) => {
        if (response?.success && response.data) {
          resolve(response.data)
        } else {
          resolve(null)
        }
      }
    )
  })
}

function showWarning(
  to: string,
  safety: SafetyData | null,
  fnName: string,
  isApproveInfinite: boolean
): Promise<boolean> {
  return new Promise((resolve) => {
    const warnings: string[] = []

    if (isApproveInfinite) {
      warnings.push('Infinite approval — contract can spend ALL your tokens')
    }

    if (safety) {
      if (safety.is_honeypot) warnings.push('HONEYPOT DETECTED — you will NOT be able to sell')
      if (safety.score < 30) warnings.push(`Very low safety score: ${safety.score}/100 (Grade ${safety.grade})`)
      else if (safety.score < 50) warnings.push(`Low safety score: ${safety.score}/100 (Grade ${safety.grade})`)
      if (!safety.is_verified) warnings.push('Contract is NOT verified')
      if (safety.has_mint) warnings.push('Owner can mint new tokens')
      if (safety.has_blacklist) warnings.push('Owner can blacklist/freeze funds')
      if (!safety.ownership_renounced) warnings.push('Ownership NOT renounced')
      if (safety.age_days < 1) warnings.push('Contract deployed less than 24 hours ago')
      if (safety.total_liquidity_usd < 1000) warnings.push('Very low liquidity (< $1,000)')
      safety.risks.forEach((r) => { if (!warnings.includes(r)) warnings.push(r) })
    } else {
      warnings.push('Unable to verify this contract — proceed with caution')
    }

    if (warnings.length === 0) {
      resolve(true)
      return
    }

    // Create overlay
    const overlay = document.createElement('div')
    overlay.className = 'op-tx-warning-overlay'

    // Sanitize all API-derived data to prevent XSS
    const safeGrade = safety ? escapeHtml(safety.grade) : ''
    const safeScore = safety ? String(Number(safety.score) || 0) : ''
    const safeSymbol = safety?.token_symbol ? ` (${escapeHtml(safety.token_symbol)})` : ''
    const safeFnName = escapeHtml(fnName)
    const gradeColor = safety ? gradeColorHex(safety.grade) : '#6b7280'

    const scoreHtml = safety
      ? `<span class="score-badge" style="color:${gradeColor};background:${gradeColor}15">${safeGrade} ${safeScore}/100</span>`
      : ''

    overlay.innerHTML = `
      <div class="op-tx-warning-card">
        <h3>⚠️ Transaction Warning</h3>
        <div style="font-size:12px;color:#9ca3af;margin-bottom:8px">
          <strong>Contract:</strong> ${escapeHtml(shortAddr(to))}${safeSymbol}<br>
          <strong>Action:</strong> ${safeFnName}${isApproveInfinite ? ' (INFINITE)' : ''}
        </div>
        ${scoreHtml}
        <div class="risks">
          ${warnings.map((w) => `<div class="risk-item">• ${escapeHtml(w)}</div>`).join('')}
        </div>
        <div style="font-size:11px;color:#6b7280;margin-top:8px">
          Powered by <a href="https://www.openpulsechain.com" target="_blank" rel="noopener noreferrer" style="color:#00D4FF;text-decoration:none">OpenPulsechain</a>
        </div>
        <div class="actions">
          <button class="btn-cancel">Cancel Transaction</button>
          <button class="btn-proceed">Proceed Anyway</button>
        </div>
      </div>
    `

    document.body.appendChild(overlay)

    const cleanup = (proceed: boolean) => {
      overlay.remove()
      resolve(proceed)
    }

    overlay.querySelector('.btn-cancel')!.addEventListener('click', () => cleanup(false))
    overlay.querySelector('.btn-proceed')!.addEventListener('click', () => cleanup(true))
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false) })

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { cleanup(false); document.removeEventListener('keydown', handleEsc) }
    }
    document.addEventListener('keydown', handleEsc)
  })
}

// Listen for safety check requests from injected page script
window.addEventListener('op-safety-check', async (e: Event) => {
  const { to, fnName, isApproveInfinite } = (e as CustomEvent).detail

  const safety = await checkSafety(to)
  const proceed = await showWarning(to, safety, fnName, isApproveInfinite)

  window.dispatchEvent(new CustomEvent('op-safety-result', { detail: { proceed } }))
})
