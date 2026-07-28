// One Life deaths in the open world. The world resolves its own combat, so a
// player who dies out here never touches `/api/characters/reset-one-life` — the
// idle game's death paths are the only callers of it. Without this the run
// survives a death that plainly ended it.
import type { ZoneEvent } from '../shared/protocol'
import type { Env } from './env'

export const ONE_LIFE_OVER_MESSAGE = 'Your One Life run is over. The account continues without it.'

/** The D1 half — the same flag flip the endpoint performs, and nothing else:
 * the save, levels, collection log and every other table stay untouched. The
 * guarded UPDATE makes a replay a no-op. False on failure, so the caller can
 * retry on the next death rather than lose the revert. */
export async function flipOneLifeOff(env: Env, characterId: number): Promise<boolean> {
  try {
    await env.DB.prepare('UPDATE characters SET is_one_life = 0 WHERE id = ? AND deleted_at IS NULL')
      .bind(characterId).run()
    return true
  } catch (err) {
    console.error('[World][oneLife] revoke failed', { characterId, err: String(err) })
    return false
  }
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
