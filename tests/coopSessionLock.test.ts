// The co-op save lock: while the server is resolving a character's swings and
// eating their food tick by tick, the idle client must not write its own view of
// the save over the top. Real schema (migration 0031 applied), real coopBoss lib
// + /api/save.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { makeD1, FakeD1 } from './helpers/d1'
import { gzipJsonString } from '../functions/_lib/saveCodec.js'
import {
  COOP_SESSION_STALE_MS,
  joinCoopSession,
  leaveCoopSession,
  sweepStaleCoopSessions,
} from '../functions/_lib/game/coopBoss.js'

vi.mock('../functions/_lib/auth.js', () => ({
  requireAuth: async () => ({ identity: { id: 1 } }),
  json: (body: any, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
}))

import { onRequestPut } from '../functions/api/save.js'

const BOSS = 'corporeal_horror'
const QUEST = 'the_heart_of_shadows'
let raw: any
let env: any

function char(id: number, ownerId = 1) {
  raw.prepare(
    `INSERT INTO characters (id, owner_id, username, created_at, is_ironman, is_one_life, credits, active_match_id, total_pvp_kills, credits_used, total_level, combat_level, is_bot, total_level_at)
     VALUES (?, ?, ?, 0, 0, 0, 0, NULL, 0, 0, 700, 126, 0, 0)`,
  ).run(id, ownerId, 'c' + id)
}

function savePayload(extra: Record<string, unknown> = {}) {
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
    completedQuests: [QUEST],
    ...extra,
  }
}

async function save(id: number) {
  const json = JSON.stringify(savePayload())
  raw.prepare('INSERT INTO saves (character_id, save_blob, save_data, updated_at, save_revision) VALUES (?, ?, ?, 0, 1)')
    .run(id, await gzipJsonString(json), json)
}

// A legitimate client save: same character strength (so the total-level
// regression guard stays out of the way), with one changed field.
function savePut(characterId: number, saveRevision: number) {
  return new Request('https://x', {
    method: 'PUT',
    headers: { 'X-Character-Id': String(characterId), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      save_data: JSON.stringify(savePayload({ player: { currentHP: 55 } })),
      save_revision: saveRevision,
    }),
  })
}

function currentRevision(id: number) {
  return raw.prepare('SELECT save_revision FROM saves WHERE character_id = ?').get(id).save_revision
}

async function join(id: number) {
  return joinCoopSession(env, { characterId: id, identityId: 1, bossId: BOSS, username: 'c' + id })
}

beforeEach(async () => {
  const d = makeD1()
  env = { DB: d.DB as FakeD1, JWT_SECRET: 'coop-lock-secret' }
  raw = d.raw
  char(5)
  await save(5)
})

describe('PUT /api/save co-op session lock', () => {
  it('refuses a client save while the character is in a live co-op fight', async () => {
    await join(5)
    const res = await onRequestPut({ request: savePut(5, currentRevision(5)), env } as any)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('CHARACTER_IN_COOP_SESSION')
  })

  it('does not let a refused save alter the stored revision', async () => {
    await join(5)
    const before = currentRevision(5)
    await onRequestPut({ request: savePut(5, before), env } as any)
    expect(currentRevision(5)).toBe(before)
  })

  it('allows the save again once the character leaves the fight', async () => {
    const { sessionId } = await join(5)
    await leaveCoopSession(env, { characterId: 5, identityId: 1, sessionId })
    const res = await onRequestPut({ request: savePut(5, currentRevision(5)), env } as any)
    expect(res.status).toBe(200)
  })

  it('self-heals: a session nobody has ticked stops blocking the save', async () => {
    const { sessionId } = await join(5)
    raw.prepare('UPDATE coop_boss_sessions SET last_tick_at = ? WHERE id = ?')
      .run(Date.now() - COOP_SESSION_STALE_MS - 1, sessionId)
    const res = await onRequestPut({ request: savePut(5, currentRevision(5)), env } as any)
    expect(res.status).toBe(200)
  })

  it('leaves an uninvolved character free to save', async () => {
    char(6)
    await save(6)
    await join(5)
    const res = await onRequestPut({ request: savePut(6, currentRevision(6)), env } as any)
    expect(res.status).toBe(200)
  })

  it('frees the save when a stale session is swept', async () => {
    const { sessionId } = await join(5)
    raw.prepare('UPDATE coop_boss_sessions SET last_tick_at = ? WHERE id = ?')
      .run(Date.now() - COOP_SESSION_STALE_MS - 1, sessionId)
    await sweepStaleCoopSessions(env)
    const res = await onRequestPut({ request: savePut(5, currentRevision(5)), env } as any)
    expect(res.status).toBe(200)
  })
})
