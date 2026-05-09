import { requireAuth, json } from '../_lib/auth.js'
import { assertNotInActiveMatch } from '../_lib/pvp.js'
import { decodeSaveRow } from '../_lib/saveCodec.js'
import itemsData from '../../src/data/items.json' assert { type: 'json' }
import { getPurchaseRestriction } from '../../src/engine/storeRules.js'


function hasUnlockedMinigameItem(saveDataJson, itemId, bodyUnlocked = []) {
  if (!itemId) return false
  if (Array.isArray(bodyUnlocked) && bodyUnlocked.includes(itemId)) return true
  if (!saveDataJson) return false
  try {
    const parsed = JSON.parse(saveDataJson)
    const unlocked = parsed?.settings?.unlockedMinigameItems
    return Array.isArray(unlocked) && unlocked.includes(itemId)
  } catch {
    return false
  }
}


export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  let body
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const characterId = parseInt(request.headers.get('X-Character-Id') || '0', 10)
  const { item_id, quantity, unlocked_minigame_items = [] } = body

  if (!characterId || !item_id || !quantity || quantity < 1) {
    return json({ error: 'Invalid request parameters' }, 400)
  }

  try {
    // Verify character exists and belongs to authenticated user
    const character = await env.DB.prepare(
      'SELECT c.id, c.username, c.is_ironman, s.save_blob, s.updated_at FROM characters c LEFT JOIN saves s ON s.character_id = c.id WHERE c.id = ? AND c.owner_id = ? AND c.deleted_at IS NULL'
    ).bind(characterId, auth.identity.id).first()

    if (!character) {
      return json({ error: 'Character not found' }, 404)
    }

    // PvP inventory lock: no purchases mid-match.
    const lock = await assertNotInActiveMatch(env, characterId)
    if (lock) return lock

    // Verify item exists and get its properties
    const item = itemsData[item_id]
    if (!item) {
      return json({ error: 'Item not found', code: 'ITEM_NOT_FOUND' }, 404)
    }

    const decodedSave = await decodeSaveRow(character)
    const restriction = getPurchaseRestriction(item, {
      isIronman: Boolean(character.is_ironman),
      allowMinigameUnlockPurchase: hasUnlockedMinigameItem(decodedSave?.save_blob, item_id, unlocked_minigame_items),
    })
    if (!restriction.allowed) {
      const status = restriction.code === 'ITEM_NOT_FOUND' ? 404 : 403
      return json({ error: restriction.message, code: restriction.code }, status)
    }

    // Purchase validation passed
    return json({
      success: true,
      message: 'Purchase validation passed',
      character_id: characterId,
      item_id,
      quantity,
    })
  } catch (err) {
    console.error('[PocketRPG] Purchase validation error:', err)
    return json({ error: 'Server error validating purchase' }, 500)
  }
}
