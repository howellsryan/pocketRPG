import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  COOP_BOSSES,
  COOP_MAX_MEMBERS,
  addCoopMember,
  coopRespawnTicks,
  isCoopBossId,
  createCoopBossState,
  createCoopMember,
  damageTable,
  processCoopTick,
  removeCoopMember,
  reselectTarget,
  topDamageCharacterId,
  describeCoopEquipRefusal,
  describeCoopActionRefusal,
} from '../src/engine/coopBossEngine.js'
import itemsData from '../src/data/items.json'
import monstersData from '../src/data/monsters.json'
import raidsData from '../src/data/raids.json'
import prayersData from '../src/data/prayers.json'
import spellsData from '../src/data/spells.json'

const BOSS = 'corporeal_horror'
const deps = { itemsData, monstersData, prayersData, spellsData }

function savePayload(overrides: Record<string, unknown> = {}) {
  return {
    stats: {
      attack: { xp: 13_034_431 },
      strength: { xp: 13_034_431 },
      defence: { xp: 13_034_431 },
      hitpoints: { xp: 13_034_431 },
      ranged: { xp: 13_034_431 },
      magic: { xp: 13_034_431 },
      prayer: { xp: 13_034_431 },
    },
    equipment: {
      weapon: { itemId: 'krylth_spear', quantity: 1 },
    },
    inventory: [{ itemId: 'shark', quantity: 5 }, null, null],
    settings: { combatStance: 'aggressive' },
    ...overrides,
  }
}

function joinedState(ids: number[], overrides: Record<number, Record<string, unknown>> = {}) {
  let state = createCoopBossState(BOSS, monstersData)!
  for (const id of ids) {
    state = addCoopMember(
      state,
      createCoopMember({
        characterId: id,
        username: `player${id}`,
        savePayload: savePayload(overrides[id] || {}),
        itemsData,
      }),
    )
  }
  return state
}

/** Pins every combat roll to its lowest value: attacks always connect (for 1
 * damage), so damage-dependent assertions are deterministic instead of relying
 * on landing a hit against the boss's 310 defence. */
function alwaysHit() {
  vi.spyOn(Math, 'random').mockReturnValue(0)
}

afterEach(() => {
  vi.restoreAllMocks()
})

function runTicks(state: any, count: number) {
  let current = state
  let lastKill = null
  for (let i = 0; i < count; i++) {
    const out = processCoopTick(current, [], deps, Date.now())
    current = out.stateNext
    if (out.kill) lastKill = out.kill
  }
  return { state: current, kill: lastKill }
}

describe('coopBossEngine — session shape', () => {
  it('creates a session seeded from the boss definition', () => {
    const state = createCoopBossState(BOSS, monstersData)!
    expect(state.bossId).toBe(BOSS)
    expect(state.boss.currentHP).toBe(monstersData[BOSS].hitpoints)
    expect(state.boss.maxHP).toBe(monstersData[BOSS].hitpoints)
    expect(state.tick).toBe(0)
    expect(Object.keys(state.members)).toHaveLength(0)
  })

  it('returns null for an unknown boss', () => {
    expect(createCoopBossState('not_a_boss', monstersData)).toBeNull()
  })

  it('makes the first joiner the boss target', () => {
    const state = joinedState([7])
    expect(state.targetCharId).toBe('7')
  })

  it('caps are exposed for the join picker', () => {
    expect(COOP_MAX_MEMBERS).toBeGreaterThan(1)
  })

  it('builds a session for every boss on the allowlist', () => {
    for (const bossId of Object.keys(COOP_BOSSES)) {
      const state = createCoopBossState(bossId, monstersData)
      expect(state, bossId).not.toBeNull()
      expect(state!.boss.currentHP, bossId).toBe(monstersData[bossId].hitpoints)
      expect(monstersData[bossId].boss, bossId).toBe(true)
    }
  })

  it('opens every boss to groups except the raid bosses and the solo-only four', () => {
    const raidBosses = new Set(Object.values(raidsData).flatMap((r) => r.bosses ?? []))
    const soloOnly = new Set(['ember_tyrant', 'ashen_crucible', 'venomcoil_matriarch', 'blighted_gauntlet'])
    const expected = Object.entries(monstersData)
      .filter(([id, m]) => m.boss === true && !m.raidBoss && !raidBosses.has(id) && !soloOnly.has(id))
      .map(([id]) => id)
    expect(Object.keys(COOP_BOSSES).sort()).toEqual(expected.sort())
    for (const id of soloOnly) expect(isCoopBossId(id), id).toBe(false)
  })

  it('keeps raid bosses out of the allowlist — they stay inside their raid', () => {
    for (const raid of Object.values(raidsData)) {
      for (const bossId of raid.bosses ?? []) expect(isCoopBossId(bossId), bossId).toBe(false)
    }
  })
})

