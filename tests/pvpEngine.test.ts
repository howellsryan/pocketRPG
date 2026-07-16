import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildPlayerCombatant } from '../src/engine/combatant.js'
import { createPvpState, processPvpTick } from '../src/engine/pvpEngine.js'
import realItemsData from '../src/data/items.json'
import { SUPPORTED_PVP_SPECIAL_ATTACK_TYPES } from '../src/engine/pvpSpecialAttacks.js'

const items = {
  nether_demon_whip: {
    id: 'nether_demon_whip', slot: 'weapon', attackStyle: 'slash', attackSpeed: 4,
    attackBonus: { stab: 0, slash: 82, crush: 0, magic: 0, ranged: 0 },
    defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    otherBonus: { meleeStrength: 82, rangedStrength: 0, magicDamage: 0 },
  },
  test_bow: {
    id: 'test_bow', slot: 'weapon', attackStyle: 'ranged', attackSpeed: 4,
    attackBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 60 },
    defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    otherBonus: { meleeStrength: 0, rangedStrength: 40, magicDamage: 0 },
  },
  dragon_arrow: { id: 'dragon_arrow', slot: 'ammo', stackable: true, otherBonus: { rangedStrength: 60 } },
  shark: { id: 'shark', type: 'food', heals: 20, stackable: false },
  karam: { id: 'karam', type: 'food', heals: 18, combo: true, stackable: false },
  attack_potion: { id: 'attack_potion', type: 'potion', effect: 'attack', boost: 13, duration: 300 },
  strength_potion: { id: 'strength_potion', type: 'potion', effect: 'strength', boost: 13, duration: 300 },
  defence_potion: { id: 'defence_potion', type: 'potion', effect: 'defence', boost: 13, duration: 300 },
  ranging_potion: { id: 'ranging_potion', type: 'potion', effect: 'ranged', boost: 14, duration: 300 },
  prayer_potion: { id: 'prayer_potion', type: 'potion', effect: 'prayer', boost: 32, duration: 300 },
  imbued_brain: { id: 'imbued_brain', type: 'potion', effect: 'magic', boost: 18, duration: 300, unlimited: true },
}

