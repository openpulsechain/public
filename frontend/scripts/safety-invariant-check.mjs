#!/usr/bin/env node
// ╔══════════════════════════════════════════════════════════════════╗
// ║ Safety Invariant Check                                           ║
// ║                                                                  ║
// ║ Enforces that a safety analysis ALWAYS shows BOTH verdict cards  ║
// ║ (Honeypot + Scam). This rule has regressed twice — commits       ║
// ║ 7591b33 and b1a4151 both reintroduced conditionals that hid the  ║
// ║ Scam card for clean tokens. This check runs before every build   ║
// ║ and FAILS Railway deployment if the invariant is broken.         ║
// ║                                                                  ║
// ║ Checks:                                                          ║
// ║   1. Required files exist                                        ║
// ║   2. Each file contains both data-testid markers                 ║
// ║   3. No forbidden conditionals wrap the Scam card                ║
// ║                                                                  ║
// ║ Note: Railway builds use frontend/ as root, so extension/ is not ║
// ║ present in the build context. The extension target is marked    ║
// ║ optional and skipped on Railway, enforced on local runs.        ║
// ╚══════════════════════════════════════════════════════════════════╝

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
// Script lives at <frontend>/scripts/. Frontend targets resolved from <frontend>/.
// Extension target lives in <repo>/extension/ which is NOT available on Railway.
const frontendRoot = resolve(__dirname, '..')
const repoRoot = resolve(__dirname, '../..')

// Each target declares what it must contain.
// - "testids": literal data-testid values that must appear in the source
// - "mustInclude": substrings that must appear (used for files that delegate
//   rendering to a child component — we check that the child is used)
// - "optional": if true, missing file is a warning (skip), not an error
const TARGETS = [
  {
    file: resolve(frontendRoot, 'src/components/safety/SafetyVerdictGrid.tsx'),
    label: 'frontend/src/components/safety/SafetyVerdictGrid.tsx',
    testids: ['safety-verdict-honeypot', 'safety-verdict-scam'],
    mustInclude: ['INVARIANT'],
    optional: false,
  },
  {
    file: resolve(frontendRoot, 'src/components/pages/SafetyDashboardPage.tsx'),
    label: 'frontend/src/components/pages/SafetyDashboardPage.tsx',
    testids: [],
    mustInclude: [
      "import { SafetyVerdictGrid }",
      '<SafetyVerdictGrid',
    ],
    optional: false,
  },
  {
    file: resolve(frontendRoot, 'src/components/pages/TokenSafetyPage.tsx'),
    label: 'frontend/src/components/pages/TokenSafetyPage.tsx',
    testids: [],
    mustInclude: [
      "import { SafetyVerdictGrid",
      '<SafetyVerdictGrid',
    ],
    optional: false,
  },
  {
    file: resolve(repoRoot, 'extension/src/popup/components/SafetyCheck.tsx'),
    label: 'extension/src/popup/components/SafetyCheck.tsx',
    testids: ['safety-verdict-honeypot', 'safety-verdict-scam'],
    mustInclude: ['INVARIANT'],
    optional: true,
  },
]

// Patterns that have historically hidden the Scam card OR that describe new
// classes of failure we want to forbid preemptively. If any of these match,
// it's almost certainly a regression of the pillar invariant.
const FORBIDDEN_PATTERNS = [
  // ── Historical regressions ───────────────────────────────────────
  {
    re: /scamAnalysis\s*&&\s*\(scamAnalysis\.signals\.length/,
    hint: 'Scam card must render regardless of signals count — use "NO DATA" state.',
  },
  {
    re: /scamAnalysis\.scam_score\s*>=\s*\d+\s*\)\s*\?\s*['"]grid-cols-2/,
    hint: 'Grid must be fixed at grid-cols-2 — no conditional switch.',
  },
  {
    re: /scam_score\s*>=\s*50.*grid-cols-1/s,
    hint: 'No score threshold should toggle the grid layout.',
  },

  // ── Layout toggling by score ─────────────────────────────────────
  {
    re: /grid-cols-1[^}]*:[^}]*grid-cols-2[^}]*scam/i,
    hint: 'Dynamic grid-cols switch tied to scam data is forbidden.',
  },
  {
    re: /scam\s*\?\s*['"]grid-cols-2['"]\s*:/,
    hint: 'Ternary grid-cols based on scam presence — always use grid-cols-2.',
  },

  // ── Hidden classes around the verdict cards ──────────────────────
  {
    re: /data-testid="safety-verdict-scam"[^>]*hidden/,
    hint: 'Scam verdict card cannot have `hidden` class.',
  },
  {
    re: /data-testid="safety-verdict-honeypot"[^>]*hidden/,
    hint: 'Honeypot verdict card cannot have `hidden` class.',
  },
  {
    re: /display:\s*none[\s\S]{0,200}safety-verdict/,
    hint: 'No `display: none` around safety verdicts.',
  },

  // ── Conditional wrappers around the grid ─────────────────────────
  {
    re: /\{\s*scamAnalysis\s*&&\s*<SafetyVerdictGrid/,
    hint: 'SafetyVerdictGrid must not be wrapped in a conditional — it handles null scam internally.',
  },
  {
    re: /\{\s*scam\w*\s*\?\s*<SafetyVerdictGrid[\s\S]*?null\s*\}/,
    hint: 'Ternary wrap of SafetyVerdictGrid is forbidden — it handles null scam internally.',
  },

  // ── Hardcoded thresholds (trying to sneak in a "hide if score low") ──
  {
    re: /if\s*\(\s*\w*[sS]cam\w*\.scam_score\s*[<>=]+\s*\d+\s*\)\s*return\s+null/,
    hint: 'Early return null based on scam_score is forbidden — the card must render.',
  },
]

let errors = 0

function fail(msg) {
  console.error('\x1b[31m✗ SAFETY INVARIANT BROKEN:\x1b[0m', msg)
  errors++
}

function ok(msg) {
  console.log('\x1b[32m✓\x1b[0m', msg)
}

function skip(msg) {
  console.log('\x1b[33m⊘\x1b[0m', msg, '\x1b[90m(optional, not in build context)\x1b[0m')
}

console.log('\n━━━ Safety Invariant Check ━━━')

for (const target of TARGETS) {
  if (!existsSync(target.file)) {
    if (target.optional) {
      skip(target.label)
      continue
    }
    fail(`Missing required file: ${target.label}`)
    continue
  }

  const src = readFileSync(target.file, 'utf8')
  let fileErrors = 0

  for (const id of target.testids) {
    if (!src.includes(`data-testid="${id}"`)) {
      fail(`${target.label} — missing data-testid="${id}"`)
      fileErrors++
    }
  }

  for (const needle of target.mustInclude) {
    if (!src.includes(needle)) {
      fail(`${target.label} — missing required marker: ${needle}`)
      fileErrors++
    }
  }

  for (const { re, hint } of FORBIDDEN_PATTERNS) {
    if (re.test(src)) {
      fail(`${target.label} — forbidden pattern ${re}\n    ${hint}`)
      fileErrors++
    }
  }

  if (fileErrors === 0) ok(target.label)
}

if (errors > 0) {
  console.error(`\n\x1b[31m${errors} safety invariant check(s) failed.\x1b[0m`)
  console.error('A safety analysis MUST always show BOTH verdict cards (Honeypot + Scam).')
  console.error('See frontend/src/components/safety/SafetyVerdictGrid.tsx for the canonical component.\n')
  process.exit(1)
}

console.log('\n\x1b[32mAll safety invariants hold.\x1b[0m\n')
