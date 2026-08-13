// Grindman: half XP, triple drop rates, and credits that can only be earned.
// The rules worth a regression test are the ones a future change can silently
// undo — a multiplier that stops clamping, a mode combination the server lets
// through, and the drop tripling reaching a client that could claim it for
// itself. (The credit-purchase refusal lives in stripeCreateSession.test.ts,
// beside the endpoint that enforces it.)
import { describe, it, expect, vi } from 'vitest'
import {
  GRINDMAN_MULTIPLIERS,
  accountModeConflict,
  grindmanDropChance,
  grindmanXP,
  isGrindmanSave,
} from '../src/engine/grindman.js'
import { applyInstantKill, createCombatState } from '../src/engine/combat.js'
import { rollMonsterRewardsById } from '../functions/_lib/game/monsterRewards.js'
import { createDefaultSave, starterHelmetId } from '../src/engine/createDefaultSave.js'
import { getPurchaseRestriction } from '../src/engine/storeRules.js'
import { applyTaskResult } from '../src/engine/applyTaskResult.js'
import itemsData from '../src/data/items.json'
import monstersData from '../src/data/monsters.json'

describe('grindman multipliers', () => {
  it('halves XP and floors it, so a 1 XP gain is worth nothing', () => {
    expect(grindmanXP(100, true)).toBe(50)
    expect(grindmanXP(101, true)).toBe(50)
    expect(grindmanXP(1, true)).toBe(0)
    expect(grindmanXP(100, false)).toBe(100)
  })

  it('triples a drop chance and clamps at 1', () => {
    expect(grindmanDropChance(0.01, true)).toBeCloseTo(0.03, 10)
    expect(grindmanDropChance(0.5, true)).toBe(1)
    expect(grindmanDropChance(1, true)).toBe(1)
    expect(grindmanDropChance(0.01, false)).toBe(0.01)
  })

  it('treats a malformed chance as no chance rather than NaN', () => {
    expect(grindmanDropChance(undefined as unknown as number, true)).toBe(0)
    expect(grindmanXP(undefined as unknown as number, true)).toBe(0)
  })

  it('reads the mode off the save mirror', () => {
    expect(isGrindmanSave({ player: { is_grindman: true } })).toBe(true)
    expect(isGrindmanSave({ player: { is_grindman: false } })).toBe(false)
    expect(isGrindmanSave({})).toBe(false)
    expect(isGrindmanSave(null)).toBe(false)
  })

  it('keeps the tuning dials where they are documented', () => {
    expect(GRINDMAN_MULTIPLIERS.xp).toBe(0.5)
    expect(GRINDMAN_MULTIPLIERS.dropRate).toBe(3)
  })
})

describe('grindman stands alone', () => {
  it('refuses every combination with ironman or one life', () => {
    expect(accountModeConflict({ isGrindman: true, isIronman: true })).toBeTruthy()
    expect(accountModeConflict({ isGrindman: true, isOneLife: true })).toBeTruthy()
    expect(accountModeConflict({ isGrindman: true, isIronman: true, isOneLife: true })).toBeTruthy()
  })

  it('allows a plain grindman and every combination that does not involve one', () => {
    expect(accountModeConflict({ isGrindman: true })).toBeNull()
    expect(accountModeConflict({ isIronman: true, isOneLife: true })).toBeNull()
    expect(accountModeConflict({})).toBeNull()
  })
})

describe('grindman starter kit', () => {
  it('starts in the coin helm, and the helm exists', () => {
    expect(starterHelmetId({ isGrindman: true })).toBe('grindman_helm')
    expect((itemsData as Record<string, unknown>).grindman_helm).toBeTruthy()
  })

  it('seeds the save mirror so the client engine can read the mode', () => {
    const save = createDefaultSave({ name: 'Grindy', isGrindman: true })
    expect(save.player.is_grindman).toBe(true)
    expect(isGrindmanSave(save)).toBe(true)
    expect(save.inventory.some((s) => s?.itemId === 'grindman_helm')).toBe(true)
  })

  it('leaves every other account type on its own helm', () => {
    expect(starterHelmetId({})).toBe('bronze_full_helm')
    expect(starterHelmetId({ isIronman: true })).toBe('ironman_helm')
    expect(starterHelmetId({ isIronman: true, isOneLife: true })).toBe('onelife_ironman_helm')
    expect(createDefaultSave({}).player.is_grindman).toBe(false)
  })

  it('sells the coin helm to grindman accounts only', () => {
    const helm = (itemsData as Record<string, any>).grindman_helm
    expect(getPurchaseRestriction(helm, { isGrindman: true }).allowed).toBe(true)
    expect(getPurchaseRestriction(helm, {}).allowed).toBe(false)
    expect(getPurchaseRestriction(helm, { isIronman: true }).code).toBe('ACCOUNT_TYPE_RESTRICTED')
  })
})

