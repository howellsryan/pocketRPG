#!/usr/bin/env node
// Deterministic generator for world/zones/fiend_pit.json — the lesser fiends'
// instanced hell. A 40×40 crater: a lava channel splitting the floor, a
// torch-lit black altar on the north shelf, and six fiends prowling the ash
// between them.
//
// Instanced (world/shared/instances.ts): every party gets its own copy.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const W = 40
const H = 40
const worldDir = fileURLToPath(new URL('..', import.meta.url))
const OUT = path.join(worldDir, 'zones', 'fiend_pit.json')

let seed = 0xf1e17d
function rand() {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 0xffffffff
}

const grid = Array.from({ length: H }, () => new Array(W).fill('.'))
const props = []
const block = (x, z) => { if (x >= 0 && x < W && z >= 0 && z < H) grid[z][x] = '#' }
const clear = (x, z) => { if (x >= 0 && x < W && z >= 0 && z < H) grid[z][x] = '.' }

const NATIVE_HALF = {
  altar: 0.52, column: 0.2, crypt: 1.2, obelisk: 0.17, boulder: 0.51, torch: 0.27,
  dungeon_door: 2.0, castle: 0.95, skull: 0.46, bones: 0.35, stone_spire_ember: 0.49, stone_slab: 0.18,
}
const BASE = {
  altar: 1.6, column: 2.0, crypt: 2.2, obelisk: 2.6, boulder: 1.3, torch: 1.6,
  dungeon_door: 0.8, castle: 3.0, skull: 0.45, bones: 1.2, stone_spire_ember: 1.9, stone_slab: 1.4,
}
// Bones, skulls and torch-light are floor dressing you walk over/past.
const NO_COLLIDE = new Set(['skull', 'bones', 'stone_slab'])
const RADIUS_OVERRIDE = { torch: 0 }
const blockFootprint = ({ model, x, z, scale }) => {
  if (NO_COLLIDE.has(model)) return
  const r = model in RADIUS_OVERRIDE
    ? RADIUS_OVERRIDE[model]
    : Math.max(0, Math.round((NATIVE_HALF[model] ?? 0.5) * (BASE[model] ?? 1) * (scale ?? 1) - 0.5))
  const cx = Math.round(x), cz = Math.round(z)
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) block(cx + dx, cz + dz)
}

// ── Crater walls: a thick rock rim, mouth carved south ──
const B = 3
for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
  if (x < B || x >= W - B || z < B || z >= H - B) block(x, z)
}
const MOUTH_X = [19, 20, 21]
const carveMouth = () => { for (const x of MOUTH_X) for (let z = H - B - 1; z < H; z++) clear(x, z) }
carveMouth()
// Boulders piled along the inside of the rim, so the edge reads as a crater
// wall rather than as the floor simply stopping.
for (let x = B - 1; x < W - B + 1; x += 2) {
  props.push({ model: 'stone_spire_ember', x, z: B - 1, scale: 1.2 + rand() * 0.8, rot: rand() * Math.PI * 2 })
  if (!MOUTH_X.includes(x)) props.push({ model: 'stone_spire_ember', x, z: H - B, scale: 1.2 + rand() * 0.8, rot: rand() * Math.PI * 2 })
}
for (let z = B - 1; z < H - B + 1; z += 2) {
  props.push({ model: 'stone_spire_ember', x: B - 1, z, scale: 1.2 + rand() * 0.8, rot: rand() * Math.PI * 2 })
  props.push({ model: 'stone_spire_ember', x: W - B, z, scale: 1.2 + rand() * 0.8, rot: rand() * Math.PI * 2 })
}

// ── Landmark: the altar shelf, framed by obelisks and lit by standing torches ──
props.push({ model: 'castle', x: 20, z: 5, scale: 1.15 })
props.push({ model: 'altar', x: 20, z: 10, scale: 2.6 })
for (const [x, z] of [[14, 9], [26, 9]]) props.push({ model: 'obelisk', x, z, scale: 1.5 })
for (const [x, z] of [[17, 11], [23, 11], [13, 9], [27, 9]]) props.push({ model: 'torch', x, z, scale: 1.2 })
for (const [x, z] of [[17, 12], [23, 12]]) props.push({ model: 'skull', x, z, scale: 1.1, rot: rand() * Math.PI * 2 })
props.push({ model: 'crypt', x: 8, z: 8, scale: 0.6, rot: -Math.PI / 6 })
props.push({ model: 'crypt', x: 32, z: 8, scale: 0.6, rot: Math.PI / 6 })

// ── The causeway: torches down the middle, the only lit route to the altar ──
for (let z = 34; z >= 14; z -= 4) {
  for (const x of [17, 23]) props.push({ model: 'torch', x, z, scale: 1.1 })
}

