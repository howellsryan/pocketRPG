// One-time legacy itemId rewrites for saves that predate item renames.
// Each entry maps an old itemId → the current itemId. Migrations run on
// load before idle simulation so the rest of the engine never sees a
// stale id.
import itemsData from '../data/items.json'

// Manual aliases that can't be expressed as a single `legacy_item_id` field
// — e.g. two old ids collapsing onto one new id (void had both a "knight"
// and a bare-"void" naming).
const MANUAL_LEGACY_ALIASES = {
  void_knight_helm: 'void_king_helm',
  void_knight_top: 'void_king_top',
  void_knight_robe: 'void_king_robe',
  void_knight_gloves: 'void_king_gloves',
  void_hat: 'void_king_helm',
  void_body: 'void_king_top',
  void_bottoms: 'void_king_robe',
  void_gloves: 'void_king_gloves',
}

// The redundant legacy-keyed duplicate items were removed from items.json;
// each surviving canonical entry records the id it replaced in
// `legacy_item_id`. Derive the full old→new map from that field so a save
// holding a pre-migration id (e.g. "rune_scimitar") is rewritten on load to
// the canonical id ("runeforged_scimitar") — the item table no longer carries
// an entry under the old key for a direct lookup.
function buildLegacyItemIdMap() {
  const map = {}
  for (const key of Object.keys(itemsData)) {
    const entry = itemsData[key]
    const legacy = entry && entry.legacy_item_id
    if (typeof legacy === 'string' && legacy && legacy !== entry.id) map[legacy] = entry.id
  }
  return { ...map, ...MANUAL_LEGACY_ALIASES }
}

const LEGACY_ITEM_ID_MAP = buildLegacyItemIdMap()

function rewriteEquipment(equipment) {
  if (!equipment) return { equipment, changed: false }
  let changed = false
  const next = { ...equipment }
  for (const slot of Object.keys(next)) {
    const entry = next[slot]
    const replacement = entry && LEGACY_ITEM_ID_MAP[entry.itemId]
    if (replacement) {
      next[slot] = { ...entry, itemId: replacement }
      changed = true
    }
  }
  return { equipment: changed ? next : equipment, changed }
}

function rewriteInventory(inventory) {
  if (!Array.isArray(inventory)) return { inventory, changed: false }
  let changed = false
  const next = inventory.slice()
  for (let i = 0; i < next.length; i++) {
    const slot = next[i]
    const replacement = slot && LEGACY_ITEM_ID_MAP[slot.itemId]
    if (replacement) {
      next[i] = { ...slot, itemId: replacement }
      changed = true
    }
  }
  return { inventory: changed ? next : inventory, changed }
}

function rewriteBank(bank) {
  if (!bank || typeof bank !== 'object') return { bank, changed: false }
  let changed = false
  const next = { ...bank }
  for (const oldId of Object.keys(LEGACY_ITEM_ID_MAP)) {
    if (!next[oldId]) continue
    const newId = LEGACY_ITEM_ID_MAP[oldId]
    const oldQty = next[oldId].quantity || 0
    const existingNew = next[newId]
    next[newId] = existingNew
      ? { ...existingNew, quantity: (existingNew.quantity || 0) + oldQty }
      : { ...next[oldId], itemId: newId }
    delete next[oldId]
    changed = true
  }
  return { bank: changed ? next : bank, changed }
}

/**
 * Rewrite legacy item ids in equipment, inventory, and bank in one pass.
 * Returns the migrated containers plus a `changed` flag indicating whether
 * the caller should persist the result back to storage.
 */
export function migrateLegacyItemIds({ equipment, inventory, bank }) {
  const eqResult = rewriteEquipment(equipment)
  const invResult = rewriteInventory(inventory)
  const bankResult = rewriteBank(bank)
  return {
    equipment: eqResult.equipment,
    inventory: invResult.inventory,
    bank: bankResult.bank,
    changed: eqResult.changed || invResult.changed || bankResult.changed,
  }
}

export { LEGACY_ITEM_ID_MAP }
