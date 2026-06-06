import { describe, it, expect } from 'vitest'
import { rollBotLootBox, isZestaUnique } from '../src/engine/pvpBotRewards.js'
import { computeBotIntents } from '../src/engine/pvpBotAI.js'
import itemsData from '../src/data/items.json' assert { type: 'json' }
import pvpBots from '../src/data/pvpBots.json' assert { type: 'json' }
import collectionLogData from '../src/data/collectionLog.json' assert { type: 'json' }

// ── Loot box ──────────────────────────────────────────────────────────────────

describe('rollBotLootBox', () => {
  const RUNS = 10_000

  it('always returns at least one item', () => {
    for (let i = 0; i < 100; i++) {
      const rewards = rollBotLootBox()
      expect(rewards.length).toBeGreaterThan(0)
    }
  })

  it('Zesta unique drop rate is approximately 2%', () => {
    let zestaCount = 0
    for (let i = 0; i < RUNS; i++) {
      const rewards = rollBotLootBox()
      if (rewards.some((r: any) => isZestaUnique(r.itemId))) zestaCount++
    }
    const rate = zestaCount / RUNS
    expect(rate).toBeGreaterThan(0.005)   // at least 0.5%
    expect(rate).toBeLessThan(0.05)       // at most 5%
  })

  it('coins drops have positive quantity', () => {
    for (let i = 0; i < 200; i++) {
      const rewards = rollBotLootBox()
      for (const r of rewards) {
        expect(r.quantity).toBeGreaterThan(0)
      }
    }
  })

  it('every itemId is either coins or a Zesta unique', () => {
    const VALID = new Set(['coins', 'zesta_longsword', 'zesta_vest', 'zesta_skirt'])
    for (let i = 0; i < 500; i++) {
      for (const r of rollBotLootBox()) {
        expect(VALID.has(r.itemId)).toBe(true)
      }
    }
  })
})

describe('isZestaUnique', () => {
  it('returns true for Zesta items', () => {
    expect(isZestaUnique('zesta_longsword')).toBe(true)
    expect(isZestaUnique('zesta_vest')).toBe(true)
    expect(isZestaUnique('zesta_skirt')).toBe(true)
  })
  it('returns false for non-Zesta items', () => {
    expect(isZestaUnique('coins')).toBe(false)
    expect(isZestaUnique('dragon_dagger')).toBe(false)
    expect(isZestaUnique('')).toBe(false)
  })
})

// ── Zesta items in items.json ─────────────────────────────────────────────────

describe('Zesta item definitions', () => {
  it('zesta_longsword exists with correct stats', () => {
    const item = (itemsData as any)['zesta_longsword']
    expect(item).toBeDefined()
    expect(item.slot).toBe('weapon')
    expect(item.attackSpeed).toBe(4)
    expect(item.requirements?.attack).toBe(60)
    expect(item.specialAttack?.type).toBe('overpower')
    expect(item.specialAttack?.energyCost).toBe(25)
  })

  it('zesta_vest exists with body slot and strength bonus', () => {
    const item = (itemsData as any)['zesta_vest']
    expect(item).toBeDefined()
    expect(item.slot).toBe('body')
    expect(item.requirements?.defence).toBe(45)
    expect(item.otherBonus?.meleeStrength).toBe(10)
  })

  it('zesta_skirt exists with legs slot and strength bonus', () => {
    const item = (itemsData as any)['zesta_skirt']
    expect(item).toBeDefined()
    expect(item.slot).toBe('legs')
    expect(item.requirements?.defence).toBe(45)
    expect(item.otherBonus?.meleeStrength).toBe(8)
  })
})

// ── Collection log ────────────────────────────────────────────────────────────

describe('PvP collection log category', () => {
  const pvpCat = (collectionLogData as any).categories.find((c: any) => c.id === 'pvp')

  it('has a pvp category', () => {
    expect(pvpCat).toBeDefined()
  })

  it('has a pvp_bots section with all three Zesta items', () => {
    const section = pvpCat?.sections?.find((s: any) => s.id === 'pvp_bots')
    expect(section).toBeDefined()
    expect(section.items).toContain('zesta_longsword')
    expect(section.items).toContain('zesta_vest')
    expect(section.items).toContain('zesta_skirt')
  })

  it('no duplicate item ids within the pvp_bots section', () => {
    const section = pvpCat?.sections?.find((s: any) => s.id === 'pvp_bots')
    const set = new Set(section?.items || [])
    expect(set.size).toBe(section.items.length)
  })
})

