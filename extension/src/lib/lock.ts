/**
 * Extension Lock System
 *
 * Password stored as PBKDF2-SHA256 hash + random salt.
 * Never stores the password itself.
 * Brute-force protection via exponential delay.
 *
 * Red Team validated:
 * - 100K PBKDF2 iterations (slow brute-force)
 * - 16-byte random salt per installation
 * - No password recovery (reset = delete all data)
 * - Exponential backoff on failed attempts
 */

const STORAGE_KEY = 'op_lock'
const PBKDF2_ITERATIONS = 100_000

interface LockConfig {
  hash: string          // hex-encoded PBKDF2 hash
  salt: string          // hex-encoded random salt
  timeoutMinutes: number // 0 = never lock
  failedAttempts: number
  lastFailedAt: number
}

function buf2hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

function hex2buf(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16)
  }
  return bytes
}

async function deriveHash(password: string, salt: Uint8Array): Promise<string> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial, 256
  )
  return buf2hex(bits)
}

export async function isLockConfigured(): Promise<boolean> {
  const result = await chrome.storage.local.get(STORAGE_KEY)
  return !!(result[STORAGE_KEY]?.hash)
}

export async function getLockTimeout(): Promise<number> {
  const result = await chrome.storage.local.get(STORAGE_KEY)
  return result[STORAGE_KEY]?.timeoutMinutes ?? 0
}

export async function setPassword(password: string, timeoutMinutes: number): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await deriveHash(password, salt)
  const config: LockConfig = {
    hash,
    salt: buf2hex(salt.buffer as ArrayBuffer),
    timeoutMinutes,
    failedAttempts: 0,
    lastFailedAt: 0,
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: config })
}

export async function verifyPassword(password: string): Promise<boolean> {
  const result = await chrome.storage.local.get(STORAGE_KEY)
  const config: LockConfig | undefined = result[STORAGE_KEY]
  if (!config?.hash) return true // no password set

  // Brute-force protection: exponential delay
  if (config.failedAttempts >= 3) {
    const delayMs = Math.min(1000 * Math.pow(2, config.failedAttempts - 3), 60_000) // max 60s
    const elapsed = Date.now() - config.lastFailedAt
    if (elapsed < delayMs) return false
  }

  const salt = hex2buf(config.salt)
  const hash = await deriveHash(password, salt)

  if (hash === config.hash) {
    // Reset failed attempts on success
    config.failedAttempts = 0
    config.lastFailedAt = 0
    await chrome.storage.local.set({ [STORAGE_KEY]: config })
    return true
  }

  // Track failed attempt
  config.failedAttempts += 1
  config.lastFailedAt = Date.now()
  await chrome.storage.local.set({ [STORAGE_KEY]: config })
  return false
}

export async function updateTimeout(timeoutMinutes: number): Promise<void> {
  const result = await chrome.storage.local.get(STORAGE_KEY)
  const config: LockConfig | undefined = result[STORAGE_KEY]
  if (config) {
    config.timeoutMinutes = timeoutMinutes
    await chrome.storage.local.set({ [STORAGE_KEY]: config })
  }
}

export async function removeLock(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY)
}

// Last activity tracking
const ACTIVITY_KEY = 'op_last_activity'

export async function touchActivity(): Promise<void> {
  await chrome.storage.local.set({ [ACTIVITY_KEY]: Date.now() })
}

export async function shouldLock(): Promise<boolean> {
  const result = await chrome.storage.local.get([STORAGE_KEY, ACTIVITY_KEY])
  const config: LockConfig | undefined = result[STORAGE_KEY]
  if (!config?.hash || config.timeoutMinutes === 0) return false

  const lastActivity = result[ACTIVITY_KEY] || 0
  const elapsed = Date.now() - lastActivity
  return elapsed > config.timeoutMinutes * 60_000
}
