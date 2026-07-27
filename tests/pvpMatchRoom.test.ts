// PvpMatchRoom — the Durable Object that runs a duel.
//
// The model it replaces advanced the fight from whichever client's tick request
// won a 600ms race, which meant the loser of that race was answered with no
// state and no events, the fight ran at whatever rate the clients managed, and
// the settlement raced itself. These tests pin the three properties that fixed:
// the room's own clock, replay to both duellists, and one settlement per match.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeD1, FakeD1 } from './helpers/d1'
import { gzipJsonString, decodeSaveRow } from '../functions/_lib/saveCodec.js'
import { PvpMatchRoom } from '../world/server/PvpMatchRoom'
import { createMatch } from '../functions/_lib/pvpMatchCreate.js'
import { settlePvpMatch } from '../functions/_lib/pvpSettle.js'
import { PVP_MATCH_STALL_MS } from '../functions/_lib/pvp.js'

let env: { DB: FakeD1; PVP_ROOM?: unknown }
let raw: any
let rooms: Map<string, PvpMatchRoom>

function baseSave(extraInventory: any[] = []) {
  const inventory = new Array(28).fill(null)
  for (let i = 0; i < extraInventory.length; i++) inventory[i] = extraInventory[i]
  return {
    stats: {
      attack: { xp: 13_034_431 }, strength: { xp: 13_034_431 }, defence: { xp: 13_034_431 },
      hitpoints: { xp: 13_034_431 }, ranged: { xp: 13_034_431 }, magic: { xp: 13_034_431 },
      prayer: { xp: 13_034_431 },
    },
    inventory,
    bank: {},
    equipment: {},
    player: { currentHP: 99 },
    settings: { combatStance: 'aggressive' },
    completedQuests: [],
  }
}

async function seedCharacter(id: number, save = baseSave(), ownerId = 1) {
  raw.prepare(
    `INSERT INTO characters (id, owner_id, username, created_at, is_ironman, is_one_life, credits, total_pvp_kills, credits_used, total_level, combat_level, is_bot, total_level_at)
     VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, 700, 126, 0, 0)`,
  ).run(id, ownerId, `player${id}`)
  const json = JSON.stringify(save)
  const blob = await gzipJsonString(json)
  raw.prepare(
    'INSERT INTO saves (character_id, save_blob, save_data, updated_at, save_revision) VALUES (?, ?, ?, ?, 1)',
  ).run(id, blob, json, Date.now())
}

/** DO storage is per-object and survives eviction; a Map is close enough for
 * what the room asks of it. */
function makeStorage() {
  const store = new Map<string, unknown>()
  return {
    storage: {
      get: async (key: string) => store.get(key),
      put: async (key: string, value: unknown) => { store.set(key, value) },
      delete: async (key: string) => { store.delete(key) },
    },
  }
}

function makeRoomBinding() {
  rooms = new Map()
  const storages = new Map<string, ReturnType<typeof makeStorage>>()
  return {
    idFromName: (name: string) => name,
    get: (name: string) => ({
      fetch: (url: string, init?: RequestInit) => {
        if (!rooms.has(name)) {
          if (!storages.has(name)) storages.set(name, makeStorage())
          rooms.set(name, new PvpMatchRoom(storages.get(name)! as never, env as never))
        }
        return rooms.get(name)!.fetch(new Request(url, init))
      },
    }),
  }
}

