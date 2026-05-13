import { describe, it, expect, vi } from 'vitest'
import { completeMinigameTask, buildMinigameNonce } from '../src/cloud/minigameCompletion.js'

type CallLog = string[]

interface BuildDepsOptions {
  isCloud?: boolean
  completeResult?: any
  completeError?: any
  pullSaveResult?: any
}

function buildDeps(log: CallLog, opts: BuildDepsOptions = {}) {
  const {
    isCloud = true,
    completeResult = {
      save: { save_data: JSON.stringify({ settings: { unlockedMinigameItems: ['fighter_hat'] } }), updatedAt: 123 },
      collectionLogEntries: [{ itemId: 'fighter_hat', sourceType: 'minigames', sourceId: 'ba_fighter_hat' }],
      granted: [{ itemId: 'fighter_hat', quantity: 1 }],
    },
    completeError = null,
    pullSaveResult = null,
  } = opts

  return {
    isCloudAuthoritative: () => isCloud,
    api: {
      completeMinigame: vi.fn(async (sourceId: string, payload: any) => {
        log.push(`api.completeMinigame:${sourceId}:${payload?.actionNonce}`)
        if (completeError) throw completeError
        return completeResult
      }),
    },
    applyCloudSave: vi.fn(async () => { log.push('applyCloudSave') }),
    loadGame: vi.fn(async () => { log.push('loadGame') }),
    pullSave: vi.fn(async () => { log.push('pullSave'); return pullSaveResult }),
    applyServerCollectionLogEntries: vi.fn((entries: any[]) => {
      log.push(`applyServerCollectionLogEntries:${entries.length}`)
    }),
    setActiveTask: vi.fn(() => { log.push('setActiveTask:null') }),
    activeTaskRef: { current: { sentinel: true } as any },
    removeLocalActiveTask: vi.fn(() => { log.push('removeLocalActiveTask') }),
    grantMinigameTaskRewards: vi.fn(() => { log.push('grantMinigameTaskRewards') }),
    requestCriticalPushSave: vi.fn((_factory: any, reason: string) => {
      log.push(`requestCriticalPushSave:${reason}`)
      return true
    }),
    getSnapshot: () => ({ settings: {} }),
    addToast: vi.fn((msg: string) => { log.push(`addToast:${msg}`) }),
    isInPvpMatch: false,
    inFlightSet: new Set<string>(),
    onWarn: vi.fn(),
  }
}

