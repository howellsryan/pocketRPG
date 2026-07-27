import { describe, it, expect } from 'vitest'
import {
  getHealAmount,
  isLumiraBrew,
  isConsumableFood,
  isConsumablePotion,
  getPotionDurationTicks,
  getPotionStatBoost,
  getActivePotionBoosts,
  applyConsumableEffect,
  isComboConsumable,
  isNormalFood,
  resolveInventoryEat,
} from '../src/engine/consumables.js'

const ITEMS: any = {
  shark: { id: 'shark', type: 'food', heals: 20 },
  trout: { id: 'trout', type: 'food', heal: 7 },
  attack_potion: { id: 'attack_potion', type: 'potion', effect: 'attack', boost: 13, duration: 300 },
  super_combat: { id: 'super_combat', type: 'potion', effect: 'combat', boost: 18, duration: 300 },
  magic_potion: { id: 'magic_potion', type: 'potion', effect: 'magic', boost: 4, duration: 300 },
  prayer_potion: { id: 'prayer_potion', type: 'potion', effect: 'prayer', boost: 32, duration: 300 },
  super_restore: { id: 'super_restore', type: 'potion', effect: 'super_restore', duration: 300 },
  lumira_brew: { id: 'lumira_brew', type: 'potion', effect: 'hp', boost: 22, wipesPotions: true, duration: 300 },
  karam: { id: 'karam', type: 'food', heals: 18, combo: true },
  bronze_dagger: { id: 'bronze_dagger', type: 'weapon', slot: 'weapon' },
}

describe('consumables — eligibility', () => {
  it('detects food (real food + brews), legacy heal field included', () => {
    expect(isConsumableFood(ITEMS.shark)).toBe(true)
    expect(isConsumableFood(ITEMS.trout)).toBe(true)
    expect(isConsumableFood(ITEMS.lumira_brew)).toBe(true) // brew heals on eat
    expect(isConsumableFood(ITEMS.attack_potion)).toBe(false)
    expect(isConsumableFood(ITEMS.bronze_dagger)).toBe(false)
  })

  it('treats every potion as drinkable (parity with PvE)', () => {
    expect(isConsumablePotion(ITEMS.attack_potion)).toBe(true)
    expect(isConsumablePotion(ITEMS.prayer_potion)).toBe(true)
    expect(isConsumablePotion(ITEMS.magic_potion)).toBe(true)
    expect(isConsumablePotion(ITEMS.lumira_brew)).toBe(true)
    expect(isConsumablePotion(ITEMS.shark)).toBe(false)
  })

  it('identifies brews by wipesPotions', () => {
    expect(isLumiraBrew(ITEMS.lumira_brew)).toBe(true)
    expect(isLumiraBrew(ITEMS.attack_potion)).toBe(false)
  })

  it('classifies combo consumables: combo food + every potion (brews included)', () => {
    expect(isComboConsumable(ITEMS.karam)).toBe(true)       // combo food
    expect(isComboConsumable(ITEMS.attack_potion)).toBe(true)
    expect(isComboConsumable(ITEMS.super_combat)).toBe(true)
    expect(isComboConsumable(ITEMS.lumira_brew)).toBe(true)  // brew is a potion
    expect(isComboConsumable(ITEMS.shark)).toBe(false)       // normal food
    expect(isComboConsumable(ITEMS.bronze_dagger)).toBe(false)
  })

  it('normal food excludes combo food and potions', () => {
    expect(isNormalFood(ITEMS.shark)).toBe(true)
    expect(isNormalFood(ITEMS.trout)).toBe(true)
    expect(isNormalFood(ITEMS.karam)).toBe(false)            // combo food
    expect(isNormalFood(ITEMS.lumira_brew)).toBe(false)
  })

  it('reads heal amount from canonical and legacy fields', () => {
    expect(getHealAmount(ITEMS.shark)).toBe(20)
    expect(getHealAmount(ITEMS.trout)).toBe(7)
    expect(getHealAmount({ heals: 'abc' })).toBe(0)
    expect(getHealAmount({})).toBe(0)
  })
})

