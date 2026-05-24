import { requireAuth, json } from '../_lib/auth.js'
import { isValidEntry, TOTAL_ENTRIES } from '../_lib/collectionLog.js'
import { decodeSaveRow } from '../_lib/saveCodec.js'

const MAX_ENTRIES_PER_REQUEST = 64

// Returns the set of every itemId the character currently holds in any
// inventory slot, bank entry, or equipment slot. Used as proof-of-obtain
// for POST /api/collection-log: an entry is only accepted if the player
// currently owns the item being claimed. This blocks pure self-attested
// spoofing without breaking the legitimate idle flow (a player who
// genuinely earned a clue/minigame drop has it in their save by the time
// the client batches the POST).
export function collectOwnedItemIds(saveJson) {
  const ids = new Set()
  if (!saveJson) return ids
  let save
  try { save = JSON.parse(saveJson) } catch { return ids }
  for (const slot of (save?.inventory || [])) {
    const itemId = slot?.itemId ?? slot?.id
    if (typeof itemId === 'string' && itemId) ids.add(itemId)
  }
  const bank = save?.bank && typeof save.bank === 'object' ? save.bank : {}
  for (const [bankKey, entry] of Object.entries(bank)) {
    if (entry == null) continue
    const itemId = typeof entry === 'object' ? (entry.itemId || entry.id || bankKey) : bankKey
    if (typeof itemId === 'string' && itemId) ids.add(itemId)
  }
  const equipment = save?.equipment && typeof save.equipment === 'object' ? save.equipment : {}
  for (const equipped of Object.values(equipment)) {
    if (!equipped) continue
    const itemId = equipped.itemId ?? equipped.id
    if (typeof itemId === 'string' && itemId) ids.add(itemId)
  }
  return ids
}

// Partitions a batch of client-submitted log entries into accepted /
// rejected lists. Each entry must (a) have all three fields populated,
// (b) match the canonical valid-source map, and (c) reference an item
// the player currently owns. The handler reuses this; tests exercise it
// directly to avoid spinning up the full Worker context.
export function partitionCollectionLogEntries(incoming, ownedIds, { isValidEntry: isValid = isValidEntry } = {}) {
  const accepted = []
  const rejected = []
  for (const e of incoming) {
    const itemId     = typeof e?.itemId     === 'string' ? e.itemId     : null
    const sourceType = typeof e?.sourceType === 'string' ? e.sourceType : null
    const sourceId   = typeof e?.sourceId   === 'string' ? e.sourceId   : null
    if (!itemId || !sourceType || !sourceId) {
      rejected.push({ ...e, reason: 'malformed' })
      continue
    }
    if (!isValid(sourceType, sourceId, itemId)) {
      rejected.push({ itemId, sourceType, sourceId, reason: 'invalid_source' })
      continue
    }
    if (!ownedIds.has(itemId)) {
      rejected.push({ itemId, sourceType, sourceId, reason: 'not_owned' })
      continue
    }
    accepted.push({ itemId, sourceType, sourceId })
  }
  return { accepted, rejected }
}

async function getCharacterId(request, env, identityId) {
  const url = new URL(request.url)
  const headerId = request.headers.get('X-Character-Id')
  const queryId = url.searchParams.get('character_id')
  const idStr = headerId || queryId
  if (!idStr) return { error: 'Missing X-Character-Id header', status: 400 }
  const id = parseInt(idStr, 10)
  if (!Number.isFinite(id)) return { error: 'Invalid character id', status: 400 }
  const row = await env.DB.prepare(
    'SELECT id FROM characters WHERE id = ? AND owner_id = ? AND deleted_at IS NULL'
  ).bind(id, identityId).first()
  if (!row) return { error: 'Character not found', status: 404 }
  return { id }
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getCharacterId(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  const result = await env.DB.prepare(
    `SELECT item_id, source_type, source_id, obtained_at
       FROM collection_log
      WHERE character_id = ?`
  ).bind(ch.id).all()

  const entries = (result.results || []).map(r => ({
    itemId: r.item_id,
    sourceType: r.source_type,
    sourceId: r.source_id,
    obtainedAt: r.obtained_at,
  }))

  return json({ entries, total: TOTAL_ENTRIES })
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getCharacterId(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  let body
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const incoming = Array.isArray(body?.entries) ? body.entries : null
  if (!incoming) return json({ error: 'Missing entries[]' }, 400)
  if (incoming.length === 0) return json({ ok: true, accepted: 0, rejected: 0 })
  if (incoming.length > MAX_ENTRIES_PER_REQUEST) return json({ error: 'Too many entries' }, 413)

  // Pull the player's current save so we can confirm ownership of each
  // claimed item. Without proof-of-obtain this endpoint is a backdoor for
  // self-attesting collection-log completion; see security audit
  // 2026-05-21.
  const saveRow = await env.DB.prepare(
    'SELECT save_data, save_blob, updated_at FROM saves WHERE character_id = ?'
  ).bind(ch.id).first()
  let ownedIds = new Set()
  if (saveRow) {
    try {
      const decoded = await decodeSaveRow(saveRow)
      ownedIds = collectOwnedItemIds(decoded?.save_data || saveRow.save_data || null)
    } catch {
      ownedIds = collectOwnedItemIds(saveRow.save_data || null)
    }
  }

  const now = Date.now()
  const { accepted, rejected } = partitionCollectionLogEntries(incoming, ownedIds)

  if (accepted.length > 0) {
    const stmts = accepted.map(e => env.DB.prepare(
      `INSERT INTO collection_log (character_id, item_id, source_type, source_id, obtained_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(character_id, item_id, source_type, source_id) DO NOTHING`
    ).bind(ch.id, e.itemId, e.sourceType, e.sourceId, now))
    await env.DB.batch(stmts)
  }

  return json({ ok: true, accepted: accepted.length, rejected: rejected.length, rejectedDetail: rejected })
}
