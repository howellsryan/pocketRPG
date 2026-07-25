import { requireAuth, json } from '../../../../_lib/auth.js'
import { getOwnedCharacter } from '../../../../_lib/pvp.js'
import { parseSessionState, readSession } from '../../../../_lib/game/coopBoss.js'
import prayersData from '../../../../../src/data/prayers.json' assert { type: 'json' }
import spellsData from '../../../../../src/data/spells.json' assert { type: 'json' }

const VALID_STANCES = new Set(['accurate', 'aggressive', 'controlled', 'defensive', 'rapid', 'longrange'])
const MAX_QUEUED_PER_TICK = 4

/** Server-side shape check. The engine ignores nonsense actions, but rejecting
 * them here keeps junk out of the intents table and gives the client a reason. */
export function validateCoopAction(action) {
  if (!action || typeof action !== 'object') return { error: 'invalid_action' }
  switch (action.type) {
    case 'change_stance':
      if (!VALID_STANCES.has(action.stance)) return { error: 'invalid_stance' }
      return { action: { type: 'change_stance', stance: action.stance } }
    case 'change_combat_spell':
      if (action.spellId != null && !spellsData?.[action.spellId]) return { error: 'invalid_spell' }
      return { action: { type: 'change_combat_spell', spellId: action.spellId ?? null } }
    case 'queue_special':
      return { action: { type: 'queue_special' } }
    case 'target_add':
      return { action: { type: 'target_add', value: !!action.value } }
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

  const sessionId = parseInt(params.id, 10)
  if (!Number.isFinite(sessionId)) return json({ error: 'Invalid session id' }, 400)

  const row = await readSession(env, sessionId)
  if (!row) return json({ error: 'coop_session_not_found' }, 404)
  if (row.status !== 'active') return json({ error: 'coop_session_not_active' }, 409)

  const state = parseSessionState(row)
  const member = state?.members?.[String(ch.id)]
  if (!member) return json({ error: 'not_a_member' }, 403)
  if (member.status !== 'alive') return json({ error: 'member_dead' }, 409)

  const body = await request.json()
  const validated = validateCoopAction(body?.action)
  if (validated.error) return json({ error: validated.error }, 400)

  const targetTick = (state.tick || 0) + 1
  const queued = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM coop_intents WHERE session_id = ? AND character_id = ? AND applied = 0',
  ).bind(sessionId, ch.id).first()
  if ((Number(queued?.n) || 0) >= MAX_QUEUED_PER_TICK) return json({ error: 'too_many_queued_actions' }, 429)

  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO coop_intents (session_id, character_id, tick_number, character_seq, action_json, applied, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`,
  ).bind(sessionId, ch.id, targetTick, now % 100000, JSON.stringify(validated.action), now).run()

  return json({ ok: true, tick_number: targetTick })
}
