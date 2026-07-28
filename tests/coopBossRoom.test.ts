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

describe('a kill is never silent', () => {
  // The room used to swallow a settlement failure and push no event at all, so
  // the boss died and absolutely nothing happened on screen — no loot modal, no
  // toast, no way for the player to tell a broken grant from an unlucky one.
  async function roomWithOneMember(characterId: number) {
    await seedCharacter(characterId)
    const { sessionId } = await joinCoopSession(env as never, {
      characterId, identityId: 1, bossId: BOSS, username: `player${characterId}`,
    })
    await callRoom(sessionId, 'poll', { characterId })
    return { sessionId, room: rooms.get(`coop:${sessionId}`)! as any }
  }

  async function killEventFor(sessionId: number, characterId: number) {
    const res = await callRoom(sessionId, 'poll', { characterId, sinceTick: 0 })
    return ((await res.json()) as any).events.find((e: any) => e.type === 'killSettled')
  }

  it('still reports the kill when the settlement throws outright', async () => {
    const { sessionId, room } = await roomWithOneMember(7)
    room.state.members['7'].damage = 2000
    room.state.boss.currentHP = 0
    // Whatever the cause — a missing table, a D1 outage — the player has to be
    // told something happened.
    raw.exec('DROP TABLE coop_kill_settlements')

    await room.tick()

    const ev = await killEventFor(sessionId, 7)
    expect(ev).toBeTruthy()
    expect(ev.failed).toBe(true)
    expect(ev.settlements.find((s: any) => s.characterId === 7).failed).toBe(true)
  })

  it('delivers the winner their own loot on an ordinary kill', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const { sessionId, room } = await roomWithOneMember(7)
    room.state.members['7'].damage = 2000
    room.state.boss.currentHP = 0

    await room.tick()

    const ev = await killEventFor(sessionId, 7)
    const mine = ev.settlements.find((s: any) => s.characterId === 7)
    expect(mine.failed).toBeFalsy()
    expect(mine.granted.length).toBeGreaterThan(0)
  })

  it('delivers a non-top-damage winner their own loot too', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const { sessionId, room } = await roomWithOneMember(7)
    await seedCharacter(8)
    await joinCoopSession(env as never, { characterId: 8, identityId: 1, bossId: BOSS, username: 'player8' })
    await callRoom(sessionId, 'poll', { characterId: 8 })
    room.state.members['7'].damage = 1500
    room.state.members['8'].damage = 500
    room.state.boss.currentHP = 0

    await room.tick()

    // The second winner's poll must carry THEIR drops, not the top attacker's.
    const ev = await killEventFor(sessionId, 8)
    const theirs = ev.settlements.find((s: any) => s.characterId === 8)
    expect(theirs.granted.length).toBeGreaterThan(0)
    expect(ev.settlements.find((s: any) => s.characterId === 7).granted).toBeUndefined()
  })
})

describe('fight chat', () => {
  async function roomWith(ids: number[]) {
    for (const id of ids) await seedCharacter(id)
    const { sessionId } = await joinCoopSession(env as never, {
      characterId: ids[0], identityId: 1, bossId: BOSS, username: `player${ids[0]}`,
    })
    await callRoom(sessionId, 'poll', { characterId: ids[0] })
    for (const id of ids.slice(1)) {
      await joinCoopSession(env as never, { characterId: id, identityId: 1, bossId: BOSS, username: `player${id}` })
      await callRoom(sessionId, 'poll', { characterId: id })
    }
    return { sessionId, room: rooms.get(`coop:${sessionId}`)! as any }
  }

  const say = (sessionId: number, characterId: number, text: string) =>
    callRoom(sessionId, 'intent', { characterId, action: { type: 'chat', text } })

  async function eventsFor(sessionId: number, characterId: number, sinceTick: number) {
    const res = await callRoom(sessionId, 'poll', { characterId, sinceTick })
    return ((await res.json()) as any).events
  }

  it('reaches the other players in the fight', async () => {
    const { sessionId, room } = await roomWith([7, 8])
    const before = room.state.tick

    expect((await say(sessionId, 7, 'pray melee')).status).toBe(200)
    await room.tick()

    const seen = await eventsFor(sessionId, 8, before)
    const chat = seen.find((e: any) => e.type === 'chatMessage')
    expect(chat).toMatchObject({ characterId: 7, username: 'player7', text: 'pray melee' })
  })

  // A message appended to a tick the listener has already acknowledged is
  // filtered out by `> since` forever — the bug that ate the loot modal. Chat
  // has to ride the NEXT tick for the same reason.
  it('is not swallowed by a listener who already acknowledged the current tick', async () => {
    const { sessionId, room } = await roomWith([7, 8])
    const ack = ((await (await callRoom(sessionId, 'poll', { characterId: 8 })).json()) as any).current_tick

    await say(sessionId, 7, 'after the ack')
    expect(await eventsFor(sessionId, 8, ack)).toEqual([])

    await room.tick()
    const seen = await eventsFor(sessionId, 8, ack)
    expect(seen.some((e: any) => e.type === 'chatMessage' && e.text === 'after the ack')).toBe(true)
  })

  it('works while dead, when a player most needs to talk to the group', async () => {
    const { sessionId, room } = await roomWith([7, 8])
    room.state.members['7'].status = 'dead'
    const before = room.state.tick

    expect((await say(sessionId, 7, 'wiped, sorry')).status).toBe(200)
    // A combat action from the same member is still refused.
    const act = await callRoom(sessionId, 'intent', { characterId: 7, action: { type: 'queue_special' } })
    expect(act.status).toBe(409)

    await room.tick()
    const seen = await eventsFor(sessionId, 8, before)
    expect(seen.some((e: any) => e.type === 'chatMessage' && e.text === 'wiped, sorry')).toBe(true)
  })

  it('never spends a combat action slot', async () => {
    const { sessionId, room } = await roomWith([7])
    for (let i = 0; i < 6; i++) await say(sessionId, 7, `line ${i}`)
    expect(room.pending).toHaveLength(0)

    const act = await callRoom(sessionId, 'intent', { characterId: 7, action: { type: 'queue_special' } })
    expect(act.status).toBe(200)
  })

  it('rate-limits a flood without disconnecting the speaker', async () => {
    const { sessionId, room } = await roomWith([7])
    let refused = 0
    for (let i = 0; i < 12; i++) {
      if ((await say(sessionId, 7, `spam ${i}`)).status === 429) refused += 1
    }
    expect(refused).toBeGreaterThan(0)

    // The cap is per member: someone else in the room is unaffected.
    await seedCharacter(9)
    await joinCoopSession(env as never, { characterId: 9, identityId: 1, bossId: BOSS, username: 'player9' })
    await callRoom(sessionId, 'poll', { characterId: 9 })
    expect((await say(sessionId, 9, 'hello')).status).toBe(200)
    expect(room.state.members['7']).toBeTruthy()
  })

  it('drops a message with nothing displayable in it', async () => {
    const { sessionId, room } = await roomWith([7])
    const before = room.state.tick
    expect((await say(sessionId, 7, '   ')).status).toBe(400)
    await room.tick()
    expect((await eventsFor(sessionId, 7, before)).some((e: any) => e.type === 'chatMessage')).toBe(false)
  })

  it('writes an audit row for every message, so there is a history to review', async () => {
    const { sessionId, room } = await roomWith([7])
    await say(sessionId, 7, 'on my way')
    await room.tick()

    const row = raw.prepare("SELECT * FROM audit_events WHERE event_type = 'coop_chat'").get() as any
    expect(row).toBeTruthy()
    expect(row.character_id).toBe(7)
    expect(JSON.parse(row.payload_json).text).toBe('on my way')
  })
})

