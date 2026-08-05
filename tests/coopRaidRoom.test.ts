// Raid parties through the real CoopBossRoom. The lobby gate and the phase
// checkpoint only exist inside the room — the D1 row is a mirror it writes —
// so both have to be exercised here rather than against the helpers.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeD1, FakeD1 } from './helpers/d1'
import { gzipJsonString } from '../functions/_lib/saveCodec.js'
import { CoopBossRoom } from '../world/server/CoopBossRoom'
import { joinCoopRaidParty, listOpenRaidParties } from '../functions/_lib/game/coopRaid.js'
import { readSession, parseSessionState, leaveCoopSession } from '../functions/_lib/game/coopBoss.js'
import { raidBossOrder } from '../src/engine/coopRaidEngine.js'

const RAID = 'cryptbound_champions'

let env: { DB: FakeD1; COOP_ROOM?: unknown }
let raw: any
let rooms: Map<string, CoopBossRoom>

function baseSave() {
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
  }
}

async function seedCharacter(id: number, ownerId = 1) {
  raw.prepare(
    `INSERT INTO characters (id, owner_id, username, created_at, is_ironman, is_one_life, credits, total_pvp_kills, credits_used, total_level, combat_level, is_bot, total_level_at)
     VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, 700, 126, 0, 0)`,
  ).run(id, ownerId, `player${id}`)
  const json = JSON.stringify(baseSave())
  const blob = await gzipJsonString(json)
  raw.prepare(
    'INSERT INTO saves (character_id, save_blob, save_data, updated_at, save_revision) VALUES (?, ?, ?, 0, 1)',
  ).run(id, blob, json)
}

function makeRoomBinding() {
  rooms = new Map()
  return {
    idFromName: (name: string) => name,
    get: (name: string) => ({
      fetch: (url: string, init?: RequestInit) => {
        if (!rooms.has(name)) rooms.set(name, new CoopBossRoom({} as never, env as never))
        return rooms.get(name)!.fetch(new Request(url, init))
      },
    }),
  }
}

