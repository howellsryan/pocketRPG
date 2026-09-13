// Raid parties — server side (§14 integrity boundary). Runs the real session
// SQL, including migration 0034, against the real schema (tests/helpers/d1).
import { describe, it, expect, beforeEach } from 'vitest'
import { makeD1, FakeD1 } from './helpers/d1'
import { gzipJsonString } from '../functions/_lib/saveCodec.js'
import {
  activeRaidPartyFor,
  coopRaidCatalogue,
  coopRaidRequirementFailure,
  joinCoopRaidParty,
  listOpenRaidParties,
} from '../functions/_lib/game/coopRaid.js'
import {
  activeSessionIdFor,
  isCoopSessionLive,
  parseSessionState,
  readSession,
  settleCoopKill,
} from '../functions/_lib/game/coopBoss.js'
import { validateCoopAction } from '../functions/api/coop/session/[id]/intent.js'
import { COOP_MAX_MEMBERS } from '../src/engine/coopBossEngine.js'
import { raidBossOrder } from '../src/engine/coopRaidEngine.js'

const RAID = 'cryptbound_champions'

let env: { DB: FakeD1; COOP_ROOM?: unknown }
let raw: any
/** Every room call this test made, so the join path can be asserted to go
 * through the room rather than writing a member straight into D1. */
let roomCalls: Array<{ action: string; body: any }>
let roomReply: { status: number; body: any }

function fakeCoopRoom() {
  return {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: async (url: string, init: any) => {
        const action = new URL(url).pathname.replace('/', '')
        roomCalls.push({ action, body: JSON.parse(init.body) })
        return new Response(JSON.stringify(roomReply.body), { status: roomReply.status })
      },
    }),
  }
}

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
    completedQuests: ['a_night_at_the_theatre'],
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
  return JSON.parse(raw.prepare('SELECT save_data FROM saves WHERE character_id = ?').get(id).save_data)
}

beforeEach(() => {
  const d = makeD1()
  roomCalls = []
  roomReply = { status: 200, body: { ok: true, tick: 0 } }
  env = { DB: d.DB, COOP_ROOM: fakeCoopRoom() }
  raw = d.raw
})

