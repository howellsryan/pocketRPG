import { describe, expect, it, vi } from 'vitest'
import { buildSavePayloadFromSnapshot, applySavePayload, buildSavePayloadFromState } from '../src/db/saveload.js'
import * as dbModule from '../src/db/database.js'

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

  it('does not restore local idle mirrors by default', async () => {
    const ls = { setItem: vi.fn(), removeItem: vi.fn() } as any
    globalThis.localStorage = ls
    vi.spyOn(dbModule, 'deleteDB').mockResolvedValue(undefined as any)
    vi.spyOn(dbModule, 'getDB').mockResolvedValue({
      put: vi.fn(),
      transaction: vi.fn(() => ({ store: { put: vi.fn() }, done: Promise.resolve() })),
    } as any)
    await applySavePayload({ stats: {}, inventory: [], bank: {}, equipment: {}, settings: { activeTask: { a: 1 }, lastTick: 1 } })
    expect(ls.setItem).not.toHaveBeenCalledWith('pocketrpg_lastTick', expect.anything())
    expect(ls.setItem).not.toHaveBeenCalledWith('pocketrpg_activeTask', expect.anything())
  })
})
