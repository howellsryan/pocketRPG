import { describe, it, expect, beforeEach, vi } from 'vitest'

// Regression guard for the character_idle_state write amplifier: setActiveTask
// pushes the task to PUT /api/idle on every task (re)start, and the combat
// "Fight again" loop restarts the SAME task after every kill — so a grind was
// one D1 upsert per kill. pushIdleState must dedupe pushes whose task IDENTITY
// (volatile per-tick progress stripped) matches the last successful push; the
// /api/save path stamps last_active_at + active_task on every real save, so a
// same-identity idle PUT buys nothing.

const putIdleMock = vi.fn()

vi.mock('../src/cloud/api.js', () => ({
  api: { putIdle: (...args: unknown[]) => putIdleMock(...args), getIdle: vi.fn() },
  sendIdleBeacon: vi.fn(),
  getToken: () => 'token',
  getCharacterId: () => 123,
}))

vi.mock('../src/utils/helpers.js', async () => {
  const actual = await vi.importActual('../src/utils/helpers.js') as Record<string, unknown>
  return { ...actual, withTimeout: (p: Promise<unknown>) => p }
})

async function loadModule() {
  vi.resetModules()
  return await import('../src/cloud/idleState.js')
}

const combatTask = (extra: Record<string, unknown> = {}) => ({
  type: 'combat',
  monster: { id: 'goblin', name: 'Goblin' },
  stance: 'accurate',
  bankingEnabled: true,
  spell: null,
  ...extra,
})

describe('pushIdleState identity dedupe', () => {
  beforeEach(() => {
    putIdleMock.mockReset()
    putIdleMock.mockResolvedValue({ ok: true })
  })

  it('skips a re-push of the same task identity (per-kill fight restart)', async () => {
    const { pushIdleState } = await loadModule()
    await pushIdleState(combatTask())
    await pushIdleState(combatTask())
    await pushIdleState(combatTask())
    expect(putIdleMock).toHaveBeenCalledTimes(1)
  })

  it('ignores volatile per-tick progress fields when comparing identity', async () => {
    const { pushIdleState } = await loadModule()
    await pushIdleState(combatTask({ ticksRemaining: 10, totalTicks: 12, session: { xp: 5 } }))
    await pushIdleState(combatTask({ ticksRemaining: 3, totalTicks: 12, session: { xp: 50 } }))
    expect(putIdleMock).toHaveBeenCalledTimes(1)
  })

  it('pushes again when the task identity changes (start/stop/switch)', async () => {
    const { pushIdleState } = await loadModule()
    await pushIdleState(combatTask())
    await pushIdleState(null) // stopped
    await pushIdleState(combatTask()) // restarted after a stop
    await pushIdleState({ type: 'skill', skill: 'woodcutting', action: { id: 'oak' } })
    expect(putIdleMock).toHaveBeenCalledTimes(4)
  })

  it('does not record identity on a failed push, so the retry still goes out', async () => {
    const { pushIdleState } = await loadModule()
    putIdleMock.mockRejectedValueOnce(new Error('network'))
    await pushIdleState(combatTask())
    await pushIdleState(combatTask())
    expect(putIdleMock).toHaveBeenCalledTimes(2)
  })

  it('resetIdleStateSync clears the identity (logout / character switch)', async () => {
    const { pushIdleState, resetIdleStateSync } = await loadModule()
    await pushIdleState(combatTask())
    resetIdleStateSync()
    await pushIdleState(combatTask())
    expect(putIdleMock).toHaveBeenCalledTimes(2)
  })

  it('taskIdentityKey treats no-task as a distinct stable identity', async () => {
    const { taskIdentityKey } = await loadModule()
    expect(taskIdentityKey(null)).toBe('none')
    expect(taskIdentityKey(undefined)).toBe('none')
    expect(taskIdentityKey(combatTask({ ticksRemaining: 1 }))).toBe(taskIdentityKey(combatTask({ ticksRemaining: 9 })))
    expect(taskIdentityKey(combatTask())).not.toBe(taskIdentityKey({ ...combatTask(), stance: 'aggressive' }))
  })
})
