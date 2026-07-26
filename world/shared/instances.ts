// Instanced zones: a boss room that exists as many independent copies, so a
// group gets the boss to itself instead of queuing behind the whole server.
//
// The mechanism is the room name. A WorldZone DO resolves its zone def from
// `this.name` (ZONES[name]), so `grondar_lair~3` is a third, independent DO
// running the same authored `grondar_lair` def. Nothing else about the world
// changes — combat, loot attribution and boss-kill recording already handle
// several players on one npc.

/** Base zone ids served as instances rather than as one shared room. */
export const INSTANCED_ZONES = new Set(['grondar_lair'])

/** Players per instance. Matches co-op's COOP_MAX_MEMBERS — the same "a group,
 * not a raid crowd" size, and the same number the lair is dressed for. */
export const MAX_PLAYERS_PER_INSTANCE = 8

/** How many copies of one instanced zone may exist at once. Beyond this the
 * assigner stops opening new rooms and players wait for a slot. */
export const MAX_INSTANCES = 12

/** Separator between the base zone id and the instance number. Unreserved in a
 * URL path (room names are path segments) and absent from every zone id. */
const SEPARATOR = '~'

export function isInstancedZone(zoneId: string): boolean {
  return INSTANCED_ZONES.has(zoneId)
}

/** Room name for instance `n` (1-based) of a zone. */
export function instanceRoom(zoneId: string, n: number): string {
  return `${zoneId}${SEPARATOR}${n}`
}

/** The authored zone id behind a room name. Only strips the suffix when the
 * prefix is a known instanced zone, so an ordinary zone id passes through
 * untouched even if one ever contains the separator. */
export function baseRoomZone(room: string): string {
  const cut = room.indexOf(SEPARATOR)
  if (cut < 0) return room
  const base = room.slice(0, cut)
  return isInstancedZone(base) ? base : room
}

/** True for a room belonging to an instanced zone — both the bare base id and a
 * numbered room. Callers use it to refuse to treat the room as a durable
 * location: an instance is a visit, never a place you log back into. */
export function isInstancedRoom(room: string): boolean {
  return isInstancedZone(baseRoomZone(room))
}

/** Which copy of an instanced zone an arriving player should land in: the
 * lowest-numbered room with a free slot, so a party ends up together instead of
 * scattered one-per-room. Probing stops at the first room with space — in the
 * common case that is a single lookup. When every instance is full the first
 * room is returned anyway and the room itself does the refusing, which keeps
 * this a routing decision rather than a second capacity authority.
 *
 * `occupancy` reads a room's live player count; it must report a room it cannot
 * reach as FULL, never as empty, or a broken room would swallow every arrival.
 * The reader is injected so the choice stays pure of the Durable Object runtime
 * (server/instances.ts supplies the real one). */
export async function chooseInstanceRoom(
  zoneId: string,
  occupancy: (room: string) => Promise<number>
): Promise<string> {
  if (!isInstancedZone(zoneId)) return zoneId
  for (let n = 1; n <= MAX_INSTANCES; n++) {
    const room = instanceRoom(zoneId, n)
    if ((await occupancy(room)) < MAX_PLAYERS_PER_INSTANCE) return room
  }
  return instanceRoom(zoneId, 1)
}
