#!/usr/bin/env node
// Deterministic generator for world/zones/varrick_dungeon.json — the boss hall
// beneath Varrick, reached through the eastern dungeon mouth. A 48×48 enclosed
// dark-stone chamber: a pillared approach from the south entrance leading to
// Warlord Grondar on his dais at the north end. One boss, no other monsters.
// Re-run to regenerate; hand-edit the constants, not the JSON.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const W = 48
const H = 48
const worldDir = fileURLToPath(new URL('..', import.meta.url))
const OUT = path.join(worldDir, 'zones', 'varrick_dungeon.json')

let seed = 0x6a05aa
function rand() {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 0xffffffff
}

const grid = Array.from({ length: H }, () => new Array(W).fill('.'))
const props = []
const block = (x, z) => { if (x >= 0 && x < W && z >= 0 && z < H) grid[z][x] = '#' }
const clear = (x, z) => { grid[z][x] = '.' }

// Prop footprint collision (mirrors gen-varrick): every solid prop blocks the
// tiles its mesh covers, so nothing is walk-through.
const NATIVE_HALF = { column: 0.2, boulder: 0.51, lantern: 0.11, dungeon_door: 2.0, town_tower: 0.5, crypt: 1.2, altar: 0.52, banner: 0.4 }
const BASE = { column: 2.0, boulder: 1.3, dungeon_door: 0.8, crypt: 2.2, altar: 1.6, banner: 2.0 }
const RADIUS_OVERRIDE = { banner: 0 }
const blockFootprint = ({ model, x, z, scale }) => {
  const r = model in RADIUS_OVERRIDE
    ? RADIUS_OVERRIDE[model]
    : Math.max(0, Math.round((NATIVE_HALF[model] ?? 0.5) * (BASE[model] ?? 1) * (scale ?? 1) - 0.5))
  const cx = Math.round(x), cz = Math.round(z)
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) block(cx + dx, cz + dz)
}

// ── Chamber walls: a 2-tile-thick stone border, entrance carved south ──
const B = 2
for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
  if (x < B || x >= W - B || z < B || z >= H - B) block(x, z)
}
const ENTRY_X = [19, 20, 21]
for (const x of ENTRY_X) for (let z = H - B; z < H; z++) clear(x, z)

// Stone walls lining the chamber's inner ring (E/W runs rotate, like the town
// walls). The southern run leaves the entrance gap open.
const IN = B - 1
for (let x = IN; x <= W - 1 - IN; x++) {
  props.push({ model: 'town_wall', x, z: IN, rot: Math.PI / 2, scale: 1.3 })
  if (!ENTRY_X.includes(x)) props.push({ model: 'town_wall', x, z: H - 1 - IN, rot: Math.PI / 2, scale: 1.3 })
}
for (let z = IN + 1; z < H - 1 - IN; z++) {
  props.push({ model: 'town_wall', x: IN, z, scale: 1.3 })
  props.push({ model: 'town_wall', x: W - 1 - IN, z, scale: 1.3 })
}

// ── Pillared approach: two rows of columns flanking the central aisle ──
for (let z = 34; z >= 14; z -= 4) {
  for (const x of [13, 27]) props.push({ model: 'column', x, z, scale: 1.8 })
}
// Braziers (lanterns) light the aisle.
for (const [x, z] of [[15, 38], [25, 38], [15, 26], [25, 26], [15, 14], [25, 14]]) {
  props.push({ model: 'lantern', x, z })
}

// ── Grondar's dais at the north end: a stone altar backdrop + flanking towers ──
props.push({ model: 'altar', x: 20, z: 10, scale: 2.0 })
for (const [x, z] of [[14, 9], [26, 9]]) props.push({ model: 'town_tower', x, z, scale: 1.2 })
for (const [x, z] of [[12, 12], [28, 12]]) props.push({ model: 'banner', x, z, scale: 2 })

