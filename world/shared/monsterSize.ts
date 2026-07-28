// How much ground a monster occupies, in tiles. Gameplay data (server pathing
// and reach) that the client also reads for its pick box, so it lives in shared
// rather than in the render registry next door.
//
// Radius is measured from the npc's own tile: 0 = the usual one-tile monster,
// 1 = a 3×3 body. A monster with a radius blocks players from pathing into its
// footprint and is reachable from one tile beyond it, so a dragon is fought at
// the nose instead of from underneath its jaw.

export const MONSTER_FOOTPRINT_RADIUS: Record<string, number> = {
  green_dragon: 1,
  red_dragon: 1,
  black_dragon: 1,
}

export function footprintRadius(monsterId: string | undefined): number {
  return (monsterId && MONSTER_FOOTPRINT_RADIUS[monsterId]) || 0
}

/** True when (x,z) lies inside this monster's body. */
export function inFootprint(npc: { x: number; z: number; monsterId: string }, x: number, z: number): boolean {
  const r = footprintRadius(npc.monsterId)
  return Math.abs(x - npc.x) <= r && Math.abs(z - npc.z) <= r
}

/** A monster's own reach, or a player's reach against it, widened by its body:
 * both sides swing at the footprint edge, not at the centre tile. */
export function reachAgainst(monsterId: string | undefined, range: number): number {
  return range + footprintRadius(monsterId)
}

/** Copy of `collision` with every large monster's footprint blocked, so player
 * paths route around a dragon instead of through it. `exempt` is the pathing
 * player's own tile — standing inside a footprint (it wandered onto you) must
 * not leave you unable to path out of it. Returns the input untouched when no
 * npc in the zone is large, which is every zone but the roost today. */
export function collisionWithMonsters(
  collision: string[],
  npcs: Iterable<{ x: number; z: number; monsterId: string; state: string }>,
  exempt?: { x: number; z: number },
): string[] {
  const large: { x: number; z: number; r: number }[] = []
  for (const npc of npcs) {
    if (npc.state === 'dead') continue
    const r = footprintRadius(npc.monsterId)
    if (r > 0) large.push({ x: npc.x, z: npc.z, r })
  }
  if (large.length === 0) return collision
  const rows = collision.map((row) => row.split(''))
  for (const { x, z, r } of large) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const tx = x + dx
        const tz = z + dz
        if (exempt && exempt.x === tx && exempt.z === tz) continue
        if (rows[tz]?.[tx] !== undefined) rows[tz][tx] = '#'
      }
    }
  }
  return rows.map((row) => row.join(''))
}
