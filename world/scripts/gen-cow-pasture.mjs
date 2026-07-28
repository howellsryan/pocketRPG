#!/usr/bin/env node
// Deterministic generator for world/zones/cow_pasture.json — the bulls' own
// instanced field. A 40×40 farm: the windmill and farmhouse at the top of the
// lane, a railed paddock west of it, a wheat field east, and eight bulls
// grazing between them.
//
// Instanced (world/shared/instances.ts): every party gets its own copy.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const W = 40
const H = 40
const worldDir = fileURLToPath(new URL('..', import.meta.url))
const OUT = path.join(worldDir, 'zones', 'cow_pasture.json')

let seed = 0x5eed17
function rand() {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 0xffffffff
}

const grid = Array.from({ length: H }, () => new Array(W).fill('.'))
const props = []
const block = (x, z) => { if (x >= 0 && x < W && z >= 0 && z < H) grid[z][x] = '#' }
const clear = (x, z) => { if (x >= 0 && x < W && z >= 0 && z < H) grid[z][x] = '.' }

const NATIVE_HALF = {
  mill: 0.85, house: 0.84, well: 0.51, cart: 0.69, pine_a: 0.27, pine_b: 0.27,
  boulder: 0.51, fence: 0.5, fence_gate: 0.5, hay_bale: 0.3, hay_stack: 0.3, wheat: 0.27,
}
const BASE = {
  pine_a: 1.7, pine_b: 1.6, bush: 1.4, flowers: 1.1, boulder: 1.3,
  fence: 1.0, fence_gate: 1.0, hay_bale: 1.6, hay_stack: 1.8, wheat: 1.4,
}
// Groundcover and the wheat crop stay walkable — a field you cannot walk into
// is a wall with a harvest painted on it.
const NO_COLLIDE = new Set(['flowers', 'bush', 'wheat'])
const RADIUS_OVERRIDE = { fence: 0, fence_gate: 0, hay_bale: 0, hay_stack: 0 }
const blockFootprint = ({ model, x, z, scale }) => {
  if (NO_COLLIDE.has(model)) return
  const r = model in RADIUS_OVERRIDE
    ? RADIUS_OVERRIDE[model]
    : Math.max(0, Math.round((NATIVE_HALF[model] ?? 0.5) * (BASE[model] ?? 1) * (scale ?? 1) - 0.5))
  const cx = Math.round(x), cz = Math.round(z)
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) block(cx + dx, cz + dz)
}

// ── Edges: a hedgerow of pines around the field, gate gap south ──
const B = 2
for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
  if (x < B || x >= W - B || z < B || z >= H - B) block(x, z)
}
const GATE_X = [19, 20, 21]
const carveGate = () => { for (const x of GATE_X) for (let z = H - B - 1; z < H; z++) clear(x, z) }
carveGate()
for (let x = B; x < W - B; x += 2) {
  props.push({ model: x % 4 === 0 ? 'pine_a' : 'pine_b', x, z: B - 1, scale: 0.9 + rand() * 0.3, rot: rand() * Math.PI * 2 })
  if (!GATE_X.includes(x)) props.push({ model: x % 4 === 0 ? 'pine_b' : 'pine_a', x, z: H - B, scale: 0.9 + rand() * 0.3, rot: rand() * Math.PI * 2 })
}
for (let z = B; z < H - B; z += 2) {
  props.push({ model: z % 4 === 0 ? 'pine_a' : 'pine_b', x: B - 1, z, scale: 0.9 + rand() * 0.3, rot: rand() * Math.PI * 2 })
  props.push({ model: z % 4 === 0 ? 'pine_b' : 'pine_a', x: W - B, z, scale: 0.9 + rand() * 0.3, rot: rand() * Math.PI * 2 })
}

// ── The farm gate: the way in and the way back out, framed ──
for (const x of [18, 22]) props.push({ model: 'fence_gate', x, z: 37, scale: 2 })

