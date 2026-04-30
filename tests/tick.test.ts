import { describe, it, expect, vi, afterEach } from 'vitest'
import { onTick, startTicks, stopTicks, pauseTicks, resumeTicks, resetTicks, getTickCount } from '../src/engine/tick'

afterEach(() => {
  stopTicks()
  resetTicks()
  vi.useRealTimers()
})

describe('tick engine', () => {
  it('start/pause/resume/stop/reset works with listeners', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const unsubscribe = onTick(fn)

    startTicks()
    vi.advanceTimersByTime(1200)
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(2)

    pauseTicks()
    const pausedCount = fn.mock.calls.length
    vi.advanceTimersByTime(1200)
    expect(fn).toHaveBeenCalledTimes(pausedCount)

    resumeTicks()
    vi.advanceTimersByTime(600)
    expect(fn.mock.calls.length).toBeGreaterThan(pausedCount)

    unsubscribe()
    const beforeUnsubTick = fn.mock.calls.length
    vi.advanceTimersByTime(600)
    expect(fn).toHaveBeenCalledTimes(beforeUnsubTick)

    stopTicks()
    const stopCount = getTickCount()
    vi.advanceTimersByTime(1200)
    expect(getTickCount()).toBe(stopCount)

    resetTicks()
    expect(getTickCount()).toBe(0)
  })
})
