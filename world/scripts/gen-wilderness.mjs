#!/usr/bin/env node
// Deterministic generator for world/zones/wilderness.json — the Wilderness, the
// one zone in the world where players may attack each other.
//
// The whole map is one argument, read in a single glance from the spawn tile:
//   SOUTH  a walled border camp. Bank chest, braziers, tents. Nothing can
//          touch you here.
//   THE LINE  a fortified wall running the full width at z = PVP_LINE_Z, with
//          three gates. It is the only way north, and the server stops you in
//          front of it until you say yes.
//   NORTH  the wastes. Ash ground, dead pines, ruined watchtowers, the
//          bone-fields where the Zesta dead are left.
//
// The line's z lives in world/shared/pvpArea.ts and is imported here rather
// than duplicated: the wall the player sees and the rule the server enforces
// have to be the same row.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PVP_LINE_Z = 45

const W = 64
const H = 64
const worldDir = fileURLToPath(new URL('..', import.meta.url))
const OUT = path.join(worldDir, 'zones', 'wilderness.json')

let seed = 0x7d1cbe
function rand() {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 0xffffffff
}

const grid = Array.from({ length: H }, () => new Array(W).fill('.'))
const props = []
const block = (x, z) => { if (x >= 0 && x < W && z >= 0 && z < H) grid[z][x] = '#' }
const clear = (x, z) => { if (x >= 0 && x < W && z >= 0 && z < H) grid[z][x] = '.' }

// Prop footprint collision (mirrors gen-zaryth-throne): a solid prop blocks the
// tiles its mesh actually covers, so nothing is walk-through.
const NATIVE_HALF = { column: 0.2, boulder: 0.51, lantern: 0.11, torch: 0.11, crypt: 1.2, altar: 0.52, banner: 0.4, obelisk: 0.35, stone_spire: 0.5, stone_spire_ember: 0.5, stone_slab: 0.5, town_wall: 0.5, town_tower: 0.8, watchtower: 0.9, fence: 0.5, fence_gate: 0.5, skull: 0.3, bones: 0.3, pine_a: 0.4, pine_b: 0.4, bush: 0.3, hay_stack: 0.5, cart: 0.6, well: 0.5, stall: 0.7, castle: 0.9 }
const BASE = { column: 2.0, boulder: 1.3, crypt: 2.2, altar: 1.6, banner: 2.0, obelisk: 2.0, stone_spire: 2.0, stone_spire_ember: 2.0, town_wall: 1.0, town_tower: 1.0, watchtower: 1.0, fence: 1.0, fence_gate: 1.0, pine_a: 1.6, pine_b: 1.6, castle: 3.0 }
const RADIUS_OVERRIDE = { banner: 0, skull: 0, bones: 0, stone_slab: 0, torch: 0, lantern: 0, bush: 0, fence_gate: 0 }
const blockFootprint = ({ model, x, z, scale }) => {
  const r = model in RADIUS_OVERRIDE
    ? RADIUS_OVERRIDE[model]
    : Math.max(0, Math.round((NATIVE_HALF[model] ?? 0.5) * (BASE[model] ?? 1) * (scale ?? 1) - 0.5))
  const cx = Math.round(x), cz = Math.round(z)
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) block(cx + dx, cz + dz)
}

// ── Zone border: cliffs all the way round, so the map reads as world edge ──
const B = 2
for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
  if (x < B || x >= W - B || z < B || z >= H - B) block(x, z)
}
for (let x = B; x < W - B; x += 2) {
  props.push({ model: 'boulder', x, z: B - 1, scale: 1.1 + rand() * 0.5, rot: rand() * Math.PI * 2 })
  props.push({ model: 'boulder', x, z: H - B, scale: 1.1 + rand() * 0.5, rot: rand() * Math.PI * 2 })
}
for (let z = B; z < H - B; z += 2) {
  props.push({ model: 'boulder', x: B - 1, z, scale: 1.1 + rand() * 0.5, rot: rand() * Math.PI * 2 })
  props.push({ model: 'boulder', x: W - B, z, scale: 1.1 + rand() * 0.5, rot: rand() * Math.PI * 2 })
}

