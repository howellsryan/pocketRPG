import { requireAuth, json } from '../_lib/auth.js'
import { verifyJWT } from '../_lib/jwt.js'
import { assertNotInActiveMatch, sweepStaleRows } from '../_lib/pvp.js'
import { computeSaveSummaryFromJson } from '../_lib/saveSummary.js'
import { decodeSaveRow, gzipJsonString } from '../_lib/saveCodec.js'
import { detectTotalLevelRegression, detectBankWipe } from '../_lib/game/saveValidation.js'
import { stampIdleActive, stampIdleActiveStatement } from '../_lib/game/idleStamp.js'
import { isWorldSessionLive } from '../_lib/game/worldSessions.js'
import { auditLog } from '../_lib/game/audit.js'

const MAX_SAVE_BYTES = 256 * 1024 // 256 KB ceiling — current saves are well under this

// Idle write ceiling. A session with no genuine player interaction for this
// long is an abandoned (typically forgotten-foreground) tab whose idle activity
// keeps ticking. Past this point its idle backstop saves are refused: the live
// progress is reconstructable on return via idle catch-up, which is itself
// capped at 24h, so persisting further idle ticks buys a returning player
// nothing and only burns D1 writes at scale. Aligned to MAX_OFFLINE_MS on the
// client. Interactive saves (screen actions, milestones, leave-flush) are never
// refused and refresh the freshness stamp.
const IDLE_WRITE_CEILING_MS = 24 * 60 * 60 * 1000

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

// Volatile fields the activity runner rewrites on every 600ms tick (per-action
// countdown + live session tallies). They carry no durable state the cloud
// needs — XP/coins/items live in stats/inventory/bank — so two saves that differ
// ONLY in these are content-identical for no-op purposes. Mirrors the client's
// saveContentKey (src/cloud/sync.js) so the DB skips the write even if a client
// still ships the churn.
const VOLATILE_ACTIVE_TASK_FIELDS = ['ticksRemaining', 'pendingTicks', 'totalTicks', 'session']

export function noopSaveKey(save) {
  const next = { ...(save || {}), timestamp: 0 }
  const activeTask = next?.settings?.activeTask
  if (activeTask && typeof activeTask === 'object') {
    const trimmed = { ...activeTask }
    for (const f of VOLATILE_ACTIVE_TASK_FIELDS) delete trimmed[f]
    next.settings = { ...next.settings, activeTask: trimmed }
  }
  return JSON.stringify(next)
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
  // path can skip the denormalized-summary UPDATE when nothing changed, and
  // active_match_id so the PvP lock check reuses this read instead of issuing
  // its own identical SELECT.
  const row = await env.DB.prepare(
    'SELECT id, total_level, combat_level, active_match_id FROM characters WHERE id = ? AND owner_id = ? AND deleted_at IS NULL'
  ).bind(id, identityId).first()
  if (!row) return { error: 'Character not found', status: 404 }
  return { id, total_level: row.total_level, combat_level: row.combat_level, active_match_id: row.active_match_id ?? null }
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

  let body
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }
  return applySaveWrite({ env, ch, identityId: auth.identity.id, body })
}

// Beacon path: navigator.sendBeacon can't set custom headers, so the session
// token and character id ride in the body (mirrors functions/api/idle.js). Used
// on page teardown (refresh / close / tab-hide) where a normal PUT fetch would
// be cancelled mid-flight and progress since the last debounced push would be
// lost. Same write semantics as PUT.
export async function onRequestPost({ request, env }) {
  let body
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const token = typeof body.token === 'string' ? body.token : null
  if (!token) return json({ error: 'Missing token' }, 401)
  const payload = await verifyJWT(token, env.JWT_SECRET)
  if (!payload || !payload.sub) return json({ error: 'Invalid or expired token' }, 401)

  const id = Number.isFinite(body.character_id) ? body.character_id : parseInt(body.character_id, 10)
  if (!Number.isFinite(id)) return json({ error: 'Missing character_id' }, 400)

  const row = await env.DB.prepare(
    'SELECT id, total_level, combat_level, active_match_id FROM characters WHERE id = ? AND owner_id = ? AND deleted_at IS NULL'
  ).bind(id, payload.sub).first()
  if (!row) return json({ error: 'Character not found' }, 404)
  const ch = { id, total_level: row.total_level, combat_level: row.combat_level, active_match_id: row.active_match_id ?? null }
  return applySaveWrite({ env, ch, identityId: payload.sub, body })
}

