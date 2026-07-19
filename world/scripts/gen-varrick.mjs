#!/usr/bin/env node
// Deterministic generator for world/zones/varrick.json — the walled capital of
// Eldermoor, authored to match the place map (src/data/placeMaps.json `varrick`
// + public/world/varrick-map.jpg): a 96×96 grand city with the cathedral/keep to
// the north-east, the Royal Chapel to the south, a market square with a fountain
// at its heart, a residential district to the west, and the labelled activity
// spots placed where the map puts them. Engine-supported activities are wired as
// interactive objects (Bank, Grand Smithy furnace+anvil, Market Stove, the Old
// Forest woodcutting grove); the rest (Sawmill, Runic Sanctum, Rooftop Course,
// Trading Post, Quests Board, the Dungeon mouth) are landmark props for later
// phases. A safe capital — no street monsters; combat is gated behind the
// eastern Dungeon mouth once that zone exists. Re-run to regenerate; hand-edit
// the constants, not the JSON.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const W = 96
const H = 96
const worldDir = fileURLToPath(new URL('..', import.meta.url))
const OUT = path.join(worldDir, 'zones', 'varrick.json')

let seed = 0x5a11ee
function rand() {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 0xffffffff
}

const grid = Array.from({ length: H }, () => new Array(W).fill('.'))
const props = []
const objects = []

const block = (x, z) => { if (x >= 0 && x < W && z >= 0 && z < H) grid[z][x] = '#' }
const clear = (x, z) => { grid[z][x] = '.' }
const blockRect = (x0, z0, x1, z1) => {
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) block(x, z)
}
// A whole-building prop centred on a blocked footprint.
const building = (model, x0, z0, x1, z1, scale, rot = 0) => {
  blockRect(x0, z0, x1, z1)
  props.push({ model, x: (x0 + x1) / 2, z: (z0 + z1) / 2, scale, rot })
}

// Props are visual-only; collision lives in the ASCII grid. So the player can't
// walk into solid scenery, every placed prop blocks the tiles its mesh actually
// covers — from the model's measured native half-width × base scale (props.ts) ×
// the placement scale, as a tile radius. Low groundcover stays walkable; a thin
// banner blocks only its pole tile. Run as a post-pass over all props below.
const NATIVE_HALF = {
  castle: 0.95, fountain: 1.0, stall: 0.5, banner: 0.4, altar: 0.52, crypt: 1.2,
  column: 0.2, dungeon_stairs: 2.5, dungeon_door: 2.0, house: 0.84, market: 0.77,
  mill: 0.85, lumbermill: 0.92, well: 0.51, watchtower: 0.88, town_tower: 0.5,
  town_wall: 0.5, lantern: 0.11, cart: 0.69, pine_a: 0.27, pine_b: 0.27, boulder: 0.51,
}
const BASE = {
  castle: 3.0, fountain: 1.5, stall: 1.8, banner: 2.0, altar: 1.6, crypt: 2.2,
  column: 2.0, dungeon_stairs: 0.9, dungeon_door: 0.8, pine_a: 1.7, pine_b: 1.6,
  bush: 1.4, mushrooms: 1.1, flowers: 1.1, boulder: 1.3,
}
const NO_COLLIDE = new Set(['flowers', 'bush', 'mushrooms']) // walkable groundcover
const RADIUS_OVERRIDE = { banner: 0 } // thin flagpole — block only its own tile
const blockFootprint = ({ model, x, z, scale }) => {
  if (NO_COLLIDE.has(model)) return
  const r = model in RADIUS_OVERRIDE
    ? RADIUS_OVERRIDE[model]
    : Math.max(0, Math.round((NATIVE_HALF[model] ?? 0.5) * (BASE[model] ?? 1) * (scale ?? 1) - 0.5))
  const cx = Math.round(x), cz = Math.round(z)
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) block(cx + dx, cz + dz)
}