describe('coopBossEngine — respawn pacing', () => {
  it('gives every allowlisted boss a positive respawn delay', () => {
    for (const bossId of Object.keys(COOP_BOSSES)) {
      expect(coopRespawnTicks(bossId), bossId).toBeGreaterThan(0)
    }
  })

  it('makes a low-HP boss wait longer between kills than a high-HP one', () => {
    // A group melts 255 HP far faster than 2000, so the squishy boss has to
    // wait longer or its kills-per-hour runs away.
    expect(monstersData.warlord_grondar.hitpoints).toBeLessThan(monstersData.corporeal_horror.hitpoints)
    expect(coopRespawnTicks('warlord_grondar')).toBeGreaterThan(coopRespawnTicks('corporeal_horror'))
  })

  it('falls back to the default for a boss with no explicit pacing', () => {
    expect(coopRespawnTicks('not_configured')).toBe(10)
  })

  it('waits the boss-specific delay before respawning', () => {
    let state = createCoopBossState('warlord_grondar', monstersData)!
    state = addCoopMember(state, createCoopMember({ characterId: 1, username: 'p1', savePayload: savePayload(), itemsData }))
    state.boss.currentHP = 0

    const wait = coopRespawnTicks('warlord_grondar')
    let respawnedAt = null
    for (let i = 1; i <= wait + 5 && respawnedAt === null; i++) {
      const out = processCoopTick(state, [], deps, Date.now())
      state = out.stateNext
      if (out.events.some((e: any) => e.type === 'bossRespawned')) respawnedAt = i
    }
    // Kill lands on tick 1 and arms the countdown, so the respawn is one tick later.
    expect(respawnedAt).toBe(wait + 1)
  })
})

describe('coopBossEngine — shared boss', () => {
  it('damages one shared HP pool from several members', () => {
    alwaysHit()
    const { state } = runTicks(joinedState([1, 2, 3]), 12)
    expect(state.boss.currentHP).toBeLessThan(state.boss.maxHP)
    const contributors = damageTable(state).filter((c) => c.damage > 0)
    expect(contributors.length).toBeGreaterThan(1)
    const summed = damageTable(state).reduce((sum, c) => sum + c.damage, 0)
    expect(state.boss.maxHP - state.boss.currentHP).toBe(summed)
  })

  it('never lets the boss hit more than one member on the same tick', () => {
    alwaysHit()
    let state = joinedState([1, 2, 3])
    for (let i = 0; i < 60; i++) {
      const hpBefore = Object.fromEntries(Object.entries(state.members).map(([id, m]: any) => [id, m.hp]))
      const out = processCoopTick(state, [], deps, Date.now())
      state = out.stateNext
      const struck = Object.entries(state.members).filter(([id, m]: any) => m.hp < hpBefore[id])
      expect(struck.length).toBeLessThanOrEqual(1)
    }
  })

  it('does not hand the boss a free extra swing when it kills its target', () => {
    alwaysHit()
    let state = joinedState([1, 2])
    // Member 1 is the target and about to die; member 2 ticks after them, so a
    // mid-tick retarget must not let the boss swing again on the same tick.
    state.targetCharId = '1'
    state.members['1'].hp = 1
    state.members['1'].combat.monsterAttackTimer = 0
    state.members['2'].combat.monsterAttackTimer = 0
    const hpBefore = state.members['2'].hp

    let died = false
    for (let i = 0; i < 12 && !died; i++) {
      const out = processCoopTick(state, [], deps, Date.now())
      state = out.stateNext
      died = out.events.some((e: any) => e.type === 'memberDeath')
      if (died) expect(state.members['2'].hp).toBe(hpBefore)
    }
    expect(died).toBe(true)
    expect(state.members['1'].status).toBe('dead')
    expect(state.targetCharId).toBe('2')
  })

  it('a member who joins mid-fight fights the damaged boss, not a fresh one', () => {
    alwaysHit()
    let state = joinedState([1])
    // Half-killed boss, with the fight so far credited to member 1.
    state.boss.currentHP = 1000
    state.members['1'].damage = 1000
    state.members['1'].damageTick = 40

    state = addCoopMember(
      state,
      createCoopMember({ characterId: 99, username: 'latecomer', savePayload: savePayload(), itemsData }),
    )
    expect(state.boss.currentHP).toBe(1000)
    // The late joiner starts on zero contribution, so they cannot inherit a kill
    // for damage they were not there for.
    expect(state.members['99'].damage).toBe(0)
    expect(topDamageCharacterId(state)).toBe('1')

    const after = runTicks(state, 30)
    expect(after.state.boss.currentHP).toBeLessThan(1000)
    expect(after.state.members['99'].damage).toBeGreaterThan(0)
  })
})