// ── Landmark: the windmill at the head of the lane, farmhouse beside it ──
props.push({ model: 'mill', x: 20, z: 7, scale: 2.2 })
props.push({ model: 'house', x: 13, z: 8, scale: 2.4, rot: Math.PI / 2 })
props.push({ model: 'well', x: 26, z: 8, scale: 1.4 })
props.push({ model: 'cart', x: 24, z: 12, scale: 1.2, rot: Math.PI / 5 })

// ── The lane: railed both sides from the gate up to the barnyard, so the
// route reads as a farm track rather than as a stripe of paint ──
for (let z = 14; z <= 32; z += 2) {
  for (const x of [17, 23]) props.push({ model: 'fence', x, z, scale: 2, rot: Math.PI / 2 })
}

// ── Paddock, west of the lane: eight bulls' worth of railed field ──
const PADDOCK = { x0: 6, z0: 16, x1: 16, z1: 32 }
const PADDOCK_GATE_Z = [23, 24]
for (let x = PADDOCK.x0; x <= PADDOCK.x1; x += 2) {
  props.push({ model: 'fence', x, z: PADDOCK.z0, scale: 2 })
  props.push({ model: 'fence', x, z: PADDOCK.z1, scale: 2 })
}
for (let z = PADDOCK.z0 + 2; z < PADDOCK.z1; z += 2) {
  props.push({ model: 'fence', x: PADDOCK.x0, z, scale: 2, rot: Math.PI / 2 })
  props.push({ model: PADDOCK_GATE_Z.includes(z) ? 'fence_gate' : 'fence', x: PADDOCK.x1, z, scale: 2, rot: Math.PI / 2 })
}
props.push({ model: 'hay_stack', x: 9, z: 19, scale: 1.3, rot: rand() * Math.PI })
props.push({ model: 'hay_bale', x: 11, z: 19, scale: 1.2, rot: rand() * Math.PI })
props.push({ model: 'hay_bale', x: 8, z: 29, scale: 1.2, rot: rand() * Math.PI })

// ── Barnyard stores: hay stacked where the cart can reach it ──
for (const [x, z] of [[17, 10], [18, 11], [23, 10]]) {
  props.push({ model: 'hay_stack', x, z, scale: 1.3, rot: rand() * Math.PI })
}

// ── Wheat field, east of the lane: rows, not scatter ──
const FIELD = { x0: 26, z0: 15, x1: 34, z1: 24 }
for (let z = FIELD.z0; z <= FIELD.z1; z += 2) {
  for (let x = FIELD.x0; x <= FIELD.x1; x += 1) {
    props.push({ model: 'wheat', x, z, scale: 1.5 + rand() * 0.4, rot: rand() * Math.PI })
  }
}
for (let z = FIELD.z0 - 1; z <= FIELD.z1 + 1; z += 2) {
  props.push({ model: 'fence', x: FIELD.x0 - 2, z, scale: 2, rot: Math.PI / 2 })
}

// ── South-east grazing meadow: the second herd, railed off the wheat ──
const MEADOW = { x0: 24, z0: 26, x1: 35, z1: 36 }
for (let x = MEADOW.x0; x <= MEADOW.x1; x += 2) props.push({ model: 'fence', x, z: MEADOW.z0, scale: 2 })
for (let z = MEADOW.z0 + 2; z <= MEADOW.z1; z += 2) props.push({ model: 'fence', x: MEADOW.x1, z, scale: 2, rot: Math.PI / 2 })

for (const [x, z] of [[27, 30], [31, 33], [24, 34], [33, 28]]) {
  props.push({ model: 'bush', x, z, scale: 1 + rand() * 0.4, rot: rand() * Math.PI * 2 })
}
for (const [x, z] of [[8, 34], [12, 35], [30, 12], [7, 13], [34, 34]]) {
  props.push({ model: 'flowers', x, z, scale: 0.9 + rand() * 0.5, rot: rand() * Math.PI * 2 })
}