// ── Town wall: perimeter of (14,12)..(80,84); gates south / east / west ──
const WALL = { x0: 14, z0: 12, x1: 80, z1: 84 }
const SOUTH_GATE_X = [39, 40, 41] // ceremonial road → Lumbright
const EAST_GATE_Z = [51, 52, 53]  // road → the Dungeon mouth
const WEST_GATE_Z = [43, 44, 45]  // postern → the Old Forest
for (let x = WALL.x0; x <= WALL.x1; x++) { block(x, WALL.z0); block(x, WALL.z1) }
for (let z = WALL.z0; z <= WALL.z1; z++) { block(WALL.x0, z); block(WALL.x1, z) }
for (const x of SOUTH_GATE_X) clear(x, WALL.z1)
for (const z of EAST_GATE_Z) clear(WALL.x1, z)
for (const z of WEST_GATE_Z) clear(WALL.x0, z)

const TOWERS = [
  [WALL.x0, WALL.z0], [WALL.x1, WALL.z0], [WALL.x0, WALL.z1], [WALL.x1, WALL.z1],
  [WALL.x1, EAST_GATE_Z[0] - 1], [WALL.x1, EAST_GATE_Z[2] + 1],
  [SOUTH_GATE_X[0] - 1, WALL.z1], [SOUTH_GATE_X[2] + 1, WALL.z1],
  [WALL.x0, WEST_GATE_Z[0] - 1], [WALL.x0, WEST_GATE_Z[2] + 1],
  // Mid-wall towers for a capital's scale.
  [WALL.x0 + 22, WALL.z0], [WALL.x1 - 22, WALL.z0],
  [WALL.x0, WALL.z0 + 24], [WALL.x1, WALL.z0 + 24],
  [WALL.x0, WALL.z0 + 48], [WALL.x1, WALL.z0 + 48],
]
const towerTiles = new Set(TOWERS.map(([x, z]) => `${x},${z}`))
for (const [x, z] of TOWERS) props.push({ model: 'town_tower', x, z, scale: 1.4 })
// The castle-kit wall piece is directional: N/S runs default, E/W runs rotate.
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

// ── Grand cathedral / keep — the north-east centrepiece (map top-right) ──
building('castle', 60, 16, 68, 24, 2.4, 0)
for (const [x, z] of [[59, 15], [69, 15], [59, 25], [69, 25]]) props.push({ model: 'column', x, z, scale: 1.6 })
props.push({ model: 'banner', x: 64, z: 25, scale: 2.2 })

// ── Rooftop agility course (map 56,19) — clustered towers/rooftops ──
building('house', 50, 15, 54, 19, 2.4, Math.PI / 2)
props.push({ model: 'watchtower', x: 52, z: 17, scale: 1.7 })
props.push({ model: 'town_tower', x: 55, z: 15, scale: 1.1 })
props.push({ model: 'banner', x: 50, z: 15, scale: 1.8 })

// ── Grand Smithy (map 54,33): furnace + anvil beside the forge house ──
building('house', 53, 29, 57, 33, 2.6, -Math.PI / 2)
objects.push({ id: 'furnace_1', type: 'furnace', x: 51, z: 30 })
objects.push({ id: 'anvil_1', type: 'anvil', x: 51, z: 32 })
props.push({ model: 'lantern', x: 58, z: 31 })
props.push({ model: 'cart', x: 51, z: 34, rot: Math.PI / 4, scale: 1.1 })

// ── Bank of Varrick (map 48,37) ──
building('market', 44, 35, 49, 39, 2.4, 0)
objects.push({ id: 'chest_1', type: 'bank_chest', x: 51, z: 37 })
props.push({ model: 'lantern', x: 43, z: 36 })
props.push({ model: 'banner', x: 44, z: 34, scale: 1.8 })

