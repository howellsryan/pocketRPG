// Co-op boss sessions — server side (§14 integrity boundary). Runs the real
// session SQL against the real migrations schema (tests/helpers/d1).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { makeD1, FakeD1 } from './helpers/d1'
import { gzipJsonString } from '../functions/_lib/saveCodec.js'
import {
  COOP_SESSION_STALE_MS,
  activeSessionIdFor,
  applyMemberToSave,
  applyXpGainedToSave,
  coopBossSummary,
  isCoopBoss,
  isCoopSessionLive,
  joinCoopSession,
  leaveCoopSession,
  listOpenSessions,
  parseSessionState,
  readSession,
  settleCoopKill,
  sweepStaleCoopSessions,
} from '../functions/_lib/game/coopBoss.js'
import { validateCoopAction } from '../functions/api/coop/session/[id]/intent.js'
import { shouldAdvanceCoopTick } from '../functions/api/coop/session/[id]/tick.js'
import { MAX_XP } from '../src/utils/constants.js'
import { COOP_MAX_MEMBERS } from '../src/engine/coopBossEngine.js'

const BOSS = 'corporeal_horror'
const QUEST = 'the_heart_of_shadows'

let env: { DB: FakeD1 }
let raw: any

function baseSave(overrides: Record<string, unknown> = {}) {
  const inventory = new Array(28).fill(null)
  inventory[0] = { itemId: 'shark', quantity: 10 }
  return {
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
    completedQuests: [QUEST],
    ...overrides,
  }
}