// ── THE LINE: the wall across the whole map, and the three gates through it ──
// The gates are the composition's hinge: everything in the camp points at them
// and everything in the wastes is seen through them.
const GATES = [16, 32, 48]
for (let x = B; x < W - B; x++) {
  if (GATES.includes(x) || GATES.includes(x - 1) || GATES.includes(x + 1)) continue
  block(x, PVP_LINE_Z)
  props.push({ model: 'town_wall', x, z: PVP_LINE_Z, rot: Math.PI / 2, scale: 1.4 })
}
for (const x of GATES) {
  props.push({ model: 'fence_gate', x, z: PVP_LINE_Z, rot: Math.PI / 2, scale: 1.4 })
  props.push({ model: 'torch', x: x - 2, z: PVP_LINE_Z })
  props.push({ model: 'torch', x: x + 2, z: PVP_LINE_Z })
  props.push({ model: 'banner', x: x - 2, z: PVP_LINE_Z + 1, scale: 2.4 })
  props.push({ model: 'banner', x: x + 2, z: PVP_LINE_Z + 1, scale: 2.4 })
}
// Watchtowers over the two outer gates — the landmark you see from spawn, and
// the tallest thing on the safe side.
props.push({ model: 'town_tower', x: 13, z: PVP_LINE_Z + 2, scale: 2.6 })
props.push({ model: 'town_tower', x: 51, z: PVP_LINE_Z + 2, scale: 2.6 })
props.push({ model: 'watchtower', x: 32, z: PVP_LINE_Z + 3, scale: 2.0 })

// ── SOUTH: the border camp ──
const SPAWN = { x: 32, z: 57 }
const objects = [
  { id: 'chest_1', type: 'bank_chest', x: 31, z: 57 },
  { id: 'chest_2', type: 'bank_chest', x: 33, z: 57 },
]
// A muster yard around the chests, the road north out of it to the middle gate.
props.push({ model: 'well', x: 32, z: 54 })
for (const [x, z] of [[28, 58], [36, 58], [28, 52], [36, 52]]) {
  props.push({ model: 'lantern', x, z, scale: 1.4 })
}
for (const [x, z] of [[26, 56], [38, 56], [25, 59], [39, 59]]) {
  props.push({ model: 'stall', x, z, rot: rand() * Math.PI * 2 })
}
for (const [x, z] of [[24, 54], [40, 54]]) props.push({ model: 'cart', x, z, rot: rand() * Math.PI })
for (const [x, z] of [[22, 57], [42, 57], [23, 51], [41, 51]]) {
  props.push({ model: 'hay_stack', x, z, scale: 0.9 })
}
// Quarters flanking the muster yard, so the camp reads as garrisoned.
for (const [x, z] of [[20, 54], [44, 54], [20, 60], [44, 60]]) {
  props.push({ model: 'house', x, z, scale: 1.1, rot: x < 32 ? Math.PI / 2 : -Math.PI / 2 })
}
for (const [x, z] of [[26, 51], [38, 51], [17, 57], [47, 57]]) {
  props.push({ model: 'torch', x, z })
}
// A palisade closing the camp's flanks in to the line, so the only way north is
// through a gate rather than around the end of the wall.
for (let z = 47; z <= 59; z += 2) {
  props.push({ model: 'fence', x: 14, z, scale: 1.3 })
  props.push({ model: 'fence', x: 50, z, scale: 1.3 })
}
// Fences framing the road so the walk to the gate is a corridor, not a field.
for (let z = 47; z <= 53; z += 2) {
  props.push({ model: 'fence', x: 29, z, rot: Math.PI / 2, scale: 1.2 })
  props.push({ model: 'fence', x: 35, z, rot: Math.PI / 2, scale: 1.2 })
}
// Camp treeline against the south border, so the safe half is visually enclosed.
for (let i = 0; i < 26; i++) {
  const x = B + 1 + Math.floor(rand() * (W - 2 * B - 2))
  const z = 59 + Math.floor(rand() * 2)
  if (Math.abs(x - SPAWN.x) < 6) continue
  props.push({ model: rand() < 0.5 ? 'pine_a' : 'pine_b', x, z, scale: 0.9 + rand() * 0.4, rot: rand() * Math.PI * 2 })
}

