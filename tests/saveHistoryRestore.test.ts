// Phase 1 of the item-loss safety net, end to end against the real migrations
// schema (tests/helpers/d1): the snapshot a save write leaves behind, and the
// admin restore that puts it back.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { makeD1 } from './helpers/d1'
import { gzipJsonString } from '../functions/_lib/saveCodec.js'

import { onRequestGet, onRequestPost } from '../functions/api/admin/restore-save.js'
import { loadAnyCharacterWithSave, writeSave } from '../functions/_lib/game/save.js'
import {
  SAVE_HISTORY_ROUTINE_INTERVAL_MS,
  SAVE_HISTORY_ROUTINE_TTL_MS,
  SAVE_HISTORY_FLAGGED_TTL_MS,
  pruneSaveHistory,
} from '../functions/_lib/game/saveHistory.js'

const SECRET = 'a-very-long-admin-portal-secret'
const NOW = 1_760_000_000_000

let raw: any
let env: any

const DURABLES = [
  'runeforged_platebody', 'runeforged_platelegs', 'runeforged_full_helm', 'runeforged_kiteshield',
  'runeforged_scimitar', 'dragon_dagger', 'dragon_scimitar', 'nether_demon_whip',
  'bronze_platebody', 'iron_platebody', 'steel_platebody', 'mithril_platebody',
  'adamant_platebody', 'leather_body', 'studded_body', 'dragon_boots',
]

function bankOf(ids: string[]) {
  const bank: Record<string, { itemId: string; quantity: number }> = {}
  for (const id of ids) bank[id] = { itemId: id, quantity: 1 }
  return bank
}

async function seedCharacter(id = 7, bank: any = bankOf(DURABLES)) {
  raw.prepare(
    `INSERT INTO characters (id, owner_id, username, created_at, is_ironman, is_one_life, credits, total_pvp_kills, credits_used, total_level, combat_level, is_bot, total_level_at)
     VALUES (?, 1, ?, 0, 0, 0, 0, 0, 0, 1, 3, 0, 0)`,
  ).run(id, 'char' + id)
  const save = JSON.stringify({ stats: {}, inventory: [], bank, equipment: {}, settings: {} })
  const blob = await gzipJsonString(save)
  raw.prepare(`INSERT INTO saves (character_id, save_blob, save_data, updated_at, save_revision) VALUES (?, ?, ?, 0, 4)`)
    .run(id, blob, save)
}

function history(characterId = 7) {
  return raw.prepare('SELECT id, save_revision, reason, created_at FROM save_history WHERE character_id = ? ORDER BY id')
    .all(characterId)
}

function audits(eventType: string) {
  return raw.prepare('SELECT payload_json FROM audit_events WHERE event_type = ?').all(eventType)
}

function storedBank(characterId = 7) {
  const row = raw.prepare('SELECT save_data FROM saves WHERE character_id = ?').get(characterId)
  return JSON.parse(row.save_data).bank
}

function req(body: any, { secret = SECRET as string | null } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (secret !== null) headers['X-Admin-Secret'] = secret
  return new Request('https://x/api/admin/restore-save', { method: 'POST', headers, body: JSON.stringify(body) })
}

function getReq(query: string, { secret = SECRET as string | null } = {}) {
  const headers: Record<string, string> = {}
  if (secret !== null) headers['X-Admin-Secret'] = secret
  return new Request('https://x/api/admin/restore-save?' + query, { headers })
}

/** Mutates the loaded save through the real load → mutate → writeSave path, so
 * the WeakMap baseline and the batched history snapshot are both exercised. */
async function writeThrough(characterId: number, mutate: (save: any) => void) {
  const { saveObject, saveRevision } = await loadAnyCharacterWithSave(env, characterId)
  mutate(saveObject)
  return writeSave(env, characterId, saveObject, saveRevision)
}

beforeEach(() => {
  const made = makeD1()
  raw = made.raw
  env = { DB: made.DB, ADMIN_SECRET: SECRET }
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
})