async function seedCharacter(id: number, { ownerId = 1, save = baseSave() } = {}) {
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

function readSave(id: number) {
  const row = raw.prepare('SELECT save_data FROM saves WHERE character_id = ?').get(id)
  return JSON.parse(row.save_data)
}

beforeEach(() => {
  const d = makeD1()
  env = { DB: d.DB }
  raw = d.raw
})

describe('coop boss allowlist', () => {
  it('accepts the shipped co-op boss', () => {
    expect(isCoopBoss(BOSS)).toBe(true)
  })

  it('accepts Warlord Grondar', () => {
    expect(isCoopBoss('warlord_grondar')).toBe(true)
  })

  it('rejects a boss that has not been opened up for co-op', () => {
    expect(isCoopBoss('tekton')).toBe(false)
  })

  it('rejects non-bosses and junk', () => {
    expect(isCoopBoss('goblin')).toBe(false)
    expect(isCoopBoss('')).toBe(false)
    expect(isCoopBoss(null as never)).toBe(false)
    expect(isCoopBoss('../../etc/passwd')).toBe(false)
  })

  it('summarises a co-op boss for the picker', () => {
    const summary = coopBossSummary(BOSS)
    expect(summary?.name).toBe('The Corporeal Horror')
    expect(summary?.hitpoints).toBe(2000)
    expect(summary?.maxMembers).toBe(COOP_MAX_MEMBERS)
  })
})

describe('joining a co-op session', () => {
  it('creates a session, seeds the boss at full HP and locks the joiner save', async () => {
    await seedCharacter(7)
    const { sessionId } = await joinCoopSession(env as never, {
      characterId: 7, identityId: 1, bossId: BOSS, username: 'player7',
    })

    const row = await readSession(env as never, sessionId)
    expect(row.status).toBe('active')
    expect(row.member_count).toBe(1)
    const state = parseSessionState(row)
    expect(state.boss.currentHP).toBe(2000)
    expect(state.members['7'].username).toBe('player7')
    expect(await activeSessionIdFor(env as never, 7)).toBe(sessionId)
  })

  it('puts a second joiner into the SAME instance rather than a new one', async () => {
    await seedCharacter(7)
    await seedCharacter(8)
    const first = await joinCoopSession(env as never, { characterId: 7, identityId: 1, bossId: BOSS, username: 'player7' })
    const second = await joinCoopSession(env as never, { characterId: 8, identityId: 1, bossId: BOSS, username: 'player8' })

    expect(second.sessionId).toBe(first.sessionId)
    const row = await readSession(env as never, first.sessionId)
    expect(row.member_count).toBe(2)
    expect(Object.keys(parseSessionState(row).members).sort()).toEqual(['7', '8'])
  })

  it('returns the existing session when the same character joins twice', async () => {
    await seedCharacter(7)
    const first = await joinCoopSession(env as never, { characterId: 7, identityId: 1, bossId: BOSS, username: 'player7' })
    const again = await joinCoopSession(env as never, { characterId: 7, identityId: 1, bossId: BOSS, username: 'player7' })
    expect(again.sessionId).toBe(first.sessionId)
    expect(again.rejoined).toBe(true)
    expect((await readSession(env as never, first.sessionId)).member_count).toBe(1)
  })

  it('refuses a boss that is not on the co-op allowlist', async () => {
    await seedCharacter(7)
    await expect(
      joinCoopSession(env as never, { characterId: 7, identityId: 1, bossId: 'tekton', username: 'player7' }),
    ).rejects.toMatchObject({ code: 'INVALID_COOP_BOSS' })
  })

  it("refuses a character who has not completed the boss's quest", async () => {
    await seedCharacter(7, { save: baseSave({ completedQuests: [] }) })
    await expect(
      joinCoopSession(env as never, { characterId: 7, identityId: 1, bossId: BOSS, username: 'player7' }),
    ).rejects.toMatchObject({ code: 'QUEST_REQUIRED' })
    expect(await activeSessionIdFor(env as never, 7)).toBeNull()
  })

  it('joins at full HP when the save carries no usable current HP', async () => {
    await seedCharacter(7, { save: baseSave({ player: { currentHP: 0 } }) })
    const { sessionId } = await joinCoopSession(env as never, { characterId: 7, identityId: 1, bossId: BOSS, username: 'player7' })
    const member = parseSessionState(await readSession(env as never, sessionId)).members['7']
    expect(member.hp).toBe(member.maxHP)
    expect(member.hp).toBeGreaterThan(0)
  })

  it('carries a wounded character into the fight on their real HP', async () => {
    await seedCharacter(7, { save: baseSave({ player: { currentHP: 12 } }) })
    const { sessionId } = await joinCoopSession(env as never, { characterId: 7, identityId: 1, bossId: BOSS, username: 'player7' })
    expect(parseSessionState(await readSession(env as never, sessionId)).members['7'].hp).toBe(12)
  })

  it('opens a second instance once the first is full rather than overfilling it', async () => {
    const ids = Array.from({ length: COOP_MAX_MEMBERS + 1 }, (_, i) => 20 + i)
    for (const id of ids) await seedCharacter(id)
    const sessionIds = new Set<number>()
    for (const id of ids) {
      const { sessionId } = await joinCoopSession(env as never, { characterId: id, identityId: 1, bossId: BOSS, username: `player${id}` })
      sessionIds.add(sessionId)
    }

    expect(sessionIds.size).toBe(2)
    const rows = raw.prepare("SELECT member_count FROM coop_boss_sessions WHERE status = 'active' ORDER BY member_count DESC").all()
    expect(rows.map((r: any) => r.member_count)).toEqual([COOP_MAX_MEMBERS, 1])
    for (const row of rows) expect(row.member_count).toBeLessThanOrEqual(COOP_MAX_MEMBERS)
  })

  it('still writes the joiner save exactly once when the first slot claim is contended', async () => {
    await seedCharacter(7)
    await seedCharacter(8)
    const first = await joinCoopSession(env as never, { characterId: 7, identityId: 1, bossId: BOSS, username: 'player7' })
    // Simulate the session advancing between the picker read and the claim.
    raw.prepare('UPDATE coop_boss_sessions SET current_tick = current_tick + 1 WHERE id = ?').run(first.sessionId)

    const second = await joinCoopSession(env as never, { characterId: 8, identityId: 1, bossId: BOSS, username: 'player8' })
    expect(second.sessionId).toBeGreaterThan(0)
    expect(await activeSessionIdFor(env as never, 8)).toBe(second.sessionId)
    // A retry that re-ran the pre-join save write would have thrown a revision
    // conflict instead of landing the join.
    expect(raw.prepare('SELECT save_revision FROM saves WHERE character_id = 8').get().save_revision).toBe(2)
  })

  it('opens a Grondar fight, which needs no quest', async () => {
    await seedCharacter(7, { save: baseSave({ completedQuests: [] }) })
    const { sessionId } = await joinCoopSession(env as never, {
      characterId: 7, identityId: 1, bossId: 'warlord_grondar', username: 'player7',
    })
    const row = await readSession(env as never, sessionId)
    expect(row.boss_id).toBe('warlord_grondar')
    expect(parseSessionState(row).boss.currentHP).toBe(255)
  })

  it('keeps each boss in its own instances', async () => {
    await seedCharacter(7)
    await seedCharacter(8)
    const horror = await joinCoopSession(env as never, { characterId: 7, identityId: 1, bossId: BOSS, username: 'player7' })
    const grondar = await joinCoopSession(env as never, { characterId: 8, identityId: 1, bossId: 'warlord_grondar', username: 'player8' })

    expect(grondar.sessionId).not.toBe(horror.sessionId)
    expect(await listOpenSessions(env as never, BOSS)).toHaveLength(1)
    expect(await listOpenSessions(env as never, 'warlord_grondar')).toHaveLength(1)
  })

  it('lists an open session for the picker with live boss HP', async () => {
    await seedCharacter(7)
    await joinCoopSession(env as never, { characterId: 7, identityId: 1, bossId: BOSS, username: 'player7' })
    const open = await listOpenSessions(env as never, BOSS)
    expect(open).toHaveLength(1)
    expect(open[0]).toMatchObject({ memberCount: 1, bossHP: 2000, bossMaxHP: 2000, full: false })
  })
})

describe('leaving a co-op session', () => {
  it('writes the fight results back to the save and releases the lock', async () => {
    await seedCharacter(7)
    const { sessionId } = await joinCoopSession(env as never, { characterId: 7, identityId: 1, bossId: BOSS, username: 'player7' })

    // Simulate a fight: supplies spent, XP earned, HP lost.
    const row = await readSession(env as never, sessionId)
    const state = parseSessionState(row)
    state.members['7'].inventory[0] = { itemId: 'shark', quantity: 4 }
    state.members['7'].xpGained = { attack: 5000, hitpoints: 1600 }
    state.members['7'].hp = 31
    raw.prepare('UPDATE coop_boss_sessions SET state_json = ? WHERE id = ?').run(JSON.stringify(state), sessionId)

    await leaveCoopSession(env as never, { characterId: 7, identityId: 1, sessionId })

    const save = readSave(7)
    expect(save.inventory[0]).toEqual({ itemId: 'shark', quantity: 4 })
    expect(save.stats.attack.xp).toBe(13_034_431 + 5000)
    expect(save.player.currentHP).toBe(31)
    expect(await activeSessionIdFor(env as never, 7)).toBeNull()
  })

  it('closes the session once the last member leaves', async () => {
    await seedCharacter(7)
    const { sessionId } = await joinCoopSession(env as never, { characterId: 7, identityId: 1, bossId: BOSS, username: 'player7' })
    await leaveCoopSession(env as never, { characterId: 7, identityId: 1, sessionId })
    expect((await readSession(env as never, sessionId)).status).toBe('completed')
  })

  it('keeps the session alive for the others when one member leaves', async () => {
    await seedCharacter(7)
    await seedCharacter(8)
    const { sessionId } = await joinCoopSession(env as never, { characterId: 7, identityId: 1, bossId: BOSS, username: 'player7' })
    await joinCoopSession(env as never, { characterId: 8, identityId: 1, bossId: BOSS, username: 'player8' })

    await leaveCoopSession(env as never, { characterId: 7, identityId: 1, sessionId })

    const row = await readSession(env as never, sessionId)
    expect(row.status).toBe('active')
    expect(row.member_count).toBe(1)
    expect(Object.keys(parseSessionState(row).members)).toEqual(['8'])
    expect(await activeSessionIdFor(env as never, 8)).toBe(sessionId)
  })
})

describe('coop kill settlement', () => {
  async function sessionWithKill(topDamageId: number) {
    await seedCharacter(7)
    await seedCharacter(8)
    const { sessionId } = await joinCoopSession(env as never, { characterId: 7, identityId: 1, bossId: BOSS, username: 'player7' })
    await joinCoopSession(env as never, { characterId: 8, identityId: 1, bossId: BOSS, username: 'player8' })
    const row = await readSession(env as never, sessionId)
    const state = parseSessionState(row)
    state.members['7'].damage = topDamageId === 7 ? 1500 : 100
    state.members['8'].damage = topDamageId === 8 ? 1500 : 100
    return { session: row, state, kill: { bossId: BOSS, ownerCharacterId: topDamageId, contributors: [] } }
  }

  it('grants the drop, collection log and kill count to the top-damage member only', async () => {
    // Force every drop roll to land so the settlement has something to grant.
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const { session, state, kill } = await sessionWithKill(7)

    const out = await settleCoopKill(env as never, { session, state, kill })
    expect(out.ownerCharacterId).toBe(7)
    expect(out.granted.length).toBeGreaterThan(0)
    expect(out.killCount).toBe(1)

    const kcOwner = raw.prepare("SELECT kill_count FROM kill_counts WHERE character_id = 7 AND source_id = ?").get(BOSS)
    expect(kcOwner.kill_count).toBe(1)
    const kcOther = raw.prepare("SELECT kill_count FROM kill_counts WHERE character_id = 8 AND source_id = ?").get(BOSS)
    expect(kcOther).toBeUndefined()

    const logged = raw.prepare('SELECT item_id FROM collection_log WHERE character_id = 8').all()
    expect(logged).toHaveLength(0)
  })

  it('leaves the loot in the winner session inventory so leaving cannot wipe it', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const { session, state, kill } = await sessionWithKill(7)
    const before = JSON.stringify(state.members['7'].inventory)

    await settleCoopKill(env as never, { session, state, kill })

    expect(JSON.stringify(state.members['7'].inventory)).not.toBe(before)
    const saveInv = JSON.stringify(readSave(7).inventory)
    expect(JSON.stringify(state.members['7'].inventory)).toBe(saveInv)
  })

  it('clears the winner accrued XP so leaving cannot grant it twice', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const { session, state, kill } = await sessionWithKill(7)
    state.members['7'].xpGained = { attack: 4000 }

    await settleCoopKill(env as never, { session, state, kill })
    expect(state.members['7'].xpGained).toEqual({})
    expect(readSave(7).stats.attack.xp).toBe(13_034_431 + 4000)

    await leaveCoopSession(env as never, { characterId: 7, identityId: 1, sessionId: session.id })
    expect(readSave(7).stats.attack.xp).toBe(13_034_431 + 4000)
  })

  it('grants nothing when nobody dealt damage', async () => {
    await seedCharacter(7)
    const { sessionId } = await joinCoopSession(env as never, { characterId: 7, identityId: 1, bossId: BOSS, username: 'player7' })
    const session = await readSession(env as never, sessionId)
    const state = parseSessionState(session)
    const out = await settleCoopKill(env as never, { session, state, kill: { bossId: BOSS, ownerCharacterId: null, contributors: [] } })
    expect(out.granted).toEqual([])
    expect(out.ownerCharacterId).toBeNull()
  })
})