function callRoom(matchId: number, action: string, body: Record<string, unknown>) {
  const stub = (env.PVP_ROOM as any).get((env.PVP_ROOM as any).idFromName(`pvp:${matchId}`))
  return stub.fetch(`https://pvp-room/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, matchId }),
  })
}

async function poll(matchId: number, characterId: number, sinceTick?: number) {
  const res = await callRoom(matchId, 'poll', sinceTick === undefined
    ? { characterId }
    : { characterId, sinceTick })
  return { status: res.status, body: await res.json() as any }
}

async function startMatch(aId: number, bId: number) {
  const res = await createMatch(env as never, { id: aId, username: `player${aId}` }, { id: bId, username: `player${bId}` }, Date.now())
  expect(res.ok).toBe(true)
  return res.matchId as number
}

async function readSave(characterId: number) {
  const row = await env.DB.prepare(
    'SELECT save_data, save_blob, updated_at FROM saves WHERE character_id = ?',
  ).bind(characterId).first()
  const decoded = await decodeSaveRow(row)
  return JSON.parse(decoded.save_data)
}

/**
 * Advance the fight n beats and wait for each to finish.
 *
 * Advancing the clock is not enough: a beat that settles is a long chain of
 * gzip and D1 awaits, and returning while it is half-done reads the match row
 * mid-claim. The room's own work queue is the thing to wait on — polling a
 * fixed number of event-loop turns instead made this flaky under a loaded
 * suite.
 */
async function beats(n: number) {
  for (let i = 0; i < n; i++) {
    await vi.advanceTimersByTimeAsync(600)
    for (const room of rooms.values()) await (room as any).queue.catch(() => {})
    // The busy flag clears in a `finally` chained after that queue.
    await new Promise((resolve) => setImmediate(resolve))
  }
}

beforeEach(() => {
  // The room ticks on a real 600ms interval; freeze it so no duel advances
  // underneath an assertion. Date is faked with it because the room measures
  // client silence in wall-clock ms.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  const d = makeD1()
  env = { DB: d.DB }
  raw = d.raw
  env.PVP_ROOM = makeRoomBinding()
})

afterEach(() => {
  for (const room of rooms?.values() || []) (room as any).stopTicking?.()
  vi.useRealTimers()
})

describe("the room's own clock", () => {
  it('advances the duel with nobody polling, so a backgrounded tab cannot slow the fight', async () => {
    await seedCharacter(1)
    await seedCharacter(2)
    const matchId = await startMatch(1, 2)

    // One poll to warm the room, then silence.
    const warm = await poll(matchId, 1)
    expect(warm.status).toBe(200)
    expect(warm.body.current_tick).toBe(0)

    await beats(5)

    const after = await poll(matchId, 1)
    expect(after.body.current_tick).toBeGreaterThanOrEqual(5)
  })

  it('replays every beat to BOTH duellists, not just whoever asked first', async () => {
    await seedCharacter(1)
    await seedCharacter(2)
    const matchId = await startMatch(1, 2)
    await poll(matchId, 1)
    await poll(matchId, 2)

    await beats(4)

    const a = await poll(matchId, 1, 0)
    const b = await poll(matchId, 2, 0)

    const ticksIn = (body: any) => [...new Set((body.events || []).map((ev: any) => ev.tick))].sort()
    expect(a.body.current_tick).toBe(b.body.current_tick)
    // The old model handed one caller the tick and the other `state: null`.
    expect(a.body.state).toBeTruthy()
    expect(b.body.state).toBeTruthy()
    expect(ticksIn(a.body)).toEqual(ticksIn(b.body))
    expect(ticksIn(a.body).length).toBeGreaterThan(0)
  })

  it('sends only what a client has not acknowledged', async () => {
    await seedCharacter(1)
    await seedCharacter(2)
    const matchId = await startMatch(1, 2)
    await poll(matchId, 1)
    await beats(3)

    const first = await poll(matchId, 1, 0)
    const seen = first.body.current_tick
    await beats(2)

    const second = await poll(matchId, 1, seen)
    for (const ev of second.body.events || []) expect(ev.tick).toBeGreaterThan(seen)
  })
})

describe('batched intents', () => {
  it('queue in array order and report only the actions that failed validation', async () => {
    await seedCharacter(1, baseSave([{ itemId: 'shark', quantity: 3 }]))
    await seedCharacter(2)
    const matchId = await startMatch(1, 2)
    await poll(matchId, 1)

    const res = await callRoom(matchId, 'intent', {
      characterId: 1,
      actions: [
        { type: 'change_stance', stance: 'defensive' },
        { type: 'change_stance', stance: 'nonsense' },
        { type: 'eat', inventorySlot: 0 },
      ],
    })
    const body = await res.json() as any
    expect(res.status).toBe(200)
    expect(body.rejected).toEqual([{ index: 1, error: 'invalid_stance' }])

    const room = rooms.get(`pvp:${matchId}`)! as any
    expect(room.pending.map((i: any) => i.action.type)).toEqual(['change_stance', 'eat'])
    expect(room.pending[0].characterSeq).toBeLessThan(room.pending[1].characterSeq)

    await beats(1)
    expect(room.state.combatants['1'].stance).toBe('defensive')
  })

  it('refuses an action once the duel has been settled', async () => {
    await seedCharacter(1)
    await seedCharacter(2)
    const matchId = await startMatch(1, 2)
    await poll(matchId, 1)
    await callRoom(matchId, 'intent', { characterId: 1, actions: [{ type: 'forfeit' }] })
    await beats(1)

    const res = await callRoom(matchId, 'intent', { characterId: 1, actions: [{ type: 'change_stance', stance: 'defensive' }] })
    expect(res.status).toBe(409)
  })
})

describe('settlement', () => {
  it('transfers the loser\'s gear once and hands the outcome to both duellists', async () => {
    await seedCharacter(1, baseSave([{ itemId: 'shark', quantity: 5 }]))
    await seedCharacter(2)
    const matchId = await startMatch(1, 2)
    await poll(matchId, 1)
    await poll(matchId, 2)

    await callRoom(matchId, 'intent', { characterId: 1, actions: [{ type: 'forfeit' }] })
    await beats(1)

    const forfeiter = await poll(matchId, 1)
    const winner = await poll(matchId, 2)
    expect(forfeiter.body.terminal.reason).toBe('forfeit')
    expect(forfeiter.body.terminal.winner).toBe(2)
    // Both sides get told, not just whoever's request happened to settle it.
    expect(winner.body.terminal.winner).toBe(2)
    expect(winner.body.terminal_writeback).toBe(true)

    const row = await env.DB.prepare('SELECT status, winner_character_id FROM pvp_matches WHERE id = ?').bind(matchId).first() as any
    expect(row.status).toBe('completed')
    expect(row.winner_character_id).toBe(2)

    const winnerSave = await readSave(2)
    expect(winnerSave.bank.shark.quantity).toBe(5)
    const loserSave = await readSave(1)
    expect((loserSave.inventory || []).filter((s: any) => s?.itemId === 'shark')).toHaveLength(0)

    const locks = await env.DB.prepare('SELECT COUNT(*) AS n FROM characters WHERE active_match_id IS NOT NULL').first() as any
    expect(locks.n).toBe(0)
  })

  it('is exactly-once: a replayed settlement moves nothing more', async () => {
    await seedCharacter(1, baseSave([{ itemId: 'shark', quantity: 5 }]))
    await seedCharacter(2)
    const matchId = await startMatch(1, 2)
    await poll(matchId, 1)
    await callRoom(matchId, 'intent', { characterId: 1, actions: [{ type: 'forfeit' }] })
    await beats(1)

    const room = rooms.get(`pvp:${matchId}`)! as any
    // What an evicted-and-restarted room would attempt: settle the same death
    // again. `pvp_matches.status` is the claim, so the second attempt fails.
    const replay = await settlePvpMatch(
      env as never,
      room.match,
      room.state,
      { winner: 2, loser: 1, reason: 'forfeit' },
    ) as any
    expect(replay.ok).toBe(false)

    const winnerSave = await readSave(2)
    expect(winnerSave.bank.shark.quantity).toBe(5)
    const kills = await env.DB.prepare('SELECT total_pvp_kills FROM characters WHERE id = 2').first() as any
    expect(kills.total_pvp_kills).toBe(1)
  })
})

describe('a duel nobody is watching', () => {
  it('aborts without moving loot once both clients have gone quiet', async () => {
    await seedCharacter(1, baseSave([{ itemId: 'shark', quantity: 5 }]))
    await seedCharacter(2)
    const matchId = await startMatch(1, 2)
    await poll(matchId, 1)
    await poll(matchId, 2)

    await beats(40)

    const row = await env.DB.prepare('SELECT status FROM pvp_matches WHERE id = ?').bind(matchId).first() as any
    expect(row.status).toBe('aborted')
    // An aborted duel resolved no winner, so both inventories stay untouched.
    const loserSave = await readSave(1)
    expect((loserSave.inventory || []).some((s: any) => s?.itemId === 'shark')).toBe(true)
    const winnerSave = await readSave(2)
    expect(winnerSave.bank.shark).toBeUndefined()
    const locks = await env.DB.prepare('SELECT COUNT(*) AS n FROM characters WHERE active_match_id IS NOT NULL').first() as any
    expect(locks.n).toBe(0)
  })

  it('keeps swinging while one duellist is still there, so a closed tab still loses', async () => {
    await seedCharacter(1)
    await seedCharacter(2)
    const matchId = await startMatch(1, 2)
    await poll(matchId, 1)
    await poll(matchId, 2)

    // Only character 1 keeps polling, well past the idle cutoff.
    for (let i = 0; i < 40; i++) {
      await beats(1)
      await poll(matchId, 1)
    }

    const row = await env.DB.prepare('SELECT status FROM pvp_matches WHERE id = ?').bind(matchId).first() as any
    expect(row.status).toBe('active')
    const after = await poll(matchId, 1)
    expect(after.body.current_tick).toBeGreaterThan(30)
  })
})

describe('the stall heartbeat', () => {
  it('refreshes last_tick_at often enough that the sweep never aborts a live duel', async () => {
    await seedCharacter(1)
    await seedCharacter(2)
    const matchId = await startMatch(1, 2)
    await poll(matchId, 1)

    let worstGap = 0
    let lastSeenAt = Date.now()
    for (let i = 0; i < 60; i++) {
      await beats(1)
      await poll(matchId, 1)
      const row = await env.DB.prepare('SELECT last_tick_at FROM pvp_matches WHERE id = ?').bind(matchId).first() as any
      if (row.last_tick_at > lastSeenAt) lastSeenAt = row.last_tick_at
      worstGap = Math.max(worstGap, Date.now() - lastSeenAt)
    }
    expect(worstGap).toBeLessThan(PVP_MATCH_STALL_MS)
  })
})
