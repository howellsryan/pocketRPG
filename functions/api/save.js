import { requireAuth, json } from '../_lib/auth.js'
import { assertNotInActiveMatch, sweepStaleRows } from '../_lib/pvp.js'
import { computeSaveSummaryFromJson } from '../_lib/saveSummary.js'
import { decodeSaveRow, gzipJsonString } from '../_lib/saveCodec.js'
import { detectProtectedDelta, detectEconomyInflation } from '../_lib/game/saveValidation.js'
import itemsData from '../../src/data/items.json' assert { type: 'json' }

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
    'SELECT save_data, save_blob, updated_at, save_revision FROM saves WHERE character_id = ?'
  ).bind(ch.id).first()
  if (!row) return json({ save: null })

  let decoded = null
  try {
    decoded = await decodeSaveRow(row)
  } catch (err) {
    const code = err?.message || 'save_blob_decode_failed'
    return json({ error: code }, 400)
  }
  if (!decoded) return json({ error: 'save_blob_missing' }, 400)
  return json({ save: { save_data: decoded.save_data, updatedAt: decoded.updatedAt, save_revision: Number(row.save_revision) || 0 } })
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
  const save_data = body.save_data
  const expectedSaveRevision = Number.isFinite(body?.save_revision) ? body.save_revision : parseInt(body?.save_revision, 10)
  // credits_used_increment is intentionally NOT read from the client.
  // Credit consumption flows through /api/skip-hour and /api/slayer/skip,
  // which atomically debit the column server-side. Letting the save endpoint
  // also bump it lets a client either skip the increment (under-report) or
  // double-bump it from a tab the user can't see.
  if (save_data !== null && typeof save_data !== 'string') {
    return json({ error: 'Missing save_data' }, 400)
  }
  if (save_data && save_data.length > MAX_SAVE_BYTES) {
    return json({ error: 'Save too large' }, 413)
  }
  if (!Number.isFinite(expectedSaveRevision) || expectedSaveRevision < 0) {
    return json({ error: 'save_revision_required', code: 'SAVE_REVISION_REQUIRED' }, 400)
  }

  const existing = await env.DB.prepare('SELECT save_data, save_blob, save_revision FROM saves WHERE character_id = ?').bind(ch.id).first()
  const currentRevision = Number(existing?.save_revision) || 0
  if (expectedSaveRevision !== currentRevision) {
    return json({ error: 'save_revision_conflict', code: 'SAVE_REVISION_CONFLICT', current_revision: currentRevision }, 409)
  }

  // Decode the previous save once. The economy- and protected-delta checks
  // both run against it; the catch-all that used to wrap the protected
  // check (and swallow ALL errors silently) is gone — a decode failure on
  // an existing row should return 500, not let the write through.
  let previousSave = {}
  if (existing?.save_data || existing?.save_blob) {
    let previousJson = null
    try {
      const decoded = await decodeSaveRow(existing)
      previousJson = decoded?.save_data || existing?.save_data || null
    } catch (err) {
      const code = err?.message || 'save_blob_decode_failed'
      return json({ error: code }, 400)
    }
    if (previousJson) {
      try { previousSave = JSON.parse(previousJson) } catch { previousSave = {} }
    }
  }

  if (save_data) {
    let parsedNext
    try { parsedNext = JSON.parse(save_data) } catch {
      return json({ error: 'save_data_not_json', code: 'INVALID_SAVE_DATA' }, 400)
    }
    // Step 1: economy fields are server-owned. Reject any client-initiated
    // increase in XP, coins, slayer points, kill counts, etc. Legit gains
    // arrive via the action-completion endpoints, which write the save
    // server-side — the client's next PUT sees the new totals as already
    // present and reports no inflation.
    const econViolations = detectEconomyInflation(previousSave, parsedNext)
    if (econViolations.length) {
      return json({
        error: 'protected_state_delta_rejected',
        code: 'PROTECTED_STATE_DELTA',
        violations: econViolations,
      }, 403)
    }
    const protectedViolations = detectProtectedDelta(previousSave, parsedNext, itemsData)
    if (protectedViolations.length) {
      return json({
        error: 'protected_state_delta_rejected',
        code: 'PROTECTED_STATE_DELTA',
        items: protectedViolations,
      }, 403)
    }
  }

  const now = Date.now()
  // Recompute denormalized summary so the leaderboard / PvP CB lookups can
  // run as cheap indexed SELECTs against `characters` instead of LEFT
  // JOINing `saves` and JSON.parsing the full blob in a Worker.
  const { totalLevel, combatLevel } = computeSaveSummaryFromJson(save_data)
  const save_blob = save_data ? await gzipJsonString(save_data) : null

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO saves (character_id, save_blob, save_data, updated_at, save_revision)
       VALUES (?, ?, ?, ?, 1)
       ON CONFLICT(character_id) DO UPDATE SET
         save_blob = excluded.save_blob,
         save_data = excluded.save_data,
         updated_at = excluded.updated_at,
         save_revision = COALESCE(saves.save_revision, 0) + 1`
    ).bind(ch.id, save_blob, save_data, now),
    env.DB.prepare(
      `UPDATE characters
          SET total_level = ?,
              combat_level = ?
        WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`
    ).bind(totalLevel, combatLevel, ch.id, auth.identity.id),
  ])

  const revisionRow = await env.DB.prepare('SELECT save_revision FROM saves WHERE character_id = ?').bind(ch.id).first()
  return json({ ok: true, updatedAt: now, save_revision: Number(revisionRow?.save_revision) || 0 })
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