describe('coop save lock', () => {
  it('locks the save while the session is being ticked', async () => {
    await seedCharacter(7)
    await joinCoopSession(env as never, { characterId: 7, identityId: 1, bossId: BOSS, username: 'player7' })
    expect(await isCoopSessionLive(env as never, 7)).toBe(true)
  })

  it('lapses the lock once nobody has ticked, so a closed tab cannot strand a save', async () => {
    await seedCharacter(7)
    const { sessionId } = await joinCoopSession(env as never, { characterId: 7, identityId: 1, bossId: BOSS, username: 'player7' })
    raw.prepare('UPDATE coop_boss_sessions SET last_tick_at = ? WHERE id = ?')
      .run(Date.now() - COOP_SESSION_STALE_MS - 1, sessionId)
    expect(await isCoopSessionLive(env as never, 7)).toBe(false)
  })

  it('does not lock a character who is not in a session', async () => {
    await seedCharacter(7)
    expect(await isCoopSessionLive(env as never, 7)).toBe(false)
  })

  it('sweeps a stale session and frees its members', async () => {
    await seedCharacter(7)
    const { sessionId } = await joinCoopSession(env as never, { characterId: 7, identityId: 1, bossId: BOSS, username: 'player7' })
    raw.prepare('UPDATE coop_boss_sessions SET last_tick_at = ? WHERE id = ?')
      .run(Date.now() - COOP_SESSION_STALE_MS - 1, sessionId)

    expect(await sweepStaleCoopSessions(env as never)).toBe(1)
    expect((await readSession(env as never, sessionId)).status).toBe('abandoned')
    expect(await activeSessionIdFor(env as never, 7)).toBeNull()
  })

  it('leaves a live session alone when sweeping', async () => {
    await seedCharacter(7)
    const { sessionId } = await joinCoopSession(env as never, { characterId: 7, identityId: 1, bossId: BOSS, username: 'player7' })
    expect(await sweepStaleCoopSessions(env as never)).toBe(0)
    expect((await readSession(env as never, sessionId)).status).toBe('active')
  })
})

