import type { Tile } from './pathfind'
import type { EntityDiff } from '../shared/protocol'

export type TickAnim = EntityDiff['anim']

export type TickPlayer = {
  charId: string
  name: string
  x: number
  z: number
  path: Tile[]
  anim: TickAnim
}

export type AdvanceResult = { next: TickPlayer; changed: boolean }

/** Pure single-tick movement step: consumes one tile off `path`, or settles
 * to idle once the path is empty. No I/O — the DO calls this once per
 * connected player per tick and decides what to broadcast from the result. */
export function advanceMovement(player: TickPlayer): AdvanceResult {
  if (player.path.length === 0) {
    if (player.anim === 'idle') return { next: player, changed: false }
    return { next: { ...player, anim: 'idle' }, changed: true }
  }
  const [step, ...rest] = player.path
  return { next: { ...player, x: step.x, z: step.z, path: rest, anim: 'walk' }, changed: true }
}

export function toEntityDiff(player: TickPlayer): EntityDiff {
  return { id: player.charId, kind: 'player', x: player.x, z: player.z, anim: player.anim, name: player.name }
}
