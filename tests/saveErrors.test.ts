// Classification of a failed /api/save push. The bug this guards: a save lock
// added server-side (functions/api/save.js) but not listed client-side falls
// through to the generic failure path, so an expected, transient lock counts
// toward the failure streak and escalates to the blocking "save failed" modal.

import { describe, it, expect } from 'vitest'
import { classifySaveError, activeMatchIdFromSaveError } from '../src/cloud/saveErrors.js'

const lock409 = (body: Record<string, unknown>) => ({ status: 409, body })

describe('classifySaveError', () => {
  it('treats a co-op boss session lock as a lock, not a failure', () => {
    expect(classifySaveError(lock409({ code: 'CHARACTER_IN_COOP_SESSION', error: 'character_in_coop_session' }))).toBe('lock')
  })

  it('treats the PvP and world-session locks as locks', () => {
    expect(classifySaveError(lock409({ error: 'character_in_active_match' }))).toBe('lock')
    expect(classifySaveError(lock409({ code: 'CHARACTER_IN_WORLD_SESSION' }))).toBe('lock')
  })

  it('reads a lock off err.message when the body did not parse', () => {
    expect(classifySaveError({ status: 409, message: 'character_in_coop_session' })).toBe('lock')
    expect(classifySaveError({ status: 409, message: 'character_in_active_match' })).toBe('lock')
  })

  it('routes revision conflicts and bank wipes to the rollback path', () => {
    expect(classifySaveError(lock409({ code: 'SAVE_REVISION_CONFLICT' }))).toBe('conflict')
    expect(classifySaveError(lock409({ error: 'save_revision_conflict' }))).toBe('conflict')
    expect(classifySaveError(lock409({ code: 'BANK_WIPE_REJECTED' }))).toBe('conflict')
    expect(classifySaveError({ status: 409, message: 'save_revision_conflict' })).toBe('conflict')
  })

  it('treats any non-409 as a plain failure, whatever the body says', () => {
    expect(classifySaveError({ status: 500, body: { code: 'CHARACTER_IN_COOP_SESSION' } })).toBe('failure')
    expect(classifySaveError({ status: 0 })).toBe('failure')
    expect(classifySaveError(null)).toBe('failure')
    expect(classifySaveError(undefined)).toBe('failure')
  })

  it('treats an unrecognised 409 as a failure so it still retries and warns', () => {
    expect(classifySaveError(lock409({ code: 'SOMETHING_NEW' }))).toBe('failure')
    expect(classifySaveError(lock409({}))).toBe('failure')
  })
})

describe('activeMatchIdFromSaveError', () => {
  it('returns the match id only for the PvP lock', () => {
    expect(activeMatchIdFromSaveError(lock409({ error: 'character_in_active_match', match_id: 42 }))).toBe(42)
    expect(activeMatchIdFromSaveError(lock409({ code: 'CHARACTER_IN_ACTIVE_MATCH', match_id: 7 }))).toBe(7)
  })

  it('returns null for the other locks, which carry no match', () => {
    expect(activeMatchIdFromSaveError(lock409({ code: 'CHARACTER_IN_COOP_SESSION' }))).toBeNull()
    expect(activeMatchIdFromSaveError(lock409({ code: 'CHARACTER_IN_WORLD_SESSION' }))).toBeNull()
    expect(activeMatchIdFromSaveError(lock409({ code: 'SAVE_REVISION_CONFLICT' }))).toBeNull()
  })

  it('returns null rather than undefined when a PvP lock carries no match id', () => {
    expect(activeMatchIdFromSaveError(lock409({ error: 'character_in_active_match' }))).toBeNull()
  })
})
