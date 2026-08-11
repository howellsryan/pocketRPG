import { requireAuth, json } from '../../../_lib/auth.js'
import { getOwnedCharacter } from '../../../_lib/character.js'
import { isWorldSessionLive } from '../../../_lib/game/worldSessions.js'
import { currentSaveRevision, parseCoopSessionId, parseSessionState, readSession, sweepStaleCoopSessions } from '../../../_lib/game/coopBoss.js'
import { joinCoopRaidParty } from '../../../_lib/game/coopRaid.js'
import { projectStateForMember } from '../../../_lib/game/coopProjection.js'
import { toErrorResponse } from '../../../_lib/game/errors.js'

/**
 * Opens a raid party, or joins an existing one.
 *
 * An absent `sessionId` means START A PARTY — it never auto-picks a room the
 * way the boss join does. A raid is a run with a beginning, so which party you
 * are in is a decision the player makes in the lobby list, not one the server
 * makes for them.
 */
export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getOwnedCharacter(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  // A raid party mutates the save, so it collides with a live world session,
  // which wins.
  if (await isWorldSessionLive(env, ch.id)) {
    return json({ error: 'character_in_world_session', code: 'CHARACTER_IN_WORLD_SESSION' }, 409)
  }

  await sweepStaleCoopSessions(env)

  try {
    const body = await request.json().catch(() => null)
    const raidId = typeof body?.raidId === 'string' ? body.raidId : null
    if (!raidId) return json({ error: 'Missing raidId', code: 'INVALID_COOP_RAID' }, 400)

    const rawSessionId = body?.sessionId
    const requestedSessionId = rawSessionId === undefined || rawSessionId === null
      ? null
      : parseCoopSessionId(String(rawSessionId))
    if (rawSessionId !== undefined && rawSessionId !== null && requestedSessionId === null) {
      return json({ error: 'Invalid party', code: 'INVALID_COOP_SESSION' }, 400)
    }

    const { sessionId, rejoined, saveRevision } = await joinCoopRaidParty(env, {
      characterId: ch.id,
      identityId: auth.identity.id,
      raidId,
      username: ch.username,
      sessionId: requestedSessionId,
    })

    const row = await readSession(env, sessionId)
    const state = row ? parseSessionState(row) : null
    return json({
      ok: true,
      sessionId,
      raidId,
      rejoined,
      // Joining wrote the save, so the client has to re-anchor on this or its
      // next push is a stale write.
      save_revision: saveRevision,
      state: state ? projectStateForMember(state, ch.id) : null,
      current_tick: row?.current_tick ?? 0,
    })
  } catch (err) {
    const mapped = toErrorResponse(err)
    // A join can fail AFTER the snapshot write, and the bumped revision outlives
    // the failure. Send it with the error too, or the player's next autosave is
    // rejected for a party they never entered.
    const saveRevision = await currentSaveRevision(env, ch.id).catch(() => null)
    return json(saveRevision === null ? mapped.body : { ...mapped.body, save_revision: saveRevision }, mapped.status)
  }
}
