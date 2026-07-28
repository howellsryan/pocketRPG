#!/usr/bin/env node
// Deterministic generator for world/zones/dragon_roost.json — one instanced
// room holding all three dragons, each in its own quarter. A 64×64 caldera:
// the ruined keep on the north shelf where the black dragons nest, a green
// glade west, a scorched lava shelf east, and rock spines between them so the
// three broods are separate places you choose to walk into, not one field.
//
// Instanced (world/shared/instances.ts): every party gets its own copy.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const W = 64
const H = 64
const worldDir = fileURLToPath(new URL('..', import.meta.url))
const OUT = path.join(worldDir, 'zones', 'dragon_roost.json')

let seed = 0xd2a607
function rand() {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 0xffffffff
}

const grid = Array.from({ length: H }, () => new Array(W).fill('.'))
const props = []
const block = (x, z) => { if (x >= 0 && x < W && z >= 0 && z < H) grid[z][x] = '#' }
const clear = (x, z) => { if (x >= 0 && x < W && z >= 0 && z < H) grid[z][x] = '.' }
const blockRect = ({ x, z, w, h }) => { for (let zz = z; zz < z + h; zz++) for (let xx = x; xx < x + w; xx++) block(xx, zz) }
const clearRect = ({ x, z, w, h }) => { for (let zz = z; zz < z + h; zz++) for (let xx = x; xx < x + w; xx++) clear(xx, zz) }

const NATIVE_HALF = {
  castle: 0.95, column: 0.2, crypt: 1.2, obelisk: 0.17, altar: 0.52, boulder: 0.51,
  torch: 0.27, pine_a: 0.27, pine_b: 0.27, skull: 0.46, bones: 0.35,
  stone_spire: 0.49, stone_slab: 0.18,
}
const BASE = {
  castle: 3.0, column: 2.0, crypt: 2.2, obelisk: 2.6, altar: 1.6, boulder: 1.3,
  torch: 1.6, pine_a: 1.7, pine_b: 1.6, bush: 1.4, flowers: 1.1,
  skull: 0.45, bones: 1.2, stone_spire: 1.9, stone_slab: 1.4,
}
const NO_COLLIDE = new Set(['flowers', 'bush', 'skull', 'bones', 'stone_slab'])
const RADIUS_OVERRIDE = { torch: 0 }
const blockFootprint = ({ model, x, z, scale }) => {
  if (NO_COLLIDE.has(model)) return
  const r = model in RADIUS_OVERRIDE
    ? RADIUS_OVERRIDE[model]
    : Math.max(0, Math.round((NATIVE_HALF[model] ?? 0.5) * (BASE[model] ?? 1) * (scale ?? 1) - 0.5))
  const cx = Math.round(x), cz = Math.round(z)
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) block(cx + dx, cz + dz)
}

// ── Caldera rim ──
const B = 3
for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
  if (x < B || x >= W - B || z < B || z >= H - B) block(x, z)
}
const MOUTH_X = [31, 32, 33]
const carveMouth = () => { for (const x of MOUTH_X) for (let z = H - B - 1; z < H; z++) clear(x, z) }
carveMouth()
for (let x = B - 1; x < W - B + 1; x += 2) {
  props.push({ model: 'stone_spire', x, z: B - 1, scale: 1.3 + rand() * 0.9, rot: rand() * Math.PI * 2 })
  if (!MOUTH_X.includes(x)) props.push({ model: 'stone_spire', x, z: H - B, scale: 1.3 + rand() * 0.9, rot: rand() * Math.PI * 2 })
}
for (let z = B - 1; z < H - B + 1; z += 2) {
  props.push({ model: 'stone_spire', x: B - 1, z, scale: 1.3 + rand() * 0.9, rot: rand() * Math.PI * 2 })
  props.push({ model: 'stone_spire', x: W - B, z, scale: 1.3 + rand() * 0.9, rot: rand() * Math.PI * 2 })
}

// ── Rock spines: what makes three broods three places. Each is a two-tile
// blocked band with one pass through it, dressed with boulders so it reads as
// stone rather than as an invisible wall. ──
const SPINES = [
  { x: 24, z: 22, w: 2, h: 30, pass: { x: 24, z: 35, w: 2, h: 4 } },
  { x: 38, z: 22, w: 2, h: 30, pass: { x: 38, z: 35, w: 2, h: 4 } },
  { x: 5, z: 21, w: 54, h: 2, pass: { x: 30, z: 21, w: 5, h: 2 } },
]
for (const s of SPINES) {
  blockRect(s)
  const along = s.w > s.h
    ? Array.from({ length: s.w }, (_, i) => [s.x + i, s.z + (i % 2)])
    : Array.from({ length: s.h }, (_, i) => [s.x + (i % 2), s.z + i])
  for (const [x, z] of along) {
    if (x >= s.pass.x - 1 && x < s.pass.x + s.pass.w + 1 && z >= s.pass.z - 1 && z < s.pass.z + s.pass.h + 1) continue
    props.push({ model: 'stone_spire', x, z, scale: 1.4 + rand() * 0.9, rot: rand() * Math.PI * 2 })
  }
  // Torches either side of the pass, so the way through is findable.
  for (const [x, z] of s.w > s.h
    ? [[s.pass.x - 2, s.z], [s.pass.x + s.pass.w + 1, s.z]]
    : [[s.x, s.pass.z - 2], [s.x, s.pass.z + s.pass.h + 1]]) {
    props.push({ model: 'torch', x, z, scale: 1.2 })
  }
}

