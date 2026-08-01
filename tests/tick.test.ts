import { describe, it, expect, vi, afterEach } from 'vitest'
import { onTick, startTicks, stopTicks, pauseTicks, resumeTicks, resetTicks, getTickCount, holdTicks, releaseTicks, SKIP_CONFIRM_HOLD } from '../src/engine/tick'

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

  it('keeps ticks stopped while a named hold is taken, even when another owner calls resumeTicks', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    onTick(fn)
    startTicks()

    // The loot modal pauses; the skip-confirm prompt takes its own hold.
    pauseTicks()
    holdTicks(SKIP_CONFIRM_HOLD)
    // ...then the loot modal closes and its effect cleanup resumes.
    resumeTicks()

    const held = fn.mock.calls.length
    vi.advanceTimersByTime(3000)
    expect(fn).toHaveBeenCalledTimes(held)

    releaseTicks(SKIP_CONFIRM_HOLD)
    vi.advanceTimersByTime(600)
    expect(fn.mock.calls.length).toBeGreaterThan(held)
  })

  it('releases a hold only for the key that took it', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    onTick(fn)
    startTicks()

    holdTicks(SKIP_CONFIRM_HOLD)
    releaseTicks('some-other-owner')
    const held = fn.mock.calls.length
    vi.advanceTimersByTime(1200)
    expect(fn).toHaveBeenCalledTimes(held)

    releaseTicks(SKIP_CONFIRM_HOLD)
    vi.advanceTimersByTime(600)
    expect(fn.mock.calls.length).toBeGreaterThan(held)
  })

  it('drops outstanding holds when the loop is torn down, so a new session cannot boot frozen', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    onTick(fn)
    startTicks()
    holdTicks(SKIP_CONFIRM_HOLD)
    stopTicks()

    startTicks()
    vi.advanceTimersByTime(1200)
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})
