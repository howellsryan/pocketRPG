import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const putSaveMock = vi.fn()

vi.mock('../src/cloud/api.js', () => ({
  SAVE_REVISION_EVENT: 'pocketrpg:cloud-save-revision',
  api: { putSave: (...args: unknown[]) => putSaveMock(...args), getSave: vi.fn() },
  getToken: () => 'token',
  getCharacterId: () => 123,
  setLocalCharacterId: vi.fn(),
}))

vi.mock('../src/db/saveload.js', () => ({
  buildSavePayloadFromSnapshot: (snapshot: unknown) => snapshot,
  applySavePayload: vi.fn(),
}))

vi.mock('../src/utils/helpers.js', async () => {
  const actual = await vi.importActual('../src/utils/helpers.js') as Record<string, unknown>
  return {
    ...actual,
    withTimeout: (p: Promise<unknown>) => p,
  }
})

describe('cloud sync save status events', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.resetModules()
    putSaveMock.mockReset()
    ;(globalThis as any).window = {
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
    ;(globalThis as any).CustomEvent = class {
      type: string
      detail: unknown
      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type
        this.detail = init?.detail
      }
    }
  })

  afterEach(() => {
    vi.useRealTimers()
    delete (globalThis as any).window
  })

  it('emits pending then saving then saved around successful putSave', async () => {
    putSaveMock.mockResolvedValue({ updatedAt: 12345 })
    const sync = await import('../src/cloud/sync.js')

    sync.schedulePushSave({ player: { name: 'Hero' } })
    expect(window.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.objectContaining({ status: 'pending' }) }))

    await vi.advanceTimersByTimeAsync(120_000)
    await vi.runAllTicks()

    const calls = (window.dispatchEvent as any).mock.calls.map((c: any[]) => c[0].detail.status)
    expect(calls).toEqual(expect.arrayContaining(['pending', 'saving', 'saved']))
    expect(calls.indexOf('saving')).toBeLessThan(calls.indexOf('saved'))
  })

  it('emits failed on putSave failure', async () => {
    putSaveMock.mockRejectedValue(new Error('boom'))
    const sync = await import('../src/cloud/sync.js')

    sync.schedulePushSave({ player: { name: 'Hero' } })
    await vi.advanceTimersByTimeAsync(120_000)
    await vi.runAllTicks()

    const calls = (window.dispatchEvent as any).mock.calls.map((c: any[]) => c[0].detail.status)
    expect(calls).toContain('saving')
    expect(calls).toContain('failed')
    expect(calls).not.toContain('saved')
  })

  it('escalates to a blocked state after consecutive failures', async () => {
    putSaveMock.mockRejectedValue(new Error('network down'))
    const sync = await import('../src/cloud/sync.js')

    sync.schedulePushSave({ player: { name: 'Hero' } })
    // First attempt fires after the debounce; each failure schedules an
    // escalating backoff retry (3s, 6s, …).
    await vi.advanceTimersByTimeAsync(120_000)
    await vi.runAllTicks()
    await vi.advanceTimersByTimeAsync(3_000)
    await vi.runAllTicks()
    await vi.advanceTimersByTimeAsync(6_000)
    await vi.runAllTicks()

    expect(putSaveMock).toHaveBeenCalledTimes(3)
    const calls = (window.dispatchEvent as any).mock.calls.map((c: any[]) => c[0].detail.status)
    // Soft 'failed' on the first couple, then a hard 'blocked'.
    expect(calls).toContain('failed')
    expect(calls).toContain('blocked')
    expect(calls).not.toContain('saved')
  })

  it('a successful retry after failures lifts the block (emits saved)', async () => {
    putSaveMock
      .mockRejectedValueOnce(new Error('down'))
      .mockRejectedValueOnce(new Error('down'))
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue({ updatedAt: 500 })
    const sync = await import('../src/cloud/sync.js')

    sync.schedulePushSave({ player: { name: 'Hero' } })
    await vi.advanceTimersByTimeAsync(120_000)
    await vi.runAllTicks()
    await vi.advanceTimersByTimeAsync(3_000)
    await vi.runAllTicks()
    await vi.advanceTimersByTimeAsync(6_000)
    await vi.runAllTicks()

    let calls = (window.dispatchEvent as any).mock.calls.map((c: any[]) => c[0].detail.status)
    expect(calls).toContain('blocked')

    // Manual retry from the modal — now the network is back.
    const ok = await sync.retrySaveNow({ player: { name: 'Hero' } })
    expect(ok).toBe(true)
    calls = (window.dispatchEvent as any).mock.calls.map((c: any[]) => c[0].detail.status)
    expect(calls).toContain('saved')
  })

  it('keeps the failed snapshot queued so a retry re-sends the same state', async () => {
    putSaveMock
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue({ updatedAt: 600 })
    const sync = await import('../src/cloud/sync.js')

    sync.schedulePushSave({ player: { name: 'Hero' }, rev: 7 })
    await vi.advanceTimersByTimeAsync(120_000)
    await vi.runAllTicks()
    // Backoff retry re-sends the SAME snapshot rather than dropping it.
    await vi.advanceTimersByTimeAsync(3_000)
    await vi.runAllTicks()

    expect(putSaveMock).toHaveBeenCalledTimes(2)
    const firstBody = JSON.parse(putSaveMock.mock.calls[0][0])
    const secondBody = JSON.parse(putSaveMock.mock.calls[1][0])
    expect(secondBody).toEqual(firstBody)
  })

  it('pushNow resolves true when the save lands (paid-skip durability gate)', async () => {
    putSaveMock.mockResolvedValue({ updatedAt: 999, save_revision: 4 })
    const sync = await import('../src/cloud/sync.js')
    const ok = await sync.pushNow({ player: { name: 'Hero' } })
    expect(ok).toBe(true)
  })

  it('pushNow resolves false when the save fails', async () => {
    putSaveMock.mockRejectedValue(new Error('network down'))
    const sync = await import('../src/cloud/sync.js')
    const ok = await sync.pushNow({ player: { name: 'Hero' } })
    expect(ok).toBe(false)
  })

  it('adopts the server save_revision from a completion so the next push is not a stale write', async () => {
    putSaveMock.mockResolvedValue({ updatedAt: 222, save_revision: 9 })
    const sync = await import('../src/cloud/sync.js')

    // An action completion (raid/boss/clue/skip) wrote the save server-side and
    // returned its authoritative revision. Without adopting it the client keeps
    // revision 0 and the next save is rejected 409 save_revision_conflict.
    await sync.applyCloudSave({ player: { name: 'Hero' } }, 100, 8)

    const ok = await sync.pushNow({ player: { name: 'Hero' } })
    expect(ok).toBe(true)
    expect(putSaveMock).toHaveBeenCalledTimes(1)
    expect(putSaveMock.mock.calls[0][1].saveRevision).toBe(8)
  })

  it('critical saves still coalesce before a single push', async () => {
    putSaveMock.mockResolvedValue({ updatedAt: 77 })
    const sync = await import('../src/cloud/sync.js')

    sync.requestCriticalPushSave(() => ({ id: 1 }), 'level_up')
    sync.requestCriticalPushSave(() => ({ id: 2 }), 'quest_complete')

    await vi.runOnlyPendingTimersAsync()
    await vi.runAllTicks()

    expect(putSaveMock).toHaveBeenCalledTimes(1)
    const calls = (window.dispatchEvent as any).mock.calls.map((c: any[]) => c[0].detail.status)
    expect(calls.filter((s: string) => s === 'pending').length).toBeGreaterThan(0)
    expect(calls).toContain('saving')
    expect(calls).toContain('saved')
  })

  it('can emit a new pending state immediately after saved for follow-up saves', async () => {
    putSaveMock.mockResolvedValue({ updatedAt: 100 })
    const sync = await import('../src/cloud/sync.js')

    sync.schedulePushSave({ player: { name: 'Hero' }, rev: 1 })
    await vi.advanceTimersByTimeAsync(120_000)
    await vi.runAllTicks()

    sync.schedulePushSave({ player: { name: 'Hero' }, rev: 2 })

    const calls = (window.dispatchEvent as any).mock.calls.map((c: any[]) => c[0].detail.status)
    const firstSavedIndex = calls.indexOf('saved')
    const pendingAfterSavedIndex = calls.findIndex((status: string, idx: number) => status === 'pending' && idx > firstSavedIndex)

    expect(firstSavedIndex).toBeGreaterThanOrEqual(0)
    expect(pendingAfterSavedIndex).toBeGreaterThan(firstSavedIndex)
  })

  it('emits conflict (not failed/blocked) on save_revision_conflict and stops retrying', async () => {
    // A 409 save_revision_conflict means local state diverged from the server.
    // Re-pushing the same stale snapshot only repeats the 409, so we must emit
    // 'conflict' (for the app to roll back), NOT count it toward the failure
    // streak, and NOT schedule a retry.
    putSaveMock.mockRejectedValue({ status: 409, body: { code: 'SAVE_REVISION_CONFLICT', current_revision: 5 } })
    const sync = await import('../src/cloud/sync.js')

    const ok = await sync.pushNow({ player: { name: 'Hero' } })
    expect(ok).toBe(false)

    const calls = (window.dispatchEvent as any).mock.calls.map((c: any[]) => c[0].detail.status)
    expect(calls).toContain('conflict')
    expect(calls).not.toContain('failed')
    expect(calls).not.toContain('blocked')

    // No backoff retry should be scheduled for a conflict.
    await vi.advanceTimersByTimeAsync(120_000)
    await vi.runAllTicks()
    expect(putSaveMock).toHaveBeenCalledTimes(1)
    expect(sync.isSaveConflict()).toBe(true)
  })

  it('short-circuits further pushes once a conflict is detected', async () => {
    putSaveMock.mockRejectedValue({ status: 409, body: { code: 'SAVE_REVISION_CONFLICT', current_revision: 5 } })
    const sync = await import('../src/cloud/sync.js')

    await sync.pushNow({ player: { name: 'Hero' } })
    expect(putSaveMock).toHaveBeenCalledTimes(1)

    // Subsequent pushNow / schedulePushSave must not hit the network — the app
    // is rolling back to the cloud copy.
    const second = await sync.pushNow({ player: { name: 'Hero' } })
    expect(second).toBe(false)
    sync.schedulePushSave({ player: { name: 'Hero' } })
    await vi.advanceTimersByTimeAsync(120_000)
    await vi.runAllTicks()
    expect(putSaveMock).toHaveBeenCalledTimes(1)
  })

  it('suspendSaves silences the autosave cadence and critical saves but pushNow still writes', async () => {
    putSaveMock.mockResolvedValue({ updatedAt: 1, save_revision: 2 })
    const sync = await import('../src/cloud/sync.js')

    sync.suspendSaves()
    sync.schedulePushSave({ player: { name: 'Hero' } })
    sync.requestCriticalPushSave(() => ({ player: { name: 'Hero' } }), 'level_up')
    await vi.advanceTimersByTimeAsync(120_000)
    await vi.runAllTicks()
    expect(putSaveMock).not.toHaveBeenCalled()

    // The owning operation's own authoritative write bypasses the gate.
    const ok = await sync.pushNow({ player: { name: 'Hero' } })
    expect(ok).toBe(true)
    expect(putSaveMock).toHaveBeenCalledTimes(1)

    // resumeSaves re-enables the background cadence. Use different content —
    // an identical snapshot would be (correctly) skipped by the dirty check.
    sync.resumeSaves()
    sync.schedulePushSave({ player: { name: 'Hero', hp: 50 } })
    await vi.advanceTimersByTimeAsync(120_000)
    await vi.runAllTicks()
    expect(putSaveMock).toHaveBeenCalledTimes(2)
  })

  it('resetSyncState clears suspension and conflict flags', async () => {
    putSaveMock.mockRejectedValueOnce({ status: 409, body: { code: 'SAVE_REVISION_CONFLICT', current_revision: 5 } })
    const sync = await import('../src/cloud/sync.js')

    await sync.pushNow({ player: { name: 'Hero' } })
    expect(sync.isSaveConflict()).toBe(true)

    sync.resetSyncState()
    expect(sync.isSaveConflict()).toBe(false)

    // After reset a normal push works again.
    putSaveMock.mockResolvedValue({ updatedAt: 9, save_revision: 1 })
    const ok = await sync.pushNow({ player: { name: 'Hero' } })
    expect(ok).toBe(true)
  })

  it('does not carry credits_used_increment on any save (server-debits via /api/skip-hour)', async () => {
    // Pre-step-1, the client attached creditsUsedIncrement:1 to the next
    // save after a skip-hour and the server bumped credits_used from
    // /api/save. That path is gone: credits_used is now incremented by
    // /api/skip-hour and /api/slayer/skip server-side, atomically, in
    // the same UPDATE that debits credits. The client must not set the
    // flag on any putSave call.
    putSaveMock
      .mockRejectedValueOnce({ status: 500, message: 'server_error' })
      .mockResolvedValueOnce({ updatedAt: 250 })
    const sync = await import('../src/cloud/sync.js')
    const { CRITICAL_SAVE_REASONS } = await import('../src/cloud/criticalSavePolicy.js')

    sync.requestCriticalPushSave(() => ({ player: { name: 'Hero' }, rev: 1 }), CRITICAL_SAVE_REASONS.SKIP_HOUR)
    await vi.runOnlyPendingTimersAsync()
    await vi.runAllTicks()

    sync.schedulePushSave({ player: { name: 'Hero' }, rev: 2 })
    await vi.advanceTimersByTimeAsync(120_000)
    await vi.runAllTicks()

    expect(putSaveMock).toHaveBeenCalledTimes(2)
    expect(putSaveMock.mock.calls[0][1]).not.toHaveProperty('creditsUsedIncrement')
    expect(putSaveMock.mock.calls[1][1]).not.toHaveProperty('creditsUsedIncrement')
  })
})