function callRoom(sessionId: number, action: string, body: Record<string, unknown>) {
  const stub = (env.COOP_ROOM as any).get((env.COOP_ROOM as any).idFromName(`coop:${sessionId}`))
  return stub.fetch(`https://coop-room/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, sessionId }),
  })
}

/** Runs the room's own clock forward, letting each beat's awaits settle. */
async function beats(count: number) {
  for (let i = 0; i < count; i++) {
    await vi.advanceTimersByTimeAsync(600)
  }
}

/** Lets work that resolves off the microtask queue finish — the save codec's
 * gunzip runs on the thread pool, which fake timers never reach. */
async function flushRealAsync() {
  vi.useRealTimers()
  await new Promise((resolve) => setTimeout(resolve, 200))
}

beforeEach(() => {
  vi.useFakeTimers()
  const d = makeD1()
  env = { DB: d.DB }
  raw = d.raw
  env.COOP_ROOM = makeRoomBinding()
})

afterEach(() => {
  vi.useRealTimers()
})

async function openParty(characterId: number) {
  await seedCharacter(characterId)
  return joinCoopRaidParty(env as never, {
    characterId, identityId: 1, raidId: RAID, username: `player${characterId}`,
  })
}

describe('a raid party join that the room refuses', () => {
  /** A room that rejects every action — evicted mid-start, or throwing on load.
   * The binding itself can no longer be absent: CoopBossRoom is a local class
   * of the one Worker, which is what retired the capability probe this block
   * used to cover. */
  function makeDeadRoomBinding() {
    return {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: async () => new Response(JSON.stringify({ error: 'invalid_session' }), { status: 400 }),
      }),
    }
  }

  it('does not leave the character locked out of their own save', async () => {
    await seedCharacter(7)
    const opened = await joinCoopRaidParty(env as never, {
      characterId: 7, identityId: 1, raidId: RAID, username: 'player7',
    })
    await leaveCoopSession(env as never, { characterId: 7, identityId: 1, sessionId: opened.sessionId })

    await seedCharacter(8)
    env.COOP_ROOM = makeDeadRoomBinding()
    await expect(joinCoopRaidParty(env as never, {
      characterId: 8, identityId: 1, raidId: RAID, username: 'player8', sessionId: opened.sessionId,
    })).rejects.toBeTruthy()

    const row = raw.prepare('SELECT active_coop_session_id AS id FROM characters WHERE id = 8').all()[0]
    expect(row.id).toBeNull()
  })
})

describe('a raid party lobby', () => {
  it('takes members while it waits', async () => {
    const { sessionId } = await openParty(7)
    await callRoom(sessionId, 'poll', { characterId: 7 })
    await seedCharacter(8)

    const joined = await joinCoopRaidParty(env as never, {
      characterId: 8, identityId: 1, raidId: RAID, username: 'player8', sessionId,
    })
    expect(joined.sessionId).toBe(sessionId)

    const poll = await callRoom(sessionId, 'poll', { characterId: 8 })
    const body = await poll.json() as any
    expect(body.state.phase).toBe('lobby')
    expect(body.state.memberCount).toBe(2)
    expect(body.state.hostCharacterId).toBe(7)
  })

  it('shows a member what the rest of the party is bringing', async () => {
    const { sessionId } = await openParty(7)
    await callRoom(sessionId, 'poll', { characterId: 7 })
    await seedCharacter(8)
    await joinCoopRaidParty(env as never, {
      characterId: 8, identityId: 1, raidId: RAID, username: 'player8', sessionId,
    })

    const body = await (await callRoom(sessionId, 'poll', { characterId: 8 })).json() as any
    expect(body.state.members['7'].equipment.weapon.itemId).toBe('krylth_spear')
    expect(body.state.members['7'].inventory.filter(Boolean)[0].itemId).toBe('shark')
  })

  it('fights nothing until the host says so', async () => {
    const { sessionId } = await openParty(7)
    await callRoom(sessionId, 'poll', { characterId: 7 })
    const before = await (await callRoom(sessionId, 'poll', { characterId: 7 })).json() as any
    await beats(10)
    const after = await (await callRoom(sessionId, 'poll', { characterId: 7 })).json() as any
    expect(after.state.boss.currentHP).toBe(before.state.boss.currentHP)
    expect(after.state.phase).toBe('lobby')
  })
})

describe('a raid party that has set off', () => {
  async function startedParty() {
    const { sessionId } = await openParty(7)
    await callRoom(sessionId, 'poll', { characterId: 7 })
    await callRoom(sessionId, 'intent', { characterId: 7, action: { type: 'start_raid' } })
    await beats(2)
    return sessionId
  }

  it('turns nobody else away before it starts, and everybody away after', async () => {
    const sessionId = await startedParty()
    const state = parseSessionState(await readSession(env as never, sessionId))
    expect(state.phase).toBe('active')

    await seedCharacter(8)
    await expect(joinCoopRaidParty(env as never, {
      characterId: 8, identityId: 1, raidId: RAID, username: 'player8', sessionId,
    })).rejects.toMatchObject({ code: 'RAID_ALREADY_STARTED' })
  })

  it('stops advertising itself the moment it sets off, not a checkpoint later', async () => {
    const sessionId = await startedParty()
    // The lobby list reads the ROW. Waiting for the periodic checkpoint would
    // offer the run to players for 15 seconds after nobody could enter it.
    const row = await readSession(env as never, sessionId)
    expect(row.phase).toBe('active')
    expect((await listOpenRaidParties(env as never)).get(RAID)).toEqual([])
  })

  it('mirrors the boss it is actually fighting onto the row', async () => {
    const sessionId = await startedParty()
    const row = await readSession(env as never, sessionId)
    expect(row.boss_id).toBe(raidBossOrder(RAID)[0])
    expect(row.raid_id).toBe(RAID)
    expect(row.host_character_id).toBe(7)
  })

  it('still lets the member who was in it rejoin after a refresh', async () => {
    const sessionId = await startedParty()
    const again = await joinCoopRaidParty(env as never, {
      characterId: 7, identityId: 1, raidId: RAID, username: 'player7', sessionId,
    })
    expect(again).toMatchObject({ sessionId, rejoined: true })
    const poll = await callRoom(sessionId, 'poll', { characterId: 7 })
    expect(poll.status).toBe(200)
  })

  it('walks on to the next boss instead of respawning the first one and paying its table', async () => {
    const sessionId = await startedParty()
    const room = rooms.get(`coop:${sessionId}`)! as any
    const bosses = raidBossOrder(RAID)
    expect(room.state.bossId).toBe(bosses[0])

    room.state.boss.currentHP = 0
    await beats(1)
    // An intermediate boss pays nothing: the raid settles once, at the end.
    expect(raw.prepare('SELECT COUNT(*) AS n FROM coop_kill_settlements WHERE session_id = ?').all(sessionId)[0].n).toBe(0)

    await beats(10)
    expect(room.state.bossId).toBe(bosses[1])
    expect(room.state.raid.currentBossIndex).toBe(1)
  })

  it('walks the whole run to its end when the party actually fights it down', async () => {
    const sessionId = await startedParty()
    const room = rooms.get(`coop:${sessionId}`)! as any
    const bosses = raidBossOrder(RAID)
    const seen: string[] = [room.state.bossId]

    for (let i = 0; i < 4000 && room.state.phase === 'active'; i++) {
      // Chip the boss down rather than waiting out real damage rolls: the point
      // is the SEQUENCE the room walks, not how long each boss survives.
      if (room.state.boss.currentHP > 0) room.state.boss.currentHP = 1
      // Damage is what the loot gate measures, and chipping the bosses down
      // never accrues it — credit the run's worth so the clear actually pays.
      room.state.members['7'].damage = room.state.raid.maxHP
      await beats(1)
      if (room.state.phase === 'active' && room.state.bossId !== seen[seen.length - 1]) seen.push(room.state.bossId)
    }

    expect(seen).toEqual(bosses)
    // Finishing returns the party to its lobby on the raid's first boss.
    expect(room.state.phase).toBe('lobby')
    expect(room.state.bossId).toBe(bosses[0])

    // Settlement gunzips the save, and zlib resolves on the thread pool rather
    // than the microtask queue — under fake timers it never lands, which reads
    // as a raid that paid nothing.
    await flushRealAsync()
    // One settlement for the whole run, filed under the RAID.
    const rows = raw.prepare('SELECT boss_id FROM coop_kill_settlements WHERE session_id = ?').all(sessionId)
    expect(rows.map((r: any) => r.boss_id)).toEqual([RAID])
    expect(raw.prepare('SELECT source_type, source_id FROM kill_counts WHERE character_id = 7').all()).toEqual([
      { source_type: 'raids', source_id: RAID },
    ])
  })

  it('refuses a start from anyone who is not the host', async () => {
    const { sessionId } = await openParty(7)
    await callRoom(sessionId, 'poll', { characterId: 7 })
    await seedCharacter(8)
    await joinCoopRaidParty(env as never, {
      characterId: 8, identityId: 1, raidId: RAID, username: 'player8', sessionId,
    })

    await callRoom(sessionId, 'intent', { characterId: 8, action: { type: 'start_raid' } })
    await beats(2)
    const body = await (await callRoom(sessionId, 'poll', { characterId: 8 })).json() as any
    expect(body.state.phase).toBe('lobby')
  })
})
