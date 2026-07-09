// flushGrants() is the ONLY world code that touches the PocketRPG save blob.
// Grants are additive server-side writes (§14: no save validation/policing here).
// writeSave() already refreshes the denormalized total_level/combat_level
// summary columns, so no extra mirroring of /api/save's PUT is needed.
import { loadCharacterWithSave, writeSave } from '../../functions/_lib/game/save.js'
import { addItemToBank } from '../../functions/_lib/game/inventory.js'
import { auditLog } from '../../functions/_lib/game/audit.js'
import { getLevelFromXP, clampXP } from '../../src/engine/experience.js'

export type GrantPayload = {
  xpBySkill: Record<string, number>
  items: { itemId: string; quantity: number }[]
  reason: 'deposit' | 'disconnect' | 'timer'
}

export type GrantIdentity = {
  charId: number
  identityId: string
  sessionId: string
  flushSeq: number
}

type SaveStats = Record<string, { xp?: number; level?: number }>

export type GrantIO = {
  loadCharacterWithSave: (env: unknown, characterId: number, identityId: string) => Promise<{ saveObject: Record<string, unknown>; saveRevision: number }>
  writeSave: (env: unknown, characterId: number, saveObject: Record<string, unknown>, expectedRevision: number) => Promise<unknown>
  addItemToBank: (save: Record<string, unknown>, itemId: string, quantity: number) => void
  auditLog: (env: unknown, eventType: string, payload: Record<string, unknown>) => Promise<void>
}

const defaultIO: GrantIO = { loadCharacterWithSave, writeSave, addItemToBank, auditLog }

export function isEmptyPayload(payload: GrantPayload): boolean {
  return payload.items.length === 0 && Object.values(payload.xpBySkill).every((v) => !v)
}

/** Applies a grant payload to the character's save blob, exactly once per
 * idempotency key. Returns true when applied (or already applied earlier);
 * false when all attempts failed and the caller should re-queue the payload. */
export async function flushGrants(
  env: { DB: D1Database },
  who: GrantIdentity,
  payload: GrantPayload,
  io: GrantIO = defaultIO
): Promise<boolean> {
  if (isEmptyPayload(payload)) return true

  const idempotencyKey = `wg:${who.charId}:${who.sessionId}:${who.flushSeq}`
  const inserted = await env.DB.prepare(
    `INSERT INTO world_grants (character_id, idempotency_key, payload_json, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(idempotency_key) DO NOTHING`
  ).bind(who.charId, idempotencyKey, JSON.stringify(payload), Date.now()).run()
  if (!inserted?.meta?.changes) return true

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { saveObject, saveRevision } = await io.loadCharacterWithSave(env, who.charId, who.identityId)
      const stats = (saveObject.stats ?? {}) as SaveStats
      saveObject.stats = stats
      for (const [skill, amount] of Object.entries(payload.xpBySkill)) {
        if (!amount) continue
        const entry = stats[skill] ?? { xp: 0, level: 1 }
        entry.xp = clampXP((Number(entry.xp) || 0) + amount)
        entry.level = getLevelFromXP(entry.xp)
        stats[skill] = entry
      }
      for (const item of payload.items) io.addItemToBank(saveObject, item.itemId, item.quantity)
      await io.writeSave(env, who.charId, saveObject, saveRevision)
      await io.auditLog(env, 'world_grant', {
        characterId: who.charId,
        identityId: who.identityId,
        idempotencyKey,
        reason: payload.reason,
        xpBySkill: payload.xpBySkill,
        items: payload.items,
      })
      return true
    } catch (err) {
      const code = (err as { code?: string })?.code
      if (code === 'SAVE_REVISION_CONFLICT' && attempt < 2) continue
      console.error('[World][grants] flush failed', idempotencyKey, err)
      break
    }
  }

  await env.DB.prepare('DELETE FROM world_grants WHERE idempotency_key = ?').bind(idempotencyKey).run()
  return false
}
