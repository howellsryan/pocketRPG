#!/usr/bin/env node
/**
 * Bundles the bespoke, PocketRPG-owned full-color SVG icons into
 * src/data/bespokeIcons.json. There are two sources, merged into one map:
 *
 *  1. Per-icon files      — src/assets/icons/<id>.svg (filename = entity id).
 *  2. Tier templates      — src/assets/icon-templates/<shape>.svg + the
 *                           palette/tier table in src/assets/icon-tiers.json.
 *                           Metal gear (scimitar, dagger, platebody, …) shares
 *                           one shape recolored per tier, so we author the shape
 *                           once and expand it into <tier>_<shape> entries.
 *
 * Templates use {{token}} placeholders: {{id}} (the full entity id, used to
 * prefix gradient ids so they stay globally unique once injected), {{base}},
 * {{light}}, {{shade}} (the tier palette).
 *
 * Output entry shape: { "<id>": { body, viewBox } }
 * Usage: node scripts/build-bespoke-icons.cjs
 */

const fs = require('fs')
const path = require('path')

const ICON_DIR     = path.join(__dirname, '../src/assets/icons')
const TEMPLATE_DIR = path.join(__dirname, '../src/assets/icon-templates')
const TIERS_PATH   = path.join(__dirname, '../src/assets/icon-tiers.json')
const OUT_PATH     = path.join(__dirname, '../src/data/bespokeIcons.json')
const MAX_BYTES    = 4096 // per-icon budget (warn only)

// Light, dependency-free minify: drop comments, collapse inter-tag and runs of
// whitespace. Not a full SVGO pass, but keeps the JSON small with no dep.
function minifySvgBody(body) {
  return body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/>\s+</g, '><')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// Extract { body, viewBox } from a full <svg>…</svg> string.
function parseSvg(raw, label) {
  const openTag = raw.match(/<svg\b[^>]*>/i)
  if (!openTag) throw new Error(`${label}: no <svg> tag`)
  const vbMatch = openTag[0].match(/viewBox\s*=\s*["']([^"']+)["']/i)
  const viewBox = vbMatch ? vbMatch[1].trim() : '0 0 512 512'
  const inner = raw.slice(openTag.index + openTag[0].length, raw.lastIndexOf('</svg>'))
  const body = minifySvgBody(inner)
  if (!body) throw new Error(`${label}: empty body`)
  // A body painted with `currentColor` is one shape recoloured per variant;
  // GameIcon keys its tint override off this flag (see BESPOKE_TINT).
  const entry = { body, viewBox: viewBox === '0 0 512 512' ? null : viewBox }
  if (body.includes('currentColor')) entry.tintable = true
  return entry
}

const result = {}
const warnings = []
function add(id, entry, source) {
  if (result[id]) throw new Error(`duplicate icon id "${id}" (from ${source} and an earlier source)`)
  result[id] = entry
  const bytes = Buffer.byteLength(entry.body, 'utf-8')
  if (bytes > MAX_BYTES) warnings.push(`${id}: ${bytes}B exceeds ${MAX_BYTES}B budget`)
}

// 1. Tier templates → <tier>_<shape> entries, and named sets → explicit ids.
if (fs.existsSync(TIERS_PATH)) {
  const tiers = JSON.parse(fs.readFileSync(TIERS_PATH, 'utf-8'))
  const palettes = tiers.palettes || {}
  const fill = (tpl, id, pal) => tpl
    .replace(/\{\{id\}\}/g, id)
    .replace(/\{\{base\}\}/g, pal.base)
    .replace(/\{\{light\}\}/g, pal.light)
    .replace(/\{\{shade\}\}/g, pal.shade)

  // items: id is <tier>_<shape>, shape names the template.
  for (const [shape, tierList] of Object.entries(tiers.items || {})) {
    const tplPath = path.join(TEMPLATE_DIR, `${shape}.svg`)
    if (!fs.existsSync(tplPath)) { warnings.push(`template ${shape}.svg missing`); continue }
    const tpl = fs.readFileSync(tplPath, 'utf-8')
    for (const tier of tierList) {
      const pal = palettes[tier]
      if (!pal) { warnings.push(`palette "${tier}" missing for ${shape}`); continue }
      const id = `${tier}_${shape}`
      add(id, parseSvg(fill(tpl, id, pal), `${shape}.svg[${tier}]`), `template:${shape}`)
    }
  }

  // sets: ids that don't follow <tier>_<shape> (e.g. bare gem names). Each set
  // names a template and maps explicit ids → palette name.
  for (const [shape, idMap] of Object.entries(tiers.sets || {})) {
    const tplPath = path.join(TEMPLATE_DIR, `${shape}.svg`)
    if (!fs.existsSync(tplPath)) { warnings.push(`set template ${shape}.svg missing`); continue }
    const tpl = fs.readFileSync(tplPath, 'utf-8')
    for (const [id, palName] of Object.entries(idMap)) {
      const pal = palettes[palName]
      if (!pal) { warnings.push(`palette "${palName}" missing for ${id}`); continue }
      add(id, parseSvg(fill(tpl, id, pal), `${shape}.svg[${id}]`), `set:${shape}`)
    }
  }
}

// 2. Per-icon files.
if (fs.existsSync(ICON_DIR)) {
  for (const file of fs.readdirSync(ICON_DIR).filter((f) => f.endsWith('.svg')).sort()) {
    const id = file.slice(0, -4)
    add(id, parseSvg(fs.readFileSync(path.join(ICON_DIR, file), 'utf-8'), file), `file:${file}`)
  }
}

const ordered = {}
for (const k of Object.keys(result).sort()) ordered[k] = result[k]
fs.writeFileSync(OUT_PATH, JSON.stringify(ordered, null, 2) + '\n')

const totalBytes = Buffer.byteLength(JSON.stringify(ordered), 'utf-8')
console.log(`✅ Wrote ${Object.keys(ordered).length} bespoke icons to src/data/bespokeIcons.json (${(totalBytes / 1024).toFixed(1)} KiB)`)
if (warnings.length) {
  console.warn('⚠️  warnings:')
  warnings.forEach((w) => console.warn('  ', w))
}
