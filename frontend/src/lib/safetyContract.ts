// ═══════════════════════════════════════════════════════════════════
// Safety API contract — frontend boundary parser
// ═══════════════════════════════════════════════════════════════════
//
// Single source of truth for parsing safety responses. Both the Safety
// Dashboard and the Token Safety detail page go through this function.
//
// INVARIANT:
//   - Parsing that doesn't find a valid scam_analysis → null but ALWAYS
//     logs via safetyTelemetry so the regression is visible in logs.
//   - Parsing NEVER hides the presence of the contract — if the shape is
//     wrong, the caller gets a clear signal.
//
// Protects against:
//   - Backend dropping scam_analysis from response (regression)
//   - Cache hits with stale/missing analysis_details
//   - Schema drift on new fields
// ═══════════════════════════════════════════════════════════════════

import type { HoneypotVerdict, ScamVerdict } from '../components/safety/SafetyVerdictGrid'

const RISK_LEVELS = ['critical', 'high', 'medium', 'low'] as const

export interface ParsedSafety {
  hp: HoneypotVerdict
  scam: ScamVerdict | null
  warnings: string[]
}

function toPlainObject(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch { /* ignore */ }
  }
  return null
}

function parseScamVerdict(candidate: unknown): ScamVerdict | null {
  if (!candidate || typeof candidate !== 'object') return null
  const c = candidate as Record<string, unknown>
  const score = typeof c.scam_score === 'number' ? c.scam_score : Number(c.scam_score)
  const risk = c.risk_level
  if (!Number.isFinite(score) || score < 0 || score > 100) return null
  if (typeof risk !== 'string' || !(RISK_LEVELS as readonly string[]).includes(risk)) return null
  return { scam_score: Math.round(score), risk_level: risk as ScamVerdict['risk_level'] }
}

/**
 * Parse a safety API response (data field or a cached token_safety_scores row).
 * Returns { hp, scam, warnings }. Does not throw; emits warnings instead so
 * callers can log/report without breaking the UI.
 */
export function parseSafetyPayload(data: unknown): ParsedSafety {
  const warnings: string[] = []
  const obj = (data && typeof data === 'object') ? (data as Record<string, unknown>) : null

  // ── Honeypot verdict ─────────────────────────────────────────
  let is_honeypot: boolean | null = null
  if (obj) {
    if (typeof obj.is_honeypot === 'boolean') {
      is_honeypot = obj.is_honeypot
    } else if (obj.is_honeypot === null) {
      is_honeypot = null
    } else if (obj.honeypot && typeof obj.honeypot === 'object') {
      const hp = obj.honeypot as Record<string, unknown>
      if (typeof hp.is_honeypot === 'boolean') {
        is_honeypot = hp.is_honeypot
      }
    }
  }
  if (!obj) warnings.push('safety payload is not an object')

  // ── Scam verdict ─────────────────────────────────────────────
  let scam: ScamVerdict | null = null
  if (obj) {
    // 1) top-level scam_analysis (fresh + hydrated cache)
    scam = parseScamVerdict(obj.scam_analysis)

    // 2) cached row shape: scam_score + scam_risk_level top-level
    if (!scam) {
      const score = typeof obj.scam_score === 'number' ? obj.scam_score : Number(obj.scam_score)
      const risk = obj.scam_risk_level
      if (Number.isFinite(score) && typeof risk === 'string' && (RISK_LEVELS as readonly string[]).includes(risk)) {
        scam = { scam_score: Math.round(score), risk_level: risk as ScamVerdict['risk_level'] }
      }
    }

    // 3) nested inside analysis_details JSON blob (oldest shape)
    if (!scam) {
      const details = toPlainObject(obj.analysis_details)
      if (details) {
        scam = parseScamVerdict(details.scam_analysis)
      }
    }

    if (!scam) {
      warnings.push('scam_analysis absent or invalid — pillar contract violation')
    }
  }

  return { hp: { is_honeypot }, scam, warnings }
}

/**
 * Fire telemetry when a safety contract violation is observed at the
 * frontend boundary. This is a pure browser-side event emitter — any
 * monitoring integration (Sentry, analytics, console) can subscribe.
 *
 * Intentionally lightweight: no dep on Sentry SDK. If/when we wire one,
 * we just add the call here.
 */
export function reportSafetyContractWarning(source: string, warnings: string[], address?: string): void {
  if (warnings.length === 0) return
  const detail = { source, address, warnings, ts: Date.now() }
  // 1) Console — always visible in devtools
  console.warn('[safety_contract_violation]', detail)
  // 2) Custom window event — listeners (Sentry integration later) can hook in
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      window.dispatchEvent(new CustomEvent('safety_contract_violation', { detail }))
    } catch { /* ignore */ }
  }
}
