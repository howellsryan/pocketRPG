// /api/save's half of the item-loss safety net, against the real migrations
// schema. The point of these is that the endpoint is SHADOW MODE: it must
// preserve and audit a catastrophic loss while still letting the write land,
// because rejecting one needs the Phase 3 loss ledger to tell a bug from a
// legitimate bulk consume.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { makeD1 } from './helpers/d1'
import { gzipJsonString } from '../functions/_lib/saveCodec.js'
import { shouldPruneSaveHistory } from '../functions/_lib/game/saveHistory.js'

vi.mock('../functions/_lib/auth.js', () => ({
  requireAuth: async () => ({ identity: { id: 1 } }),
  json: (body: any, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
}))

import { onRequestPut } from '../functions/api/save.js'

const NOW = 1_760_000_000_000
const DURABLES = [
  'runeforged_platebody', 'runeforged_platelegs', 'runeforged_full_helm', 'runeforged_kiteshield',
  'runeforged_scimitar', 'dragon_dagger', 'dragon_scimitar', 'nether_demon_whip',
  'bronze_platebody', 'iron_platebody', 'steel_platebody', 'mithril_platebody',
  'adamant_platebody', 'leather_body', 'studded_body', 'dragon_boots',
]

let raw: any
let env: any

function saveWith(bank: Record<string, unknown>) {
  return { version: 1, timestamp: 1111, stats: { attack: { xp: 0 } }, inventory: [], equipment: {}, settings: {}, bank }
}

function bankOf(ids: string[]) {
  const bank: Record<string, { itemId: string; quantity: number }> = {}
  for (const id of ids) bank[id] = { itemId: id, quantity: 1 }
  return bank
}

async function seed(bank: Record<string, unknown>) {
  raw.prepare(
    `INSERT INTO characters (id, owner_id, username, created_at, is_ironman, is_one_life, credits, total_pvp_kills, credits_used, total_level, combat_level, is_bot, total_level_at)
     VALUES (42, 1, 'hero', 0, 0, 0, 0, 0, 0, 1, 3, 0, 0)`,
  ).run()
  const save = JSON.stringify(saveWith(bank))
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

const history = () => raw.prepare('SELECT id, save_revision, reason FROM save_history WHERE character_id = 42 ORDER BY id').all()
const audits = () => raw.prepare(`SELECT payload_json FROM audit_events WHERE event_type = 'item_loss_detected'`).all()
const storedBank = () => JSON.parse(raw.prepare('SELECT save_data FROM saves WHERE character_id = 42').get().save_data).bank

beforeEach(() => {
  const made = makeD1()
  raw = made.raw
  env = { DB: made.DB }
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  vi.spyOn(Math, 'random').mockReturnValue(0.99) // no sweep, no prune
})

describe('PUT /api/save item-loss shadow mode', () => {
  it('lets half a bank vanish, but preserves the blob and audits it', async () => {
    await seed(bankOf(DURABLES))

    // Half the bank — under detectBankWipe's 90% floor, so the old guard does
    // not fire. This is the incident shape that motivated the whole feature.
    const survivors = DURABLES.slice(0, 8)
    const res = await onRequestPut({
      request: put({ save_data: JSON.stringify(saveWith(bankOf(survivors))), save_revision: 7 }),
      env,
    } as any)

    // Shadow mode: the write LANDS. Rejecting needs the Phase 3 ledger.
    expect(res.status).toBe(200)
    expect(Object.keys(storedBank())).toHaveLength(8)

    const rows = history()
    expect(rows.map((r: any) => r.reason).sort()).toEqual(['item_loss', 'routine'])
    // The snapshot holds the pre-write revision — the state being replaced.
    expect(rows[0].save_revision).toBe(7)

    const payload = JSON.parse(audits()[0].payload_json)
    expect(payload.source).toBe('api_save')
    expect(payload.durableUnits).toBe(8)
    expect(payload.previousRevision).toBe(7)
    expect(payload.nextRevision).toBe(8)
  })

  it('still lets the old bank-wipe guard refuse a total wipe', async () => {
    await seed(bankOf(DURABLES))
    const res = await onRequestPut({
      request: put({ save_data: JSON.stringify(saveWith({})), save_revision: 7 }),
      env,
    } as any)
    expect(res.status).toBe(409)
    expect((await res.json() as any).code).toBe('BANK_WIPE_REJECTED')
    expect(history()).toHaveLength(0)
  })

  it('snapshots but does not flag an ordinary save', async () => {
    await seed(bankOf(['bronze_dagger']))

    await onRequestPut({
      request: put({ save_data: JSON.stringify(saveWith(bankOf(['bronze_dagger', 'iron_dagger']))), save_revision: 7 }),
      env,
    } as any)

    expect(history().map((r: any) => r.reason)).toEqual(['routine'])
    expect(audits()).toHaveLength(0)
  })

  it('writes no snapshot for a no-op save', async () => {
    await seed(bankOf(DURABLES))
    const unchanged = JSON.stringify(saveWith(bankOf(DURABLES)))

    const res = await onRequestPut({ request: put({ save_data: unchanged, save_revision: 7 }), env } as any)
    expect((await res.json() as any).noop).toBe(true)
    // A content-identical save destroys nothing, so it must not pay for the
    // detection or spend a history row.
    expect(history()).toHaveLength(0)
  })

  it('writes no snapshot when a guard refuses the write', async () => {
    await seed(bankOf(DURABLES))
    // Total level drops → the regression guard rejects before anything is
    // written; preserving a blob for a write that never happened is noise.
    const regressed = { ...saveWith({}), stats: {} }
    const res = await onRequestPut({ request: put({ save_data: JSON.stringify(regressed), save_revision: 7 }), env } as any)
    expect(res.status).toBe(409)
    expect(history()).toHaveLength(0)
  })
})

describe('shouldPruneSaveHistory', () => {
  it('gates the prune to a small fraction of saves', () => {
    expect(shouldPruneSaveHistory(() => 0.01)).toBe(true)
    expect(shouldPruneSaveHistory(() => 0.5)).toBe(false)
  })
})
