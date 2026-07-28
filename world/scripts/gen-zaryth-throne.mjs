#!/usr/bin/env node
// Deterministic generator for world/zones/zaryth_throne.json — the Empty
// Throne, Zaryth's instanced lair. A 40×40 sealed vault: a processional
// causeway from the south door, the cairns of the four generals whose deaths
// unlock the fight set into the side walls, and the throne itself on the north
// dais — empty, with Zaryth standing before it rather than on it.
//
// Instanced (world/shared/instances.ts): every party gets its own copy, so the
// room is sized for one group of up to 8 rather than a whole server.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const W = 40
const H = 40
const worldDir = fileURLToPath(new URL('..', import.meta.url))
const OUT = path.join(worldDir, 'zones', 'zaryth_throne.json')

let seed = 0x5a72f1
function rand() {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 0xffffffff
}

const grid = Array.from({ length: H }, () => new Array(W).fill('.'))
const props = []
const block = (x, z) => { if (x >= 0 && x < W && z >= 0 && z < H) grid[z][x] = '#' }
const clear = (x, z) => { grid[z][x] = '.' }

// Prop footprint collision (mirrors gen-grondar-lair): a solid prop blocks the
// tiles its mesh actually covers, so nothing is walk-through.
const NATIVE_HALF = { column: 0.2, boulder: 0.51, lantern: 0.11, torch: 0.11, dungeon_door: 2.0, crypt: 1.2, altar: 0.52, banner: 0.4, obelisk: 0.35, stone_spire: 0.5, stone_slab: 0.5, castle: 0.9, town_wall: 0.5, skull: 0.3, bones: 0.3 }
const BASE = { column: 2.0, boulder: 1.3, dungeon_door: 0.8, crypt: 2.2, altar: 1.6, banner: 2.0, obelisk: 2.0, stone_spire: 2.0, castle: 3.0 }
const RADIUS_OVERRIDE = { banner: 0, skull: 0, bones: 0, stone_slab: 0, torch: 0 }
const blockFootprint = ({ model, x, z, scale }) => {
  const r = model in RADIUS_OVERRIDE
    ? RADIUS_OVERRIDE[model]
    : Math.max(0, Math.round((NATIVE_HALF[model] ?? 0.5) * (BASE[model] ?? 1) * (scale ?? 1) - 0.5))
  const cx = Math.round(x), cz = Math.round(z)
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) block(cx + dx, cz + dz)
}

// ── Vault walls: a 2-tile-thick stone border, door carved south ──
const B = 2
for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
  if (x < B || x >= W - B || z < B || z >= H - B) block(x, z)
}
const ENTRY_X = [19, 20, 21]
// The doorway runs one tile deeper than the wall so the door prop's footprint
// can't seal the threshold it stands in.
const carveEntry = () => { for (const x of ENTRY_X) for (let z = H - B - 1; z < H; z++) clear(x, z) }
carveEntry()

// Masonry runs lining the inner ring, so the border reads as a built vault
// rather than as the map ending. The south run leaves the door gap.
const IN = B - 1
for (let x = IN; x <= W - 1 - IN; x++) {
  props.push({ model: 'town_wall', x, z: IN, rot: Math.PI / 2, scale: 1.3 })
  if (!ENTRY_X.includes(x)) props.push({ model: 'town_wall', x, z: H - 1 - IN, rot: Math.PI / 2, scale: 1.3 })
}
for (let z = IN + 1; z < H - 1 - IN; z++) {
  props.push({ model: 'town_wall', x: IN, z, scale: 1.3 })
  props.push({ model: 'town_wall', x: W - 1 - IN, z, scale: 1.3 })
}

// ── Landmark: the empty throne, seen the moment the door opens ──
// A ruined vault front rising out of the north wall, the throne-altar on the
// dais below it, and two spires twice the height of the causeway's columns
// framing the pair. Scale hierarchy: vault > spires > columns > cairns > bones.
props.push({ model: 'castle', x: 20, z: 3, scale: 1.15 })
props.push({ model: 'altar', x: 20, z: 7, scale: 2.4 })
for (const [x, z] of [[15, 6], [25, 6]]) props.push({ model: 'stone_spire', x, z, scale: 2.8 })
for (const [x, z] of [[17, 5], [23, 5]]) props.push({ model: 'banner', x, z, scale: 3 })
for (const [x, z] of [[17, 10], [23, 10]]) props.push({ model: 'torch', x, z })