// Shared write core for PUT (header auth) and the beacon POST (body auth). The
// caller has already resolved + ownership-checked `ch` and parsed `body`.
async function applySaveWrite({ env, ch, identityId, body }) {
  // PvP inventory lock: refuse local-client saves while a match is active.
  // Reuse the active_match_id already fetched during character resolution.
  const lock = await assertNotInActiveMatch(env, ch.id, ch.active_match_id)
  if (lock) return lock
  // World-session lock (same lock class as the PvP lock, not economy policing):
  // refuse idle-client saves while the open-world companion holds a live session
  // for this character, so the two clients can never write the same save
  // concurrently (equipment clobber / item dupe / stale-view vanish). The world
  // DO flushes through its own grant path, not this endpoint.
  if (await isWorldSessionLive(env, ch.id)) {
    return json({ error: 'character_in_world_session', code: 'CHARACTER_IN_WORLD_SESSION' }, 409)
  }
  // Probabilistic sweep — see SAVE_SWEEP_PROBABILITY above. PvP endpoints
  // already sweep on every action, so the global state stays fresh during
  // active PvP without forcing every routine save to do cleanup work.
  if (shouldSweepOnSave()) {
    sweepStaleRows(env).catch(() => {})
  }

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

  // Fold the idle-state freshness read (last_interactive_at) into the existing
  // save read via a correlated subquery — no extra round-trip — so the idle
  // write ceiling can be evaluated before any heavy decode/gzip work.
  const existing = await env.DB.prepare(
    `SELECT save_data, save_blob, save_revision, updated_at,
            (SELECT last_interactive_at FROM character_idle_state WHERE character_id = ?) AS last_interactive_at
       FROM saves WHERE character_id = ?`
  ).bind(ch.id, ch.id).first()
  const currentRevision = Number(existing?.save_revision) || 0
  if (expectedSaveRevision !== currentRevision) {
    return json({ error: 'save_revision_conflict', code: 'SAVE_REVISION_CONFLICT', current_revision: currentRevision }, 409)
  }

  const now = Date.now()
  // `interactive` reflects whether the player has touched this session recently
  // (the client sends `interactive:false` only for an idle backstop write).
  // Absent → treated as interactive, so pre-flag clients are never throttled.
  const interactive = body?.interactive !== false
  const interactiveAt = interactive ? now : null
  // Idle write ceiling: once a non-interactive session has gone
  // IDLE_WRITE_CEILING_MS past its last genuine interaction, refuse the write
  // and FREEZE the idle row — we don't bump last_active_at, so the stored
  // active_task + last_active_at stay put and idle catch-up still resumes
  // correctly (capped at 24h) when the player returns. Costs zero writes. The
  // NULL guard grandfathers rows that have never reported interactivity.
  const lastInteractiveAt = Number(existing?.last_interactive_at)
  if (!interactive && Number.isFinite(lastInteractiveAt) && lastInteractiveAt > 0 &&
      (now - lastInteractiveAt) > IDLE_WRITE_CEILING_MS) {
    return json({
      ok: true,
      updatedAt: Number(existing?.updated_at) || now,
      save_revision: currentRevision,
      noop: true,
      idle_ceiling: true,
    })
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

  // Idle heartbeat, folded into the save write: stamp last_active_at + the
  // active task so idling clients no longer need a separate periodic PUT
  // /api/idle. Serialize the task exactly as the client's putIdle does. The
  // PvP lock above already returned, so an in-match save never reaches here —
  // the stamp stays blocked during a match just like the dedicated idle PUT.
  const activeTaskObj = parsedNext?.settings?.activeTask ?? null
  const idleTaskJson = activeTaskObj ? JSON.stringify(activeTaskObj) : null

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

  // Bank-wipe guard — a substantial bank collapsing to (near) nothing, with the
  // vanished items not reappearing in inventory/equipment, is the signature of
  // a client load/migration bug overwriting a real bank (see detectBankWipe).
  // The bank rides the trusted save blob, so this is the only place we can catch
  // it. Reject like the total-level regression: the client treats the 409 as a
  // conflict and rolls back to the intact cloud copy, restoring the bank.
  const bankWipe = detectBankWipe(previousSave, parsedNext || {})
  if (bankWipe.wiped) {
    await auditLog(env, 'bank_wipe_rejected', {
      characterId: ch.id,
      identityId,
      previousBankItems: bankWipe.previousCount,
      nextBankItems: bankWipe.nextBankCount,
      vanishedCount: bankWipe.vanishedCount,
    }, { swallow: true })
    return json({
      error: 'bank_wipe_rejected',
      code: 'BANK_WIPE_REJECTED',
      previous_bank_items: bankWipe.previousCount,
      next_bank_items: bankWipe.nextBankCount,
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

  // No-op save: the incoming payload matches what's already stored (modulo the
  // volatile top-level `timestamp` the client stamps on every push AND the
  // per-tick activeTask countdown/session churn — see noopSaveKey), so skip the
  // write entirely and hand back the current revision. AFK/idle tabs push
  // unchanged saves on the autosave cadence; together with the client-side dirty
  // check this stops them burning the daily write budget. This backstop catches
  // any client (old or new) that still ships activeTask-only churn saves.
  if (save_data !== null && previousJson !== null && parsedNext) {
    const prevKey = noopSaveKey(previousSave)
    const nextKey = noopSaveKey(parsedNext)
    if (prevKey === nextKey) {
      // Even on a no-op blob write the idle heartbeat MUST still fire: a long
      // AFK foreground session pushes content-identical saves, and without this
      // stamp last_active_at would never refresh, inflating offline rewards on
      // the next load. This is the regression-critical case — keep it.
      await stampIdleActive(env, ch.id, idleTaskJson, now, interactiveAt)
      // Content-identical to what's stored. Default: write NOTHING else — not
      // the blob, the revision, the summary, NOR updated_at — so a routine no-op
      // save (screen change, AFK tab) costs zero further D1 writes.
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
    // Fold the idle heartbeat into the same atomic batch — stamps
    // last_active_at + active_task so idling clients drop the separate idle PUT.
    // interactiveAt advances last_interactive_at only on interactive saves.
    stampIdleActiveStatement(env, ch.id, idleTaskJson, now, interactiveAt),
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
      ).bind(totalLevel, combatLevel, totalLevel, now, ch.id, identityId),
    )
  }
  await env.DB.batch(statements)

  // The upsert always bumps the revision by one — to 1 on a fresh insert (where
  // currentRevision is 0) or COALESCE(save_revision,0)+1 on update — so the new
  // revision is currentRevision + 1 in both cases. Compute it instead of issuing
  // a post-write SELECT.
  return json({ ok: true, updatedAt: now, save_revision: currentRevision + 1 })
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
