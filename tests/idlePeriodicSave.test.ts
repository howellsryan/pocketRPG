// Engagement-aware periodic save: the autosave tick + activity heartbeat route
// through schedulePeriodicSave, which keeps a responsive cadence while the
// player is interacting but throttles an idle/AFK foreground session to ~hourly
// cloud writes. This is the main lever cutting idle D1 write/read volume.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const putSave = vi.fn(async () => ({ ok: true, updatedAt: Date.now(), save_revision: 1 }))

vi.mock('../src/cloud/api.js', () => ({
  api: { putSave: (...args: any[]) => putSave(...args) },
  getToken: () => 'token',
  getCharacterId: () => '42',
  setLocalCharacterId: () => {},
  SAVE_REVISION_EVENT: 'pocketrpg:save-revision',
}))

vi.mock('../src/db/saveload.js', () => ({
  buildSavePayloadFromSnapshot: (snap: any) => ({ version: 1, timestamp: Date.now(), ...snap }),
  applySavePayload: async () => {},
}))

import { schedulePeriodicSave, noteUserInteraction, resetSyncState } from '../src/cloud/sync.js'

const DEBOUNCE_MS = 120_000
const HOUR_MS = 3_600_000

describe('schedulePeriodicSave throttling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetSyncState() // seeds lastInteractionAt = now (engaged), lastPushedAt = 0
    putSave.mockClear()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('saves on the responsive cadence while the player is interacting', async () => {
    noteUserInteraction()
    schedulePeriodicSave({ stats: { attack: { xp: 5 } } })
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(putSave).toHaveBeenCalledTimes(1)
  })

  it('throttles an idle/AFK session to ~hourly even as progress accrues', async () => {
    // First write while engaged establishes lastPushedAt.
    noteUserInteraction()
    schedulePeriodicSave({ stats: { attack: { xp: 5 } } })
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(putSave).toHaveBeenCalledTimes(1)

    // Go idle: advance past the engagement window with no interaction. A
    // periodic tick with genuinely changed content must NOT write yet.
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    schedulePeriodicSave({ stats: { attack: { xp: 9 } } })
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(putSave).toHaveBeenCalledTimes(1)

    // Once an hour has elapsed since the last successful write, the backstop fires.
    await vi.advanceTimersByTimeAsync(HOUR_MS)
    schedulePeriodicSave({ stats: { attack: { xp: 12 } } })
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(putSave).toHaveBeenCalledTimes(2)
  })

  it('a fresh interaction re-engages the responsive cadence', async () => {
    noteUserInteraction()
    schedulePeriodicSave({ stats: { attack: { xp: 5 } } })
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(putSave).toHaveBeenCalledTimes(1)

    // Drift idle, then the player touches the screen again — next periodic tick
    // writes promptly rather than waiting out the hour.
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    noteUserInteraction()
    schedulePeriodicSave({ stats: { attack: { xp: 9 } } })
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(putSave).toHaveBeenCalledTimes(2)
  })
})
