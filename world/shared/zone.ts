export type ZoneObjectDef = {
  id: string
  type: 'rock' | 'bank_chest'
  rock?: string
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

export type ZoneDef = {
  id: string
  name: string
  width: number
  height: number
  spawn: { x: number; z: number }
  collision: string[]
  objects: ZoneObjectDef[]
  npcs: ZoneNpcDef[]
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
  }
  for (const npc of zone.npcs) {
    if (seenIds.has(npc.id)) errors.push(`duplicate id '${npc.id}'`)
    seenIds.add(npc.id)
    if (!isWalkable(zone, npc.x, npc.z)) {
      errors.push(`npc '${npc.id}' at (${npc.x},${npc.z}) is not walkable`)
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors }
}
