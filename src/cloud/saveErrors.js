// Classification of a failed /api/save push. Pure so the branches are
// testable — the push path itself is timer- and network-bound.
//
// Three outcomes, and picking the wrong one is a visible bug:
//   'lock'     — the server is deliberately refusing writes because something
//                else owns this character right now (a PvP match, a live world
//                session, a co-op boss fight). Expected and transient: queue
//                the snapshot, retry shortly, and NEVER count it toward the
//                failure streak that escalates to the blocking "save failed"
//                modal. The co-op lock is the exception that DROPS the snapshot
//                rather than queuing it — see the lock branch in sync.js.
//   'conflict' — our local state is wrong and re-pushing repeats the 409. Drop
//                the snapshot and roll back to the cloud copy.
//   'failure'  — anything else. Queue, back off, count the streak.
//
// Every save lock added to functions/api/save.js must be listed here in the
// same change, or the client treats the lock as a hard save failure.

const LOCK_CODES = new Set([
  'CHARACTER_IN_WORLD_SESSION',
  'CHARACTER_IN_COOP_SESSION',
])

const LOCK_ERRORS = new Set([
  'character_in_world_session',
  'character_in_coop_session',
])

const CONFLICT_CODES = new Set(['SAVE_REVISION_CONFLICT', 'BANK_WIPE_REJECTED'])
const CONFLICT_ERRORS = new Set(['save_revision_conflict', 'bank_wipe_rejected'])

/** Which lock refused the write, normalised to the code form. Callers that can
 * legitimately continue through one specific lock (joining a co-op fight the
 * server already holds this character for) branch on this rather than on the
 * bare true/false a push returns. */
export function saveLockCode(err) {
  if (classifySaveError(err) !== 'lock') return null
  const code = err?.body?.code
  if (LOCK_CODES.has(code)) return code
  const legacy = LOCK_ERRORS.has(err?.body?.error) ? err.body.error : (LOCK_ERRORS.has(err?.message) ? err.message : null)
  return legacy ? legacy.toUpperCase() : null
}

/**
 * Was this refusal specifically a stale `save_revision`?
 *
 * The two conflict codes take the same rollback path but mean opposite things
 * about whether a write of ours landed: a stale revision says one did (something
 * moved it), a bank-wipe rejection says nothing was written at all. Only the
 * first may settle the side channels a landed write would have banked.
 */
export function isRevisionConflict(err) {
  if (classifySaveError(err) !== 'conflict') return false
  return err?.body?.code === 'SAVE_REVISION_CONFLICT'
    || err?.body?.error === 'save_revision_conflict'
    || err?.message === 'save_revision_conflict'
}

export function classifySaveError(err) {
  if (err?.status !== 409) return 'failure'
  const code = err?.body?.code
  const error = err?.body?.error
  const message = err?.message
  if (LOCK_CODES.has(code) || LOCK_ERRORS.has(error) || LOCK_ERRORS.has(message)) return 'lock'
  if (CONFLICT_CODES.has(code) || CONFLICT_ERRORS.has(error) || CONFLICT_ERRORS.has(message)) return 'conflict'
  return 'failure'
}
