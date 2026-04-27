#!/usr/bin/env node
// Extension-side safety invariant check.
// Mirrors the frontend guard but scoped to extension/src/popup/components/SafetyCheck.tsx.
// Runs as `prebuild` so a broken extension never packs into a .zip for the store.

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const extensionRoot = resolve(__dirname, '..')

const TARGET = resolve(extensionRoot, 'src/popup/components/SafetyCheck.tsx')
const LABEL = 'extension/src/popup/components/SafetyCheck.tsx'
const REQUIRED_TESTIDS = ['safety-verdict-honeypot', 'safety-verdict-scam']
const REQUIRED_MARKERS = ['INVARIANT']

const FORBIDDEN = [
  { re: /scamAnalysis\s*&&\s*\(scamAnalysis\.signals\.length/, hint: 'Scam card must always render.' },
  { re: /data-testid="safety-verdict-scam"[^>]*hidden/, hint: 'Scam card cannot be hidden.' },
  { re: /data-testid="safety-verdict-honeypot"[^>]*hidden/, hint: 'Honeypot card cannot be hidden.' },
  { re: /display:\s*none[\s\S]{0,200}safety-verdict/, hint: 'No display:none around verdicts.' },
  { re: /if\s*\(\s*\w*[sS]cam\w*\.scam_score\s*[<>=]+\s*\d+\s*\)\s*return\s+null/, hint: 'Early return null based on score forbidden.' },
]

let errors = 0
const fail = (msg) => { console.error(`\x1b[31m✗\x1b[0m ${msg}`); errors++ }

console.log('\n━━━ Extension Safety Invariant Check ━━━')

if (!existsSync(TARGET)) {
  fail(`missing file: ${LABEL}`)
} else {
  const src = readFileSync(TARGET, 'utf8')
  for (const id of REQUIRED_TESTIDS) {
    if (!src.includes(`data-testid="${id}"`)) fail(`${LABEL} — missing data-testid="${id}"`)
  }
  for (const marker of REQUIRED_MARKERS) {
    if (!src.includes(marker)) fail(`${LABEL} — missing marker: ${marker}`)
  }
  for (const { re, hint } of FORBIDDEN) {
    if (re.test(src)) fail(`${LABEL} — forbidden pattern ${re}\n    ${hint}`)
  }
  if (errors === 0) console.log(`\x1b[32m✓\x1b[0m ${LABEL}`)
}

if (errors > 0) {
  console.error(`\n\x1b[31m${errors} error(s). The extension MUST always show Honeypot + Scam cards.\x1b[0m\n`)
  process.exit(1)
}
console.log('\n\x1b[32mExtension safety invariant holds.\x1b[0m\n')
