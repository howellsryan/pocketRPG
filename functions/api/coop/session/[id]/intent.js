import { requireAuth, json } from '../../../../_lib/auth.js'
import { getOwnedCharacter } from '../../../../_lib/pvp.js'
import { callCoopRoom } from '../../../../_lib/game/coopRoom.js'
import { parseCoopSessionId } from '../../../../_lib/game/coopBoss.js'
import { toErrorResponse } from '../../../../_lib/game/errors.js'
import { sanitizeChat } from '../../../../../src/engine/playerChat.js'
import prayersData from '../../../../../src/data/prayers.json' assert { type: 'json' }
import spellsData from '../../../../../src/data/spells.json' assert { type: 'json' }

const VALID_STANCES = new Set(['accurate', 'aggressive', 'controlled', 'defensive', 'rapid', 'longrange'])

/** Server-side shape check, at the edge rather than in the room: the engine
 * ignores nonsense actions, but validating here keeps junk out of the room's
 * queue and gives the client a reason. Returns a NORMALISED action — extra
 * fields never reach the engine. */
export function validateCoopAction(action) {
  if (!action || typeof action !== 'object') return { error: 'invalid_action' }
  switch (action.type) {
    case 'start_raid':
      // No payload — the room decides whether this member is the host and
      // whether there is a lobby to end.
      return { action: { type: 'start_raid' } }
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
    case 'set_quick_prayers': {
      if (!Array.isArray(action.prayerIds)) return { error: 'invalid_prayer' }
      // Deduped and filtered to real prayers, which also bounds the list: the
      // room carries it until write-back, so it must not be a free text field.
      const prayerIds = [...new Set(action.prayerIds)].filter((id) => typeof id === 'string' && prayersData?.[id])
      if (prayerIds.length !== new Set(action.prayerIds).size) return { error: 'invalid_prayer' }
      return { action: { type: 'set_quick_prayers', prayerIds } }
    }
    case 'target_add':
      return { action: { type: 'target_add', value: !!action.value } }
    case 'chat': {
      // Sanitised at the edge as well as in the room: this is the one action
      // carrying free text to other players, and the room broadcasts what it is
      // handed.
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

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getOwnedCharacter(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  const sessionId = parseCoopSessionId(params.id)
  if (sessionId === null) return json({ error: 'Invalid session id' }, 400)

  // Malformed JSON is a 400, not the unhandled 500 an un-guarded request.json()
  // produced.
  const body = await request.json().catch(() => null)
  if (body === null) return json({ error: 'invalid_json' }, 400)

  const validated = validateCoopAction(body?.action)
  if (validated.error) return json({ error: validated.error }, 400)

  try {
    const { status, body: roomBody } = await callCoopRoom(env, sessionId, 'intent', {
      characterId: ch.id,
      action: validated.action,
    })
    return json(roomBody ?? { error: 'coop_room_unavailable' }, status)
  } catch (err) {
    const mapped = toErrorResponse(err)
    return json(mapped.body, mapped.status)
  }
}
