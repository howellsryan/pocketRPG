// GET /api/admin/item-loss — the Incidents panel's read side. The detector
// rejects nothing, so its audit rows are only worth writing if they can be
// acted on; what makes an incident actionable is the link to the snapshot
// holding the state from just before the loss.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { makeD1 } from './helpers/d1'
import { gzipJsonString } from '../functions/_lib/saveCodec.js'

import { onRequestGet } from '../functions/api/admin/item-loss.js'
import { shapeItemLossIncidents, summariseIncidents, clampIncidentLimit } from '../functions/_lib/game/itemLossReport.js'
import { loadAnyCharacterWithSave, writeSave } from '../functions/_lib/game/save.js'
import { onRequestPost as restoreSave } from '../functions/api/admin/restore-save.js'

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

async function seedCharacter(id = 7) {
  raw.prepare(
    `INSERT INTO characters (id, owner_id, username, created_at, is_ironman, is_one_life, credits, total_pvp_kills, credits_used, total_level, combat_level, is_bot, total_level_at)
     VALUES (?, 1, ?, 0, 0, 0, 0, 0, 0, 1, 3, 0, 0)`,
  ).run(id, 'char' + id)
  const bank: Record<string, unknown> = {}
  for (const itemId of DURABLES) bank[itemId] = { itemId, quantity: 1 }
  const save = JSON.stringify({ stats: {}, inventory: [], equipment: {}, settings: {}, bank })
  raw.prepare('INSERT INTO saves (character_id, save_blob, save_data, updated_at, save_revision) VALUES (?, ?, ?, 0, 4)')
    .run(id, await gzipJsonString(save), save)
}

/** Destroys the bank through the real writer, so the audit row and the forced
 * snapshot are produced exactly as production produces them. */
async function causeLoss(characterId: number) {
  const { saveObject, saveRevision } = await loadAnyCharacterWithSave(env, characterId)
  saveObject.bank = {}
  await writeSave(env, characterId, saveObject, saveRevision)
}

async function refillBank(characterId: number) {
  const { saveObject, saveRevision } = await loadAnyCharacterWithSave(env, characterId)
  saveObject.bank = Object.fromEntries(DURABLES.map((id) => [id, { itemId: id, quantity: 1 }]))
  await writeSave(env, characterId, saveObject, saveRevision)
}

function getReq(query = '', { secret = SECRET as string | null } = {}) {
  const headers: Record<string, string> = {}
  if (secret !== null) headers['X-Admin-Secret'] = secret
  return new Request('https://x/api/admin/item-loss?' + query, { headers })
}

async function fetchIncidents(query = '') {
  const res = await onRequestGet({ request: getReq(query), env } as any)
  return { status: res.status, body: await res.json() as any }
}

beforeEach(() => {
  const made = makeD1()
  raw = made.raw
  env = { DB: made.DB, ADMIN_SECRET: SECRET }
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
})

describe('GET /api/admin/item-loss', () => {
  it('refuses without the admin secret', async () => {
    const res = await onRequestGet({ request: getReq('', { secret: null }), env } as any)
    expect(res.status).toBe(401)
  })

  it('returns an empty list rather than an error when nothing has been caught', async () => {
    const { status, body } = await fetchIncidents()
    expect(status).toBe(200)
    expect(body.incidents).toEqual([])
    expect(body.summary).toMatchObject({ incidents: 0, characters: 0, unresolved: 0 })
  })

  it('reports everything an investigation needs about a loss', async () => {
    await seedCharacter(7)
    await causeLoss(7)

    const { body } = await fetchIncidents()
    expect(body.incidents).toHaveLength(1)
    const incident = body.incidents[0]
    expect(incident).toMatchObject({
      character_id: 7,
      username: 'char7',
      owner_id: 1,
      source: 'write_save',
      previous_revision: 4,
      next_revision: 5,
      durable_units: DURABLES.length,
      restored_since: false,
      character_incident_count: 1,
    })
    expect(incident.reasons).toContain('durable_items')
    expect(incident.durable_value).toBeGreaterThan(0)
    expect(incident.items.length).toBeGreaterThan(0)
    expect(incident.items[0]).toHaveProperty('itemId')
  })

  it('links each incident to the snapshot that can undo it', async () => {
    await seedCharacter(7)
    await causeLoss(7)

    const { body } = await fetchIncidents()
    const incident = body.incidents[0]
    // The forced snapshot preserves the revision being REPLACED, so the link is
    // save_revision === previousRevision.
    const snapshot = raw.prepare(`SELECT id, save_revision FROM save_history WHERE reason = 'item_loss'`).get()
    expect(incident.history_id).toBe(snapshot.id)
    expect(snapshot.save_revision).toBe(incident.previous_revision)

    // And that link is enough on its own to put the bank back.
    const res = await restoreSave({
      request: new Request('https://x/api/admin/restore-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': SECRET },
        body: JSON.stringify({ character_id: 7, history_id: incident.history_id }),
      }),
      env,
    } as any)
    expect(res.status).toBe(200)
    const restored = JSON.parse(raw.prepare('SELECT save_data FROM saves WHERE character_id = 7').get().save_data)
    expect(Object.keys(restored.bank)).toHaveLength(DURABLES.length)
  })

  it('marks an incident as restored once a restore has run for that character', async () => {
    await seedCharacter(7)
    await causeLoss(7)
    const first = await fetchIncidents()
    expect(first.body.incidents[0].restored_since).toBe(false)
    expect(first.body.summary.unresolved).toBe(1)

    await restoreSave({
      request: new Request('https://x/api/admin/restore-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': SECRET },
        body: JSON.stringify({ character_id: 7, history_id: first.body.incidents[0].history_id }),
      }),
      env,
    } as any)

    const after = await fetchIncidents()
    // The restore is itself flagged (it discards what was gained since), so the
    // original incident is now one of several — but it is no longer outstanding.
    const original = after.body.incidents.find((i: any) => i.id === first.body.incidents[0].id)
    expect(original.restored_since).toBe(true)
  })

  it('counts incidents per account so one bad client is distinguishable from one bad player', async () => {
    await seedCharacter(7)
    await seedCharacter(8)
    await causeLoss(7)
    // Put the bank back through the real writer (a gain, so it flags nothing),
    // then lose it again six minutes on so the second incident earns its own
    // snapshot rather than sharing the first one.
    await refillBank(7)
    vi.spyOn(Date, 'now').mockReturnValue(NOW + 6 * 60 * 1000)
    await causeLoss(7)
    await causeLoss(8)

    const { body } = await fetchIncidents()
    expect(body.summary.incidents).toBe(3)
    expect(body.summary.characters).toBe(2)
    for (const incident of body.incidents) {
      expect(incident.character_incident_count).toBe(incident.character_id === 7 ? 2 : 1)
    }
  })

  it('filters to one character', async () => {
    await seedCharacter(7)
    await seedCharacter(8)
    await causeLoss(7)
    await causeLoss(8)

    const { body } = await fetchIncidents('character_id=8')
    expect(body.incidents).toHaveLength(1)
    expect(body.incidents[0].character_id).toBe(8)
  })

  it('rejects a malformed character filter', async () => {
    const { status } = await fetchIncidents('character_id=abc')
    expect(status).toBe(400)
  })
})

