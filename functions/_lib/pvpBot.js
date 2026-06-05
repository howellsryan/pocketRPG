// PvP bot helpers.
//
// Centralises: template loading, save-payload building, and the post-match
// reset that restores a bot to its template state so it is ready for the
// next fight immediately.

import pvpBotsData from '../../src/data/pvpBots.json' assert { type: 'json' }
import { gzipJsonString } from './saveCodec.js'

const BOTS_BY_ID = Object.fromEntries(
  (pvpBotsData.bots || []).map((b) => [b.id, b]),
)

// XP table — mirrors src/engine/experience.js (no JSX/Preact dependency)
const MAX_LEVEL = 99
const XP_TABLE = new Array(MAX_LEVEL + 1)
XP_TABLE[1] = 0
;(function () {
  let cum = 0
  for (let l = 1; l < MAX_LEVEL; l++) {
    cum += Math.floor(l + 300 * Math.pow(2, l / 7))
    XP_TABLE[l + 1] = Math.floor(cum / 4)
  }
})()

function getXPForLevel(level) {
  const l = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)))
  return XP_TABLE[l]
}

export function getBotTemplate(templateId) {
  return BOTS_BY_ID[templateId] || null
}

export function buildBotSavePayload(template) {
  const stats = {}
  for (const [skill, level] of Object.entries(template.stats || {})) {
    stats[skill] = { xp: getXPForLevel(level) }
  }
  const hpLevel = template.stats?.hitpoints || 10
  const maxHP   = Math.max(10, hpLevel)

  return {
    stats,
    equipment: Object.fromEntries(
      Object.entries(template.equipment || {}).map(([slot, item]) => [slot, item ? { ...item } : null]),
    ),
    inventory: (template.inventory || []).map((slot) => (slot ? { ...slot } : null)),
    settings: { combatStance: template.combatStance || 'accurate' },
    player: { currentHP: maxHP },
    bank: {},
  }
}

// Check whether a character row (already loaded) is a bot.
export function isBotCharacter(character) {
  return character?.is_bot === 1 || character?.is_bot === true
}

// Reset a bot's save back to its template state. Called after every match
// (win, loss, or abort) so the bot is always fresh for the next fight.
// Safe to call even if the match write already cleared active_match_id.
export async function resetBotSave(env, botCharacterId) {
  if (!env?.DB || !botCharacterId) return

  const row = await env.DB.prepare(
    'SELECT bot_template_id FROM characters WHERE id = ? AND is_bot = 1'
  ).bind(botCharacterId).first()

  const templateId = row?.bot_template_id
  if (!templateId) return

  const template = getBotTemplate(templateId)
  if (!template) return

  const payload    = buildBotSavePayload(template)
  const payloadStr = JSON.stringify(payload)
  const blob       = await gzipJsonString(payloadStr)

  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO saves (character_id, base64, save_blob, hash, updated_at)
     VALUES (?, '', ?, 'reset', ?)
     ON CONFLICT(character_id) DO UPDATE SET
       save_blob  = excluded.save_blob,
       hash       = excluded.hash,
       updated_at = excluded.updated_at`
  ).bind(botCharacterId, blob, now).run()

  // Belt-and-braces: ensure active_match_id is cleared even if the normal
  // finalize path already cleared it (the UPDATE is a no-op in that case).
  await env.DB.prepare(
    'UPDATE characters SET active_match_id = NULL WHERE id = ? AND is_bot = 1'
  ).bind(botCharacterId).run()
}
