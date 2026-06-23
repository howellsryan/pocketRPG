import { requireAuth, json } from '../_lib/auth.js'
import { assertNotInActiveMatch, sweepStaleRows } from '../_lib/pvp.js'
import { computeSaveSummaryFromJson } from '../_lib/saveSummary.js'
import { decodeSaveRow, gzipJsonString } from '../_lib/saveCodec.js'
import { detectTotalLevelRegression } from '../_lib/game/saveValidation.js'

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

  // Confirm ownership. total_level / combat_level ride along so the PUT
  // path can skip the denormalized-summary UPDATE when nothing changed.
  const row = await env.DB.prepare(
    'SELECT id, total_level, combat_level FROM characters WHERE id = ? AND owner_id = ? AND deleted_at IS NULL'
  ).bind(id, identityId).first()
  if (!row) return { error: 'Character not found', status: 404 }
  return { id, total_level: row.total_level, combat_level: row.combat_level }
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
  // `touch` (PvP-lobby freshness): when the incoming blob is identical to what's
  // stored, the client can still ask us to bump updated_at so the PvP
  // match-create guard (which rejects saves older than 15s) sees a fresh save.
  // Absent this flag, a content-identical save writes NOTHING — not even
  // updated_at — so routine no-op saves (e.g. screen changes) cost zero writes.
  const touchOnNoop = body?.touch === true
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

  const existing = await env.DB.prepare('SELECT save_data, save_blob, save_revision, updated_at FROM saves WHERE character_id = ?').bind(ch.id).first()
  const currentRevision = Number(existing?.save_revision) || 0
  if (expectedSaveRevision !== currentRevision) {
    return json({ error: 'save_revision_conflict', code: 'SAVE_REVISION_CONFLICT', current_revision: currentRevision }, 409)
  }

  // Decode the previous save once. The total-level regression guard and the
  // no-op detection below run against it; a decode failure on an existing
  // row should surface as an error, not let the write through.
  let previousSave = {}
  let previousJson = null
  if (existing?.save_data || existing?.save_blob) {
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

  // Parse the incoming save once (null = a full blob clear). The total-level
  // regression guard runs against it.
  let parsedNext = null
  if (save_data) {
    try { parsedNext = JSON.parse(save_data) } catch {
      return json({ error: 'save_data_not_json', code: 'INVALID_SAVE_DATA' }, 400)
    }
  }

  // Total-level regression guard — the definitive backstop against a fresh /
  // "level 3" character being written over a real one (see
  // detectTotalLevelRegression). A null save_data clears the blob to total
  // level 0; the only legitimate full wipe is One-Life death, which goes
  // through DELETE, so a null PUT over a levelled save is the same regression.
  const regression = detectTotalLevelRegression(previousSave, parsedNext || {})
  if (regression.regressed) {
    return json({
      error: 'total_level_regression_rejected',
      code: 'TOTAL_LEVEL_REGRESSION',
      previous_total_level: regression.previousTotalLevel,
      next_total_level: regression.nextTotalLevel,
    }, 409)
  }

  // NOTE: /api/save is intentionally client-authoritative and trusted.
  // PocketRPG is offline-first — live skilling, offline idle catch-up, and
  // skip-hour all compute XP / coins / drops on the CLIENT and persist them
  // through this endpoint; there is no server-side game engine to recompute
  // against, and the same client paths legitimately create high-value items
  // (idle/offline monster loot, crafted/smithed/cooked products, skill capes),
  // so the endpoint cannot reject "protected" item increases without breaking
  // the core loop. Integrity for the things that CAN be made authoritative is
  // enforced upstream instead: boss/raid/clue/minigame/dungeoneering uniques are
  // granted (and their kill-counts / collection-log entries recorded) by the
  // server-side completion endpoints with nonce replay protection and
  // server-rolled RNG; purchases debit and grant via /api/purchase; credits are
  // debited server-side by /api/skip-hour and /api/slayer/skip; the trading post
  // and PvP have their own authoritative paths. Client-authoritative XP/coins is
  // inherent to the idle-game design and the leaderboard is best-effort, not
  // cheat-proof. The only write this endpoint refuses is a total-level
  // regression (above), which is account-wipe protection, not anti-cheat.

  const now = Date.now()

  // No-op save: the incoming payload matches what's already stored (modulo
  // the volatile top-level `timestamp` the client stamps on every push), so
  // skip the write entirely and hand back the current revision. AFK/idle
  // tabs push unchanged saves on the autosave cadence; together with the
  // client-side dirty check this stops them burning the daily write budget.
  if (save_data !== null && previousJson !== null && parsedNext) {
    const prevKey = JSON.stringify({ ...previousSave, timestamp: 0 })
    const nextKey = JSON.stringify({ ...parsedNext, timestamp: 0 })
    if (prevKey === nextKey) {
      // Content-identical to what's stored. Default: write NOTHING at all — not
      // the blob, the revision, the summary, NOR updated_at — so a routine no-op
      // save (screen change, AFK tab) costs zero D1 writes.
      //
      // The ONE exception is an explicit `touch` push from the PvP lobby: the
      // match-create guard refuses to start a match on a save older than 15s, so
      // a lobby-sitting player whose content hasn't changed still needs us to
      // bump updated_at. That stays write-cheap (one indexed column, no 130 KB
      // blob). Only the lobby sets `touch`, so general play never pays for it.
      if (touchOnNoop) {
        await env.DB.prepare(
          'UPDATE saves SET updated_at = ? WHERE character_id = ?'
        ).bind(now, ch.id).run()
        return json({ ok: true, updatedAt: now, save_revision: currentRevision, noop: true })
      }
      return json({
        ok: true,
        updatedAt: Number(existing?.updated_at) || now,
        save_revision: currentRevision,
        noop: true,
      })
    }
  }

  // Recompute denormalized summary so the leaderboard / PvP CB lookups can
  // run as cheap indexed SELECTs against `characters` instead of LEFT
  // JOINing `saves` and JSON.parsing the full blob in a Worker.
  const { totalLevel, combatLevel } = computeSaveSummaryFromJson(save_data)
  const save_blob = save_data ? await gzipJsonString(save_data) : null

  const statements = [
    env.DB.prepare(
      `INSERT INTO saves (character_id, save_blob, save_data, updated_at, save_revision)
       VALUES (?, ?, ?, ?, 1)
       ON CONFLICT(character_id) DO UPDATE SET
         save_blob = excluded.save_blob,
         save_data = excluded.save_data,
         updated_at = excluded.updated_at,
         save_revision = COALESCE(saves.save_revision, 0) + 1`
    ).bind(ch.id, save_blob, save_data, now),
  ]
  // total_level / combat_level rarely change between saves — only include the
  // characters UPDATE in the batch when the stored summary actually differs.
  // This removes roughly half the daily save-path writes in the common case.
  if (Number(ch.total_level) !== totalLevel || Number(ch.combat_level) !== combatLevel) {
    // total_level_at anchors the leaderboard's first-achieved tie-break
    // (migration 0024): it's the moment the account first reached its current
    // total level. The CASE only advances it when total level actually goes up
    // (the RHS sees the pre-update row value), so a combat-level-only change
    // leaves the timestamp frozen — otherwise ties would degrade to "most
    // recently saved" instead of "got there first".
    statements.push(
      env.DB.prepare(
        `UPDATE characters
            SET total_level = ?,
                combat_level = ?,
                total_level_at = CASE WHEN ? > total_level THEN ? ELSE total_level_at END
          WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`
      ).bind(totalLevel, combatLevel, totalLevel, now, ch.id, auth.identity.id),
    )
  }
  await env.DB.batch(statements)

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
