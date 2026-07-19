#!/usr/bin/env node
// M3 overworld layout + town dressing (docs/single-world-map-investigation.md).
// Builds ONE map, zones/overworld.json, holding all 14 canonical places from
// src/data/world.json at their real map-board positions, linked by wilderness
// dirt roads following the game's travel-edge graph — the physical geography
// that replaces the per-zone W4 authoring pass. Supersedes the M1 prototype.
//
// Hybrid model: Lumbright (the starter, `start`) is stamped INLINE and walkable;
// Varrick (the capital, an authored 96² zone) stays a PORTAL (instanced); the
// other 12 places are procedurally DRESSED into towns (dressTown) — plaza +
// street spokes, ring of buildings, ambient life, and interactive facility
// stations matching each place's world.json `facilities`. Safe towns: no street
// monsters, mirroring Varrick. Hand-edit the constants/dresser here, not the JSON.
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
const facilitiesById = new Map(places.map((p) => [p.id, p.facilities ?? []]))
const nameById = new Map(places.map((p) => [p.id, p.name ?? p.id]))

const grid = Array.from({ length: H }, () => new Array(W).fill('.'))
const objects = []
const npcs = []
const props = []       // Lumbright's stamped props (collision already baked into its grid)
const townProps = []   // dressed-town + Varrick props (get the blockFootprint post-pass)
const ground = []
const critters = []
const smoke = []
const exits = []

// ── Collision + building primitives (ported from gen-varrick.mjs) ──────────
const inBounds = (x, z) => x >= 0 && x < W && z >= 0 && z < H
const block = (x, z) => { if (inBounds(x, z)) grid[z][x] = '#' }
const clear = (x, z) => { if (inBounds(x, z)) grid[z][x] = '.' }
const blockRect = (x0, z0, x1, z1) => { for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) block(x, z) }
/** A whole-building prop centred on a blocked footprint. */
const building = (model, x0, z0, x1, z1, scale, rot = 0) => {
  blockRect(x0, z0, x1, z1)
  townProps.push({ model, x: (x0 + x1) / 2, z: (z0 + z1) / 2, scale, rot })
}
// Props are visual-only; collision lives in the ASCII grid. Every solid prop
// blocks the tiles its mesh covers — native half-width × base scale × placement
// scale as a tile radius (identical table to gen-varrick).
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
const NO_COLLIDE = new Set(['flowers', 'bush', 'mushrooms'])
const RADIUS_OVERRIDE = { banner: 0, lantern: 0 }
const blockFootprint = ({ model, x, z, scale }) => {
  if (NO_COLLIDE.has(model)) return
  const r = model in RADIUS_OVERRIDE
    ? RADIUS_OVERRIDE[model]
    : Math.max(0, Math.round((NATIVE_HALF[model] ?? 0.5) * (BASE[model] ?? 1) * (scale ?? 1) - 0.5))
  const cx = Math.round(x), cz = Math.round(z)
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) block(cx + dx, cz + dz)
}

function lcg(seed) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff }
}

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
    if (inBounds(gx, gz)) grid[gz][gx] = lb.collision[lz][lx]
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
townProps.push({ model: 'castle', x: vc.x, z: vc.z - 3, scale: 2.2 })
townProps.push({ model: 'banner', x: vc.x - 4, z: vc.z, scale: 2 })
townProps.push({ model: 'banner', x: vc.x + 4, z: vc.z, scale: 2 })
exits.push({ id: 'exit_varrick', x: vc.x, z: vc.z, toZone: 'varrick', toX: 40, toZ: 82, label: 'Varrick' })

// ── Dress the other 12 into towns ──────────────────────────────────────────
// Tier template: radius, building count, whether it gets a fountain (else well).
const TIER = {
  city: { r: 9, houses: 8, plaza: 3, centre: 'fountain' },
  town: { r: 7, houses: 5, plaza: 2, centre: 'fountain' },
  village: { r: 5, houses: 3, plaza: 1, centre: 'well' },
}
// Footprint rects the dresser reserves — asserted non-overlapping below.
const townRects = []

/** Ring positions (diagonal-first) for `n` buildings at radius `rb` around the
 * centre, skipping the cardinal lanes so roads can enter. */
function ringSlots(n, rb) {
  const diag = Math.round(rb * 0.72)
  const all = [
    [diag, -diag], [-diag, -diag], [diag, diag], [-diag, diag],
    [rb, -2], [-rb, 2], [2, rb], [-2, -rb],
    [rb, 2], [-rb, -2], [-2, rb], [2, -rb],
  ]
  return all.slice(0, n)
}

