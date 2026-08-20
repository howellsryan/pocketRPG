// The co-op room's push transport.
//
// Polling cost a Pages invocation, a JWT verification and a `characters` read
// per member per 600ms beat, and it could only ever deliver a fight a round
// trip stale. These tests hold the room to the two promises that replace it:
// every beat reaches every connected member, and it costs the room nothing it
// did not already have in memory.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeD1, FakeD1 } from './helpers/d1'
import { gzipJsonString } from '../functions/_lib/saveCodec.js'
import { CoopBossRoom } from '../world/server/CoopBossRoom'
import { isCoopSessionLive, joinCoopSession } from '../functions/_lib/game/coopBoss.js'
import { COOP_SOCKET_LINGER_MS } from '../src/engine/coopSocketProtocol.js'

const BOSS = 'corporeal_horror'
const QUEST = 'the_heart_of_shadows'

let env: { DB: FakeD1; COOP_ROOM?: unknown }
let raw: any
let rooms: Map<string, CoopBossRoom>

/**
 * The Workers runtime's socket primitives, which node has no equivalent for:
 * `WebSocketPair`, and a `Response` that tolerates the 101 an upgrade answers
 * with (undici throws on any status below 200).
 */
class FakeSocket {
  sent: string[] = []
  closed: { code: number; reason: string } | null = null
  accepted = false
  readyState = 1
  private listeners: Record<string, ((e: any) => void)[]> = {}
  accept() { this.accepted = true }
  addEventListener(type: string, fn: (e: any) => void) { (this.listeners[type] ||= []).push(fn) }
  send(data: string) { this.sent.push(data) }
  close(code = 1000, reason = '') {
    if (this.closed) return
    this.closed = { code, reason }
    this.emit('close', { code, reason })
  }
  emit(type: string, event: any) { for (const fn of this.listeners[type] || []) fn(event) }
  /** What the room said, parsed. */
  frames(): any[] { return this.sent.map((s) => JSON.parse(s)) }
  lastFrame(type: string) { return [...this.frames()].reverse().find((f) => f.t === type) }
  /** A frame arriving from the client. */
  clientSends(frame: unknown) { this.emit('message', { data: JSON.stringify(frame) }) }
}

let realResponse: typeof Response
let realWebSocketPair: any

function installSocketRuntime() {
  realResponse = globalThis.Response
  realWebSocketPair = (globalThis as any).WebSocketPair
  ;(globalThis as any).WebSocketPair = function () {
    return { 0: new FakeSocket(), 1: new FakeSocket() }
  }
  globalThis.Response = class extends realResponse {
    readonly webSocket: FakeSocket | null = null
    constructor(body?: any, init?: any) {
      if (init?.status === 101) {
        super(null, { status: 200 })
        Object.defineProperty(this, 'status', { value: 101 })
        Object.defineProperty(this, 'webSocket', { value: init.webSocket })
      } else {
        super(body, init)
      }
    }
  } as never
}

function restoreSocketRuntime() {
  globalThis.Response = realResponse
  ;(globalThis as any).WebSocketPair = realWebSocketPair
}

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

async function connect(sessionId: number, characterId: number, sinceTick?: number): Promise<FakeSocket> {
  const stub = (env.COOP_ROOM as any).get((env.COOP_ROOM as any).idFromName(`coop:${sessionId}`))
  const params = new URLSearchParams({ sessionId: String(sessionId), characterId: String(characterId) })
  if (sinceTick != null) params.set('sinceTick', String(sinceTick))
  const res = await stub.fetch(`https://coop-room/socket?${params}`, {
    headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
  })
  expect(res.status).toBe(101)
  // The pair's server half is the one the room kept; the client half is what
  // the runtime would hand back down the wire.
  const room = roomFor(sessionId)
  return [...room.conns.keys()].pop() as FakeSocket
}

/** Joins the fight and warms the room, so `rooms` holds the live object the
 * assertions poke at. Joining alone only writes D1. */
async function joinAndWarm(characterId: number) {
  await seedCharacter(characterId)
  const joined = await joinCoopSession(env as never, {
    characterId, identityId: 1, bossId: BOSS, username: `player${characterId}`,
  })
  await callRoom(joined.sessionId, 'poll', { characterId })
  return joined.sessionId as number
}

function roomFor(sessionId: number): any {
  return rooms.get(`coop:${sessionId}`)! as any
}

