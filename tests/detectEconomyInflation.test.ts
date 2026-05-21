import { describe, it, expect } from 'vitest'
import { detectEconomyInflation } from '../functions/_lib/game/saveValidation.js'

describe('detectEconomyInflation', () => {
  it('returns no violations when nothing changed', () => {
    const save = {
      stats: { attack: { xp: 1000 } },
      inventory: [{ itemId: 'coins', quantity: 500 }],
      bank: {},
    }
    expect(detectEconomyInflation(save, save)).toEqual([])
  })

  it('flags any positive XP delta per skill', () => {
    const prev = { stats: { attack: { xp: 1000 }, strength: { xp: 2000 } } }
    const next = { stats: { attack: { xp: 5_000_000 }, strength: { xp: 2000 } } }
    const v = detectEconomyInflation(prev, next)
    expect(v).toHaveLength(1)
    expect(v[0]).toMatchObject({ path: 'stats.attack.xp', delta: 5_000_000 - 1000 })
  })

  it('flags an inventory-side coin increase', () => {
    const prev = { inventory: [{ itemId: 'coins', quantity: 100 }] }
    const next = { inventory: [{ itemId: 'coins', quantity: 2_000_000_000 }] }
    const v = detectEconomyInflation(prev, next)
    expect(v[0]).toMatchObject({ path: 'coins', delta: 2_000_000_000 - 100 })
  })

  it('flags a bank-side coin increase', () => {
    const prev = { bank: { coins: { quantity: 0 } } }
    const next = { bank: { coins: { quantity: 1_000_000 } } }
    expect(detectEconomyInflation(prev, next)[0].path).toBe('coins')
  })

  it('does not flag coins moving from inventory to bank', () => {
    const prev = { inventory: [{ itemId: 'coins', quantity: 1000 }], bank: {} }
    const next = { inventory: [], bank: { coins: { quantity: 1000 } } }
    expect(detectEconomyInflation(prev, next)).toEqual([])
  })

  it('flags slayer points going up', () => {
    expect(
      detectEconomyInflation({ slayer: { points: 10 } }, { slayer: { points: 1000 } })[0].path
    ).toBe('slayer.points')
  })

  it('flags slayer points going up via the settings mirror', () => {
    expect(
      detectEconomyInflation({ settings: { slayerPoints: 0 } }, { settings: { slayerPoints: 999 } })[0].path
    ).toBe('slayer.points')
  })

  it('flags dungeoneering tokens going up', () => {
    expect(
      detectEconomyInflation({ dungeoneeringTokens: 100 }, { dungeoneeringTokens: 200 })[0].path
    ).toBe('dungeoneeringTokens')
  })

  it('flags any boss/raid kill count increase per id', () => {
    const prev = { settings: { bossKillCounts: { dragon: 1 } } }
    const next = { settings: { bossKillCounts: { dragon: 5, hydra: 7 } } }
    const v = detectEconomyInflation(prev, next)
    expect(v.find(x => x.path === 'settings.bossKillCounts.dragon')).toBeTruthy()
    expect(v.find(x => x.path === 'settings.bossKillCounts.hydra')).toBeTruthy()
  })

  it('flags newly unlocked minigame items', () => {
    const prev = { settings: { unlockedMinigameItems: ['fighter_helm'] } }
    const next = { settings: { unlockedMinigameItems: ['fighter_helm', 'ranger_top'] } }
    const v = detectEconomyInflation(prev, next)
    expect(v[0]).toMatchObject({ path: 'settings.unlockedMinigameItems', item: 'ranger_top' })
  })

  it('does not flag XP staying flat or decreasing (decrease is harmless)', () => {
    const prev = { stats: { attack: { xp: 100 } } }
    const next = { stats: { attack: { xp: 50 } } }
    expect(detectEconomyInflation(prev, next)).toEqual([])
  })

  it('does not flag a new skill appearing with 0 xp', () => {
    const prev = { stats: { attack: { xp: 100 } } }
    const next = { stats: { attack: { xp: 100 }, strength: { xp: 0 } } }
    expect(detectEconomyInflation(prev, next)).toEqual([])
  })

  it('reports multiple violations in one pass', () => {
    const prev = {
      stats: { attack: { xp: 1 } },
      inventory: [{ itemId: 'coins', quantity: 0 }],
      slayer: { points: 0 },
    }
    const next = {
      stats: { attack: { xp: 999_999 } },
      inventory: [{ itemId: 'coins', quantity: 1_000_000 }],
      slayer: { points: 999 },
    }
    const v = detectEconomyInflation(prev, next)
    expect(v.length).toBeGreaterThanOrEqual(3)
  })
})