describe('coopBossEngine — loot attribution', () => {
  it('names the top-damage member as the loot owner', () => {
    let state = joinedState([1, 2])
    state.members['1'].damage = 900
    state.members['1'].damageTick = 5
    state.members['2'].damage = 400
    state.members['2'].damageTick = 4
    expect(topDamageCharacterId(state)).toBe('1')
  })

  it('breaks a damage tie in favour of whoever got there first', () => {
    let state = joinedState([1, 2])
    state.members['1'].damage = 500
    state.members['1'].damageTick = 20
    state.members['2'].damage = 500
    state.members['2'].damageTick = 9
    expect(topDamageCharacterId(state)).toBe('2')
  })

  it('reports no owner when nobody has dealt damage', () => {
    expect(topDamageCharacterId(joinedState([1, 2]))).toBeNull()
  })

  it('emits a kill record naming the owner when the boss dies', () => {
    let state = joinedState([1, 2])
    state.boss.currentHP = 0
    state.members['1'].damage = 1500
    state.members['1'].damageTick = 3
    state.members['2'].damage = 500
    state.members['2'].damageTick = 2

    const out = processCoopTick(state, [], deps, Date.now())
    expect(out.kill).toBeTruthy()
    expect(out.kill!.ownerCharacterId).toBe(1)
    expect(out.kill!.contributors.map((c: any) => c.characterId)).toContain(2)
    expect(out.events.some((e: any) => e.type === 'bossDefeated')).toBe(true)
  })

  it('only reports the kill once, not on every following tick', () => {
    let state = joinedState([1])
    state.boss.currentHP = 0
    state.members['1'].damage = 2000
    state.members['1'].damageTick = 1
    const kills: unknown[] = []
    for (let i = 0; i < 6; i++) {
      const out = processCoopTick(state, [], deps, Date.now())
      state = out.stateNext
      if (out.kill) kills.push(out.kill)
    }
    expect(kills).toHaveLength(1)
  })

  it('respawns the boss and clears contributions after the kill', () => {
    let state = joinedState([1])
    state.boss.currentHP = 0
    state.members['1'].damage = 2000

    let respawned = false
    for (let i = 0; i < 30 && !respawned; i++) {
      const out = processCoopTick(state, [], deps, Date.now())
      state = out.stateNext
      respawned = out.events.some((e: any) => e.type === 'bossRespawned')
    }

    // Asserted on the respawn tick itself: the fight resumes immediately
    // afterwards, so a later tick could legitimately have fresh damage on it.
    expect(respawned).toBe(true)
    expect(state.boss.currentHP).toBe(state.boss.maxHP)
    expect(state.members['1'].damage).toBe(0)
  })
})

