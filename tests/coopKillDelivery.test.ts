// Does the kill settlement actually REACH the client that earned it?
//
// The room stamps every event with the tick it happened on and replays
// `ev.tick > sinceTick`. Settlement is several D1 round-trips and now runs once
// per winner, so a poll can easily land while it is still in flight.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeD1, FakeD1 } from './helpers/d1'
import { gzipJsonString } from '../functions/_lib/saveCodec.js'
import { CoopBossRoom } from '../world/server/CoopBossRoom'
import { joinCoopSession } from '../functions/_lib/game/coopBoss.js'

const BOSS = 'corporeal_horror'
const QUEST = 'the_heart_of_shadows'
let env: any
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
    inventory, bank: {},
    equipment: { weapon: { itemId: 'krylth_spear', quantity: 1 } },
    player: { currentHP: 99 },
    settings: { combatStance: 'aggressive' },
    completedQuests: [QUEST],
  }
}

async function seedCharacter(id: number) {
  raw.prepare(
    `INSERT INTO characters (id, owner_id, username, created_at, is_ironman, is_one_life, credits, total_pvp_kills, credits_used, total_level, combat_level, is_bot, total_level_at)
     VALUES (?, 1, ?, 0, 0, 0, 0, 0, 0, 700, 126, 0, 0)`,
  ).run(id, `player${id}`)
  const json = JSON.stringify(baseSave())
  raw.prepare('INSERT INTO saves (character_id, save_blob, save_data, updated_at, save_revision) VALUES (?, ?, ?, 0, 1)')
    .run(id, await gzipJsonString(json), json)
}

function makeRoomBinding() {
  rooms = new Map()
  return {
    idFromName: (n: string) => n,
    get: (n: string) => ({
      fetch: (url: string, init?: RequestInit) => {
        if (!rooms.has(n)) rooms.set(n, new CoopBossRoom({} as never, env as never))
        return rooms.get(n)!.fetch(new Request(url, init))
      },
    }),
  }
}

function callRoom(sessionId: number, action: string, body: Record<string, unknown>) {
  const stub = env.COOP_ROOM.get(env.COOP_ROOM.idFromName(`coop:${sessionId}`))
  return stub.fetch(`https://coop-room/${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, sessionId }),
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  const d = makeD1()
  env = { DB: d.DB as FakeD1 }
  raw = d.raw
  env.COOP_ROOM = makeRoomBinding()
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('a poll that lands while the kill is being settled', () => {
  it('still delivers the settlement to the winner', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    await seedCharacter(7)
    const { sessionId } = await joinCoopSession(env, { characterId: 7, identityId: 1, bossId: BOSS, username: 'player7' })
    await callRoom(sessionId, 'poll', { characterId: 7 })
    const room = rooms.get(`coop:${sessionId}`)! as any
    room.state.members['7'].damage = 2000
    room.state.boss.currentHP = 0

    // Park the beat inside settlement, exactly where the D1 round-trips are.
    let release: () => void = () => {}
    let entered: () => void = () => {}
    const blocked = new Promise<void>((r) => { release = r })
    const inside = new Promise<void>((r) => { entered = r })
    const realSettle = room.settleKill.bind(room)
    room.settleKill = async (...args: unknown[]) => { entered(); await blocked; return realSettle(...args) }
    const beat = room.tick()
    await inside

    // The client's poll arrives mid-settlement and acknowledges what it saw.
    const midBody = await (await callRoom(sessionId, 'poll', { characterId: 7, sinceTick: 0 })).json() as any
    const acknowledged = midBody.current_tick

    release()
    await beat

    // The very next poll, using the tick the client just acknowledged, has to
    // carry the settlement — this is the only chance it gets.
    const nextBody = await (await callRoom(sessionId, 'poll', { characterId: 7, sinceTick: acknowledged })).json() as any
    const settled = nextBody.events.find((e: any) => e.type === 'killSettled')
    expect(settled, 'winner never received their killSettled event').toBeTruthy()
    expect(settled.settlements.find((s: any) => s.characterId === 7).granted.length).toBeGreaterThan(0)
  })
})
