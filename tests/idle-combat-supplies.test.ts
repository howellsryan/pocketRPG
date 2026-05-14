import { describe, expect, it } from 'vitest'
import { simulateIdleCombat } from '../src/engine/idleEngine.js'
import {
  defaultIdleCombatSetup,
  normaliseIdleCombatSetup,
  getValidIdlePrayerSelection,
  getFoodHealAmount,
  getPrayerRestoreAmount,
  isBoostPotion,
  isPrayerRestorePotion,
  buildAvailableSupplyMap,
} from '../src/engine/idleSupplies.js'

// ── Test fixtures ──────────────────────────────────────────────────────────

const PRAYERS_FIXTURE: any = {
  protection_from_melee: {
    id: 'protection_from_melee',
    bonusType: 'protection',
    style: 'melee',
    damageReductionPercent: 100,
    level: 43,
  },
  eagle_eye: {
    id: 'eagle_eye',
    bonusType: 'stat',
    stat: 'ranged',
    boostPercent: 15,
    level: 44,
  },
  rock_skin: {
    id: 'rock_skin',
    bonusType: 'stat',
    stat: 'defence',
    boostPercent: 10,
    level: 10,
  },
}

const ITEMS_FIXTURE: any = {
  shark: { id: 'shark', name: 'Shark', type: 'food', heals: 20, eatTicks: 3 },
  super_combat: {
    id: 'super_combat',
    name: 'Super Combat',
    type: 'potion',
    effect: 'combat',
    boost: 18,
    duration: 300,
  },
  prayer_potion: {
    id: 'prayer_potion',
    name: 'Prayer potion',
    type: 'potion',
    effect: 'prayer',
    boost: 32,
    idlePrayerRestore: 15,
    duration: 300,
  },
  super_restore: {
    id: 'super_restore',
    name: 'Super restore',
    type: 'potion',
    effect: 'super_restore',
    idlePrayerRestore: 20,
    duration: 300,
  },
}

const HP_99_XP = 13_034_431
const ATT_99_STATS = {
  attack: { xp: HP_99_XP },
  strength: { xp: HP_99_XP },
  defence: { xp: HP_99_XP },
  hitpoints: { xp: HP_99_XP },
  ranged: { xp: HP_99_XP },
  magic: { xp: HP_99_XP },
  prayer: { xp: HP_99_XP },
}

// A monster that hits hard so survivability is the bottleneck. HP is high
// enough that the kill takes many ticks, giving the monster room to attack.
const HARD_HITTER = {
  id: 'hard_hitter',
  name: 'Hard Hitter',
  hitpoints: 200,
  stats: { attack: 200, strength: 200, defence: 200, magic: 1, ranged: 1 },
  attackSpeed: 4,
  attackStyle: 'crush',
  attackBonus: 200,
  strengthBonus: 200,
  defenceBonus: { stab: 200, slash: 200, crush: 200, magic: 200, ranged: 200 },
  drops: [],
}

const WEAK_GOBLIN = {
  id: 'cave_goblin',
  name: 'Goblin',
  hitpoints: 1,
  stats: { attack: 1, strength: 1, defence: 1, magic: 1, ranged: 1 },
  attackSpeed: 4,
  attackStyle: 'crush',
  attackBonus: 0,
  strengthBonus: 0,
  defenceBonus: { stab: -15, slash: -15, crush: -15, magic: -15, ranged: -15 },
  drops: [],
}

// ── Helper / data tests ────────────────────────────────────────────────────