describe('coopBossEngine — targeting', () => {
  it('retargets the boss onto the highest-damage living member', () => {
    const state = joinedState([1, 2])
    state.members['2'].damage = 5000
    reselectTarget(state)
    expect(state.targetCharId).toBe('2')
  })

  it('keeps the current target on a damage tie so the indicator does not flicker', () => {
    const state = joinedState([1, 2])
    state.targetCharId = '1'
    state.members['1'].damage = 300
    state.members['2'].damage = 300
    reselectTarget(state)
    expect(state.targetCharId).toBe('1')
  })

  it('skips dead members when retargeting', () => {
    const state = joinedState([1, 2])
    state.members['2'].damage = 9999
    state.members['2'].status = 'dead'
    reselectTarget(state)
    expect(state.targetCharId).toBe('1')
  })

  it('clears the target when everyone is dead', () => {
    const state = joinedState([1])
    state.members['1'].status = 'dead'
    reselectTarget(state)
    expect(state.targetCharId).toBeNull()
  })
})

describe('coopBossEngine — membership', () => {
  it('removes a member and hands the target to someone still fighting', () => {
    let state = joinedState([1, 2])
    state.targetCharId = '1'
    state = removeCoopMember(state, 1)
    expect(state.members['1']).toBeUndefined()
    expect(state.targetCharId).toBe('2')
  })

  it('marks a member dead once the boss drops them, and stops their attacks', () => {
    alwaysHit()
    let state = joinedState([1])
    state.members['1'].hp = 1
    let saw = false
    for (let i = 0; i < 40 && !saw; i++) {
      const out = processCoopTick(state, [], deps, Date.now())
      state = out.stateNext
      saw = out.events.some((e: any) => e.type === 'memberDeath')
    }
    expect(saw).toBe(true)
    expect(state.members['1'].status).toBe('dead')
    const hpAfterDeath = state.boss.currentHP
    const out = processCoopTick(state, [], deps, Date.now())
    expect(out.stateNext.boss.currentHP).toBe(hpAfterDeath)
  })
})

describe('coopBossEngine — intents', () => {
  it('eats from the member inventory and heals them', () => {
    let state = joinedState([1])
    state.members['1'].hp = 10
    const out = processCoopTick(
      state,
      [{ tick_number: 1, characterId: 1, characterSeq: 0, action: { type: 'eat', inventorySlot: 0 } }],
      deps,
      Date.now(),
    )
    const member = out.stateNext.members['1']
    const eaten = out.events.find((e: any) => e.type === 'eat')
    expect(eaten).toBeTruthy()
    expect(eaten.heal).toBe(itemsData.shark.heals)
    expect(member.inventory[0].quantity).toBe(4)
  })

  it('refuses a second normal food while the eat cooldown is running', () => {
    let state = joinedState([1])
    state.members['1'].hp = 5
    state.members['1'].combat.eatCooldown = 3
    const out = processCoopTick(
      state,
      [{ tick_number: 1, characterId: 1, characterSeq: 0, action: { type: 'eat', inventorySlot: 0 } }],
      deps,
      Date.now(),
    )
    expect(out.stateNext.members['1'].inventory[0].quantity).toBe(5)
  })

  it('changes stance', () => {
    let state = joinedState([1])
    const out = processCoopTick(
      state,
      [{ tick_number: 1, characterId: 1, characterSeq: 0, action: { type: 'change_stance', stance: 'defensive' } }],
      deps,
      Date.now(),
    )
    expect(out.stateNext.members['1'].combat.stance).toBe('defensive')
  })

  it('ignores an unknown stance', () => {
    let state = joinedState([1])
    const out = processCoopTick(
      state,
      [{ tick_number: 1, characterId: 1, characterSeq: 0, action: { type: 'change_stance', stance: 'nonsense' } }],
      deps,
      Date.now(),
    )
    expect(out.stateNext.members['1'].combat.stance).toBe('aggressive')
  })

  it('ignores intents from a character who is not in the session', () => {
    let state = joinedState([1])
    const out = processCoopTick(
      state,
      [{ tick_number: 1, characterId: 404, characterSeq: 0, action: { type: 'change_stance', stance: 'defensive' } }],
      deps,
      Date.now(),
    )
    expect(out.stateNext.members['1'].combat.stance).toBe('aggressive')
  })
})

describe('coopBossEngine — XP', () => {
  it('accrues XP per member in proportion to their own hits', () => {
    alwaysHit()
    const { state } = runTicks(joinedState([1, 2]), 15)
    for (const member of Object.values(state.members) as any[]) {
      if (member.damage > 0) {
        expect(Object.keys(member.xpGained).length).toBeGreaterThan(0)
        expect(member.xpGained.hitpoints).toBeGreaterThan(0)
      }
    }
  })
})

