import { requireAuth, json } from '../_lib/auth.js'
import { assertNotInActiveMatch, sweepStaleRows } from '../_lib/pvp.js'
import { computeSaveSummaryFromJson } from '../_lib/saveSummary.js'
import { decodeSaveRow, gzipJsonString } from '../_lib/saveCodec.js'

const MAX_SAVE_BYTES = 256 * 1024 // 256 KB ceiling — current saves are well under this

// Probabilistic gate for the PvP-state sweep on the save-PUT path. Saves
// happen on a tight client-side cadence; running the full sweep on every
// one was burning a chunk of the daily D1 write budget on cleanup work
// the PvP endpoints (which sweep on every action) already do. 5% keeps
// global state tidy in any reasonable traffic without piling sweep load
// on a non-PvP player's routine save loop.
const SAVE_SWEEP_PROBABILITY = 0.05

export function shouldSweepOnSave(rng = Math.random) {
  return rng() < SAVE_SWEEP_PROBABILITY
}

async function getCharacterId(request, env, identityId) {
  const url = new URL(request.url)
  const headerId = request.headers.get('X-Character-Id')
  const queryId = url.searchParams.get('character_id')
  const idStr = headerId || queryId
  if (!idStr) return { error: 'Missing X-Character-Id header', status: 400 }
  const id = parseInt(idStr, 10)
  if (!Number.isFinite(id)) return { error: 'Invalid character id', status: 400 }

  // Confirm ownership
  const row = await env.DB.prepare(
    'SELECT id FROM characters WHERE id = ? AND owner_id = ? AND deleted_at IS NULL'
  ).bind(id, identityId).first()
  if (!row) return { error: 'Character not found', status: 404 }
  return { id }
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getCharacterId(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  const row = await env.DB.prepare(
    'SELECT save_blob, updated_at FROM saves WHERE character_id = ?'
  ).bind(ch.id).first()
  if (!row) return json({ save: null })

  const decoded = await decodeSaveRow(row)
  if (!decoded) return json({ save: null })
  return json({ save: { save_blob: decoded.save_blob, updatedAt: decoded.updatedAt } })
}

export async function onRequestPut({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getCharacterId(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  // PvP inventory lock: refuse local-client saves while a match is active.
  const lock = await assertNotInActiveMatch(env, ch.id)
  if (lock) return lock
  // Probabilistic sweep — see SAVE_SWEEP_PROBABILITY above. PvP endpoints
  // already sweep on every action, so the global state stays fresh during
  // active PvP without forcing every routine save to do cleanup work.
  if (shouldSweepOnSave()) {
    sweepStaleRows(env).catch(() => {})
  }

  let body
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }
  const saveJson = body.save_blob
  const credits_used_increment = body.credits_used_increment === 1 ? 1 : 0
  if (saveJson !== null && typeof saveJson !== 'string') {
    return json({ error: 'Missing save_blob' }, 400)
  }
  if (saveJson && saveJson.length > MAX_SAVE_BYTES) {
    return json({ error: 'Save too large' }, 413)
  }

  const now = Date.now()
  // Recompute denormalized summary so the leaderboard / PvP CB lookups can
  // run as cheap indexed SELECTs against `characters` instead of LEFT
  // JOINing `saves` and JSON.parsing the full blob in a Worker.
  const { totalLevel, combatLevel } = computeSaveSummaryFromJson(saveJson)
  const saveBlob = saveJson ? await gzipJsonString(saveJson) : null
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO saves (character_id, save_blob, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(character_id) DO UPDATE SET
         save_blob = excluded.save_blob,
         updated_at = excluded.updated_at`
    ).bind(ch.id, saveBlob, now),
    env.DB.prepare(
      `UPDATE characters
          SET credits_used = credits_used + ?,
              total_level = ?,
              combat_level = ?
        WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`
    ).bind(credits_used_increment, totalLevel, combatLevel, ch.id, auth.identity.id),
  ])

  return json({ ok: true, updatedAt: now })
}

// Hard-delete the saves row for this character. Used on One-Life death so
// nothing remains for the client to pull back on next login.
export async function onRequestDelete({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getCharacterId(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  await env.DB.prepare('DELETE FROM saves WHERE character_id = ?').bind(ch.id).run()
  return json({ ok: true })
}