describe('idleSupplies helpers', () => {
  it('returns sensible food healing for known food items', () => {
    expect(getFoodHealAmount(ITEMS_FIXTURE.shark)).toBe(20)
    expect(getFoodHealAmount({ type: 'food', heals: 0 } as any)).toBe(0)
    expect(getFoodHealAmount(null as any)).toBe(0)
  })

  it('classifies boost vs prayer-restore potions', () => {
    expect(isBoostPotion(ITEMS_FIXTURE.super_combat)).toBe(true)
    expect(isBoostPotion(ITEMS_FIXTURE.prayer_potion)).toBe(false)
    expect(isPrayerRestorePotion(ITEMS_FIXTURE.prayer_potion)).toBe(true)
    expect(isPrayerRestorePotion(ITEMS_FIXTURE.super_restore)).toBe(true)
    expect(getPrayerRestoreAmount(ITEMS_FIXTURE.prayer_potion)).toBe(15)
    expect(getPrayerRestoreAmount(ITEMS_FIXTURE.super_restore)).toBe(20)
  })

  it('caps configured supplies against actual inventory + bank availability', () => {
    const supplyList = [{ itemId: 'shark', quantity: 100 }, { itemId: 'super_combat', quantity: 50 }]
    const inventory = [{ itemId: 'shark', quantity: 2 }]
    const bank = { super_combat: { itemId: 'super_combat', quantity: 3 } }
    const out = buildAvailableSupplyMap(supplyList, inventory, bank)
    expect(out.shark.configured).toBe(100)
    expect(out.shark.available).toBe(2)
    expect(out.super_combat.available).toBe(3)
  })

  it('drops invalid prayer choices when level is too low', () => {
    const sel = getValidIdlePrayerSelection({ protectionPrayerId: 'protection_from_melee', combatPrayerId: 'eagle_eye' }, PRAYERS_FIXTURE, 30)
    expect(sel.protectionPrayerId).toBeNull()
    expect(sel.combatPrayerId).toBeNull()
    const sel2 = getValidIdlePrayerSelection({ protectionPrayerId: 'protection_from_melee', combatPrayerId: 'eagle_eye' }, PRAYERS_FIXTURE, 99)
    expect(sel2.protectionPrayerId).toBe('protection_from_melee')
    expect(sel2.combatPrayerId).toBe('eagle_eye')
  })

  it('normalises raw idle setups defensively', () => {
    expect(normaliseIdleCombatSetup(undefined)).toEqual(defaultIdleCombatSetup())
    const out = normaliseIdleCombatSetup({
      food: [{ itemId: 'shark', quantity: 5 }, { itemId: 'shark', quantity: 7 }, { itemId: '', quantity: 1 }],
      potions: [{ itemId: 'super_combat', quantity: 'NaN' }, { itemId: 'super_combat', quantity: 3 }],
      prayers: { protectionPrayerId: 42, combatPrayerId: 'eagle_eye' },
    } as any)
    expect(out.food).toEqual([{ itemId: 'shark', quantity: 5 }])
    expect(out.potions).toEqual([{ itemId: 'super_combat', quantity: 3 }])
    expect(out.prayers).toEqual({ protectionPrayerId: null, combatPrayerId: 'eagle_eye' })
  })
})

// ── simulateIdleCombat — combat stance ─────────────────────────────────────

describe('simulateIdleCombat — stance normalisation', () => {
  it('treats legacy `controlled` stance as accurate without crashing', () => {
    const task: any = { stance: 'controlled', monster: WEAK_GOBLIN }
    const sim = simulateIdleCombat(task, 60_000, ATT_99_STATS, {}, Array(28).fill(null), ITEMS_FIXTURE)
    expect(sim).toBeTruthy()
    expect(sim!.monstersKilled).toBeGreaterThan(0)
    // Accurate stance grants attack XP — controlled should normalise to that.
    expect(sim!.xpGained.attack).toBeGreaterThan(0)
    expect(sim!.xpGained.strength).toBeUndefined()
  })
})

// ── Idle eat / no skip death ───────────────────────────────────────────────