describe('save history snapshots', () => {
  it('preserves the blob a write overwrites, before the write lands', async () => {
    await seedCharacter()
    await writeThrough(7, (save) => { save.bank = {} })

    const rows = history()
    expect(rows).toHaveLength(2)
    // The snapshot records the PRE-write revision — it is the state being
    // replaced, not the one replacing it.
    expect(rows[0].save_revision).toBe(4)
    expect(rows.map((r: any) => r.reason).sort()).toEqual(['item_loss', 'routine'])
    expect(storedBank()).toEqual({})
  })

  it('rate-limits routine snapshots to the cadence', async () => {
    await seedCharacter()
    await writeThrough(7, (save) => { save.settings.a = 1 })
    expect(history().filter((r: any) => r.reason === 'routine')).toHaveLength(1)

    await writeThrough(7, (save) => { save.settings.b = 2 })
    expect(history().filter((r: any) => r.reason === 'routine')).toHaveLength(1)

    vi.spyOn(Date, 'now').mockReturnValue(NOW + SAVE_HISTORY_ROUTINE_INTERVAL_MS + 1)
    await writeThrough(7, (save) => { save.settings.c = 3 })
    expect(history().filter((r: any) => r.reason === 'routine')).toHaveLength(2)
  })

  it('audits the loss it detected', async () => {
    await seedCharacter()
    await writeThrough(7, (save) => { save.bank = {} })

    const rows = audits('item_loss_detected')
    expect(rows).toHaveLength(1)
    const payload = JSON.parse(rows[0].payload_json)
    expect(payload.source).toBe('write_save')
    expect(payload.durableUnits).toBe(DURABLES.length)
    expect(payload.reasons).toContain('durable_items')
  })

  it('takes no flagged snapshot when the write only moves items', async () => {
    await seedCharacter()
    await writeThrough(7, (save) => {
      save.inventory = Object.keys(save.bank).map((id) => ({ itemId: id, quantity: 1 }))
      save.bank = {}
    })
    expect(history().map((r: any) => r.reason)).toEqual(['routine'])
    expect(audits('item_loss_detected')).toHaveLength(0)
  })

  it('skips detection for a caller whose save it never handed out', async () => {
    await seedCharacter()
    // A save object built from scratch has no baseline. Guessing one would mean
    // reading the write's own output as its input.
    await writeSave(env, 7, { bank: {}, inventory: [], equipment: {}, stats: {} }, 4)
    expect(audits('item_loss_detected')).toHaveLength(0)
    expect(history().map((r: any) => r.reason)).toEqual(['routine'])
  })

  it('inserts nothing for a character with no save row', async () => {
    raw.prepare(
      `INSERT INTO characters (id, owner_id, username, created_at, is_ironman, is_one_life, credits, total_pvp_kills, credits_used, total_level, combat_level, is_bot, total_level_at)
       VALUES (9, 1, 'fresh', 0, 0, 0, 0, 0, 0, 1, 3, 0, 0)`,
    ).run()
    await writeSave(env, 9, { bank: {}, stats: {} }, 0)
    expect(history(9)).toHaveLength(0)
  })

  it('prunes routine rows on the shorter clock and flagged rows on the longer one', async () => {
    await seedCharacter()
    await writeThrough(7, (save) => { save.bank = {} })
    expect(history()).toHaveLength(2)

    await pruneSaveHistory(env, NOW + SAVE_HISTORY_ROUTINE_TTL_MS + 1)
    expect(history().map((r: any) => r.reason)).toEqual(['item_loss'])

    await pruneSaveHistory(env, NOW + SAVE_HISTORY_FLAGGED_TTL_MS + 1)
    expect(history()).toHaveLength(0)
  })
})

