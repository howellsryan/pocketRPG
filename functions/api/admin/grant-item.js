// POST /api/admin/grant-item — grant any item, any quantity, to any character.
//
// The server-side twin of scripts/grant-save-item.mjs, and it keeps that
// script's guarantees: item ids are resolved against items.json, the three save
// locks (PvP / co-op / open world) refuse the write rather than race the owner
// of the save, and the write is guarded on the save_revision read in the same
// request so a concurrent player save can never be clobbered.
//
// Authorization is the ADMIN_SECRET only (functions/_lib/adminAuth.js) — a
// session JWT grants nothing here, however the account is flagged. The /admin
// portal is a front end for this endpoint and sends the same header.
import { json } from '../../_lib/auth.js'
import { isAdminRequest } from '../../_lib/adminAuth.js'
import { assertNotInCoopSession } from '../../_lib/game/coopBoss.js'
import { isWorldSessionLive } from '../../_lib/game/worldSessions.js'
import { loadAnyCharacterWithSave, writeSave } from '../../_lib/game/save.js'
import { addItemToInventory, addItemToBank, canonicalItemId, bankQuantity, getInventory } from '../../_lib/game/inventory.js'
import { toErrorResponse } from '../../_lib/game/errors.js'
import itemsData from '../../../src/data/items.json' assert { type: 'json' }

// Far above any legitimate grant, low enough that the resulting quantity stays
// an exact integer through the save's JSON round-trip.
const MAX_GRANT_QUANTITY = 1_000_000_000

function countInInventory(save, itemId) {
  return getInventory(save).reduce((n, slot) => (slot?.itemId === itemId ? n + (Number(slot.quantity) || 0) : n), 0)
}

export async function onRequestPost({ request, env }) {
  if (!isAdminRequest(request, env)) return json({ error: 'unauthorized', code: 'UNAUTHORIZED' }, 401)

  try {
    let body
    try {
      body = await request.json()
    } catch {
      return json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, 400)
    }

    const characterId = Math.floor(Number(body?.character_id) || 0)
    if (!Number.isInteger(characterId) || characterId <= 0) {
      return json({ error: 'character_id must be a positive integer', code: 'INVALID_CHARACTER_ID' }, 400)
    }

    const quantity = Math.floor(Number(body?.quantity ?? 1) || 0)
    if (quantity < 1 || quantity > MAX_GRANT_QUANTITY) {
      return json({ error: `quantity must be between 1 and ${MAX_GRANT_QUANTITY}`, code: 'INVALID_QUANTITY' }, 400)
    }

    const destination = body?.destination === undefined ? 'inventory' : String(body.destination)
    if (destination !== 'inventory' && destination !== 'bank') {
      return json({ error: 'destination must be "inventory" or "bank"', code: 'INVALID_DESTINATION' }, 400)
    }

    const requestedItemId = typeof body?.item_id === 'string' ? body.item_id.trim() : ''
    if (!requestedItemId) return json({ error: 'item_id is required', code: 'INVALID_ITEM_ID' }, 400)
    const itemId = canonicalItemId(itemsData, requestedItemId)
    // hasOwnProperty, not a truthiness check: items.json is a plain object, so
    // an item_id of "constructor" or "toString" would otherwise resolve to an
    // inherited Object.prototype member and grant a nonexistent item.
    if (!Object.prototype.hasOwnProperty.call(itemsData, itemId)) {
      return json({ error: `Unknown item "${requestedItemId}"`, code: 'ITEM_NOT_FOUND' }, 404)
    }
    const item = itemsData[itemId]

    const noted = Boolean(body?.noted)
    const dryRun = Boolean(body?.dry_run)

    // Every path that owns this save refuses the grant rather than racing it:
    // the owner replays its own snapshot on write-back, so a write underneath
    // one is either lost or duplicated (§14, §20).
    const coopLock = await assertNotInCoopSession(env, characterId)
    if (coopLock) return coopLock
    if (await isWorldSessionLive(env, characterId)) {
      return json({ error: 'character_in_world_session', code: 'CHARACTER_IN_WORLD_SESSION' }, 409)
    }

    const { row, saveObject, saveRevision } = await loadAnyCharacterWithSave(env, characterId)
    // A character with no save row has never synced. Writing one here would
    // invent a save out of an empty object and hand the player a blank
    // character carrying the grant — refuse instead, as the script does.
    if (!row.save_blob && !row.save_data) {
      return json({ error: 'Character has no save yet', code: 'SAVE_NOT_FOUND' }, 409)
    }

    const before = destination === 'bank' ? bankQuantity(saveObject, itemId) : countInInventory(saveObject, itemId)
    const stackable = item.stackable === true

    if (destination === 'bank') {
      addItemToBank(saveObject, itemId, quantity)
    } else {
      // Deliberately literal, unlike /api/purchase's noted-on-multibuy
      // heuristic: an admin asking for 5 non-stackable copies gets 5 slots and
      // an INVENTORY_FULL refusal if they do not fit. Pass noted:true, or
      // destination:"bank", for a quantity the pack cannot hold.
      addItemToInventory(saveObject, itemId, quantity, { stackable, noted })
    }

    const after = destination === 'bank' ? bankQuantity(saveObject, itemId) : countInInventory(saveObject, itemId)

    if (dryRun) {
      return json({
        ok: true,
        dry_run: true,
        character_id: characterId,
        username: row.username,
        item_id: itemId,
        item_name: item.name,
        quantity,
        destination,
        before,
        after,
        save_revision: saveRevision,
      })
    }

    // The audit row commits in the same batch as the save write: an admin grant
    // that lands without a record is the one outcome this endpoint must not
    // have. No identityId — the admin secret is not an account, and stamping the
    // character's OWNER into the actor column would read as the player having
    // granted it to themselves.
    const write = await writeSave(env, characterId, saveObject, saveRevision, {
      auditEvent: {
        eventType: 'admin_item_grant',
        identityId: null,
        payload: {
          characterId,
          ownerId: row.owner_id,
          itemId,
          requestedItemId,
          quantity,
          destination,
          noted,
          before,
          after,
          reason: typeof body?.reason === 'string' ? body.reason.slice(0, 200) : null,
        },
      },
    })

    return json({
      ok: true,
      character_id: characterId,
      username: row.username,
      item_id: itemId,
      item_name: item.name,
      quantity,
      destination,
      before,
      after,
      updatedAt: write.updatedAt,
      save_revision: write.saveRevision,
    })
  } catch (err) {
    const mapped = toErrorResponse(err)
    return json(mapped.body, mapped.status)
  }
}
