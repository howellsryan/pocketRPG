import type { EntityDiff } from '../shared/protocol'

export type TickPlayer = {
  charId: string
  name: string
  x: number
  z: number
  anim: EntityDiff['anim']
}

export function advanceMovement(player: TickPlayer): TickPlayer {
  return player
}
