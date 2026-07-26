import { isGroundKind, type ZoneGroundRegion } from './groundKinds'

export type ZoneObjectDef = {
  id: string
  type: 'rock' | 'bank_chest' | 'tree' | 'furnace' | 'anvil' | 'range'
  rock?: string
  /** Woodcutting action id ('normal', 'oak', …) for type 'tree'. */
  tree?: string
  x: number
  z: number
}

export type ZoneNpcDef = {
  id: string
  monsterId: string
  x: number
  z: number
  wander: { x: number; z: number; w: number; h: number }
  /** Tiles within which this npc aggresses idle passers-by (0 = passive until
   * clicked). Omitted → bosses default aggressive, everything else passive. */
  aggroRadius?: number
}

export type ZoneExitDef = {
  id: string
  x: number
  z: number
  toZone: string
  toX: number
  toZ: number
  /** Destination name for hover text: "Go-to <label>". */
  label: string
  /** Suppress the pulsing gold exit pad (and with it the click target) for this
   * exit. For places where the way out is already built into the scene — a door
   * you walk through — and a glowing marker on the floor would only break the
   * mood. The tile still transitions when stepped on; that is server-side. */
  hideMarker?: boolean
}

/** Visual dressing only — no collision (that stays in the ASCII grid), no pick
 * target. May sit on blocked tiles; that's the authoring pattern. */
export type ZonePropDef = {
  model: string
  x: number
  z: number
  /** Y-rotation in radians. */
  rot?: number
  scale?: number
}

/** A named teleport destination inside the zone — the merged overworld's
 * per-place district centre. Travel snaps the player here (same-zone, no reload).
 * `id` is the place id, `label` its display name; the tile must be walkable. */
export type ZoneLandmarkDef = { id: string; label: string; x: number; z: number }

export type ZonePalette = { walkableA: string; walkableB: string; blockedA: string; blockedB: string }

export type { ZoneGroundRegion }

/** Sky/lighting mood for a zone — the "dark or light world" control. `sky` is
 * the background hex; the two intensities scale the hemisphere fill and the sun.
 * All optional; absent fields fall back to the default daytime look. */
export type ZoneAmbience = {
  sky?: string
  hemiIntensity?: number
  sunIntensity?: number
}

/** Non-combat ambient life (docs/world-design-review-2026-07.md §4.4) — the
 * cheap "towns feel inhabited" layer. Pure client render: critters wander with
 * no combat/collision/server involvement, smoke rises from a chimney tile.
 * `critters[].model` is a loadable GLB basename (chicken, frog, …); the wander
 * rectangle is [x, x+w) × [z, z+h) in tiles. Absent => today's still world. */
export type ZoneAmbientCritter = { model: string; x: number; z: number; w: number; h: number; count: number }
export type ZoneAmbientSmoke = { x: number; z: number; y?: number }
export type ZoneAmbient = { critters?: ZoneAmbientCritter[]; smoke?: ZoneAmbientSmoke[] }

/** Client-render-only terrain height (docs/open-world-terrain-plan.md). Pure
 * decoration: movement, collision, and pathfinding stay flat on the tile grid.
 * `relief` is peak height in tiles (≤1.5). A `procedural` block seeds
 * deterministic noise; `heightmap` (a grayscale PNG, editor-authored, Phase T4)
 * takes precedence when present. `material` names a T2 blend preset. */
export type ScatterLayer = {
  model: string
  density: number
  jitter?: number
  scaleRange?: [number, number]
  minSlope?: number
  maxSlope?: number
}
export type ZoneTerrain = {
  relief: number
  procedural?: { seed: number; frequency: number }
  heightmap?: string
  material?: string
  /** Decorative-only instanced flora — never gameplay, never on blocked/occupied
   * tiles. Interactive nodes stay in `objects[]`. */
  scatter?: ScatterLayer[]
}

export type ZoneDef = {
  id: string
  name: string
  width: number
  height: number
  spawn: { x: number; z: number }
  collision: string[]
  objects: ZoneObjectDef[]
  npcs: ZoneNpcDef[]
  exits?: ZoneExitDef[]
  /** Where a death respawns the player when it should NOT be a no-penalty trip
   * back to this zone's own spawn (item 10) — e.g. a dungeon respawning back at
   * its town entrance. Omitted => respawn at this zone's own `spawn` tile. */
  deathRespawn?: { zone: string; x: number; z: number }
  props?: ZonePropDef[]
  /** Named same-zone teleport destinations (the overworld's place centres).
   * Absent => no travel menu for this zone. */
  landmarks?: ZoneLandmarkDef[]
  palette?: ZonePalette
  ambience?: ZoneAmbience
  /** Client-render-only ambient life (wandering critters, chimney smoke).
   * Decoration: no collision, no server authority. */
  ambient?: ZoneAmbient
  terrain?: ZoneTerrain
  /** Client-render-only painted ground kinds (paths, water, floors). Decoration:
   * collision stays in the ASCII grid. Last region wins on overlap. */
  ground?: ZoneGroundRegion[]
  /** Area-of-interest radius in tiles (M1, docs/single-world-map-investigation.md).
   * When set, the DO only diffs entities within this many tiles of each player —
   * the merged-overworld broadcast optimisation. Absent => diff everything to
   * everyone (today's per-zone behaviour). */
  aoiRadius?: number
}

