import { requireAuth, json } from '../_lib/auth.js'
import { signJWT } from '../_lib/jwt.js'
import { assertNotInCoopSession } from '../_lib/game/coopBoss.js'
import { bossEntryFailure, bossHasEntryGate, loadBossKillCounts } from '../_lib/game/bossEntry.js'
import { loadCharacterWithSave } from '../_lib/game/save.js'
import { worldLairMonster } from '../../src/engine/worldLairs.js'

const HANDOFF_EXPIRES_SECONDS = 60

/** Where in the world the player asked to land. Passed straight through as a
 * handoff claim — the world Worker is the authority on which zones may be
 * entered this way (it only honours instanced boss lairs), so this just keeps
 * junk out of the token. */
function requestedZone(body) {
  const zone = body?.zone
  return typeof zone === 'string' && /^[a-z][a-z0-9_]{0,31}$/.test(zone) ? zone : null
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  let body = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  const zone = requestedZone(body)

  const idStr = request.headers.get('X-Character-Id')
  const characterId = parseInt(idStr || '', 10)
  if (!Number.isFinite(characterId)) return json({ error: 'Missing X-Character-Id header' }, 400)

  const row = await env.DB.prepare(
    'SELECT id FROM characters WHERE id = ? AND owner_id = ? AND deleted_at IS NULL'
  ).bind(characterId, auth.identity.id).first()
  if (!row) return json({ error: 'Character not found' }, 404)

  // Never hand off into the world during a co-op boss fight: the world's grant
  // flush writes the save directly, so it does not pass through /api/save's
  // co-op lock at all.
  const coopLock = await assertNotInCoopSession(env, row.id)
  if (coopLock) return coopLock

  // A lair is a boss fight whose loot the world Worker grants server-side, so
  // its entry requirements are enforced here as well as in the client's combat
  // screen — §20: a client-only gate is no gate. Kill counts come from the
  // kill_counts table; they are not in the save (bossEntry.js).
  const lairMonsterId = worldLairMonster(zone)
  if (lairMonsterId && bossHasEntryGate(lairMonsterId)) {
    const { saveObject } = await loadCharacterWithSave(env, row.id, auth.identity.id)
    const gate = bossEntryFailure(lairMonsterId, saveObject, await loadBossKillCounts(env, row.id))
    if (gate) return json({ error: gate.reason, code: 'BOSS_REQUIREMENTS_NOT_MET' }, 403)
  }

  const handoff = await signJWT(
    { sub: auth.identity.id, character_id: row.id, scope: 'world_handoff', ...(zone ? { world_zone: zone } : {}) },
    env.JWT_SECRET,
    HANDOFF_EXPIRES_SECONDS
  )
  return json({ handoff })
}
