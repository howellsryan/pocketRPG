import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  COOP_BOSSES,
  COOP_MAX_MEMBERS,
  addCoopMember,
  coopRespawnTicks,
  COOP_RESPAWN_TICKS,
  isCoopBossId,
  createCoopBossState,
  createCoopMember,
  damageTable,
  processCoopTick,
  removeCoopMember,
  reselectTarget,
  topDamageCharacterId,
  COOP_LOOT_DAMAGE_SHARE,
  coopLootDamageRequired,
  coopLootProgress,
  coopKillOutcome,
  coopIntentEcho,
  lootEligibleCharacterIds,
  describeCoopEquipRefusal,
  describeCoopActionRefusal,
} from '../src/engine/coopBossEngine.js'
import { prepareAdd } from '../src/engine/bossAdds.js'
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

  it('waits the same 5 seconds for every boss', () => {
    // Deliberate replacement of the old HP-based curve, which made a 255 HP boss
    // wait 30s and a 2000 HP one 6s. Players get one predictable number instead.
    expect(COOP_RESPAWN_TICKS).toBe(8)
    // The HUD counts down in ceil(ticks * 0.6) seconds, and it has to read "5s".
    expect(Math.ceil(COOP_RESPAWN_TICKS * 0.6)).toBe(5)
    const waits = new Set(Object.keys(COOP_BOSSES).map((id) => coopRespawnTicks(id)))
    expect([...waits]).toEqual([COOP_RESPAWN_TICKS])
  })

  it('answers for a boss that is not configured at all', () => {
    expect(coopRespawnTicks('not_configured')).toBe(COOP_RESPAWN_TICKS)
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

describe('prayer slots in a group fight', () => {
  const intent = (action: unknown) => ([{ tick_number: 1, characterId: 1, characterSeq: 0, action }])

  it('puts a protection prayer in the protection slot, though the client names no slot', () => {
    // The screen sends { type: 'toggle_prayer', prayerId } and nothing else.
    // Filed as an offensive prayer, protect-from-X mitigates nothing at all —
    // combat.js reads activeProtectionPrayer — and silently cancels whatever
    // offensive prayer was running. Flicking a boss in a group could not work.
    let state = joinedState([1])
    state = processCoopTick(state, intent({ type: 'toggle_prayer', prayerId: 'piety' }), deps, Date.now()).stateNext
    state = processCoopTick(
      state, intent({ type: 'toggle_prayer', prayerId: 'protection_from_melee' }), deps, Date.now(),
    ).stateNext
    expect(state.members['1'].combat.activeProtectionPrayer).toBe('protection_from_melee')
    expect(state.members['1'].combat.activeCombatPrayer).toBe('piety')
  })

  it('flicks one protection prayer straight onto another', () => {
    let state = joinedState([1])
    state = processCoopTick(
      state, intent({ type: 'toggle_prayer', prayerId: 'protection_from_melee' }), deps, Date.now(),
    ).stateNext
    state = processCoopTick(
      state, intent({ type: 'toggle_prayer', prayerId: 'protection_from_magic' }), deps, Date.now(),
    ).stateNext
    expect(state.members['1'].combat.activeProtectionPrayer).toBe('protection_from_magic')
  })
})

describe('coopBossEngine — a defence drain belongs to the ROOM, not to whoever landed it', () => {
  const smashIntent = [{ tick_number: 1, characterId: 1, characterSeq: 0, action: { type: 'queue_special' } }]
  const hammer = { equipment: { weapon: { itemId: 'dragon_warhammer', quantity: 1 } } }

  it("carries a Dragon Warhammer smash onto the shared boss record, so a member who never swung it rolls against the drained Defence too", () => {
    alwaysHit()
    const state = joinedState([1, 2], { 1: hammer })
    const baseDefence = (monstersData as any)[BOSS].stats.defence
    expect(state.boss.monster.stats.defence).toBe(baseDefence)

    const next = processCoopTick(state, smashIntent, deps, Date.now()).stateNext
    // Members tick in ascending character-id order, so player 2's session is
    // hydrated from the room AFTER the smash landed and writes the boss record
    // back last. A drain that lived only on player 1's session would be
    // restored from monsters.json right here.
    expect(next.boss.monster.stats.defence).toBe(baseDefence - Math.floor(baseDefence * 0.3))
  })

  it('never mutates the monsters.json row the room was seeded from', () => {
    alwaysHit()
    const baseDefence = (monstersData as any)[BOSS].stats.defence
    processCoopTick(joinedState([1], { 1: hammer }), smashIntent, deps, Date.now())
    expect((monstersData as any)[BOSS].stats.defence).toBe(baseDefence)
  })

  it('resets the drain when the boss respawns — a fresh instance is a fresh Defence', () => {
    alwaysHit()
    const baseDefence = (monstersData as any)[BOSS].stats.defence
    let state = processCoopTick(joinedState([1], { 1: hammer }), smashIntent, deps, Date.now()).stateNext
    expect(state.boss.monster.stats.defence).toBeLessThan(baseDefence)

    state.boss.currentHP = 0
    state.boss.killedAt = Date.now()
    state.boss.respawnCountdown = 1
    state = processCoopTick(state, [], deps, Date.now()).stateNext
    expect(state.boss.monster.stats.defence).toBe(baseDefence)
  })
})

describe('coopIntentEcho — the client-side preview of a tap', () => {
  const intent = (action: unknown) => ([{ tick_number: 1, characterId: 1, characterSeq: 0, action }])
  const ACTIONS = [
    { type: 'toggle_prayer', prayerId: 'protection_from_melee' },
    { type: 'toggle_prayer', prayerId: 'piety' },
    { type: 'queue_special' },
    { type: 'target_add', value: 0 },
    { type: 'change_combat_spell', spellId: 'fire_surge' },
  ]

  it('predicts exactly what the room does with each echoed action', () => {
    // The echo is what the player sees for the beat before the room answers, so
    // a prediction that disagrees with applyCoopIntent is a button that lies.
    for (const action of ACTIONS) {
      const state = joinedState([1])
      // A real add: target_add only takes when one is actually on the field.
      state.boss.adds = [prepareAdd(monstersData[monstersData[BOSS].spawnsAdd.monsterId])]
      // Compared during the respawn wait, where intents still apply but no
      // combat resolves — otherwise the same tick that queues a special also
      // spends it, and the echo would be blamed for the engine agreeing.
      state.boss.respawnCountdown = 5
      const before = state.members['1'].combat
      const patch = coopIntentEcho(before, action, prayersData)!
      expect(patch, action.type).not.toBeNull()
      const after = processCoopTick(state, intent(action), deps, Date.now()).stateNext.members['1'].combat
      for (const key of Object.keys(patch)) expect(patch[key], `${action.type}.${key}`).toBe(after[key])
    }
  })

  it('leaves actions the server owns alone', () => {
    const combat = joinedState([1]).members['1'].combat
    expect(coopIntentEcho(combat, { type: 'eat', inventorySlot: 0 }, prayersData)).toBeNull()
    expect(coopIntentEcho(combat, { type: 'equip', inventorySlot: 0 }, prayersData)).toBeNull()
    expect(coopIntentEcho(combat, { type: 'start_raid' }, prayersData)).toBeNull()
  })

  it('does not promise a prayer an empty pool cannot pay for', () => {
    const combat = { ...joinedState([1]).members['1'].combat, prayerPoints: 0 }
    expect(coopIntentEcho(combat, { type: 'toggle_prayer', prayerId: 'piety' }, prayersData)).toBeNull()
    // Turning one OFF is always allowed, empty pool or not.
    const running = { ...combat, activeCombatPrayer: 'piety' }
    expect(coopIntentEcho(running, { type: 'toggle_prayer', prayerId: 'piety' }, prayersData))
      .toEqual({ activeCombatPrayer: null })
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

// A group kill has one loot winner but every member fighting it is on their own
// slayer task. Credit is deliberately independent of damage — the member who
// contributed nothing still gets the kill toward their task — and gated only on
// being alive for it, so dying on purpose in an eight-player room is not the
// cheapest slayer task in the game.
describe('slayer credit on a group boss kill', () => {
  function taskFor(monsterId: string, remaining: number, extra: Record<string, unknown> = {}) {
    return { monsterId, monsterName: 'The Corporeal Horror', monstersRemaining: remaining, pointsOnComplete: 15, masterId: 'zul_kaar', ...extra }
  }

  function stateWithMembers(members: Array<{ id: number; task?: unknown; settings?: Record<string, unknown> }>) {
    let state = createCoopBossState(BOSS, monstersData)!
    for (const m of members) {
      const payload = savePayload({}) as any
      payload.settings = { ...(payload.settings || {}), slayerTask: m.task ?? null, ...(m.settings || {}) }
      state = addCoopMember(state, createCoopMember({
        characterId: m.id, username: `p${m.id}`, savePayload: payload, itemsData,
      }))
    }
    return state
  }

  /** Drops the boss so the next tick resolves a kill. */
  function killTick(state: any) {
    state.boss.currentHP = 0
    return processCoopTick(state, [], deps, Date.now())
  }

  it('credits every living member on task, not just the one who dealt the damage', () => {
    const state = stateWithMembers([
      { id: 1, task: taskFor(BOSS, 5) },
      { id: 2, task: taskFor(BOSS, 5) },
    ])
    // Only member 1 did anything at all.
    state.members['1'].damage = 2000
    const { stateNext, events } = killTick(state)

    expect(stateNext.members['1'].slayerTask.monstersRemaining).toBe(4)
    expect(stateNext.members['2'].slayerTask.monstersRemaining).toBe(4)
    const credits = events.filter((e: any) => e.type === 'slayerCredit')
    expect(credits.map((c: any) => c.characterId).sort()).toEqual([1, 2])
  })

  it('grants slayer XP for the kill to each member on task', () => {
    const state = stateWithMembers([{ id: 1, task: taskFor(BOSS, 5) }])
    const { stateNext } = killTick(state)
    // Boss with no explicit slayerXP falls back to HP (2000) at the ×4 boss
    // multiplier — §4's guardrail against inflated boss slayer XP.
    expect(stateNext.members['1'].xpGained.slayer).toBe(8000)
  })

  it('doubles the slayer XP for a member who bought the unlock', () => {
    const state = stateWithMembers([
      { id: 1, task: taskFor(BOSS, 5), settings: { characterUnlocks: { doubleSlayerXp: true } } },
    ])
    const { stateNext } = killTick(state)
    expect(stateNext.members['1'].xpGained.slayer).toBe(16000)
  })

  it('leaves a member with no task, or a task for another monster, untouched', () => {
    const state = stateWithMembers([
      { id: 1, task: null },
      { id: 2, task: taskFor('warlord_grondar', 5) },
    ])
    const { stateNext, events } = killTick(state)
    expect(stateNext.members['1'].slayerTask).toBeNull()
    expect(stateNext.members['2'].slayerTask.monstersRemaining).toBe(5)
    expect(stateNext.members['2'].xpGained.slayer).toBeUndefined()
    expect(events.filter((e: any) => e.type === 'slayerCredit')).toHaveLength(0)
  })

  it('does NOT credit a member who is dead when the boss falls', () => {
    const state = stateWithMembers([{ id: 1, task: taskFor(BOSS, 5) }, { id: 2, task: taskFor(BOSS, 5) }])
    state.members['2'].status = 'dead'
    state.members['2'].hp = 0
    const { stateNext } = killTick(state)
    expect(stateNext.members['1'].slayerTask.monstersRemaining).toBe(4)
    expect(stateNext.members['2'].slayerTask.monstersRemaining).toBe(5)
  })

  it('completes the task on the last kill and banks the points', () => {
    const state = stateWithMembers([{ id: 1, task: taskFor(BOSS, 1) }])
    const { stateNext, events } = killTick(state)
    const me = stateNext.members['1']
    expect(me.slayerTask).toBeNull()
    expect(me.slayerCredit.tasksCompleted).toBe(1)
    expect(me.slayerCredit.pointsEarned).toBe(15)
    expect(me.slayerCredit.masterCompletions).toEqual({ zul_kaar: 1 })
    expect(events.find((e: any) => e.type === 'slayerCredit')).toMatchObject({ completed: true, totalTasks: 1 })
  })

  it('pays the milestone multiplier off the running total, not the joined-at total', () => {
    // Completing task #5 in-session must pay ×10, and #6 must not.
    const state = stateWithMembers([
      { id: 1, task: taskFor(BOSS, 1), settings: { slayerTasksCompleted: 4 } },
    ])
    const first = killTick(state).stateNext
    expect(first.members['1'].slayerCredit.pointsEarned).toBe(150)
    expect(first.members['1'].slayerTasksCompleted).toBe(5)

    first.members['1'].slayerTask = taskFor(BOSS, 1)
    // Clear the respawn wait too, or the next tick just counts it down.
    first.boss.killedAt = null
    first.boss.respawnCountdown = 0
    const second = killTick(first).stateNext
    expect(second.members['1'].slayerTasksCompleted).toBe(6)
    // 150 from task #5 plus a plain 15 for #6 — the delta accumulates.
    expect(second.members['1'].slayerCredit.pointsEarned).toBe(165)
  })

  it('marks the on-task members on the kill so the winner rolls their table on task', () => {
    const state = stateWithMembers([{ id: 1, task: taskFor(BOSS, 5) }, { id: 2, task: null }])
    state.members['1'].damage = 2000
    const { kill } = killTick(state)
    expect(kill.onTaskCharacterIds).toEqual([1])
  })
})

describe('coopBossEngine — the 10% loot threshold', () => {
  it('asks for a tenth of the boss max HP', () => {
    expect(COOP_LOOT_DAMAGE_SHARE).toBe(0.1)
    expect(coopLootDamageRequired(2000)).toBe(200)
    expect(coopLootDamageRequired(255)).toBe(26)
  })

  it('never lets a member who has not swung qualify', () => {
    // Floor would make the requirement 0 on a boss this small, so `damage >= 0`
    // would pay every member in the room for standing there.
    expect(coopLootDamageRequired(5)).toBe(1)
    expect(coopLootDamageRequired(0)).toBe(1)
    expect(coopLootProgress({ damage: 0 }, 5).qualified).toBe(false)
  })

  it('pays everyone past the line, not just the top attacker', () => {
    const state = joinedState([1, 2, 3])
    state.members['1'].damage = 1400
    state.members['2'].damage = 400
    state.members['3'].damage = 199
    expect(lootEligibleCharacterIds(state)).toEqual([1, 2])
  })

  it('is exactly at-least, not more-than', () => {
    const state = joinedState([1])
    state.members['1'].damage = 200
    expect(lootEligibleCharacterIds(state)).toEqual([1])
    state.members['1'].damage = 199
    expect(lootEligibleCharacterIds(state)).toEqual([])
  })

  it('still pays a member who earned their share and then died', () => {
    const state = joinedState([1, 2])
    state.members['1'].damage = 1000
    state.members['2'].damage = 500
    state.members['2'].status = 'dead'
    expect(lootEligibleCharacterIds(state)).toContain(2)
  })

  it('ships the eligible list on the kill record', () => {
    const state = joinedState([1, 2, 3])
    state.boss.currentHP = 0
    state.members['1'].damage = 1500
    state.members['2'].damage = 400
    state.members['3'].damage = 100

    const out = processCoopTick(state, [], deps, Date.now())
    expect(out.kill!.lootCharacterIds).toEqual([1, 2])
    expect(out.kill!.lootDamageRequired).toBe(200)
    // The top attacker is still named, but as the owner of the audit trail —
    // not as the only player paid.
    expect(out.kill!.ownerCharacterId).toBe(1)
  })

  it('always leaves at least one member eligible on a full room', () => {
    // Eight is the cap, so the biggest contributor holds at least 12.5% of the
    // damage — a kill can never come out dry for everybody.
    const ids = [1, 2, 3, 4, 5, 6, 7, 8]
    const state = joinedState(ids)
    state.boss.currentHP = 0
    for (const id of ids) state.members[String(id)].damage = 2000 / ids.length
    expect(lootEligibleCharacterIds(state)).toHaveLength(8)
  })

  it('resets every member back below the line when the boss respawns', () => {
    let state = joinedState([1, 2])
    state.boss.currentHP = 0
    state.members['1'].damage = 1500
    state.members['2'].damage = 500
    let out = processCoopTick(state, [], deps, Date.now())
    state = out.stateNext
    const wait = state.boss.respawnCountdown
    for (let i = 0; i < wait; i++) {
      out = processCoopTick(state, [], deps, Date.now())
      state = out.stateNext
    }
    expect(state.boss.currentHP).toBeGreaterThan(0)
    expect(lootEligibleCharacterIds(state)).toEqual([])
  })

  it('measures progress against the threshold, not the boss health bar', () => {
    // A full bar has to mean "drop secured" and nothing else — scaling it to the
    // boss's HP would leave a qualified member showing a tenth of a bar.
    const half = coopLootProgress({ damage: 100 }, 2000)
    expect(half.pct).toBe(50)
    expect(half.remaining).toBe(100)
    expect(half.qualified).toBe(false)

    const over = coopLootProgress({ damage: 1600 }, 2000)
    expect(over.pct).toBe(100)
    expect(over.remaining).toBe(0)
    expect(over.qualified).toBe(true)
  })
})

describe('coopBossEngine — the respawn wait is prep time', () => {
  // The wait between kills used to drop every intent on the floor: the quick
  // actions were on screen, taps did nothing, and the group went into the next
  // pull on whatever supplies the last one left them.
  function waitingState(ids: number[]) {
    const state = joinedState(ids)
    state.boss.currentHP = 0
    state.boss.killedAt = Date.now()
    state.boss.respawnCountdown = 20
    for (const id of ids) state.members[String(id)].hp = 20
    return state
  }

  const eat = (characterId: number, slot = 0) => ({
    tick_number: 1, characterId, characterSeq: 1, action: { type: 'eat', inventorySlot: slot },
  })

  it('lets a member eat while waiting for the boss to come back', () => {
    const state = waitingState([1])
    const before = state.members['1'].inventory[0].quantity

    const out = processCoopTick(state, [eat(1)], deps, Date.now())

    expect(out.stateNext.members['1'].hp).toBeGreaterThan(20)
    expect(out.stateNext.members['1'].inventory[0].quantity).toBe(before - 1)
    // Still counting down — eating does not stall or restart the wait.
    expect(out.stateNext.boss.respawnCountdown).toBe(19)
  })

  it('lets a member swap gear while waiting', () => {
    const state = waitingState([1])
    state.members['1'].inventory[1] = { itemId: 'iron_platebody', quantity: 1 }
    const intent = {
      tick_number: 1, characterId: 1, characterSeq: 1, action: { type: 'equip', inventorySlot: 1 },
    }

    const out = processCoopTick(state, [intent], deps, Date.now())

    expect(out.stateNext.members['1'].equipment.body?.itemId).toBe('iron_platebody')
  })

  it('walks the eat cooldown down so the wait is not one bite long', () => {
    // Nothing calls processCombatTick while the boss is down, so without this
    // the cooldown set by the first bite never expires and the rest of the wait
    // is unusable.
    let state = waitingState([1])
    let out = processCoopTick(state, [eat(1)], deps, Date.now())
    expect(out.stateNext.members['1'].combat.eatCooldown).toBeGreaterThan(0)

    state = out.stateNext
    for (let i = 0; i < 4; i++) {
      out = processCoopTick(state, [], deps, Date.now())
      state = out.stateNext
    }
    expect(state.members['1'].combat.eatCooldown).toBe(0)

    const hpBefore = state.members['1'].hp
    out = processCoopTick(state, [eat(1)], deps, Date.now())
    expect(out.stateNext.members['1'].hp).toBeGreaterThan(hpBefore)
  })

  it('keeps a dead member out of it', () => {
    const state = waitingState([1])
    state.members['1'].status = 'dead'
    const before = state.members['1'].inventory[0].quantity

    const out = processCoopTick(state, [eat(1)], deps, Date.now())

    expect(out.stateNext.members['1'].inventory[0].quantity).toBe(before)
  })

  it('does not resolve combat while the boss is down', () => {
    const state = waitingState([1])
    const out = processCoopTick(state, [eat(1)], deps, Date.now())
    expect(out.stateNext.boss.currentHP).toBe(0)
    expect(out.events.some((e: any) => e.type === 'playerHit' || e.type === 'monsterHit')).toBe(false)
    expect(out.kill).toBeNull()
  })
})

describe('coopBossEngine — quick prayers survive the fight', () => {
  // The co-op lock refuses this character's own /api/save while the room owns
  // it, and the client pulls rather than pushes on exit — so a quick-prayer edit
  // made mid-fight reached the account only if the room carried it.
  it('seeds the member from the save', () => {
    const state = joinedState([1], { 1: { settings: { quickPrayers: ['burst_of_strength'] } } })
    expect(state.members['1'].quickPrayers).toEqual(['burst_of_strength'])
  })

  it('defaults to an empty list rather than undefined', () => {
    expect(joinedState([1]).members['1'].quickPrayers).toEqual([])
  })

  it('applies an edit made mid-fight', () => {
    const state = joinedState([1])
    const intent = {
      tick_number: 1, characterId: 1, characterSeq: 1,
      action: { type: 'set_quick_prayers', prayerIds: ['burst_of_strength', 'clarity_of_thought'] },
    }
    const out = processCoopTick(state, [intent], deps, Date.now())
    expect(out.stateNext.members['1'].quickPrayers).toEqual(['burst_of_strength', 'clarity_of_thought'])
  })

  it('survives the state clone every tick makes', () => {
    let state = joinedState([1], { 1: { settings: { quickPrayers: ['burst_of_strength'] } } })
    state = processCoopTick(state, [], deps, Date.now()).stateNext
    state = processCoopTick(state, [], deps, Date.now()).stateNext
    expect(state.members['1'].quickPrayers).toEqual(['burst_of_strength'])
  })

  it('can be edited while waiting for the respawn', () => {
    const state = joinedState([1])
    state.boss.currentHP = 0
    state.boss.killedAt = Date.now()
    state.boss.respawnCountdown = 10
    const intent = {
      tick_number: 1, characterId: 1, characterSeq: 1,
      action: { type: 'set_quick_prayers', prayerIds: ['burst_of_strength'] },
    }
    expect(processCoopTick(state, [intent], deps, Date.now()).stateNext.members['1'].quickPrayers)
      .toEqual(['burst_of_strength'])
  })
})

describe('coopBossEngine — what a settled kill means for one member', () => {
  // This is the branch that decides whether a player sees their drop. It lived
  // in the poll handler inside CoopBossScreen, where the harness cannot reach
  // it, and every shape below is one that reached a real player.
  const settled = (over: Record<string, unknown> = {}) => ({
    type: 'killSettled',
    ownerCharacterId: 7,
    settlements: [
      { characterId: 7, granted: [{ itemId: 'uncut_onyx', quantity: 1 }], killCount: 12, diverged: false, failed: false },
      { characterId: 8, diverged: false },
    ],
    ...over,
  })

  it('gives a winner their own loot and kill count', () => {
    const out = coopKillOutcome(settled(), 7)
    expect(out.kind).toBe('loot')
    expect(out.loot).toEqual([{ itemId: 'uncut_onyx', quantity: 1 }])
    expect(out.killCount).toBe(12)
  })

  it('still shows the modal for a winner whose roll came up dry', () => {
    // An empty drop list is an ordinary unlucky kill — it is not a failure, and
    // the modal is what tells the player the kill counted.
    const out = coopKillOutcome(settled({
      settlements: [{ characterId: 7, granted: [], killCount: 13 }],
    }), 7)
    expect(out.kind).toBe('loot')
    expect(out.loot).toEqual([])
  })

  it('reports a member who missed the damage threshold, with the winner count', () => {
    const out = coopKillOutcome(settled(), 99)
    expect(out.kind).toBe('missed')
    expect(out.winners).toBe(2)
  })

  it('never dresses a diverged save up as a dry kill', () => {
    const out = coopKillOutcome(settled({
      settlements: [{ characterId: 7, granted: [], diverged: true }],
    }), 7)
    expect(out.kind).toBe('diverged')
  })

  it('never dresses a thrown grant up as a dry kill', () => {
    const out = coopKillOutcome(settled({
      settlements: [{ characterId: 7, granted: [], failed: true }],
    }), 7)
    expect(out.kind).toBe('failed')
  })

  it('reads the legacy single-winner event a room deployed behind the client sends', () => {
    const legacy = { type: 'killSettled', ownerCharacterId: 7, granted: [{ itemId: 'coins', quantity: 5 }], killCount: 3 }
    expect(coopKillOutcome(legacy, 7)).toMatchObject({ kind: 'loot', killCount: 3 })
    expect(coopKillOutcome(legacy, 8).kind).toBe('missed')
  })

  it('matches a member id whatever type it arrives as', () => {
    expect(coopKillOutcome(settled(), '7' as never).kind).toBe('loot')
    expect(coopKillOutcome({ ...settled(), settlements: [{ characterId: '7', granted: [] }] }, 7).kind).toBe('loot')
  })

  it('does not fall over on an event carrying nothing usable', () => {
    expect(coopKillOutcome({ type: 'killSettled' }, 7).kind).toBe('missed')
    expect(coopKillOutcome(null, 7).kind).toBe('missed')
  })
})
