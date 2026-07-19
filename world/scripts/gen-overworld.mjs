#!/usr/bin/env node
// M3 overworld layout (docs/single-world-map-investigation.md). Builds ONE map,
// zones/overworld.json, holding all 14 canonical places from src/data/world.json
// at their real map-board positions, linked by wilderness dirt roads following
// the game's travel-edge graph — the physical geography that replaces the
// per-zone W4 authoring pass. Supersedes the M1 merge prototype.
//
// Hybrid model: Lumbright (the starter town, `start`) is stamped INLINE and
// walkable; Varrick (the big capital, already an authored 96² zone) stays a
// PORTAL (instanced, hybrid escape hatch); the other 12 places are prop-marked
// DISTRICT BLOCK-OUTS — positioned and legible, to be dressed into full towns
// later by the visual track. Hand-edit the constants/markers here, not the JSON.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { projectPlaces, roadSegments } from './overworldLayout.mjs'

const worldDir = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = path.join(worldDir, '..')
const load = (id) => JSON.parse(fs.readFileSync(path.join(worldDir, 'zones', `${id}.json`), 'utf8'))
const OUT = path.join(worldDir, 'zones', 'overworld.json')

const world = JSON.parse(fs.readFileSync(path.join(repoRoot, 'src', 'data', 'world.json'), 'utf8'))
const places = Object.values(world.places)
const { W, H, districts } = projectPlaces(places, { scale: 0.32, margin: 20 })
const districtById = new Map(districts.map((d) => [d.id, d]))

const grid = Array.from({ length: H }, () => new Array(W).fill('.'))
const objects = []
const npcs = []
const props = []
const ground = []
const critters = []
const smoke = []
const exits = []

// ── Lumbright, stamped inline so its own spawn lands on its district centre ──
const lb = load('lumbright')
const lbc = districtById.get('lumbright')
const lbOx = lbc.x - lb.spawn.x
const lbOz = lbc.z - lb.spawn.z
const LB_RECT = { x0: lbOx, z0: lbOz, x1: lbOx + lb.width, z1: lbOz + lb.height }
for (let lz = 0; lz < lb.height; lz++) {
  for (let lx = 0; lx < lb.width; lx++) {
    const gx = lbOx + lx
    const gz = lbOz + lz
    if (gx >= 0 && gx < W && gz >= 0 && gz < H) grid[gz][gx] = lb.collision[lz][lx]
  }
}
for (const o of lb.objects ?? []) objects.push({ ...o, id: `lb_${o.id}`, x: o.x + lbOx, z: o.z + lbOz })
for (const n of lb.npcs ?? []) {
  const nn = { ...n, id: `lb_${n.id}`, x: n.x + lbOx, z: n.z + lbOz }
  if (n.wander) nn.wander = { ...n.wander, x: n.wander.x + lbOx, z: n.wander.z + lbOz }
  npcs.push(nn)
}
for (const pr of lb.props ?? []) props.push({ ...pr, x: pr.x + lbOx, z: pr.z + lbOz })
for (const g of lb.ground ?? []) ground.push({ ...g, x: g.x + lbOx, z: g.z + lbOz })
for (const c of lb.ambient?.critters ?? []) critters.push({ ...c, x: c.x + lbOx, z: c.z + lbOz })
for (const s of lb.ambient?.smoke ?? []) smoke.push({ ...s, x: s.x + lbOx, z: s.z + lbOz })

const SPAWN = { x: lbc.x, z: lbc.z }

// ── Varrick, kept as a portal at its district (the hybrid escape hatch) ──
const vc = districtById.get('varrick')
props.push({ model: 'castle', x: vc.x, z: vc.z - 3 })
exits.push({ id: 'exit_varrick', x: vc.x, z: vc.z, toZone: 'varrick', toX: 40, toZ: 82, label: 'Varrick' })

// ── The other 12: prop-marked block-out districts (dressed into towns later) ──
// Markers use props with explicit BASE_SCALE (props.ts) so they size correctly;
// a plaza reads the settlement footprint. Scale hierarchy city>town>village.
const MARKERS = {
  city: [['castle', 0, -4], ['fountain', 0, 1], ['banner', -5, 3], ['banner', 5, 3], ['column', -3, -1], ['column', 3, -1]],
  town: [['fountain', 0, 0], ['stall', -3, 2], ['banner', 3, 2], ['column', 0, -3]],
  village: [['fountain', 0, 0], ['column', -2, -2], ['stall', 2, 2]],
}
const inBounds = (x, z) => x >= 0 && x < W && z >= 0 && z < H
for (const d of districts) {
  if (d.id === 'lumbright' || d.id === 'varrick') continue
  const half = d.tier === 'city' ? 5 : d.tier === 'village' ? 3 : 4
  const size = half * 2 + 1
  ground.push({ kind: 'plaza', x: Math.max(0, d.x - half), z: Math.max(0, d.z - half), w: Math.min(size, W - Math.max(0, d.x - half)), h: Math.min(size, H - Math.max(0, d.z - half)) })
  for (const [model, dx, dz] of MARKERS[d.tier] ?? MARKERS.village) {
    const px = d.x + dx
    const pz = d.z + dz
    if (inBounds(px, pz)) props.push({ model, x: px, z: pz })
  }
}

