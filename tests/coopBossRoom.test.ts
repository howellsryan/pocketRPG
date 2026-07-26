// CoopBossRoom — the Durable Object that actually runs a group boss fight.
//
// Until this file the room had no coverage at all: every co-op test drove the
// D1 helpers directly, which is exactly why a joiner never reaching the room
// went unnoticed. The room is exercised here against the real migrations schema
// (tests/helpers/d1) with a fake DO namespace, so joinCoopSession is tested
// through the same path production takes.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeD1, FakeD1 } from './helpers/d1'
import { gzipJsonString } from '../functions/_lib/saveCodec.js'
import { CoopBossRoom } from '../world/server/CoopBossRoom'
import {
  joinCoopSession,
  readSession,
  parseSessionState,
} from '../functions/_lib/game/coopBoss.js'
import { COOP_MAX_MEMBERS } from '../src/engine/coopBossEngine.js'

const BOSS = 'corporeal_horror'
const QUEST = 'the_heart_of_shadows'

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
    completedQuests: [QUEST],
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

/** A DO namespace backed by real CoopBossRoom instances, keyed like the real
 * one so a session maps to exactly one room across calls. */
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

beforeEach(() => {
  // The room ticks on a real 600ms interval; freeze it so no fight advances
  // underneath an assertion.
  vi.useFakeTimers()
  const d = makeD1()
  env = { DB: d.DB }
  raw = d.raw
  env.COOP_ROOM = makeRoomBinding()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('a member joining a fight that is already running', () => {
  it('reaches the live room, so their poll returns the fight instead of not_a_member', async () => {
    await seedCharacter(7)
    await seedCharacter(8)

    const first = await joinCoopSession(env as never, {
      characterId: 7, identityId: 1, bossId: BOSS, username: 'player7',
    })
    // Warm the room the way member 7's client does, so it holds the fight in
    // memory. This is the state in which a D1-only join is invisible: the room
    // never re-reads the session row again.
    const warm = await callRoom(first.sessionId, 'poll', { characterId: 7 })
    expect(warm.status).toBe(200)

    const second = await joinCoopSession(env as never, {
      characterId: 8, identityId: 1, bossId: BOSS, username: 'player8',
    })
    expect(second.sessionId).toBe(first.sessionId)

    const poll = await callRoom(second.sessionId, 'poll', { characterId: 8 })
    expect(poll.status).toBe(200)
    const body = await poll.json() as any
    expect(body.state.members['8']).toBeTruthy()
    expect(body.state.memberCount).toBe(2)
  })

  it('survives the room checkpointing, which overwrites the session blob', async () => {
    await seedCharacter(7)
    await seedCharacter(8)
    const { sessionId } = await joinCoopSession(env as never, {
      characterId: 7, identityId: 1, bossId: BOSS, username: 'player7',
    })
    await callRoom(sessionId, 'poll', { characterId: 7 })
    await joinCoopSession(env as never, {
      characterId: 8, identityId: 1, bossId: BOSS, username: 'player8',
    })

    // The join itself checkpoints, so D1 must already agree with the room.
    const row = await readSession(env as never, sessionId)
    const state = parseSessionState(row)
    expect(Object.keys(state.members).sort()).toEqual(['7', '8'])
    expect(row.member_count).toBe(2)
  })

  it('is idempotent — a repeated join does not reset the member already fighting', async () => {
    await seedCharacter(7)
    const { sessionId } = await joinCoopSession(env as never, {
      characterId: 7, identityId: 1, bossId: BOSS, username: 'player7',
    })
    await callRoom(sessionId, 'poll', { characterId: 7 })

    const room = rooms.get(`coop:${sessionId}`)!
    ;(room as any).state.members['7'].damage = 250

    const res = await callRoom(sessionId, 'join', {
      characterId: 7,
      member: { characterId: 7, username: 'player7' },
    })
    expect(res.status).toBe(200)
    expect((await res.json() as any).alreadyPresent).toBe(true)
    expect((room as any).state.members['7'].damage).toBe(250)
  })

  it('refuses a join payload for a different character', async () => {
    await seedCharacter(7)
    const { sessionId } = await joinCoopSession(env as never, {
      characterId: 7, identityId: 1, bossId: BOSS, username: 'player7',
    })
    await callRoom(sessionId, 'poll', { characterId: 7 })

    const res = await callRoom(sessionId, 'join', {
      characterId: 8,
      member: { characterId: 7, username: 'player7' },
    })
    expect(res.status).toBe(400)
    expect((await res.json() as any).error).toBe('invalid_member')
  })
})

describe('the member cap', () => {
  it('is enforced by the room, which is the only place that knows the live count', async () => {
    await seedCharacter(1000)
    const { sessionId } = await joinCoopSession(env as never, {
      characterId: 1000, identityId: 1, bossId: BOSS, username: 'player1000',
    })
    await callRoom(sessionId, 'poll', { characterId: 1000 })

    for (let i = 1; i < COOP_MAX_MEMBERS; i++) {
      const id = 1000 + i
      await seedCharacter(id)
      const joined = await joinCoopSession(env as never, {
        characterId: id, identityId: 1, bossId: BOSS, username: `player${id}`,
      })
      expect(joined.sessionId).toBe(sessionId)
    }

    const room = rooms.get(`coop:${sessionId}`)!
    expect(Object.keys((room as any).state.members)).toHaveLength(COOP_MAX_MEMBERS)

    // One past the cap opens a second instance rather than overfilling this one.
    await seedCharacter(2000)
    const overflow = await joinCoopSession(env as never, {
      characterId: 2000, identityId: 1, bossId: BOSS, username: 'player2000',
    })
    expect(overflow.sessionId).not.toBe(sessionId)
  })

  it('answers session_full directly when the room is already at capacity', async () => {
    await seedCharacter(1000)
    const { sessionId } = await joinCoopSession(env as never, {
      characterId: 1000, identityId: 1, bossId: BOSS, username: 'player1000',
    })
    await callRoom(sessionId, 'poll', { characterId: 1000 })
    const room = rooms.get(`coop:${sessionId}`)! as any
    for (let i = 1; i < COOP_MAX_MEMBERS; i++) {
      room.state.members[String(9000 + i)] = { characterId: 9000 + i, username: `f${i}`, status: 'alive', damage: 0 }
    }

    const res = await callRoom(sessionId, 'join', {
      characterId: 8,
      member: { characterId: 8, username: 'player8', combat: {}, status: 'alive', damage: 0 },
    })
    expect(res.status).toBe(409)
    expect((await res.json() as any).error).toBe('session_full')
  })
})

describe('the room membership gate', () => {
  it('still refuses poll and intent from a character who never joined', async () => {
    await seedCharacter(7)
    const { sessionId } = await joinCoopSession(env as never, {
      characterId: 7, identityId: 1, bossId: BOSS, username: 'player7',
    })
    await callRoom(sessionId, 'poll', { characterId: 7 })

    const poll = await callRoom(sessionId, 'poll', { characterId: 999 })
    expect(poll.status).toBe(403)
    const intent = await callRoom(sessionId, 'intent', { characterId: 999, action: { type: 'queue_special' } })
    expect(intent.status).toBe(403)
  })

  it('404s a session that does not exist rather than opening an empty room', async () => {
    const res = await callRoom(4242, 'poll', { characterId: 7 })
    expect(res.status).toBe(404)
  })
})

describe('state swaps never land inside a tick', () => {
  // addCoopMember/removeCoopMember CLONE the state, so a swap that interleaves
  // with a tick's awaits leaves that tick mutating member objects nothing can
  // see any more — the loot winner's granted inventory and bumped saveRevision
  // are written to an orphan. Everything that replaces this.state shares one
  // queue with the tick to make that impossible.
  //
  // These call the room's handlers directly rather than over HTTP: going
  // through fetch() means request.json() resolves on its own schedule, so the
  // handler may simply not have arrived yet inside the assertion window and the
  // test would pass whether or not the queue exists.

  /** Parks the room inside a real beat, at the point a kill settlement waits on
   * D1. Only the tick calls settleKill, so anything else that runs is genuinely
   * cutting in rather than parking on the same stub. */
  function parkMidBeat(room: any) {
    let release: () => void = () => {}
    let entered: () => void = () => {}
    const blocked = new Promise<void>((r) => { release = r })
    const inside = new Promise<void>((r) => { entered = r })
    room.settleKill = async () => { entered(); await blocked }
    // A dead boss makes processCoopTick emit a kill, so the beat reaches it.
    room.state.boss.currentHP = 0
    return { blocked: inside, release, beat: room.tick() }
  }

  const drainMicrotasks = async () => { for (let i = 0; i < 25; i++) await Promise.resolve() }

  async function warmRoom(ids: number[]) {
    for (const id of ids) await seedCharacter(id)
    const { sessionId } = await joinCoopSession(env as never, {
      characterId: ids[0], identityId: 1, bossId: BOSS, username: `player${ids[0]}`,
    })
    await callRoom(sessionId, 'poll', { characterId: ids[0] })
    for (const id of ids.slice(1)) {
      await joinCoopSession(env as never, { characterId: id, identityId: 1, bossId: BOSS, username: `player${id}` })
    }
    return { sessionId, room: rooms.get(`coop:${sessionId}`)! as any }
  }

  it('holds a join until an in-flight beat has finished', async () => {
    const { room } = await warmRoom([7])
    await seedCharacter(8)

    const { blocked, release, beat } = parkMidBeat(room)
    await blocked
    const stateDuringBeat = room.state

    const join = room.handleJoin('8', {
      member: { characterId: 8, username: 'player8', combat: {}, status: 'alive', damage: 0 },
    })
    await drainMicrotasks()
    expect(room.state).toBe(stateDuringBeat)
    expect(room.state.members['8']).toBeUndefined()

    release()
    await beat
    expect((await (await join).json()).ok).toBe(true)
    expect(room.state.members['8']).toBeTruthy()
  })

  // The join test above is what actually pins the queue: it is the only path
  // whose state swap is reachable inside a microtask drain. A departure's own
  // write-back hits D1 and outlasts the parked beat either way, so this one
  // asserts the behaviour it must keep — leaving during a beat still ejects and
  // writes the member back — rather than pretending to prove the ordering.
  it('still ejects and writes back a member who leaves during a beat', async () => {
    const { room } = await warmRoom([7, 8])

    const { blocked, release, beat } = parkMidBeat(room)
    await blocked

    const depart = room.handleDepart('8')
    release()
    await Promise.all([beat, depart])

    expect(room.state.members['8']).toBeUndefined()
    expect(room.state.members['7']).toBeTruthy()
    const lock = raw.prepare('SELECT active_coop_session_id FROM characters WHERE id = 8').get()
    expect(lock.active_coop_session_id).toBeNull()
  })
})