// ── Market Stove (map 38,26): cooking range with market stalls ──
objects.push({ id: 'range_1', type: 'range', x: 38, z: 26 })
props.push({ model: 'stall', x: 36, z: 26, scale: 1.8 })
props.push({ model: 'stall', x: 40, z: 26, scale: 1.8, rot: Math.PI })
props.push({ model: 'lantern', x: 38, z: 24 })

// ── Trading Post (map 33,31): a merchant's stand ──
building('stall', 32, 30, 34, 32, 2.2, Math.PI / 2)
props.push({ model: 'banner', x: 35, z: 30, scale: 1.8 })
props.push({ model: 'cart', x: 31, z: 32, rot: Math.PI / 3, scale: 1.1 })

// ── Sawmill (map 17,28): plank conversion is not a world action yet ──
building('lumbermill', 15, 25, 20, 30, 2.6, Math.PI / 2)
props.push({ model: 'cart', x: 21, z: 29, rot: -Math.PI / 3, scale: 1.2 })

// ── Quests Board (map 19,33): a notice stand by the west road ──
building('stall', 18, 33, 20, 35, 2.0, 0)
props.push({ model: 'banner', x: 17, z: 33, scale: 1.9 })
props.push({ model: 'lantern', x: 21, z: 34 })

// ── Runic Sanctum (map 51,46): an open stone shrine ──
blockRect(49, 45, 51, 47)
props.push({ model: 'altar', x: 50, z: 46, scale: 1.8 })
for (const [x, z] of [[48, 44], [52, 44], [48, 48], [52, 48]]) props.push({ model: 'column', x, z, scale: 1.7 })

// ── Royal Chapel (map 51,56): stone chapel with a bell tower ──
building('crypt', 48, 54, 53, 59, 2.2, 0)
props.push({ model: 'town_tower', x: 50, z: 60, scale: 1.2 })
props.push({ model: 'altar', x: 50, z: 52, scale: 1.5 })
for (const [x, z] of [[47, 53], [54, 53]]) props.push({ model: 'column', x, z, scale: 1.6 })

// ── Residential district (map's dense houses, west-centre) ──
const HOUSES = [
  ['house', 24, 28, 28, 32, 2.4, Math.PI / 2],
  ['house', 30, 28, 34, 32, 2.4, -Math.PI / 2],
  ['house', 24, 36, 28, 40, 2.4, 0],
  ['house', 30, 36, 34, 40, 2.4, Math.PI],
  ['house', 22, 44, 26, 48, 2.4, Math.PI / 2],
  ['mill', 30, 44, 34, 48, 2.2, 0],
  ['house', 24, 52, 28, 56, 2.4, -Math.PI / 2],
  ['house', 30, 52, 34, 56, 2.4, Math.PI / 2],
  // Eastern row, linking the town cluster to the cathedral grounds.
  ['house', 58, 34, 62, 38, 2.4, -Math.PI / 2],
  ['house', 64, 34, 68, 38, 2.4, Math.PI / 2],
  ['house', 58, 42, 62, 46, 2.4, 0],
  ['mill', 65, 44, 69, 48, 2.2, Math.PI],
]
for (const [m, x0, z0, x1, z1, s, r] of HOUSES) building(m, x0, z0, x1, z1, s, r)
for (const [x, z] of [[29, 34], [29, 42], [23, 50], [63, 40], [59, 40]]) props.push({ model: 'lantern', x, z })

// ── Market square: a fountain heart with banners, stalls, lanterns ──
block(44, 50)
props.push({ model: 'fountain', x: 44, z: 50, scale: 1.7 })
for (const [x, z] of [[40, 46], [48, 46], [40, 54], [48, 54]]) props.push({ model: 'banner', x, z, scale: 2 })
props.push({ model: 'stall', x: 41, z: 50, scale: 1.7, rot: Math.PI / 2 })
props.push({ model: 'stall', x: 47, z: 50, scale: 1.7, rot: -Math.PI / 2 })
for (const [x, z] of [[41, 47], [47, 47], [41, 53], [47, 53]]) props.push({ model: 'lantern', x, z })
props.push({ model: 'cart', x: 45, z: 53, rot: Math.PI / 5, scale: 1.2 })