/** The heartbeat a reconnect writes is deliberately not awaited by the socket
 * upgrade — an upgrade must not wait on D1 — so drain it before reading D1. */
async function flushWrites() {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
  installSocketRuntime()
  const d = makeD1()
  env = { DB: d.DB }
  raw = d.raw
  env.COOP_ROOM = makeRoomBinding()
})

afterEach(() => {
  restoreSocketRuntime()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('connecting', () => {
  it('answers the whole projection first, so every later frame can be a delta', async () => {
    const sessionId = await joinAndWarm(7)
    const ws = await connect(sessionId, 7)

    expect(ws.accepted).toBe(true)
    const sync = ws.frames()[0]
    expect(sync.t).toBe('sync')
    expect(sync.state.members['7'].inventory).toBeTruthy()
    expect(sync.state.bossId).toBe(BOSS)
  })

  it('refuses a character who is not in the fight, rather than seating them', async () => {
    const sessionId = await joinAndWarm(7)
    const stub = (env.COOP_ROOM as any).get((env.COOP_ROOM as any).idFromName(`coop:${sessionId}`))
    const res = await stub.fetch(`https://coop-room/socket?sessionId=${sessionId}&characterId=999`, {
      headers: { Upgrade: 'websocket' },
    })
    expect(res.status).toBe(403)
  })

  it('refuses a plain GET — a socket action is only ever an upgrade', async () => {
    const sessionId = await joinAndWarm(7)
    const stub = (env.COOP_ROOM as any).get((env.COOP_ROOM as any).idFromName(`coop:${sessionId}`))
    const res = await stub.fetch(`https://coop-room/socket?sessionId=${sessionId}&characterId=7`)
    expect(res.status).toBe(426)
  })

  // Reconnecting must attach to the member already fighting. Re-seeding them
  // would re-arm their timers and throw away the damage their loot share is
  // measured from.
  it('does not re-seed a member who reconnects', async () => {
    const sessionId = await joinAndWarm(7)
    const room = roomFor(sessionId)
    await connect(sessionId, 7)
    room.state.members['7'].damage = 500

    await connect(sessionId, 7)

    expect(room.state.members['7'].damage).toBe(500)
    expect(Object.keys(room.state.members)).toEqual(['7'])
  })

  it('replays what a reconnecting client missed', async () => {
    const sessionId = await joinAndWarm(7)
    const room = roomFor(sessionId)
    const before = room.state.tick
    await callRoom(sessionId, 'intent', { characterId: 7, action: { type: 'chat', text: 'still here' } })
    await room.tick()

    const ws = await connect(sessionId, 7, before)
    expect(ws.frames()[0].events.some((e: any) => e.type === 'chatMessage' && e.text === 'still here')).toBe(true)
  })
})

describe('the beat', () => {
  it('pushes every tick to every connected member', async () => {
    const sessionId = await joinAndWarm(7)
    expect(await joinAndWarm(8)).toBe(sessionId)
    const room = roomFor(sessionId)
    const a = await connect(sessionId, 7)
    const b = await connect(sessionId, 8)
    a.sent.length = 0
    b.sent.length = 0

    await room.tick()

    // The old race delivered a beat to whichever poll happened to be in flight.
    expect(a.lastFrame('tick')).toBeTruthy()
    expect(b.lastFrame('tick')).toBeTruthy()
  })

  it('sends what moved, not the pack that did not', async () => {
    const sessionId = await joinAndWarm(7)
    const room = roomFor(sessionId)
    const ws = await connect(sessionId, 7)
    const syncBytes = ws.sent[0].length
    ws.sent.length = 0

    await room.tick()

    const frame = ws.lastFrame('tick')
    const mine = frame.delta.members?.['7'] || {}
    // Everything polling re-sent on every beat and that changes a few times an
    // hour. The byte saving itself is measured deterministically in
    // coopSocketProtocol.test.ts; here the point is that the room omits them.
    expect(mine.inventory).toBeUndefined()
    expect(mine.completedQuests).toBeUndefined()
    expect(mine.equipment).toBeUndefined()
    expect(mine.levels).toBeUndefined()
    expect(ws.sent[0].length).toBeLessThan(syncBytes)
  })

  it('says nothing on a beat where only the clock moved', async () => {
    const sessionId = await joinAndWarm(7)
    const room = roomFor(sessionId)
    // A lobby is the real case: a raid party can sit in one for minutes.
    room.state.phase = 'lobby'
    const ws = await connect(sessionId, 7)
    ws.sent.length = 0

    await room.tick()
    await room.tick()

    expect(ws.sent).toEqual([])
  })

  // The rule that keeps settlement off the tick it settles: a client can never
  // be shown anything appended to a tick it has already acknowledged, so a beat
  // is pushed only once nothing more can be added to it.
  it('never pushes a tick before its settlement is on it', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const sessionId = await joinAndWarm(7)
    const room = roomFor(sessionId)
    const ws = await connect(sessionId, 7)
    room.state.members['7'].damage = 2000
    room.state.boss.currentHP = 0
    ws.sent.length = 0

    await room.tick()

    const events = ws.frames().flatMap((f) => f.events || [])
    const settled = events.find((e: any) => e.type === 'killSettled')
    expect(settled).toBeTruthy()
    expect(settled.settlements.find((s: any) => s.characterId === 7).granted.length).toBeGreaterThan(0)
  })
})

describe('actions over the socket', () => {
  it('acknowledges an intent with the beat it will land on', async () => {
    const sessionId = await joinAndWarm(7)
    const room = roomFor(sessionId)
    const ws = await connect(sessionId, 7)

    ws.clientSends({ t: 'intent', id: 3, action: { type: 'change_stance', stance: 'defensive' } })

    const ack = ws.lastFrame('ack')
    expect(ack).toMatchObject({ id: 3, tick_number: (room.state.tick || 0) + 1 })
  })

  // The frame never passes through the Pages edge, so the room is the only
  // thing left that can refuse nonsense.
  it('validates a frame the edge never saw', async () => {
    const sessionId = await joinAndWarm(7)
    const ws = await connect(sessionId, 7)

    ws.clientSends({ t: 'intent', id: 1, action: { type: 'grant_me_loot' } })
    expect(ws.lastFrame('nack')).toMatchObject({ id: 1, error: 'unknown_action' })

    ws.clientSends({ t: 'intent', id: 2, action: { type: 'change_stance', stance: 'godmode' } })
    expect(ws.lastFrame('nack')).toMatchObject({ id: 2, error: 'invalid_stance' })
  })

  // A protection prayer filed as an offensive one blocks nothing AND cancels
  // the offensive prayer, so the slot has to come from the prayer's own data
  // whichever transport carried the tap (§20).
  it('resolves a prayer’s slot from its data, not from the frame', async () => {
    const sessionId = await joinAndWarm(7)
    const room = roomFor(sessionId)
    const ws = await connect(sessionId, 7)

    ws.clientSends({ t: 'intent', id: 1, action: { type: 'toggle_prayer', prayerId: 'protection_from_melee', slot: 'combat' } })

    expect(room.pending.at(-1).action).toMatchObject({ type: 'toggle_prayer', prayerId: 'protection_from_melee', slot: 'protection' })
  })

  it('sanitises chat in the room, not only at the edge', async () => {
    const sessionId = await joinAndWarm(7)
    const room = roomFor(sessionId)
    const ws = await connect(sessionId, 7)

    ws.clientSends({ t: 'intent', id: 1, action: { type: 'chat', text: '   ' } })
    expect(ws.lastFrame('nack')).toMatchObject({ error: 'invalid_chat' })

    ws.clientSends({ t: 'intent', id: 2, action: { type: 'chat', text: '  pray melee  ' } })
    expect(room.pendingChat.at(-1)).toMatchObject({ text: 'pray melee' })
  })

  // The screen turns a 429 into "slow down"; without the status it would show
  // the raw error code instead.
  it('refuses with the status the client still needs', async () => {
    const sessionId = await joinAndWarm(7)
    const ws = await connect(sessionId, 7)
    for (let i = 0; i < 12; i++) {
      ws.clientSends({ t: 'intent', id: i, action: { type: 'chat', text: `spam ${i}` } })
    }
    expect(ws.lastFrame('nack')).toMatchObject({ error: 'chat_rate_limited', status: 429 })
  })

  it('answers a keepalive so a quiet lobby’s socket is not reaped', async () => {
    const sessionId = await joinAndWarm(7)
    const ws = await connect(sessionId, 7)
    ws.clientSends({ t: 'ping' })
    expect(ws.lastFrame('pong')).toBeTruthy()
  })

  it('closes a socket that floods rather than throttling it forever', async () => {
    const sessionId = await joinAndWarm(7)
    const ws = await connect(sessionId, 7)
    for (let i = 0; i < 200; i++) ws.clientSends({ t: 'ping' })
    expect(ws.closed?.code).toBe(1008)
  })
})

describe('a socket going away', () => {
  // The save lock follows the member (§20). Polling gave a crashed client 90
  // seconds of holding their own save hostage; a closed socket is proof, so it
  // should cost seconds.
  it('starts the linger that releases the save, instead of waiting out the poll timeout', async () => {
    const sessionId = await joinAndWarm(7)
    const room = roomFor(sessionId)
    const ws = await connect(sessionId, 7)

    const before = room.lastSeen['7']
    ws.close(1006, '')

    expect(room.conns.size).toBe(0)
    const remaining = room.lastSeen['7'] - (Date.now() - 90_000)
    expect(remaining).toBeLessThanOrEqual(COOP_SOCKET_LINGER_MS)
    expect(room.lastSeen['7']).toBeLessThan(before)
  })

  it('is undone by any later proof of life, so a fallback to polling is not an eviction', async () => {
    const sessionId = await joinAndWarm(7)
    const room = roomFor(sessionId)
    const ws = await connect(sessionId, 7)
    ws.close(1006, '')

    await callRoom(sessionId, 'poll', { characterId: 7 })

    expect(room.lastSeen['7']).toBeGreaterThan(Date.now() - 1000)
  })

  it('leaves the member alone while another socket of theirs is still open', async () => {
    const sessionId = await joinAndWarm(7)
    const room = roomFor(sessionId)
    const first = await connect(sessionId, 7)
    await connect(sessionId, 7)

    first.close(1006, '')

    expect(room.lastSeen['7']).toBeGreaterThan(Date.now() - 1000)
  })

  it('tells a socket the fight is over rather than leaving it watching', async () => {
    const sessionId = await joinAndWarm(7)
    const room = roomFor(sessionId)
    const ws = await connect(sessionId, 7)

    room.lastSeen['7'] = 0
    await room.tick()

    expect(ws.lastFrame('bye')).toMatchObject({ reason: 'ejected' })
    expect(ws.closed).toBeTruthy()
  })
})

describe('what a beat costs D1', () => {
  // The reason for all of it: every poll ran a `characters` read just to learn
  // who was asking, at ~1.7Hz per member. A pushed beat touches D1 only on the
  // checkpoint's own clock.
  it('touches D1 on the checkpoint clock, not on every beat', async () => {
    const sessionId = await joinAndWarm(7)
    expect(await joinAndWarm(8)).toBe(sessionId)
    const room = roomFor(sessionId)
    await connect(sessionId, 7)
    await connect(sessionId, 8)

    const prepare = vi.spyOn(env.DB, 'prepare')
    for (let i = 0; i < 20; i++) await room.tick()

    // 20 beats, 8 members' worth of clients connected: no per-beat D1 at all,
    // and at most the one checkpoint those 20 ticks are due.
    expect(prepare.mock.calls.length).toBeLessThanOrEqual(3)
  })

  it('keeps the save lock through a socket flap the player comes back from', async () => {
    // The incident this fixes: a phone locks mid-fight, the socket closes, and
    // the room back-dates the heartbeat by COOP_SOCKET_LINGER_MS so a player who
    // is really gone gets their save back quickly. The player then comes back
    // INSIDE that linger — the room keeps them in the fight, but the row still
    // holds the value that expires 45s after the close. /api/save read that row,
    // let the idle client write, and the room's copy of the member's save
    // revision was orphaned: every kill after it was refused as diverged and the
    // player was paid nothing for the rest of the fight.
    const sessionId = await joinAndWarm(7)
    const room = roomFor(sessionId)
    const ws = await connect(sessionId, 7)
    room.dirty = true
    await room.checkpoint(Date.now())

    ws.close(1006, '')
    room.dirty = true
    await room.checkpoint(Date.now())
    expect(await isCoopSessionLive(env as never, 7, Date.now())).toBe(true)

    // Back before the room would let them go, and still fighting from here on.
    vi.advanceTimersByTime(COOP_SOCKET_LINGER_MS - 5_000)
    await connect(sessionId, 7)
    await flushWrites()
    expect(room.state.members['7'], 'the room let a reconnected member go').toBeTruthy()

    // Past the moment the back-dated row expires, and past the write interval
    // the old bookkeeping would have blocked the refresh for.
    vi.advanceTimersByTime(10_000)
    await room.tick()
    expect(
      await isCoopSessionLive(env as never, 7, Date.now()),
      'the save lock lapsed under a member who is standing in the fight',
    ).toBe(true)
  })

  it('lets a member go once their save has moved out from under the room', async () => {
    // Nothing they do can reach their save again — every later kill settles to
    // nothing — so fighting on is pure loss. Releasing them writes back (refused,
    // which is the point: it frees the lock without replaying a stale snapshot)
    // and closes the socket with a reason the client rejoins from.
    const sessionId = await joinAndWarm(7)
    expect(await joinAndWarm(8)).toBe(sessionId)
    const room = roomFor(sessionId)
    const ws = await connect(sessionId, 7)
    await connect(sessionId, 8)

    room.pendingDivergedRelease.add('7')
    await room.tick()

    expect(room.state.members['7']).toBeFalsy()
    expect(room.state.members['8'], 'the rest of the room lost their fight too').toBeTruthy()
    expect(ws.lastFrame('bye')).toMatchObject({ reason: 'ejected' })
    const held = raw.prepare('SELECT active_coop_session_id AS s FROM characters WHERE id = 7').get()
    expect(held.s, 'the save stayed locked to a room that had let them go').toBeNull()
    // Their connection was healthy right up to the release, so the heartbeat is
    // fresh: without closing the row the browser advertises them in this room
    // for another 90s, and in two rooms at once once they rejoin elsewhere.
    const membership = raw.prepare(
      'SELECT left_at AS l FROM coop_session_members WHERE session_id = ? AND character_id = 7',
    ).get(sessionId)
    expect(membership.l, 'the room still lists a member it has let go').not.toBeNull()
  })

  it('unlocks the save even when the write-back throws', async () => {
    // The lock release lives INSIDE writeBackMember, so a throw there used to
    // drop the member from the room while leaving their character pointed at it:
    // the join path answers `rejoined`, the room answers `not_a_member`, and the
    // client loops between the two until the crash sweep runs. The diverged
    // release made that a routine path, and the toast promises the rejoin.
    const sessionId = await joinAndWarm(7)
    expect(await joinAndWarm(8)).toBe(sessionId)
    const room = roomFor(sessionId)
    await connect(sessionId, 7)
    // An owner the character row cannot be read under: writeBackMember throws
    // CHARACTER_NOT_FOUND before it reaches its own release.
    room.state.members['7'].ownerId = 999

    room.pendingDivergedRelease.add('7')
    await room.tick()

    expect(room.state.members['7']).toBeFalsy()
    const row = raw.prepare(
      'SELECT active_coop_session_id AS s, (SELECT left_at FROM coop_session_members WHERE session_id = ? AND character_id = 7) AS l FROM characters WHERE id = 7',
    ).get(sessionId)
    expect(row.s, 'the save stayed locked to a room that had let them go').toBeNull()
    expect(row.l, 'the membership row still says they are in the fight').not.toBeNull()
  })

  it('refreshes a member’s heartbeat row on its own clock, not on every checkpoint', async () => {
    const sessionId = await joinAndWarm(7)
    const room = roomFor(sessionId)
    await connect(sessionId, 7)

    const heartbeats = () => (vi.mocked(env.DB.prepare).mock.calls as any[])
      .filter(([sql]) => String(sql).includes('coop_session_members SET last_seen_at')).length

    vi.spyOn(env.DB, 'prepare')
    // Joining wrote the row, so the next checkpoint has nothing to say about it.
    room.dirty = true
    await room.checkpoint(Date.now())
    expect(heartbeats()).toBe(0)

    // Once the stored value has drifted a write interval behind, it is refreshed
    // — and only then, however many checkpoints land in between.
    vi.advanceTimersByTime(31_000)
    room.lastSeen['7'] = Date.now()
    room.dirty = true
    await room.checkpoint(Date.now())
    expect(heartbeats()).toBe(1)

    room.dirty = true
    await room.checkpoint(Date.now())
    // 15s later the row is still comfortably inside the 90s lock TTL.
    expect(heartbeats()).toBe(1)
  })
})
