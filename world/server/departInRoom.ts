import { getServerByName } from 'partyserver'
import type { WorldZone } from './WorldZone'
import type { DepartInRoom } from './leave'
import type { Env } from './env'

/** Durable Object side of the exit beacon: hand the departure to the room the
 * beacon named. Lives apart from leave.ts so that module (and its tests) stay
 * free of the `cloudflare:workers` runtime import. */
export const departInRoom: DepartInRoom = async (env, room, charId) => {
  const stub = await getServerByName<Env, WorldZone>(
    env.WorldZone as unknown as DurableObjectNamespace<WorldZone>,
    room
  )
  return await stub.departCharacter(charId)
}
