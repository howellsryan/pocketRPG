// Loot transfer on PvP death.
//
// Pure functions, no side effects on input. The PvP engine calls these
// when a Combatant hits 0 HP (or forfeits). The server then writes the
// resulting state back to D1 in an atomic batch — but the actual item-
// shuffling math lives here so it's testable in isolation.
//
// Rules (from the design plan):
//   - Tradeable items (equipment + inventory) transfer to the winner's bank.
//   - Untradeables are lost by the loser and converted to their coin equivalent for the winner.
//   - COINS are special-cased: items.json flags 'coins' as isUntradeable
//     for the general-store engine, but in PvP they ALWAYS transfer.
//   - Charges (scale-charged weapons) and ammo quantity carry through.
//   - Bank-overflow: tradeable pile sorted by shopValue DESC, fed into
//     winner's bank slot-by-slot. Discarded remainder is reported to the
//     UI as a toast ("Bank full — N items lost").

import { BANK_SIZE } from '../utils/constants.js'
import minigamesData from '../data/minigames.json'

const COINS_ID = 'coins'
const MINIGAME_UNLOCK_ITEM_VALUE = 4_500_000
const MINIGAME_UNLOCK_PRODUCTS = new Set((minigamesData?.tasks || []).map(t => t?.product).filter(Boolean))

function lootEntryValue(entry, itemsData) {
  if (!entry?.itemId) return 0
  const qty = Math.max(1, Number(entry.quantity) || 1)
  if (entry.itemId === COINS_ID) return qty
  const shopValue = Number(itemsData?.[entry.itemId]?.shopValue)
  if (!Number.isFinite(shopValue) || shopValue <= 0) return 0
  return Math.floor(shopValue) * qty
}

/**
 * Returns true if the item should transfer to the winner. Coins are an
 * explicit override on isUntradeable.
 */
export function isPvpTradeable(itemId, itemsData) {
  if (itemId === COINS_ID) return true
  const def = itemsData?.[itemId]
  if (!def) return false
  return !def.isUntradeable
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
 * Split a loser's inventory + equipment into the pile that transfers
 * (tradeable) and what stays behind (untradeable, in original positions).
 *
 * Input is treated as immutable — the function returns fresh objects/arrays.
 *
 * Returns:
 *   {
 *     transfer: Array<LootEntry>,                  // pile heading to the winner
 *     remainingInventory: Array<InventorySlot|null>, // loser's new inventory (28 slots)
 *     remainingEquipment: Record<EquipSlot, EquippedItem|null>, // loser's new equipment
 *   }
 *
 * LootEntry has the shape { itemId, quantity, charges?, fromSlot: 'equipment.<slot>' | 'inventory.<i>' }
 * — the source slot is preserved purely for debugging / replay; the
 * winner's bank doesn't care about it.
 */
export function splitInventoryByTradeable(inventory, equipment, itemsData) {
  const transfer = []
  const remainingInventory = new Array(inventory?.length || 0).fill(null)
  const remainingEquipment = {}

  // Walk equipment slots first so the transfer pile is naturally
  // ordered "equipped → inventory" (cosmetic; the sort by shopValue
  // overrides this for the bank fill).
  if (equipment && typeof equipment === 'object') {
    for (const [slot, entry] of Object.entries(equipment)) {
      if (!entry) { remainingEquipment[slot] = null; continue }
      if (isPvpCoinReplacementItem(entry.itemId, itemsData)) {
        transfer.push({
          itemId: COINS_ID,
          quantity: getPvpCoinReplacementValue(entry, itemsData),
          fromSlot: `equipment.${slot}`,
        })
        remainingEquipment[slot] = null
      } else if (isPvpTradeable(entry.itemId, itemsData)) {
        transfer.push({
          itemId: entry.itemId,
          quantity: entry.quantity || 1,    // ammo carries quantity; everything else is qty 1
          charges: entry.charges,
          fromSlot: `equipment.${slot}`,
        })
        remainingEquipment[slot] = null
      } else {
        remainingEquipment[slot] = null
      }
    }
  }

  if (Array.isArray(inventory)) {
    for (let i = 0; i < inventory.length; i++) {
      const slot = inventory[i]
      if (!slot) continue
      if (isPvpCoinReplacementItem(slot.itemId, itemsData)) {
        transfer.push({
          itemId: COINS_ID,
          quantity: getPvpCoinReplacementValue(slot, itemsData),
          fromSlot: `inventory.${i}`,
        })
      } else if (isPvpTradeable(slot.itemId, itemsData)) {
        transfer.push({
          itemId: slot.itemId,
          quantity: slot.quantity || 1,
          charges: slot.charges,
          fromSlot: `inventory.${i}`,
        })
        // remainingInventory[i] stays null (cleared)
      } else {
        // Untradeables are always lost on PvP death.
      }
    }
  }

  return { transfer, remainingInventory, remainingEquipment }
}

/**
 * Sort a tradeable pile by shopValue DESC so the winner gets the most
 * valuable items first if their bank fills up. Items missing a shopValue
 * sort to the end (treated as 0).
 */
export function sortLootByValueDesc(transfer, itemsData) {
  return [...transfer].sort((a, b) => {
    const va = itemsData[a.itemId]?.shopValue || 0
    const vb = itemsData[b.itemId]?.shopValue || 0
    return vb - va
  })
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

/**
 * Convenience wrapper: split + sort + fill in one call. Returns the full
 * picture the engine needs to emit a 'matchEnd' event and persist back
 * to saves.save_data for both characters.
 */
export function applyLootTransfer({
  loserInventory, loserEquipment,
  winnerBank,
  itemsData,
  bankSize = BANK_SIZE,
}) {
  const { transfer, remainingInventory, remainingEquipment } =
    splitInventoryByTradeable(loserInventory, loserEquipment, itemsData)
  const sorted = sortLootByValueDesc(transfer, itemsData)
  const fill = fillBank(winnerBank, sorted, itemsData, bankSize)
  return {
    loser: {
      inventory: remainingInventory,
      equipment: remainingEquipment,
    },
    winner: {
      bank: fill.bank,
    },
    summary: {
      transferCount: transfer.length,
      added: fill.added,
      dropped: fill.dropped,
      addedValue: fill.addedValue,
      bankedValue: fill.addedValue,
      droppedValue: fill.droppedValue,
      totalRiskValue: sorted.reduce((sum, item) => sum + lootEntryValue(item, itemsData), 0),
    },
  }
}