// ── NORTH: the wastes ──
// Landmark for the dangerous half: a ruined keep on the north ridge, visible
// through all three gates and the thing every fight happens under.
props.push({ model: 'castle', x: 32, z: 7, scale: 1.3 })
for (const [x, z] of [[26, 9], [38, 9]]) props.push({ model: 'stone_spire_ember', x, z, scale: 2.6 })
for (const [x, z] of [[29, 12], [35, 12]]) props.push({ model: 'obelisk', x, z, scale: 1.5 })

// Three ruined watchtowers, one on the approach from each gate: the wastes are
// read as a place that was held once, and they break the sightlines up.
for (const [x, z] of [[15, 30], [33, 24], [49, 32]]) {
  props.push({ model: 'watchtower', x, z, scale: 2.2 })
  props.push({ model: 'torch', x: x + 2, z: z + 1 })
  props.push({ model: 'bones', x: x + 3, z: z + 3, scale: 1.0, rot: rand() * Math.PI * 2 })
  props.push({ model: 'boulder', x: x - 3, z: z + 2, scale: 1.3, rot: rand() * Math.PI * 2 })
}

// Dead groves — clustered, with deliberate clearings between them, so a fight
// has cover to break line of sight behind (world-design: clustered density).
const GROVES = [
  [9, 12], [22, 36], [46, 15], [55, 38], [11, 39], [40, 33],
  [17, 22], [30, 41], [52, 24], [7, 27], [36, 8], [24, 6],
]
for (const [gx, gz] of GROVES) {
  const n = 12 + Math.floor(rand() * 8)
  for (let i = 0; i < n; i++) {
    const x = gx + Math.floor(rand() * 9) - 4
    const z = gz + Math.floor(rand() * 9) - 4
    if (x < B + 1 || x >= W - B - 1 || z < B + 1 || z >= PVP_LINE_Z - 1) continue
    props.push({ model: rand() < 0.5 ? 'pine_a' : 'pine_b', x, z, scale: 1.0 + rand() * 0.7, rot: rand() * Math.PI * 2 })
  }
}

// Boulder fields and standing spires between the groves: the wastes need
// something at mid-scale, or the eye jumps straight from the trees to the keep
// and the ground in between reads as unfinished.
const RUBBLE = [
  [14, 17], [27, 14], [42, 26], [19, 30], [50, 8], [33, 30],
  [8, 34], [58, 30], [45, 40], [25, 20], [37, 18], [12, 6],
]
for (const [rx, rz] of RUBBLE) {
  const n = 3 + Math.floor(rand() * 4)
  for (let i = 0; i < n; i++) {
    const x = rx + Math.floor(rand() * 6) - 3
    const z = rz + Math.floor(rand() * 6) - 3
    if (x < B + 1 || x >= W - B - 1 || z < B + 1 || z >= PVP_LINE_Z - 1) continue
    props.push({ model: 'boulder', x, z, scale: 0.9 + rand() * 0.8, rot: rand() * Math.PI * 2 })
  }
  if (rand() < 0.5) props.push({ model: 'stone_spire_ember', x: rx, z: rz, scale: 1.4 + rand() * 0.8 })
}

// Bone fields: where the Zesta dead are left. Scattered wide, kept off the
// gate approaches so the way north stays legible.
const reserved = new Set(props.map((p) => `${Math.round(p.x)},${Math.round(p.z)}`))
let placed = 0
let guard = 0
while (placed < 90 && guard < 20000) {
  guard += 1
  const x = B + 2 + Math.floor(rand() * (W - 2 * B - 4))
  const z = B + 2 + Math.floor(rand() * (PVP_LINE_Z - B - 4))
  const onGateRoad = GATES.some((g) => Math.abs(x - g) <= 2) && z > PVP_LINE_Z - 10
  if (onGateRoad || grid[z][x] !== '.' || reserved.has(`${x},${z}`)) continue
  reserved.add(`${x},${z}`)
  props.push({ model: rand() < 0.6 ? 'bones' : 'skull', x, z, scale: 0.7 + rand() * 0.4, rot: rand() * Math.PI * 2 })
  placed += 1
}

