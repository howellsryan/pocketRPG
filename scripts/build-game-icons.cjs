#!/usr/bin/env node
/**
 * Extracts SVG path data for each glyph key in gameIconsManifest.json
 * from the @iconify-json/game-icons package and writes gameIcons.json.
 *
 * Also regenerates the NOTICE file with per-icon author credits.
 *
 * Usage: node scripts/build-game-icons.cjs
 */

const fs = require('fs')
const path = require('path')

const manifestPath = path.join(__dirname, '../src/data/gameIconsManifest.json')
const outPath      = path.join(__dirname, '../src/data/gameIcons.json')
const noticePath   = path.join(__dirname, '../NOTICE')
const iconSetPath  = path.join(__dirname, '../node_modules/@iconify-json/game-icons/icons.json')

if (!fs.existsSync(iconSetPath)) {
  console.error('ERROR: @iconify-json/game-icons not installed. Run: npm install --save-dev @iconify-json/game-icons')
  process.exit(1)
}

const manifest  = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
const iconSet   = JSON.parse(fs.readFileSync(iconSetPath, 'utf-8'))

// game-icons.net default viewBox is 512x512
const DEFAULT_WIDTH  = iconSet.width  || 512
const DEFAULT_HEIGHT = iconSet.height || 512

const result   = {}
const missing  = []
const authorMap = {}  // gameIconsKey → author (from iconSet.info or aliases)

for (const [ourKey, giName] of Object.entries(manifest)) {
  if (ourKey.startsWith('_')) continue  // skip comment keys

  const icon = iconSet.icons[giName]
  if (!icon) {
    missing.push(`${ourKey} → ${giName}`)
    continue
  }

  // Store the SVG body (may be a full <path .../> or multiple elements)
  // plus viewBox if non-standard
  const w = icon.width  || DEFAULT_WIDTH
  const h = icon.height || DEFAULT_HEIGHT
  result[ourKey] = {
    body: icon.body,
    viewBox: (w === 512 && h === 512) ? null : `0 0 ${w} ${h}`
  }

  // Collect author if available in info block
  const info = iconSet.info
  if (info && info.author) {
    authorMap[ourKey] = typeof info.author === 'object' ? info.author.name : info.author
  }
}

if (missing.length > 0) {
  console.warn('WARNING: missing glyphs (skipped):')
  missing.forEach(m => console.warn(' ', m))
}

fs.writeFileSync(outPath, JSON.stringify(result, null, 2))
console.log(`✅ Wrote ${Object.keys(result).length} glyphs to src/data/gameIcons.json`)

// Write NOTICE
const setInfo  = iconSet.info || {}
const authorName  = (setInfo.author && (setInfo.author.name || setInfo.author)) || 'game-icons.net contributors'
const authorUrl   = (setInfo.author && setInfo.author.url)  || 'https://game-icons.net'
const licenseUrl  = (setInfo.license && setInfo.license.url) || 'https://creativecommons.org/licenses/by/3.0/'
const licenseName = (setInfo.license && setInfo.license.title) || 'Creative Commons Attribution 3.0 Unported (CC BY 3.0)'

const noticeLines = [
  'THIRD-PARTY NOTICES',
  '===================',
  '',
  'PocketRPG uses icons from game-icons.net.',
  '',
  `Name   : game-icons.net`,
  `Author : ${authorName}`,
  `URL    : ${authorUrl}`,
  `License: ${licenseName}`,
  `        ${licenseUrl}`,
  '',
  'All game-icons.net icons used in this project are subject to the',
  `${licenseName} license.`,
  'You must provide appropriate credit when redistributing or displaying',
  'this software.',
  '',
  'Icons used (our key → game-icons name):',
  ...Object.entries(manifest)
    .filter(([k]) => !k.startsWith('_'))
    .filter(([k]) => result[k])
    .map(([k, v]) => `  ${k.padEnd(20)} → ${v}`),
  '',
  `Generated: ${new Date().toISOString().slice(0, 10)}`,
]

fs.writeFileSync(noticePath, noticeLines.join('\n') + '\n')
console.log('✅ Wrote NOTICE')
