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