function buildPlayer(overrides: any = {}) {
  return buildPlayerCombatant({
    characterId: overrides.characterId ?? 1,
    username: overrides.username ?? 'Tester',
    stats: {
      attack:    { xp: 13_034_431, level: 99 },
      strength:  { xp: 13_034_431, level: 99 },
      defence:   { xp: 13_034_431, level: 99 },
      hitpoints: { xp: 13_034_431, level: 99 },
      ranged:    { xp: 13_034_431, level: 99 },
      magic:     { xp: 13_034_431, level: 99 },
      prayer:    { xp: 13_034_431, level: 99 },
      ...overrides.stats,
    },
    equipment: overrides.equipment ?? { weapon: { itemId: 'nether_demon_whip' } },
    inventory: overrides.inventory ?? [],
    stance: overrides.stance ?? 'aggressive',
    currentHP: overrides.currentHP,
    maxHP: overrides.maxHP,
    combatType: overrides.combatType,
    spell: overrides.spell,
    itemsData: items,
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('pvpEngine phase 2B contract', () => {
  it('forfeit short-circuits immediately and returns terminal', () => {
    const a = buildPlayer({ characterId: 1 })
    const b = buildPlayer({ characterId: 2 })
    const state = createPvpState(a, b, 0)

    const out = processPvpTick(state, [
      { tick_number: 1, characterId: 2, characterSeq: 1, action: { type: 'forfeit' } },
    ], items)

    expect(out.terminal).toEqual({ winner: 1, loser: 2, reason: 'forfeit' })
    expect(out.stateNext.tick).toBe(1)
  })

  it('resolves attacks simultaneously and applies lower-id tiebreak on double KO', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)

    const a = buildPlayer({ characterId: 1, currentHP: 1 })
    const b = buildPlayer({ characterId: 2, currentHP: 1 })
    const state = createPvpState(a, b, 0)

    const out = processPvpTick(state, [], items)
    expect(out.events.filter(e => e.type === 'attack')).toHaveLength(2)
    expect(out.terminal).toEqual({ winner: 1, loser: 2, reason: 'death' })
    expect(out.stateNext.combatants['1'].hp).toBe(0)
    expect(out.stateNext.combatants['2'].hp).toBe(0)
  })

  it('applies eat intent before attack resolution in the same tick', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)

    const a = buildPlayer({ characterId: 1, currentHP: 1, inventory: [{ itemId: 'shark', quantity: 1 }] })
    const b = buildPlayer({ characterId: 2, currentHP: 1 })
    const state = createPvpState(a, b, 0)

    const out = processPvpTick(state, [
      { tick_number: 1, characterId: 1, characterSeq: 1, action: { type: 'eat', inventorySlot: 0 } },
    ], items)

    expect(out.events.some(e => e.type === 'eat')).toBe(true)
    expect(out.stateNext.combatants['1'].hp).toBeGreaterThan(0)
  })

  it('eats a normal food and a combo food on the same tick (both heal)', () => {
    const a = buildPlayer({
      characterId: 1, currentHP: 10, maxHP: 99,
      inventory: [{ itemId: 'shark', quantity: 1 }, { itemId: 'karam', quantity: 1 }],
    })
    const b = buildPlayer({ characterId: 2, currentHP: 99 })
    const state = createPvpState(a, b, 0)
    state.combatants['1'].attackTimer = 99
    state.combatants['2'].attackTimer = 99

    const out = processPvpTick(state, [
      { tick_number: 1, characterId: 1, characterSeq: 1, action: { type: 'eat', inventorySlot: 0 } },
      { tick_number: 1, characterId: 1, characterSeq: 2, action: { type: 'eat', inventorySlot: 1 } },
    ], items)

    // Shark (20) + Karam (18) both land: 10 + 20 + 18 = 48
    expect(out.stateNext.combatants['1'].hp).toBe(48)
    expect(out.events.filter((e: any) => e.type === 'eat').length).toBe(2)
  })

  it('eats a normal food and drinks a potion on the same tick (heal + boost together)', () => {
    const a = buildPlayer({
      characterId: 1, currentHP: 10, maxHP: 99,
      inventory: [{ itemId: 'shark', quantity: 1 }, { itemId: 'strength_potion', quantity: 1 }],
    })
    const b = buildPlayer({ characterId: 2, currentHP: 99 })
    const state = createPvpState(a, b, 0)
    state.combatants['1'].attackTimer = 99
    state.combatants['2'].attackTimer = 99

    const out = processPvpTick(state, [
      { tick_number: 1, characterId: 1, characterSeq: 1, action: { type: 'eat', inventorySlot: 0 } },
      { tick_number: 1, characterId: 1, characterSeq: 2, action: { type: 'drink_potion', inventorySlot: 1 } },
    ], items)

    const self = out.stateNext.combatants['1']
    expect(self.hp).toBe(30)                                   // shark healed +20
    expect(self.activePotions.strength_potion).toBeGreaterThan(0) // boost applied same tick
    expect(out.events.some((e: any) => e.type === 'eat')).toBe(true)
    expect(out.events.some((e: any) => e.type === 'drink')).toBe(true)
  })

  it('drinking an unlimited-use potion applies the buff without removing it from inventory', () => {
    const a = buildPlayer({
      characterId: 1, currentHP: 99, maxHP: 99,
      inventory: [{ itemId: 'imbued_brain', quantity: 1 }],
    })
    const b = buildPlayer({ characterId: 2, currentHP: 99 })
    const state = createPvpState(a, b, 0)
    state.combatants['1'].attackTimer = 99
    state.combatants['2'].attackTimer = 99

    const out = processPvpTick(state, [
      { tick_number: 1, characterId: 1, characterSeq: 1, action: { type: 'drink_potion', inventorySlot: 0 } },
    ], items)

    const self = out.stateNext.combatants['1']
    expect(self.activePotions.imbued_brain).toBeGreaterThan(0)
    expect(self.inventory[0]).toEqual({ itemId: 'imbued_brain', quantity: 1 })
  })

  it('blocks a second normal food on the same tick (shared eat cooldown)', () => {
    const a = buildPlayer({
      characterId: 1, currentHP: 10, maxHP: 99,
      inventory: [{ itemId: 'shark', quantity: 1 }, { itemId: 'shark', quantity: 1 }],
    })
    const b = buildPlayer({ characterId: 2, currentHP: 99 })
    const state = createPvpState(a, b, 0)
    state.combatants['1'].attackTimer = 99
    state.combatants['2'].attackTimer = 99

    const out = processPvpTick(state, [
      { tick_number: 1, characterId: 1, characterSeq: 1, action: { type: 'eat', inventorySlot: 0 } },
      { tick_number: 1, characterId: 1, characterSeq: 2, action: { type: 'eat', inventorySlot: 1 } },
    ], items)

    // Only the first shark lands: 10 + 20 = 30
    expect(out.stateNext.combatants['1'].hp).toBe(30)
    expect(out.events.filter((e: any) => e.type === 'eat').length).toBe(1)
  })

  it('recomputes combatType when a weapon of a different style is equipped', () => {
    // Start ranged (test bow), swap to a melee weapon (whip) mid-fight.
    const a = buildPlayer({
      characterId: 1,
      equipment: { weapon: { itemId: 'test_bow' }, ammo: { itemId: 'dragon_arrow', quantity: 100 } },
      inventory: [{ itemId: 'nether_demon_whip', quantity: 1 }],
    })
    const b = buildPlayer({ characterId: 2 })
    const state = createPvpState(a, b, 0)
    expect(state.combatants['1'].combatType).toBe('ranged')

    const out = processPvpTick(state, [
      { tick_number: 1, characterId: 1, characterSeq: 1, action: { type: 'equip', inventorySlot: 0 } },
    ], items)

    expect(out.stateNext.combatants['1'].combatType).toBe('melee')
    expect(out.stateNext.combatants['1'].equipment.weapon.itemId).toBe('nether_demon_whip')
  })

  it('equipping a weapon while ready swings on the same tick (no swap delay)', () => {
    const a = buildPlayer({
      characterId: 1,
      equipment: {}, // unarmed
      inventory: [{ itemId: 'nether_demon_whip', quantity: 1 }],
    })
    const b = buildPlayer({ characterId: 2 })
    const state = createPvpState(a, b, 0)
    state.combatants['1'].attackTimer = 0 // ready to attack
    state.combatants['2'].attackTimer = 99

    const out = processPvpTick(state, [
      { tick_number: 1, characterId: 1, characterSeq: 1, action: { type: 'equip', inventorySlot: 0 } },
    ], items)

    // Swung with the freshly equipped weapon this very tick (OSRS parity)…
    expect(out.events.some(e => e.type === 'attack' && e.attackerCharacterId === 1)).toBe(true)
    // …and the next attack is governed by the new weapon's speed (4).
    expect(out.stateNext.combatants['1'].attackTimer).toBe(4)
  })

  it('equipping mid-cooldown neither resets nor extends the attack timer', () => {
    const a = buildPlayer({
      characterId: 1,
      equipment: { weapon: { itemId: 'nether_demon_whip' } },
      inventory: [{ itemId: 'test_bow', quantity: 1 }, { itemId: 'dragon_arrow', quantity: 100 }],
    })
    const b = buildPlayer({ characterId: 2 })
    const state = createPvpState(a, b, 0)
    state.combatants['1'].attackTimer = 5
    state.combatants['2'].attackTimer = 99

    const out = processPvpTick(state, [
      { tick_number: 1, characterId: 1, characterSeq: 1, action: { type: 'equip', inventorySlot: 0 } },
    ], items)

    // Timer just ticks down by one (5 → 4); the swap left it untouched.
    expect(out.stateNext.combatants['1'].attackTimer).toBe(4)
    expect(out.events.some(e => e.type === 'attack' && e.attackerCharacterId === 1)).toBe(false)
  })

  it('drinks a potion: consumes the dose and applies the boost', () => {
    const a = buildPlayer({ characterId: 1, inventory: [{ itemId: 'strength_potion', quantity: 2 }] })
    const b = buildPlayer({ characterId: 2 })
    const state = createPvpState(a, b, 0)
    expect(state.combatants['1'].activePotions?.strength_potion ?? 0).toBe(0)

    const out = processPvpTick(state, [
      { tick_number: 1, characterId: 1, characterSeq: 1, action: { type: 'drink_potion', inventorySlot: 0 } },
    ], items)

    const self = out.stateNext.combatants['1']
    expect(out.events.some(e => e.type === 'drink' && e.characterId === 1)).toBe(true)
    expect(self.activePotions.strength_potion).toBeGreaterThan(0)   // boost active
    expect(self.inventory[0].quantity).toBe(1)                       // one dose consumed
  })

  it('uses heals field value for PvP eat intent', () => {
    const a = buildPlayer({ characterId: 1, currentHP: 10, maxHP: 99, inventory: [{ itemId: 'shark', quantity: 1 }] })
    const b = buildPlayer({ characterId: 2, currentHP: 99 })
    const state = createPvpState(a, b, 0)
    state.combatants['1'].attackTimer = 99
    state.combatants['2'].attackTimer = 99

    const out = processPvpTick(state, [
      { tick_number: 1, characterId: 1, characterSeq: 1, action: { type: 'eat', inventorySlot: 0 } },
    ], items)

    expect(out.stateNext.combatants['1'].hp).toBe(30)
    expect(out.events.find((e: any) => e.type === 'eat')?.heal).toBe(20)
  })

  it('eating delays the next player attack timer by weapon speed', () => {
    const a = buildPlayer({
      characterId: 1,
      currentHP: 10,
      maxHP: 99,
      inventory: [{ itemId: 'shark', quantity: 1 }],
    })
    const b = buildPlayer({ characterId: 2, currentHP: 99 })

    const state = createPvpState(a, b, 0)
    state.combatants['1'].attackTimer = 0
    state.combatants['2'].attackTimer = 99

    const out = processPvpTick(state, [
      { tick_number: 1, characterId: 1, characterSeq: 1, action: { type: 'eat', inventorySlot: 0 } },
    ], items)

    expect(out.events.some((e: any) => e.type === 'eat')).toBe(true)
    expect(out.events.some((e: any) => e.type === 'attack' && e.attackerCharacterId === 1)).toBe(false)
    expect(out.stateNext.combatants['1'].attackTimer).toBe(4)
  })

  it('drains the prayer pool while a combat prayer is active', () => {
    const a = buildPlayer({ characterId: 1 })
    const b = buildPlayer({ characterId: 2 })
    let state = createPvpState(a, b, 0)
    state.combatants['1'].attackTimer = 99
    state.combatants['2'].attackTimer = 99
    expect(state.combatants['1'].prayerPoints).toBe(99) // = Prayer level

    // Activate a damage prayer, then let several ticks elapse.
    let out = processPvpTick(state, [
      { tick_number: 1, characterId: 1, characterSeq: 1, action: { type: 'toggle_prayer', prayerId: 'piety' } },
    ], items)
    expect(out.stateNext.combatants['1'].activeCombatPrayer).toBe('piety')

    for (let i = 0; i < 250; i++) out = processPvpTick(out.stateNext, [], items)
    // Piety drains 40/min = 0.4/tick → 250 ticks ≈ 100 points, so a 99 pool empties.
    expect(out.stateNext.combatants['1'].prayerPoints).toBe(0)
    expect(out.stateNext.combatants['1'].activeCombatPrayer).toBe(null) // switched off when empty
  })

  it('restores prayer points when a prayer potion is drunk', () => {
    const a = buildPlayer({ characterId: 1, inventory: [{ itemId: 'prayer_potion', quantity: 1 }] })
    const b = buildPlayer({ characterId: 2 })
    const state = createPvpState(a, b, 0)
    state.combatants['1'].attackTimer = 99
    state.combatants['2'].attackTimer = 99
    state.combatants['1'].prayerPoints = 50

    const out = processPvpTick(state, [
      { tick_number: 1, characterId: 1, characterSeq: 1, action: { type: 'drink_potion', inventorySlot: 0 } },
    ], items)
    // +20 from the prayer potion, capped at maxPrayerPoints (99).
    expect(out.stateNext.combatants['1'].prayerPoints).toBe(70)
  })

  it('trims recentEvents to the latest 20 entries', () => {
    const a = buildPlayer({ characterId: 1 })
    const b = buildPlayer({ characterId: 2 })
    let state = createPvpState(a, b, 0)
    state.recentEvents = Array.from({ length: 20 }, (_, i) => ({ type: 'old', i }))

    const out = processPvpTick(state, [
      { tick_number: 1, characterId: 1, characterSeq: 1, action: { type: 'queue_special' } },
    ], items)

    expect(out.stateNext.recentEvents.length).toBeLessThanOrEqual(20)
  })

  it('tags emitted events with the tick they landed on', () => {
    const a = buildPlayer({ characterId: 1 })
    const b = buildPlayer({ characterId: 2 })
    const state = createPvpState(a, b, 0)
    state.combatants['1'].attackTimer = 1
    state.combatants['2'].attackTimer = 1

    const out = processPvpTick(state, [], items)

    expect(out.events.length).toBeGreaterThan(0)
    for (const ev of out.events) expect(ev.tick).toBe(out.stateNext.tick)
    for (const ev of out.stateNext.recentEvents) expect(ev.tick).toBe(out.stateNext.tick)
  })

  it('consumes special energy when a queued special fires', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)

    const specItems: any = {
      ...items,
      dragon_dagger: {
        id: 'dragon_dagger',
        slot: 'weapon',
        attackStyle: 'stab',
        attackSpeed: 4,
        attackBonus: { stab: 40, slash: 40, crush: -4, magic: 0, ranged: 0 },
        defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
        otherBonus: { meleeStrength: 40, rangedStrength: 0, magicDamage: 0 },
        specialAttack: { type: 'double_hit', energyCost: 25 },
      },
    }

    const a = buildPlayer({
      characterId: 1,
      equipment: { weapon: { itemId: 'dragon_dagger' } },
    })
    const b = buildPlayer({ characterId: 2 })
    const state = createPvpState(a, b, 0)

    const out = processPvpTick(state, [
      { tick_number: 1, characterId: 1, characterSeq: 1, action: { type: 'queue_special' } },
    ], specItems)

    expect(out.stateNext.combatants['1'].specialAttackEnergy).toBe(75)
    expect(out.events.some((e: any) => e.type === 'attack' && e.special === true)).toBe(true)
  })

  it('preserves PvP rank metadata on match combatants', () => {
    const a = buildPlayer({ characterId: 1 }) as any
    const b = buildPlayer({ characterId: 2 }) as any
    a.totalPvpKills = 2
    a.lastUpdatedTotalPvpKills = 1000
    a.pvpRank = 1
    b.totalPvpKills = 0
    b.lastUpdatedTotalPvpKills = null
    b.pvpRank = null

    const state = createPvpState(a, b, 0)

    expect(state.combatants['1'].totalPvpKills).toBe(2)
    expect(state.combatants['1'].pvpRank).toBe(1)
    expect(state.combatants['2'].totalPvpKills).toBe(0)
    expect(state.combatants['2'].pvpRank).toBeNull()
  })

  it('applies prayer bonuses without permanently inflating base stats', () => {
    const a = buildPlayer({ characterId: 1, stance: 'accurate' })
    const b = buildPlayer({ characterId: 2, stance: 'defensive' })
    const state = createPvpState(a, b, 0)
    state.combatants['1'].attackTimer = 0
    state.combatants['2'].attackTimer = 99

    const plain = processPvpTick(state, [], items)
    const prayed = processPvpTick(state, [
      { tick_number: 1, characterId: 1, characterSeq: 1, action: { type: 'toggle_prayer', prayerId: 'piety' } },
    ], items)

    const plainAttack = plain.events.find((e: any) => e.type === 'attack')
    const prayedAttack = prayed.events.find((e: any) => e.type === 'attack')
    expect(prayedAttack.attackRoll).toBeGreaterThan(plainAttack.attackRoll)
    expect(prayedAttack.maxHit).toBeGreaterThan(plainAttack.maxHit)
    expect(state.combatants['1'].stats.attack).toBe(99)
    expect(state.combatants['1'].stats.strength).toBe(99)
  })

  it('applies defender defence prayers', () => {
    const a = buildPlayer({ characterId: 1 })
    const b = buildPlayer({ characterId: 2, stance: 'defensive' })
    const state = createPvpState(a, b, 0)
    state.combatants['2'].attackTimer = 99

    const plain = processPvpTick(state, [], items)
    const prayedDef = processPvpTick(state, [
      { tick_number: 1, characterId: 2, characterSeq: 1, action: { type: 'toggle_prayer', prayerId: 'steel_skin' } },
    ], items)

    const plainAttack = plain.events.find((e: any) => e.type === 'attack')
    const prayedAttack = prayedDef.events.find((e: any) => e.type === 'attack')
    expect(prayedAttack.defenceRoll).toBeGreaterThan(plainAttack.defenceRoll)
  })

  it('applies ranged prayers (rigour) to attack roll and max hit', () => {
    const rangedItems: any = {
      ...items,
      magic_shortbow: {
        id: 'magic_shortbow',
        slot: 'weapon',
        attackStyle: 'ranged',
        attackSpeed: 4,
        attackBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 69 },
        defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
        otherBonus: { meleeStrength: 0, rangedStrength: 55, magicDamage: 0 },
      },
    }
    const a = buildPlayer({ characterId: 1, combatType: 'ranged', equipment: { weapon: { itemId: 'magic_shortbow' } }, stance: 'accurate' })
    const b = buildPlayer({ characterId: 2 })
    const state = createPvpState(a, b, 0)
    state.combatants['2'].attackTimer = 99
    const plain = processPvpTick(state, [], rangedItems)
    const rigour = processPvpTick(state, [
      { tick_number: 1, characterId: 1, characterSeq: 1, action: { type: 'toggle_prayer', prayerId: 'rigour' } },
    ], rangedItems)
    const a1 = plain.events.find((e: any) => e.type === 'attack')
    const a2 = rigour.events.find((e: any) => e.type === 'attack')
    expect(a2.attackRoll).toBeGreaterThan(a1.attackRoll)
    expect(a2.maxHit).toBeGreaterThan(a1.maxHit)
  })

  it('applies potion boosts and decrements potion duration', () => {
    const a = buildPlayer({ characterId: 1, inventory: [{ itemId: 'attack_potion', quantity: 1 }] })
    const b = buildPlayer({ characterId: 2 })
    let state = createPvpState(a, b, 0)
    state.combatants['1'].attackTimer = 99
    state.combatants['2'].attackTimer = 99

    let out = processPvpTick(state, [
      { tick_number: 1, characterId: 1, characterSeq: 1, action: { type: 'drink_potion', inventorySlot: 0 } },
    ], items)
    expect(out.events.some((e: any) => e.type === 'drink')).toBe(true)
    // Duration now matches PvE: 300s / 0.6 = 500 ticks, less 1 for this tick.
    const firstTicks = out.stateNext.combatants['1'].activePotions.attack_potion
    expect(firstTicks).toBe(499)

    out.stateNext.combatants['1'].attackTimer = 0
    out.stateNext.combatants['2'].attackTimer = 99
    const buffed = processPvpTick(out.stateNext, [], items)
    const buffedAttack = buffed.events.find((e: any) => e.type === 'attack')
    expect(buffedAttack.attackRoll).toBeGreaterThan(0)
  })

  it('second prayer toggle disables active prayer', () => {
    const a = buildPlayer({ characterId: 1 })
    const b = buildPlayer({ characterId: 2 })
    let state = createPvpState(a, b, 0)
    state.combatants['1'].attackTimer = 99
    state.combatants['2'].attackTimer = 99

    let out = processPvpTick(state, [
      { tick_number: 1, characterId: 1, characterSeq: 1, action: { type: 'toggle_prayer', prayerId: 'piety' } },
    ], items)
    expect(out.stateNext.combatants['1'].activeCombatPrayer).toBe('piety')

    out = processPvpTick(out.stateNext, [
      { tick_number: 2, characterId: 1, characterSeq: 2, action: { type: 'toggle_prayer', prayerId: 'piety' } },
    ], items)
    expect(out.stateNext.combatants['1'].activeCombatPrayer).toBeNull()
  })

  it('applies augury to magic attack and defender defence', () => {
    const mageItems: any = {
      ...items,
      trident: {
        id: 'trident',
        slot: 'weapon',
        attackStyle: 'magic',
        attackSpeed: 4,
        attackBonus: { stab: 0, slash: 0, crush: 0, magic: 25, ranged: 0 },
        defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
        otherBonus: { meleeStrength: 0, rangedStrength: 0, magicDamage: 0 },
      },
    }
    const a = buildPlayer({ characterId: 1, combatType: 'magic', equipment: { weapon: { itemId: 'trident' } }, spell: { id: 'fire_bolt', baseDamage: 12, runeReq: { fire_rune: 5, air_rune: 2 } } as any, inventory: [{ itemId: 'fire_rune', quantity: 1000 }, { itemId: 'air_rune', quantity: 1000 }] })
    const b = buildPlayer({ characterId: 2 })
    const state = createPvpState(a, b, 0)
    state.combatants['2'].attackTimer = 99

    const plain = processPvpTick(state, [], mageItems)
    const augury = processPvpTick(state, [
      { tick_number: 1, characterId: 1, characterSeq: 1, action: { type: 'toggle_prayer', prayerId: 'augury' } },
      { tick_number: 1, characterId: 2, characterSeq: 1, action: { type: 'toggle_prayer', prayerId: 'augury' } },
    ], mageItems)
    const a1 = plain.events.find((e: any) => e.type === 'attack')
    const a2 = augury.events.find((e: any) => e.type === 'attack' && e.attackerCharacterId === 1)
    expect(a2.attackRoll).toBeGreaterThan(a1.attackRoll)
    expect(a2.defenceRoll).toBeGreaterThan(a1.defenceRoll)
  })

  it('starts each PvP combatant at 100 special energy', () => {
    const a = buildPlayer({ characterId: 1 })
    const b = buildPlayer({ characterId: 2 })
    const state = createPvpState(a, b, 0)
    expect(state.combatants['1'].specialAttackEnergy).toBe(100)
    expect(state.combatants['2'].specialAttackEnergy).toBe(100)
  })

  describe('magic combat', () => {
    const mageItems: any = {
      ...items,
      battlestaff: {
        id: 'battlestaff', slot: 'weapon', attackStyle: 'magic', attackSpeed: 5,
        attackBonus: { stab: 0, slash: 0, crush: 0, magic: 15, ranged: 0 },
        defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
        otherBonus: { meleeStrength: 0, rangedStrength: 0, magicDamage: 0 },
      },
      trident: {
        id: 'trident', slot: 'weapon', attackStyle: 'magic', attackSpeed: 4, poweredStaff: true,
        attackBonus: { stab: 0, slash: 0, crush: 0, magic: 25, ranged: 0 },
        defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
        otherBonus: { meleeStrength: 0, rangedStrength: 0, magicDamage: 0 },
      },
      fire_staff: {
        id: 'fire_staff', slot: 'weapon', attackStyle: 'magic', attackSpeed: 5, elemental: 'fire_rune',
        attackBonus: { stab: 0, slash: 0, crush: 0, magic: 15, ranged: 0 },
        defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
        otherBonus: { meleeStrength: 0, rangedStrength: 0, magicDamage: 0 },
      },
    }
    const fireBolt = { id: 'fire_bolt', name: 'Fire Bolt', baseDamage: 12, levelReq: 35, baseXP: 22, runeReq: { fire_rune: 5, air_rune: 2 } }
    const mage = (overrides: any = {}) => buildPlayer({
      characterId: 1, combatType: 'magic',
      equipment: { weapon: { itemId: 'battlestaff' } },
      spell: { ...fireBolt },
      ...overrides,
    })

    it('casts a standard spell and consumes the required runes', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.01) // force a hit
      const a = mage({ inventory: [{ itemId: 'fire_rune', quantity: 5 }, { itemId: 'air_rune', quantity: 2 }] })
      const b = buildPlayer({ characterId: 2 })
      const state = createPvpState(a, b, 0)
      state.combatants['2'].attackTimer = 99
      const out = processPvpTick(state, [], mageItems)
      const attack = out.events.find((e: any) => e.type === 'attack' && e.attackerCharacterId === 1)
      expect(attack).toBeTruthy()
      expect(attack.style).toBe('magic')
      // 5 fire + 2 air runes consumed → inventory empty
      const inv = out.stateNext.combatants['1'].inventory.filter(Boolean)
      expect(inv.length).toBe(0)
    })

    it('blocks the cast and emits no_runes when runes are missing', () => {
      const a = mage({ inventory: [{ itemId: 'fire_rune', quantity: 1 }] })
      const b = buildPlayer({ characterId: 2 })
      const state = createPvpState(a, b, 0)
      state.combatants['2'].attackTimer = 99
      const out = processPvpTick(state, [], mageItems)
      expect(out.events.some((e: any) => e.type === 'attack' && e.attackerCharacterId === 1)).toBe(false)
      const blocked = out.events.find((e: any) => e.type === 'no_runes' && e.characterId === 1)
      expect(blocked).toBeTruthy()
      expect(blocked.reason).toBe('no_runes')
      // The unspent rune is preserved.
      expect(out.stateNext.combatants['1'].inventory.filter(Boolean).length).toBe(1)
    })

    it('credits an equipped elemental staff for its element rune — only air runes needed for fire_bolt', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.01) // force a hit
      // A Staff of Fire supplies the fire runes for free (PvE parity), so a
      // wielder carrying only the 2 air runes still casts fire_bolt in PvP.
      const a = mage({ equipment: { weapon: { itemId: 'fire_staff' } }, inventory: [{ itemId: 'air_rune', quantity: 2 }] })
      const b = buildPlayer({ characterId: 2 })
      const state = createPvpState(a, b, 0)
      state.combatants['2'].attackTimer = 99
      const out = processPvpTick(state, [], mageItems)
      const attack = out.events.find((e: any) => e.type === 'attack' && e.attackerCharacterId === 1)
      expect(attack).toBeTruthy()
      expect(attack.style).toBe('magic')
      // Only the 2 air runes are spent; the staff covered the fire runes for free.
      expect(out.stateNext.combatants['1'].inventory.filter(Boolean).length).toBe(0)
    })

    it('still blocks when a non-staff rune is missing from inventory, staff equipped or not', () => {
      // Staff of Fire covers fire runes, but with no air runes carried the cast
      // is blocked — runes other than the staff's element come from inventory only.
      const a = mage({ equipment: { weapon: { itemId: 'fire_staff' } }, inventory: [] })
      const b = buildPlayer({ characterId: 2 })
      const state = createPvpState(a, b, 0)
      state.combatants['2'].attackTimer = 99
      const out = processPvpTick(state, [], mageItems)
      expect(out.events.some((e: any) => e.type === 'attack' && e.attackerCharacterId === 1)).toBe(false)
      expect(out.events.find((e: any) => e.type === 'no_runes' && e.characterId === 1)).toBeTruthy()
    })

    it('powered staff swings without a spell or runes', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.01)
      const a = mage({ equipment: { weapon: { itemId: 'trident' } }, spell: null, inventory: [] })
      const b = buildPlayer({ characterId: 2 })
      const state = createPvpState(a, b, 0)
      state.combatants['2'].attackTimer = 99
      const out = processPvpTick(state, [], mageItems)
      const attack = out.events.find((e: any) => e.type === 'attack' && e.attackerCharacterId === 1)
      expect(attack).toBeTruthy()
      expect(attack.maxHit).toBeGreaterThan(0)
    })

    it('change_combat_spell resolves the full spell definition from data', () => {
      const a = mage({ spell: null, inventory: [{ itemId: 'fire_rune', quantity: 99 }, { itemId: 'air_rune', quantity: 99 }] })
      const b = buildPlayer({ characterId: 2 })
      const state = createPvpState(a, b, 0)
      state.combatants['1'].attackTimer = 99
      state.combatants['2'].attackTimer = 99
      const out = processPvpTick(state, [
        { tick_number: 1, characterId: 1, characterSeq: 1, action: { type: 'change_combat_spell', spellId: 'fire_bolt' } },
      ], mageItems)
      expect(out.stateNext.combatants['1'].spell.id).toBe('fire_bolt')
      expect(out.stateNext.combatants['1'].spell.baseDamage).toBe(12)
    })

    it('does not consume ammo for a magic combatant', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.01)
      const a = mage({
        equipment: { weapon: { itemId: 'battlestaff' }, ammo: { itemId: 'dragon_arrow', quantity: 50 } },
        inventory: [{ itemId: 'fire_rune', quantity: 99 }, { itemId: 'air_rune', quantity: 99 }],
      })
      const b = buildPlayer({ characterId: 2 })
      const state = createPvpState(a, b, 0)
      state.combatants['2'].attackTimer = 99
      const out = processPvpTick(state, [], mageItems)
      expect(out.stateNext.combatants['1'].equipment.ammo.quantity).toBe(50)
    })
  })

  it('supports every item specialAttack type in PvP, except deliberately PvE-only exceptions', () => {
    // zul_kaars_blade's 'disrupt' is explicitly PvE-only per its feature spec
    // (a slayer-point unlock weapon, not PvP-balanced) — pvpEngine.js's
    // resolveSwing gate on SUPPORTED_PVP_SPECIAL_ATTACK_TYPES is what keeps it
    // from firing in PvP. See tests/pvpSpecialAttacks.test.ts for the direct
    // regression test on that gate staying closed.
    const PVE_ONLY_SPECIAL_TYPES = new Set(['disrupt'])
    const types = new Set(Object.values(realItemsData as any).map((item: any) => item?.specialAttack?.type).filter(Boolean))
    expect(types.size).toBeGreaterThan(0)
    for (const type of types) {
      if (PVE_ONLY_SPECIAL_TYPES.has(type as string)) {
        expect(SUPPORTED_PVP_SPECIAL_ATTACK_TYPES.has(type as string)).toBe(false)
        continue
      }
      expect(SUPPORTED_PVP_SPECIAL_ATTACK_TYPES.has(type as string)).toBe(true)
    }
  })
})


it('applies PvP special regen per 30s interval', () => {
  const state = createPvpState(buildPlayer({ characterId: 1 }), buildPlayer({ characterId: 2 }), 1_000)
  state.combatants['1'].specialAttackEnergy = 50
  const out = processPvpTick(state, [], items, 31_000)
  expect(out.stateNext.combatants['1'].specialAttackEnergy).toBe(60)
})
