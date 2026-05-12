import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const putSaveMock = vi.fn()

vi.mock('../src/cloud/api.js', () => ({
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
})