describe('a One Life death', () => {
  // The room resolves its own combat, so the idle game's death paths never see
  // this death. Nothing else would ever revoke the flag — the same gap the open
  // world had (world/server/oneLife.ts).
  async function oneLifeRoom(characterId: number) {
    await seedCharacter(characterId)
    raw.prepare('UPDATE characters SET is_one_life = 1 WHERE id = ?').run(characterId)
    const { sessionId } = await joinCoopSession(env as never, {
      characterId, identityId: 1, bossId: BOSS, username: `player${characterId}`,
    })
    await callRoom(sessionId, 'poll', { characterId })
    return { sessionId, room: rooms.get(`coop:${sessionId}`)! as any }
  }

  const oneLifeFlag = (id: number) =>
    (raw.prepare('SELECT is_one_life FROM characters WHERE id = ?').get(id) as any).is_one_life

  async function eventsSincePoll(sessionId: number, characterId: number) {
    const res = await callRoom(sessionId, 'poll', { characterId, sinceTick: 0 })
    return ((await res.json()) as any).events as any[]
  }

  it('ends the run and tells the member', async () => {
    const { sessionId, room } = await oneLifeRoom(7)
    room.state.members['7'].hp = 0
    await room.tick()

    expect(oneLifeFlag(7)).toBe(0)
    const events = await eventsSincePoll(sessionId, 7)
    expect(events.some((e) => e.type === 'oneLifeEnded' && e.characterId === 7)).toBe(true)
  })

  it('says nothing for a standard character, who has no run to lose', async () => {
    const { sessionId, room } = await oneLifeRoom(7)
    raw.prepare('UPDATE characters SET is_one_life = 0 WHERE id = 7').run()
    room.state.members['7'].hp = 0
    await room.tick()

    const events = await eventsSincePoll(sessionId, 7)
    expect(events.some((e) => e.type === 'oneLifeEnded')).toBe(false)
  })

  it('retries on the next beat when D1 could not answer, instead of losing the revert', async () => {
    const { sessionId, room } = await oneLifeRoom(7)
    const realPrepare = env.DB.prepare.bind(env.DB)
    let failNext = true
    ;(env.DB as any).prepare = (sql: string) => {
      if (failNext && sql.includes('is_one_life = 0')) {
        failNext = false
        return { bind: () => ({ run: async () => { throw new Error('D1 unavailable') } }) }
      }
      return realPrepare(sql)
    }

    room.state.members['7'].hp = 0
    await room.tick()
    expect(oneLifeFlag(7)).toBe(1)
    expect((await eventsSincePoll(sessionId, 7)).some((e) => e.type === 'oneLifeEnded')).toBe(false)

    // The member is dead now, so there is no second memberDeath event to
    // re-trigger it — the retry has to come from the room's own queue.
    await room.tick()
    expect(oneLifeFlag(7)).toBe(0)
    expect((await eventsSincePoll(sessionId, 7)).some((e) => e.type === 'oneLifeEnded')).toBe(true)
  })
})
