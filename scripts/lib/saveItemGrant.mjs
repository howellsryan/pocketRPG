// Pure helpers behind `scripts/grant-save-item.mjs`. Kept free of I/O so
// tests/saveItemGrant.test.ts can cover the parts that can corrupt a live save:
// item resolution, the inventory insert, and SQL literal encoding.

export const INVENTORY_SLOTS = 28

/** Canonical id for a possibly-legacy item id (mirrors functions/_lib/game/inventory.js). */
export function canonicalItemId(itemsData, rawId) {
  if (typeof rawId !== 'string' || !rawId) return rawId
  const direct = itemsData?.[rawId]
  if (direct && typeof direct.id === 'string' && direct.id) return direct.id
  for (const entry of Object.values(itemsData || {})) {
    if (entry?.legacy_item_id === rawId && typeof entry.id === 'string') return entry.id
  }
  return rawId
}

function normalizeName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * Resolve a user-typed item reference to exactly one item.
 * Returns { item, itemId } on an unambiguous hit, otherwise
 * { error, candidates } so the caller can print choices and stop.
 */
export function resolveItem(itemsData, query) {
  const raw = String(query || '').trim()
  if (!raw) return { error: 'No item given.', candidates: [] }

  const canon = canonicalItemId(itemsData, raw)
  if (itemsData[canon]) return { itemId: canon, item: itemsData[canon], matchedBy: canon === raw ? 'id' : 'legacy id' }

  const wanted = normalizeName(raw)
  const byName = Object.values(itemsData).filter(it => normalizeName(it?.name) === wanted)
  if (byName.length === 1) return { itemId: byName[0].id, item: byName[0], matchedBy: 'exact name' }
  if (byName.length > 1) return { error: `'${raw}' matches ${byName.length} items by name.`, candidates: byName }

  const partial = Object.values(itemsData).filter(it =>
    normalizeName(it?.name).includes(wanted) || String(it?.id || '').includes(raw.toLowerCase()))
  if (partial.length === 1) return { itemId: partial[0].id, item: partial[0], matchedBy: 'partial name' }
  return {
    error: partial.length ? `'${raw}' is ambiguous.` : `No item matches '${raw}'.`,
    candidates: partial.slice(0, 20),
  }
}

/** Occupied-slot view of the save's inventory (mirrors getInventory server-side). */
export function readInventory(save) {
  if (!Array.isArray(save?.inventory)) return []
  return save.inventory
    .map((slot) => {
      if (!slot || typeof slot !== 'object') return null
      const itemId = typeof slot.itemId === 'string' && slot.itemId
        ? slot.itemId
        : (typeof slot.id === 'string' ? slot.id : null)
      const quantity = Math.floor(Number(slot.quantity) || 0)
      if (!itemId || quantity < 1) return null
      return { ...slot, itemId, quantity }
    })
    .filter(Boolean)
}

export function countInInventory(save, itemId) {
  return readInventory(save).reduce((n, s) => (s.itemId === itemId ? n + s.quantity : n), 0)
}

/**
 * Add `quantity` of `itemId` to the save's inventory in place, matching
 * addItemToInventory in functions/_lib/game/inventory.js: stackables merge onto
 * an existing slot of the same noted-ness, non-stackables take one slot each,
 * and the 28-slot cap is hard. Every other field of the save is left untouched.
 * Returns a summary; throws when the items would not fit.
 */
export function addItemToSaveInventory(save, itemId, quantity, { stackable = true, noted = false } = {}) {
  const qty = Math.floor(Number(quantity) || 0)
  if (qty < 1) throw new Error('Quantity must be at least 1.')

  const inv = readInventory(save)
  const before = inv.length
  let addedSlots = 0

  if (!stackable && !noted) {
    if (inv.length + qty > INVENTORY_SLOTS) {
      throw new Error(`Inventory full: ${qty} non-stackable item(s) need ${qty} free slots, ${INVENTORY_SLOTS - inv.length} available.`)
    }
    for (let i = 0; i < qty; i += 1) inv.push({ itemId, quantity: 1 })
    addedSlots = qty
  } else {
    const existing = inv.find(s => s.itemId === itemId && Boolean(s.noted) === Boolean(noted))
    if (existing) {
      existing.quantity += qty
    } else {
      if (inv.length >= INVENTORY_SLOTS) {
        throw new Error(`Inventory full: no free slot for a new ${noted ? 'noted ' : ''}stack.`)
      }
      inv.push(noted ? { itemId, quantity: qty, noted: true } : { itemId, quantity: qty })
      addedSlots = 1
    }
  }

  save.inventory = inv
  return { slotsBefore: before, slotsAfter: inv.length, addedSlots }
}

/** Uppercase hex for a SQLite X'…' blob literal. */
export function toHexLiteral(bytes) {
  return Buffer.from(bytes).toString('hex').toUpperCase()
}

/** SQL single-quoted string literal. Only `'` needs escaping in SQLite. */
export function toSqlTextLiteral(text) {
  return `'${String(text).replace(/'/g, "''")}'`
}

/**
 * The one UPDATE this tool issues. Guarded on save_revision so a save written
 * by the live client between our read and our write loses nothing — the update
 * matches zero rows and the caller aborts instead of clobbering it.
 */
export function buildUpdateSql({ characterId, expectedRevision, blobHex, saveJson, now }) {
  return `UPDATE saves SET save_blob = X'${blobHex}', save_data = ${toSqlTextLiteral(saveJson)}, updated_at = ${Number(now)}, save_revision = save_revision + 1 WHERE character_id = ${Number(characterId)} AND save_revision = ${Number(expectedRevision)};`
}