// ── Landmark: the ruined keep on the north shelf, seen from the arrival gate
// straight up the avenue. Scale hierarchy runs keep > obelisks > columns. ──
props.push({ model: 'castle', x: 32, z: 8, scale: 1.3 })
for (const [x, z] of [[26, 10], [38, 10]]) props.push({ model: 'obelisk', x, z, scale: 1.6 })
for (const [x, z] of [[22, 14], [42, 14]]) props.push({ model: 'column', x, z, scale: 2.0 })
props.push({ model: 'altar', x: 32, z: 14, scale: 2.0 })

// ── North shelf (black brood): obsidian yard, crypts, bones ──
for (const [x, z] of [[18, 8], [46, 8], [16, 17], [48, 17]]) {
  props.push({ model: 'crypt', x, z, scale: 0.6, rot: rand() * Math.PI * 2 })
}
for (const [x, z] of [[24, 6], [40, 6], [20, 12], [44, 12], [28, 18], [36, 18]]) {
  props.push({ model: rand() < 0.5 ? 'bones' : 'skull', x, z, scale: 0.9 + rand() * 0.5, rot: rand() * Math.PI * 2 })
}
for (const [x, z] of [[29, 12], [35, 12]]) props.push({ model: 'torch', x, z, scale: 1.2 })

// ── West glade (green brood): pines in stands, clearings between them ──
const GLADE_STANDS = [[9, 27], [16, 24], [11, 38], [19, 44], [8, 47], [17, 33]]
for (const [cx, cz] of GLADE_STANDS) {
  const count = 4 + Math.floor(rand() * 3)
  for (let i = 0; i < count; i++) {
    const x = cx + Math.round((rand() - 0.5) * 5)
    const z = cz + Math.round((rand() - 0.5) * 5)
    props.push({ model: rand() < 0.5 ? 'pine_a' : 'pine_b', x, z, scale: 0.9 + rand() * 0.5, rot: rand() * Math.PI * 2 })
  }
}
for (const [x, z] of [[13, 30], [8, 35], [20, 39], [12, 45], [18, 28], [7, 42]]) {
  props.push({ model: 'bush', x, z, scale: 1 + rand() * 0.4, rot: rand() * Math.PI * 2 })
}
for (const [x, z] of [[15, 36], [10, 32], [21, 47]]) {
  props.push({ model: 'flowers', x, z, scale: 0.9 + rand() * 0.4, rot: rand() * Math.PI * 2 })
}

// ── East shelf (red brood): lava pools, scorched boulders, standing torches ──
const LAVA = [
  { x: 44, z: 27, w: 6, h: 3 }, { x: 45, z: 30, w: 4, h: 2 }, { x: 47, z: 24, w: 3, h: 3 },
  { x: 52, z: 38, w: 5, h: 3 }, { x: 53, z: 41, w: 3, h: 3 }, { x: 50, z: 36, w: 3, h: 2 },
  { x: 46, z: 46, w: 4, h: 3 }, { x: 44, z: 44, w: 3, h: 2 },
]
for (const r of LAVA) blockRect(r)
for (const [x, z] of [[43, 25], [50, 25], [51, 36], [44, 45], [55, 45], [42, 34]]) {
  props.push({ model: 'torch', x, z, scale: 1.2 })
}
for (const [x, z] of [[47, 34], [55, 30], [43, 41], [53, 50], [58, 34], [45, 51]]) {
  props.push({ model: 'boulder', x, z, scale: 1.1 + rand() * 0.6, rot: rand() * Math.PI * 2 })
}
for (const [x, z] of [[49, 33], [54, 42], [46, 50]]) {
  props.push({ model: rand() < 0.5 ? 'bones' : 'skull', x, z, scale: 0.9 + rand() * 0.4, rot: rand() * Math.PI * 2 })
}

