// Hard mode inside a co-op room. The room resolves every swing and grants the
// loot (§14/§20), so the difficulty is a property of the ROOM: it is fixed when
// the room opens, rides state_json, and every monster the tick looks up comes
// out of the scaled table.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fakeCoopRoom } from './helpers/coopRoom'
import { makeD1 } from './helpers/d1'
import { gzipJsonString } from '../functions/_lib/saveCodec.js'
import { joinCoopSession, listOpenSessions, parseSessionState, readSession, settleCoopKill } from '../functions/_lib/game/coopBoss.js'
import { setHardModeTarget } from '../functions/_lib/game/hardMode.js'
import { projectEventsForMember } from '../functions/_lib/game/coopProjection.js'
import {
  addCoopMember,
  createCoopBossState,
  createCoopMember,
  createCoopRaidState,
  coopLootBasisHP,
  processCoopTick,
} from '../src/engine/coopBossEngine.js'
import { raidTotalHitpoints } from '../src/engine/coopRaidEngine.js'
import { HARD_MODE_MULTIPLIERS } from '../src/engine/hardMode.js'
import itemsData from '../src/data/items.json'
import monstersData from '../src/data/monsters.json'
import prayersData from '../src/data/prayers.json'
import spellsData from '../src/data/spells.json'

const anyMonsters = monstersData as Record<string, any>
const BOSS = 'corporeal_horror'
const RAID = 'cryptbound_champions'
const deps = { itemsData, monstersData, prayersData, spellsData }

function member(characterId: number) {
  return createCoopMember({
    characterId,
    username: `p${characterId}`,
    savePayload: {
      stats: { attack: { xp: 13_034_431 }, strength: { xp: 13_034_431 }, defence: { xp: 13_034_431 }, hitpoints: { xp: 13_034_431 } },
      equipment: { weapon: { itemId: 'krylth_spear', quantity: 1 } },
      inventory: [{ itemId: 'shark', quantity: 5 }, null, null],
      settings: { combatStance: 'aggressive' },
    },
    itemsData,
  })
}

describe('co-op hard mode', () => {
  it('opens the room on a hard boss and remembers the choice', () => {
    const normal = createCoopBossState(BOSS, monstersData)!
    const hard = createCoopBossState(BOSS, monstersData, Date.now(), { hardMode: true })!
    expect(normal.hardMode).toBe(false)
    expect(hard.hardMode).toBe(true)
    // Same health bar as the normal room — hard mode is what the boss does to
    // the party, not how long it takes to bring down.
    expect(hard.boss.maxHP).toBe(normal.boss.maxHP)
    // `boss.monster` is only the mutable subset (no hardModeActive on it), so
    // the proof the scaled table reached the room is the offence it carries.
    expect(hard.boss.monster.attackBonus).toBe(normal.boss.monster.attackBonus * HARD_MODE_MULTIPLIERS.offence)
  })

  it('keeps the boss hard across ticks, not just at creation', () => {
    let state = addCoopMember(createCoopBossState(BOSS, monstersData, Date.now(), { hardMode: true })!, member(1))
    const maxHP = state.boss.maxHP
    for (let i = 0; i < 5; i++) state = processCoopTick(state, [], deps, Date.now()).stateNext
    expect(state.hardMode).toBe(true)
    expect(state.boss.maxHP).toBe(maxHP)
    expect(state.boss.currentHP).toBeLessThanOrEqual(maxHP)
    expect(state.boss.monster.attackBonus).toBe(anyMonsters[BOSS].attackBonus * HARD_MODE_MULTIPLIERS.offence)
  })

  it('measures a raid’s loot gate against the run’s real health, hard or not', () => {
    const normal = createCoopRaidState(RAID, monstersData, { hostCharacterId: 1 })!
    const hard = createCoopRaidState(RAID, monstersData, { hostCharacterId: 1, hardMode: true })!
    expect(coopLootBasisHP(normal)).toBe(raidTotalHitpoints(RAID, monstersData))
    // The basis is read off the table the party is actually fighting, so it
    // tracks the health dial whatever it is set to.
    expect(coopLootBasisHP(hard)).toBe(coopLootBasisHP(normal) * HARD_MODE_MULTIPLIERS.hitpoints)
    expect(hard.hardMode).toBe(true)
  })

  it('a normal room is untouched by the feature', () => {
    const state = createCoopBossState(BOSS, monstersData)!
    expect(state.boss.maxHP).toBe(anyMonsters[BOSS].hitpoints)
  })
})