// ── South-gate plaza: gatehouses flanking the ceremonial road to Lumbright ──
building('house', 33, 78, 37, 82, 2.3, Math.PI / 2)
building('house', 43, 78, 47, 82, 2.3, -Math.PI / 2)
for (const [x, z] of [[38, 80], [42, 80]]) props.push({ model: 'banner', x, z, scale: 2 })
for (const [x, z] of [[38, 78], [42, 78]]) props.push({ model: 'lantern', x, z })
props.push({ model: 'cart', x: 40, z: 76, rot: Math.PI / 6, scale: 1.2 })

// ── Interior greenery: trees dotted through the courtyards (map shows wooded) ──
for (const [x, z] of [
  [18, 18], [22, 20], [72, 74], [76, 70], [20, 74], [74, 20],
  [26, 64], [32, 66], [22, 70], [52, 66], [58, 62], [64, 68],
  [50, 74], [60, 76], [28, 78], [70, 60], [18, 62], [54, 78],
]) {
  props.push({ model: rand() < 0.5 ? 'pine_a' : 'pine_b', x, z, rot: rand() * Math.PI * 2 })
}
for (const [x, z] of [[30, 62], [56, 70], [24, 66], [66, 64], [46, 68], [36, 72]]) {
  props.push({ model: rand() < 0.5 ? 'bush' : 'flowers', x, z, rot: rand() * Math.PI * 2 })
}

// ── Old Forest (map 8,43): woodcutting grove OUTSIDE the west gate ──
const GROVE = [
  ['normal', 7, 39], ['normal', 10, 41], ['oak', 6, 44], ['normal', 9, 46],
  ['normal', 11, 48], ['oak', 7, 50], ['normal', 5, 42],
]
GROVE.forEach(([kind, x, z], i) => objects.push({ id: `tree_${i + 1}`, type: 'tree', tree: kind, x, z }))
for (const [x, z] of [[8, 38], [12, 43], [6, 47], [9, 51], [11, 39], [5, 49]]) {
  props.push({ model: rand() < 0.5 ? 'pine_a' : 'pine_b', x, z, rot: rand() * Math.PI * 2 })
}

// ── Dungeon mouth (map 83,52): the descent to Warlord Grondar, east of wall ──
const DUNGEON_X = 87
props.push({ model: 'dungeon_door', x: DUNGEON_X, z: 52, rot: -Math.PI / 2, scale: 0.9 })
props.push({ model: 'dungeon_stairs', x: DUNGEON_X + 2, z: 52, rot: -Math.PI / 2, scale: 0.9 })
for (const [x, z] of [[85, 49], [85, 55]]) props.push({ model: 'town_tower', x, z, scale: 1.1 })
for (const [x, z] of [[83, 49], [83, 55]]) props.push({ model: 'banner', x, z, scale: 2 })
for (const [x, z] of [[89, 48], [90, 56], [85, 58]]) props.push({ model: 'boulder', x, z, scale: 1.2 })

// ── Exits: south gate → Lumbright, east mouth → the dungeon (returns added on
//    the far side of each) ──
const exits = [
  { id: 'exit_lumbright', x: 40, z: 95, toZone: 'lumbright', toX: 2, toZ: 32, label: 'Lumbright' },
  { id: 'exit_dungeon', x: 84, z: 52, toZone: 'varrick_dungeon', toX: 20, toZ: 43, label: 'Varrick Dungeon' },
]

