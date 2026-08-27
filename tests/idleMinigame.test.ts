import { describe, expect, it } from 'vitest'
import { advanceMinigameOffline } from '../src/engine/idleEngine.js'
import minigamesData from '../src/data/minigames.json'

const HOUR_MS = 60 * 60 * 1000

function minigameTask(overrides: Record<string, any> = {}) {
  const mg = { id: 'at_tomb_of_fire', name: 'Stoke the Autumntodt Brazier', ticks: 30_000, product: 'tomb_of_fire', minigame: 'autumntodt' }
  return { type: 'minigame', minigameTask: mg, totalTicks: mg.ticks, ticksRemaining: mg.ticks, ...overrides }
}

describe('advanceMinigameOffline', () => {
  it('spends an offline window against the countdown instead of leaving it untouched', () => {
    const adv = advanceMinigameOffline(minigameTask(), 2 * HOUR_MS)
    expect(adv.completed).toBe(false)
    expect(adv.ticksRemaining).toBe(30_000 - 12_000)
    expect(adv.task.ticksRemaining).toBe(18_000)
  })

  it('finishes a 5h minigame left running overnight', () => {
    const adv = advanceMinigameOffline(minigameTask(), 8 * HOUR_MS)
    expect(adv.completed).toBe(true)
    expect(adv.ticksRemaining).toBe(0)
  })

  it('reports completion exactly when the last tick is spent, not a tick early', () => {
    const almost = advanceMinigameOffline(minigameTask({ ticksRemaining: 10 }), 9 * 600)
    expect(almost.completed).toBe(false)
    expect(almost.ticksRemaining).toBe(1)
    const exact = advanceMinigameOffline(minigameTask({ ticksRemaining: 10 }), 10 * 600)
    expect(exact.completed).toBe(true)
    expect(exact.ticksRemaining).toBe(0)
  })

  it('parks a finished minigame at 0 ticks so the caller can grant its rewards', () => {
    // The boot loader can't grant (no server completion call / collection log
    // there), so the task must survive as a 0-tick task the live tick finishes —
    // never be reported as cleared.
    const adv = advanceMinigameOffline(minigameTask(), 24 * HOUR_MS)
    expect(adv.task).not.toBeNull()
    expect(adv.task.type).toBe('minigame')
    expect(adv.task.minigameTask.id).toBe('at_tomb_of_fire')
    expect(adv.task.ticksRemaining).toBe(0)
  })

  it('carries progress already made rather than restarting from the full duration', () => {
    const adv = advanceMinigameOffline(minigameTask({ ticksRemaining: 6_000 }), 30 * 60 * 1000)
    expect(adv.ticksRemaining).toBe(3_000)
    expect(adv.totalTicks).toBe(30_000)
  })

  it('leaves the task untouched for a window shorter than one tick', () => {
    const task = minigameTask()
    const adv = advanceMinigameOffline(task, 400)
    expect(adv.ticksRemaining).toBe(30_000)
    expect(adv.completed).toBe(false)
  })

  it('treats a negative or garbage elapsed window as no time passing', () => {
    expect(advanceMinigameOffline(minigameTask(), -HOUR_MS).ticksRemaining).toBe(30_000)
    expect(advanceMinigameOffline(minigameTask(), NaN as any).ticksRemaining).toBe(30_000)
  })

  it('falls back to the task definition when a legacy saved task has no totalTicks', () => {
    const legacy = { type: 'minigame', minigameTask: { id: 'at_tomb_of_fire', ticks: 30_000 } }
    const adv = advanceMinigameOffline(legacy, HOUR_MS)
    expect(adv.totalTicks).toBe(30_000)
    expect(adv.ticksRemaining).toBe(24_000)
  })

  it('ignores a task that is not a minigame', () => {
    const combat = { type: 'combat', monster: { id: 'cow' } }
    const adv = advanceMinigameOffline(combat, HOUR_MS)
    expect(adv.completed).toBe(false)
    expect(adv.task).toBe(combat)
  })

  it('completes every shipped minigame inside the 24h offline cap', () => {
    const CAP_MS = 24 * HOUR_MS
    for (const task of (minigamesData as any).tasks) {
      const adv = advanceMinigameOffline({ type: 'minigame', minigameTask: task, totalTicks: task.ticks, ticksRemaining: task.ticks }, CAP_MS)
      expect(adv.completed, `${task.id} cannot finish within one offline window`).toBe(true)
    }
  })
})

describe('advanceMinigameOffline on malformed saved tasks', () => {
  it('never reports a minigame with no duration as finished', () => {
    // A save pointing at a minigame that no longer exists has no `ticks` to
    // count down. Calling that "complete" would park it at 0 for the live tick
    // to grant in full, for free.
    for (const broken of [
      { type: 'minigame', minigameTask: { id: 'ghost' } },
      { type: 'minigame', minigameTask: { id: 'ghost', ticks: null } },
      { type: 'minigame', minigameTask: { id: 'ghost', ticks: 'soon' } },
      { type: 'minigame', minigameTask: { id: 'ghost', ticks: NaN } },
    ] as any[]) {
      const adv = advanceMinigameOffline(broken, 24 * HOUR_MS)
      expect(adv.completed, `${JSON.stringify(broken.minigameTask)} reported complete`).toBe(false)
      expect(adv.task).toBe(broken)
    }
  })

  it('still counts down from ticksRemaining when only totalTicks is missing', () => {
    const adv = advanceMinigameOffline({ type: 'minigame', minigameTask: { id: 'ghost' }, ticksRemaining: 6_000 } as any, HOUR_MS)
    expect(adv.completed).toBe(true)
    expect(adv.totalTicks).toBe(6_000)
  })
})
