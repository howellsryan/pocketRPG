// Client half of /api/bootstrap: the single-use primes, and the fallback that
// keeps a boot working against a server without the route.
//
// The primes exist because idle state and activity progress are read inside
// loadGame, which has five call sites — a boot-time snapshot replayed at one of
// the LATER ones (world return, conflict resolution) would resume a stale task
// and mis-measure the offline-idle window. Single use is what prevents that, so
// it is the property under test here.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { apiMock, session } = vi.hoisted(() => ({
  apiMock: {
    getBootstrap: vi.fn(),
    getIdle: vi.fn(),
    getActivityProgress: vi.fn(),
    getKillCounts: vi.fn(),
    getHardModeTargets: vi.fn(),
    putIdle: vi.fn(),
    putActivityProgress: vi.fn(),
  },
  session: { signedIn: true },
}))
vi.mock('../src/cloud/api.js', () => ({
  api: apiMock,
  getToken: () => (session.signedIn ? 'tok' : null),
  getCharacterId: () => (session.signedIn ? 5 : null),
}))

// activityProgress.js mirrors its ledger to localStorage; the node environment
// has none.
const store = new Map<string, string>()
;(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, String(v)) },
  removeItem: (k: string) => { store.delete(k) },
  clear: () => { store.clear() },
}

import { fetchBootstrap } from '../src/cloud/bootstrap.js'
import { fetchIdleState, resetIdleStateSync } from '../src/cloud/idleState.js'
import { fetchAndHydrateActivityProgress, getActivityProgress, resetActivityProgressSync } from '../src/cloud/activityProgress.js'

const PAYLOAD = {
  identity: { id: 1, remove_ads: false },
  character: { id: 5, credits: 42, is_ironman: false, is_one_life: false },
  stripe_links: {}, stripe_skus: {},
  killCounts: { entries: [
    { sourceType: 'monsters', sourceId: 'zaryth_the_shadowed', killCount: 9 },
    { sourceType: 'raids', sourceId: 'tomb_of_fire', killCount: 3 },
  ] },
  hardMode: { entries: [{ sourceType: 'monsters', sourceId: 'zaryth_the_shadowed' }] },
  idle: { idle: { lastActiveAt: 1234, activeTask: { type: 'skill', skill: 'mining' } }, serverNow: 9999 },
  activityProgress: { progress: { mining: { progressTicks: 12, totalTicks: 100 } } },
  dailyTasks: { date: '2026-08-05', resetInMs: 1000, tasks: [] },
}

beforeEach(() => {
  session.signedIn = true
  for (const fn of Object.values(apiMock)) fn.mockReset()
  resetIdleStateSync()
  resetActivityProgressSync()
  localStorage.clear()
})