// ── Countryside dressing outside the walls (gate roads + grove + dungeon kept clear) ──
const reserved = new Set()
for (const e of exits) reserved.add(`${e.x},${e.z}`)
for (const o of objects) reserved.add(`${o.x},${o.z}`)
for (const p of props) reserved.add(`${Math.round(p.x)},${Math.round(p.z)}`)
for (let z = WALL.z1 + 1; z < H; z++) for (const x of SOUTH_GATE_X) reserved.add(`${x},${z}`)
for (let x = WALL.x1 + 1; x < W; x++) for (const z of EAST_GATE_Z) reserved.add(`${x},${z}`)
for (let x = 0; x < WALL.x0; x++) for (const z of WEST_GATE_Z) reserved.add(`${x},${z}`)

const SCATTER = ['pine_a', 'pine_b', 'bush', 'flowers', 'boulder', 'bush', 'pine_a', 'flowers']
let placed = 0
let guard = 0
while (placed < 140 && guard < 20000) {
  guard += 1
  const x = Math.floor(rand() * W)
  const z = Math.floor(rand() * H)
  const insideTown = x >= WALL.x0 - 1 && x <= WALL.x1 + 1 && z >= WALL.z0 - 1 && z <= WALL.z1 + 1
  if (insideTown || grid[z][x] !== '.' || reserved.has(`${x},${z}`)) continue
  reserved.add(`${x},${z}`)
  const model = SCATTER[Math.floor(rand() * SCATTER.length)]
  props.push({ model, x, z, rot: rand() * Math.PI * 2 })
  placed += 1
}

// ── Collision post-pass: every solid prop blocks the tiles its mesh covers ──
for (const p of props) blockFootprint(p)
// Re-open the gate lanes in case a flanking prop's footprint spilled onto them.
for (const x of SOUTH_GATE_X) clear(x, WALL.z1)
for (const z of EAST_GATE_Z) clear(WALL.x1, z)
for (const z of WEST_GATE_Z) clear(WALL.x0, z)
// Keep interactive/spawn tiles walkable even if an adjacent footprint reached them.
const SPAWN = { x: 40, z: 62 }
for (const o of objects) clear(o.x, o.z)
clear(SPAWN.x, SPAWN.z)

// ── Painted ground (§4.1): the street skeleton — decoration only, collision is
//    untouched above. Composition order: the market square is the civic heart,
//    a cobbled grand avenue runs gate → square → cathedral, dirt lanes branch to
//    the districts, and each gate road continues outside the walls to its exit.
const ground = [
  // Grand ceremonial avenue: south gate → market square (spawn sits on it).
  { kind: 'path_cobble', x: 39, z: 52, w: 3, h: 32 },
  // Market square: paved plaza around the fountain, stalls and banners.
  { kind: 'plaza', x: 38, z: 45, w: 14, h: 11 },
  // North avenue: market square → bank → cathedral grounds.
  { kind: 'path_cobble', x: 44, z: 24, w: 3, h: 22 },
  // Cathedral forecourt + the spur linking it to the north avenue.
  { kind: 'plaza', x: 58, z: 24, w: 12, h: 6 },
  { kind: 'path_cobble', x: 46, z: 24, w: 14, h: 2 },
  // East cross-road: market square → east gate → the Dungeon mouth.
  { kind: 'path_cobble', x: 51, z: 51, w: 29, h: 3 },
  // West road: market square → sanctum/quests → west gate (postern).
  { kind: 'path_dirt', x: 14, z: 43, w: 25, h: 3 },
  // Sawmill/trading-post lane linking the north-west workshops to the avenue.
  { kind: 'path_dirt', x: 20, z: 29, w: 24, h: 2 },
  // West residential spine + the mill cross-lane.
  { kind: 'path_dirt', x: 27, z: 28, w: 2, h: 28 },
  { kind: 'path_dirt', x: 24, z: 41, w: 10, h: 2 },
  // Chapel approach off the market square.
  { kind: 'path_dirt', x: 48, z: 54, w: 3, h: 6 },
  // South-gate plaza framing the ceremonial entrance.
  { kind: 'plaza', x: 37, z: 76, w: 8, h: 8 },
  // Gate roads continuing outside the walls to each exit / landmark.
  { kind: 'path_dirt', x: 39, z: 84, w: 3, h: 12 },
  { kind: 'path_dirt', x: 80, z: 51, w: 16, h: 3 },
  { kind: 'path_dirt', x: 0, z: 43, w: 14, h: 3 },
]

