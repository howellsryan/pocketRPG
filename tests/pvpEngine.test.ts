import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildPlayerCombatant } from '../src/engine/combatant.js'
import { createPvpState, processPvpTick } from '../src/engine/pvpEngine.js'

const items = {
  abyssal_whip: {
    id: 'abyssal_whip', slot: 'weapon', attackStyle: 'slash', attackSpeed: 4,
    attackBonus: { stab: 0, slash: 82, crush: 0, magic: 0, ranged: 0 },
    defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    otherBonus: { meleeStrength: 82, rangedStrength: 0, magicDamage: 0 },
  },
  shark: { id: 'shark', heal: 20, stackable: false },
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
})
