import { describe, it, expect, vi, afterEach } from 'vitest'
import monstersData from '../src/data/monsters.json'
import { simulateBossFight, applyBossFightOutcome } from '../functions/_lib/mcp/bossFight.js'

// The headless boss runner drives the real combat engine, which uses
// Math.random. Tests stub it with a seeded PRNG so a given setup is
// deterministic; the assertions hold for the chosen seed.
function mulberry32(seed: number) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const monster = (id: string): any =>
  Array.isArray(monstersData) ? (monstersData as any[]).find((m) => m.id === id) : (monstersData as any)[id]

function maxedMeleeSave(overrides: any = {}) {
  return {
    stats: {
      attack: { xp: 14_000_000 },
      strength: { xp: 14_000_000 },
      defence: { xp: 14_000_000 },
      hitpoints: { xp: 14_000_000 },
      ranged: { xp: 0 },
      magic: { xp: 0 },
    },
    inventory: [{ itemId: 'anglerfish', quantity: 20 }],
    bank: {},
    equipment: { weapon: { itemId: 'dragon_scimitar' } },
    settings: { combatStance: 'aggressive', currentHP: 99 },
    ...overrides,
  }
}

afterEach(() => vi.restoreAllMocks())

describe('simulateBossFight', () => {
  it('a maxed melee setup defeats the weakest boss and earns combat XP', () => {
    vi.spyOn(Math, 'random').mockImplementation(mulberry32(12345))
    // gravehusk_brute: 60 HP, combat level 82, crush — the weakest boss.
    const out = simulateBossFight(maxedMeleeSave(), monster('gravehusk_brute'))
    expect(out.victory).toBe(true)
    expect(out.died).toBe(false)
    expect(out.xpGained.hitpoints).toBeGreaterThan(0)
    expect(out.xpGained.strength).toBeGreaterThan(0) // aggressive stance trains strength
    expect(out.finalHP).toBeGreaterThan(0)
  })

  it('refuses a magic setup with no active spell selected', () => {
    // A regular staff with no chosen spell can't cast — refused (use the client).
    const save = maxedMeleeSave({ equipment: { weapon: { itemId: 'staff' } }, settings: { combatStance: 'aggressive', currentHP: 99 } })
    expect(() => simulateBossFight(save, monster('gravehusk_brute'))).toThrow(/spell/i)
  })

  it('a maxed magic setup casting a spell defeats a boss and consumes its runes', () => {
    vi.spyOn(Math, 'random').mockImplementation(mulberry32(99))
    // Staff + Fire Surge vs gravehusk_brute (magic defence -5): casts land and win.
    const save = {
      stats: {
        attack: { xp: 0 }, strength: { xp: 0 }, defence: { xp: 14_000_000 },
        hitpoints: { xp: 14_000_000 }, ranged: { xp: 0 }, magic: { xp: 14_000_000 },
      },
      inventory: [
        { itemId: 'anglerfish', quantity: 20 },
        { itemId: 'fire_rune', quantity: 5000 },
        { itemId: 'air_rune', quantity: 5000 },
        { itemId: 'wrath_rune', quantity: 5000 },
      ],
      bank: {},
      equipment: { weapon: { itemId: 'staff' } },
      settings: { combatStance: 'accurate', currentHP: 99, activeCombatSpell: { id: 'fire_surge' } },
    }
    const out = simulateBossFight(save, monster('gravehusk_brute'))
    expect(out.victory).toBe(true)
    expect(out.xpGained.magic).toBeGreaterThan(0)
    expect(out.xpGained.hitpoints).toBeGreaterThan(0)
    // Fire Surge consumes fire/air/wrath runes per landed cast.
    expect(out.runesConsumed.fire_rune).toBeGreaterThan(0)
    expect(out.runesConsumed.air_rune).toBeGreaterThan(0)
    expect(out.runesConsumed.wrath_rune).toBeGreaterThan(0)
  })

  it('a weak, unarmed character does not defeat a boss', () => {
    vi.spyOn(Math, 'random').mockImplementation(mulberry32(7))
    const save = {
      stats: { attack: { xp: 0 }, strength: { xp: 0 }, defence: { xp: 0 }, hitpoints: { xp: 1154 }, ranged: { xp: 0 }, magic: { xp: 0 } },
      inventory: [], bank: {}, equipment: {}, settings: { combatStance: 'aggressive', currentHP: 10 },
    }
    const out = simulateBossFight(save, monster('gravehusk_brute'))
    expect(out.victory).toBe(false)
  })
})

describe('applyBossFightOutcome', () => {
  it('applies XP, sets HP, and consumes food (inventory then bank), ammo and charges', () => {
    const save: any = {
      stats: { attack: { xp: 1000 }, hitpoints: { xp: 1154 } },
      inventory: [{ itemId: 'anglerfish', quantity: 1 }, { itemId: 'anglerfish', quantity: 1 }],
      bank: { anglerfish: { itemId: 'anglerfish', quantity: 5 } },
      equipment: { weapon: { itemId: 'dragon_crossbow', charges: 100 }, ammo: { itemId: 'bronze_arrow', quantity: 50 } },
      settings: {},
    }
    applyBossFightOutcome(save, {
      victory: true, died: false, maxHP: 99, finalHP: 42,
      xpGained: { attack: 500, hitpoints: 200 },
      foodConsumed: { anglerfish: 3 }, ammoConsumed: { bronze_arrow: 10 }, chargesConsumed: 5,
    } as any)
    expect(save.stats.attack.xp).toBe(1500)
    expect(save.settings.currentHP).toBe(42)
    // 3 eaten: both inventory slots then 1 from the bank.
    expect(save.inventory.find((s: any) => s?.itemId === 'anglerfish')).toBeUndefined()
    expect(save.bank.anglerfish.quantity).toBe(4)
    expect(save.equipment.ammo.quantity).toBe(40)
    expect(save.equipment.weapon.charges).toBe(95)
  })

  it('consumes spell runes (inventory then bank) from the outcome', () => {
    const save: any = {
      stats: { magic: { xp: 1_000_000 }, hitpoints: { xp: 1154 } },
      inventory: [{ itemId: 'fire_rune', quantity: 3 }],
      bank: { fire_rune: { itemId: 'fire_rune', quantity: 10 } },
      equipment: {},
      settings: {},
    }
    applyBossFightOutcome(save, {
      victory: true, died: false, maxHP: 99, finalHP: 50,
      xpGained: {}, foodConsumed: {}, ammoConsumed: {}, runesConsumed: { fire_rune: 7 }, chargesConsumed: 0,
    } as any)
    // 7 used: 3 from inventory (emptied) then 4 from the bank (10 → 6).
    expect(save.inventory.find((s: any) => s?.itemId === 'fire_rune')).toBeUndefined()
    expect(save.bank.fire_rune.quantity).toBe(6)
  })

  it('a fatal outcome resets HP to max without wiping the save', () => {
    const save: any = { stats: { hitpoints: { xp: 1154 } }, inventory: [], bank: {}, equipment: {}, settings: { currentHP: 5 } }
    applyBossFightOutcome(save, { died: true, victory: false, maxHP: 10, finalHP: 0, xpGained: {}, foodConsumed: {}, ammoConsumed: {}, chargesConsumed: 0 } as any)
    expect(save.settings.currentHP).toBe(10)
  })
})