describe('consumables — boosts', () => {
  it('maps flat item.boost per effect', () => {
    expect(getPotionStatBoost(ITEMS.attack_potion)).toEqual({ attack: 13 })
    expect(getPotionStatBoost(ITEMS.magic_potion)).toEqual({ magic: 4 })
    // Super combat: full melee boost, but ranged/magic match the dedicated
    // Ranging (+14) and Magic (+4) potions.
    expect(getPotionStatBoost(ITEMS.super_combat)).toEqual({ attack: 18, strength: 18, defence: 18, ranged: 14, magic: 4 })
    // hp / prayer / super_restore contribute no stat boost
    expect(getPotionStatBoost(ITEMS.prayer_potion)).toEqual({})
    expect(getPotionStatBoost(ITEMS.super_restore)).toEqual({})
    expect(getPotionStatBoost(ITEMS.lumira_brew)).toEqual({})
  })

  it('sums boosts across active potions (PvE stacking)', () => {
    // attack(13) + super_combat(18) stack on the same stat → 31
    const boosts = getActivePotionBoosts({ attack_potion: 100, super_combat: 100 }, ITEMS)
    expect(boosts.attack).toBe(31)
    expect(boosts.strength).toBe(18) // super_combat only
    expect(boosts.ranged).toBe(14)   // super_combat ranged === Ranging Potion
    expect(boosts.magic).toBe(4)     // super_combat magic === Magic Potion
  })

  it('applies different-stat potions simultaneously', () => {
    const boosts = getActivePotionBoosts({ attack_potion: 100, super_combat: 0, super_strength: 100 }, {
      ...ITEMS,
      super_strength: { id: 'super_strength', type: 'potion', effect: 'strength', boost: 18, duration: 300 },
    })
    expect(boosts.attack).toBe(13)   // attack potion
    expect(boosts.strength).toBe(18) // strength potion — both active at once
  })

  it('ignores expired and unknown potions', () => {
    expect(getActivePotionBoosts({ attack_potion: 0 }, ITEMS)).toEqual({ attack: 0, strength: 0, defence: 0, ranged: 0, magic: 0 })
    expect(getActivePotionBoosts({ mystery: 5 }, ITEMS)).toEqual({ attack: 0, strength: 0, defence: 0, ranged: 0, magic: 0 })
  })

  it('defaults potion duration to 300s (500 ticks)', () => {
    expect(getPotionDurationTicks(ITEMS.attack_potion)).toBe(500)
    expect(getPotionDurationTicks({})).toBe(500)
    expect(getPotionDurationTicks({ duration: 60 })).toBe(100)
  })
})

describe('consumables — applyConsumableEffect', () => {
  it('eating food heals up to maxHP', () => {
    const actor = { hp: 10, maxHP: 99, activePotions: {} }
    const res = applyConsumableEffect(actor, ITEMS.shark, 'shark', 'eat')
    expect(actor.hp).toBe(30)
    expect(res.healed).toBe(20)
    expect(res.wiped).toBe(false)
  })

  it('caps healing at maxHP', () => {
    const actor = { hp: 95, maxHP: 99, activePotions: {} }
    applyConsumableEffect(actor, ITEMS.shark, 'shark', 'eat')
    expect(actor.hp).toBe(99)
  })

  it('drinking a boost potion registers the buff but does not heal', () => {
    const actor = { hp: 50, maxHP: 99, activePotions: {} }
    const res = applyConsumableEffect(actor, ITEMS.attack_potion, 'attack_potion', 'drink')
    expect(actor.activePotions.attack_potion).toBe(500)
    expect(actor.hp).toBe(50)
    expect(res.buffed).toBe(true)
  })

  it('lumira brew heals and wipes all active potions (eat or drink)', () => {
    const actor = { hp: 40, maxHP: 99, activePotions: { attack_potion: 400, super_combat: 200 } }
    const res = applyConsumableEffect(actor, ITEMS.lumira_brew, 'lumira_brew', 'drink')
    expect(actor.hp).toBe(62) // +22
    expect(actor.activePotions).toEqual({})
    expect(res.wiped).toBe(true)
  })

  it('prayer/super restore potions are consumed for no live effect', () => {
    const actor = { hp: 50, maxHP: 99, activePotions: {} }
    applyConsumableEffect(actor, ITEMS.prayer_potion, 'prayer_potion', 'drink')
    expect(actor.hp).toBe(50)                       // no heal
    expect(getActivePotionBoosts(actor.activePotions, ITEMS)).toEqual({ attack: 0, strength: 0, defence: 0, ranged: 0, magic: 0 })
  })

  it('restore potions are not registered as timed buffs (no countdown)', () => {
    // Single-use restores must not appear in activePotions, so the combat UI
    // never shows a time-down icon for them.
    const actor = { hp: 50, maxHP: 99, activePotions: {}, prayerPoints: 5, maxPrayerPoints: 50 }
    applyConsumableEffect(actor, ITEMS.prayer_potion, 'prayer_potion', 'drink')
    expect(actor.activePotions).toEqual({})
    expect(actor.prayerPoints).toBe(25)             // +20 prayer restore
    applyConsumableEffect(actor, ITEMS.super_restore, 'super_restore', 'drink')
    expect(actor.activePotions).toEqual({})
    expect(actor.prayerPoints).toBe(47)             // +22 super restore
  })
})

