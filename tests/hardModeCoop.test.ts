// Hard mode inside a co-op room. The room resolves every swing and grants the
// loot (§14/§20), so the difficulty is a property of the ROOM: it is fixed when
// the room opens, rides state_json, and every monster the tick looks up comes
// out of the scaled table.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { makeD1 } from './helpers/d1'
import { gzipJsonString } from '../functions/_lib/saveCodec.js'
import { joinCoopSession, listOpenSessions, parseSessionState, readSession, settleCoopKill } from '../functions/_lib/game/coopBoss.js'
import { setHardModeTarget } from '../functions/_lib/game/hardMode.js'
import {
  addCoopMember,
  createCoopBossState,
  createCoopMember,
  createCoopRaidState,
  coopLootBasisHP,
  processCoopTick,
} from '../src/engine/coopBossEngine.js'
import { raidTotalHitpoints } from '../src/engine/coopRaidEngine.js'
import { HARD_MODE_SCALE } from '../src/engine/hardMode.js'
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
  it('opens the room on doubled health and remembers the choice', () => {
    const normal = createCoopBossState(BOSS, monstersData)!
    const hard = createCoopBossState(BOSS, monstersData, Date.now(), { hardMode: true })!
    expect(normal.hardMode).toBe(false)
    expect(hard.hardMode).toBe(true)
    expect(hard.boss.maxHP).toBe(normal.boss.maxHP * HARD_MODE_SCALE)
  })

  it('keeps the boss doubled across ticks, not just at creation', () => {
    let state = addCoopMember(createCoopBossState(BOSS, monstersData, Date.now(), { hardMode: true })!, member(1))
    const maxHP = state.boss.maxHP
    for (let i = 0; i < 5; i++) state = processCoopTick(state, [], deps, Date.now()).stateNext
    expect(state.hardMode).toBe(true)
    expect(state.boss.maxHP).toBe(maxHP)
    expect(state.boss.currentHP).toBeLessThanOrEqual(maxHP)
    expect(state.boss.monster.hitpoints ?? maxHP).toBeGreaterThanOrEqual(anyMonsters[BOSS].hitpoints)
  })

  it('measures a hard raid’s loot gate against the hard run, not the normal one', () => {
    const normal = createCoopRaidState(RAID, monstersData, { hostCharacterId: 1 })!
    const hard = createCoopRaidState(RAID, monstersData, { hostCharacterId: 1, hardMode: true })!
    expect(coopLootBasisHP(normal)).toBe(raidTotalHitpoints(RAID, monstersData))
    expect(coopLootBasisHP(hard)).toBe(coopLootBasisHP(normal) * HARD_MODE_SCALE)
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
    env = { DB: d.DB }
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
    expect(state.boss.maxHP).toBe(anyMonsters[BOSS].hitpoints * HARD_MODE_SCALE)
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
