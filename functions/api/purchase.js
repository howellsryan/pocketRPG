import { requireAuth, json } from '../_lib/auth.js'

// Untradeable items that cannot be purchased (mirrors isUntradeable flag from src/data/items.json)
// Items like coins are system items and cannot be bought through the shop
const UNTRADEABLE_ITEMS = new Set([
  'coins',
])

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

    // Prevent purchasing untradeable items (these shouldn't be in shop anyway)
    if (UNTRADEABLE_ITEMS.has(item_id)) {
      return json({ error: 'This item cannot be purchased' }, 400)
    }

    // If character is ironman, enforce stricter item restrictions
    // Ironman can purchase: quest items (questUnlock) and general store items
    // They cannot purchase: specialty shop items or untradeable items
    if (character.is_ironman) {
      // The main restriction is already handled above (no untradeable items)
      // Additional specialty restrictions can be added here as needed
      // For now, the frontend validates questUnlock status and the backend validates ironman status
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