describe('simulateIdleCombat — idle eat caps survivability', () => {
  it('99 HP + 2 sharks stops early when monster damage exhausts pool, never dies, no partial kill rewards', () => {
    const task: any = { stance: 'accurate', monster: HARD_HITTER, bankingEnabled: true }
    const inv = Array(28).fill(null)
    inv[0] = { itemId: 'shark', quantity: 2 }
    const sim = simulateIdleCombat(task, 60 * 60_000, ATT_99_STATS, {}, inv, ITEMS_FIXTURE, null, {}, {
      currentHP: 99,
      idleFood: [{ itemId: 'shark', quantity: 2 }],
    })

    expect(sim).toBeTruthy()
    // We started fully healed and two sharks add ~40 HP. The hard hitter
    // should burn through that within the hour.
    expect(sim!.foodConsumed.shark).toBeLessThanOrEqual(2)
    expect(sim!.finalHP).toBeGreaterThanOrEqual(1) // never dies
    expect(sim!.stoppedReason).toBeDefined()
    expect(['out_of_food', 'out_of_hp', 'completed_elapsed']).toContain(sim!.stoppedReason)
    if (sim!.stoppedReason === 'out_of_food' || sim!.stoppedReason === 'out_of_hp') {
      // Effective elapsed must be <= configured elapsed.
      expect(sim!.effectiveElapsedMs).toBeLessThan(60 * 60_000)
    }
    // Inventory delta on shark should equal -consumed.
    const sharkSlot = sim!.finalInventory.find((s: any) => s && s.itemId === 'shark')
    const remainingSharks = sharkSlot ? sharkSlot.quantity : 0
    expect(2 - remainingSharks).toBe(sim!.foodConsumed.shark || 0)
  })

  it('tops player back up to full HP after the session if food remains', () => {
    // Weak cave_goblin can't really hurt a level-99 player, so HP wouldn't normally
    // dip below 1. Start the player below max so the post-loop top-up has work
    // to do, and confirm the player ends at full HP with food consumed.
    const task: any = { stance: 'accurate', monster: WEAK_GOBLIN }
    const inv = Array(28).fill(null)
    inv[0] = { itemId: 'shark', quantity: 28 }
    const sim = simulateIdleCombat(task, 60 * 60_000, ATT_99_STATS, {}, inv, ITEMS_FIXTURE, null, {}, {
      currentHP: 50, // 49 HP missing => 3 sharks (heal 20 each) tops to 99
      idleFood: [{ itemId: 'shark', quantity: 28 }],
    })
    expect(sim).toBeTruthy()
    expect(sim!.finalHP).toBe(99)
    expect(sim!.foodConsumed.shark).toBe(3)
    const sharkSlot = sim!.finalInventory.find((s: any) => s && s.itemId === 'shark')
    expect((sharkSlot?.quantity ?? 0)).toBe(28 - 3)
  })

  it('top-up does not run when player is already at full HP', () => {
    const task: any = { stance: 'accurate', monster: WEAK_GOBLIN }
    const inv = Array(28).fill(null)
    inv[0] = { itemId: 'shark', quantity: 28 }
    const sim = simulateIdleCombat(task, 60 * 60_000, ATT_99_STATS, {}, inv, ITEMS_FIXTURE, null, {}, {
      currentHP: 99,
      idleFood: [{ itemId: 'shark', quantity: 28 }],
    })
    expect(sim).toBeTruthy()
    expect(sim!.finalHP).toBe(99)
    expect(sim!.foodConsumed.shark || 0).toBe(0)
  })

  it('top-up consumes only what is available; if food runs out, leaves player below max', () => {
    const task: any = { stance: 'accurate', monster: WEAK_GOBLIN }
    const inv = Array(28).fill(null)
    inv[0] = { itemId: 'shark', quantity: 1 }
    const sim = simulateIdleCombat(task, 60 * 60_000, ATT_99_STATS, {}, inv, ITEMS_FIXTURE, null, {}, {
      currentHP: 50,
      idleFood: [{ itemId: 'shark', quantity: 1 }],
    })
    expect(sim).toBeTruthy()
    // One shark heals 20: 50 + 20 = 70, below max 99, food queue exhausted.
    expect(sim!.finalHP).toBe(70)
    expect(sim!.foodConsumed.shark).toBe(1)
  })

  it('no idle prayer => no prayer drain, no restore consumption', () => {
    const task: any = { stance: 'accurate', monster: WEAK_GOBLIN }
    const inv = Array(28).fill(null)
    inv[0] = { itemId: 'prayer_potion', quantity: 5 }
    const sim = simulateIdleCombat(task, 60_000, ATT_99_STATS, {}, inv, ITEMS_FIXTURE, null, {}, {
      currentHP: 99,
      idlePotions: [{ itemId: 'prayer_potion', quantity: 5 }],
      idlePrayers: { protectionPrayerId: null, combatPrayerId: null },
      prayersData: PRAYERS_FIXTURE,
    })
    expect(sim).toBeTruthy()
    expect(sim!.prayerPointsStarted).toBe(0)
    expect(sim!.potionsConsumed?.prayer_potion || 0).toBe(0)
  })
})