/** Static per-monster spawn point summary (id + tile), for the world map's
 * monster markers — NOT live positions (those only stream inside each
 * player's AOI). One row per authored npc entry; wandering npcs are still
 * shown at their spawn tile, which is close enough for a map pin. Pure. */
export type NpcSpawnSummary = { monsterId: string; x: number; z: number }

export function zoneSpawnSummary(zone: ZoneDef): NpcSpawnSummary[] {
  return zone.npcs.map((n) => ({ monsterId: n.monsterId, x: n.x, z: n.z }))
}

function isWalkable(zone: ZoneDef, x: number, z: number): boolean {
  const row = zone.collision[z]
  if (row == null) return false
  return row[x] === '.'
}

export type ZoneValidationResult = { valid: true } | { valid: false; errors: string[] }

export function validateZone(zone: ZoneDef): ZoneValidationResult {
  const errors: string[] = []

  if (zone.collision.length !== zone.height) {
    errors.push(`collision has ${zone.collision.length} rows, expected height ${zone.height}`)
  }
  zone.collision.forEach((row, z) => {
    if (row.length !== zone.width) {
      errors.push(`collision row ${z} has length ${row.length}, expected width ${zone.width}`)
    }
    for (let x = 0; x < row.length; x++) {
      if (row[x] !== '.' && row[x] !== '#') {
        errors.push(`collision row ${z} has invalid character '${row[x]}' at x=${x}`)
      }
    }
  })

  if (!isWalkable(zone, zone.spawn.x, zone.spawn.z)) {
    errors.push(`spawn (${zone.spawn.x},${zone.spawn.z}) is not walkable`)
  }

  const seenIds = new Set<string>()
  for (const obj of zone.objects) {
    if (seenIds.has(obj.id)) errors.push(`duplicate id '${obj.id}'`)
    seenIds.add(obj.id)
    if (!isWalkable(zone, obj.x, obj.z)) {
      errors.push(`object '${obj.id}' at (${obj.x},${obj.z}) is not walkable`)
    }
    if (obj.type === 'tree' && !obj.tree) errors.push(`tree '${obj.id}' is missing its action id`)
    if (obj.type === 'rock' && !obj.rock) errors.push(`rock '${obj.id}' is missing its action id`)
  }
  for (const npc of zone.npcs) {
    if (seenIds.has(npc.id)) errors.push(`duplicate id '${npc.id}'`)
    seenIds.add(npc.id)
    if (!isWalkable(zone, npc.x, npc.z)) {
      errors.push(`npc '${npc.id}' at (${npc.x},${npc.z}) is not walkable`)
    }
  }
  for (const exit of zone.exits ?? []) {
    if (seenIds.has(exit.id)) errors.push(`duplicate id '${exit.id}'`)
    seenIds.add(exit.id)
    if (!isWalkable(zone, exit.x, exit.z)) {
      errors.push(`exit '${exit.id}' at (${exit.x},${exit.z}) is not walkable`)
    }
  }

  for (const lm of zone.landmarks ?? []) {
    if (seenIds.has(lm.id)) errors.push(`duplicate id '${lm.id}'`)
    seenIds.add(lm.id)
    if (!isWalkable(zone, lm.x, lm.z)) {
      errors.push(`landmark '${lm.id}' at (${lm.x},${lm.z}) is not walkable`)
    }
  }

  if (zone.terrain) {
    const t = zone.terrain
    if (typeof t.relief !== 'number' || t.relief < 0 || t.relief > 1.5) {
      errors.push(`terrain.relief must be a number in 0..1.5`)
    }
    if (t.procedural) {
      if (typeof t.procedural.seed !== 'number' || !Number.isFinite(t.procedural.seed)) errors.push(`terrain.procedural.seed must be a finite number`)
      if (typeof t.procedural.frequency !== 'number' || t.procedural.frequency <= 0) errors.push(`terrain.procedural.frequency must be a positive number`)
    }
    for (const [i, layer] of (t.scatter ?? []).entries()) {
      if (!layer.model || typeof layer.model !== 'string') errors.push(`terrain.scatter[${i}].model must be a non-empty string`)
      if (typeof layer.density !== 'number' || layer.density <= 0 || layer.density > 100) errors.push(`terrain.scatter[${i}].density must be in 0..100`)
      if (layer.scaleRange && (layer.scaleRange.length !== 2 || layer.scaleRange[0] > layer.scaleRange[1])) errors.push(`terrain.scatter[${i}].scaleRange must be [min,max] with min<=max`)
    }
  }

  for (const [i, r] of (zone.ground ?? []).entries()) {
    if (!isGroundKind(r.kind)) errors.push(`ground[${i}].kind '${r.kind}' is not a known ground kind`)
    if (![r.x, r.z, r.w, r.h].every((n) => typeof n === 'number' && Number.isFinite(n))) {
      errors.push(`ground[${i}] must have finite numeric x,z,w,h`)
    } else if (r.w <= 0 || r.h <= 0) {
      errors.push(`ground[${i}] must have positive width and height`)
    } else if (r.x < 0 || r.z < 0 || r.x + r.w > zone.width || r.z + r.h > zone.height) {
      errors.push(`ground[${i}] (${r.x},${r.z} ${r.w}x${r.h}) extends outside the zone`)
    }
  }

  if (zone.ambient) {
    for (const [i, c] of (zone.ambient.critters ?? []).entries()) {
      if (!c.model || typeof c.model !== 'string') errors.push(`ambient.critters[${i}].model must be a non-empty string`)
      if (![c.x, c.z, c.w, c.h].every((n) => typeof n === 'number' && Number.isFinite(n)) || c.w <= 0 || c.h <= 0) {
        errors.push(`ambient.critters[${i}] must have finite x,z and positive w,h`)
      } else if (c.x < 0 || c.z < 0 || c.x + c.w > zone.width || c.z + c.h > zone.height) {
        errors.push(`ambient.critters[${i}] area extends outside the zone`)
      }
      if (typeof c.count !== 'number' || !Number.isInteger(c.count) || c.count < 1 || c.count > 24) {
        errors.push(`ambient.critters[${i}].count must be an integer in 1..24`)
      }
    }
    for (const [i, s] of (zone.ambient.smoke ?? []).entries()) {
      if (![s.x, s.z].every((n) => typeof n === 'number' && Number.isFinite(n)) || s.x < 0 || s.z < 0 || s.x >= zone.width || s.z >= zone.height) {
        errors.push(`ambient.smoke[${i}] must be an in-bounds tile`)
      }
      if (s.y != null && (typeof s.y !== 'number' || s.y < 0 || s.y > 10)) errors.push(`ambient.smoke[${i}].y must be a number in 0..10`)
    }
  }

  if (zone.aoiRadius != null && (typeof zone.aoiRadius !== 'number' || zone.aoiRadius <= 0)) {
    errors.push(`aoiRadius must be a positive number`)
  }

  if (zone.ambience) {
    const { sky, hemiIntensity, sunIntensity } = zone.ambience
    if (sky != null && !/^#[0-9a-fA-F]{6}$/.test(sky)) errors.push(`ambience.sky '${sky}' is not a #rrggbb hex colour`)
    for (const [key, val] of [['hemiIntensity', hemiIntensity], ['sunIntensity', sunIntensity]] as const) {
      if (val != null && (typeof val !== 'number' || val < 0 || val > 4)) {
        errors.push(`ambience.${key} must be a number in 0..4`)
      }
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors }
}

/** Cross-zone exit checks the single-zone validator can't do: target zone
 * registered, arrival tile walkable there, and the arrival tile is not itself
 * an exit tile in the target zone (a spawn-on-exit would ping-pong forever). */
export function validateExitGraph(zones: Record<string, ZoneDef>): ZoneValidationResult {
  const errors: string[] = []
  for (const zone of Object.values(zones)) {
    for (const exit of zone.exits ?? []) {
      const target = zones[exit.toZone]
      if (!target) {
        errors.push(`exit '${exit.id}' in '${zone.id}' targets unknown zone '${exit.toZone}'`)
        continue
      }
      if (!isWalkable(target, exit.toX, exit.toZ)) {
        errors.push(`exit '${exit.id}' arrival (${exit.toX},${exit.toZ}) in '${exit.toZone}' is not walkable`)
      }
      if ((target.exits ?? []).some((e) => e.x === exit.toX && e.z === exit.toZ)) {
        errors.push(`exit '${exit.id}' arrival (${exit.toX},${exit.toZ}) lands on an exit tile in '${exit.toZone}'`)
      }
    }
    const dr = zone.deathRespawn
    if (dr) {
      const target = zones[dr.zone]
      if (!target) {
        errors.push(`deathRespawn in '${zone.id}' targets unknown zone '${dr.zone}'`)
      } else {
        if (!isWalkable(target, dr.x, dr.z)) {
          errors.push(`deathRespawn (${dr.x},${dr.z}) in '${dr.zone}' is not walkable`)
        }
        if ((target.exits ?? []).some((e) => e.x === dr.x && e.z === dr.z)) {
          errors.push(`deathRespawn (${dr.x},${dr.z}) lands on an exit tile in '${dr.zone}'`)
        }
      }
    }
  }
  return errors.length === 0 ? { valid: true } : { valid: false, errors }
}
