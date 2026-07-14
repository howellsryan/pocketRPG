#!/usr/bin/env node
// Deterministic generator for world/zones/lumbright.json (Phase 7): a 64×64
// walled town — market square with a well, bank chest, smithy (furnace+anvil),
// kitchen (range), house/mill buildings as props on blocked footprints, gates
// east (→ pasture) and south (→ forest), three passive monsters outside the
// walls. Re-run to regenerate; hand-edit the constants, not the JSON.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const W = 64
const H = 64
const worldDir = fileURLToPath(new URL('..', import.meta.url))
const OUT = path.join(worldDir, 'zones', 'lumbright.json')

// Seeded LCG so the scatter dressing is reproducible.
let seed = 0x1c0ffee
function rand() {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 0xffffffff
}

const grid = Array.from({ length: H }, () => new Array(W).fill('.'))
const props = []
const objects = []

const block = (x, z) => { grid[z][x] = '#' }
const blockRect = (x0, z0, x1, z1) => {
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) block(x, z)
}

// ── Town wall: perimeter of (10,10)..(53,53), gates carved east + south ──
const WALL = { x0: 10, z0: 10, x1: 53, z1: 53 }
const EAST_GATE_Z = [30, 31, 32]
const SOUTH_GATE_X = [20, 21, 22]
for (let x = WALL.x0; x <= WALL.x1; x++) { block(x, WALL.z0); block(x, WALL.z1) }
for (let z = WALL.z0; z <= WALL.z1; z++) { block(WALL.x0, z); block(WALL.x1, z) }
for (const z of EAST_GATE_Z) grid[z][WALL.x1] = '.'
for (const x of SOUTH_GATE_X) grid[WALL.z1][x] = '.'

const TOWERS = [
  [WALL.x0, WALL.z0], [WALL.x1, WALL.z0], [WALL.x0, WALL.z1], [WALL.x1, WALL.z1],
  [WALL.x1, EAST_GATE_Z[0] - 1], [WALL.x1, EAST_GATE_Z[2] + 1],
  [SOUTH_GATE_X[0] - 1, WALL.z1], [SOUTH_GATE_X[2] + 1, WALL.z1],
]
const towerTiles = new Set(TOWERS.map(([x, z]) => `${x},${z}`))
for (const [x, z] of TOWERS) props.push({ model: 'town_tower', x, z, scale: 1.35 })
// The castle-kit wall piece is directional (walkway along one axis): the
// east/west runs use its default orientation, the north/south runs rotate 90°.
for (let x = WALL.x0; x <= WALL.x1; x++) {
  for (const z of [WALL.z0, WALL.z1]) {
    if (grid[z][x] === '#' && !towerTiles.has(`${x},${z}`)) props.push({ model: 'town_wall', x, z, rot: Math.PI / 2 })
  }
}
for (let z = WALL.z0 + 1; z < WALL.z1; z++) {
  for (const x of [WALL.x0, WALL.x1]) {
    if (grid[z][x] === '#' && !towerTiles.has(`${x},${z}`)) props.push({ model: 'town_wall', x, z })
  }
}

// ── Buildings: blocked footprint + one whole-building prop centred on it ──
const BUILDINGS = [
  { model: 'house', x0: 14, z0: 14, x1: 18, z1: 18, scale: 3, rot: Math.PI / 2 },
  { model: 'house', x0: 36, z0: 14, x1: 40, z1: 18, scale: 3, rot: -Math.PI / 2 },
  { model: 'house', x0: 14, z0: 36, x1: 18, z1: 40, scale: 3, rot: 0 },
  { model: 'mill', x0: 44, z0: 14, x1: 48, z1: 18, scale: 2.2, rot: Math.PI },
  { model: 'lumbermill', x0: 44, z0: 44, x1: 48, z1: 48, scale: 2.6, rot: Math.PI / 2 },
]
for (const b of BUILDINGS) {
  blockRect(b.x0, b.z0, b.x1, b.z1)
  props.push({ model: b.model, x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2, scale: b.scale, rot: b.rot })
}

