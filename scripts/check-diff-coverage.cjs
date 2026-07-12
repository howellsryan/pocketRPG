#!/usr/bin/env node
// Changed-lines coverage gate: the lines a PR ADDS under the tracked source
// dirs must be ≥90% covered by the test run. This is the mechanical form of
// "new logic ships proven by tests" — it fires only on the diff, so legacy
// debt never blocks unrelated work. See docs/testing-strategy-review.md (Phase B).
//
// Runs on pull_request events only (needs a merge-base). Report-only until
// DIFF_COVERAGE_BLOCKING=1. Reads coverage/coverage-final.json (istanbul shape,
// produced by `npm run test:coverage`).
//
// Usage: node scripts/check-diff-coverage.cjs

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const FINAL = path.join(ROOT, 'coverage', 'coverage-final.json')
const THRESHOLD = 0.9
const TRACKED = ['src/engine', 'src/utils', 'src/cloud', 'src/db', 'functions']

function sh(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
}

function resolveBase() {
  if (process.env.DIFF_BASE) return process.env.DIFF_BASE
  const ref = process.env.GITHUB_BASE_REF
  return ref ? `origin/${ref}` : 'origin/main'
}

let mergeBase
try {
  const base = resolveBase()
  mergeBase = sh(`git merge-base ${base} HEAD`).trim()
} catch {
  console.log('No merge-base available (not a PR context) — skipping diff-coverage gate.')
  process.exit(0)
}

// Parse `git diff -U0` into { relPath: Set<addedLineNumber> }.
function addedLines() {
  const paths = TRACKED.join(' ')
  const diff = sh(`git diff -U0 ${mergeBase} HEAD -- ${paths}`)
  const added = {}
  let file = null
  let newLine = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      file = line.slice(6).trim()
      added[file] = added[file] || new Set()
    } else if (line.startsWith('@@')) {
      const m = line.match(/\+(\d+)(?:,(\d+))?/)
      newLine = m ? parseInt(m[1], 10) : 0
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      if (file) added[file].add(newLine)
      newLine++
    } else if (!line.startsWith('-') && !line.startsWith('---')) {
      newLine++
    }
  }
  // Only source files we care about (skip pure deletions / non-code).
  for (const f of Object.keys(added)) {
    if (!/\.(js|jsx|ts|mjs|cjs)$/.test(f) || !added[f].size) delete added[f]
  }
  return added
}

function loadCoverage() {
  if (!fs.existsSync(FINAL)) {
    console.error(`No ${FINAL}. Run \`npm run test:coverage\` first.`)
    process.exit(2)
  }
  const raw = JSON.parse(fs.readFileSync(FINAL, 'utf8'))
  // rel path -> Map(line -> covered?). A line is executable if a statement
  // starts on it; covered if any such statement was hit.
  const byFile = {}
  for (const [abs, data] of Object.entries(raw)) {
    const rel = path.relative(ROOT, abs).split(path.sep).join('/')
    const lines = new Map()
    const sm = data.statementMap || {}
    const s = data.s || {}
    for (const [id, loc] of Object.entries(sm)) {
      const ln = loc.start && loc.start.line
      if (!ln) continue
      const hit = (s[id] || 0) > 0
      lines.set(ln, (lines.get(ln) || false) || hit)
    }
    byFile[rel] = lines
  }
  return byFile
}

const added = addedLines()
const cov = loadCoverage()

let totalExec = 0
let totalCovered = 0
const offenders = []

for (const [file, lineSet] of Object.entries(added)) {
  const map = cov[file]
  if (!map) {
    // Changed source file absent from coverage = never loaded by any test.
    // Treat its added lines as uncovered so a brand-new untested module fails.
    totalExec += lineSet.size
    offenders.push(`${file}: no coverage data (module never imported by a test) — ${lineSet.size} added lines`)
    continue
  }
  for (const ln of lineSet) {
    if (!map.has(ln)) continue // non-executable added line (blank, comment, brace)
    totalExec++
    if (map.get(ln)) totalCovered++
    else offenders.push(`${file}:${ln} added but not covered`)
  }
}

if (totalExec === 0) {
  console.log('Diff-coverage: no executable source lines added under tracked dirs. OK.')
  process.exit(0)
}

const pct = totalCovered / totalExec
console.log(`Diff-coverage: ${totalCovered}/${totalExec} added executable lines covered (${(pct * 100).toFixed(1)}%, need ${THRESHOLD * 100}%).`)
if (offenders.length) {
  console.log('Uncovered additions:')
  for (const o of offenders.slice(0, 50)) console.log('  ' + o)
  if (offenders.length > 50) console.log(`  …and ${offenders.length - 50} more`)
}

if (pct < THRESHOLD) {
  const blocking = process.env.DIFF_COVERAGE_BLOCKING === '1'
  if (blocking) {
    console.error('FAIL — new lines are under-tested. Add tests for the additions above.')
    process.exit(1)
  }
  console.warn('WARN (report-only) — new lines under-tested. Set DIFF_COVERAGE_BLOCKING=1 to enforce.')
}
console.log('OK')
