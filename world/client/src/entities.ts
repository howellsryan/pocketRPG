import type { EntityDiff } from '../../shared/protocol'

export type EntityView = { id: string; anim: EntityDiff['anim'] }

export function createEntityView(diff: EntityDiff): EntityView {
  return { id: diff.id, anim: diff.anim }
}
