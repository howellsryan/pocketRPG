// POST /api/admin/snapshot-save — the manual "Snapshot now" button. It takes
// the SAME snapshot the 6h cadence takes, on demand, so the one behaviour that
// matters is that it ignores the cadence rather than being gated by it.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { makeD1 } from './helpers/d1'
import { gzipJsonString } from '../functions/_lib/saveCodec.js'

import { onRequestPost } from '../functions/api/admin/snapshot-save.js'
import { loadAnyCharacterWithSave, writeSave } from '../functions/_lib/game/save.js'

const SECRET = 'a-very-long-admin-portal-secret'
const NOW = 1_760_000_000_000

let raw: any
let env: any

async function seedCharacter(id = 7) {
  raw.prepare(
    `INSERT INTO characters (id, owner_id, username, created_at, is_ironman, is_one_life, credits, total_pvp_kills, credits_used, total_level, combat_level, is_bot, total_level_at)
     VALUES (?, 1, ?, 0, 0, 0, 0, 0, 0, 1, 3, 0, 0)`,
  ).run(id, 'char' + id)
  const save = JSON.stringify({
    stats: {}, inventory: [], equipment: {}, settings: {},
    bank: { nether_demon_whip: { itemId: 'nether_demon_whip', quantity: 1 } },
  })
  raw.prepare('INSERT INTO saves (character_id, save_blob, save_data, updated_at, save_revision) VALUES (?, ?, ?, 0, 4)')
    .run(id, await gzipJsonString(save), save)
}

function req(body: any, { secret = SECRET as string | null } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (secret !== null) headers['X-Admin-Secret'] = secret
  return new Request('https://x/api/admin/snapshot-save', { method: 'POST', headers, body: JSON.stringify(body) })
}

const history = (characterId = 7) =>
  raw.prepare('SELECT id, save_revision, reason, save_blob FROM save_history WHERE character_id = ? ORDER BY id').all(characterId)

beforeEach(() => {
  const made = makeD1()
  raw = made.raw
  env = { DB: made.DB, ADMIN_SECRET: SECRET }
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
})

describe('POST /api/admin/snapshot-save', () => {
  it('refuses without the admin secret', async () => {
    await seedCharacter()
    const res = await onRequestPost({ request: req({ character_id: 7 }, { secret: null }), env } as any)
    expect(res.status).toBe(401)
    expect(history()).toHaveLength(0)
  })

  it('preserves the current blob at the current revision', async () => {
    await seedCharacter()
    const res = await onRequestPost({ request: req({ character_id: 7 }), env } as any)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, character_id: 7, username: 'char7', save_revision: 4 })

    const rows = history()
    expect(rows).toHaveLength(1)
    expect(rows[0].reason).toBe('manual')
    expect(rows[0].save_revision).toBe(4)
    // Same INSERT ... SELECT as the cadence: the stored gzip blob is copied
    // verbatim, not re-encoded.
    expect(rows[0].save_blob).not.toBeNull()
  })

  it('ignores the routine cadence — that is the entire point of the button', async () => {
    await seedCharacter()
    // A save write has just taken the routine snapshot, so the 6h window is
    // spent. The manual one must still land.
    const { saveObject, saveRevision } = await loadAnyCharacterWithSave(env, 7)
    saveObject.settings.touched = true
    await writeSave(env, 7, saveObject, saveRevision)
    expect(history().map((r: any) => r.reason)).toEqual(['routine'])

    await onRequestPost({ request: req({ character_id: 7 }), env } as any)
    expect(history().map((r: any) => r.reason)).toEqual(['routine', 'manual'])
  })

  it('takes a fresh snapshot every press', async () => {
    await seedCharacter()
    await onRequestPost({ request: req({ character_id: 7 }), env } as any)
    await onRequestPost({ request: req({ character_id: 7 }), env } as any)
    expect(history()).toHaveLength(2)
  })

  it('audits the press', async () => {
    await seedCharacter()
    await onRequestPost({ request: req({ character_id: 7, reason: 'before a grant' }), env } as any)
    const rows = raw.prepare(`SELECT payload_json FROM audit_events WHERE event_type = 'admin_save_snapshot'`).all()
    expect(rows).toHaveLength(1)
    expect(JSON.parse(rows[0].payload_json)).toMatchObject({ characterId: 7, saveRevision: 4, reason: 'before a grant' })
  })

  it('404s an unknown character', async () => {
    const res = await onRequestPost({ request: req({ character_id: 999 }), env } as any)
    expect(res.status).toBe(404)
  })

  it('refuses a character with no save row rather than writing an empty snapshot', async () => {
    raw.prepare(
      `INSERT INTO characters (id, owner_id, username, created_at, is_ironman, is_one_life, credits, total_pvp_kills, credits_used, total_level, combat_level, is_bot, total_level_at)
       VALUES (9, 1, 'fresh', 0, 0, 0, 0, 0, 0, 1, 3, 0, 0)`,
    ).run()
    const res = await onRequestPost({ request: req({ character_id: 9 }), env } as any)
    expect(res.status).toBe(409)
    expect((await res.json() as any).code).toBe('SAVE_NOT_FOUND')
    expect(history(9)).toHaveLength(0)
  })

  it('rejects a malformed character id', async () => {
    const res = await onRequestPost({ request: req({ character_id: 'abc' }), env } as any)
    expect(res.status).toBe(400)
  })

  it('snapshots a character whose save is locked by a live world session', async () => {
    await seedCharacter()
    raw.prepare(`INSERT INTO world_sessions (character_id, session_id, heartbeat_at, created_at) VALUES (7, 'w1', ?, ?)`)
      .run(NOW - 1_000, NOW)
    // Unlike the grant and restore endpoints, this only READS the stored row —
    // and mid-session is exactly when preserving it is worth something.
    const res = await onRequestPost({ request: req({ character_id: 7 }), env } as any)
    expect(res.status).toBe(200)
    expect(history()).toHaveLength(1)
  })
})