describe('fetchBootstrap', () => {
  it('maps every mirror and primes the two that loadGame reads', async () => {
    apiMock.getBootstrap.mockResolvedValue(PAYLOAD)
    const boot = await fetchBootstrap()

    expect(boot!.killCounts).toEqual({
      bossKillCounts: { zaryth_the_shadowed: 9 },
      raidKillCounts: { tomb_of_fire: 3 },
    })
    expect(boot!.hardModeKeys).toEqual(['monsters:zaryth_the_shadowed'])
    expect(boot!.dailyTasks).toEqual(PAYLOAD.dailyTasks)
    expect(boot!.me.character.credits).toBe(42)

    // Served from the prime — no second request.
    expect(await fetchIdleState()).toEqual({
      lastActiveAt: 1234, activeTask: { type: 'skill', skill: 'mining' }, serverNow: 9999,
    })
    expect(apiMock.getIdle).not.toHaveBeenCalled()

    await fetchAndHydrateActivityProgress()
    expect(getActivityProgress('mining')).toMatchObject({ progressTicks: 12 })
    expect(apiMock.getActivityProgress).not.toHaveBeenCalled()
  })

  it('primes are SINGLE USE — a later loadGame refetches instead of replaying the boot snapshot', async () => {
    apiMock.getBootstrap.mockResolvedValue(PAYLOAD)
    await fetchBootstrap()
    await fetchIdleState()
    await fetchAndHydrateActivityProgress()

    apiMock.getIdle.mockResolvedValue({ idle: { lastActiveAt: 5555, activeTask: null }, serverNow: 6666 })
    apiMock.getActivityProgress.mockResolvedValue({ progress: { fishing: { progressTicks: 3 } } })

    expect(await fetchIdleState()).toMatchObject({ lastActiveAt: 5555 })
    expect(apiMock.getIdle).toHaveBeenCalledTimes(1)
    await fetchAndHydrateActivityProgress()
    expect(apiMock.getActivityProgress).toHaveBeenCalledTimes(1)
  })

  it('a character switch drops an unconsumed prime', async () => {
    apiMock.getBootstrap.mockResolvedValue(PAYLOAD)
    await fetchBootstrap()
    // Switch before loadGame ever ran — character B must not read A's row.
    resetIdleStateSync()
    resetActivityProgressSync()

    apiMock.getIdle.mockResolvedValue({ idle: { lastActiveAt: 777, activeTask: null }, serverNow: 888 })
    expect(await fetchIdleState()).toMatchObject({ lastActiveAt: 777 })
    expect(apiMock.getIdle).toHaveBeenCalledTimes(1)

    apiMock.getActivityProgress.mockResolvedValue({ progress: {} })
    await fetchAndHydrateActivityProgress()
    expect(apiMock.getActivityProgress).toHaveBeenCalledTimes(1)
    expect(getActivityProgress('mining')).toBeNull()
  })

  it('returns null on a server without the route, leaving the fan-out to run', async () => {
    apiMock.getBootstrap.mockRejectedValue(Object.assign(new Error('Not found'), { status: 404 }))
    expect(await fetchBootstrap()).toBeNull()
    // Nothing primed, so the legacy path still reaches the network.
    apiMock.getIdle.mockResolvedValue({ idle: { lastActiveAt: 1, activeTask: null }, serverNow: 2 })
    await fetchIdleState()
    expect(apiMock.getIdle).toHaveBeenCalledTimes(1)
  })

  it('refuses an identity-only answer rather than mapping empty mirrors over the real ones', async () => {
    // Character-scoped fields ABSENT is not the same as empty. Mapping them
    // would sync {} kill counts and wipe the Hard Mode mirror the combat
    // screen scales its auto-started boss from (§4).
    const { killCounts, hardMode, idle, activityProgress, ...identityOnly } = PAYLOAD
    apiMock.getBootstrap.mockResolvedValue({ ...identityOnly, character: null })
    expect(await fetchBootstrap()).toBeNull()
    // And nothing was primed off it.
    apiMock.getIdle.mockResolvedValue({ idle: { lastActiveAt: 3, activeTask: null }, serverNow: 4 })
    expect(await fetchIdleState()).toMatchObject({ lastActiveAt: 3 })
  })

  it('a prime the boot never consumed goes stale instead of surfacing much later', async () => {
    // The brand-new-character branch of initCloudAndSave returns before
    // loadGame ever runs (App.jsx: startNewGame -> markKillCountsLoaded ->
    // return), so the prime is left set. Single use bounds how MANY times it is
    // read, not how long it waits — and the next reader can be a world return
    // minutes later, which would resume a task the player has since changed and
    // measure the idle window against a boot-era serverNow.
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-05T12:00:00Z'))
      apiMock.getBootstrap.mockResolvedValue(PAYLOAD)
      await fetchBootstrap()

      vi.setSystemTime(new Date('2026-08-05T12:05:00Z'))
      apiMock.getIdle.mockResolvedValue({ idle: { lastActiveAt: 8888, activeTask: { type: 'skill', skill: 'fishing' } }, serverNow: 9000 })
      apiMock.getActivityProgress.mockResolvedValue({ progress: { fishing: { progressTicks: 3 } } })

      expect(await fetchIdleState()).toMatchObject({ lastActiveAt: 8888 })
      expect(apiMock.getIdle).toHaveBeenCalledTimes(1)

      await fetchAndHydrateActivityProgress()
      expect(apiMock.getActivityProgress).toHaveBeenCalledTimes(1)
      expect(getActivityProgress('fishing')).toMatchObject({ progressTicks: 3 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns null without a session rather than calling the endpoint', async () => {
    session.signedIn = false
    expect(await fetchBootstrap()).toBeNull()
    expect(apiMock.getBootstrap).not.toHaveBeenCalled()
  })

  it('treats an empty idle row the way /api/idle does', async () => {
    apiMock.getBootstrap.mockResolvedValue({ ...PAYLOAD, idle: { idle: null, serverNow: 4242 } })
    await fetchBootstrap()
    expect(await fetchIdleState()).toEqual({ lastActiveAt: null, activeTask: null, serverNow: 4242 })
    expect(apiMock.getIdle).not.toHaveBeenCalled()
  })
})