describe('completeMinigameTask — cloud-authoritative ordering', () => {
  it('runs /complete -> applyCloudSave -> loadGame -> removeLocalActiveTask -> requestCriticalPushSave, in that order', async () => {
    const log: CallLog = []
    const deps = buildDeps(log)
    const task = { id: 'ba_fighter_hat', name: 'Fighter Hat' }
    const wrapper = { startedAt: 1234 }

    const res = await completeMinigameTask({ task, taskWrapper: wrapper, deps })

    expect(res.status).toBe('success')
    expect(deps.api.completeMinigame).toHaveBeenCalledTimes(1)
    expect(deps.requestCriticalPushSave).toHaveBeenCalledTimes(1)

    const completeIdx = log.findIndex(e => e.startsWith('api.completeMinigame:'))
    const applyIdx = log.indexOf('applyCloudSave')
    const loadIdx = log.indexOf('loadGame')
    const removeIdx = log.indexOf('removeLocalActiveTask')
    const pushIdx = log.findIndex(e => e.startsWith('requestCriticalPushSave:'))
    expect(completeIdx).toBeGreaterThan(-1)
    expect(applyIdx).toBeGreaterThan(completeIdx)
    expect(loadIdx).toBeGreaterThan(applyIdx)
    expect(removeIdx).toBeGreaterThan(loadIdx)
    // The post-complete save must happen strictly AFTER applyCloudSave so the
    // snapshot factory has unlockedMinigameItems in React state.
    expect(pushIdx).toBeGreaterThan(applyIdx)
  })

  it('passes the getSnapshot thunk (not a captured value) to requestCriticalPushSave so the snapshot reads post-render state', async () => {
    const log: CallLog = []
    const deps = buildDeps(log)
    await completeMinigameTask({
      task: { id: 'ba_fighter_hat' },
      taskWrapper: { startedAt: 1 },
      deps,
    })
    const [factory, reason] = (deps.requestCriticalPushSave as any).mock.calls[0]
    expect(factory).toBe(deps.getSnapshot)
    expect(reason).toBe('minigame_complete')
  })

  it('clears React state synchronously to stop tick re-fire, before awaiting /complete', async () => {
    const log: CallLog = []
    let resolveComplete: (v: any) => void = () => {}
    const deps = buildDeps(log)
    deps.api.completeMinigame = vi.fn(() => new Promise(r => { resolveComplete = r }))

    const promise = completeMinigameTask({
      task: { id: 'ba_fighter_hat' },
      taskWrapper: { startedAt: 99 },
      deps,
    })

    // Synchronous side effects must have happened before the await resolves.
    expect(deps.setActiveTask).toHaveBeenCalledWith(null)
    expect(deps.activeTaskRef.current).toBeNull()

    resolveComplete({ save: null })
    await promise
  })

  it('uses a stable per-instance actionNonce derived from taskWrapper.startedAt', async () => {
    const log1: CallLog = []
    const log2: CallLog = []
    const deps1 = buildDeps(log1)
    const deps2 = buildDeps(log2)
    const task = { id: 'ba_fighter_hat' }
    const wrapper = { startedAt: 1700000000000 }

    await completeMinigameTask({ task, taskWrapper: wrapper, deps: deps1 })
    await completeMinigameTask({ task, taskWrapper: wrapper, deps: deps2 })

    const nonceCall1 = (deps1.api.completeMinigame as any).mock.calls[0][1]
    const nonceCall2 = (deps2.api.completeMinigame as any).mock.calls[0][1]
    expect(nonceCall1.actionNonce).toBe(nonceCall2.actionNonce)
    expect(nonceCall1.actionNonce).toBe(`minigame:ba_fighter_hat:1700000000000`)
  })

  it('forwards server collectionLogEntries into the local cache via applyServerCollectionLogEntries', async () => {
    const log: CallLog = []
    const deps = buildDeps(log)
    await completeMinigameTask({
      task: { id: 'ba_fighter_hat' },
      taskWrapper: { startedAt: 1 },
      deps,
    })
    expect(deps.applyServerCollectionLogEntries).toHaveBeenCalledWith([
      { itemId: 'fighter_hat', sourceType: 'minigames', sourceId: 'ba_fighter_hat' },
    ])
  })

  it('on STALE_REPLAYED_ACTION pulls authoritative save and treats as success', async () => {
    const log: CallLog = []
    const err: any = new Error('stale_replayed_action')
    err.status = 409
    err.body = { code: 'STALE_REPLAYED_ACTION' }
    const deps = buildDeps(log, {
      completeError: err,
      pullSaveResult: { payload: { settings: {} }, updatedAt: 1 },
    })

    const res = await completeMinigameTask({
      task: { id: 'ba_fighter_hat' },
      taskWrapper: { startedAt: 1 },
      deps,
    })

    expect(res.status).toBe('success-deduped')
    expect(deps.pullSave).toHaveBeenCalled()
    expect(deps.applyCloudSave).toHaveBeenCalled()
    expect(deps.loadGame).toHaveBeenCalled()
    expect(deps.removeLocalActiveTask).toHaveBeenCalled()
    expect(deps.addToast).not.toHaveBeenCalled()
    expect(deps.requestCriticalPushSave).toHaveBeenCalledWith(deps.getSnapshot, 'minigame_complete')
  })

  it('on genuine /complete failure surfaces a toast and leaves localStorage activeTask in place', async () => {
    const log: CallLog = []
    const err: any = new Error('network down')
    err.status = 500
    const deps = buildDeps(log, { completeError: err })

    const res = await completeMinigameTask({
      task: { id: 'ba_fighter_hat', name: 'Fighter Hat' },
      taskWrapper: { startedAt: 1 },
      deps,
    })

    expect(res.status).toBe('failed')
    expect(deps.addToast).toHaveBeenCalledTimes(1)
    expect(deps.removeLocalActiveTask).not.toHaveBeenCalled()
    expect(deps.requestCriticalPushSave).not.toHaveBeenCalled()
  })

  it('skips the post-complete critical save while in a PvP match', async () => {
    const log: CallLog = []
    const deps = buildDeps(log)
    deps.isInPvpMatch = true
    await completeMinigameTask({
      task: { id: 'ba_fighter_hat' },
      taskWrapper: { startedAt: 1 },
      deps,
    })
    expect(deps.api.completeMinigame).toHaveBeenCalled()
    expect(deps.requestCriticalPushSave).not.toHaveBeenCalled()
  })

  it('dedupes concurrent completions for the same task instance', async () => {
    const log: CallLog = []
    let resolveComplete: (v: any) => void = () => {}
    const deps = buildDeps(log)
    deps.api.completeMinigame = vi.fn(() => new Promise(r => { resolveComplete = r }))

    const task = { id: 'ba_fighter_hat' }
    const wrapper = { startedAt: 42 }

    const first = completeMinigameTask({ task, taskWrapper: wrapper, deps })
    const second = completeMinigameTask({ task, taskWrapper: wrapper, deps })

    expect(await second).toEqual({ status: 'dedup' })
    expect(deps.api.completeMinigame).toHaveBeenCalledTimes(1)

    resolveComplete({ save: null })
    await first
  })
})

describe('completeMinigameTask — local (non-cloud) path', () => {
  it('grants rewards locally and schedules a critical push', async () => {
    const log: CallLog = []
    const deps = buildDeps(log, { isCloud: false })

    await completeMinigameTask({
      task: { id: 'ba_fighter_hat' },
      taskWrapper: { startedAt: 1 },
      deps,
    })

    expect(deps.grantMinigameTaskRewards).toHaveBeenCalled()
    expect(deps.removeLocalActiveTask).toHaveBeenCalled()
    expect(deps.requestCriticalPushSave).toHaveBeenCalledWith(deps.getSnapshot, 'minigame_complete')
    expect(deps.api.completeMinigame).not.toHaveBeenCalled()
  })

  it('skips the critical push while in a PvP match', async () => {
    const log: CallLog = []
    const deps = buildDeps(log, { isCloud: false })
    deps.isInPvpMatch = true

    await completeMinigameTask({
      task: { id: 'ba_fighter_hat' },
      taskWrapper: { startedAt: 1 },
      deps,
    })

    expect(deps.grantMinigameTaskRewards).toHaveBeenCalled()
    expect(deps.requestCriticalPushSave).not.toHaveBeenCalled()
  })
})

describe('buildMinigameNonce', () => {
  it('produces a stable nonce per (task id, startedAt) pair', () => {
    expect(buildMinigameNonce({ id: 'ba_fighter_hat' }, { startedAt: 1 })).toBe('minigame:ba_fighter_hat:1')
    expect(buildMinigameNonce({ id: 'ba_fighter_hat' }, { startedAt: 1 })).toBe('minigame:ba_fighter_hat:1')
  })

  it('falls back gracefully when startedAt is missing', () => {
    expect(buildMinigameNonce({ id: 'ba_fighter_hat' }, {} as any)).toBe('minigame:ba_fighter_hat:unknown')
  })
})
