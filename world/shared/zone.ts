export type ZoneObjectDef = {
  id: string
  type: 'rock' | 'bank_chest' | 'tree'
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

export type ZonePalette = { walkableA: string; walkableB: string; blockedA: string; blockedB: string }

/** Sky/lighting mood for a zone — the "dark or light world" control. `sky` is
 * the background hex; the two intensities scale the hemisphere fill and the sun.
 * All optional; absent fields fall back to the default daytime look. */
export type ZoneAmbience = {
  sky?: string
  hemiIntensity?: number
  sunIntensity?: number
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
  props?: ZonePropDef[]
  palette?: ZonePalette
  ambience?: ZoneAmbience
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
  }
  return errors.length === 0 ? { valid: true } : { valid: false, errors }
}
