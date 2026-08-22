#!/usr/bin/env node
// Regenerates public/monster-menagerie.html — the review page for the drawn
// monsters — from the shipped geometry (src/utils/monsterShapes.js) and the
// shipped palettes/classifier (src/utils/monsterFigures.js).
//
// The whole page is generated rather than a table inside a hand-written one
// (the pattern gen-weapon-preview.mjs uses), because a monster is drawn from
// two files that have to agree: the geometry and the fit solve that places
// it. A page that re-implemented either would look authoritative while
// showing something the game does not draw, which is worse than no page.
//
//   npm run gen:monster-preview            rewrite the page
//   npm run gen:monster-preview -- --check  fail if it is stale (commit gate)

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PAGE = join(root, 'public/monster-menagerie.html')

const shapes = await import(join(root, 'src/utils/monsterShapes.js'))
const figures = await import(join(root, 'src/utils/monsterFigures.js'))
const monsters = JSON.parse(readFileSync(join(root, 'src/data/monsters.json'), 'utf8'))

const {
  MONSTER_ARCHETYPES, MONSTER_GROUPS, monsterShapeFor, monsterPartStrokeWidth,
  isStrokedPart, INKED_STROKE_ROLES, LIMB_STROKE_MIN,
} = shapes
const { monsterFigureFor, HIDE_PALETTES, FOOT_X, GROUND_Y } = figures

const list = Array.isArray(monsters) ? monsters : Object.values(monsters)

// The palette tokens live in src/index.css; this page loads no stylesheet, so
// it resolves them the same way the open world's ground loot does — read once
// from the CSS rather than restated here, or the review page shows colours
// the game does not use.
const css = readFileSync(join(root, 'src/index.css'), 'utf8')
function token(name) {
  const m = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,8})`))
  return m ? m[1] : '#888'
}
function resolve(value) {
  const m = String(value).match(/^var\((--[a-z0-9-]+)\)$/)
  return m ? token(m[1]) : value
}

const INK = '#241f1a'
const ROLE_PAINT = {
  hide: p => ({ fill: p.hide, stroke: INK }),
  belly: p => ({ fill: p.belly, stroke: INK }),
  far: p => ({ fill: p.shade, stroke: INK }),
  shade: p => ({ fill: p.shade, stroke: 'none' }),
  horn: p => ({ fill: p.horn, stroke: INK }),
  membrane: p => ({ fill: p.shade, stroke: INK }),
  cloth: p => ({ fill: p.shade, stroke: INK }),
  metal: () => ({ fill: token('--ink-hide-iron'), stroke: INK }),
  foliage: () => ({ fill: token('--ink-leaf'), stroke: INK }),
  foliagevein: () => ({ fill: 'none', stroke: token('--ink-leaf-light') }),
  maw: () => ({ fill: '#17131a', stroke: INK }),
  eye: p => ({ fill: p.eye, stroke: 'none' }),
  glow: p => ({ fill: p.eye, stroke: 'none' }),
  pupil: () => ({ fill: '#14101a', stroke: 'none' }),
  line: () => ({ fill: 'none', stroke: INK, opacity: 0.3 }),
}

function partSvg(part, scale, palette) {
  const [tag, geom, role, , extra] = part
  const paint = (ROLE_PAINT[role] || ROLE_PAINT.hide)(palette)
  const stroked = isStrokedPart(part)
  const declared = monsterPartStrokeWidth(part, 1)
  const w = declared / scale
  const fill = stroked ? 'none' : paint.fill
  const stroke = stroked ? (paint.fill === 'none' ? paint.stroke : paint.fill) : paint.stroke
  const attrs = [
    `fill="${extra && extra.fill ? extra.fill : fill}"`,
    `stroke="${extra && extra.stroke ? extra.stroke : stroke}"`,
    w ? `stroke-width="${w.toFixed(2)}"` : '',
    'stroke-linejoin="round"', 'stroke-linecap="round"',
    paint.opacity ? `opacity="${paint.opacity}"` : '',
  ].filter(Boolean).join(' ')
  const shape = tag === 'circle' ? `<circle cx="${geom.cx}" cy="${geom.cy}" r="${geom.r}" ${attrs}/>`
    : tag === 'ellipse' ? `<ellipse cx="${geom.cx}" cy="${geom.cy}" rx="${geom.rx}" ry="${geom.ry}" ${attrs}/>`
    : `<path d="${geom}" ${attrs}/>`
  if (stroked && declared >= LIMB_STROKE_MIN && INKED_STROKE_ROLES.has(role)) {
    return `<path d="${geom}" fill="none" stroke="${INK}" stroke-width="${((declared + 1.6) / scale).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>${shape}`
  }
  return shape
}