// ── The causeway: columns flanking the aisle, torches lighting it ──
for (let z = 34; z >= 14; z -= 4) {
  for (const x of [14, 26]) props.push({ model: 'column', x, z, scale: 1.8 })
}
for (const z of [36, 30, 24, 18, 12]) {
  for (const x of [16, 24]) props.push({ model: 'torch', x, z })
}

// ── The four generals' cairns, set into the side walls facing the causeway ──
// One obelisk per boss whose kill unlocks this room, so the wall the party
// walks past is the record of what it took to get in.
const CAIRNS = [
  { x: 7, z: 12 }, { x: 32, z: 12 },
  { x: 7, z: 26 }, { x: 32, z: 26 },
]
for (const { x, z } of CAIRNS) {
  props.push({ model: 'obelisk', x, z, scale: 1.4 })
  props.push({ model: 'banner', x, z: z + 2, scale: 2.2 })
  props.push({ model: 'skull', x: x + (x < 20 ? 1 : -1), z: z + 3, scale: 0.9, rot: rand() * Math.PI * 2 })
}

// ── The door itself, framing the only way out ──
props.push({ model: 'dungeon_door', x: 20, z: 38, scale: 0.8 })

// ── Bone drifts against the side walls, kept off the causeway and the dais ──
const reserved = new Set(props.map((p) => `${Math.round(p.x)},${Math.round(p.z)}`))
let placed = 0
let guard = 0
while (placed < 16 && guard < 4000) {
  guard += 1
  const x = B + 2 + Math.floor(rand() * (W - 2 * B - 4))
  const z = B + 6 + Math.floor(rand() * (H - 2 * B - 10))
  const onDais = z <= 13 && x >= 11 && x <= 29
  const onCauseway = x >= 16 && x <= 24
  if (onDais || onCauseway || grid[z][x] !== '.' || reserved.has(`${x},${z}`)) continue
  reserved.add(`${x},${z}`)
  props.push({ model: 'bones', x, z, scale: 0.8 + rand() * 0.4, rot: rand() * Math.PI * 2 })
  placed += 1
}

// Zaryth stands BEFORE the throne, not on it — the seat stays empty, which is
// the whole read of the room.
const npcs = [
  { id: 'zaryth', monsterId: 'zaryth_the_empty_lord', x: 20, z: 11, wander: { x: 14, z: 8, w: 13, h: 7 } },
]

// The vault has no walk-in entrance: players arrive by instance handoff and the
// door is the way back out. No marker — the door prop is the signpost.
const exits = [
  { id: 'exit_wilds', x: 20, z: 39, toZone: 'overworld', toX: 280, toZ: 56, label: 'The Wilds', hideMarker: true },
]

// A bank chest inside the door, within reach of the tile you land (and respawn)
// on: an instance is a closed room, so restocking has to happen in it.
const SPAWN = { x: 20, z: 36 }
const objects = [{ id: 'chest_1', type: 'bank_chest', x: SPAWN.x + 1, z: SPAWN.z }]

// ── Collision post-pass, then reopen everything that must stay walkable ──
for (const p of props) blockFootprint(p)
carveEntry()
clear(SPAWN.x, SPAWN.z)
for (const o of objects) clear(o.x, o.z)
for (const n of npcs) clear(n.x, n.z)
for (const e of exits) clear(e.x, e.z)

const zone = {
  id: 'zaryth_throne',
  name: 'The Empty Throne',
  width: W,
  height: H,
  spawn: SPAWN,
  collision: grid.map((row) => row.join('')),
  objects,
  npcs,
  exits,
  props,
  palette: { walkableA: '#4c4358', walkableB: '#443b4f', blockedA: '#372e42', blockedB: '#2e2637' },
  ambience: { sky: '#160d24', hemiIntensity: 0.45, sunIntensity: 0.55 },
  terrain: {
    relief: 0.12,
    procedural: { seed: 4409, frequency: 0.08 },
    material: 'volcanic',
    scatter: [{ model: 'stone_slab', density: 1.0, scaleRange: [0.4, 0.8] }],
  },
  ground: [
    { kind: 'floor_stone', x: 11, z: 4, w: 19, h: 10 },
    { kind: 'path_dirt', x: 17, z: 13, w: 7, h: 26 },
  ],
}

fs.writeFileSync(OUT, JSON.stringify(zone, null, 1) + '\n')
console.log(`gen-zaryth-throne: wrote ${path.relative(worldDir, OUT)} (${W}×${H}, ${props.length} props)`)