describe('coop intent validation', () => {
  it('accepts the supported actions', () => {
    expect(validateCoopAction({ type: 'change_stance', stance: 'defensive' }).action).toEqual({ type: 'change_stance', stance: 'defensive' })
    expect(validateCoopAction({ type: 'queue_special' }).action).toEqual({ type: 'queue_special' })
    expect(validateCoopAction({ type: 'eat', inventorySlot: 3 }).action).toEqual({ type: 'eat', inventorySlot: 3 })
    expect(validateCoopAction({ type: 'drink_potion', inventorySlot: 0 }).action).toEqual({ type: 'drink_potion', inventorySlot: 0 })
    expect(validateCoopAction({ type: 'equip', inventorySlot: 5 }).action).toEqual({ type: 'equip', inventorySlot: 5 })
  })

  it('bounds an equip slot to the pack, like the other slot actions', () => {
    expect(validateCoopAction({ type: 'equip', inventorySlot: 28 }).error).toBe('invalid_inventory_slot')
    expect(validateCoopAction({ type: 'equip', inventorySlot: -1 }).error).toBe('invalid_inventory_slot')
    expect(validateCoopAction({ type: 'equip' }).error).toBe('invalid_inventory_slot')
  })

  it('rejects an unknown action type', () => {
    expect(validateCoopAction({ type: 'grant_me_loot' }).error).toBe('unknown_action')
  })

  it('rejects a bogus stance', () => {
    expect(validateCoopAction({ type: 'change_stance', stance: 'godmode' }).error).toBe('invalid_stance')
  })

  it('rejects an inventory slot outside the 28-slot pack', () => {
    expect(validateCoopAction({ type: 'eat', inventorySlot: 28 }).error).toBe('invalid_inventory_slot')
    expect(validateCoopAction({ type: 'eat', inventorySlot: -1 }).error).toBe('invalid_inventory_slot')
    expect(validateCoopAction({ type: 'eat', inventorySlot: 1.5 }).error).toBe('invalid_inventory_slot')
    expect(validateCoopAction({ type: 'eat' }).error).toBe('invalid_inventory_slot')
  })

  it('rejects an unknown prayer and spell', () => {
    expect(validateCoopAction({ type: 'toggle_prayer', prayerId: 'invincibility' }).error).toBe('invalid_prayer')
    expect(validateCoopAction({ type: 'change_combat_spell', spellId: 'instant_win' }).error).toBe('invalid_spell')
  })

  it('rejects a non-object action', () => {
    expect(validateCoopAction(null).error).toBe('invalid_action')
    expect(validateCoopAction('eat' as never).error).toBe('invalid_action')
  })

  it('strips extra fields rather than passing them through to the engine', () => {
    expect(validateCoopAction({ type: 'queue_special', damage: 99999, characterId: 7 } as never).action)
      .toEqual({ type: 'queue_special' })
  })
})