// ── Ambient life (§4.4): non-combat hens on the streets and chimney smoke —
//    render-only, no collision, no server. A safe capital reads as inhabited.
const ambient = {
  critters: [
    { model: 'chicken', x: 38, z: 56, w: 10, h: 6, count: 5 }, // market avenue by spawn
    { model: 'chicken', x: 22, z: 33, w: 10, h: 8, count: 4 }, // west residential courtyard
  ],
  smoke: [
    { x: 55, z: 31, y: 2.6 }, // Grand Smithy
    { x: 26, z: 30, y: 2.4 }, // residential
    { x: 32, z: 38, y: 2.4 },
    { x: 32, z: 46, y: 2.6 }, // mill
    { x: 60, z: 36, y: 2.4 }, // eastern row
  ],
}

const zone = {
  id: 'varrick',
  name: 'Varrick',
  width: W,
  height: H,
  spawn: SPAWN,
  collision: grid.map((row) => row.join('')),
  objects,
  npcs: [],
  exits,
  props,
  ground,
  ambient,
  palette: { walkableA: '#8a9a55', walkableB: '#7e8e4c', blockedA: '#9a9186', blockedB: '#89806f' },
  terrain: {
    relief: 0.7,
    procedural: { seed: 4096, frequency: 0.06 },
    material: 'meadow',
    scatter: [
      { model: 'flowers', density: 1.5, scaleRange: [0.8, 1.1] },
      { model: 'bush', density: 1, scaleRange: [0.7, 1] },
    ],
  },
}

// Fail fast if any interactive/spawn/exit tile got blocked by a footprint.
const errs = []
const walkable = (x, z) => grid[z] && grid[z][x] === '.'
if (!walkable(zone.spawn.x, zone.spawn.z)) errs.push(`spawn (${zone.spawn.x},${zone.spawn.z}) blocked`)
for (const o of objects) if (!walkable(o.x, o.z)) errs.push(`object ${o.id} (${o.x},${o.z}) blocked`)
for (const e of exits) if (!walkable(e.x, e.z)) errs.push(`exit ${e.id} (${e.x},${e.z}) blocked`)
// Connectivity: every object, exit, and the Lumbright arrival tile must be
// reachable on foot from spawn (4-dir flood — a subset of the server's 8-dir).
const reach = Array.from({ length: H }, () => new Array(W).fill(false))
const stack = [[SPAWN.x, SPAWN.z]]
reach[SPAWN.z][SPAWN.x] = true
while (stack.length) {
  const [x, z] = stack.pop()
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, nz = z + dz
    if (nx >= 0 && nx < W && nz >= 0 && nz < H && !reach[nz][nx] && grid[nz][nx] === '.') {
      reach[nz][nx] = true
      stack.push([nx, nz])
    }
  }
}
for (const [id, x, z] of [...objects.map((o) => [o.id, o.x, o.z]), ...exits.map((e) => [e.id, e.x, e.z]), ['lumbright arrival', 40, 82]]) {
  if (!reach[z][x]) errs.push(`${id} (${x},${z}) is unreachable from spawn`)
}
if (errs.length) { console.error('VARRICK GEN ERRORS:\n' + errs.join('\n')); process.exit(1) }

const walk = zone.collision.join('').split('').filter((c) => c === '.').length
console.log(`varrick: ${walk}/${W * H} walkable (${((walk / (W * H)) * 100).toFixed(1)}%), ${props.length} props, ${objects.length} objects`)
fs.writeFileSync(OUT, JSON.stringify(zone, null, 1) + '\n')
console.log(`wrote ${OUT}`)
