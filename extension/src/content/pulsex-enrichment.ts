// Content script: Enriches PulseX pages with safety data
// Injects safety badges next to token addresses on PulseX

const BADGE_CLASS = 'op-safety-badge'

interface SafetyResponse {
  success: boolean
  data?: {
    score: number
    grade: string
    is_honeypot: boolean
    risks: string[]
  }
  error?: string
}

// Cache checked addresses to avoid re-checking
const checkedAddresses = new Map<string, SafetyResponse['data']>()

function gradeColor(grade: string): string {
  switch (grade) {
    case 'A': return '#10b981'
    case 'B': return '#22d3ee'
    case 'C': return '#f59e0b'
    case 'D': return '#f97316'
    case 'F': return '#ef4444'
    default: return '#6b7280'
  }
}

function createBadge(data: NonNullable<SafetyResponse['data']>): HTMLElement {
  const badge = document.createElement('span')
  badge.className = BADGE_CLASS
  badge.title = data.is_honeypot
    ? `HONEYPOT — Score: ${data.score}/100`
    : data.risks.length > 0
    ? `Score: ${data.score}/100 — ${data.risks[0]}`
    : `Score: ${data.score}/100 — Safe`
  badge.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 3px;
    margin-left: 4px;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    font-family: -apple-system, sans-serif;
    color: ${gradeColor(data.grade)};
    background: ${gradeColor(data.grade)}15;
    border: 1px solid ${gradeColor(data.grade)}30;
    cursor: pointer;
    vertical-align: middle;
  `
  badge.textContent = `${data.grade} ${data.score}`

  if (data.is_honeypot) {
    badge.textContent = `HONEYPOT`
    badge.style.color = '#ef4444'
    badge.style.background = '#ef444420'
    badge.style.border = '1px solid #ef444440'
  }

  // Click opens full report
  badge.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    // Find the token address from context
    const parent = badge.closest('[class*="token"], [class*="pair"], a[href*="0x"]')
    const link = parent?.querySelector('a[href*="0x"]')
    const href = link?.getAttribute('href') || ''
    const match = href.match(/(0x[a-fA-F0-9]{40})/)
    if (match) {
      window.open(`https://www.openpulsechain.com/token/${match[1]}`, '_blank')
    }
  })

  return badge
}

async function checkAndEnrich(element: HTMLElement, address: string) {
  // Skip if already has badge
  if (element.querySelector(`.${BADGE_CLASS}`)) return

  const addr = address.toLowerCase()

  // Check cache first
  if (checkedAddresses.has(addr)) {
    const cached = checkedAddresses.get(addr)
    if (cached) {
      element.appendChild(createBadge(cached))
    }
    return
  }

  // Request safety check via background script
  try {
    const response: SafetyResponse = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'CHECK_TOKEN_SAFETY', address: addr }, resolve)
    })

    if (response.success && response.data) {
      checkedAddresses.set(addr, response.data)
      element.appendChild(createBadge(response.data))
    }
  } catch {
    // Silently fail
  }
}

function scanPage() {
  // Find token addresses on the page
  const links = document.querySelectorAll('a[href*="0x"]')
  links.forEach((link) => {
    const href = link.getAttribute('href') || ''
    const match = href.match(/(0x[a-fA-F0-9]{40})/)
    if (match && !link.querySelector(`.${BADGE_CLASS}`)) {
      const parent = link.parentElement
      if (parent) {
        checkAndEnrich(parent, match[1])
      }
    }
  })

  // Find text nodes containing addresses
  const textElements = document.querySelectorAll('[class*="symbol"], [class*="token"], [class*="name"]')
  textElements.forEach((el) => {
    const text = el.textContent || ''
    const match = text.match(/(0x[a-fA-F0-9]{40})/)
    if (match && !el.querySelector(`.${BADGE_CLASS}`)) {
      checkAndEnrich(el as HTMLElement, match[1])
    }
  })
}

// Initial scan
setTimeout(scanPage, 2000)

// Re-scan on DOM changes (SPA navigation)
const observer = new MutationObserver(() => {
  setTimeout(scanPage, 1000)
})
observer.observe(document.body, { childList: true, subtree: true })

// Re-scan on navigation
let lastUrl = location.href
setInterval(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href
    setTimeout(scanPage, 1500)
  }
}, 1000)
