// What a click on a pack item DOES — shared by the client (labels, menus) and
// the server (validation + effects) so both always agree. Derived entirely from
// the main game's data: items.json types/slots and skills.json bury actions.
import itemsData from '../../src/data/items.json'
import skillsData from '../../src/data/skills.json'

export type InvActionKind = 'equip' | 'eat' | 'drink' | 'bury'
export type PrimaryAction = { action: InvActionKind; label: string }

type Item = { slot?: string | null; type?: string; heals?: number } | undefined
type PrayerAction = { id: string; xp: number; materials?: Record<string, number> }

const items = itemsData as unknown as Record<string, Item>

/** bone itemId → burial prayer XP, from skills.json `bury_*` actions. */
export const BURY_XP: Record<string, number> = (() => {
  const out: Record<string, number> = {}
  const actions = (skillsData as unknown as { prayer?: { actions?: PrayerAction[] } }).prayer?.actions ?? []
  for (const action of actions) {
    if (!action.id.startsWith('bury_') || !action.materials) continue
    const mats = Object.keys(action.materials)
    if (mats.length === 1) out[mats[0]] = action.xp
  }
  return out
})()

/** The left-click action for a pack item (mirrors the main game's inventory:
 * equip when the item has a gear slot, eat food, drink potions, bury bones).
 * Null for pure materials — their only menu entry is Drop. */
export function primaryInvAction(itemId: string): PrimaryAction | null {
  const item = items[itemId]
  if (!item) return null
  if (item.slot) return { action: 'equip', label: item.slot === 'weapon' ? 'Wield' : 'Wear' }
  if (BURY_XP[itemId] != null) return { action: 'bury', label: 'Bury' }
  if (item.type === 'food') return { action: 'eat', label: 'Eat' }
  if (item.type === 'potion') return { action: 'drink', label: 'Drink' }
  return null
}

export function healAmount(itemId: string): number {
  return Math.max(0, Math.floor(Number(items[itemId]?.heals) || 0))
}
