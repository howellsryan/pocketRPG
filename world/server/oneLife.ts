// One Life deaths resolved by this Worker — the open world (WorldZone) and the
// co-op boss/raid rooms (CoopBossRoom). Both resolve their own combat, so a
// player who dies in either never touches `/api/characters/reset-one-life`: the
// idle game's death paths are its only callers. Without this the run survives a
// death that plainly ended it.
import type { ZoneEvent } from '../shared/protocol'
import type { Env } from './env'

export const ONE_LIFE_OVER_MESSAGE = 'Your One Life run is over. The account continues without it.'

/** The D1 half — the same flag flip the endpoint performs, and nothing else:
 * the save, levels, collection log and every other table stay untouched.
 * Resolves the rows actually changed, so `0` means the character was never
 * one-life (which also makes a replay a no-op), or null when the write itself
 * failed — a caller with no session copy of the flag can't tell those apart
 * any other way. */
export async function updateOneLifeOff(env: Env, characterId: number): Promise<number | null> {
  try {
    const res = await env.DB
      .prepare('UPDATE characters SET is_one_life = 0 WHERE id = ? AND is_one_life = 1 AND deleted_at IS NULL')
      .bind(characterId).run()
    return Number(res?.meta?.changes) || 0
  } catch (err) {
    console.error('[World][oneLife] revoke failed', { characterId, err: String(err) })
    return null
  }
}

/** Did the write land? For a caller that already knows the character is
 * one-life from its own session state, "changed nothing" and "changed a row"
 * are the same success. */
export async function flipOneLifeOff(env: Env, characterId: number): Promise<boolean> {
  return (await updateOneLifeOff(env, characterId)) !== null
}

/** Ends a run for a caller holding no copy of the flag — the UPDATE is the read
 * as well as the write, in one round trip. True when this death is what ended
 * the run (so it is worth telling the player); false when they were never
 * one-life; null when D1 could not answer and the caller should retry. */
export async function revokeOneLifeIfSet(env: Env, characterId: number): Promise<boolean | null> {
  const changed = await updateOneLifeOff(env, characterId)
  return changed === null ? null : changed > 0
}

export type OneLifeSession = { charId: string; isOneLife: boolean; pendingEvents: ZoneEvent[] }

/** Ends the run on the session the moment the player dies, then persists it.
 * The flag clears optimistically so a second death while the write is in flight
 * can't queue a duplicate, and is restored when the write fails so the next
 * death retries — the idle game's "will retry on the next death" rule. */
export function endOneLifeRun(
  session: OneLifeSession,
  flip: (characterId: number) => Promise<boolean>
): void {
  if (!session.isOneLife) return
  session.isOneLife = false
  session.pendingEvents.push({ e: 'msg', text: ONE_LIFE_OVER_MESSAGE })
  void flip(Number(session.charId)).then((ok) => {
    if (!ok) session.isOneLife = true
  })
}
