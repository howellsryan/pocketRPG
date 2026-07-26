// A world tab left open behind the idle game holds this character's save lock
// forever — the socket stays healthy, so the server never starts the linger that
// releases it. The away watch turns "tab hidden" into a real departure.
import { describe, it, expect } from 'vitest'
import { AWAY_DISCONNECT_MS, createAwayWatch } from '../client/src/away'

function harness(delayMs = AWAY_DISCONNECT_MS) {
  let hidden = false
  const calls: string[] = []
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = []
  const watch = createAwayWatch({
    isHidden: () => hidden,
    depart: () => calls.push('depart'),
    resume: () => calls.push('resume'),
    delayMs,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms, cancelled: false })
      return timers.length - 1
    },
    clearTimer: (handle) => { timers[handle as number].cancelled = true },
  })
  return {
    watch,
    calls,
    timers,
    hide() { hidden = true; watch.onVisibilityChange() },
    show() { hidden = false; watch.onVisibilityChange() },
    /** Fires every armed timer that hasn't already run or been cancelled — the
     * tab stayed hidden for the full delay. */
    elapse() {
      for (const t of timers) {
        if (t.cancelled) continue
        t.cancelled = true
        t.fn()
      }
    },
  }
}

describe('away watch departs a backgrounded world tab', () => {
  it('leaves the world 10 seconds after the tab goes hidden', () => {
    const h = harness()
    h.hide()
    expect(h.timers[0].ms).toBe(10_000)
    expect(h.calls).toEqual([])
    h.elapse()
    expect(h.calls).toEqual(['depart'])
    expect(h.watch.isAway()).toBe(true)
  })

  it('does not depart when the player comes back before the delay', () => {
    const h = harness()
    h.hide()
    h.show()
    h.elapse()
    expect(h.calls).toEqual([])
    expect(h.watch.isAway()).toBe(false)
  })

  it('reconnects on return, but only when it actually departed', () => {
    const h = harness()
    h.hide()
    h.elapse()
    h.show()
    expect(h.calls).toEqual(['depart', 'resume'])
    expect(h.watch.isAway()).toBe(false)
    // A visibility event with nothing to resume must not reconnect.
    h.show()
    expect(h.calls).toEqual(['depart', 'resume'])
  })

  it('arms one timer per absence, and departs only once while away', () => {
    const h = harness()
    h.hide()
    h.hide()
    expect(h.timers).toHaveLength(1)
    h.elapse()
    h.hide()
    expect(h.timers).toHaveLength(1)
    expect(h.calls).toEqual(['depart'])
  })

  it('re-arms after a full away/return cycle', () => {
    const h = harness()
    h.hide()
    h.elapse()
    h.show()
    h.hide()
    expect(h.timers).toHaveLength(2)
    h.elapse()
    expect(h.calls).toEqual(['depart', 'resume', 'depart'])
  })
})