// Server side: which room a player lands in, and what that room's kills pay.
describe('co-op hard mode, server side', () => {
  let env: any
  let raw: any

  async function seedCharacter(id: number, ownerId = 1) {
    const inventory = new Array(28).fill(null)
    inventory[0] = { itemId: 'shark', quantity: 10 }
    const save = {
      stats: {
        attack: { xp: 13_034_431 }, strength: { xp: 13_034_431 }, defence: { xp: 13_034_431 },
        hitpoints: { xp: 13_034_431 }, ranged: { xp: 13_034_431 }, magic: { xp: 13_034_431 },
        prayer: { xp: 13_034_431 },
      },
      inventory,
      bank: {},
      equipment: { weapon: { itemId: 'krylth_spear', quantity: 1 } },
      player: { currentHP: 99 },
      settings: { combatStance: 'aggressive' },
      completedQuests: ['the_heart_of_shadows'],
    }
    raw.prepare(
      `INSERT INTO characters (id, owner_id, username, created_at, is_ironman, is_one_life, credits, total_pvp_kills, credits_used, total_level, combat_level, is_bot, total_level_at)
       VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, 700, 126, 0, 0)`,
    ).run(id, ownerId, `player${id}`)
    const json = JSON.stringify(save)
    const blob = await gzipJsonString(json)
    raw.prepare(
      'INSERT INTO saves (character_id, save_blob, save_data, updated_at, save_revision) VALUES (?, ?, ?, 0, 1)',
    ).run(id, blob, json)
  }

  beforeEach(() => {
    const d = makeD1()
    env = { DB: d.DB, COOP_ROOM: fakeCoopRoom(d.raw) }
    raw = d.raw
  })

  it('never drops a hard-mode player into a normal room', async () => {
    await seedCharacter(1)
    await seedCharacter(2)
    const normal = await joinCoopSession(env, { characterId: 1, identityId: 1, bossId: BOSS, username: 'player1' })

    await setHardModeTarget(env, 2, 'monsters', BOSS, true)
    const hard = await joinCoopSession(env, { characterId: 2, identityId: 1, bossId: BOSS, username: 'player2' })

    expect(hard.sessionId).not.toBe(normal.sessionId)
    const rows = await listOpenSessions(env, BOSS)
    expect(rows.find((s: any) => s.sessionId === normal.sessionId).hardMode).toBe(false)
    expect(rows.find((s: any) => s.sessionId === hard.sessionId).hardMode).toBe(true)
    const state = parseSessionState(await readSession(env, hard.sessionId))
    expect(state.hardMode).toBe(true)
    expect(state.boss.monster.attackBonus).toBe(anyMonsters[BOSS].attackBonus * HARD_MODE_MULTIPLIERS.offence)
  })

  it('joins the matching room rather than opening a third one', async () => {
    await seedCharacter(1)
    await seedCharacter(2)
    await setHardModeTarget(env, 1, 'monsters', BOSS, true)
    await setHardModeTarget(env, 2, 'monsters', BOSS, true)
    const first = await joinCoopSession(env, { characterId: 1, identityId: 1, bossId: BOSS, username: 'player1' })
    const second = await joinCoopSession(env, { characterId: 2, identityId: 1, bossId: BOSS, username: 'player2' })
    expect(second.sessionId).toBe(first.sessionId)
  })

  it('settles a hard room’s kill at doubled drop rates', async () => {
    await seedCharacter(1)
    await setHardModeTarget(env, 1, 'monsters', BOSS, true)
    const { sessionId } = await joinCoopSession(env, { characterId: 1, identityId: 1, bossId: BOSS, username: 'player1' })
    const session = await readSession(env, sessionId)
    const state = parseSessionState(session)
    expect(session.hard_mode).toBe(1)

    // A drop that only lands when the chance is doubled.
    const drop = anyMonsters[BOSS].drops.find((d: any) => d.chance > 0 && d.chance < 0.5)
    const kill = { ownerCharacterId: 1, lootCharacterIds: [1], contributors: [{ characterId: 1, damage: 999 }] }
    const spy = vi.spyOn(Math, 'random').mockReturnValue(drop.chance * 1.5)
    try {
      const settled: any = await settleCoopKill(env, { session, state, kill, killSeq: 1 })
      expect(settled.settlements[0].granted.some((g: any) => g.itemId === drop.itemId)).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })
})

// The room owns the pack while a member is in it (§20), so the death penalty
// has to land on the MEMBER record — that is what the write-back persists.
describe('dying in a hard-mode room', () => {
  function killMember(state: any, characterId: number) {
    const member = state.members[String(characterId)]
    member.hp = 0
    return processCoopTick(state, [], deps, Date.now())
  }

  function joined(hardMode: boolean) {
    let state = createCoopBossState(BOSS, monstersData, Date.now(), { hardMode })!
    state = addCoopMember(state, member(1))
    state.members['1'].equipment = { weapon: { itemId: 'krylth_spear', quantity: 1 } }
    return state
  }

  it('takes everything carried and worn, and reports the tally to the dead player', () => {
    const out = killMember(joined(true), 1)
    const dead = out.stateNext.members['1']
    expect(dead.status).toBe('dead')
    expect(dead.inventory.every((slot: any) => slot === null)).toBe(true)
    expect(dead.equipment).toEqual({})
    const death = out.events.find((e: any) => e.type === 'memberDeath')
    expect(death.itemsLost).toEqual(expect.arrayContaining([
      { itemId: 'shark', quantity: 5 },
      { itemId: 'krylth_spear', quantity: 1 },
    ]))
  })

  it('leaves a normal room’s death costing exactly what it always cost', () => {
    const out = killMember(joined(false), 1)
    const dead = out.stateNext.members['1']
    expect(dead.status).toBe('dead')
    expect(dead.inventory.some((slot: any) => slot?.itemId === 'shark')).toBe(true)
    expect(dead.equipment.weapon).toEqual({ itemId: 'krylth_spear', quantity: 1 })
    expect(out.events.find((e: any) => e.type === 'memberDeath').itemsLost).toBeNull()
  })

  it('leaves untradeables on the corpse — an Infernal Cape cannot be bought back', () => {
    const state = joined(true)
    state.members['1'].inventory = [{ itemId: 'shark', quantity: 5 }, { itemId: 'infernal_cape', quantity: 1 }]
    state.members['1'].equipment = { weapon: { itemId: 'krylth_spear', quantity: 1 }, cape: { itemId: 'fire_cape', quantity: 1 } }
    const dead = killMember(state, 1).stateNext.members['1']
    expect(dead.inventory).toEqual([null, { itemId: 'infernal_cape', quantity: 1 }])
    expect(dead.equipment).toEqual({ cape: { itemId: 'fire_cape', quantity: 1 } })
  })

  // A raid runs through the same tick as a boss room, and its wipe returns the
  // party to the lobby on the very tick the death lands — so the loss has to be
  // applied before that reset, not after it.
  it('costs a raid party the same pack a boss room costs', () => {
    let state: any = createCoopRaidState(RAID, monstersData, { hostCharacterId: 1, hardMode: true })!
    state = addCoopMember(state, member(1))
    state.phase = 'active'
    state.members['1'].inventory = [{ itemId: 'shark', quantity: 5 }, { itemId: 'infernal_cape', quantity: 1 }]
    state.members['1'].equipment = { weapon: { itemId: 'krylth_spear', quantity: 1 } }
    const out = killMember(state, 1)
    const dead = out.stateNext.members['1']
    expect(dead.status).toBe('dead')
    expect(dead.inventory).toEqual([null, { itemId: 'infernal_cape', quantity: 1 }])
    expect(dead.equipment).toEqual({})
    expect(out.events.find((e: any) => e.type === 'memberDeath').itemsLost).toEqual(expect.arrayContaining([
      { itemId: 'shark', quantity: 5 },
      { itemId: 'krylth_spear', quantity: 1 },
    ]))
    // The wipe fires on the same tick; the party is back in its lobby with the
    // dead member still dead and still stripped.
    expect(out.stateNext.phase).toBe('lobby')
    expect(out.stateNext.members['1'].inventory).toEqual([null, { itemId: 'infernal_cape', quantity: 1 }])
  })

  it('leaves a normal raid party’s death costing exactly what it always cost', () => {
    let state: any = createCoopRaidState(RAID, monstersData, { hostCharacterId: 1 })!
    state = addCoopMember(state, member(1))
    state.phase = 'active'
    state.members['1'].equipment = { weapon: { itemId: 'krylth_spear', quantity: 1 } }
    const dead = killMember(state, 1).stateNext.members['1']
    expect(dead.inventory.some((slot: any) => slot?.itemId === 'shark')).toBe(true)
    expect(dead.equipment.weapon).toEqual({ itemId: 'krylth_spear', quantity: 1 })
  })

  it('keeps one member’s losses off everyone else’s feed', () => {
    const events = [
      { type: 'memberDeath', characterId: 1, itemsLost: [{ itemId: 'shark', quantity: 5 }] },
      { type: 'memberDeath', characterId: 2, itemsLost: [{ itemId: 'twisted_longbow', quantity: 1 }] },
    ]
    const mine = projectEventsForMember(events, 1) as any[]
    expect(mine[0].itemsLost).toHaveLength(1)
    expect(mine[1].itemsLost).toBeNull()
  })
})
