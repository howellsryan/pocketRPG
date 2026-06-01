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

    await vi.advanceTimersByTimeAsync(60_000)
    await vi.runAllTicks()

    const calls = (window.dispatchEvent as any).mock.calls.map((c: any[]) => c[0].detail.status)
    expect(calls).toEqual(expect.arrayContaining(['pending', 'saving', 'saved']))
    expect(calls.indexOf('saving')).toBeLessThan(calls.indexOf('saved'))
  })

  it('emits failed on putSave failure', async () => {
    putSaveMock.mockRejectedValue(new Error('boom'))
    const sync = await import('../src/cloud/sync.js')

    sync.schedulePushSave({ player: { name: 'Hero' } })
    await vi.advanceTimersByTimeAsync(60_000)
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
    await vi.advanceTimersByTimeAsync(60_000)
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
    await vi.advanceTimersByTimeAsync(60_000)
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
    await vi.advanceTimersByTimeAsync(60_000)
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
    await vi.advanceTimersByTimeAsync(60_000)
    await vi.runAllTicks()

    sync.schedulePushSave({ player: { name: 'Hero' }, rev: 2 })

    const calls = (window.dispatchEvent as any).mock.calls.map((c: any[]) => c[0].detail.status)
    const firstSavedIndex = calls.indexOf('saved')
    const pendingAfterSavedIndex = calls.findIndex((status: string, idx: number) => status === 'pending' && idx > firstSavedIndex)

    expect(firstSavedIndex).toBeGreaterThanOrEqual(0)
    expect(pendingAfterSavedIndex).toBeGreaterThan(firstSavedIndex)
  })

  it('does not carry credits_used_increment on any save (server-debits via /api/skip-hour)', async () => {
    // Pre-step-1, the client attached creditsUsedIncrement:1 to the next
    // save after a skip-hour and the server bumped credits_used from
    // /api/save. That path is gone: credits_used is now incremented by
    // /api/skip-hour and /api/slayer/skip server-side, atomically, in
    // the same UPDATE that debits credits. The client must not set the
    // flag on any putSave call.
    putSaveMock
      .mockRejectedValueOnce({ status: 403, message: 'protected_state_delta_rejected' })
      .mockResolvedValueOnce({ updatedAt: 250 })
    const sync = await import('../src/cloud/sync.js')
    const { CRITICAL_SAVE_REASONS } = await import('../src/cloud/criticalSavePolicy.js')

    sync.requestCriticalPushSave(() => ({ player: { name: 'Hero' }, rev: 1 }), CRITICAL_SAVE_REASONS.SKIP_HOUR)
    await vi.runOnlyPendingTimersAsync()
    await vi.runAllTicks()

    sync.schedulePushSave({ player: { name: 'Hero' }, rev: 2 })
    await vi.advanceTimersByTimeAsync(60_000)
    await vi.runAllTicks()

    expect(putSaveMock).toHaveBeenCalledTimes(2)
    expect(putSaveMock.mock.calls[0][1]).not.toHaveProperty('creditsUsedIncrement')
    expect(putSaveMock.mock.calls[1][1]).not.toHaveProperty('creditsUsedIncrement')
  })
})