// ── Eight bulls: two herds, one per side of the lane, each kept to its field ──
const npcs = [
  { id: 'bull_p1', monsterId: 'pasture_bull', x: 9, z: 21, wander: { x: 7, z: 17, w: 9, h: 6 } },
  { id: 'bull_p2', monsterId: 'pasture_bull', x: 13, z: 22, wander: { x: 7, z: 17, w: 9, h: 6 } },
  { id: 'bull_p3', monsterId: 'pasture_bull', x: 10, z: 28, wander: { x: 7, z: 25, w: 9, h: 6 } },
  { id: 'bull_p4', monsterId: 'pasture_bull', x: 14, z: 29, wander: { x: 7, z: 25, w: 9, h: 6 } },
  { id: 'bull_m1', monsterId: 'pasture_bull', x: 27, z: 28, wander: { x: 25, z: 26, w: 9, h: 7 } },
  { id: 'bull_m2', monsterId: 'pasture_bull', x: 31, z: 29, wander: { x: 25, z: 26, w: 9, h: 7 } },
  { id: 'bull_m3', monsterId: 'pasture_bull', x: 28, z: 33, wander: { x: 25, z: 31, w: 9, h: 5 } },
  { id: 'bull_m4', monsterId: 'pasture_bull', x: 32, z: 34, wander: { x: 25, z: 31, w: 9, h: 5 } },
]

// Arrival is by instance handoff; the farm gate is the way back out.
const exits = [
  { id: 'exit_farmland', x: 20, z: 39, toZone: 'overworld', toX: 170, toZ: 166, label: 'Farmland', hideMarker: true },
]

// A bank chest inside the gate, within reach of the tile you land (and respawn)
// on: an instance is a closed room, so restocking has to happen in it.
const SPAWN = { x: 20, z: 35 }
const objects = [{ id: 'chest_1', type: 'bank_chest', x: SPAWN.x + 1, z: SPAWN.z }]

// ── Collision post-pass, then reopen everything that must stay walkable ──
for (const p of props) blockFootprint(p)
carveGate()
clear(SPAWN.x, SPAWN.z)
for (const o of objects) clear(o.x, o.z)
for (let z = 12; z <= 38; z++) for (const x of [19, 20, 21]) clear(x, z)
for (const z of PADDOCK_GATE_Z) clear(PADDOCK.x1, z)
for (const n of npcs) clear(n.x, n.z)
for (const e of exits) clear(e.x, e.z)

const zone = {
  id: 'cow_pasture',
  name: 'Sunmeadow Pasture',
  width: W,
  height: H,
  spawn: SPAWN,
  collision: grid.map((row) => row.join('')),
  objects,
  npcs,
  exits,
  props,
  palette: { walkableA: '#6f8f45', walkableB: '#688742', blockedA: '#4e6d35', blockedB: '#46632f' },
  ambience: { sky: '#8fb6d6', hemiIntensity: 0.85, sunIntensity: 1.0 },
  ambient: {
    critters: [{ model: 'chicken', x: 16, z: 9, w: 9, h: 5, count: 4 }],
    smoke: [{ x: 13, z: 8, y: 2.2 }],
  },
  terrain: {
    relief: 0.22,
    procedural: { seed: 4471, frequency: 0.07 },
    material: 'meadow',
    scatter: [{ model: 'flowers', density: 1.6, scaleRange: [0.6, 1.1] }],
  },
  ground: [
    { kind: 'farm', x: 25, z: 14, w: 11, h: 12 },
    { kind: 'path_dirt', x: 19, z: 10, w: 3, h: 29 },
    { kind: 'path_dirt', x: 12, z: 10, w: 14, h: 3 },
  ],
}

fs.writeFileSync(OUT, JSON.stringify(zone, null, 1) + '\n')
console.log(`gen-cow-pasture: wrote ${path.relative(worldDir, OUT)} (${W}×${H}, ${props.length} props, ${npcs.length} npcs)`)