// ── Bot templates ─────────────────────────────────────────────────────────────

describe('pvpBots.json template', () => {
  it('has at least one bot', () => {
    expect(pvpBots.bots.length).toBeGreaterThan(0)
  })

  it('maxpurebot_v1 has exactly 28 inventory slots and prayer 52', () => {
    const bot = pvpBots.bots.find((b: any) => b.id === 'maxpurebot_v1')
    expect(bot).toBeDefined()
    expect(bot.inventory.length).toBe(28)
    expect(bot.stats.prayer).toBe(52)
    expect(bot.username).toBe('maxpurebot')
  })

  it('maxmainbot_v1 has exactly 28 inventory slots and all stats 99', () => {
    const bot = pvpBots.bots.find((b: any) => b.id === 'maxmainbot_v1')
    expect(bot).toBeDefined()
    expect(bot.inventory.length).toBe(28)
    expect(bot.username).toBe('maxmainbot')
    for (const [skill, level] of Object.entries(bot.stats as Record<string, number>)) {
      expect(level).toBe(99)
    }
  })

  it('all bot template item ids exist in items.json', () => {
    for (const bot of pvpBots.bots) {
      for (const [, item] of Object.entries(bot.equipment as Record<string, any>)) {
        if (item) expect((itemsData as any)[item.itemId]).toBeDefined()
      }
      for (const slot of bot.inventory) {
        if (slot) expect((itemsData as any)[(slot as any).itemId]).toBeDefined()
      }
    }
  })
})

// ── Bot AI ────────────────────────────────────────────────────────────────────

function makeCombatant(overrides: Record<string, any> = {}) {
  return {
    characterId: 99,
    username: 'Bot',
    hp: 99,
    maxHP: 99,
    stats: { attack: 60, strength: 99, defence: 1, hitpoints: 99, ranged: 99, magic: 99, prayer: 1 },
    equipment: {
      weapon: { itemId: 'magic_shortbow' },
      ammo:   { itemId: 'dragon_arrow', quantity: 500 },
    },
    inventory: [
      { itemId: 'super_combat', quantity: 1 },
      { itemId: 'dragon_dagger', quantity: 1 },
      { itemId: 'dragon_battleaxe', quantity: 1 },
      ...Array.from({ length: 25 }, () => ({ itemId: 'manta_ray', quantity: 1 })),
    ],
    combatType: 'ranged',
    stance: 'rapid',
    attackTimer: 0,
    eatCooldown: 0,
    potionCooldown: 0,
    activePotions: {},
    activeCombatPrayer: null,
    specialAttackEnergy: 100,
    specialAttackQueued: false,
    isBot: true,
    ...overrides,
  }
}

function makeOpponent(overrides: Record<string, any> = {}) {
  return {
    characterId: 1,
    username: 'Human',
    hp: 50,
    maxHP: 99,
    stats: { attack: 70, strength: 70, defence: 70, hitpoints: 99, ranged: 1, magic: 1, prayer: 70 },
    equipment: { weapon: { itemId: 'dragon_scimitar' } },
    inventory: [],
    combatType: 'melee',
    stance: 'aggressive',
    attackTimer: 4,
    eatCooldown: 0,
    potionCooldown: 0,
    activePotions: {},
    activeCombatPrayer: null,
    specialAttackEnergy: 100,
    specialAttackQueued: false,
    ...overrides,
  }
}

function makeState(bot: any, opponent: any) {
  return {
    tick: 5,
    combatants: {
      [String(bot.characterId)]: bot,
      [String(opponent.characterId)]: opponent,
    },
  }
}

