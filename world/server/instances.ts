import { getServerByName } from 'partyserver'
import { chooseInstanceRoom, MAX_PLAYERS_PER_INSTANCE } from '../shared/instances'
import type { WorldZone } from './WorldZone'
import type { Env } from './env'

// The Durable Object side of instance assignment: occupancy is read live from
// the rooms themselves rather than from a D1 table, because it is ephemeral and
// a durable membership row would be one more lock class needing its own stale
// sweep (the co-op lesson, CLAUDE.md §20). The choosing itself is pure and lives
// in shared/instances.ts; this file only knows how to ask a room.

/** Live player count in a room. An unreachable room reports FULL — never empty,
 * or the assigner would herd every arrival into the one room that is broken. */
async function occupancy(env: Env, room: string): Promise<number> {
  try {
    const stub = await getServerByName<Env, WorldZone>(
      env.WorldZone as unknown as DurableObjectNamespace<WorldZone>,
      room
    )
    return await stub.playerCount()
  } catch {
    return MAX_PLAYERS_PER_INSTANCE
  }
}

export function assignInstanceRoom(env: Env, zoneId: string): Promise<string> {
  return chooseInstanceRoom(zoneId, (room) => occupancy(env, room))
}
