import { requireAuth, json } from '../_lib/auth.js'

// List of items that cannot be purchased (mirrors isUntradeable flag from items.json)
// These are system items that players shouldn't be able to buy
const UNTRADEABLE_ITEMS = new Set([
  'coins', // Currency, not tradeable
])

// Known item IDs for validation — prevents completely made-up items
// This is a simple list; a full validation would use the complete items.json
const KNOWN_ITEMS = new Set([
  // Weapons
  'bronze_dagger', 'bronze_scimitar', 'bronze_battleaxe', 'bronze_longsword',
  'iron_dagger', 'iron_scimitar', 'iron_battleaxe', 'iron_longsword',
  'steel_dagger', 'steel_scimitar', 'steel_battleaxe', 'steel_longsword',
  'mithril_dagger', 'mithril_scimitar', 'mithril_battleaxe', 'mithril_longsword',
  'adamant_dagger', 'adamant_scimitar', 'adamant_battleaxe', 'adamant_longsword',
  'rune_dagger', 'rune_scimitar', 'rune_battleaxe', 'rune_longsword',
  'dragon_dagger', 'dragon_scimitar', 'dragon_spear', 'dragon_longsword',
  'abyssal_whip', 'saradomin_sword', 'zamorak_spear', 'bandos_godsword',
  'armadyl_godsword', 'saradomin_godsword', 'zamorak_godsword',
  'magic_shortbow', 'armadyl_crossbow',
  // Armor
  'bronze_full_helm', 'bronze_platebody', 'bronze_platelegs', 'bronze_kiteshield',
  'iron_full_helm', 'iron_platebody', 'iron_platelegs', 'iron_kiteshield',
  'steel_full_helm', 'steel_platebody', 'steel_platelegs', 'steel_kiteshield',
  'mithril_full_helm', 'mithril_platebody', 'mithril_platelegs', 'mithril_kiteshield',
  'adamant_full_helm', 'adamant_platebody', 'adamant_platelegs', 'adamant_kiteshield',
  'rune_full_helm', 'rune_platebody', 'rune_platelegs', 'rune_kiteshield',
  'barrows_gloves', 'climbing_boots', 'anti_dragon_shield',
  'black_wizard_hat', 'black_wizard_robe',
  // Food
  'shrimp', 'cooked_meat', 'salmon', 'tuna', 'lobster', 'swordfish', 'monkfish',
  // Resources
  'bones', 'big_bones', 'dragon_bones', 'feathers', 'cowhide', 'green_dragonhide',
  'copper_ore', 'tin_ore', 'iron_ore', 'coal', 'mithril_ore', 'adamant_ore', 'rune_ore',
  'copper_bar', 'bronze_bar', 'iron_bar', 'steel_bar', 'mithril_bar', 'adamant_bar', 'rune_bar',
  'log', 'oak_log', 'willow_log', 'maple_log', 'yew_log', 'magic_log',
  'raw_shrimp', 'raw_chicken', 'raw_meat', 'raw_salmon', 'raw_tuna', 'raw_lobster',
  'wool', 'thread',
  // Runes
  'air_rune', 'water_rune', 'earth_rune', 'fire_rune', 'mind_rune', 'body_rune',
  'cosmic_rune', 'chaos_rune', 'nature_rune', 'law_rune', 'death_rune',
  'blood_rune', 'soul_rune',
  // Quest items
  'avas_accumulator', 'avas_assembler', 'halo', 'crystal_bow', 'crystal_shield',
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

    // Verify item exists and is purchasable
    if (!KNOWN_ITEMS.has(item_id)) {
      return json({ error: 'Item not found or cannot be purchased' }, 404)
    }

    // Untradeable items (like coins) cannot be purchased
    if (UNTRADEABLE_ITEMS.has(item_id)) {
      return json({ error: 'This item cannot be purchased' }, 400)
    }

    // If character is ironman, enforce stricter item restrictions
    if (character.is_ironman) {
      // Ironman can only buy general store items (not specialty shop items)
      // Specialty/restricted items that ironman cannot buy:
      const IRONMAN_RESTRICTED = new Set([
        // Add specialty shop items here as needed
        // For now, the main restriction is already handled: no isUntradeable items
      ])

      if (IRONMAN_RESTRICTED.has(item_id)) {
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
