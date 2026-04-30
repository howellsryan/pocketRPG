import { describe, expect, it, vi } from 'vitest'
import { buildSavePayloadFromSnapshot, applySavePayload } from '../src/db/saveload.js'
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
        slayerTask: { monsterId: 'goblin' },
        slayerPoints: 5,
        bossKillCounts: { dragon: 2 },
        raidKillCounts: { cave: 1 },
        farming: { patchesById: {} },
        completedQuests: new Set(['quest_1']),
        questQueue: [{ id: 'quest_2' }],
      },
    })
    expect(payload.settings.combatStance).toBe('defensive')
    expect(payload.settings.activeCombatSpell).toEqual({ id: 'wind_strike' })
    expect(payload.settings.unlockedFeatures).toEqual(['slayer'])
    expect(payload.settings.completedQuests).toEqual(['quest_1'])
    expect(payload.settings.questQueue).toEqual([{ id: 'quest_2' }])
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