describe('equip intent', () => {
  const equipIntent = (characterId: number, inventorySlot: number) => ([
    { tick_number: 1, characterId, characterSeq: 0, action: { type: 'equip', inventorySlot } },
  ])

  function stateWithInventory(inventory: unknown[], statOverrides: Record<string, unknown> = {}, quests: unknown = []) {
    const payload = savePayload({ inventory, completedQuests: quests })
    if (Object.keys(statOverrides).length > 0) Object.assign(payload.stats as object, statOverrides)
    let state = createCoopBossState(BOSS, monstersData)!
    state = addCoopMember(state, createCoopMember({ characterId: 1, username: 'p1', savePayload: payload, itemsData }))
    return state
  }

  it('moves the item from the pack onto the character', () => {
    const state = stateWithInventory([{ itemId: 'nether_demon_whip', quantity: 1 }, null, null])
    const { stateNext } = processCoopTick(state, equipIntent(1, 0), deps, Date.now())
    const me = stateNext.members['1']
    expect(me.equipment.weapon.itemId).toBe('nether_demon_whip')
    // The spear that was worn goes back into the freed slot, not into the void.
    expect(me.inventory.filter((s: any) => s?.itemId === 'krylth_spear')).toHaveLength(1)
    expect(me.inventory.filter((s: any) => s?.itemId === 'nether_demon_whip')).toHaveLength(0)
  })

  it('refuses gear the member has no level for, and says why', () => {
    const state = stateWithInventory(
      [{ itemId: 'nether_demon_whip', quantity: 1 }, null, null],
      { attack: { xp: 0 } },
    )
    const { stateNext, events } = processCoopTick(state, equipIntent(1, 0), deps, Date.now())
    expect(stateNext.members['1'].equipment.weapon.itemId).toBe('krylth_spear')
    const refusal = events.find((e: any) => e.type === 'equipRefused')
    expect(refusal).toMatchObject({ reason: 'skill', skill: 'attack', required: 70, characterId: 1 })
  })

  it('refuses quest-locked gear the member has not unlocked', () => {
    const state = stateWithInventory([{ itemId: 'dragon_dagger', quantity: 1 }, null, null])
    const { stateNext, events } = processCoopTick(state, equipIntent(1, 0), deps, Date.now())
    expect(stateNext.members['1'].equipment.weapon.itemId).toBe('krylth_spear')
    expect(events.find((e: any) => e.type === 'equipRefused')).toMatchObject({ reason: 'quest', questUnlock: 'forsaken_city' })
  })

  it('allows quest-locked gear once the quest is on the member', () => {
    const state = stateWithInventory([{ itemId: 'dragon_dagger', quantity: 1 }, null, null], {}, ['forsaken_city'])
    const { stateNext } = processCoopTick(state, equipIntent(1, 0), deps, Date.now())
    expect(stateNext.members['1'].equipment.weapon.itemId).toBe('dragon_dagger')
  })

  it('fails closed for a member whose session predates the level map', () => {
    const state = stateWithInventory([{ itemId: 'nether_demon_whip', quantity: 1 }, null, null])
    delete state.members['1'].levels
    const { stateNext, events } = processCoopTick(state, equipIntent(1, 0), deps, Date.now())
    expect(stateNext.members['1'].equipment.weapon.itemId).toBe('krylth_spear')
    expect(events.find((e: any) => e.type === 'equipRefused')).toMatchObject({ reason: 'skill' })
  })

  it('aborts the swap rather than dropping gear it cannot put down', () => {
    // A two-hander displaces both weapon and shield but frees only one slot.
    let state = createCoopBossState(BOSS, monstersData)!
    const payload = savePayload({
      equipment: {
        weapon: { itemId: 'krylth_spear', quantity: 1 },
        shield: { itemId: 'bronze_kiteshield', quantity: 1 },
      },
      inventory: [{ itemId: 'shortbow', quantity: 1 }],
    })
    state = addCoopMember(state, createCoopMember({ characterId: 1, username: 'p1', savePayload: payload, itemsData }))
    const { stateNext, events } = processCoopTick(state, equipIntent(1, 0), deps, Date.now())
    const me = stateNext.members['1']
    expect(me.equipment.weapon.itemId).toBe('krylth_spear')
    expect(me.equipment.shield.itemId).toBe('bronze_kiteshield')
    expect(me.inventory[0]).toMatchObject({ itemId: 'shortbow' })
    expect(events.find((e: any) => e.type === 'equipRefused')).toMatchObject({ reason: 'inventory_full' })
  })

  it('equips a whole ammo stack rather than one arrow', () => {
    const state = stateWithInventory([{ itemId: 'bronze_arrow', quantity: 500 }, null, null])
    const { stateNext } = processCoopTick(state, equipIntent(1, 0), deps, Date.now())
    const me = stateNext.members['1']
    expect(me.equipment.ammo).toMatchObject({ itemId: 'bronze_arrow', quantity: 500 })
    expect(me.inventory[0]).toBeNull()
  })

  it('re-derives the combat type on a weapon swap so ranged gear ranges', () => {
    const state = stateWithInventory([{ itemId: 'shortbow', quantity: 1 }, null, null])
    expect(state.members['1'].combat.combatType).toBe('melee')
    const { stateNext } = processCoopTick(state, equipIntent(1, 0), deps, Date.now())
    expect(stateNext.members['1'].combat.combatType).toBe('ranged')
  })

  it('ignores an equip pointed at an empty or non-equippable slot', () => {
    const state = stateWithInventory([{ itemId: 'shark', quantity: 5 }, null, null])
    const before = JSON.stringify(state.members['1'].equipment)
    const empty = processCoopTick(state, equipIntent(1, 1), deps, Date.now())
    expect(JSON.stringify(empty.stateNext.members['1'].equipment)).toBe(before)
    const food = processCoopTick(state, equipIntent(1, 0), deps, Date.now())
    expect(JSON.stringify(food.stateNext.members['1'].equipment)).toBe(before)
    expect(food.stateNext.members['1'].inventory[0]).toMatchObject({ itemId: 'shark', quantity: 5 })
  })

  it('only equips for the member who sent the intent', () => {
    let state = joinedState([1, 2])
    state.members['1'].inventory = [{ itemId: 'nether_demon_whip', quantity: 1 }, null, null]
    const { stateNext } = processCoopTick(state, equipIntent(1, 0), deps, Date.now())
    expect(stateNext.members['1'].equipment.weapon.itemId).toBe('nether_demon_whip')
    expect(stateNext.members['2'].equipment.weapon.itemId).toBe('krylth_spear')
  })
})

