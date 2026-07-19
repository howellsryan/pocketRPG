import type { EntityDiff } from '../shared/protocol'

// Area-of-interest broadcast (M1, docs/single-world-map-investigation.md). On a
// merged overworld holding every place's entities, a player only needs diffs for
// entities near them. This computes one player's AOI slice: pure so it's tested
// in isolation; WorldZone.broadcastDiffs calls it only when the zone sets
// `aoiRadius` (absent => the per-zone game broadcasts everything, unchanged).

export function chebyshev(ax: number, az: number, bx: number, bz: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(az - bz))
}

export type AoiEntity = { id: string; x: number; z: number }

/** One player's AOI broadcast. `entities` is every live entity's current
 * position (viewer included); `changed` maps id → this tick's diff for entities
 * that moved/changed; `fullDiff` builds a fresh diff for an entity that just
 * entered range without a this-tick diff; `prevView` is what the player saw last
 * tick. Returns the diffs to send, removals for entities that left range, and
 * the new view set. The viewer's own id is always kept in view. */
export function computeAoi(
  px: number,
  pz: number,
  selfId: string,
  radius: number,
  entities: AoiEntity[],
  changed: Map<string, EntityDiff>,
  fullDiff: (id: string) => EntityDiff | null,
  prevView: Set<string>,
): { ents: EntityDiff[]; removed: string[]; view: Set<string> } {
  const ents: EntityDiff[] = []
  const view = new Set<string>()
  for (const e of entities) {
    if (e.id !== selfId && chebyshev(px, pz, e.x, e.z) > radius) continue
    view.add(e.id)
    const d = changed.get(e.id)
    if (d) ents.push(d)
    else if (e.id !== selfId && !prevView.has(e.id)) {
      // A non-viewer entity that just entered range with no diff this tick needs
      // a full diff so the client can spawn it; the viewer never needs a
      // redundant self diff.
      const f = fullDiff(e.id)
      if (f) ents.push(f)
    }
  }
  const removed = [...prevView].filter((id) => !view.has(id))
  return { ents, removed, view }
}
