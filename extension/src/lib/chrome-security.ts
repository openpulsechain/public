/**
 * Chrome Security Monitor
 *
 * Checks Chrome version against known vulnerable versions and alerts users.
 * Data fetched from a lightweight endpoint on safety API.
 */

// Minimum safe Chrome version — updated when critical CVEs are published
// CVE-2026-0628 (CVSS 8.8): extension privilege escalation via Gemini panel — fixed in 143
const FALLBACK_MIN_CHROME = 143

const CACHE_KEY = 'op_chrome_security'
const CHECK_INTERVAL = 6 * 60 * 60 * 1000 // 6 hours

export interface ChromeSecurityStatus {
  currentVersion: number
  minSafeVersion: number
  isVulnerable: boolean
  cves?: string[]
  message?: string
}

function getChromeVersion(): number {
  const match = navigator.userAgent.match(/Chrome\/(\d+)/)
  return match ? parseInt(match[1], 10) : 0
}

async function fetchMinSafeVersion(): Promise<{ minVersion: number; cves?: string[]; message?: string }> {
  try {
    const res = await fetch('https://safety.openpulsechain.com/api/v1/chrome-security', {
      signal: AbortSignal.timeout(5000),
    })
    if (res.ok) {
      const data = await res.json()
      return {
        minVersion: data.min_chrome_version || FALLBACK_MIN_CHROME,
        cves: data.cves,
        message: data.message,
      }
    }
  } catch {
    // Endpoint not yet deployed — use fallback
  }
  return { minVersion: FALLBACK_MIN_CHROME }
}

export async function checkChromeSecurity(): Promise<ChromeSecurityStatus> {
  // Check cache
  try {
    const cached = await chrome.storage.local.get(CACHE_KEY)
    const entry = cached[CACHE_KEY]
    if (entry && Date.now() - entry.checkedAt < CHECK_INTERVAL) {
      return entry.status
    }
  } catch { /* no cache */ }

  const currentVersion = getChromeVersion()
  const { minVersion, cves, message } = await fetchMinSafeVersion()

  const status: ChromeSecurityStatus = {
    currentVersion,
    minSafeVersion: minVersion,
    isVulnerable: currentVersion > 0 && currentVersion < minVersion,
    cves,
    message,
  }

  // Cache result
  try {
    await chrome.storage.local.set({
      [CACHE_KEY]: { status, checkedAt: Date.now() },
    })
  } catch { /* storage error */ }

  return status
}
