// Tile line-of-sight for ranged/magic combat. Pure geometry over the zone's
// ASCII collision grid ('.' = walkable, anything else blocks). Gating attacks on
// LOS is what kills the safespot exploit: a pillar between shooter and target
// now blocks the shot in BOTH directions instead of letting a player kite a
// boss to death from behind cover it can never see through.
import type { Tile } from './pathfind'

function blocked(collision: string[], x: number, z: number): boolean {
  return collision[z]?.[x] !== '.'
}

/** True when no blocked tile lies between `a` and `b`. Endpoints are excluded —
 * both combatants stand on walkable tiles; only what's BETWEEN them can block
 * the sightline. Uses an integer Bresenham walk; on a diagonal step the sight is
 * blocked only when BOTH squeezed-past orthogonal tiles are walls (a true
 * corner), so a single pillar the line merely grazes doesn't over-block. */
export function hasLineOfSight(collision: string[], a: Tile, b: Tile): boolean {
  let x = a.x
  let z = a.z
  const dx = Math.abs(b.x - x)
  const dz = Math.abs(b.z - z)
  const sx = x < b.x ? 1 : -1
  const sz = z < b.z ? 1 : -1
  let err = dx - dz

  for (;;) {
    if (x === b.x && z === b.z) return true
    const e2 = 2 * err
    let steppedX = false
    let steppedZ = false
    if (e2 > -dz) { err -= dz; x += sx; steppedX = true }
    if (e2 < dx) { err += dx; z += sz; steppedZ = true }
    // Reached the target tile — nothing between blocked it.
    if (x === b.x && z === b.z) return true
    // An intermediate tile on the line is a wall → no sight.
    if (blocked(collision, x, z)) return false
    // Diagonal step: block only when squeezing between two wall corners.
    if (steppedX && steppedZ && blocked(collision, x - sx, z) && blocked(collision, x, z - sz)) return false
  }
}