// The Wilderness has no monsters: everything that can hurt you here is another
// player (or a bot pretending to be one, spawned at runtime by the DO).
const npcs = []

// No exits. The Wilderness is entered from the idle game and left by logging
// out — a walk-in door would let a player who never consented wander into a
// PvP zone from the overworld.
const exits = []

// ── Collision post-pass, then reopen everything that must stay walkable ──
for (const p of props) blockFootprint(p)
// The gates and their tiles are carved back out AFTER the footprint pass: a
// gate that its own prop sealed is a wall with extra steps.
for (const x of GATES) for (const dx of [-1, 0, 1]) {
  clear(x + dx, PVP_LINE_Z)
  clear(x + dx, PVP_LINE_Z - 1)
  clear(x + dx, PVP_LINE_Z + 1)
}
clear(SPAWN.x, SPAWN.z)
for (const o of objects) clear(o.x, o.z)

// Flood fill from spawn: every gate, chest and the far ridge must be reachable,
// or a prop footprint has quietly walled the map in half.
const seen = Array.from({ length: H }, () => new Array(W).fill(false))
const queue = [[SPAWN.x, SPAWN.z]]
seen[SPAWN.z][SPAWN.x] = true
while (queue.length > 0) {
  const [x, z] = queue.pop()
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, nz = z + dz
    if (nx < 0 || nx >= W || nz < 0 || nz >= H || seen[nz][nx] || grid[nz][nx] !== '.') continue
    seen[nz][nx] = true
    queue.push([nx, nz])
  }
}
const unreachable = []
for (const o of objects) if (!seen[o.z][o.x]) unreachable.push(`object ${o.id}`)
for (const x of GATES) if (!seen[PVP_LINE_Z - 1][x]) unreachable.push(`north of gate x=${x}`)
for (const [x, z] of [[32, 14], [6, 6], [57, 6], [6, 40], [57, 40]]) {
  if (!seen[z][x]) unreachable.push(`waste tile (${x},${z})`)
}
if (unreachable.length > 0) {
  console.error(`gen-wilderness: unreachable from spawn — ${unreachable.join(', ')}`)
  process.exit(1)
}

const zone = {
  id: 'wilderness',
  name: 'The Wilderness',
  width: W,
  height: H,
  spawn: SPAWN,
  collision: grid.map((row) => row.join('')),
  objects,
  npcs,
  props,
  palette: { walkableA: '#8a7657', walkableB: '#7d6a4d', blockedA: '#63533f', blockedB: '#564734' },
  ambience: { sky: '#6b4a34', hemiIntensity: 1.0, sunIntensity: 1.25 },
  terrain: {
    relief: 0.55,
    procedural: { seed: 7714, frequency: 0.05 },
    material: 'highland',
    scatter: [
      { model: 'stone_slab', density: 2.2, scaleRange: [0.4, 1.1] },
      { model: 'bush', density: 1.8, scaleRange: [0.5, 1.0] },
      { model: 'mushrooms', density: 0.8, scaleRange: [0.6, 1.0] },
    ],
  },
  ground: [
    // The wastes: ash from the line to the north border.
    { kind: 'ash', x: B, z: B, w: W - 2 * B, h: PVP_LINE_Z - B },
    // The camp road, and the three gate approaches feeding it.
    { kind: 'path_dirt', x: 30, z: PVP_LINE_Z, w: 5, h: 13 },
    ...GATES.map((x) => ({ kind: 'path_dirt', x: x - 1, z: PVP_LINE_Z - 4, w: 3, h: 9 })),
    { kind: 'plaza', x: 27, z: 52, w: 11, h: 8 },
  ],
  aoiRadius: 24,
}

fs.writeFileSync(OUT, JSON.stringify(zone, null, 1) + '\n')
console.log(`gen-wilderness: wrote ${path.relative(worldDir, OUT)} (${W}×${H}, ${props.length} props)`)