describe('POST /api/admin/restore-save', () => {
  it('refuses without the admin secret', async () => {
    await seedCharacter()
    const res = await onRequestPost({ request: req({ character_id: 7, history_id: 1 }, { secret: null }), env } as any)
    expect(res.status).toBe(401)
  })

  it('refuses a wrong admin secret', async () => {
    await seedCharacter()
    const res = await onRequestPost({ request: req({ character_id: 7, history_id: 1 }, { secret: 'x'.repeat(30) }), env } as any)
    expect(res.status).toBe(401)
  })

  it('puts a lost bank back, forward as a new revision', async () => {
    await seedCharacter()
    await writeThrough(7, (save) => { save.bank = {} })
    expect(storedBank()).toEqual({})

    const snapshot = history().find((r: any) => r.reason === 'item_loss')
    const res = await onRequestPost({ request: req({ character_id: 7, history_id: snapshot.id }), env } as any)
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.ok).toBe(true)
    expect(Object.keys(storedBank())).toHaveLength(DURABLES.length)
    // Forward, never backward: a rewind would leave the player's client pushing
    // a revision the server has already moved past.
    expect(body.save_revision).toBe(6)
    expect(body.restores.durableUnits).toBe(DURABLES.length)
  })

  it('preserves what the restore itself overwrites, ignoring the routine cadence', async () => {
    await seedCharacter()
    await writeThrough(7, (save) => { save.bank = {} })
    const snapshot = history().find((r: any) => r.reason === 'item_loss')
    // The routine snapshot for this window has already been taken, so a restore
    // relying on it would leave the pre-restore state unrecoverable.
    await onRequestPost({ request: req({ character_id: 7, history_id: snapshot.id }), env } as any)
    expect(history().some((r: any) => r.reason === 'pre_restore')).toBe(true)
  })

  it('writes nothing on a dry run', async () => {
    await seedCharacter()
    await writeThrough(7, (save) => { save.bank = {} })
    const snapshot = history().find((r: any) => r.reason === 'item_loss')

    const res = await onRequestPost({ request: req({ character_id: 7, history_id: snapshot.id, dry_run: true }), env } as any)
    const body = await res.json() as any
    expect(body.dry_run).toBe(true)
    expect(body.restores.durableUnits).toBe(DURABLES.length)
    expect(storedBank()).toEqual({})
    expect(audits('admin_save_restore')).toHaveLength(0)
  })

  it('audits the restore', async () => {
    await seedCharacter()
    await writeThrough(7, (save) => { save.bank = {} })
    const snapshot = history().find((r: any) => r.reason === 'item_loss')
    await onRequestPost({ request: req({ character_id: 7, history_id: snapshot.id, reason: 'ticket 41' }), env } as any)

    const rows = audits('admin_save_restore')
    expect(rows).toHaveLength(1)
    const payload = JSON.parse(rows[0].payload_json)
    expect(payload.historyId).toBe(snapshot.id)
    expect(payload.reason).toBe('ticket 41')
  })

  it('will not restore another character\'s snapshot', async () => {
    await seedCharacter(7)
    await seedCharacter(8)
    await writeThrough(7, (save) => { save.bank = {} })
    const snapshot = history(7)[0]

    const res = await onRequestPost({ request: req({ character_id: 8, history_id: snapshot.id }), env } as any)
    expect(res.status).toBe(404)
  })

  it('refuses while a co-op room owns the save', async () => {
    await seedCharacter()
    await writeThrough(7, (save) => { save.bank = {} })
    const snapshot = history()[0]
    raw.prepare(`INSERT INTO coop_boss_sessions (id, boss_id, status, member_count, created_at, current_tick, state_json, last_tick_at) VALUES (11, 'grondar', 'active', 1, ?, 0, '{}', ?)`).run(NOW, NOW)
    raw.prepare(`INSERT INTO coop_session_members (session_id, character_id, joined_at, last_seen_at) VALUES (11, 7, ?, ?)`).run(NOW, NOW)
    raw.prepare('UPDATE characters SET active_coop_session_id = 11 WHERE id = 7').run()

    const res = await onRequestPost({ request: req({ character_id: 7, history_id: snapshot.id }), env } as any)
    expect(res.status).toBe(409)
    expect((await res.json() as any).code).toBe('CHARACTER_IN_COOP_SESSION')
  })

  it('refuses while a world session owns the save', async () => {
    await seedCharacter()
    await writeThrough(7, (save) => { save.bank = {} })
    const snapshot = history()[0]
    raw.prepare(`INSERT INTO world_sessions (character_id, session_id, heartbeat_at, created_at) VALUES (7, 'w1', ?, ?)`).run(NOW - 1_000, NOW)

    const res = await onRequestPost({ request: req({ character_id: 7, history_id: snapshot.id }), env } as any)
    expect(res.status).toBe(409)
    expect((await res.json() as any).code).toBe('CHARACTER_IN_WORLD_SESSION')
  })

  it('refuses to resurrect a save that no longer exists', async () => {
    await seedCharacter()
    await writeThrough(7, (save) => { save.bank = {} })
    const snapshot = history()[0]
    // One-Life death hard-deletes the row; a restore must not undo that.
    raw.prepare('DELETE FROM saves WHERE character_id = 7').run()

    const res = await onRequestPost({ request: req({ character_id: 7, history_id: snapshot.id }), env } as any)
    expect(res.status).toBe(409)
    expect((await res.json() as any).code).toBe('SAVE_NOT_FOUND')
  })
})

describe('GET /api/admin/restore-save', () => {
  it('refuses without the admin secret', async () => {
    const res = await onRequestGet({ request: getReq('character_id=7', { secret: null }), env } as any)
    expect(res.status).toBe(401)
  })

  it('lists snapshots newest first without dragging the blobs back', async () => {
    await seedCharacter()
    await writeThrough(7, (save) => { save.bank = {} })

    const res = await onRequestGet({ request: getReq('character_id=7'), env } as any)
    const body = await res.json() as any
    expect(body.snapshots).toHaveLength(2)
    expect(body.snapshots[0]).not.toHaveProperty('save_blob')
    expect(body.snapshots[0].size_bytes).toBeGreaterThan(0)
    expect(body.current.holdings.distinctItems).toBe(0)
  })

  it('reports what the live save has lost since a given snapshot', async () => {
    await seedCharacter()
    await writeThrough(7, (save) => { save.bank = {} })
    const snapshot = history()[0]

    const res = await onRequestGet({ request: getReq('character_id=7&history_id=' + snapshot.id), env } as any)
    const body = await res.json() as any
    expect(body.snapshot.holdings.distinctItems).toBe(DURABLES.length)
    expect(body.lost_since_snapshot.durableUnits).toBe(DURABLES.length)
    expect(body.lost_since_snapshot.flagged).toBe(true)
  })

  it('404s a snapshot id belonging to another character', async () => {
    await seedCharacter(7)
    await seedCharacter(8)
    await writeThrough(7, (save) => { save.bank = {} })
    const snapshot = history(7)[0]

    const res = await onRequestGet({ request: getReq('character_id=8&history_id=' + snapshot.id), env } as any)
    expect(res.status).toBe(404)
  })
})
