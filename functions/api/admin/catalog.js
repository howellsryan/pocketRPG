// GET /api/admin/catalog — the data the /admin portal's dropdowns need, and the
// portal's unlock check in one call: a 401 here is what keeps the seal shut, so
// the browser never holds the character list without a valid secret.
import { json } from '../../_lib/auth.js'
import { isAdminRequest } from '../../_lib/adminAuth.js'
import itemsData from '../../../src/data/items.json' assert { type: 'json' }

// Enough for every character the game has; the count comes back so the portal
// can say the list was truncated instead of silently hiding accounts.
const CHARACTER_LIMIT = 5000

// Built once per isolate — items.json is static, and the portal wants it sorted
// by display name rather than by id.
let itemCatalogCache = null
function itemCatalog() {
  if (itemCatalogCache) return itemCatalogCache
  itemCatalogCache = Object.keys(itemsData)
    .map((id) => {
      const item = itemsData[id]
      return { id, name: item?.name || id, type: item?.type || '', stackable: item?.stackable === true }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
  return itemCatalogCache
}

export async function onRequestGet({ request, env }) {
  if (!isAdminRequest(request, env)) return json({ error: 'unauthorized', code: 'UNAUTHORIZED' }, 401)

  // Bots are seeded by scripts and never hand-granted; deleted characters
  // cannot be written to at all (loadAnyCharacterWithSave filters them out), so
  // offering either in the dropdown would only produce failed grants.
  const rows = await env.DB.prepare(
    `SELECT c.id, c.username, c.total_level, c.combat_level, c.is_ironman, c.is_one_life, c.credits, s.save_revision
       FROM characters c
       LEFT JOIN saves s ON s.character_id = c.id
      WHERE c.deleted_at IS NULL AND c.is_bot = 0
      ORDER BY c.username COLLATE NOCASE
      LIMIT ?`,
  ).bind(CHARACTER_LIMIT).all()

  const characters = (rows.results || []).map((row) => ({
    id: Number(row.id),
    username: row.username,
    totalLevel: Number(row.total_level) || 0,
    combatLevel: Number(row.combat_level) || 0,
    isIronman: Boolean(row.is_ironman),
    isOneLife: Boolean(row.is_one_life),
    // Credits live on this row directly, unlike items — a credit grant needs
    // no save at all, so this is shown even for a character with none.
    credits: Number(row.credits) || 0,
    // A character that has never synced has no save to grant items into; the
    // portal greys the item-grant pane out rather than letting it fail at the
    // endpoint. Credit grants are unaffected.
    hasSave: row.save_revision !== null && row.save_revision !== undefined,
  }))

  return json(
    { ok: true, items: itemCatalog(), characters, truncated: characters.length >= CHARACTER_LIMIT },
    200,
    { 'Cache-Control': 'no-store' },
  )
}
