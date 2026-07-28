#!/usr/bin/env node
// Deterministic generator for world/zones/grondar_lair.json — Warlord Grondar's
// instanced lair. A 40×40 sealed barrow: a lantern-lit approach from the south
// door, crypts of his fallen warband in the corners, and Grondar himself on the
// altar dais at the north end.
//
// Instanced (world/shared/instances.ts): every party gets its own copy, so the
// room is sized for one group of up to 8 rather than a whole server.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const W = 40
const H = 40
const worldDir = fileURLToPath(new URL('..', import.meta.url))
const OUT = path.join(worldDir, 'zones', 'grondar_lair.json')

let seed = 0x9e3779
function rand() {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 0xffffffff
}

const grid = Array.from({ length: H }, () => new Array(W).fill('.'))
const props = []
const block = (x, z) => { if (x >= 0 && x < W && z >= 0 && z < H) grid[z][x] = '#' }
const clear = (x, z) => { grid[z][x] = '.' }

// Prop footprint collision (mirrors gen-varrick-dungeon): a solid prop blocks
// the tiles its mesh actually covers, so nothing is walk-through.
const NATIVE_HALF = { column: 0.2, boulder: 0.51, lantern: 0.11, dungeon_door: 2.0, town_tower: 0.5, crypt: 1.2, altar: 0.52, banner: 0.4, mushrooms: 0.3, castle: 0.9 }
const BASE = { column: 2.0, boulder: 1.3, dungeon_door: 0.8, crypt: 2.2, altar: 1.6, banner: 2.0, castle: 3.0 }
const RADIUS_OVERRIDE = { banner: 0, mushrooms: 0 }
const blockFootprint = ({ model, x, z, scale }) => {
  const r = model in RADIUS_OVERRIDE
    ? RADIUS_OVERRIDE[model]
    : Math.max(0, Math.round((NATIVE_HALF[model] ?? 0.5) * (BASE[model] ?? 1) * (scale ?? 1) - 0.5))
  const cx = Math.round(x), cz = Math.round(z)
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) block(cx + dx, cz + dz)
}

// ── Barrow walls: a 2-tile-thick stone border, door carved south ──
const B = 2
for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
  if (x < B || x >= W - B || z < B || z >= H - B) block(x, z)
}
const ENTRY_X = [19, 20, 21]
// The doorway runs one tile deeper than the wall so the door prop's footprint
// can't seal the threshold it stands in.
const carveEntry = () => { for (const x of ENTRY_X) for (let z = H - B - 1; z < H; z++) clear(x, z) }
carveEntry()

// Stone wall runs lining the inner ring, so the border reads as built masonry
// rather than as the map simply ending. The south run leaves the door gap.
const IN = B - 1
for (let x = IN; x <= W - 1 - IN; x++) {
  props.push({ model: 'town_wall', x, z: IN, rot: Math.PI / 2, scale: 1.3 })
  if (!ENTRY_X.includes(x)) props.push({ model: 'town_wall', x, z: H - 1 - IN, rot: Math.PI / 2, scale: 1.3 })
}
for (let z = IN + 1; z < H - 1 - IN; z++) {
  props.push({ model: 'town_wall', x: IN, z, scale: 1.3 })
  props.push({ model: 'town_wall', x: W - 1 - IN, z, scale: 1.3 })
}

// ── Landmark: Grondar's throne, seen the moment you enter ──
// A ruined keep front rising out of the north wall (~5×8 tiles), his altar on
// the dais below it, and two pillars twice the height of the aisle's framing
// the pair. Scale hierarchy runs keep > dais pillars > aisle columns > rubble.
props.push({ model: 'castle', x: 20, z: 3, scale: 1.1 })
props.push({ model: 'altar', x: 20, z: 7, scale: 2.2 })
for (const [x, z] of [[14, 6], [26, 6]]) props.push({ model: 'column', x, z, scale: 2.2 })
for (const [x, z] of [[16, 5], [24, 5]]) props.push({ model: 'banner', x, z, scale: 3 })
for (const [x, z] of [[17, 10], [23, 10]]) props.push({ model: 'lantern', x, z })

