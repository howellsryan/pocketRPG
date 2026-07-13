// Pure crafting helpers for the processing stations (furnace/anvil/range).
// Recipe data comes from shared/recipes.ts (skills.json); burn odds come from
// the REAL engine (src/engine/skilling.js) — no reimplemented formulas.
import { checkBurn } from '../../src/engine/skilling.js'
import type { Recipe } from '../shared/recipes'
import type { InvSlot } from '../shared/protocol'
import { addToInventory, countItem, removeItems } from './mining'

export const BURNT_FOOD_ITEM = 'burnt_food'
/** Live-game burn semantics (SkillingScreen.jsx): burnt food yields 1 XP. */
export const BURN_XP = 1

export function hasMaterials(inventory: InvSlot[], recipe: Recipe): boolean {
  return Object.entries(recipe.materials).every(([itemId, qty]) => countItem(inventory, itemId) >= qty)
}

export function maxCraftable(inventory: InvSlot[], recipe: Recipe): number {
  let max = Infinity
  for (const [itemId, qty] of Object.entries(recipe.materials)) {
    max = Math.min(max, Math.floor(countItem(inventory, itemId) / qty))
  }
  return Number.isFinite(max) ? max : 0
}

export type CraftOutcome =
  | { ok: true; product: string; xp: number; burnt: boolean; consumed: Record<string, number> }
  | { ok: false; reason: 'materials' | 'space' }

/** One recipe completion: consumes every material from the pack, rolls the
 * engine's burn check for cooking recipes, and adds the product. The pack is
 * left untouched on failure (removal is rolled back when the product doesn't
 * fit). Provenance-pool accounting is the caller's job — this only moves slots. */
export function craftOnce(inventory: InvSlot[], recipe: Recipe, level: number): CraftOutcome {
  if (!hasMaterials(inventory, recipe)) return { ok: false, reason: 'materials' }
  const snapshot = inventory.map((s) => (s ? { ...s } : null))
  for (const [itemId, qty] of Object.entries(recipe.materials)) removeItems(inventory, itemId, qty)
  const burnt = Boolean(recipe.burnStopLevel) && checkBurn(level, recipe)
  const product = burnt ? BURNT_FOOD_ITEM : recipe.product
  if (!addToInventory(inventory, product, 1)) {
    for (let i = 0; i < inventory.length; i++) inventory[i] = snapshot[i]
    return { ok: false, reason: 'space' }
  }
  return { ok: true, product, burnt, xp: burnt ? BURN_XP : recipe.xp, consumed: { ...recipe.materials } }
}
