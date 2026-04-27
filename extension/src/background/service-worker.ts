// OpenPulsechain Extension — Background Service Worker
// Handles: periodic alert polling, badge updates, notifications

const SAFETY_API = 'https://safety.openpulsechain.com'
const ALARM_NAME = 'check-alerts'
const CHROME_SEC_ALARM = 'check-chrome-security'
const CHECK_INTERVAL_MINUTES = 5
const CHROME_SEC_INTERVAL_MINUTES = 360 // every 6 hours

// Minimum safe Chrome version (fallback if API unavailable)
const FALLBACK_MIN_CHROME = 143

// Track last seen alert to avoid duplicate notifications
let lastAlertId = 0
let chromeSecNotified = false

// Lock check alarm — runs every minute to enforce auto-lock
const LOCK_CHECK_ALARM = 'check-lock'

// Ensure alarms exist (called on install AND on every service worker wake)
async function ensureAlarms() {
  const existing = await chrome.alarms.getAll()
  const names = existing.map(a => a.name)
  if (!names.includes(ALARM_NAME)) chrome.alarms.create(ALARM_NAME, { periodInMinutes: CHECK_INTERVAL_MINUTES })
  if (!names.includes(CHROME_SEC_ALARM)) chrome.alarms.create(CHROME_SEC_ALARM, { periodInMinutes: CHROME_SEC_INTERVAL_MINUTES })
  if (!names.includes(LOCK_CHECK_ALARM)) chrome.alarms.create(LOCK_CHECK_ALARM, { periodInMinutes: 1 })
}

// Setup on install
chrome.runtime.onInstalled.addListener(() => {
  ensureAlarms()
  chrome.action.setBadgeBackgroundColor({ color: '#10b981' })
  chrome.action.setBadgeText({ text: '' })
  checkChromeSecurity()
})

// Also ensure alarms on every service worker startup
chrome.runtime.onStartup.addListener(() => { ensureAlarms() })
ensureAlarms() // immediate call for when SW wakes from idle

// Handle alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    await checkAlerts()
  }
  if (alarm.name === CHROME_SEC_ALARM) {
    await checkChromeSecurity()
  }
  if (alarm.name === LOCK_CHECK_ALARM) {
    await checkLockState()
  }
})

// Check if extension should be locked based on inactivity timeout
async function checkLockState() {
  try {
    const result = await chrome.storage.local.get(['op_lock', 'op_last_activity'])
    const config = result['op_lock']
    if (!config?.hash || config.timeoutMinutes === 0) return
    const lastActivity = result['op_last_activity'] || 0
    const elapsed = Date.now() - lastActivity
    if (elapsed > config.timeoutMinutes * 60_000) {
      // Set a flag that the popup will read on next open
      await chrome.storage.local.set({ 'op_force_lock': true })
    }
  } catch { /* silently fail */ }
}

async function checkChromeSecurity() {
  try {
    const match = navigator.userAgent.match(/Chrome\/(\d+)/)
    const currentVersion = match ? parseInt(match[1], 10) : 0
    if (currentVersion === 0) return

    let minVersion = FALLBACK_MIN_CHROME
    let cves: string[] = []
    try {
      const res = await fetch(`${SAFETY_API}/api/v1/chrome-security`, { signal: AbortSignal.timeout(5000) })
      if (res.ok) {
        const data = await res.json()
        minVersion = data.min_chrome_version || FALLBACK_MIN_CHROME
        cves = data.cves || []
      }
    } catch { /* use fallback */ }

    if (currentVersion < minVersion && !chromeSecNotified) {
      chromeSecNotified = true
      chrome.notifications.create('chrome-security', {
        type: 'basic',
        iconUrl: 'icons/icon-128.png',
        title: 'Chrome Update Required',
        message: `Chrome ${currentVersion} has known vulnerabilities${cves?.length ? ` (${cves.join(', ')})` : ''}. Update to Chrome ${minVersion}+ for security.`,
        priority: 2,
      })
    }
  } catch { /* silently fail */ }
}

async function checkAlerts() {
  try {
    // Check if notifications are enabled
    const settings = await chrome.storage.sync.get(['notifications', 'badgeAlerts'])
    if (settings.notifications === false) return

    // User preferences for which alert types count in the badge
    const badgePrefs = settings.badgeAlerts || { honeypot: true, lp_removal: true, whale_dump: true, mint_event: false }

    const res = await fetch(`${SAFETY_API}/api/v1/alerts/recent?limit=20`)
    if (!res.ok) return
    const data = await res.json()
    const alerts = data.data || data.alerts || []

    if (alerts.length === 0) {
      chrome.action.setBadgeText({ text: '' })
      return
    }

    // Filter by user preferences + new since last check
    const newAlerts = alerts.filter((a: { id: number; alert_type: string }) => {
      if (a.id <= lastAlertId) return false
      // Check if this alert type is enabled in user preferences
      const typeKey = a.alert_type as keyof typeof badgePrefs
      return badgePrefs[typeKey] !== false
    })

    if (newAlerts.length > 0) {
      lastAlertId = Math.max(...alerts.map((a: { id: number }) => a.id))

      // Update badge with filtered count
      chrome.action.setBadgeBackgroundColor({ color: '#ef4444' })
      chrome.action.setBadgeText({ text: String(newAlerts.length) })

      // Send push notification only for critical/high severity
      const critical = newAlerts.filter(
        (a: { severity: string }) => a.severity === 'critical' || a.severity === 'high'
      )
      if (critical.length > 0) {
        const alert = critical[0]
        let tokenInfo = ''
        try {
          const parsed = typeof alert.data === 'string' ? JSON.parse(alert.data) : alert.data
          tokenInfo = parsed?.token_symbol || parsed?.token_address?.slice(0, 10) || ''
        } catch { /* ignore */ }
        chrome.notifications.create(`alert-${alert.id}`, {
          type: 'basic',
          iconUrl: 'icons/icon-128.png',
          title: `Scam Alert: ${tokenInfo || 'Unknown Token'}`,
          message: `${alert.alert_type.replace(/_/g, ' ')} detected (${alert.severity})`,
          priority: 2,
        })
      }
    }
  } catch {
    // Silently fail — service worker will retry next alarm
  }
}

// Handle notification clicks — open alerts page
chrome.notifications.onClicked.addListener((notifId) => {
  if (notifId.startsWith('alert-')) {
    chrome.tabs.create({ url: 'https://www.openpulsechain.com/alerts' })
  }
  chrome.notifications.clear(notifId)
})

// Clear badge when popup opens
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'popup') {
    chrome.action.setBadgeText({ text: '' })
  }
})

// Validate address format (defense in depth against injection)
function isValidAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(addr)
}

// Message handler for content scripts
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'CHECK_TOKEN_SAFETY') {
    if (!isValidAddress(message.address)) {
      sendResponse({ success: false, error: 'Invalid address' })
      return true
    }
    fetch(`${SAFETY_API}/api/v1/token/${message.address}/safety`)
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json() })
      .then((data) => sendResponse({ success: true, data }))
      .catch((err) => sendResponse({ success: false, error: err?.message || 'Unknown error' }))
    return true
  }

  if (message.type === 'CHECK_DEPLOYER') {
    if (!isValidAddress(message.address)) {
      sendResponse({ success: false, error: 'Invalid address' })
      return true
    }
    fetch(`${SAFETY_API}/api/v1/deployer/${message.address}`)
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json() })
      .then((data) => sendResponse({ success: true, data }))
      .catch((err) => sendResponse({ success: false, error: err?.message || 'Unknown error' }))
    return true
  }
})