describe('coop tick pacing', () => {
  it('advances on the first ever tick', () => {
    expect(shouldAdvanceCoopTick(1_000, 0).advance).toBe(true)
  })

  it('refuses a tick that arrives inside the 600ms window', () => {
    expect(shouldAdvanceCoopTick(1_100, 1_000).advance).toBe(false)
  })

  it('advances once the window has elapsed', () => {
    expect(shouldAdvanceCoopTick(1_600, 1_000).advance).toBe(true)
  })

  it('allows a small grace so a slightly early poll is not wasted', () => {
    expect(shouldAdvanceCoopTick(1_540, 1_000).advance).toBe(true)
  })
})

describe('coop XP writeback', () => {
  it('adds accrued XP onto the save', () => {
    const save: any = { stats: { attack: { xp: 1000 }, hitpoints: { xp: 500 } } }
    applyXpGainedToSave(save, { attack: 250, hitpoints: 83 })
    expect(save.stats.attack.xp).toBe(1250)
    expect(save.stats.hitpoints.xp).toBe(583)
  })

  it('creates a skill entry that did not exist yet', () => {
    const save: any = { stats: {} }
    applyXpGainedToSave(save, { magic: 40 })
    expect(save.stats.magic.xp).toBe(40)
  })

  it('never exceeds the 200m XP cap', () => {
    const save: any = { stats: { attack: { xp: MAX_XP - 10 } } }
    expect(applyXpGainedToSave(save, { attack: 5000 }).attack).toBe(10)
    expect(save.stats.attack.xp).toBe(MAX_XP)
  })

  it('ignores zero and negative gains', () => {
    const save: any = { stats: { attack: { xp: 100 } } }
    applyXpGainedToSave(save, { attack: 0, strength: -50 })
    expect(save.stats.attack.xp).toBe(100)
    expect(save.stats.strength).toBeUndefined()
  })

  it('preserves other fields on the skill record', () => {
    const save: any = { stats: { attack: { xp: 100, someFlag: true } } }
    applyXpGainedToSave(save, { attack: 5 })
    expect(save.stats.attack.someFlag).toBe(true)
  })
})