describe('computeBotIntents', () => {
  it('returns an array', () => {
    const state = makeState(makeCombatant(), makeOpponent())
    const intents = computeBotIntents(state, 99, itemsData)
    expect(Array.isArray(intents)).toBe(true)
  })

  it('drinks potion when none active', () => {
    const bot = makeCombatant({ activePotions: {}, potionCooldown: 0 })
    const state = makeState(bot, makeOpponent())
    const intents = computeBotIntents(state, 99, itemsData)
    expect(intents.some((i: any) => i.type === 'drink_potion')).toBe(true)
  })

  it('does not drink potion when already active', () => {
    const bot = makeCombatant({ activePotions: { super_combat: 50 }, potionCooldown: 0 })
    const state = makeState(bot, makeOpponent())
    const intents = computeBotIntents(state, 99, itemsData)
    expect(intents.some((i: any) => i.type === 'drink_potion')).toBe(false)
  })

  it('activates a damage prayer when none active', () => {
    const bot = makeCombatant({ activeCombatPrayer: null })
    const state = makeState(bot, makeOpponent())
    const intents = computeBotIntents(state, 99, itemsData)
    expect(intents.some((i: any) => i.type === 'toggle_prayer')).toBe(true)
  })

  it('does not re-activate prayer when already active', () => {
    const bot = makeCombatant({ activeCombatPrayer: 'rigour' })
    const state = makeState(bot, makeOpponent())
    const intents = computeBotIntents(state, 99, itemsData)
    expect(intents.some((i: any) => i.type === 'toggle_prayer')).toBe(false)
  })

  it('eats when hp is critically low', () => {
    const bot = makeCombatant({ hp: 5, maxHP: 99, eatCooldown: 0 })
    const state = makeState(bot, makeOpponent())
    const intents = computeBotIntents(state, 99, itemsData)
    expect(intents.some((i: any) => i.type === 'eat')).toBe(true)
  })

  it('does not eat when eat cooldown is active', () => {
    const bot = makeCombatant({ hp: 5, maxHP: 99, eatCooldown: 2 })
    const state = makeState(bot, makeOpponent())
    const intents = computeBotIntents(state, 99, itemsData)
    expect(intents.some((i: any) => i.type === 'eat')).toBe(false)
  })

  it('queues spec when energy is capped and weapon has cheap spec', () => {
    const bot = makeCombatant({
      equipment: {
        weapon: { itemId: 'dragon_dagger' },
      },
      activePotions: { super_combat: 50 },
      activeCombatPrayer: 'piety',
      specialAttackEnergy: 100,
      attackTimer: 0,
      eatCooldown: 0,
      combatType: 'melee',
    })
    const state = makeState(bot, makeOpponent({ hp: 80 }))
    const intents = computeBotIntents(state, 99, itemsData)
    expect(intents.some((i: any) => i.type === 'queue_special')).toBe(true)
  })

  it('swaps to a finisher weapon when the bow cannot KO but the bag weapon can', () => {
    // Opponent on very low hp: a melee finisher (dagger spec) should be able
    // to KO when the equipped bow's snapshot cannot reach.
    const bot = makeCombatant({
      equipment: {
        weapon: { itemId: 'magic_shortbow' },
        ammo:   { itemId: 'dragon_arrow', quantity: 500 },
      },
      activePotions: { super_combat: 50 },
      activeCombatPrayer: 'rigour',
      specialAttackEnergy: 100,
      attackTimer: 1,
      eatCooldown: 0,
      combatType: 'ranged',
    })
    // hp 50 is above the bow snapshot ceiling (36) but within the dragon
    // dagger double-hit burst (56), so the bot should swap to the dagger.
    const state = makeState(bot, makeOpponent({ hp: 50, attackTimer: 4 }))
    const intents = computeBotIntents(state, 99, itemsData)
    const equip = intents.find((i: any) => i.type === 'equip')
    expect(equip).toBeDefined()
    // The equipped slot must be a finisher weapon from the bag.
    const equippedId = bot.inventory[equip.inventorySlot].itemId
    expect(['dragon_dagger', 'dragon_battleaxe']).toContain(equippedId)
  })

  it('swaps back to the highest-DPS weapon when no KO is available', () => {
    // Bot is stuck on the battleaxe but the opponent is at full hp — it
    // should return to the magic shortbow (its primary DPS weapon).
    const bot = makeCombatant({
      equipment: { weapon: { itemId: 'dragon_battleaxe' } },
      inventory: [
        { itemId: 'magic_shortbow', quantity: 1 },
        { itemId: 'dragon_dagger', quantity: 1 },
        ...Array.from({ length: 26 }, () => ({ itemId: 'manta_ray', quantity: 1 })),
      ],
      activePotions: { super_combat: 50 },
      activeCombatPrayer: 'piety',
      specialAttackEnergy: 0,
      attackTimer: 1,
      eatCooldown: 0,
      combatType: 'melee',
    })
    const state = makeState(bot, makeOpponent({ hp: 99, attackTimer: 4 }))
    const intents = computeBotIntents(state, 99, itemsData)
    const equip = intents.find((i: any) => i.type === 'equip')
    expect(equip).toBeDefined()
    expect(bot.inventory[equip.inventorySlot].itemId).toBe('magic_shortbow')
  })

  it('specs to kill through an eat even when a normal hit could kill a non-eating foe', () => {
    // Opponent at hp 30 with food: a normal bow hit (max 25) cannot secure
    // the kill through a 22-heal eat (needs 52), and the bow snapshot (36)
    // also falls short — so the bot should swap to the dragon dagger
    // (double-hit burst 56 >= 52) to push the kill through the heal.
    const bot = makeCombatant({
      equipment: {
        weapon: { itemId: 'magic_shortbow' },
        ammo:   { itemId: 'dragon_arrow', quantity: 500 },
      },
      activePotions: { super_combat: 50 },
      activeCombatPrayer: 'rigour',
      specialAttackEnergy: 100,
      attackTimer: 1,
      eatCooldown: 0,
      combatType: 'ranged',
    })
    const opponent = makeOpponent({
      hp: 30,
      attackTimer: 4,
      eatCooldown: 0,
      inventory: [{ itemId: 'manta_ray', quantity: 5 }],
    })
    const intents = computeBotIntents(makeState(bot, opponent), 99, itemsData)
    const equip = intents.find((i: any) => i.type === 'equip')
    expect(equip).toBeDefined()
    expect(bot.inventory[equip.inventorySlot].itemId).toBe('dragon_dagger')
  })

  it('does not waste a spec when the opponent has no food and a normal hit kills', () => {
    const bot = makeCombatant({
      equipment: { weapon: { itemId: 'magic_shortbow' }, ammo: { itemId: 'dragon_arrow', quantity: 500 } },
      activePotions: { super_combat: 50 },
      activeCombatPrayer: 'rigour',
      specialAttackEnergy: 100,
      attackTimer: 1,
      eatCooldown: 0,
      combatType: 'ranged',
    })
    // hp 10, no food → a normal swing (max 25) secures it; no spec/swap.
    const opponent = makeOpponent({ hp: 10, attackTimer: 4, inventory: [] })
    const intents = computeBotIntents(makeState(bot, opponent), 99, itemsData)
    expect(intents.some((i: any) => i.type === 'queue_special')).toBe(false)
    expect(intents.some((i: any) => i.type === 'equip')).toBe(false)
  })

  it('matches prayer + stance to the weapon it plans to wield', () => {
    const bot = makeCombatant({
      equipment: { weapon: { itemId: 'magic_shortbow' }, ammo: { itemId: 'dragon_arrow', quantity: 500 } },
      activeCombatPrayer: 'piety',     // wrong prayer for ranged
      stance: 'aggressive',            // wrong stance for ranged
      attackTimer: 5,                  // not swinging — stays on bow
      combatType: 'ranged',
      activePotions: { super_combat: 50 },
    })
    const state = makeState(bot, makeOpponent({ hp: 99 }))
    const intents = computeBotIntents(state, 99, itemsData)
    expect(intents.some((i: any) => i.type === 'toggle_prayer' && i.prayerId === 'rigour')).toBe(true)
    expect(intents.some((i: any) => i.type === 'change_stance' && i.stance === 'rapid')).toBe(true)
  })

  it('returns no intents when invalid state', () => {
    expect(computeBotIntents(null as any, 99, itemsData)).toEqual([])
    expect(computeBotIntents({} as any, 99, itemsData)).toEqual([])
  })
})