// ── Bone fields, kept off the causeway ──
const boneSpots = [
  [10, 16], [12, 20], [9, 25], [13, 30], [11, 34], [8, 21],
  [29, 17], [31, 22], [27, 26], [30, 31], [33, 19], [28, 34],
]
for (const [x, z] of boneSpots) {
  props.push({ model: rand() < 0.5 ? 'bones' : 'skull', x, z, scale: 0.9 + rand() * 0.5, rot: rand() * Math.PI * 2 })
}
for (const [x, z] of [[9, 18], [31, 27], [12, 31], [29, 16]]) {
  props.push({ model: 'stone_spire_ember', x, z, scale: 1 + rand() * 0.6, rot: rand() * Math.PI * 2 })
}
for (const [x, z] of [[11, 22], [28, 21], [14, 33], [26, 33], [16, 16], [24, 30]]) {
  props.push({ model: 'stone_slab', x, z, scale: 0.9 + rand() * 0.5, rot: rand() * Math.PI * 2 })
}

// ── The mouth, framing the only way out ──
props.push({ model: 'dungeon_door', x: 20, z: 38, scale: 0.8 })

// Lava is painted ground (decoration), so the grid is what stops anyone walking
// across it: the two side channels and the moat below the altar shelf are
// blocked, and the causeway carved back through afterwards is the only crossing.
const LAVA = [
  { x: 5, z: 13, w: 3, h: 9 }, { x: 6, z: 22, w: 3, h: 7 }, { x: 5, z: 29, w: 4, h: 5 },
  { x: 32, z: 13, w: 3, h: 8 }, { x: 31, z: 21, w: 3, h: 8 }, { x: 32, z: 29, w: 4, h: 5 },
  { x: 8, z: 12, w: 10, h: 2 }, { x: 22, z: 12, w: 10, h: 2 }, { x: 15, z: 13, w: 3, h: 2 },
  { x: 22, z: 13, w: 3, h: 2 },
]
for (const r of LAVA) {
  for (let z = r.z; z < r.z + r.h; z++) for (let x = r.x; x < r.x + r.w; x++) block(x, z)
}

const npcs = [
  { id: 'fiend_w1', monsterId: 'lesser_fiend', x: 10, z: 18, wander: { x: 7, z: 15, w: 8, h: 8 } },
  { id: 'fiend_w2', monsterId: 'lesser_fiend', x: 13, z: 24, wander: { x: 7, z: 21, w: 8, h: 8 } },
  { id: 'fiend_w3', monsterId: 'lesser_fiend', x: 10, z: 31, wander: { x: 7, z: 28, w: 8, h: 7 } },
  { id: 'fiend_e1', monsterId: 'lesser_fiend', x: 30, z: 18, wander: { x: 26, z: 15, w: 8, h: 8 } },
  { id: 'fiend_e2', monsterId: 'lesser_fiend', x: 27, z: 24, wander: { x: 26, z: 21, w: 8, h: 8 } },
  { id: 'fiend_e3', monsterId: 'lesser_fiend', x: 30, z: 31, wander: { x: 26, z: 28, w: 8, h: 7 } },
]

const exits = [
  { id: 'exit_scorched', x: 20, z: 39, toZone: 'overworld', toX: 125, toZ: 157, label: 'Draynar Road', hideMarker: true, presentation: 'door', activation: 'interact', description: 'Return to the shared overworld road.' },
]

// A bank chest inside the mouth, within reach of the tile you land (and respawn)
// on: an instance is a closed room, so restocking has to happen in it.
const SPAWN = { x: 20, z: 35 }
const objects = [{ id: 'chest_1', type: 'bank_chest', x: SPAWN.x + 1, z: SPAWN.z }]

// ── Collision post-pass, then reopen everything that must stay walkable ──
for (const p of props) blockFootprint(p)
carveMouth()
clear(SPAWN.x, SPAWN.z)
for (const o of objects) clear(o.x, o.z)
for (let z = 12; z <= 38; z++) for (const x of [19, 20, 21]) clear(x, z)
for (let x = 16; x <= 24; x++) for (let z = 10; z <= 12; z++) clear(x, z)
for (const n of npcs) clear(n.x, n.z)
for (const e of exits) clear(e.x, e.z)

const zone = {
  id: 'fiend_pit',
  name: 'The Emberfall Pit',
  width: W,
  height: H,
  spawn: SPAWN,
  collision: grid.map((row) => row.join('')),
  objects,
  npcs,
  exits,
  props,
  palette: { walkableA: '#3a2b23', walkableB: '#33251e', blockedA: '#2b1f19', blockedB: '#231a15' },
  ambience: { sky: '#2a0e08', hemiIntensity: 0.4, sunIntensity: 0.55 },
  terrain: {
    relief: 0.3,
    procedural: { seed: 6613, frequency: 0.1 },
    material: 'volcanic',
    scatter: [{ model: 'stone_slab', density: 1.1, scaleRange: [0.4, 0.9] }],
  },
  ground: [
    { kind: 'ash', x: 3, z: 3, w: 34, h: 34 },
    ...LAVA.map((r) => ({ kind: 'lava', ...r })),
    { kind: 'path_dirt', x: 19, z: 10, w: 3, h: 29 },
    { kind: 'floor_stone', x: 14, z: 5, w: 13, h: 7 },
  ],
}

fs.writeFileSync(OUT, JSON.stringify(zone, null, 1) + '\n')
console.log(`gen-fiend-pit: wrote ${path.relative(worldDir, OUT)} (${W}×${H}, ${props.length} props, ${npcs.length} npcs)`)