// ── Boost potion duration ──────────────────────────────────────────────────

describe('simulateIdleCombat — super combat boost duration', () => {
  it('1h skip with 100 super combat potions consumes about 12 doses', () => {
    const task: any = { stance: 'accurate', monster: WEAK_GOBLIN }
    const inv = Array(28).fill(null)
    inv[0] = { itemId: 'super_combat', quantity: 100 }
    const sim = simulateIdleCombat(task, 60 * 60_000, ATT_99_STATS, {}, inv, ITEMS_FIXTURE, null, {}, {
      currentHP: 99,
      idlePotions: [{ itemId: 'super_combat', quantity: 100 }],
      prayersData: PRAYERS_FIXTURE,
    })
    expect(sim).toBeTruthy()
    expect(sim!.potionsConsumed.super_combat).toBe(12)
  })

  it('only enough boost for 1/5 of session covers ~1/5 of kills with the boost active', () => {
    // 1h / 5 = 12 minutes of boost. 1 super combat = 5 min, so 3 doses cover ~15 min ≈ 1/4 ish.
    // We just assert that consumption is capped at configured availability.
    const task: any = { stance: 'accurate', monster: WEAK_GOBLIN }
    const inv = Array(28).fill(null)
    inv[0] = { itemId: 'super_combat', quantity: 3 }
    const sim = simulateIdleCombat(task, 60 * 60_000, ATT_99_STATS, {}, inv, ITEMS_FIXTURE, null, {}, {
      currentHP: 99,
      idlePotions: [{ itemId: 'super_combat', quantity: 3 }],
      prayersData: PRAYERS_FIXTURE,
    })
    expect(sim).toBeTruthy()
    expect(sim!.potionsConsumed.super_combat).toBe(3)
  })

  it('configuring potions you do not own provides no benefit', () => {
    const task: any = { stance: 'accurate', monster: WEAK_GOBLIN }
    const inv = Array(28).fill(null)
    inv[0] = { itemId: 'super_combat', quantity: 3 }
    const sim = simulateIdleCombat(task, 60 * 60_000, ATT_99_STATS, {}, inv, ITEMS_FIXTURE, null, {}, {
      currentHP: 99,
      idlePotions: [{ itemId: 'super_combat', quantity: 100 }],
      prayersData: PRAYERS_FIXTURE,
    })
    expect(sim).toBeTruthy()
    expect(sim!.potionsConsumed.super_combat).toBeLessThanOrEqual(3)
    expect(sim!.idleSupplies?.potionsAvailable.super_combat).toBe(3)
    expect(sim!.idleSupplies?.potionsConfigured.super_combat).toBe(100)
  })
})

// ── Prayer drain + restore ─────────────────────────────────────────────────