// ── The approach: columns flanking the aisle, braziers lighting it ──
for (let z = 34; z >= 14; z -= 4) {
  for (const x of [14, 26]) props.push({ model: 'column', x, z, scale: 1.8 })
}
for (const z of [36, 30, 24, 18, 12]) {
  for (const x of [16, 24]) props.push({ model: 'lantern', x, z })
}

// ── Warband crypts in the four corners, mushrooms creeping out of them ──
// Kept small: they dress the corners, they don't compete with the throne.
for (const [x, z] of [[6, 6], [33, 6], [6, 33], [33, 33]]) {
  props.push({ model: 'crypt', x, z, scale: 0.5, rot: rand() * Math.PI * 2 })
}
for (const [x, z] of [[9, 9], [30, 9], [9, 30], [30, 30], [8, 20], [31, 20]]) {
  props.push({ model: 'mushrooms', x, z, scale: 0.9 + rand() * 0.4, rot: rand() * Math.PI * 2 })
}

// ── The door itself, framing the only way out ──
props.push({ model: 'dungeon_door', x: 20, z: 38, scale: 0.8 })

// ── Rubble, kept off the aisle and the dais ──
const reserved = new Set(props.map((p) => `${Math.round(p.x)},${Math.round(p.z)}`))
let placed = 0
let guard = 0
while (placed < 12 && guard < 4000) {
  guard += 1
  const x = B + 2 + Math.floor(rand() * (W - 2 * B - 4))
  const z = B + 4 + Math.floor(rand() * (H - 2 * B - 8))
  const onDais = z <= 14 && x >= 11 && x <= 29
  const onAisle = x >= 17 && x <= 23
  if (onDais || onAisle || grid[z][x] !== '.' || reserved.has(`${x},${z}`)) continue
  reserved.add(`${x},${z}`)
  props.push({ model: 'boulder', x, z, scale: 0.8 + rand() * 0.5, rot: rand() * Math.PI * 2 })
  placed += 1
}

const npcs = [
  { id: 'grondar', monsterId: 'warlord_grondar', x: 20, z: 11, wander: { x: 14, z: 8, w: 13, h: 7 } },
]

// The lair has no walk-in entrance: players arrive by instance handoff and the
// door is the way back out. Dying does the same trip the hard way. No marker —
// the door prop is the signpost; a glowing pad on a barrow floor is not.
const exits = [
  { id: 'exit_wilds', x: 20, z: 39, toZone: 'overworld', toX: 280, toZ: 56, label: 'The Wilds', hideMarker: true },
]

// ── Collision post-pass, then reopen everything that must stay walkable ──
for (const p of props) blockFootprint(p)
carveEntry()
const SPAWN = { x: 20, z: 36 }
clear(SPAWN.x, SPAWN.z)
for (const n of npcs) clear(n.x, n.z)
for (const e of exits) clear(e.x, e.z)

const zone = {
  id: 'grondar_lair',
  name: "Grondar's Lair",
  width: W,
  height: H,
  spawn: SPAWN,
  collision: grid.map((row) => row.join('')),
  objects: [],
  npcs,
  exits,
  deathRespawn: { zone: 'overworld', x: 280, z: 56 },
  props,
  palette: { walkableA: '#3a352e', walkableB: '#332e28', blockedA: '#272320', blockedB: '#1e1b18' },
  ambience: { sky: '#0a0d12', hemiIntensity: 0.3, sunIntensity: 0.45 },
  terrain: {
    relief: 0.14,
    procedural: { seed: 8127, frequency: 0.09 },
    material: 'volcanic',
    scatter: [{ model: 'mushrooms', density: 1.4, scaleRange: [0.5, 0.9] }],
  },
  ground: [
    { kind: 'floor_stone', x: 11, z: 4, w: 19, h: 10 },
    { kind: 'path_dirt', x: 17, z: 13, w: 7, h: 26 },
  ],
}

fs.writeFileSync(OUT, JSON.stringify(zone, null, 1) + '\n')
console.log(`gen-grondar-lair: wrote ${path.relative(worldDir, OUT)} (${W}×${H}, ${props.length} props)`)