// ── Rubble scattered through the chamber ──
const reserved = new Set()
for (const p of props) reserved.add(`${Math.round(p.x)},${Math.round(p.z)}`)
let placed = 0
let guard = 0
while (placed < 14 && guard < 4000) {
  guard += 1
  const x = B + 1 + Math.floor(rand() * (W - 2 * B - 2))
  const z = B + 4 + Math.floor(rand() * (H - 2 * B - 8))
  const nearBoss = x >= 14 && x <= 26 && z <= 20
  const onAisle = x >= 17 && x <= 23
  if (nearBoss || onAisle || grid[z][x] !== '.' || reserved.has(`${x},${z}`)) continue
  reserved.add(`${x},${z}`)
  props.push({ model: 'boulder', x, z, scale: 0.9 + rand() * 0.5, rot: rand() * Math.PI * 2 })
  placed += 1
}

// ── One boss: Warlord Grondar, holding the northern dais ──
const npcs = [
  { id: 'grondar_1', monsterId: 'warlord_grondar', x: 20, z: 16, wander: { x: 15, z: 13, w: 10, h: 8 } },
]

// ── Exit: south → back to Varrick's eastern mouth ──
const exits = [
  { id: 'exit_varrick', x: 20, z: 47, toZone: 'varrick', toX: 82, toZ: 52, label: 'Varrick' },
]

// ── Collision post-pass, then re-open the entrance + keep key tiles walkable ──
for (const p of props) blockFootprint(p)
for (const x of ENTRY_X) for (let z = H - B; z < H; z++) clear(x, z)
const SPAWN = { x: 20, z: 43 }
clear(SPAWN.x, SPAWN.z)
for (const n of npcs) clear(n.x, n.z)
for (const e of exits) clear(e.x, e.z)

const zone = {
  id: 'varrick_dungeon',
  name: 'Varrick Dungeon',
  width: W,
  height: H,
  spawn: SPAWN,
  collision: grid.map((row) => row.join('')),
  objects: [],
  npcs,
  exits,
  props,
  palette: { walkableA: '#3a3532', blockedA: '#2b2724', walkableB: '#332f2c', blockedB: '#211e1c' },
  ambience: { sky: '#0c0a12', hemiIntensity: 0.4, sunIntensity: 0.7 },
  terrain: { relief: 0.15, procedural: { seed: 909, frequency: 0.1 }, material: 'volcanic' },
}

// Guards: spawn/npc/exit walkable, and reachable from spawn (4-dir flood).
const errs = []
const walkable = (x, z) => grid[z] && grid[z][x] === '.'
if (!walkable(SPAWN.x, SPAWN.z)) errs.push(`spawn blocked`)
for (const n of npcs) if (!walkable(n.x, n.z)) errs.push(`npc ${n.id} (${n.x},${n.z}) blocked`)
for (const e of exits) if (!walkable(e.x, e.z)) errs.push(`exit ${e.id} (${e.x},${e.z}) blocked`)
const reach = Array.from({ length: H }, () => new Array(W).fill(false))
const stack = [[SPAWN.x, SPAWN.z]]
reach[SPAWN.z][SPAWN.x] = true
while (stack.length) {
  const [x, z] = stack.pop()
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, nz = z + dz
    if (nx >= 0 && nx < W && nz >= 0 && nz < H && !reach[nz][nx] && grid[nz][nx] === '.') { reach[nz][nx] = true; stack.push([nx, nz]) }
  }
}
for (const [id, x, z] of [...npcs.map((n) => [n.id, n.x, n.z]), ...exits.map((e) => [e.id, e.x, e.z])]) {
  if (!reach[z][x]) errs.push(`${id} (${x},${z}) unreachable from spawn`)
}
if (errs.length) { console.error('DUNGEON GEN ERRORS:\n' + errs.join('\n')); process.exit(1) }

const walk = zone.collision.join('').split('').filter((c) => c === '.').length
console.log(`varrick_dungeon: ${walk}/${W * H} walkable (${((walk / (W * H)) * 100).toFixed(1)}%), ${props.length} props, boss warlord_grondar`)
fs.writeFileSync(OUT, JSON.stringify(zone, null, 1) + '\n')
console.log(`wrote ${OUT}`)
