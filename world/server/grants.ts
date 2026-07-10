// flushGrants() is the ONLY world code that touches the PocketRPG save blob.
// Grants are additive server-side writes (§14: no save validation/policing here).
// writeSave() already refreshes the denormalized total_level/combat_level
// summary columns, so no extra mirroring of /api/save's PUT is needed.
import { loadCharacterWithSave, writeSave } from '../../functions/_lib/game/save.js'
import { addItemToBank, addItemToInventory, bankQuantity, removeItemFromBank, removeItemFromInventory } from '../../functions/_lib/game/inventory.js'
import { auditLog } from '../../functions/_lib/game/audit.js'
import { getLevelFromXP, clampXP } from '../../src/engine/experience.js'
import { isStackable } from './mining'

export type ItemStack = { itemId: string; quantity: number }

export type GrantPayload = {
  xpBySkill: Record<string, number>
  /** World-minted units (mined this session, not yet in the save). */
  items: ItemStack[]
  /** Where minted units land: the pack on disconnect, the bank on deposit. */
  itemsTo: 'inventory' | 'bank'
  /** Save-backed units to move from the save's inventory into the bank
   * (chest deposit of items the player carried into the world). */
  moveToBank: ItemStack[]
  /** Save-inventory units consumed in-world (eaten/buried/dropped/equipped). */
  removeFromInventory?: ItemStack[]
  /** Bank-sourced units consumed in-world after being withdrawn. */
  removeFromBank?: ItemStack[]
  /** Minted units deposited via the bank UI — granted straight to the bank. */
  mintedToBank?: ItemStack[]
  /** Bank units withdrawn and still held at disconnect: bank → inventory. */
  bankToInventory?: ItemStack[]
  /** Equipment snapshot when the player re-geared in-world (overwrites the
   * save's equipment — a world session and the main game are never played
   * simultaneously by design). */
  equipment?: Record<string, unknown>
  reason: 'deposit' | 'disconnect' | 'timer'
}

export type GrantIdentity = {
  charId: number
  identityId: string
  sessionId: string
  flushSeq: number
}

type SaveStats = Record<string, { xp?: number; level?: number }>
type Save = Record<string, unknown>

export type GrantIO = {
  loadCharacterWithSave: (env: unknown, characterId: number, identityId: string) => Promise<{ saveObject: Save; saveRevision: number }>
  writeSave: (env: unknown, characterId: number, saveObject: Save, expectedRevision: number) => Promise<unknown>
  addItemToBank: (save: Save, itemId: string, quantity: number) => void
  addItemToInventory: (save: Save, itemId: string, quantity: number, opts: { stackable: boolean }) => void
  removeItemFromInventory: (save: Save, itemId: string, quantity: number) => void
  removeItemFromBank: (save: Save, itemId: string, quantity: number) => void
  bankQuantity: (save: Save, itemId: string) => number
  auditLog: (env: unknown, eventType: string, payload: Record<string, unknown>) => Promise<void>
}

const defaultIO: GrantIO = { loadCharacterWithSave, writeSave, addItemToBank, addItemToInventory, removeItemFromInventory, removeItemFromBank, bankQuantity, auditLog }

export function isEmptyPayload(payload: GrantPayload): boolean {
  return (
    payload.items.length === 0 &&
    payload.moveToBank.length === 0 &&
    (payload.removeFromInventory ?? []).length === 0 &&
    (payload.removeFromBank ?? []).length === 0 &&
    (payload.mintedToBank ?? []).length === 0 &&
    (payload.bankToInventory ?? []).length === 0 &&
    payload.equipment === undefined &&
    Object.values(payload.xpBySkill).every((v) => !v)
  )
}

function inventoryCount(save: Save, itemId: string): number {
  const slots = Array.isArray(save.inventory) ? (save.inventory as { itemId?: string; quantity?: number }[]) : []
  let total = 0
  for (const slot of slots) {
    if (slot?.itemId === itemId) total += Math.floor(Number(slot.quantity) || 0)
  }
  return total
}

/** Adds minted units to the save's inventory, spilling whatever doesn't fit
 * into the bank — mirroring the main game's auto-bank-on-full behaviour. */
function grantToInventory(save: Save, itemId: string, quantity: number, io: GrantIO): void {
  const stackable = isStackable(itemId)
  const slots = Array.isArray(save.inventory) ? save.inventory : []
  let toInventory = quantity
  if (!stackable) {
    toInventory = Math.min(quantity, Math.max(0, 28 - slots.length))
  }
  if (toInventory > 0) {
    try {
      io.addItemToInventory(save, itemId, toInventory, { stackable })
    } catch (err) {
      if ((err as { code?: string })?.code !== 'INVENTORY_FULL') throw err
      toInventory = 0
    }
  }
  const overflow = quantity - toInventory
  if (overflow > 0) io.addItemToBank(save, itemId, overflow)
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
      // Removals clamp to what the save still holds — the main game may have
      // consumed some units since the session seeded them.
      for (const item of payload.removeFromInventory ?? []) {
        const take = Math.min(item.quantity, inventoryCount(saveObject, item.itemId))
        if (take >= 1) io.removeItemFromInventory(saveObject, item.itemId, take)
      }
      for (const item of payload.removeFromBank ?? []) {
        const take = Math.min(item.quantity, io.bankQuantity(saveObject, item.itemId))
        if (take >= 1) io.removeItemFromBank(saveObject, item.itemId, take)
      }
      for (const item of payload.moveToBank) {
        const take = Math.min(item.quantity, inventoryCount(saveObject, item.itemId))
        if (take < 1) continue
        io.removeItemFromInventory(saveObject, item.itemId, take)
        io.addItemToBank(saveObject, item.itemId, take)
      }
      for (const item of payload.bankToInventory ?? []) {
        const take = Math.min(item.quantity, io.bankQuantity(saveObject, item.itemId))
        if (take < 1) continue
        io.removeItemFromBank(saveObject, item.itemId, take)
        grantToInventory(saveObject, item.itemId, take, io)
      }
      for (const item of payload.items) {
        if (payload.itemsTo === 'inventory') grantToInventory(saveObject, item.itemId, item.quantity, io)
        else io.addItemToBank(saveObject, item.itemId, item.quantity)
      }
      for (const item of payload.mintedToBank ?? []) {
        io.addItemToBank(saveObject, item.itemId, item.quantity)
      }
      if (payload.equipment !== undefined) saveObject.equipment = payload.equipment
      await io.writeSave(env, who.charId, saveObject, saveRevision)
      await io.auditLog(env, 'world_grant', {
        characterId: who.charId,
        identityId: who.identityId,
        idempotencyKey,
        reason: payload.reason,
        xpBySkill: payload.xpBySkill,
        items: payload.items,
        itemsTo: payload.itemsTo,
        moveToBank: payload.moveToBank,
        removeFromInventory: payload.removeFromInventory ?? [],
        removeFromBank: payload.removeFromBank ?? [],
        mintedToBank: payload.mintedToBank ?? [],
        bankToInventory: payload.bankToInventory ?? [],
        equipmentChanged: payload.equipment !== undefined,
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
