#!/usr/bin/env node
/**
 * Bundles the bespoke, PocketRPG-owned full-color SVG icons in
 * src/assets/icons/*.svg into src/data/bespokeIcons.json.
 *
 * Each source filename is the entity id it represents (e.g. bronze_dagger.svg),
 * so the output map is keyed 1:1 by id — no manifest indirection. The renderer
 * (GameIcon) looks an entity up by id and renders the stored body as-authored
 * (full color), falling back to the legacy game-icons glyph + emoji otherwise.
 *
 * Output entry shape: { "<id>": { body, viewBox } }
 *
 * Usage: node scripts/build-bespoke-icons.cjs
 */

const fs = require('fs')
const path = require('path')

const ICON_DIR = path.join(__dirname, '../src/assets/icons')
const OUT_PATH = path.join(__dirname, '../src/data/bespokeIcons.json')
const MAX_BYTES = 4096 // per-icon budget (warn only) — keep the set lean

if (!fs.existsSync(ICON_DIR)) {
  console.error(`ERROR: no icon directory at ${ICON_DIR}`)
  process.exit(1)
}

// Light, dependency-free minify: drop XML/SVG comments, collapse inter-tag
// whitespace and runs of whitespace. Not a full SVGO pass, but keeps the JSON
// small without adding a build dependency.
function minifySvgBody(body) {
  return body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/>\s+</g, '><')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

const files = fs.readdirSync(ICON_DIR).filter((f) => f.endsWith('.svg')).sort()
const result = {}
const warnings = []

for (const file of files) {
  const id = file.slice(0, -4)
  const raw = fs.readFileSync(path.join(ICON_DIR, file), 'utf-8')

  const openTag = raw.match(/<svg\b[^>]*>/i)
  if (!openTag) { warnings.push(`${file}: no <svg> tag`); continue }

  const vbMatch = openTag[0].match(/viewBox\s*=\s*["']([^"']+)["']/i)
  const viewBox = vbMatch ? vbMatch[1].trim() : '0 0 512 512'

  const inner = raw.slice(openTag.index + openTag[0].length, raw.lastIndexOf('</svg>'))
  const body = minifySvgBody(inner)
  if (!body) { warnings.push(`${file}: empty body`); continue }

  result[id] = {
    body,
    viewBox: viewBox === '0 0 512 512' ? null : viewBox,
  }

  const bytes = Buffer.byteLength(body, 'utf-8')
  if (bytes > MAX_BYTES) warnings.push(`${file}: ${bytes}B exceeds ${MAX_BYTES}B budget`)
}

// Deterministic key order so the generated JSON diffs cleanly.
const ordered = {}
for (const k of Object.keys(result).sort()) ordered[k] = result[k]

fs.writeFileSync(OUT_PATH, JSON.stringify(ordered, null, 2) + '\n')

const totalBytes = Buffer.byteLength(JSON.stringify(ordered), 'utf-8')
console.log(`✅ Wrote ${Object.keys(ordered).length} bespoke icons to src/data/bespokeIcons.json (${(totalBytes / 1024).toFixed(1)} KiB)`)
if (warnings.length) {
  console.warn('⚠️  warnings:')
  warnings.forEach((w) => console.warn('  ', w))
}
