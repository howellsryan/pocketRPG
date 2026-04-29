import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildPlayerCombatant } from '../src/engine/combatant.js'
import { createPvpState, processPvpTick } from '../src/engine/pvpEngine.js'
import realItemsData from '../src/data/items.json'
import { SUPPORTED_PVP_SPECIAL_ATTACK_TYPES } from '../src/engine/pvpSpecialAttacks.js'

const items = {
  abyssal_whip: {
    id: 'abyssal_whip', slot: 'weapon', attackStyle: 'slash', attackSpeed: 4,
    attackBonus: { stab: 0, slash: 82, crush: 0, magic: 0, ranged: 0 },
    defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    otherBonus: { meleeStrength: 82, rangedStrength: 0, magicDamage: 0 },
  },
  shark: { id: 'shark', heals: 20, stackable: false },
  attack_potion: { id: 'attack_potion', type: 'potion' },
  strength_potion: { id: 'strength_potion', type: 'potion' },
  defence_potion: { id: 'defence_potion', type: 'potion' },
  ranging_potion: { id: 'ranging_potion', type: 'potion' },
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
    equipment: overrides.equipment ?? { weapon: { itemId: 'abyssal_whip' } },
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
    const firstTicks = out.stateNext.combatants['1'].activePotions.attack_potion
    expect(firstTicks).toBe(99)

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
    const a = buildPlayer({ characterId: 1, combatType: 'magic', equipment: { weapon: { itemId: 'trident' } }, spell: { id: 'fire_bolt', baseDamage: 12 } as any })
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

  it('supports every item specialAttack type in PvP', () => {
    const types = new Set(Object.values(realItemsData as any).map((item: any) => item?.specialAttack?.type).filter(Boolean))
    expect(types.size).toBeGreaterThan(0)
    for (const type of types) expect(SUPPORTED_PVP_SPECIAL_ATTACK_TYPES.has(type as string)).toBe(true)
  })
})