function figureSvg(figure) {
  const shape = monsterShapeFor(figure.archetype)
  const palette = {
    hide: resolve(figure.palette.hide), shade: resolve(figure.palette.shade),
    belly: resolve(figure.palette.belly), horn: resolve(figure.palette.horn),
    eye: resolve(figure.palette.eye),
  }
  const body = MONSTER_GROUPS
    .filter(g => shape.parts[g])
    .map(g => `<g>${shape.parts[g].map(p => partSvg(p, figure.scale, palette)).join('')}</g>`)
    .join('')
  return `<g transform="translate(${FOOT_X} ${GROUND_Y - figure.lift}) scale(${figure.scale})">${body}</g>`
}

// One representative monster per archetype (the lowest-level one that uses
// it), plus every dragon, because "one dragon in many colours" is the claim
// this page exists to let someone check.
function sample() {
  const byArchetype = new Map()
  for (const m of list) {
    const f = monsterFigureFor(m, m.attackStyle === 'ranged' ? 'ranged' : m.attackStyle === 'magic' ? 'magic' : 'melee')
    const prev = byArchetype.get(f.archetype)
    if (!prev || (m.combatLevel || 0) < (prev.monster.combatLevel || 0)) byArchetype.set(f.archetype, { monster: m, figure: f })
  }
  const rows = MONSTER_ARCHETYPES.map(a => byArchetype.get(a)).filter(Boolean)
  const dragons = list
    .filter(m => monsterFigureFor(m, 'melee').archetype === 'dragon')
    .map(m => ({ monster: m, figure: monsterFigureFor(m, 'melee') }))
  return { rows, dragons }
}

function cell({ monster, figure }) {
  return `<figure><svg viewBox="0 0 152 118" role="img" aria-label="${monster.name}">${figureSvg(figure)}</svg>
<figcaption><b>${monster.name}</b><span>${figure.archetype} · ${figure.paletteName} · lvl ${monster.combatLevel} · ${figure.motion}${figure.heavyMotion ? ' (heavy)' : ''}</span></figcaption></figure>`
}

const { rows, dragons } = sample()
const page = `<!doctype html>
<!-- GENERATED by npm run gen:monster-preview. Do not hand-edit. -->
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PocketRPG — monster menagerie</title>
<style>
:root { color-scheme: light }
body { margin: 0; padding: 24px; background: #e8dcc0; color: #241f1a; font: 14px/1.5 ui-sans-serif, system-ui, sans-serif }
h1 { font-size: 20px; margin: 0 0 4px }
p.note { max-width: 62ch; margin: 0 0 20px; opacity: .78 }
h2 { font-size: 15px; margin: 28px 0 10px; border-bottom: 1px solid rgba(36,31,26,.2); padding-bottom: 4px }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px }
figure { margin: 0; background: #f2e9d5; border: 1px solid rgba(36,31,26,.18); border-radius: 8px; padding: 6px }
svg { display: block; width: 100%; height: auto }
figcaption { display: flex; flex-direction: column; font-size: 11px; text-align: center; padding-top: 2px }
figcaption span { opacity: .7 }
</style></head><body>
<h1>Monster menagerie</h1>
<p class="note">Every drawn combat archetype (<code>src/utils/monsterShapes.js</code>) at the size and in the palette the game resolves for it (<code>src/utils/monsterFigures.js</code>). Generated — do not hand-edit; run <code>npm run gen:monster-preview</code>. The stage crops to 260×128 with the player on the left; this page shows the enemy half only, unmirrored (bodies are authored facing +X and the stage flips them).</p>
<h2>One per archetype (${rows.length})</h2>
<div class="grid">${rows.map(cell).join('\n')}</div>
<h2>One dragon, many colours (${dragons.length})</h2>
<div class="grid">${dragons.map(cell).join('\n')}</div>
</body></html>
`

if (process.argv.includes('--check')) {
  if (!existsSync(PAGE) || readFileSync(PAGE, 'utf8') !== page) {
    console.error('public/monster-menagerie.html is stale — run: npm run gen:monster-preview')
    process.exit(1)
  }
  console.log('monster preview in sync')
} else {
  writeFileSync(PAGE, page)
  console.log(`monster preview: ${rows.length} archetypes, ${dragons.length} dragons written`)
}
