import { describe, it, expect } from 'vitest'
import {
  displayedDropChance,
  dropRateMultiplier,
  dropRateBoostLabel,
  monsterDropBoost,
} from '../src/engine/dropRateDisplay.js'
import { hardModeDropChance, scaleMonsterForHardMode } from '../src/engine/hardMode.js'
import { grindmanDropChance } from '../src/engine/grindman.js'

describe('displayedDropChance', () => {
  it('shows the authored chance when nothing boosts it', () => {
    expect(displayedDropChance(0.002)).toBeCloseTo(0.002, 10)
    expect(displayedDropChance(0.002, { hardMode: false, grindman: false })).toBeCloseTo(0.002, 10)
  })

  it('doubles for hard mode and triples for Grindman', () => {
    expect(displayedDropChance(0.002, { hardMode: true })).toBeCloseTo(0.004, 10)
    expect(displayedDropChance(0.002, { grindman: true })).toBeCloseTo(0.006, 10)
  })

  it('matches what the reward rollers actually roll against, in every combination', () => {
    // The server composes the two multipliers in one expression
    // (functions/_lib/game/monsterRewards.js). A display that composes them any
    // other way prints a number the game does not use.
    for (const chance of [0.001, 0.02, 0.14, 0.4, 0.6, 1]) {
      for (const hardMode of [false, true]) {
        for (const grindman of [false, true]) {
          expect(displayedDropChance(chance, { hardMode, grindman }))
            .toBe(grindmanDropChance(hardModeDropChance(chance, hardMode), grindman))
        }
      }
    }
  })

  it('clamps at 1 — a guaranteed drop stays one drop', () => {
    expect(displayedDropChance(0.6, { hardMode: true })).toBe(1)
    expect(displayedDropChance(0.5, { hardMode: true, grindman: true })).toBe(1)
    expect(displayedDropChance(1, { hardMode: true, grindman: true })).toBe(1)
  })

  it('reads a missing chance as no chance rather than NaN', () => {
    expect(displayedDropChance(undefined as unknown as number, { hardMode: true })).toBe(0)
    expect(displayedDropChance(null as unknown as number)).toBe(0)
  })
})

describe('dropRateMultiplier', () => {
  it('is 1, 2, 3 or 6', () => {
    expect(dropRateMultiplier()).toBe(1)
    expect(dropRateMultiplier({ hardMode: true })).toBe(2)
    expect(dropRateMultiplier({ grindman: true })).toBe(3)
    expect(dropRateMultiplier({ hardMode: true, grindman: true })).toBe(6)
  })
})

describe('monsterDropBoost', () => {
  const boss = {
    id: 'test_boss',
    name: 'Test Boss',
    boss: true,
    hardMode: true,
    hitpoints: 400,
    maxHit: 30,
    stats: { attack: 200, strength: 200, defence: 200, magic: 1, ranged: 1 },
    drops: [{ itemId: 'coins', quantity: 100, chance: 0.5 }],
  }

  it('reads hard mode off the scaled record the fight was built from', () => {
    expect(monsterDropBoost(boss)).toEqual({ hardMode: false, grindman: false })
    expect(monsterDropBoost(scaleMonsterForHardMode(boss))).toEqual({ hardMode: true, grindman: false })
  })

  it('carries the account Grindman flag through', () => {
    expect(monsterDropBoost(boss, true)).toEqual({ hardMode: false, grindman: true })
    expect(monsterDropBoost(scaleMonsterForHardMode(boss), true)).toEqual({ hardMode: true, grindman: true })
  })

  it('claims no boost for a raid boss — a raid pays from the raid table, not this one', () => {
    const raidBoss = scaleMonsterForHardMode({ ...boss, raidBoss: true })
    expect(monsterDropBoost(raidBoss, true)).toEqual({ hardMode: false, grindman: false })
    expect(dropRateBoostLabel(monsterDropBoost(raidBoss, true))).toBe(null)
  })

  it('survives a missing record', () => {
    expect(monsterDropBoost(undefined, true)).toEqual({ hardMode: false, grindman: true })
  })
})

describe('dropRateBoostLabel', () => {
  it('says nothing when the rates are the authored ones', () => {
    expect(dropRateBoostLabel()).toBe(null)
    expect(dropRateBoostLabel({ hardMode: false, grindman: false })).toBe(null)
  })

  it('names every source of the boost', () => {
    expect(dropRateBoostLabel({ hardMode: true })).toBe('Hard Mode — 2× drop rates')
    expect(dropRateBoostLabel({ grindman: true })).toBe('Grindman — 3× drop rates')
    expect(dropRateBoostLabel({ hardMode: true, grindman: true })).toBe('Hard Mode + Grindman — 6× drop rates')
  })
})