describe('resolveInventoryEat (out-of-combat eating)', () => {
  const inv = (...slots: any[]) => [...slots, null, null]

  it('heals and consumes one food, leaving the rest of the stack', () => {
    const inventory = inv({ itemId: 'shark', quantity: 3 })
    const r: any = resolveInventoryEat({ inventory, slotIndex: 0, item: ITEMS.shark, currentHP: 40, maxHP: 99 })
    expect(r.ok).toBe(true)
    expect(r.healed).toBe(20)
    expect(r.hp).toBe(60)
    expect(r.inventory[0]).toEqual({ itemId: 'shark', quantity: 2 })
    expect(inventory[0]).toEqual({ itemId: 'shark', quantity: 3 })   // pure: input untouched
  })

  it('clears the slot when the last one is eaten and clamps the heal to max HP', () => {
    const inventory = inv({ itemId: 'shark', quantity: 1 })
    const r: any = resolveInventoryEat({ inventory, slotIndex: 0, item: ITEMS.shark, currentHP: 95, maxHP: 99 })
    expect(r.ok).toBe(true)
    expect(r.hp).toBe(99)
    expect(r.healed).toBe(4)
    expect(r.inventory[0]).toBe(null)
  })

  it('refuses at full HP without consuming the food', () => {
    const inventory = inv({ itemId: 'shark', quantity: 1 })
    const r: any = resolveInventoryEat({ inventory, slotIndex: 0, item: ITEMS.shark, currentHP: 99, maxHP: 99 })
    expect(r).toEqual({ ok: false, reason: 'full_hp' })
  })

  it('refuses noted food, non-food and a slot that no longer holds the item', () => {
    expect(resolveInventoryEat({ inventory: inv({ itemId: 'shark', quantity: 1, noted: true }), slotIndex: 0, item: ITEMS.shark, currentHP: 10, maxHP: 99 }))
      .toEqual({ ok: false, reason: 'noted' })
    expect(resolveInventoryEat({ inventory: inv({ itemId: 'bronze_dagger', quantity: 1 }), slotIndex: 0, item: ITEMS.bronze_dagger, currentHP: 10, maxHP: 99 }))
      .toEqual({ ok: false, reason: 'not_food' })
    expect(resolveInventoryEat({ inventory: inv({ itemId: 'trout', quantity: 1 }), slotIndex: 0, item: ITEMS.shark, currentHP: 10, maxHP: 99 }))
      .toEqual({ ok: false, reason: 'missing' })
    expect(resolveInventoryEat({ inventory: inv(null), slotIndex: 5, item: ITEMS.shark, currentHP: 10, maxHP: 99 }))
      .toEqual({ ok: false, reason: 'missing' })
  })

  it('honours the legacy `heal` field the same way live combat does', () => {
    const r: any = resolveInventoryEat({ inventory: inv({ itemId: 'trout', quantity: 1 }), slotIndex: 0, item: ITEMS.trout, currentHP: 10, maxHP: 99 })
    expect(r.ok).toBe(true)
    expect(r.healed).toBe(getHealAmount(ITEMS.trout))
  })
})