function dressTown(d) {
  const t = TIER[d.tier] ?? TIER.village
  const cx = d.x
  const cz = d.z
  const rng = lcg(0xd15 + d.x * 131 + d.z)
  townRects.push({ id: d.id, x0: cx - t.r, z0: cz - t.r, x1: cx + t.r, z1: cz + t.r })

  // Plaza + cardinal cobbled street spokes (roads meet these at the centre).
  const ps = t.plaza
  ground.push({ kind: 'plaza', x: cx - ps - 1, z: cz - ps - 1, w: ps * 2 + 3, h: ps * 2 + 3 })
  ground.push({ kind: 'path_cobble', x: cx - 1, z: cz - t.r, w: 3, h: t.r * 2 + 1 })
  ground.push({ kind: 'path_cobble', x: cx - t.r, z: cz - 1, w: t.r * 2 + 1, h: 3 })

  // Civic centrepiece, off the exact centre tile (kept walkable as the road/reach
  // anchor) and off the cardinal lanes.
  townProps.push({ model: t.centre, x: cx + ps, z: cz + ps, scale: t.centre === 'fountain' ? 1.6 : 1.2 })

  // Facility stations from world.json. Every station sits on a cardinal spoke
  // lane (dx==0 or dz==0) — those lanes are re-cleared in the post-pass, so a
  // station can never be walled in. Interactive: bank/furnace_anvil/stove →
  // objects; sawmill/altar → landmark props (no engine object type yet). A
  // station's decorative building sits one tile OFF the lane so it doesn't block
  // the approach.
  const near = t.r - 1
  const mid = Math.max(2, t.r - 3)
  const facSlots = [[0, -near], [near, 0], [0, near], [-near, 0], [0, -mid], [mid, 0], [0, mid], [-mid, 0]]
  let fi = 0
  const nextSlot = () => facSlots[(fi++) % facSlots.length]
  // Perpendicular offset (off the lane) for a station's building.
  const offLane = (dx, dz) => (dx === 0 ? [1, 0] : [0, 1])
  for (const fac of facilitiesById.get(d.id) ?? []) {
    const [dx, dz] = nextSlot()
    const [ox, oz] = offLane(dx, dz)
    if (fac === 'bank') {
      objects.push({ id: `${d.id}_bank`, type: 'bank_chest', x: cx + dx, z: cz + dz })
      townProps.push({ model: 'market', x: cx + dx + ox * 2, z: cz + dz + oz * 2, scale: 2.0 })
    } else if (fac === 'furnace_anvil') {
      // Furnace + anvil both on the same lane so both stay reachable.
      const step = dz === 0 ? Math.sign(-dx) : 0
      const stepZ = dx === 0 ? Math.sign(-dz) : 0
      objects.push({ id: `${d.id}_furnace`, type: 'furnace', x: cx + dx, z: cz + dz })
      objects.push({ id: `${d.id}_anvil`, type: 'anvil', x: cx + dx + step, z: cz + dz + stepZ })
    } else if (fac === 'stove') {
      objects.push({ id: `${d.id}_range`, type: 'range', x: cx + dx, z: cz + dz })
      townProps.push({ model: 'stall', x: cx + dx + ox, z: cz + dz + oz, scale: 1.7 })
    } else if (fac === 'sawmill') {
      townProps.push({ model: 'lumbermill', x: cx + dx + ox, z: cz + dz + oz, scale: 2.2 })
    } else if (fac === 'altar') {
      townProps.push({ model: 'altar', x: cx + dx, z: cz + dz, scale: 1.6 })
    }
  }

  // Ring of houses facing the centre.
  const rb = t.r - 1
  for (const [dx, dz] of ringSlots(t.houses, rb)) {
    const x = cx + dx
    const z = cz + dz
    building(rng() < 0.25 ? 'mill' : 'house', x - 1, z - 1, x + 1, z + 1, 2.2, Math.atan2(cz - z, cx - x))
    if (rng() < 0.5) smoke.push({ x, z, y: 2.4 })
  }
  // A couple of lanterns + a cart on the plaza; a hen flock for life.
  townProps.push({ model: 'lantern', x: cx - ps, z: cz - ps })
  townProps.push({ model: 'lantern', x: cx + ps, z: cz - ps })
  if (d.tier !== 'village') townProps.push({ model: 'cart', x: cx - ps, z: cz + ps, rot: rng() * Math.PI, scale: 1.1 })
  critters.push({ model: 'chicken', x: cx - ps - 1, z: cz - ps - 1, w: ps * 2 + 3, h: ps * 2 + 3, count: d.tier === 'city' ? 5 : 3 })
}

