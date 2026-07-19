#!/usr/bin/env node
// M1 merge prototype (docs/single-world-map-investigation.md) — fuses pasture +
// lumbright + forest into ONE contiguous zone, `zones/overworld.json`, to test
// the one-map thesis: does the existing renderer + a single DO handle a merged
// map with several places on it, portals between them replaced by walkable
// wilderness? Additive — the standalone zones still exist; this is a parallel
// prototype. Re-run to regenerate; hand-edit the constants below, not the JSON.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const worldDir = fileURLToPath(new URL('..', import.meta.url))
const load = (id) => JSON.parse(fs.readFileSync(path.join(worldDir, 'zones', `${id}.json`), 'utf8'))
const OUT = path.join(worldDir, 'zones', 'overworld.json')

// West→east strip, each place vertically centred on the band; the gaps between
// are open wilderness you walk across (no portals). Offsets in merged tiles.
const PARTS = [
  { id: 'lumbright', prefix: 'lb', ox: 0, oz: 0 },
  { id: 'pasture', prefix: 'pa', ox: 88, oz: 16 },
  { id: 'forest', prefix: 'fo', ox: 144, oz: 8 },
]
const W = 192
const H = 64
const SPAWN = { x: 32, z: 32 } // lumbright's spawn (offset 0,0)

const zones = Object.fromEntries(PARTS.map((p) => [p.id, load(p.id)]))

// Collision: open walkable wilderness by default; stamp each place's grid at its
// offset so town walls / gate gaps survive and only the gates breach the walls.
const grid = Array.from({ length: H }, () => new Array(W).fill('.'))
for (const p of PARTS) {
  const z = zones[p.id]
  for (let lz = 0; lz < z.height; lz++) {
    for (let lx = 0; lx < z.width; lx++) {
      const gx = p.ox + lx
      const gz = p.oz + lz
      if (gx < W && gz < H) grid[gz][gx] = z.collision[lz][lx]
    }
  }
}

const objects = []
const npcs = []
const props = []
const ground = []
const critters = []
const smoke = []

for (const p of PARTS) {
  const z = zones[p.id]
  for (const o of z.objects ?? []) objects.push({ ...o, id: `${p.prefix}_${o.id}`, x: o.x + p.ox, z: o.z + p.oz })
  for (const n of z.npcs ?? []) {
    const nn = { ...n, id: `${p.prefix}_${n.id}`, x: n.x + p.ox, z: n.z + p.oz }
    if (n.wander) nn.wander = { ...n.wander, x: n.wander.x + p.ox, z: n.wander.z + p.oz }
    npcs.push(nn)
  }
  for (const pr of z.props ?? []) props.push({ ...pr, x: pr.x + p.ox, z: pr.z + p.oz })
  for (const g of z.ground ?? []) ground.push({ ...g, x: g.x + p.ox, z: g.z + p.oz })
  for (const c of z.ambient?.critters ?? []) critters.push({ ...c, x: c.x + p.ox, z: c.z + p.oz })
  for (const s of z.ambient?.smoke ?? []) smoke.push({ ...s, x: s.x + p.ox, z: s.z + p.oz })
}

// Wilderness roads linking the former gate gaps across the open country, so the
// merged map reads as connected rather than three islands on one canvas.
ground.push({ kind: 'path_dirt', x: 64, z: 24, w: 24, h: 8 }) // lumbright gate → pasture
ground.push({ kind: 'path_dirt', x: 119, z: 24, w: 26, h: 5 }) // pasture → forest approach
ground.push({ kind: 'path_dirt', x: 140, z: 28, w: 5, h: 21 }) // …down to forest's west trail

// Only the external edge survives as a portal: lumbright → Varrick (interiors
// stay instanced, the hybrid escape hatch). Internal portals are gone — you walk.
const exits = [{ id: 'exit_varrick', x: 0, z: 32, toZone: 'varrick', toX: 40, toZ: 82, label: 'Varrick' }]

const zone = {
  id: 'overworld',
  name: 'Eldermoor Overworld',
  width: W,
  height: H,
  spawn: SPAWN,
  collision: grid.map((row) => row.join('')),
  objects,
  npcs,
  exits,
  props,
  ground,
  ambient: { critters, smoke },
  // AOI: with a merged map holding every place's entities, a player only needs
  // diffs for entities near them. Gated per-zone so standalone zones are
  // untouched (see WorldZone.broadcastDiffs).
  aoiRadius: 40,
  palette: { walkableA: '#8a9a55', walkableB: '#7e8e4c', blockedA: '#9a9186', blockedB: '#89806f' },
  terrain: {
    relief: 0.6,
    procedural: { seed: 7000, frequency: 0.05 },
    material: 'meadow',
    scatter: [
      { model: 'flowers', density: 1, scaleRange: [0.8, 1.1] },
      { model: 'bush', density: 0.8, scaleRange: [0.7, 1] },
    ],
  },
}

// Fail fast: dims, spawn, unique ids, exits/objects/npcs walkable, in-bounds.
const errs = []
if (zone.collision.length !== H) errs.push(`collision has ${zone.collision.length} rows, expected ${H}`)
const walkable = (x, z) => grid[z] && grid[z][x] === '.'
if (!walkable(SPAWN.x, SPAWN.z)) errs.push(`spawn (${SPAWN.x},${SPAWN.z}) blocked`)
const seen = new Set()
for (const it of [...objects, ...npcs, ...exits]) {
  if (seen.has(it.id)) errs.push(`duplicate id ${it.id}`)
  seen.add(it.id)
  if (!walkable(it.x, it.z)) errs.push(`${it.id} (${it.x},${it.z}) not walkable`)
}
for (const r of ground) if (r.x < 0 || r.z < 0 || r.x + r.w > W || r.z + r.h > H) errs.push(`ground ${r.kind} (${r.x},${r.z}) out of bounds`)
// Connectivity: every object, npc spawn and exit reachable on foot from spawn.
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
for (const it of [...objects, ...npcs, ...exits]) if (!reach[it.z][it.x]) errs.push(`${it.id} (${it.x},${it.z}) unreachable from spawn`)
if (errs.length) { console.error('OVERWORLD GEN ERRORS:\n' + errs.join('\n')); process.exit(1) }

const walk = zone.collision.join('').split('').filter((c) => c === '.').length
console.log(`overworld: ${W}x${H}, ${walk}/${W * H} walkable, ${props.length} props, ${objects.length} objects, ${npcs.length} npcs`)
fs.writeFileSync(OUT, JSON.stringify(zone, null, 1) + '\n')
console.log(`wrote ${OUT}`)
