// The idle game's kill counts, reported as a side channel on /api/save.
//
// The bug this exists for: an ordinary idle kill counted nowhere, because the
// only paths that write kill_counts are server-authoritative completions — and
// a grind cannot afford one per cow (§6). The rule that makes reporting them
// safe is that a client may only report monsters that could never answer a boss
// entry gate, and that have no authoritative completion of their own to
// double-count against.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { makeD1 } from './helpers/d1'
import { gzipJsonString } from '../functions/_lib/saveCodec.js'
import { applyReportedKillCounts } from '../functions/_lib/game/killCounts.js'

vi.mock('../functions/_lib/auth.js', () => ({
  requireAuth: async () => ({ identity: { id: 1 } }),
  json: (body: any, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
}))

import { onRequestPut } from '../functions/api/save.js'

const NOW = 1_760_000_000_000
let raw: any
let env: any

function saveWith(overrides: Record<string, unknown> = {}) {
  return { version: 1, timestamp: 1111, stats: { attack: { xp: 100 } }, inventory: [], equipment: {}, settings: {}, bank: {}, ...overrides }
}

async function seed() {
  raw.prepare(
    `INSERT INTO characters (id, owner_id, username, created_at, is_ironman, is_one_life, credits, total_pvp_kills, credits_used, total_level, combat_level, is_bot, total_level_at)
     VALUES (42, 1, 'hero', 0, 0, 0, 0, 0, 0, 1, 3, 0, 0)`,
  ).run()
  const save = JSON.stringify(saveWith())
  raw.prepare('INSERT INTO saves (character_id, save_blob, save_data, updated_at, save_revision) VALUES (42, ?, ?, 0, 7)')
    .run(await gzipJsonString(save), save)
}

function put(body: any) {
  return new Request('https://x/api/save', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Character-Id': '42' },
    body: JSON.stringify(body),
  })
}

const countOf = (monsterId: string) =>
  raw.prepare("SELECT kill_count FROM kill_counts WHERE character_id = 42 AND source_type = 'monsters' AND source_id = ?").get(monsterId)?.kill_count ?? 0

beforeEach(async () => {
  const made = makeD1()
  raw = made.raw
  env = { DB: made.DB }
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  vi.spyOn(Math, 'random').mockReturnValue(0.99) // no sweep, no prune
  await seed()
})

describe('applyReportedKillCounts', () => {
  it('adds a reported tally to the table', async () => {
    await applyReportedKillCounts(env, 42, { green_dragon: 12, pasture_bull: 3 })
    expect(countOf('green_dragon')).toBe(12)
    expect(countOf('pasture_bull')).toBe(3)
  })

  it('accumulates across pushes rather than overwriting', async () => {
    await applyReportedKillCounts(env, 42, { green_dragon: 12 })
    await applyReportedKillCounts(env, 42, { green_dragon: 5 })
    expect(countOf('green_dragon')).toBe(17)
  })

  it('refuses a boss and a gate prerequisite outright', async () => {
    await applyReportedKillCounts(env, 42, { warlord_grondar: 50, ember_tyrant: 50, green_dragon: 1 })
    expect(countOf('warlord_grondar')).toBe(0)
    expect(countOf('ember_tyrant')).toBe(0)
    expect(countOf('green_dragon')).toBe(1)
  })

  it('writes nothing for an unresolved character or an empty tally', async () => {
    expect(await applyReportedKillCounts(env, 0, { green_dragon: 5 })).toEqual({})
    expect(await applyReportedKillCounts(env, 42, {})).toEqual({})
    expect(countOf('green_dragon')).toBe(0)
  })
})

describe('PUT /api/save kill-count side channel', () => {
  it('applies the reported tally alongside the save write', async () => {
    const res = await onRequestPut({
      request: put({ save_data: JSON.stringify(saveWith({ stats: { attack: { xp: 500 } } })), save_revision: 7, kills: { green_dragon: 4 } }),
      env,
    } as any)
    expect(res.status).toBe(200)
    expect(countOf('green_dragon')).toBe(4)
  })

  it('audits what it accepted, not what it was handed', async () => {
    await onRequestPut({
      request: put({ save_data: JSON.stringify(saveWith({ stats: { attack: { xp: 500 } } })), save_revision: 7, kills: { green_dragon: 4, warlord_grondar: 9 } }),
      env,
    } as any)
    const row = raw.prepare("SELECT payload_json FROM audit_events WHERE event_type = 'kill_counts_reported'").get()
    expect(JSON.parse(row.payload_json).kills).toEqual({ green_dragon: 4 })
  })

  it('counts the kills on a content-identical save too — the blob is a no-op, the kills are not', async () => {
    const res = await onRequestPut({
      request: put({ save_data: JSON.stringify(saveWith()), save_revision: 7, kills: { green_dragon: 2 } }),
      env,
    } as any)
    expect((await res.json()).noop).toBe(true)
    expect(countOf('green_dragon')).toBe(2)
  })

  it('counts nothing when the server REFUSES the write, so the client can safely retry', async () => {
    // Stale revision → 409. The client only settles its tally on an ok, so
    // counting here would double-count everything it re-sends.
    const res = await onRequestPut({
      request: put({ save_data: JSON.stringify(saveWith({ stats: { attack: { xp: 500 } } })), save_revision: 3, kills: { green_dragon: 4 } }),
      env,
    } as any)
    expect(res.status).toBe(409)
    expect(countOf('green_dragon')).toBe(0)
  })

  it('counts the kills when the idle write ceiling refuses the blob', async () => {
    // The ceiling answers ok, so the client settles its tally against it —
    // dropping the counts here would lose every kill an offline catch-up made
    // past the ceiling.
    const staleAt = NOW - 48 * 60 * 60 * 1000
    raw.prepare('INSERT INTO character_idle_state (character_id, last_active_at, last_interactive_at, updated_at) VALUES (42, ?, ?, ?)')
      .run(staleAt, staleAt, staleAt)
    const res = await onRequestPut({
      request: put({ save_data: JSON.stringify(saveWith({ stats: { attack: { xp: 900 } } })), save_revision: 7, interactive: false, kills: { green_dragon: 6 } }),
      env,
    } as any)
    const body = await res.json()
    expect(body.idle_ceiling).toBe(true)
    expect(countOf('green_dragon')).toBe(6)
  })

  it('writes the save normally when no tally is reported', async () => {
    const res = await onRequestPut({
      request: put({ save_data: JSON.stringify(saveWith({ stats: { attack: { xp: 500 } } })), save_revision: 7 }),
      env,
    } as any)
    expect(res.status).toBe(200)
    expect(raw.prepare("SELECT COUNT(*) AS n FROM kill_counts WHERE character_id = 42").get().n).toBe(0)
  })
})
