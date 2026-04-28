import { requireAuth, json } from '../_lib/auth.js'
import { assertNotInActiveMatch } from '../_lib/pvp.js'
import itemsData from '../../src/data/items.json' assert { type: 'json' }

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  let body
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const characterId = parseInt(request.headers.get('X-Character-Id') || '0', 10)
  const { item_id, quantity } = body

  if (!characterId || !item_id || !quantity || quantity < 1) {
    return json({ error: 'Invalid request parameters' }, 400)
  }

  try {
    // Verify character exists and belongs to authenticated user
    const character = await env.DB.prepare(
      'SELECT id, username, is_ironman FROM characters WHERE id = ? AND owner_id = ? AND deleted_at IS NULL'
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
      return json({ error: 'Item not found' }, 404)
    }
    
    const isQuestItem = !!item.questUnlock
    
    // Prevent purchasing untradeable items
    if (item.isUntradeable && !isQuestItem) {
      return json({ error: 'This item cannot be purchased' }, 400)
    }

    // If character is ironman, enforce stricter item restrictions
    // Ironman can only purchase: general store items and quest items
    if (character.is_ironman) {
      const isGeneralStoreItem = item.isGeneralStore
      if (!isQuestItem && !isGeneralStoreItem) {
        return json({ error: 'This item is not available to Ironman characters', code: 'IRONMAN_RESTRICTED' }, 403)
      }
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
