import { describe, expect, it, vi } from 'vitest'
import { buildSavePayloadFromSnapshot, applySavePayload, buildSavePayloadFromState } from '../src/db/saveload.js'
import * as dbModule from '../src/db/database.js'
import * as storesModule from '../src/db/stores.js'

describe('save payload snapshot', () => {
  it('includes durable settings and normalizes sets', () => {
    const payload = buildSavePayloadFromSnapshot({
      player: { username: 'Tester' },
      stats: {},
      inventory: [],
      bank: {},
      equipment: {},
      settings: {
        currentHP: 10,
        autoBankLoot: true,
        bankConfig: { tabs: [] },
        homeShortcuts: ['combat'],
        combatStance: 'defensive',
        unlockedFeatures: new Set(['slayer']),
        activeCombatSpell: { id: 'wind_strike' },
        slayerTask: { monsterId: 'cave_goblin' },
        slayerPoints: 5,
        dungeoneeringTokens: 12345,
        bossKillCounts: { dragon: 2 },
        raidKillCounts: { cave: 1 },
        farming: { patchesById: {} },
        completedQuests: new Set(['quest_1']),
        questQueue: [{ id: 'quest_2' }],
      },
    })
    expect(payload.settings.combatStance).toBe('defensive')
    expect(payload.settings.unlockedFeatures).toEqual(['slayer'])
    expect(payload.settings.completedQuests).toEqual(['quest_1'])
    expect(payload.settings.dungeoneeringTokens).toBe(12345)
    // Kill counts are server-authoritative (kill_counts table) and must never
    // ride the save blob — stripped even when present on the snapshot.
    expect(payload.settings.bossKillCounts).toBeUndefined()
    expect(payload.settings.raidKillCounts).toBeUndefined()
  })


  it('preserves slayer null-task completion state and updated points', () => {
    const payload = buildSavePayloadFromSnapshot({
      player: { username: 'Tester' },
      stats: {},
      inventory: [],
      bank: {},
      equipment: {},
      settings: {
        slayerTask: null,
        slayerPoints: 14,
      },
    })

    expect(payload.settings.slayerTask).toBe(null)
    expect(payload.settings.slayerPoints).toBe(14)
  })

  it('models immediate post-completion snapshot durability', () => {
    let slayerTaskRef = { monsterId: 'cave_goblin', monstersRemaining: 1, pointsOnComplete: 4 }
    let slayerPointsRef = 10

    slayerTaskRef = null
    slayerPointsRef += 4

    const payload = buildSavePayloadFromSnapshot({
      player: { username: 'Tester' },
      stats: {},
      inventory: [],
      bank: {},
      equipment: {},
      settings: {
        slayerTask: slayerTaskRef,
        slayerPoints: slayerPointsRef,
      },
    })

    expect(payload.settings.slayerTask).toBe(null)
    expect(payload.settings.slayerPoints).toBe(14)
  })
  it('persists combat stance and unlocked construction features from state payload builder', () => {
    const payload = buildSavePayloadFromState(
      { username: 'Tester' },
      {},
      [],
      {},
      {},
      null,
      null,
      {},
      [],
      [],
      'aggressive',
      new Set(['money_purse', 'master_rejuvenation'])
    )

    expect(payload.settings.combatStance).toBe('aggressive')
    expect(payload.settings.unlockedFeatures).toEqual(['money_purse', 'master_rejuvenation'])
  })

  it('preserves unlockedFeatures when already serialized as an array', () => {
    const payload = buildSavePayloadFromState(
      { username: 'Tester' }, {}, [], {}, {}, null, null, {}, [], [], 'accurate', []
    )
    expect(payload.settings.unlockedFeatures).toEqual([])
  })

  it('carries kill counts across the wipe, because the payload cannot', async () => {
    // The two halves of this are a trap for each other: the payload strips kill
    // counts (asserted above) because they are server-authoritative, and
    // applySavePayload wipes IDB before writing. Together that deleted them on
    // every save pull — so leaving a co-op fight or dying re-locked a
    // kill-count-gated boss the player had already unlocked.
    const stored: Record<string, unknown> = {}
    vi.spyOn(storesModule, 'getSetting').mockImplementation(async (key: string) =>
      ({ bossKillCounts: { warlord_grondar: 4 }, raidKillCounts: { vaults: 2 } } as any)[key])
    vi.spyOn(dbModule, 'clearAllStores').mockResolvedValue(undefined as any)
    vi.spyOn(dbModule, 'getDB').mockResolvedValue({
      put: vi.fn(),
      transaction: vi.fn(() => ({
        store: { put: (val: any, key: string) => { stored[key] = val } },
        done: Promise.resolve(),
      })),
    } as any)

    await applySavePayload({ stats: {}, inventory: [], bank: {}, equipment: {}, settings: {} })

    expect(stored.bossKillCounts).toEqual({ key: 'bossKillCounts', value: { warlord_grondar: 4 } })
    expect(stored.raidKillCounts).toEqual({ key: 'raidKillCounts', value: { vaults: 2 } })
  })

  it('carries the slayer task block list across the wipe, because the payload cannot', async () => {
    // The block list is a credit purchase living in D1 slayer_task_blocks (§14),
    // so it never rides the save blob — which made it exactly the trap kill
    // counts were: every cloud pull wiped the local mirror and nothing put it
    // back. Boot then ran its offline catch-up against an empty block list
    // BEFORE fetchSlayerTaskBlocks landed, so auto slayer chain-assigned the
    // very monsters the player had paid to block.
    const stored: Record<string, unknown> = {}
    vi.spyOn(storesModule, 'getSetting').mockImplementation(async (key: string) =>
      ({ slayerTaskBlocks: [{ monsterId: 'red_dragon', active: true }] } as any)[key])
    vi.spyOn(dbModule, 'clearAllStores').mockResolvedValue(undefined as any)
    vi.spyOn(dbModule, 'getDB').mockResolvedValue({
      put: vi.fn(),
      transaction: vi.fn(() => ({
        store: { put: (val: any, key: string) => { stored[key] = val } },
        done: Promise.resolve(),
      })),
    } as any)

    await applySavePayload({ stats: {}, inventory: [], bank: {}, equipment: {}, settings: {} })

    expect(stored.slayerTaskBlocks).toEqual({
      key: 'slayerTaskBlocks',
      value: [{ monsterId: 'red_dragon', active: true }],
    })
  })

  it('strips the slayer task block list from the save payload', () => {
    const payload = buildSavePayloadFromSnapshot({
      player: { username: 'Tester' },
      stats: {},
      inventory: [],
      bank: {},
      equipment: {},
      settings: { slayerTaskBlocks: [{ monsterId: 'red_dragon', active: true }] },
    })
    expect(payload.settings.slayerTaskBlocks).toBeUndefined()
  })

  it('writes nothing extra when there are no kill counts to carry', async () => {
    const stored: Record<string, unknown> = {}
    vi.spyOn(storesModule, 'getSetting').mockResolvedValue(undefined as any)
    vi.spyOn(dbModule, 'clearAllStores').mockResolvedValue(undefined as any)
    vi.spyOn(dbModule, 'getDB').mockResolvedValue({
      put: vi.fn(),
      transaction: vi.fn(() => ({
        store: { put: (val: any, key: string) => { stored[key] = val } },
        done: Promise.resolve(),
      })),
    } as any)
    await applySavePayload({ stats: {}, inventory: [], bank: {}, equipment: {}, settings: {} })
    expect(Object.keys(stored)).toEqual([])
  })

  it('does not restore local idle mirrors by default', async () => {
    const ls = { setItem: vi.fn(), removeItem: vi.fn() } as any
    globalThis.localStorage = ls
    vi.spyOn(dbModule, 'clearAllStores').mockResolvedValue(undefined as any)
    vi.spyOn(dbModule, 'getDB').mockResolvedValue({
      put: vi.fn(),
      transaction: vi.fn(() => ({ store: { put: vi.fn() }, done: Promise.resolve() })),
    } as any)
    await applySavePayload({ stats: {}, inventory: [], bank: {}, equipment: {}, settings: { activeTask: { a: 1 }, lastTick: 1 } })
    expect(ls.setItem).not.toHaveBeenCalledWith('pocketrpg_lastTick', expect.anything())
    expect(ls.setItem).not.toHaveBeenCalledWith('pocketrpg_activeTask', expect.anything())
  })
})
