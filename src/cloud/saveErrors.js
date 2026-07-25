// Classification of a failed /api/save push. Pure so the branches are
// testable — the push path itself is timer- and network-bound.
//
// Three outcomes, and picking the wrong one is a visible bug:
//   'lock'     — the server is deliberately refusing writes because something
//                else owns this character right now (a PvP match, a live world
//                session, a co-op boss fight). Expected and transient: queue
//                the snapshot, retry shortly, and NEVER count it toward the
//                failure streak that escalates to the blocking "save failed"
//                modal.
//   'conflict' — our local state is wrong and re-pushing repeats the 409. Drop
//                the snapshot and roll back to the cloud copy.
//   'failure'  — anything else. Queue, back off, count the streak.
//
// Every save lock added to functions/api/save.js must be listed here in the
// same change, or the client treats the lock as a hard save failure.

const LOCK_CODES = new Set([
  'CHARACTER_IN_ACTIVE_MATCH',
  'CHARACTER_IN_WORLD_SESSION',
  'CHARACTER_IN_COOP_SESSION',
])

const LOCK_ERRORS = new Set([
  'character_in_active_match',
  'character_in_world_session',
  'character_in_coop_session',
])

const CONFLICT_CODES = new Set(['SAVE_REVISION_CONFLICT', 'BANK_WIPE_REJECTED'])
const CONFLICT_ERRORS = new Set(['save_revision_conflict', 'bank_wipe_rejected'])

export function classifySaveError(err) {
  if (err?.status !== 409) return 'failure'
  const code = err?.body?.code
  const error = err?.body?.error
  const message = err?.message
  if (LOCK_CODES.has(code) || LOCK_ERRORS.has(error) || LOCK_ERRORS.has(message)) return 'lock'
  if (CONFLICT_CODES.has(code) || CONFLICT_ERRORS.has(error) || CONFLICT_ERRORS.has(message)) return 'conflict'
  return 'failure'
}

/** The PvP lock alone carries a match id the UI surfaces; the others don't. */
export function activeMatchIdFromSaveError(err) {
  const isMatch = err?.body?.code === 'CHARACTER_IN_ACTIVE_MATCH'
    || err?.body?.error === 'character_in_active_match'
    || err?.message === 'character_in_active_match'
  return isMatch ? (err?.body?.match_id ?? null) : null
}
