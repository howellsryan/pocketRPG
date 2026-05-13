import { describe, it, expect, beforeEach, vi } from 'vitest'

const postCollectionLogMock = vi.fn().mockResolvedValue({ ok: true, accepted: 1, rejected: 0 })
const getCollectionLogMock = vi.fn()

vi.mock('../src/cloud/api.js', () => ({
  api: {
    getCollectionLog: (...a: unknown[]) => getCollectionLogMock(...a),
    postCollectionLog: (...a: unknown[]) => postCollectionLogMock(...a),
  },
  getToken: () => 'token',
  getCharacterId: () => 1,
}))

async function freshClient() {
  vi.resetModules()
  return await import('../src/cloud/collectionLog.js')
}

describe('collection log slot completion notifications', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    postCollectionLogMock.mockClear()
    getCollectionLogMock.mockClear()
  })

  it('does not fire slot-complete for monster drops (server-authoritative via /complete)', async () => {
    const mod: any = await freshClient()
    getCollectionLogMock.mockResolvedValueOnce({ entries: [], total: 100 })
    await mod.fetchCollectionLog({ force: true })

    const seen: Array<{ itemId: string; sourceType: string; sourceId: string }> = []
    mod.onCollectionLogSlotComplete((e: any) => seen.push(e))

    mod.recordCollectionLogDrop({ itemId: 'granite_maul', sourceType: 'monsters', sourceId: 'gargoyle' })
    expect(seen).toHaveLength(0)
  })

  it('does not enqueue monster drops for /collection-log posting', async () => {
    const mod: any = await freshClient()
    getCollectionLogMock.mockResolvedValueOnce({ entries: [], total: 100 })
    await mod.fetchCollectionLog({ force: true })

    mod.recordCollectionLogDrop({ itemId: 'granite_maul', sourceType: 'monsters', sourceId: 'gargoyle' })
    vi.advanceTimersByTime(1000)
    expect(postCollectionLogMock).not.toHaveBeenCalled()
  })

  it('does not re-fire when the entry already exists in the cached server state', async () => {
    const mod: any = await freshClient()
    getCollectionLogMock.mockResolvedValueOnce({
      entries: [{ itemId: 'granite_maul', sourceType: 'monsters', sourceId: 'gargoyle', obtainedAt: 1 }],
      total: 100,
    })
    await mod.fetchCollectionLog({ force: true })

    let count = 0
    mod.onCollectionLogSlotComplete(() => count++)
    mod.recordCollectionLogDrop({ itemId: 'granite_maul', sourceType: 'monsters', sourceId: 'gargoyle' })
    expect(count).toBe(0)
  })

  it('does not re-fire for shared items already obtained from another source', async () => {
    const mod: any = await freshClient()
    // dragon_axe is shared across all three nagadoth kings — having it from
    // Rex should suppress the toast when Prime later "drops" it.
    getCollectionLogMock.mockResolvedValueOnce({
      entries: [{ itemId: 'dragon_axe', sourceType: 'monsters', sourceId: 'dagganoth_rex', obtainedAt: 1 }],
      total: 100,
    })
    await mod.fetchCollectionLog({ force: true })

    let count = 0
    mod.onCollectionLogSlotComplete(() => count++)
    mod.recordCollectionLogDrop({ itemId: 'dragon_axe', sourceType: 'monsters', sourceId: 'dagganoth_prime' })
    mod.recordCollectionLogDrop({ itemId: 'dragon_axe', sourceType: 'monsters', sourceId: 'dagganoth_supreme' })
    expect(count).toBe(0)
  })


  it('fires slot-complete for skilling unlock source entries', async () => {
    const mod: any = await freshClient()
    getCollectionLogMock.mockResolvedValueOnce({ entries: [], total: 100 })
    await mod.fetchCollectionLog({ force: true })

    const seen: Array<{ itemId: string; sourceType: string; sourceId: string }> = []
    mod.onCollectionLogSlotComplete((e: any) => seen.push(e))

    mod.recordCollectionLogDrop({ itemId: 'master_rejuvenation', sourceType: 'skilling', sourceId: 'construction' })
    expect(seen).toEqual([{ itemId: 'master_rejuvenation', sourceType: 'skilling', sourceId: 'construction' }])
  })

  it('clearCollectionLogCache resets state without firing toasts', async () => {
    const mod: any = await freshClient()
    getCollectionLogMock.mockResolvedValueOnce({ entries: [], total: 100 })
    await mod.fetchCollectionLog({ force: true })

    let count = 0
    mod.onCollectionLogSlotComplete(() => count++)
    mod.clearCollectionLogCache()
    expect(count).toBe(0)
  })
})