describe('raid catalogue', () => {
  it('lists each raid once, with its boss order', () => {
    const catalogue = coopRaidCatalogue()
    const ids = catalogue.map((r) => r.raidId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(expect.arrayContaining([
      'vaults_of_xyren',
      'crimson_night_theatre',
      'cryptbound_champions',
      'tomb_of_arasmus',
      'sunspire_colosseum',
    ]))
    const barrows = catalogue.find((r) => r.raidId === RAID)!
    expect(barrows.bossCount).toBe(raidBossOrder(RAID).length)
    expect(barrows.bossNames).toHaveLength(raidBossOrder(RAID).length)
  })

  it('refuses a raid id that is not a raid', () => {
    expect(coopRaidRequirementFailure('not_a_raid', baseSave())?.code).toBe('INVALID_COOP_RAID')
    // The legacy alias key is not a party-able id — offering both would list the
    // same run twice.
    expect(coopRaidRequirementFailure('barrows_brothers', baseSave())?.code).toBe('INVALID_COOP_RAID')
  })
})

describe('opening a party', () => {
  it('creates a lobby with the opener as host and locks their save', async () => {
    await seedCharacter(7)
    const { sessionId } = await joinCoopRaidParty(env as never, {
      characterId: 7, identityId: 1, raidId: RAID, username: 'player7',
    })

    const row = await readSession(env as never, sessionId)
    expect(row.status).toBe('active')
    expect(row.phase).toBe('lobby')
    expect(row.raid_id).toBe(RAID)
    expect(row.host_character_id).toBe(7)
    expect(row.boss_id).toBe(raidBossOrder(RAID)[0])
    expect(await activeSessionIdFor(env as never, 7)).toBe(sessionId)
    expect(await isCoopSessionLive(env as never, 7)).toBe(true)
  })

  it('seeds the run from the raid rather than a single boss', async () => {
    await seedCharacter(7)
    const { sessionId } = await joinCoopRaidParty(env as never, {
      characterId: 7, identityId: 1, raidId: RAID, username: 'player7',
    })
    const state = parseSessionState(await readSession(env as never, sessionId))
    expect(state.raid.raidId).toBe(RAID)
    expect(state.raid.bosses).toEqual(raidBossOrder(RAID))
    expect(state.raid.maxHP).toBeGreaterThan(state.boss.maxHP)
    expect(state.phase).toBe('lobby')
  })

  it('opens a party without going near the room — there is nothing running yet', async () => {
    await seedCharacter(7)
    await joinCoopRaidParty(env as never, { characterId: 7, identityId: 1, raidId: RAID, username: 'player7' })
    expect(roomCalls).toHaveLength(0)
  })

  it('bumps the save revision so the joiner re-anchors', async () => {
    await seedCharacter(7)
    const { saveRevision } = await joinCoopRaidParty(env as never, {
      characterId: 7, identityId: 1, raidId: RAID, username: 'player7',
    })
    expect(saveRevision).toBe(2)
  })
})

describe('private solo Sunspire', () => {
  it('opens solo Sunspire as an already-active private one-player room', async () => {
    await seedCharacter(7)
    const { sessionId } = await joinCoopRaidParty(env as never, {
      characterId: 7,
      identityId: 1,
      raidId: 'sunspire_colosseum',
      username: 'player7',
      solo: true,
    })

    const row = await readSession(env as never, sessionId)
    const state = parseSessionState(row)
    expect(row.status).toBe('active')
    expect(row.phase).toBe('active')
    expect(state.phase).toBe('active')
    expect(state.raid.raidId).toBe('sunspire_colosseum')
    expect(state.raid.solo).toBe(true)
    expect(Object.keys(state.members)).toEqual(['7'])
    expect(await activeSessionIdFor(env as never, 7)).toBe(sessionId)
    expect((await listOpenRaidParties(env as never)).get('sunspire_colosseum')).toEqual([])
  })

  it('refuses private-solo mode for ordinary raids', async () => {
    await seedCharacter(7)
    await expect(joinCoopRaidParty(env as never, {
      characterId: 7,
      identityId: 1,
      raidId: RAID,
      username: 'player7',
      solo: true,
    })).rejects.toMatchObject({ code: 'INVALID_COOP_RAID' })
  })
})

describe('joining a party', () => {
  async function openParty(characterId: number) {
    await seedCharacter(characterId)
    return joinCoopRaidParty(env as never, {
      characterId, identityId: 1, raidId: RAID, username: `player${characterId}`,
    })
  }

  it('goes through the room, so a warm party cannot erase the joiner', async () => {
    const { sessionId } = await openParty(7)
    await seedCharacter(8)
    const joined = await joinCoopRaidParty(env as never, {
      characterId: 8, identityId: 1, raidId: RAID, username: 'player8', sessionId,
    })
    expect(joined.sessionId).toBe(sessionId)
    expect(roomCalls.map((c) => c.action)).toEqual(['join'])
    expect(roomCalls[0].body.characterId).toBe(8)
    expect(await activeSessionIdFor(env as never, 8)).toBe(sessionId)
  })

  it('refuses once the host has set off, and releases the lock it took', async () => {
    const { sessionId } = await openParty(7)
    await seedCharacter(8)
    roomReply = { status: 409, body: { error: 'raid_in_progress' } }

    await expect(joinCoopRaidParty(env as never, {
      characterId: 8, identityId: 1, raidId: RAID, username: 'player8', sessionId,
    })).rejects.toMatchObject({ code: 'RAID_ALREADY_STARTED' })

    // The lock is claimed before the room call, so a refusal has to hand it back
    // or the player is wedged out of their own save.
    expect(await activeSessionIdFor(env as never, 8)).toBeNull()
    expect(await isCoopSessionLive(env as never, 8)).toBe(false)
  })

  it('refuses a full party', async () => {
    const { sessionId } = await openParty(7)
    raw.prepare('UPDATE coop_boss_sessions SET member_count = ? WHERE id = ?').run(COOP_MAX_MEMBERS, sessionId)
    await seedCharacter(8)
    await expect(joinCoopRaidParty(env as never, {
      characterId: 8, identityId: 1, raidId: RAID, username: 'player8', sessionId,
    })).rejects.toMatchObject({ code: 'COOP_SESSION_UNAVAILABLE' })
    expect(roomCalls).toHaveLength(0)
  })

  it('refuses a party belonging to a different raid', async () => {
    const { sessionId } = await openParty(7)
    await seedCharacter(8)
    await expect(joinCoopRaidParty(env as never, {
      characterId: 8, identityId: 1, raidId: 'tomb_of_arasmus', username: 'player8', sessionId,
    })).rejects.toMatchObject({ code: 'COOP_SESSION_UNAVAILABLE' })
  })

  it('lets a member rejoin the party they are already held by', async () => {
    const { sessionId } = await openParty(7)
    const again = await joinCoopRaidParty(env as never, {
      characterId: 7, identityId: 1, raidId: RAID, username: 'player7', sessionId,
    })
    expect(again).toMatchObject({ sessionId, rejoined: true })
  })

  it('refuses to move a character between group fights', async () => {
    await openParty(7)
    await expect(joinCoopRaidParty(env as never, {
      characterId: 7, identityId: 1, raidId: 'tomb_of_arasmus', username: 'player7',
    })).rejects.toMatchObject({ code: 'CHARACTER_IN_COOP_SESSION' })
  })
})

describe('the lobby list', () => {
  it('advertises a waiting party with its roster', async () => {
    await seedCharacter(7)
    const { sessionId } = await joinCoopRaidParty(env as never, {
      characterId: 7, identityId: 1, raidId: RAID, username: 'player7',
    })
    const byRaid = await listOpenRaidParties(env as never)
    const parties = byRaid.get(RAID)!
    expect(parties).toHaveLength(1)
    expect(parties[0]).toMatchObject({ sessionId, hostCharacterId: 7, memberCount: 1, full: false })
    expect(parties[0].members.map((m: any) => m.username)).toEqual(['player7'])
  })

  it('stops advertising a party once it has set off', async () => {
    await seedCharacter(7)
    const { sessionId } = await joinCoopRaidParty(env as never, {
      characterId: 7, identityId: 1, raidId: RAID, username: 'player7',
    })
    raw.prepare("UPDATE coop_boss_sessions SET phase = 'active' WHERE id = ?").run(sessionId)
    expect((await listOpenRaidParties(env as never)).get(RAID)).toEqual([])
    // Still the character's party, though — they need a way back into it.
    expect(await activeRaidPartyFor(env as never, 7)).toMatchObject({ sessionId, raidId: RAID, phase: 'active' })
  })

  it('leaves a boss room out of the raid list entirely', async () => {
    await seedCharacter(7)
    raw.prepare(
      `INSERT INTO coop_boss_sessions (boss_id, status, member_count, created_at, current_tick, state_json, last_tick_at, kill_seq, phase)
       VALUES ('corporeal_horror', 'active', 1, 0, 0, '{}', ?, 0, 'active')`,
    ).run(Date.now())
    for (const parties of (await listOpenRaidParties(env as never)).values()) expect(parties).toEqual([])
  })
})

describe('settling a raid clear', () => {
  it('grants the RAID reward table, not the final boss drop table', async () => {
    await seedCharacter(7)
    const { sessionId } = await joinCoopRaidParty(env as never, {
      characterId: 7, identityId: 1, raidId: RAID, username: 'player7',
    })
    const state = parseSessionState(await readSession(env as never, sessionId))
    const finalBoss = raidBossOrder(RAID)[raidBossOrder(RAID).length - 1]

    const settlement = await settleCoopKill(env as never, {
      session: { id: sessionId, boss_id: finalBoss, raid_id: RAID },
      state,
      kill: { sourceType: 'raids', raidId: RAID, ownerCharacterId: 7, lootCharacterIds: [7], contributors: [] },
      killSeq: 1,
    })

    expect(settlement.settlements).toHaveLength(1)
    // The kill count and the collection log are filed under the raid, the same
    // way /api/actions/raid/complete files them.
    const kc = raw.prepare('SELECT source_type, source_id FROM kill_counts WHERE character_id = 7').get()
    expect(kc).toMatchObject({ source_type: 'raids', source_id: RAID })
    for (const entry of settlement.settlements[0].collectionLogEntries || []) {
      expect(entry.sourceType).toBe('raids')
      expect(entry.sourceId).toBe(RAID)
    }
    // Whatever was rolled actually reached the save.
    const granted = settlement.settlements[0].granted || []
    if (granted.length > 0) {
      const save = readSave(7)
      const carried = [...(save.inventory || []).filter(Boolean).map((s: any) => s.itemId), ...Object.keys(save.bank || {})]
      expect(carried).toContain(granted[0].itemId)
    }
  })

  it('settles a raid clear exactly once per character', async () => {
    await seedCharacter(7)
    const { sessionId } = await joinCoopRaidParty(env as never, {
      characterId: 7, identityId: 1, raidId: RAID, username: 'player7',
    })
    const state = parseSessionState(await readSession(env as never, sessionId))
    const args = {
      session: { id: sessionId, boss_id: raidBossOrder(RAID)[0], raid_id: RAID },
      state,
      kill: { sourceType: 'raids', raidId: RAID, ownerCharacterId: 7, lootCharacterIds: [7], contributors: [] },
      killSeq: 1,
    }
    const first = await settleCoopKill(env as never, args as never)
    const replay = await settleCoopKill(env as never, args as never)

    expect(replay.settlements[0].replayed).toBe(true)
    expect(replay.settlements[0].granted).toEqual(first.settlements[0].granted)
    const kc = raw.prepare('SELECT kill_count FROM kill_counts WHERE character_id = 7').get()
    expect(kc.kill_count).toBe(1)
  })
})

describe('the start-raid intent', () => {
  it('is accepted with no payload — the room decides who may use it', () => {
    expect(validateCoopAction({ type: 'start_raid' })).toEqual({ action: { type: 'start_raid' } })
    expect(validateCoopAction({ type: 'start_raid', characterId: 99 })).toEqual({ action: { type: 'start_raid' } })
  })
})

describe('the set-ready intent', () => {
  it('reaches the room at all', () => {
    // The edge validator is an allowlist: an action missing from it is a 400
    // `unknown_action` that never reaches the engine, so the button errors and
    // the client's echo un-does itself. Every new intent needs a case here.
    expect(validateCoopAction({ type: 'set_ready', value: true })).toEqual({
      action: { type: 'set_ready', value: true },
    })
  })

  it('normalises the flag rather than passing what it was sent', () => {
    expect(validateCoopAction({ type: 'set_ready' })).toEqual({ action: { type: 'set_ready', value: false } })
    expect(validateCoopAction({ type: 'set_ready', value: 'yes' })).toEqual({ action: { type: 'set_ready', value: true } })
  })
})
