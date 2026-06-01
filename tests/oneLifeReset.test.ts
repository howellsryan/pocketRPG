import { describe, it, expect, vi, beforeEach } from 'vitest'

const resetOneLifeMock = vi.fn()
const deleteSaveMock = vi.fn()
const deleteIdleMock = vi.fn()
const clearAuthMock = vi.fn()
const closeDBMock = vi.fn()
const wipeLocalSaveMock = vi.fn()
const setLocalCharacterIdMock = vi.fn()
let tokenValue: string | null = 'token'

vi.mock('../src/cloud/api.js', () => ({
  api: {
    resetOneLife: (...a: unknown[]) => resetOneLifeMock(...a),
    deleteSave: (...a: unknown[]) => deleteSaveMock(...a),
    deleteIdle: (...a: unknown[]) => deleteIdleMock(...a),
  },
  clearAuth: () => clearAuthMock(),
  getToken: () => tokenValue,
  setLocalCharacterId: (...a: unknown[]) => setLocalCharacterIdMock(...a),
}))

vi.mock('../src/db/database.js', () => ({ closeDB: () => closeDBMock() }))
vi.mock('../src/db/saveload.js', () => ({ wipeLocalSave: () => wipeLocalSaveMock() }))

import {
  isAlreadyReset,
  resetOneLifeWithRetry,
  performOneLifeReset,
} from '../src/utils/oneLifeDeath.js'

const instantSleep = () => Promise.resolve()

beforeEach(() => {
  vi.clearAllMocks()
  tokenValue = 'token'
  // jsdom-free env: provide the globals the reset touches.
  ;(globalThis as any).localStorage = { removeItem: vi.fn() }
})

describe('isAlreadyReset', () => {
  it('treats 404 / 400 and "not found" / "not one-life" as already reset', () => {
    expect(isAlreadyReset({ status: 404 })).toBe(true)
    expect(isAlreadyReset({ status: 400 })).toBe(true)
    expect(isAlreadyReset(new Error('Character not found'))).toBe(true)
    expect(isAlreadyReset(new Error('Character is not one-life'))).toBe(true)
  })

  it('treats transient errors (timeout / 500) as retryable', () => {
    expect(isAlreadyReset({ status: 0, message: 'request_timeout' })).toBe(false)
    expect(isAlreadyReset({ status: 500, message: 'Request failed (500)' })).toBe(false)
  })
})

describe('resetOneLifeWithRetry', () => {
  it('succeeds on the first attempt', async () => {
    const doReset = vi.fn().mockResolvedValue(undefined)
    await resetOneLifeWithRetry({ doReset, sleep: instantSleep })
    expect(doReset).toHaveBeenCalledTimes(1)
  })

  it('retries transient failures then succeeds', async () => {
    const doReset = vi.fn()
      .mockRejectedValueOnce({ status: 500 })
      .mockRejectedValueOnce({ status: 0 })
      .mockResolvedValueOnce(undefined)
    await resetOneLifeWithRetry({ doReset, sleep: instantSleep })
    expect(doReset).toHaveBeenCalledTimes(3)
  })

  it('stops immediately when the server reports the reset already happened', async () => {
    const doReset = vi.fn().mockRejectedValue({ status: 404, message: 'Character not found' })
    await resetOneLifeWithRetry({ doReset, sleep: instantSleep })
    expect(doReset).toHaveBeenCalledTimes(1)
  })

  it('throws after exhausting all attempts on persistent transient failure', async () => {
    const doReset = vi.fn().mockRejectedValue({ status: 500 })
    await expect(resetOneLifeWithRetry({ doReset, sleep: instantSleep, attempts: 3 })).rejects.toBeTruthy()
    expect(doReset).toHaveBeenCalledTimes(3)
  })
})

describe('performOneLifeReset', () => {
  it('uses the atomic reset and NEVER the partial deleteSave/deleteIdle fallback', async () => {
    resetOneLifeMock.mockResolvedValue(undefined)
    await performOneLifeReset()
    expect(resetOneLifeMock).toHaveBeenCalledTimes(1)
    expect(deleteSaveMock).not.toHaveBeenCalled()
    expect(deleteIdleMock).not.toHaveBeenCalled()
  })

  it('wipes local state and clears auth only after the server reset succeeds', async () => {
    resetOneLifeMock.mockResolvedValue(undefined)
    await performOneLifeReset()
    expect(closeDBMock).toHaveBeenCalled()
    expect(wipeLocalSaveMock).toHaveBeenCalled()
    expect(clearAuthMock).toHaveBeenCalled()
  })

  it('does not wipe local state when the server reset can never complete', async () => {
    vi.useFakeTimers()
    resetOneLifeMock.mockRejectedValue({ status: 500 })
    const assertion = expect(performOneLifeReset()).rejects.toBeTruthy()
    await vi.runAllTimersAsync() // flush the exponential backoff sleeps
    await assertion
    expect(wipeLocalSaveMock).not.toHaveBeenCalled()
    expect(clearAuthMock).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('skips the server call for offline/local-only players (no token)', async () => {
    tokenValue = null
    await performOneLifeReset()
    expect(resetOneLifeMock).not.toHaveBeenCalled()
    expect(wipeLocalSaveMock).toHaveBeenCalled()
    expect(clearAuthMock).toHaveBeenCalled()
  })
})