for (const d of districts) {
  if (d.id === 'lumbright' || d.id === 'varrick') continue
  dressTown(d)
}

// ── Wilderness roads along every travel edge ──
for (const r of roadSegments(world.edges, districts)) {
  const x = Math.max(0, r.x)
  const z = Math.max(0, r.z)
  const w = Math.min(r.w, W - x)
  const h = Math.min(r.h, H - z)
  if (w > 0 && h > 0) ground.push({ kind: 'path_dirt', x, z, w, h })
}

// ── Collision post-pass: town props block their footprints, then re-open the
//    tiles play depends on (facility objects, town centres, cardinal lanes). ──
for (const p of townProps) blockFootprint(p)
for (const o of objects) clear(o.x, o.z)
for (const d of districts) {
  if (d.id === 'lumbright') continue
  clear(d.x, d.z)
  const t = TIER[d.tier] ?? TIER.village
  for (let k = -t.r; k <= t.r; k++) { clear(d.x, d.z + k); clear(d.x + k, d.z) } // cardinal lanes
}

// Travel-menu destinations: one per place, at its (walkable, reachability-checked)
// district centre. The client's Travel menu teleports the player here. A centre
// that coincides with an exit tile (Varrick's portal sits on its centre) nudges
// to the nearest walkable non-exit tile, so travel lands you in the overworld
// beside the portal instead of warping through it.
const exitTiles = new Set(exits.map((e) => `${e.x},${e.z}`))
const landmarkTile = (d) => {
  if (!exitTiles.has(`${d.x},${d.z}`)) return { x: d.x, z: d.z }
  for (const [dx, dz] of [[0, 3], [0, -3], [3, 0], [-3, 0], [0, 2], [2, 0], [-2, 0], [0, -2]]) {
    const nx = d.x + dx
    const nz = d.z + dz
    if (grid[nz] && grid[nz][nx] === '.' && !exitTiles.has(`${nx},${nz}`)) return { x: nx, z: nz }
  }
  return { x: d.x, z: d.z }
}
const landmarks = districts.map((d) => ({ id: d.id, label: nameById.get(d.id) ?? d.id, ...landmarkTile(d) }))

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
  landmarks,
  props: [...props, ...townProps],
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
const overlaps = (a, b) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.z0 <= b.z1 && a.z1 >= b.z0
for (const r of townRects) {
  if (overlaps(r, { x0: LB_RECT.x0, z0: LB_RECT.z0, x1: LB_RECT.x1 - 1, z1: LB_RECT.z1 - 1 })) errs.push(`town ${r.id} overlaps lumbright stamp — raise scale`)
  for (const o of townRects) if (o !== r && r.id < o.id && overlaps(r, o)) errs.push(`towns ${r.id} and ${o.id} overlap — raise scale`)
}
const seen = new Set()
for (const it of [...objects, ...npcs, ...exits, ...landmarks]) {
  if (seen.has(it.id)) errs.push(`duplicate id ${it.id}`)
  seen.add(it.id)
  if (!walkable(it.x, it.z)) errs.push(`${it.id} (${it.x},${it.z}) not walkable`)
}
for (const r of ground) if (r.x < 0 || r.z < 0 || r.x + r.w > W || r.z + r.h > H) errs.push(`ground ${r.kind} (${r.x},${r.z}) ${r.w}x${r.h} out of bounds`)
// Connectivity: every district centre, facility object and the Varrick exit
// reachable on foot from spawn.
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
for (const o of [...objects, ...exits, ...landmarks]) if (!reach[o.z][o.x]) errs.push(`${o.id} (${o.x},${o.z}) unreachable from spawn`)
if (errs.length) { console.error('OVERWORLD GEN ERRORS:\n' + errs.join('\n')); process.exit(1) }

const walk = zone.collision.join('').split('').filter((c) => c === '.').length
console.log(`overworld: ${W}x${H}, ${districts.length} districts, ${walk}/${W * H} walkable, ${zone.props.length} props, ${objects.length} objects`)
fs.writeFileSync(OUT, JSON.stringify(zone, null, 1) + '\n')
console.log(`wrote ${OUT}`)
