/**
 * Monsters that have an instanced open-world lair — a private copy of a 3D room
 * where a group fights them live, as an alternative to the solo fight and to the
 * server-run co-op session.
 *
 * Deliberately an explicit map rather than a filter over the monster data: a
 * monster only gets a lair once someone has authored and reviewed one
 * (world/zones/<id>.json), so opening a monster to the open world stays an edit.
 * The zone ids mirror world/shared/instances.ts INSTANCED_ZONES. Several
 * monsters may share one room — the three dragons all roost in dragon_roost,
 * each brood in its own quarter of it.
 */
export const WORLD_MONSTER_LAIRS = {
  warlord_grondar: 'grondar_lair',
  pasture_bull: 'cow_pasture',
  lesser_fiend: 'fiend_pit',
  green_dragon: 'dragon_roost',
  red_dragon: 'dragon_roost',
  black_dragon: 'dragon_roost',
  zaryth_the_empty_lord: 'zaryth_throne',
}

/** The lair zone id for a monster, or null when it has no authored lair. */
export function worldLairZone(monsterId) {
  return WORLD_MONSTER_LAIRS[monsterId] ?? null
}

/**
 * The monster whose lair a zone is, or null when the zone is not a lair — the
 * inverse of worldLairZone, for the server gate on world entry (a handoff
 * names the zone, and the entry requirements are authored on the monster).
 *
 * Several monsters may share a room (the dragon roost), so this answers with
 * the FIRST monster mapped to the zone: they are alternative occupants of one
 * room, and a shared room can only be gated on one of them.
 *
 * Built lazily rather than at module scope: this file is concatenated into the
 * single-file bundle and a top-level derived constant is a TDZ hazard (§12).
 */
let lairZoneToMonster = null
export function worldLairMonster(zoneId) {
  if (!zoneId) return null
  if (!lairZoneToMonster) {
    lairZoneToMonster = {}
    for (const [monsterId, zone] of Object.entries(WORLD_MONSTER_LAIRS)) {
      if (!(zone in lairZoneToMonster)) lairZoneToMonster[zone] = monsterId
    }
  }
  return lairZoneToMonster[zoneId] ?? null
}

export function hasWorldLair(monsterId) {
  return worldLairZone(monsterId) != null
}
