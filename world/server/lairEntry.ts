// The boss-lair entry gate, at the door the player actually comes through.
//
// /api/world-token enforces this before it signs a handoff, and that is where a
// legitimate entry is refused. It is not, however, the only way in: the session
// token it leads to carries no zone claim, room names are URL path segments, and
// the WorldZone Durable Object is routed to by name — so a socket opened
// straight at `zaryth_throne~1` reached the boss without ever asking the
// endpoint. That is not a cosmetic bypass: the world grants this boss's
// collection-log slots and kill counts server-side (bossKills.ts), so the gate
// has to hold here too (§14, §20 — "a client-only gate is no gate").
//
// Same funnel as every other entry path (functions/_lib/game/bossEntry.js);
// nothing about the rules lives here.
import { bossEntryFailure, bossHasEntryGate, loadBossKillCounts } from '../../functions/_lib/game/bossEntry.js'
import { worldLairMonster } from '../../src/engine/worldLairs.js'
import { baseRoomZone } from '../shared/instances'

type GateEnv = { DB: D1Database }

/**
 * Why this character may not enter this room, or null when they may.
 *
 * Costs nothing for the rooms that gate nothing: most lairs (the cow pasture,
 * the fiend pit, the dragon roost, Grondar's) have no requirements at all, and
 * `bossHasEntryGate` answers that from the monster data before any D1 read.
 *
 * Fails CLOSED. A lair whose gate cannot be evaluated — a D1 blip, a save that
 * will not load — refuses entry rather than waving the player through, because
 * the thing on the other side of it hands out the game's best-in-slot table.
 */
export async function lairEntryFailure(
  env: GateEnv,
  room: string,
  saveObject: unknown,
  characterId: number,
): Promise<string | null> {
  const monsterId = worldLairMonster(baseRoomZone(room))
  if (!monsterId || !bossHasEntryGate(monsterId)) return null
  // No save, no entry. A slayer or quest requirement read off a missing save
  // fails closed on its own (level 1, no quests), but a kill-count gate is
  // answered entirely from D1 and would wave the player straight through.
  if (!saveObject || typeof saveObject !== 'object') return 'Could not verify your progress for this lair'
  try {
    const killCounts = await loadBossKillCounts(env, characterId)
    return bossEntryFailure(monsterId, saveObject, killCounts)?.reason ?? null
  } catch {
    return 'Could not verify your progress for this lair'
  }
}

/** Keep the source session until admission, durable progress and arrival succeed. */
export async function prepareZoneTransition(steps: {
  gate: () => Promise<string | null>
  assign: () => Promise<string>
  flush: () => Promise<boolean>
  persist: (room: string) => Promise<void>
  current: () => boolean
}): Promise<{ room: string; error?: never } | { error: string; room?: never }> {
  try {
    const denied = await steps.gate()
    if (denied) return { error: denied }
    const room = await steps.assign()
    if (!steps.current()) return { error: 'Your world session changed. Please try again.' }
    if (!await steps.flush()) return { error: 'Could not save your progress. Please try entering again.' }
    if (!steps.current()) return { error: 'Your world session changed. Please try again.' }
    await steps.persist(room)
    return { room }
  } catch {
    return { error: 'Could not enter this area. Your progress remains here; please try again.' }
  }
}

/** Release the world writer only after its grant save and position are durable. */
export async function prepareWorldDeparture(steps: {
  flush: () => Promise<boolean>
  checkpoint: () => Promise<void>
  release: () => Promise<void>
  current: () => boolean
}): Promise<string|null> {
  try {
    if (!await steps.flush()) return 'Could not save your progress. You remain in the world; please try leaving again.'
    if (!steps.current()) return 'Your world session changed. Please try again.'
    await steps.checkpoint()
    if (!steps.current()) return 'Your world session changed. Please try again.'
    await steps.release()
    return null
  } catch {
    return 'Could not save your progress. You remain in the world; please try leaving again.'
  }
}
