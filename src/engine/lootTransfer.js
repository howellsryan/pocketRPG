// Item valuation and bank-filling for PvP loot.
//
// Pure functions, no side effects on input. Two live callers:
// `world/server/pvpDeath.ts` (an untradeable is destroyed and the floor gets
// its coin value instead) and `src/engine/pvpBotRewards.js` (a bot loot box
// lands in the winner's bank). The duel's whole-inventory transfer lived here
// too and went with the duel — the Wilderness drops to the FLOOR, never
// straight into the killer's bank, so do not restore it.
//
// Rules:
//   - COINS are special-cased: items.json flags 'coins' as isUntradeable
//     for the general-store engine, but in PvP they ALWAYS transfer.
//   - Untradeables convert to their coin equivalent.
//   - Bank-overflow: loot fed into the bank slot-by-slot; the discarded
//     remainder is reported to the UI as a toast ("Bank full — N items lost").

import { BANK_SIZE } from '../utils/constants.js'
import minigamesData from '../data/minigames.json'

const COINS_ID = 'coins'
const MINIGAME_UNLOCK_ITEM_VALUE = 4_500_000
const MINIGAME_UNLOCK_PRODUCTS = new Set((minigamesData?.tasks || []).map(t => t?.product).filter(Boolean))

export function lootEntryValue(entry, itemsData) {
  if (!entry?.itemId) return 0
  const qty = Math.max(1, Number(entry.quantity) || 1)
  if (entry.itemId === COINS_ID) return qty
  const shopValue = Number(itemsData?.[entry.itemId]?.shopValue)
  if (!Number.isFinite(shopValue) || shopValue <= 0) return 0
  return Math.floor(shopValue) * qty
}

export function isPvpCoinReplacementItem(itemId, itemsData) {
  if (!itemId || itemId === COINS_ID) return false
  const def = itemsData?.[itemId]
  if (!def) return false
  return def.isUntradeable === true
}

export function getPvpCoinReplacementValue(entry, itemsData) {
  if (!entry?.itemId || !isPvpCoinReplacementItem(entry.itemId, itemsData)) return 0
  const def = itemsData?.[entry.itemId]
  const isMinigameUnlockItem = MINIGAME_UNLOCK_PRODUCTS.has(entry.itemId)
  const shopValue = isMinigameUnlockItem ? MINIGAME_UNLOCK_ITEM_VALUE : Number(def?.shopValue)
  const qty = Math.max(1, Number(entry.quantity) || 1)
  if (!Number.isFinite(shopValue) || shopValue <= 0) return 0
  return Math.floor(shopValue) * qty
}

/**
 * Fill the winner's bank with the sorted loot pile. Returns added/dropped
 * partitions plus the resulting bank object.
 *
 * Bank shape: Record<itemId, { itemId, quantity, charges? }>
 *   - Stackable items merge into the existing key.
 *   - Non-stackable items: each unique itemId is one bank entry; a second
 *     stack of the same non-stackable id collides with the existing one.
 *     For Phase 4 we pick the conservative behaviour: if an existing
 *     non-stackable bank entry has charges, reject the merge and DROP the
 *     incoming item (otherwise we'd lose the existing charges silently).
 *     If neither has charges, we increment quantity (existing PocketRPG
 *     bank semantics — multiple of the same non-stackable can stack in
 *     the bank as one entry with quantity > 1).
 *   - BANK_SIZE caps the number of distinct itemIds (default 500).
 */
export function fillBank(initialBank, sortedLoot, itemsData, bankSize = BANK_SIZE) {
  // Defensive shallow copy so callers' bank object isn't mutated.
  const bank = { ...initialBank }
  for (const k of Object.keys(bank)) bank[k] = { ...bank[k] }

  const added = []
  const dropped = []
  let addedValue = 0
  let droppedValue = 0

  for (const item of sortedLoot) {
    const def = itemsData[item.itemId]
    const stackable = !!def?.stackable
    const existing = bank[item.itemId]
    const slotsUsed = Object.keys(bank).length
    const itemValue = lootEntryValue(item, itemsData)

    if (existing) {
      // Same itemId already in bank.
      if (stackable) {
        existing.quantity = (existing.quantity || 0) + (item.quantity || 1)
        added.push(item)
        addedValue += itemValue
        continue
      }
      // Non-stackable collision: charges-bearing items can't merge safely.
      if (existing.charges != null || item.charges != null) {
        dropped.push(item)
        droppedValue += itemValue
        continue
      }
      existing.quantity = (existing.quantity || 1) + (item.quantity || 1)
      added.push(item)
      addedValue += itemValue
      continue
    }

    // Coins are always creditable in PvP loot (never dropped due to slot cap).
    if (item.itemId === COINS_ID) {
      bank[COINS_ID] = {
        itemId: COINS_ID,
        quantity: (Number(bank[COINS_ID]?.quantity) || 0) + (item.quantity || 1),
      }
      added.push(item)
      addedValue += itemValue
      continue
    }

    // New itemId — needs a free bank slot.
    if (slotsUsed >= bankSize) {
      dropped.push(item)
      droppedValue += itemValue
      continue
    }
    bank[item.itemId] = {
      itemId: item.itemId,
      quantity: item.quantity || 1,
      ...(item.charges != null ? { charges: item.charges } : {}),
    }
    added.push(item)
    addedValue += itemValue
  }

  return { bank, added, dropped, addedValue, droppedValue }
}