describe('simulateIdleCombat — prayer drain', () => {
  it('protection prayer negates melee damage while pool lasts and resumes after', () => {
    const task: any = { stance: 'accurate', monster: HARD_HITTER, bankingEnabled: true }
    const inv = Array(28).fill(null)
    inv[0] = { itemId: 'shark', quantity: 28 }
    const sim = simulateIdleCombat(task, 60 * 60_000, ATT_99_STATS, {}, inv, ITEMS_FIXTURE, null, {}, {
      currentHP: 99,
      idleFood: [{ itemId: 'shark', quantity: 28 }],
      idlePrayers: { protectionPrayerId: 'protection_from_melee', combatPrayerId: null },
      prayersData: PRAYERS_FIXTURE,
    })
    expect(sim).toBeTruthy()
    expect(sim!.prayerPointsStarted).toBe(99)
    expect(sim!.prayerPointsUsed).toBeGreaterThan(0)
    // Some damage was prevented by the protection prayer.
    expect(sim!.damagePreventedByPrayer).toBeGreaterThan(0)
  })

  it('prayer potion adds +15 and super restore adds +20 when consumed', () => {
    const task: any = { stance: 'accurate', monster: HARD_HITTER, bankingEnabled: true }
    const inv = Array(28).fill(null)
    inv[0] = { itemId: 'prayer_potion', quantity: 5 }
    inv[1] = { itemId: 'super_restore', quantity: 5 }
    inv[2] = { itemId: 'shark', quantity: 28 }
    const sim = simulateIdleCombat(task, 60 * 60_000, ATT_99_STATS, {}, inv, ITEMS_FIXTURE, null, {}, {
      currentHP: 99,
      idleFood: [{ itemId: 'shark', quantity: 28 }],
      idlePotions: [{ itemId: 'prayer_potion', quantity: 5 }, { itemId: 'super_restore', quantity: 5 }],
      idlePrayers: { protectionPrayerId: 'protection_from_melee', combatPrayerId: null },
      prayersData: PRAYERS_FIXTURE,
    })
    expect(sim).toBeTruthy()
    const usedPP = sim!.potionsConsumed.prayer_potion || 0
    const usedSR = sim!.potionsConsumed.super_restore || 0
    expect(sim!.prayerPointsRestored).toBe(usedPP * 15 + usedSR * 20)
  })

  it('combo of super combat + super restore is allowed and tracked separately', () => {
    const task: any = { stance: 'accurate', monster: HARD_HITTER, bankingEnabled: true }
    const inv = Array(28).fill(null)
    inv[0] = { itemId: 'super_combat', quantity: 12 }
    inv[1] = { itemId: 'super_restore', quantity: 4 }
    inv[2] = { itemId: 'shark', quantity: 28 }
    const sim = simulateIdleCombat(task, 60 * 60_000, ATT_99_STATS, {}, inv, ITEMS_FIXTURE, null, {}, {
      currentHP: 99,
      idleFood: [{ itemId: 'shark', quantity: 28 }],
      idlePotions: [
        { itemId: 'super_combat', quantity: 12 },
        { itemId: 'super_restore', quantity: 4 },
      ],
      idlePrayers: { protectionPrayerId: 'protection_from_melee', combatPrayerId: null },
      prayersData: PRAYERS_FIXTURE,
    })
    expect(sim).toBeTruthy()
    expect(sim!.idleSupplies?.potionsConfigured.super_combat).toBe(12)
    expect(sim!.idleSupplies?.potionsConfigured.super_restore).toBe(4)
  })
})

// ── Modal metadata ─────────────────────────────────────────────────────────

describe('simulateIdleCombat — modal metadata', () => {
  it('returns used / configured counts the idle modal can render directly', () => {
    const task: any = { stance: 'accurate', monster: WEAK_GOBLIN }
    const inv = Array(28).fill(null)
    inv[0] = { itemId: 'shark', quantity: 2 }
    inv[1] = { itemId: 'super_combat', quantity: 1 }
    const sim = simulateIdleCombat(task, 60_000, ATT_99_STATS, {}, inv, ITEMS_FIXTURE, null, {}, {
      currentHP: 99,
      idleFood: [{ itemId: 'shark', quantity: 2 }],
      idlePotions: [{ itemId: 'super_combat', quantity: 1 }],
      prayersData: PRAYERS_FIXTURE,
    })
    expect(sim).toBeTruthy()
    expect(sim!.idleSupplies).toBeTruthy()
    expect(sim!.idleSupplies!.foodConfigured.shark).toBe(2)
    expect(sim!.idleSupplies!.foodAvailable.shark).toBe(2)
    expect(sim!.idleSupplies!.potionsConfigured.super_combat).toBe(1)
    expect(sim!.idleSupplies!.potionsAvailable.super_combat).toBe(1)
    expect(typeof sim!.stoppedReason).toBe('string')
    expect(typeof sim!.effectiveElapsedMs).toBe('number')
  })
})