describe('shapeItemLossIncidents', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 1,
    character_id: 7,
    created_at: NOW,
    username: 'hero',
    owner_id: 3,
    payload_json: JSON.stringify({
      source: 'api_save',
      reasons: ['durable_items'],
      previousRevision: 40,
      nextRevision: 41,
      durableUnits: 12,
      durableValue: 900_000,
      resourceUnits: 5,
      resourceValue: 20,
      coinsLost: 7,
      chargesLost: 2,
      distinctItemsLost: 12,
      items: [{ itemId: 'nether_demon_whip', lost: 1, value: 1_214_445 }],
    }),
    ...over,
  })

  it('matches the snapshot on the revision the write replaced', () => {
    const [incident] = shapeItemLossIncidents({
      rows: [row()],
      snapshots: [
        { id: 99, character_id: 7, save_revision: 40, created_at: NOW - 10 },
        // Same revision, different character — must not cross over.
        { id: 98, character_id: 8, save_revision: 40, created_at: NOW - 10 },
      ],
    })
    expect(incident.history_id).toBe(99)
    expect(incident.previous_revision).toBe(40)
  })

  it('reports no snapshot rather than guessing at a neighbouring one', () => {
    // The forced snapshot is rate-limited to one per 5 minutes, so a burst of
    // incidents shares one and the later ones have no row of their own.
    const [incident] = shapeItemLossIncidents({
      rows: [row()],
      snapshots: [{ id: 99, character_id: 7, save_revision: 37, created_at: NOW - 10 }],
    })
    expect(incident.history_id).toBeNull()
  })

  it('only counts a restore that happened after the incident', () => {
    const before = shapeItemLossIncidents({
      rows: [row()],
      restores: [{ character_id: 7, restored_at: NOW - 1 }],
    })
    expect(before[0].restored_since).toBe(false)

    const after = shapeItemLossIncidents({
      rows: [row()],
      restores: [{ character_id: 7, restored_at: NOW + 1 }],
    })
    expect(after[0].restored_since).toBe(true)
  })

  it('survives an unparseable payload instead of dropping the row', () => {
    const [incident] = shapeItemLossIncidents({ rows: [row({ payload_json: 'not json' })] })
    expect(incident.character_id).toBe(7)
    expect(incident.durable_units).toBe(0)
    expect(incident.items).toEqual([])
    expect(incident.history_id).toBeNull()
  })

  it('summarises the queue', () => {
    const incidents = shapeItemLossIncidents({
      rows: [row(), row({ id: 2, character_id: 8 })],
      restores: [{ character_id: 8, restored_at: NOW + 1 }],
    })
    expect(summariseIncidents(incidents)).toMatchObject({
      incidents: 2,
      characters: 2,
      unresolved: 1,
      durableUnits: 24,
      durableValue: 1_800_000,
    })
  })
})

describe('clampIncidentLimit', () => {
  it('defaults and caps', () => {
    expect(clampIncidentLimit(null)).toBe(50)
    expect(clampIncidentLimit('0')).toBe(50)
    expect(clampIncidentLimit('abc')).toBe(50)
    expect(clampIncidentLimit('10')).toBe(10)
    expect(clampIncidentLimit('9999')).toBe(200)
  })
})