describe('describeCoopEquipRefusal', () => {
  it('names the skill and level a piece of gear needs', () => {
    expect(describeCoopEquipRefusal({ reason: 'skill', skill: 'attack', required: 70 }))
      .toBe('Need attack level 70 to equip')
  })

  it('reads the quest id back as words', () => {
    expect(describeCoopEquipRefusal({ reason: 'quest', questUnlock: 'forsaken_city' }))
      .toBe('Complete quest to equip: forsaken city')
  })

  it('explains a full pack', () => {
    expect(describeCoopEquipRefusal({ reason: 'inventory_full' })).toMatch(/Inventory full/)
  })

  it('still says something for a reason it does not know', () => {
    expect(describeCoopEquipRefusal({ reason: 'wat' })).toBe('Could not equip that')
    expect(describeCoopEquipRefusal(undefined)).toBe('Could not equip that')
  })
})

// The engine applies a spell's damage and a prayer's boost with no level check
// of its own (combat.js only ever checks runes, applyPrayerBonuses checks
// nothing), and the server grants the resulting damage and XP — so the unlock
// gate lives in applyCoopIntent or nowhere. PvP has enforced the same two
// checks since it shipped; co-op did not.
describe('spell and prayer unlock gates', () => {
  function memberState(statOverrides: Record<string, unknown> = {}) {
    const payload = savePayload({})
    Object.assign(payload.stats as object, statOverrides)
    let state = createCoopBossState(BOSS, monstersData)!
    state = addCoopMember(state, createCoopMember({ characterId: 1, username: 'p1', savePayload: payload, itemsData }))
    return state
  }
  const intent = (action: unknown) => ([{ tick_number: 1, characterId: 1, characterSeq: 0, action }])

  it('refuses a spell above the member Magic level and says which level it needs', () => {
    // fire_surge is levelReq 95; this member sits at level 1 Magic.
    const state = memberState({ magic: { xp: 0 } })
    const { stateNext, events } = processCoopTick(
      state, intent({ type: 'change_combat_spell', spellId: 'fire_surge' }), deps, Date.now(),
    )
    expect(stateNext.members['1'].combat.spellId).toBeNull()
    expect(events.find((e: any) => e.type === 'actionRefused')).toMatchObject({
      reason: 'spell_level', spellId: 'fire_surge', required: 95, characterId: 1,
    })
  })

  it('allows a spell the member has the level for', () => {
    const state = memberState()
    const { stateNext, events } = processCoopTick(
      state, intent({ type: 'change_combat_spell', spellId: 'fire_surge' }), deps, Date.now(),
    )
    expect(stateNext.members['1'].combat.spellId).toBe('fire_surge')
    expect(events.find((e: any) => e.type === 'actionRefused')).toBeUndefined()
  })

  it('still lets a member clear their spell', () => {
    const state = memberState({ magic: { xp: 0 } })
    state.members['1'].combat.spellId = 'wind_strike'
    const { stateNext } = processCoopTick(
      state, intent({ type: 'change_combat_spell', spellId: null }), deps, Date.now(),
    )
    expect(stateNext.members['1'].combat.spellId).toBeNull()
  })

  it('refuses a prayer above the member Prayer level', () => {
    // piety is level 70; this member is level 10.
    const state = memberState({ prayer: { xp: 1154 } })
    const { stateNext, events } = processCoopTick(
      state, intent({ type: 'toggle_prayer', prayerId: 'piety', slot: 'combat' }), deps, Date.now(),
    )
    expect(stateNext.members['1'].combat.activeCombatPrayer).toBeNull()
    expect(events.find((e: any) => e.type === 'actionRefused')).toMatchObject({
      reason: 'prayer_level', prayerId: 'piety', required: 70,
    })
  })

  it('allows a prayer the member has the level for', () => {
    const state = memberState()
    const { stateNext } = processCoopTick(
      state, intent({ type: 'toggle_prayer', prayerId: 'piety', slot: 'combat' }), deps, Date.now(),
    )
    expect(stateNext.members['1'].combat.activeCombatPrayer).toBe('piety')
  })

  it('never strands a member with a prayer they cannot switch off', () => {
    // A prayer already running when the level map says they cannot start it —
    // turning it OFF has to stay allowed or the drain runs to empty.
    const state = memberState({ prayer: { xp: 1154 } })
    state.members['1'].combat.activeCombatPrayer = 'piety'
    const { stateNext } = processCoopTick(
      state, intent({ type: 'toggle_prayer', prayerId: 'piety', slot: 'combat' }), deps, Date.now(),
    )
    expect(stateNext.members['1'].combat.activeCombatPrayer).toBeNull()
  })

  it('fails closed for a member whose session predates the level map', () => {
    const state = memberState()
    delete state.members['1'].levels
    delete state.members['1'].stats.magic
    const { stateNext, events } = processCoopTick(
      state, intent({ type: 'change_combat_spell', spellId: 'fire_surge' }), deps, Date.now(),
    )
    expect(stateNext.members['1'].combat.spellId).toBeNull()
    expect(events.find((e: any) => e.type === 'actionRefused')).toMatchObject({ reason: 'spell_level' })
  })
})

describe('describeCoopActionRefusal', () => {
  it('names the Magic level a spell needs', () => {
    expect(describeCoopActionRefusal({ reason: 'spell_level', name: 'Fire Surge', required: 95 }))
      .toBe('Need Magic level 95 to cast Fire Surge')
  })

  it('names the Prayer level a prayer needs', () => {
    expect(describeCoopActionRefusal({ reason: 'prayer_level', name: 'Piety', required: 70 }))
      .toBe('Need Prayer level 70 to use Piety')
  })

  it('still says something for a reason it does not know', () => {
    expect(describeCoopActionRefusal({ reason: 'wat' })).toBe('Could not do that')
    expect(describeCoopActionRefusal(undefined)).toBe('Could not do that')
  })
})