// ── Market square: two stalls, a well centrepiece, lanterns, a cart ──
blockRect(26, 26, 28, 28)
props.push({ model: 'market', x: 27, z: 27, scale: 2 })
blockRect(34, 26, 36, 28)
props.push({ model: 'market', x: 35, z: 27, scale: 2, rot: Math.PI })
block(31, 31)
props.push({ model: 'well', x: 31, z: 31, scale: 1.6 })
for (const [x, z] of [[26, 34], [36, 34], [26, 24], [36, 24]]) props.push({ model: 'lantern', x, z })
props.push({ model: 'cart', x: 37, z: 31, rot: Math.PI / 3, scale: 1.2 })

// ── Interactives: bank chest by the square, smithy corner, kitchen corner ──
objects.push({ id: 'chest_1', type: 'bank_chest', x: 33, z: 33 })
objects.push({ id: 'furnace_1', type: 'furnace', x: 23, z: 22 })
objects.push({ id: 'anvil_1', type: 'anvil', x: 26, z: 22 })
props.push({ model: 'lantern', x: 24, z: 20 })
objects.push({ id: 'range_1', type: 'range', x: 31, z: 38 })
props.push({ model: 'lantern', x: 33, z: 38 })

// ── Exits: east road → pasture, south road → forest ──
const exits = [
  { id: 'exit_pasture', x: 63, z: 31, toZone: 'pasture', toX: 1, toZ: 8, label: 'the Verdant Pasture' },
  { id: 'exit_forest', x: 21, z: 63, toZone: 'forest', toX: 10, toZ: 1, label: 'the Whisperwood' },
  // West road across the open country to the capital.
  { id: 'exit_varrick', x: 0, z: 32, toZone: 'varrick', toX: 40, toZ: 82, label: 'Varrick' },
]

// ── Monsters outside the walls (all passive) ──
const npcs = [
  { id: 'bogling_1', monsterId: 'bogling_sprite', x: 58, z: 20, wander: { x: 55, z: 14, w: 8, h: 12 } },
  { id: 'imp_1', monsterId: 'frostbite_imp', x: 58, z: 42, wander: { x: 55, z: 38, w: 8, h: 10 } },
  { id: 'toad_1', monsterId: 'marshfen_toad', x: 30, z: 58, wander: { x: 24, z: 55, w: 14, h: 8 } },
]

// ── Countryside dressing outside the walls ──
const reserved = new Set()
for (const e of exits) reserved.add(`${e.x},${e.z}`)
for (const n of npcs) reserved.add(`${n.x},${n.z}`)
// Keep the gate roads clear.
for (let x = WALL.x1 + 1; x < W; x++) for (const z of EAST_GATE_Z) reserved.add(`${x},${z}`)
for (let z = WALL.z1 + 1; z < H; z++) for (const x of SOUTH_GATE_X) reserved.add(`${x},${z}`)

const SCATTER = ['pine_a', 'pine_b', 'bush', 'flowers', 'boulder', 'bush', 'flowers']
let placed = 0
while (placed < 90) {
  const x = Math.floor(rand() * W)
  const z = Math.floor(rand() * H)
  const insideTown = x >= WALL.x0 - 1 && x <= WALL.x1 + 1 && z >= WALL.z0 - 1 && z <= WALL.z1 + 1
  if (insideTown || grid[z][x] !== '.' || reserved.has(`${x},${z}`)) continue
  reserved.add(`${x},${z}`)
  const model = SCATTER[Math.floor(rand() * SCATTER.length)]
  props.push({ model, x, z, rot: rand() * Math.PI * 2 })
  placed += 1
}

const zone = {
  id: 'lumbright',
  name: 'Lumbright',
  width: W,
  height: H,
  spawn: { x: 32, z: 32 },
  collision: grid.map((row) => row.join('')),
  objects,
  npcs,
  exits,
  props,
  palette: { walkableA: '#8a9a55', walkableB: '#7e8e4c', blockedA: '#8b8378', blockedB: '#7d766c' },
}

const walkable = zone.collision.join('').split('').filter((c) => c === '.').length
console.log(`lumbright: ${walkable}/${W * H} walkable (${((walkable / (W * H)) * 100).toFixed(1)}%), ${props.length} props`)
fs.writeFileSync(OUT, JSON.stringify(zone, null, 1) + '\n')
console.log(`wrote ${OUT}`)
