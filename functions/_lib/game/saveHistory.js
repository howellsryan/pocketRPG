// Rolling save-blob history (Phase 1 of the item-loss safety net — see
// docs/item-loss-safety-net.md).
//
// Detection is a judgement call and will always have gaps; recovery does not.
// Whatever a guard fails to catch, this makes restorable: every save writer
// preserves the blob it is about to overwrite, and /api/admin/restore-save puts
// it back.
//
// The snapshot is an INSERT ... SELECT straight off the `saves` row, so it
// costs no extra read and no second gzip — the stored blob is copied verbatim.
// It MUST be ordered before the write it precedes; D1 runs a batch's statements
// in order, so callers prepend it.

// Cadence and retention, chosen against storage rather than usefulness: at the
// routine cadence a character accumulates ~12 rows before the TTL starts
// dropping them off the back.
export const SAVE_HISTORY_ROUTINE_INTERVAL_MS = 6 * 60 * 60 * 1000
export const SAVE_HISTORY_ROUTINE_TTL_MS = 3 * 24 * 60 * 60 * 1000
// A flagged snapshot is the valuable one — it is the state immediately before a
// suspected loss — so it is kept far longer. The interval is not a cadence but a
// cap: a client stuck in a loop that flags every save must not be able to fill
// the table.
export const SAVE_HISTORY_FLAGGED_MIN_INTERVAL_MS = 5 * 60 * 1000
export const SAVE_HISTORY_FLAGGED_TTL_MS = 14 * 24 * 60 * 60 * 1000

export const SAVE_HISTORY_REASON_ROUTINE = 'routine'
export const SAVE_HISTORY_REASON_ITEM_LOSS = 'item_loss'
// An admin pressing the button. Same snapshot the cadence takes — the same
// INSERT ... SELECT off the same row — just now instead of on the 6h clock. It
// carries its own reason rather than 'routine' so it is distinguishable in the
// list and keeps the longer retention: someone took it deliberately, which is
// exactly the snapshot least worth pruning after three days.
export const SAVE_HISTORY_REASON_MANUAL = 'manual'

// Prune probability on the save path. Deliberately lower than the co-op sweep's
// 5%: two DELETEs that match nothing are cheap, but there is no reason to run
// them on one save in twenty when one in fifty keeps the table trimmed just as
// well.
const SAVE_HISTORY_PRUNE_PROBABILITY = 0.02

export function shouldPruneSaveHistory(rng = Math.random) {
  return rng() < SAVE_HISTORY_PRUNE_PROBABILITY
}

/**
 * Statement that copies the CURRENT stored blob into the history table, unless
 * one with the same reason was already taken inside `minIntervalMs`. The
 * rate-limit is a NOT EXISTS inside the same statement rather than a read, so
 * the whole thing stays a single round trip folded into the caller's batch.
 *
 * A character with no `saves` row yet (first ever write) matches nothing and
 * inserts nothing, which is correct — there is no prior state to preserve.
 */
export function saveHistoryStatement(env, characterId, { reason, minIntervalMs = 0, now = Date.now() }) {
  const columns = `INSERT INTO save_history (character_id, save_revision, save_blob, save_data, created_at, reason)
     SELECT character_id, save_revision, save_blob,
            CASE WHEN save_blob IS NULL THEN save_data END,
            ?, ?
       FROM saves
      WHERE character_id = ?`
  // A zero interval is not a very short cadence — it means UNCONDITIONAL. Used
  // by writes that must never be irreversible (an admin restore), where a rate
  // limit could be the reason the state they overwrote is gone for good.
  if (!minIntervalMs) return env.DB.prepare(columns).bind(now, reason, characterId)
  return env.DB.prepare(
    `${columns}
        AND NOT EXISTS (
          SELECT 1 FROM save_history
           WHERE character_id = ? AND reason = ? AND created_at > ?
        )`
  ).bind(now, reason, characterId, characterId, reason, now - minIntervalMs)
}

export function routineSaveHistoryStatement(env, characterId, now = Date.now()) {
  return saveHistoryStatement(env, characterId, {
    reason: SAVE_HISTORY_REASON_ROUTINE,
    minIntervalMs: SAVE_HISTORY_ROUTINE_INTERVAL_MS,
    now,
  })
}

export function flaggedSaveHistoryStatement(env, characterId, now = Date.now()) {
  return saveHistoryStatement(env, characterId, {
    reason: SAVE_HISTORY_REASON_ITEM_LOSS,
    minIntervalMs: SAVE_HISTORY_FLAGGED_MIN_INTERVAL_MS,
    now,
  })
}

export function forcedSaveHistoryStatement(env, characterId, reason, now = Date.now()) {
  return saveHistoryStatement(env, characterId, { reason, minIntervalMs: 0, now })
}

/** Takes the cadence snapshot on demand. Returns false when the character has
 * no `saves` row for the INSERT ... SELECT to copy — there is no prior state to
 * preserve, which is not an error. */
export async function takeManualSaveHistory(env, characterId, now = Date.now()) {
  const res = await forcedSaveHistoryStatement(env, characterId, SAVE_HISTORY_REASON_MANUAL, now).run()
  return Number(res?.meta?.changes) > 0
}

export async function pruneSaveHistory(env, now = Date.now()) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM save_history WHERE reason = ? AND created_at < ?')
      .bind(SAVE_HISTORY_REASON_ROUTINE, now - SAVE_HISTORY_ROUTINE_TTL_MS),
    env.DB.prepare('DELETE FROM save_history WHERE created_at < ?')
      .bind(now - SAVE_HISTORY_FLAGGED_TTL_MS),
  ])
}

/** Index of what can be restored for a character, newest first. Deliberately
 * does not select the blob — a listing that dragged every snapshot back through
 * the Worker would be megabytes. */
export async function listSaveHistory(env, characterId, limit = 40) {
  const capped = Math.max(1, Math.min(Math.floor(Number(limit) || 0) || 40, 100))
  const res = await env.DB.prepare(
    `SELECT id, save_revision, created_at, reason,
            LENGTH(COALESCE(save_blob, save_data)) AS size_bytes
       FROM save_history
      WHERE character_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?`
  ).bind(characterId, capped).all()
  return res?.results || []
}

/** The character id is part of the lookup, not just the row id: an admin acting
 * on the wrong character must get "not found", never another player's save. */
export async function getSaveHistoryEntry(env, characterId, entryId) {
  return env.DB.prepare(
    'SELECT id, character_id, save_revision, save_blob, save_data, created_at, reason FROM save_history WHERE id = ? AND character_id = ?'
  ).bind(entryId, characterId).first()
}
