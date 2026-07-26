// The client side of the co-op save lock.
//
// The bug this guards: entering a group boss fight failed with a save error.
// Two halves, both here — a lock-refused push must not be mistaken for a failed
// save by the join flow (the lock IS the server saying it already owns this
// character), and it must not stay queued, because the pre-fight snapshot
// landing after the room's write-back costs the player the whole fight.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { saveLockCode } from '../src/cloud/saveErrors.js'

const putSaveMock = vi.fn()

vi.mock('../src/cloud/api.js', () => ({
  SAVE_REVISION_EVENT: 'pocketrpg:cloud-save-revision',
  api: { putSave: (...args: unknown[]) => putSaveMock(...args), getSave: vi.fn() },
  getToken: () => 'token',
  getCharacterId: () => 123,
  setLocalCharacterId: vi.fn(),
  sendSaveBeacon: vi.fn(),
  emitSaveRevision: vi.fn(),
}))

vi.mock('../src/db/saveload.js', () => ({
  buildSavePayloadFromSnapshot: (snapshot: unknown) => snapshot,
  applySavePayload: vi.fn(),
}))

vi.mock('../src/utils/helpers.js', async () => {
  const actual = await vi.importActual('../src/utils/helpers.js') as Record<string, unknown>
  return { ...actual, withTimeout: (p: Promise<unknown>) => p }
})

const lockError = (code: string) => Object.assign(new Error(code.toLowerCase()), {
  status: 409,
  body: { code, error: code.toLowerCase() },
})

describe('saveLockCode', () => {
  it('names the lock that refused the write', () => {
    expect(saveLockCode(lockError('CHARACTER_IN_COOP_SESSION'))).toBe('CHARACTER_IN_COOP_SESSION')
    expect(saveLockCode({ status: 409, body: { error: 'character_in_world_session' } })).toBe('CHARACTER_IN_WORLD_SESSION')
    expect(saveLockCode({ status: 409, message: 'character_in_active_match' })).toBe('CHARACTER_IN_ACTIVE_MATCH')
  })

  it('is null for anything that is not a lock', () => {
    expect(saveLockCode({ status: 409, body: { code: 'SAVE_REVISION_CONFLICT' } })).toBe(null)
    expect(saveLockCode({ status: 500 })).toBe(null)
    expect(saveLockCode(null)).toBe(null)
  })
})

describe('a push refused by the co-op lock', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    putSaveMock.mockReset()
    ;(globalThis as any).window = { dispatchEvent: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }
    ;(globalThis as any).CustomEvent = class {
      type: string
      detail: unknown
      constructor(type: string, init?: { detail?: unknown }) { this.type = type; this.detail = init?.detail }
    }
  })

  afterEach(() => {
    vi.useRealTimers()
    delete (globalThis as any).window
  })

  it('reports the lock code so the join flow can tell it from a failed save', async () => {
    putSaveMock.mockRejectedValue(lockError('CHARACTER_IN_COOP_SESSION'))
    const sync = await import('../src/cloud/sync.js')

    expect(await sync.pushNow({ player: { name: 'Hero' } })).toBe(false)
    expect(sync.lastSaveLockCode()).toBe('CHARACTER_IN_COOP_SESSION')
  })

  it('drops the snapshot instead of re-sending it once the lock lifts', async () => {
    putSaveMock.mockRejectedValue(lockError('CHARACTER_IN_COOP_SESSION'))
    const sync = await import('../src/cloud/sync.js')

    await sync.pushNow({ player: { name: 'Hero' }, stats: { attack: { xp: 1 } } })
    expect(putSaveMock).toHaveBeenCalledTimes(1)

    // The fight ends and the lock lifts. Nothing may go back out on its own —
    // the client pulls the server's copy on exit, it never pushes its own.
    putSaveMock.mockResolvedValue({ updatedAt: 1, save_revision: 9 })
    await vi.advanceTimersByTimeAsync(120_000)
    await vi.runAllTicks()
    expect(putSaveMock).toHaveBeenCalledTimes(1)
  })

  it('still queues and retries a PvP lock, which owns no write-back of its own', async () => {
    putSaveMock.mockRejectedValueOnce(lockError('CHARACTER_IN_ACTIVE_MATCH'))
    const sync = await import('../src/cloud/sync.js')

    await sync.pushNow({ player: { name: 'Hero' } })
    expect(putSaveMock).toHaveBeenCalledTimes(1)

    putSaveMock.mockResolvedValue({ updatedAt: 1, save_revision: 9 })
    await vi.advanceTimersByTimeAsync(10_000)
    await vi.runAllTicks()
    expect(putSaveMock).toHaveBeenCalledTimes(2)
  })

  it('clears the lock code once a push lands', async () => {
    putSaveMock.mockRejectedValueOnce(lockError('CHARACTER_IN_COOP_SESSION'))
    const sync = await import('../src/cloud/sync.js')
    await sync.pushNow({ player: { name: 'Hero' } })
    expect(sync.lastSaveLockCode()).toBe('CHARACTER_IN_COOP_SESSION')

    putSaveMock.mockResolvedValue({ updatedAt: 2, save_revision: 4 })
    expect(await sync.pushNow({ player: { name: 'Hero 2' } })).toBe(true)
    expect(sync.lastSaveLockCode()).toBe(null)
  })
})
