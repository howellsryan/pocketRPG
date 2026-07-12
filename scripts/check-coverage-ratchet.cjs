#!/usr/bin/env node
// Coverage ratchet: fails if any tracked directory's UNCOVERED-line count rises
// above a checked-in baseline. Counts (not percentages) so deleting well-covered
// dead code never trips it. See docs/testing-strategy-review.md (Phase A).
//
// Usage:
//   node scripts/check-coverage-ratchet.cjs           # check against baseline
//   node scripts/check-coverage-ratchet.cjs --update   # rewrite the baseline
//
// Reads coverage/coverage-summary.json (produced by `npm run test:coverage`).

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const SUMMARY = path.join(ROOT, 'coverage', 'coverage-summary.json')
const BASELINE = path.join(ROOT, 'coverage-baseline.json')

// Directories whose coverage we hold the line on. A file maps to the longest
// matching prefix, so functions/api and functions/_lib are tracked separately.
const TRACKED = [
  'src/engine',
  'src/utils',
  'src/cloud',
  'src/db',
  'functions/api',
  'functions/_lib',
]

function bucketFor(relPath) {
  let best = null
  for (const dir of TRACKED) {
    if (relPath.startsWith(dir + '/') && (!best || dir.length > best.length)) best = dir
  }
  return best
}

function computeUncovered() {
  if (!fs.existsSync(SUMMARY)) {
    console.error(`No coverage summary at ${SUMMARY}. Run \`npm run test:coverage\` first.`)
    process.exit(2)
  }
  const summary = JSON.parse(fs.readFileSync(SUMMARY, 'utf8'))
  const uncovered = Object.fromEntries(TRACKED.map((d) => [d, 0]))
  for (const [file, data] of Object.entries(summary)) {
    if (file === 'total') continue
    const rel = path.relative(ROOT, file).split(path.sep).join('/')
    const bucket = bucketFor(rel)
    if (!bucket) continue
    const lines = data.lines || { total: 0, covered: 0 }
    uncovered[bucket] += Math.max(0, (lines.total || 0) - (lines.covered || 0))
  }
  return uncovered
}

const uncovered = computeUncovered()

if (process.argv.includes('--update')) {
  fs.writeFileSync(BASELINE, JSON.stringify(uncovered, null, 2) + '\n')
  console.log('Updated coverage-baseline.json:')
  console.table(uncovered)
  process.exit(0)
}

if (!fs.existsSync(BASELINE)) {
  console.error(`No baseline at ${BASELINE}. Create one with --update.`)
  process.exit(2)
}
const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'))

let failed = false
const rows = {}
for (const dir of TRACKED) {
  const now = uncovered[dir] || 0
  const was = baseline[dir] ?? now
  const delta = now - was
  rows[dir] = { uncovered: now, baseline: was, delta }
  if (delta > 0) failed = true
}
console.log('Uncovered-line ratchet (lower or equal = ok):')
console.table(rows)

// Report-only until flipped to blocking one release after landing (Phase A).
const BLOCKING = process.env.COVERAGE_RATCHET_BLOCKING === '1'
if (failed) {
  const msg = 'Coverage ratchet: uncovered lines rose in one or more directories above.'
  if (BLOCKING) {
    console.error('FAIL — ' + msg)
    process.exit(1)
  }
  console.warn('WARN (report-only) — ' + msg + ' Set COVERAGE_RATCHET_BLOCKING=1 to enforce.')
}
console.log('OK')