describe('grindman XP lands once, where XP enters the stats', () => {
  it('halves an idle claim through applyTaskResult', () => {
    const state: any = { stats: { mining: { skill: 'mining', xp: 0, level: 1 } } }
    applyTaskResult(state, { xpGained: { mining: 1000 } } as any, 'skill', { isGrindman: true })
    expect(state.stats.mining.xp).toBe(500)
  })

  it('leaves an ordinary account claim alone', () => {
    const state: any = { stats: { mining: { skill: 'mining', xp: 0, level: 1 } } }
    applyTaskResult(state, { xpGained: { mining: 1000 } } as any, 'skill')
    expect(state.stats.mining.xp).toBe(1000)
  })
})

// The drop roll is the half of the mode that moves value, so it is checked on
// both sides of the §14 boundary: the client state flag (idle/ordinary kills)
// and the server roller (boss/raid/co-op grants, which read D1, never a body).
describe('grindman drop rolls', () => {
  const monster = {
    id: 'test_dummy',
    name: 'Test Dummy',
    hitpoints: 1,
    currentHP: 1,
    attackSpeed: 4,
    stats: { attack: 1, strength: 1, defence: 1, magic: 1 },
    drops: [{ itemId: 'coins', chance: 0.2, quantity: 1 }],
  }

  function lootRateWith(grindman: boolean, roll: number) {
    const state: any = createCombatState({ ...monster }, 'melee', 'accurate', null, null, { grindman })
    const spy = vi.spyOn(Math, 'random').mockReturnValue(roll)
    try {
      applyInstantKill(state)
      return (state.loot || []).some((l: any) => l.itemId === 'coins')
    } finally {
      spy.mockRestore()
    }
  }

  it('rolls a client drop against the tripled chance', () => {
    // 0.5 sits above the authored 0.2 and below the tripled 0.6.
    expect(lootRateWith(false, 0.5)).toBe(false)
    expect(lootRateWith(true, 0.5)).toBe(true)
  })

  it('defaults a fight to ordinary rates when no account type is passed', () => {
    const state: any = createCombatState({ ...monster }, 'melee', 'accurate')
    expect(state.grindman).toBe(false)
  })

  it('triples the server-side roll for a grindman', () => {
    const monsterId = Object.keys(monstersData as Record<string, any>).find((id) => {
      const drops = (monstersData as Record<string, any>)[id]?.drops
      return Array.isArray(drops) && drops.some((d) => d?.chance > 0 && d.chance <= 0.25)
    })
    expect(monsterId).toBeTruthy()
    const drop = (monstersData as Record<string, any>)[monsterId!].drops
      .find((d: any) => d?.chance > 0 && d.chance <= 0.25)
    // A roll between the authored chance and its triple: dry normally, paid for
    // a Grindman.
    const roll = drop.chance * 2
    const plain = rollMonsterRewardsById(monsterId!, () => roll, true, false, false)
    const grind = rollMonsterRewardsById(monsterId!, () => roll, true, false, true)
    expect(plain.some((l: any) => l.itemId === drop.itemId)).toBe(false)
    expect(grind.some((l: any) => l.itemId === drop.itemId)).toBe(true)
  })

  it('composes with hard mode rather than replacing it', () => {
    // 1/12 authored: hard mode alone reaches 1/6, grindman alone 1/4, both 1/2.
    const chance = 1 / 12
    expect(grindmanDropChance(chance * 2, true)).toBeCloseTo(0.5, 10)
  })
})