// ── Arrival hub: a paved landing at the gate, one obelisk pair per route out ──
for (const [x, z] of [[29, 52], [35, 52]]) props.push({ model: 'obelisk', x, z, scale: 1.2 })
for (const [x, z] of [[26, 37], [22, 37], [40, 37], [44, 37]]) props.push({ model: 'torch', x, z, scale: 1.1 })
for (let z = 58; z >= 40; z -= 6) {
  for (const x of [29, 35]) props.push({ model: 'torch', x, z, scale: 1.1 })
}

const npcs = [
  { id: 'green_1', monsterId: 'green_dragon', x: 12, z: 29, wander: { x: 7, z: 25, w: 14, h: 8 } },
  { id: 'green_2', monsterId: 'green_dragon', x: 18, z: 31, wander: { x: 7, z: 25, w: 14, h: 8 } },
  { id: 'green_3', monsterId: 'green_dragon', x: 11, z: 42, wander: { x: 7, z: 38, w: 14, h: 9 } },
  { id: 'green_4', monsterId: 'green_dragon', x: 19, z: 45, wander: { x: 7, z: 38, w: 14, h: 9 } },
  { id: 'red_1', monsterId: 'red_dragon', x: 44, z: 33, wander: { x: 41, z: 29, w: 14, h: 8 } },
  { id: 'red_2', monsterId: 'red_dragon', x: 52, z: 31, wander: { x: 41, z: 29, w: 14, h: 8 } },
  { id: 'red_3', monsterId: 'red_dragon', x: 45, z: 43, wander: { x: 41, z: 40, w: 14, h: 9 } },
  { id: 'red_4', monsterId: 'red_dragon', x: 54, z: 47, wander: { x: 41, z: 40, w: 14, h: 9 } },
  { id: 'black_1', monsterId: 'black_dragon', x: 24, z: 9, wander: { x: 18, z: 6, w: 12, h: 9 } },
  { id: 'black_2', monsterId: 'black_dragon', x: 40, z: 9, wander: { x: 34, z: 6, w: 12, h: 9 } },
  { id: 'black_3', monsterId: 'black_dragon', x: 22, z: 18, wander: { x: 16, z: 15, w: 12, h: 5 } },
  { id: 'black_4', monsterId: 'black_dragon', x: 42, z: 18, wander: { x: 36, z: 15, w: 12, h: 5 } },
]

const exits = [
  { id: 'exit_highlands', x: 32, z: 63, toZone: 'overworld', toX: 272, toZ: 50, label: 'The Dragonspine', hideMarker: true },
]

// ── Collision post-pass, then reopen every route that must stay walkable ──
for (const p of props) blockFootprint(p)
carveMouth()
for (const s of SPINES) clearRect(s.pass)
const SPAWN = { x: 32, z: 57 }
clearRect({ x: 28, z: 50, w: 9, h: 9 })
clearRect({ x: 31, z: 20, w: 3, h: 40 })
clearRect({ x: 20, z: 36, w: 24, h: 2 })
clearRect({ x: 26, z: 16, w: 13, h: 6 })
for (const n of npcs) clear(n.x, n.z)
for (const e of exits) clear(e.x, e.z)
clear(SPAWN.x, SPAWN.z)

const zone = {
  id: 'dragon_roost',
  name: 'The Dragonspine Roost',
  width: W,
  height: H,
  spawn: SPAWN,
  collision: grid.map((row) => row.join('')),
  objects: [],
  npcs,
  exits,
  deathRespawn: { zone: 'overworld', x: 272, z: 50 },
  props,
  palette: { walkableA: '#6a6a52', walkableB: '#5f6049', blockedA: '#4a4438', blockedB: '#3e3930' },
  ambience: { sky: '#4a3a44', hemiIntensity: 0.55, sunIntensity: 0.8 },
  terrain: {
    relief: 0.5,
    procedural: { seed: 3391, frequency: 0.06 },
    material: 'highland',
    scatter: [{ model: 'stone_slab', density: 0.5, scaleRange: [0.4, 0.9] }],
  },
  ground: [
    { kind: 'ash', x: 41, z: 24, w: 18, h: 26 },
    { kind: 'ash', x: 40, z: 28, w: 3, h: 14 },
    { kind: 'ash', x: 44, z: 50, w: 12, h: 3 },
    ...LAVA.map((r) => ({ kind: 'lava', ...r })),
    { kind: 'floor_stone', x: 14, z: 4, w: 36, h: 17 },
    { kind: 'plaza', x: 28, z: 50, w: 9, h: 9 },
    { kind: 'path_dirt', x: 31, z: 20, w: 3, h: 40 },
    { kind: 'path_dirt', x: 20, z: 36, w: 24, h: 2 },
  ],
}

fs.writeFileSync(OUT, JSON.stringify(zone, null, 1) + '\n')
console.log(`gen-dragon-roost: wrote ${path.relative(worldDir, OUT)} (${W}×${H}, ${props.length} props, ${npcs.length} npcs)`)
