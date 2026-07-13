import { describe, it, expect, vi } from 'vitest'

const resetOneLifeMock = vi.fn()

vi.mock('../src/cloud/api.js', () => ({
  api: { resetOneLife: (...a: unknown[]) => resetOneLifeMock(...a) },
}))

import { isAlreadyReset, resetOneLifeWithRetry } from '../src/utils/oneLifeDeath.js'

const instantSleep = () => Promise.resolve()

describe('isAlreadyReset', () => {
  it('treats 404 and "not found" / "not one-life" as already reverted', () => {
    expect(isAlreadyReset({ status: 404 })).toBe(true)
    expect(isAlreadyReset(new Error('Character not found'))).toBe(true)
    expect(isAlreadyReset(new Error('Character is not one-life'))).toBe(true)
    expect(isAlreadyReset({ status: 400, message: 'Character is not one-life' })).toBe(true)
  })

  it('does NOT treat a bare 400 (missing X-Character-Id header) as already reverted', () => {
    expect(isAlreadyReset({ status: 400 })).toBe(false)
    expect(isAlreadyReset({ status: 400, message: 'Missing X-Character-Id header' })).toBe(false)
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

  it('stops immediately when the server reports the flag was already reverted', async () => {
    const doReset = vi.fn().mockRejectedValue({ status: 404, message: 'Character not found' })
    await resetOneLifeWithRetry({ doReset, sleep: instantSleep })
    expect(doReset).toHaveBeenCalledTimes(1)
  })

  it('throws after exhausting all attempts on persistent transient failure', async () => {
    const doReset = vi.fn().mockRejectedValue({ status: 500 })
    await expect(resetOneLifeWithRetry({ doReset, sleep: instantSleep, attempts: 3 })).rejects.toBeTruthy()
    expect(doReset).toHaveBeenCalledTimes(3)
  })

  it('defaults to calling api.resetOneLife()', async () => {
    resetOneLifeMock.mockResolvedValue(undefined)
    await resetOneLifeWithRetry({ sleep: instantSleep })
    expect(resetOneLifeMock).toHaveBeenCalledTimes(1)
  })
})
