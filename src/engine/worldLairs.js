/**
 * Bosses that have an instanced open-world lair — a private copy of a 3D room
 * where a group fights the boss live, as an alternative to the solo fight and
 * to the server-run co-op session.
 *
 * Deliberately an explicit map rather than a filter over the boss data: a boss
 * only gets a lair once someone has authored and reviewed one
 * (world/zones/<id>.json), so opening a boss to the open world stays an edit.
 * The zone ids mirror world/shared/instances.ts INSTANCED_ZONES.
 */
export const WORLD_BOSS_LAIRS = {
  warlord_grondar: 'grondar_lair',
}

/** The lair zone id for a monster, or null when it has no authored lair. */
export function worldLairZone(monsterId) {
  return WORLD_BOSS_LAIRS[monsterId] ?? null
}

export function hasWorldLair(monsterId) {
  return worldLairZone(monsterId) != null
}
