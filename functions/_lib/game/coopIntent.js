// Shape-checking for a co-op action, shared by both ways one reaches a room.
//
// This lived in functions/api/coop/session/[id]/intent.js while HTTP was the
// only transport. A socket frame goes straight from the browser to the Durable
// Object, so an edge-only validator is no validator at all: chat would reach
// other players unsanitised, and toggle_prayer would arrive without the slot
// the room resolves from the prayer's own data (§20 — a protection prayer filed
// as an offensive one blocks nothing AND cancels the offensive prayer).
//
// Returns a NORMALISED action, so extra fields a client invents never reach the
// engine. Every new action type needs a case here or it is refused as unknown.

import { sanitizeChat } from '../../../src/engine/playerChat.js'
import prayersData from '../../../src/data/prayers.json' assert { type: 'json' }
import spellsData from '../../../src/data/spells.json' assert { type: 'json' }

const VALID_STANCES = new Set(['accurate', 'aggressive', 'controlled', 'defensive', 'rapid', 'longrange'])

export function validateCoopAction(action) {
  if (!action || typeof action !== 'object') return { error: 'invalid_action' }
  switch (action.type) {
    case 'start_raid':
      // No payload — the room decides whether this member is the host and
      // whether there is a lobby to end.
      return { action: { type: 'start_raid' } }
    case 'sunspire_choose_modifier':
      if (typeof action.modifierId !== 'string' || !action.modifierId) return { error: 'invalid_modifier' }
      return { action: { type: 'sunspire_choose_modifier', modifierId: action.modifierId } }
    case 'sunspire_claim':
      return { action: { type: 'sunspire_claim' } }
    case 'set_ready':
      // Lobby readiness. The room decides whether there is a lobby to be ready
      // in; the edge only fixes the shape.
      return { action: { type: 'set_ready', value: !!action.value } }
    case 'change_stance':
      if (!VALID_STANCES.has(action.stance)) return { error: 'invalid_stance' }
      return { action: { type: 'change_stance', stance: action.stance } }
    case 'change_combat_spell':
      if (action.spellId != null && !spellsData?.[action.spellId]) return { error: 'invalid_spell' }
      return { action: { type: 'change_combat_spell', spellId: action.spellId ?? null } }
    case 'queue_special':
      return { action: { type: 'queue_special' } }
    case 'combat_reaction': {
      const reaction = action.reaction
      if (!reaction || typeof reaction !== 'object') return { error: 'invalid_reaction' }
      const attackId = typeof reaction.attackId === 'string' && reaction.attackId.length <= 64 ? reaction.attackId : null
      const type = ['guard', 'prayer', 'parry', 'prayer_sequence'].includes(reaction.type) ? reaction.type : null
      if (!attackId || !type) return { error: 'invalid_reaction' }
      const clean = { attackId, type }
      if (type === 'prayer') {
        if (!['melee', 'ranged', 'magic'].includes(reaction.style)) return { error: 'invalid_reaction' }
        clean.style = reaction.style
      } else if (type === 'parry') {
        if (!['body', 'weapon', 'cape', 'shield'].includes(reaction.slot)) return { error: 'invalid_reaction' }
        clean.slot = reaction.slot
      } else if (type === 'prayer_sequence') {
        if (!Array.isArray(reaction.prayers) || reaction.prayers.length !== 3 || reaction.prayers.some((p) => !['melee', 'ranged', 'magic'].includes(p))) {
          return { error: 'invalid_reaction' }
        }
        clean.prayers = [...reaction.prayers]
      }
      return { action: { type: 'combat_reaction', reaction: clean } }
    }
    case 'set_quick_prayers': {
      if (!Array.isArray(action.prayerIds)) return { error: 'invalid_prayer' }
      // Deduped and filtered to real prayers, which also bounds the list: the
      // room carries it until write-back, so it must not be a free text field.
      const prayerIds = [...new Set(action.prayerIds)].filter((id) => typeof id === 'string' && prayersData?.[id])
      if (prayerIds.length !== new Set(action.prayerIds).size) return { error: 'invalid_prayer' }
      return { action: { type: 'set_quick_prayers', prayerIds } }
    }
    case 'target_add': {
      // An add INDEX, or false for the boss. A boss may field several at once,
      // so a bare boolean can no longer say which one.
      const index = Math.floor(Number(action.value))
      return { action: { type: 'target_add', value: Number.isSafeInteger(index) && index >= 0 ? index : false } }
    }
    case 'chat': {
      // The one action carrying free text to other players, and the room
      // broadcasts what it is handed — so it is sanitised here as well as in the
      // room.
      const text = sanitizeChat(action.text)
      if (!text) return { error: 'invalid_chat' }
      return { action: { type: 'chat', text } }
    }
    case 'toggle_prayer': {
      if (typeof action.prayerId !== 'string' || !prayersData?.[action.prayerId]) return { error: 'invalid_prayer' }
      const slot = prayersData[action.prayerId]?.bonusType === 'protection' ? 'protection' : 'combat'
      return { action: { type: 'toggle_prayer', prayerId: action.prayerId, slot } }
    }
    case 'equip':
    case 'eat':
    case 'drink_potion': {
      const slot = action.inventorySlot
      if (!Number.isInteger(slot) || slot < 0 || slot >= 28) return { error: 'invalid_inventory_slot' }
      return { action: { type: action.type, inventorySlot: slot } }
    }
    default:
      return { error: 'unknown_action' }
  }
}
