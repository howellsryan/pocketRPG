#!/usr/bin/env node
// Untestable-zone ratchet: the node test harness can't import Preact-wired JSX,
// so logic that lands in App.jsx / state / screens / components is untestable by
// construction. This holds the AGGREGATE non-comment line count of that zone
// against a baseline — logic must move into importable modules, and it can't
// dodge the gate by hiding in a fresh screen file (aggregate, not per-file).
// See docs/testing-strategy-review.md (G1, Phase B).
//
// Usage:
//   node scripts/check-ui-ratchet.cjs           # check against baseline
//   node scripts/check-ui-ratchet.cjs --update   # rewrite baseline (needs a
//                                                 # one-line justification in the PR)

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const BASELINE = path.join(ROOT, 'ui-loc-baseline.json')
const TARGETS = ['src/App.jsx', 'src/state', 'src/screens', 'src/components']
const EXT = /\.(jsx?|tsx?)$/

function walk(rel) {
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) return []
  const st = fs.statSync(abs)
  if (st.isFile()) return EXT.test(rel) ? [abs] : []
  return fs.readdirSync(abs).flatMap((child) => walk(path.join(rel, child)))
}

// Count lines that are neither blank nor pure comments. Heuristic (a ratchet,
// not a compiler): drop blank lines and lines whose trimmed start is //, /*, *,
// or */. Good enough to stop logic growth without punishing formatting.
function countLines(abs) {
  const text = fs.readFileSync(abs, 'utf8')
  let n = 0
  for (const raw of text.split('\n')) {
    const t = raw.trim()
    if (!t) continue
    if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t === '*/') continue
    n++
  }
  return n
}

const files = TARGETS.flatMap(walk)
const total = files.reduce((sum, f) => sum + countLines(f), 0)

if (process.argv.includes('--update')) {
  fs.writeFileSync(BASELINE, JSON.stringify({ total, files: files.length }, null, 2) + '\n')
  console.log(`Updated ui-loc-baseline.json: ${total} non-comment lines across ${files.length} files.`)
  process.exit(0)
}

if (!fs.existsSync(BASELINE)) {
  console.error(`No baseline at ${BASELINE}. Create one with --update.`)
  process.exit(2)
}
const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'))
const was = baseline.total || 0
const delta = total - was
console.log(`Untestable-zone: ${total} non-comment lines (baseline ${was}, delta ${delta >= 0 ? '+' : ''}${delta}).`)

if (delta > 0) {
  const blocking = process.env.UI_RATCHET_BLOCKING === '1'
  const msg = `the untestable UI zone grew by ${delta} lines. Put new logic in src/engine or functions/_lib, or update the baseline with a justification.`
  if (blocking) {
    console.error('FAIL — ' + msg)
    process.exit(1)
  }
  console.warn('WARN (report-only) — ' + msg + ' Set UI_RATCHET_BLOCKING=1 to enforce.')
}
console.log('OK')