// ── Wilderness roads along every travel edge ──
for (const r of roadSegments(world.edges, districts)) {
  const x = Math.max(0, r.x)
  const z = Math.max(0, r.z)
  const w = Math.min(r.w, W - x)
  const h = Math.min(r.h, H - z)
  if (w > 0 && h > 0) ground.push({ kind: 'path_dirt', x, z, w, h })
}

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
  // Merged map holding every place's entities → each player only needs diffs for
  // entities near them. Gated per-zone (WorldZone.broadcastDiffs); standalone
  // zones are untouched.
  aoiRadius: 40,
  palette: { walkableA: '#8a9a55', walkableB: '#7e8e4c', blockedA: '#9a9186', blockedB: '#89806f' },
  terrain: {
    relief: 0.6,
    procedural: { seed: 7000, frequency: 0.04 },
    material: 'meadow',
    scatter: [
      { model: 'flowers', density: 0.8, scaleRange: [0.8, 1.1] },
      { model: 'bush', density: 0.6, scaleRange: [0.7, 1] },
    ],
  },
}

// ── Fail fast ──
const errs = []
if (zone.collision.length !== H) errs.push(`collision has ${zone.collision.length} rows, expected ${H}`)
const walkable = (x, z) => grid[z] && grid[z][x] === '.'
if (!walkable(SPAWN.x, SPAWN.z)) errs.push(`spawn (${SPAWN.x},${SPAWN.z}) blocked`)
if (LB_RECT.x0 < 0 || LB_RECT.z0 < 0 || LB_RECT.x1 > W || LB_RECT.z1 > H) errs.push(`lumbright stamp ${JSON.stringify(LB_RECT)} out of bounds (${W}x${H})`)
// Every non-lumbright district centre must sit OUTSIDE lumbright's stamped
// footprint, else the scale is too small and towns collide with the starter.
for (const d of districts) {
  if (d.id === 'lumbright') continue
  if (d.x >= LB_RECT.x0 && d.x < LB_RECT.x1 && d.z >= LB_RECT.z0 && d.z < LB_RECT.z1) errs.push(`district ${d.id} (${d.x},${d.z}) overlaps lumbright stamp — raise scale`)
}
const seen = new Set()
for (const it of [...objects, ...npcs, ...exits]) {
  if (seen.has(it.id)) errs.push(`duplicate id ${it.id}`)
  seen.add(it.id)
  if (!walkable(it.x, it.z)) errs.push(`${it.id} (${it.x},${it.z}) not walkable`)
}
for (const r of ground) if (r.x < 0 || r.z < 0 || r.x + r.w > W || r.z + r.h > H) errs.push(`ground ${r.kind} (${r.x},${r.z}) ${r.w}x${r.h} out of bounds`)
// Connectivity: every district centre + the Varrick exit reachable on foot.
const reach = Array.from({ length: H }, () => new Array(W).fill(false))
const stack = [[SPAWN.x, SPAWN.z]]
reach[SPAWN.z][SPAWN.x] = true
while (stack.length) {
  const [x, z] = stack.pop()
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx
    const nz = z + dz
    if (nx >= 0 && nx < W && nz >= 0 && nz < H && !reach[nz][nx] && grid[nz][nx] === '.') { reach[nz][nx] = true; stack.push([nx, nz]) }
  }
}
for (const d of districts) if (!reach[d.z][d.x]) errs.push(`district ${d.id} (${d.x},${d.z}) unreachable from spawn`)
if (errs.length) { console.error('OVERWORLD GEN ERRORS:\n' + errs.join('\n')); process.exit(1) }

const walk = zone.collision.join('').split('').filter((c) => c === '.').length
console.log(`overworld: ${W}x${H}, ${districts.length} districts, ${walk}/${W * H} walkable, ${props.length} props, ${objects.length} objects, ${npcs.length} npcs`)
fs.writeFileSync(OUT, JSON.stringify(zone, null, 1) + '\n')
console.log(`wrote ${OUT}`)
