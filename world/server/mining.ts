// Mining data + session-inventory helpers. Pure module — no I/O, no DO state —
// so the tick state machine and its tests share one source of truth.
import skillsData from '../../src/data/skills.json'
import itemsData from '../../src/data/items.json'
import type { InvSlot } from '../shared/protocol'

export type MiningAction = { id: string; name: string; level: number; ticks: number; xp: number; product: string }

type SkillsData = { mining: { actions: MiningAction[] } }
type ItemsData = Record<string, { stackable?: boolean } | undefined>

export const MINING_ACTIONS: Record<string, MiningAction> = Object.fromEntries(
  (skillsData as unknown as SkillsData).mining.actions.map((a) => [a.id, a])
)

export const ROCK_DEPLETED_TICKS = 8
export const INVENTORY_SLOTS = 28

export function isStackable(itemId: string): boolean {
  return Boolean((itemsData as unknown as ItemsData)[itemId]?.stackable)
}

export function emptyInventory(): InvSlot[] {
  return new Array<InvSlot>(INVENTORY_SLOTS).fill(null)
}

/** Adds qty of an item to the 28-slot session pack. Stackables merge into an
 * existing slot; non-stackables take one slot per unit. Returns false (pack
 * unchanged beyond what fit... it adds nothing) when there is no room. */
export function addToInventory(inventory: InvSlot[], itemId: string, qty: number): boolean {
  if (isStackable(itemId)) {
    const existing = inventory.find((s) => s?.itemId === itemId)
    if (existing) {
      existing.quantity += qty
      return true
    }
    const free = inventory.findIndex((s) => s === null)
    if (free === -1) return false
    inventory[free] = { itemId, quantity: qty }
    return true
  }
  const freeSlots: number[] = []
  for (let i = 0; i < inventory.length && freeSlots.length < qty; i++) {
    if (inventory[i] === null) freeSlots.push(i)
  }
  if (freeSlots.length < qty) return false
  for (const i of freeSlots) inventory[i] = { itemId, quantity: 1 }
  return true
}

export function inventoryIsFull(inventory: InvSlot[], itemId: string): boolean {
  if (isStackable(itemId) && inventory.some((s) => s?.itemId === itemId)) return false
  return !inventory.some((s) => s === null)
}

/** Reorders the pack: dropping onto a filled slot swaps the two, onto an empty
 * slot relocates (same semantics as the main game's InventoryGrid). Slot order
 * never affects flushes — they read the minted/saveBacked tallies, not slots. */
export function moveInventorySlot(inventory: InvSlot[], from: number, to: number): boolean {
  if (!Number.isInteger(from) || !Number.isInteger(to)) return false
  if (from < 0 || to < 0 || from >= inventory.length || to >= inventory.length) return false
  if (from === to || inventory[from] === null) return false
  const moved = inventory[from]
  inventory[from] = inventory[to]
  inventory[to] = moved
  return true
}

/** Aggregates the pack into {itemId, quantity} rows for a grant flush. */
export function inventoryToItems(inventory: InvSlot[]): { itemId: string; quantity: number }[] {
  const byId = new Map<string, number>()
  for (const slot of inventory) {
    if (!slot) continue
    byId.set(slot.itemId, (byId.get(slot.itemId) ?? 0) + slot.quantity)
  }
  return [...byId.entries()].map(([itemId, quantity]) => ({ itemId, quantity }))
}