describe('coop member writeback', () => {
  const member = {
    hp: 42,
    maxHP: 99,
    inventory: [{ itemId: 'shark', quantity: 2 }, null],
    equipment: { weapon: { itemId: 'krylth_spear', quantity: 1 }, ammo: null },
    xpGained: { attack: 300, hitpoints: 100 },
  }

  it('writes the session supplies, HP and XP back onto the save', () => {
    const save: any = {
      stats: { attack: { xp: 1000 }, hitpoints: { xp: 1000 } },
      inventory: [{ itemId: 'shark', quantity: 9 }],
      equipment: {},
      player: { currentHP: 99, name: 'Tester' },
    }
    const next = applyMemberToSave(save, member)
    expect(next.inventory).toEqual([{ itemId: 'shark', quantity: 2 }, null])
    expect(next.equipment.weapon.itemId).toBe('krylth_spear')
    expect(next.player.currentHP).toBe(42)
    expect(next.stats.attack.xp).toBe(1300)
  })

  it('leaves the bank alone — a co-op session never holds it', () => {
    const save: any = { stats: {}, bank: { coins: 5, shark: 100 }, player: {} }
    expect(applyMemberToSave(save, member).bank).toEqual({ coins: 5, shark: 100 })
  })

  it('keeps unrelated player fields', () => {
    const save: any = { stats: {}, player: { currentHP: 99, name: 'Tester' } }
    expect(applyMemberToSave(save, member).player.name).toBe('Tester')
  })

  it('never writes a negative HP back', () => {
    const save: any = { stats: {}, player: { currentHP: 10 } }
    expect(applyMemberToSave(save, { ...member, hp: -5 }).player.currentHP).toBe(0)
  })

  it('does not mutate the save it was handed', () => {
    const save: any = { stats: { attack: { xp: 1000 } }, inventory: [], equipment: {}, player: { currentHP: 99 } }
    applyMemberToSave(save, member)
    expect(save.inventory).toEqual([])
    expect(save.player.currentHP).toBe(99)
  })
})
