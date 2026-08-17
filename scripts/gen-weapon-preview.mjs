#!/usr/bin/env node
// Regenerates the WEAPONS table inside public/weapon-forge.html from the
// shipped geometry (src/utils/weaponShapes.js), between the two marker
// comments in that file.
//
// The preview page exists to review what the GAME draws. A hand-maintained
// second copy of the geometry stops being that the first time someone edits
// one and not the other — and the page would keep looking authoritative while
// being wrong, which is worse than not having it.
//
//   npm run gen:weapon-preview          rewrite the table
//   npm run gen:weapon-preview -- --check   fail if it is stale (CI/commit gate)

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PAGE = join(root, 'public/weapon-forge.html')
const START = '  /* GENERATED:weapons — npm run gen:weapon-preview. Do not hand-edit. */'
const END = '  /* END GENERATED:weapons */'

// Only weaponShapes is imported: actionSprites reaches equipment/itemIcons
// through extensionless specifiers that plain Node ESM cannot resolve. It is
// not needed anyway — tests/weaponShapes.test.ts already asserts that
// WEAPON_ICON_TYPES and WEAPON_SHAPES name exactly the same weapons, so
// either one is a complete list.
const { WEAPON_SHAPES, ROLE_STROKE, GRIP_X, GRIP_Y } = await import(join(root, 'src/utils/weaponShapes.js'))

// A scaled copy sits directly after the weapon it is a copy of, so the review
// page puts a shortbow beside its longbow instead of in a trailing clump.
const ORDER = (() => {
  const bases = Object.keys(WEAPON_SHAPES).filter((id) => !WEAPON_SHAPES[id].scaledFrom)
  return bases.flatMap((id) => [id, ...Object.keys(WEAPON_SHAPES).filter((k) => WEAPON_SHAPES[k].scaledFrom === id)])
})()

const MOTION = { longbow: 'ranged', shortbow: 'ranged', crossbow: 'ranged', staff: 'magic', wand: 'magic' }
const VARIANT = { godsword: 'smash', maul: 'smash', rapier: 'lunge' }

const body = ORDER.map((id) => {
  const s = WEAPON_SHAPES[id]
  const fields = [
    `label: ${JSON.stringify(s.label)}`,
    `motion: ${JSON.stringify(MOTION[id] || 'melee')}`,
    `angle: ${s.angle}`,
    `scale: ${s.scale}`,
  ]
  if (VARIANT[id]) fields.push(`variant: ${JSON.stringify(VARIANT[id])}`)
  if (s.shot) fields.push(`shot: ${JSON.stringify(s.shot)}`)
  if (s.shotFrom) fields.push(`shotFrom: [${s.shotFrom.join(', ')}]`)
  fields.push(`parts: ${JSON.stringify(s.parts)}`)
  return `    ${id}: { ${fields.join(', ')} },`
}).join('\n')

const generated = [
  START,
  `  var GRIP_X = ${GRIP_X}, GRIP_Y = ${GRIP_Y};`,
  `  var ROLE_STROKE = ${JSON.stringify(ROLE_STROKE)};`,
  '  var WEAPONS = {',
  body,
  '  };',
  `  var ORDER = ${JSON.stringify(ORDER)};`,
  END,
].join('\n')

const page = readFileSync(PAGE, 'utf8')
const a = page.indexOf(START)
const b = page.indexOf(END)
if (a < 0 || b < 0) {
  console.error(`Markers not found in ${PAGE}. Expected:\n${START}\n...\n${END}`)
  process.exit(1)
}
const next = page.slice(0, a) + generated + page.slice(b + END.length)

if (process.argv.includes('--check')) {
  if (next !== page) {
    console.error('public/weapon-forge.html is stale — run: npm run gen:weapon-preview')
    process.exit(1)
  }
  console.log('weapon preview in sync')
} else {
  writeFileSync(PAGE, next)
  console.log(`weapon preview: ${ORDER.length} weapons written`)
}
