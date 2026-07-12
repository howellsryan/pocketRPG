// @ts-check
import { getLevelFromXP } from './experience.js'

/**
 * The result of a task simulation (idle/offline/skip-hour/live-completion),
 * consumed by applyTaskResult. NOT every field applies to every task type;
 * the per-type rules live in applyTaskResult's branches.
 *
 * NET vs ADDITIVE — the distinction that caused the #725 double-loot bug:
 *  - `itemsBanked` / `lootBanked` are ADDITIVE: items to add to the bank.
 *  - `itemsGained` is NET for `skill`/`gather` (it already equals the
 *    inventory delta + itemsBanked, so it must NOT be re-applied on top of
 *    finalInventory) but ADDITIVE for other types (thieving/hunter/etc).
 *  - `finalInventory` REPLACES the inventory wholesale for
 *    skill/gather/clue/combat.
 *
 * @typedef {Object} TaskResult
 * @property {Record<string, number>} [xpGained]        XP per skill id.
 * @property {number} [dungeoneeringTokensGained]
 * @property {boolean} [died]                            combat only.
 * @property {number} [finalHP]                          combat only.
 * @property {{itemId: string, quantity: number}} [ammoConsumed] combat only.
 * @property {number} [chargesConsumed]                  combat only.
 * @property {Record<string, number>} [itemsConsumed]    bank items spent.
 * @property {Array<any>} [finalInventory]               replaces inventory (skill/gather/clue/combat).
 * @property {Record<string, number>} [lootBanked]       ADDITIVE bank loot.
 * @property {Record<string, number>} [itemsBanked]      ADDITIVE bank loot (alias).
 * @property {Record<string, number>} [itemsGained]      NET for skill/gather, ADDITIVE otherwise.
 * @property {number} [coinsGained]                      agility/thieving.
 * @property {Array<{itemId: string, quantity: number}>} [rewards] hunter.
 * @property {string|null} [stoppedReason]
 * @property {number} [monstersKilled]                   combat only.
 */

// Single source of truth for "apply idle simulation result → save state".
// Used by both the MCP (functions/_lib/mcp/intents.js) and the browser
// (src/state/gameState.jsx) so the two paths can never drift.
//
// state = { stats, inventory, bank, equipment, settings }
//   stats     { [skillId]: { xp, level } }            mutated in place
//   inventory  28-slot array (null-padded)             may be replaced with
//              sim.finalInventory for skill/gather/clue/combat
//   bank      { [itemId]: { itemId, quantity } }       mutated in place
//   equipment  { [slot]: { itemId, … } | null }        mutated in place
//   settings  { currentHP?, dungeoneeringTokens?, … }  mutated in place
//
// Quest XP/coins are handled by applyQuestTask / the client's quest-cascade
// block — pass type:'quest' and this function is intentionally a no-op.
//
// Returns a plain summary with raw item ids (no name decoration).
// { banked, stoppedReason, died?, finalHP?, monstersKilled? }

const XP_CAP = 200_000_000

/** @param {Record<string, any>} bank @param {string} itemId @param {number} qty */
function bankAdd(bank, itemId, qty) {
  if (qty <= 0) return
  const existing = bank[itemId]
  bank[itemId] = existing
    ? { ...existing, quantity: (Number(existing.quantity) || 0) + qty }
    : { itemId, quantity: qty }
}

// Coins from agility/thieving land in the inventory (stackable, coalescing),
// falling back to the bank when the inventory is full — matching the client.
/** @param {any[]} inventory @param {Record<string, any>} bank @param {number} qty */
function addCoinsInventoryFirst(inventory, bank, qty) {
  if (qty <= 0) return
  // Coalesce into the unnoted coins stack. The `!s.noted` guard is defensive
  // only — coins are unnotable in PocketRPG, so no realistic save carries a
  // noted coins slot — and keeps a stray noted entry from splitting the stack.
  const idx = inventory.findIndex((s) => s && s.itemId === 'coins' && !s.noted)
  if (idx >= 0) {
    inventory[idx] = { ...inventory[idx], quantity: (Number(inventory[idx].quantity) || 0) + qty }
    return
  }
  const empty = inventory.findIndex((s) => s === null || s === undefined)
  if (empty >= 0) {
    inventory[empty] = { itemId: 'coins', quantity: qty }
    return
  }
  bankAdd(bank, 'coins', qty)
}

/**
 * @param {{stats?: any, inventory?: any[], bank?: any, equipment?: any, settings?: any}} state
 * @param {TaskResult} sim
 * @param {string} type
 */
export function applyTaskResult(state, sim, type) {
  if (!state.stats || typeof state.stats !== 'object') state.stats = {}
  if (!state.bank || typeof state.bank !== 'object') state.bank = {}
  if (!state.equipment || typeof state.equipment !== 'object') state.equipment = {}
  if (!state.settings || typeof state.settings !== 'object') state.settings = {}
  if (!Array.isArray(state.inventory)) state.inventory = new Array(28).fill(null)

  const { stats, bank, equipment, settings } = state

  // XP (all non-quest types)
  if (type !== 'quest' && sim.xpGained) {
    for (const [skill, xp] of Object.entries(sim.xpGained)) {
      if (xp > 0) {
        // Initialize a missing skill rather than dropping the XP. On a fully
        // browser-seeded save every skill already exists, but a server-side
        // save (MCP-created character) may not have the entry yet — without
        // this the gain is silently discarded while the claim result still
        // reports it, so levels never rise and requirements never unlock.
        const cur = stats[skill] || { skill, xp: 0, level: 1 }
        const newXP = Math.min((cur.xp || 0) + Math.floor(xp), XP_CAP)
        stats[skill] = { ...cur, xp: newXP, level: getLevelFromXP(newXP) }
      }
    }
  }

  // Dungeoneering tokens
  if ((sim.dungeoneeringTokensGained || 0) > 0) {
    settings.dungeoneeringTokens = (Number(settings.dungeoneeringTokens) || 0) + Math.floor(sim.dungeoneeringTokensGained || 0)
  }

  // Combat-specific: HP and equipment drain
  if (type === 'combat') {
    const maxHP = stats.hitpoints ? getLevelFromXP(stats.hitpoints.xp || 0) : 10
    if (sim.died === true) {
      settings.currentHP = maxHP
    } else if (Number.isFinite(Number(sim.finalHP))) {
      settings.currentHP = Math.max(1, Math.min(maxHP, Math.floor(Number(sim.finalHP))))
    }

    if (sim.ammoConsumed && equipment.ammo && equipment.ammo.itemId === sim.ammoConsumed.itemId) {
      const remaining = Math.max(0, (Number(equipment.ammo.quantity) || 0) - sim.ammoConsumed.quantity)
      equipment.ammo = remaining > 0 ? { ...equipment.ammo, quantity: remaining } : null
    }
    const chargesConsumed = Number(sim.chargesConsumed) || 0
    if (chargesConsumed > 0 && equipment.weapon) {
      const remaining = Math.max(0, (Number(equipment.weapon.charges) || 0) - chargesConsumed)
      equipment.weapon = { ...equipment.weapon, charges: remaining }
    }
  }

  // Items consumed from bank (food/potions for combat, materials for skills)
  if (sim.itemsConsumed) {
    for (const [itemId, qty] of Object.entries(sim.itemsConsumed)) {
      const existing = bank[itemId]
      if (!existing) continue
      const newQty = (Number(existing.quantity) || 0) - qty
      if (newQty <= 0) delete bank[itemId]
      else bank[itemId] = { ...existing, quantity: newQty }
    }
  }

  // Inventory / bank loot
  let banked = {}
  if (type === 'skill' || type === 'gather' || type === 'clue' || type === 'combat') {
    if (Array.isArray(sim.finalInventory)) state.inventory = sim.finalInventory
    banked = sim.lootBanked || sim.itemsBanked || {}
    for (const [itemId, qty] of Object.entries(banked)) bankAdd(bank, itemId, qty)
  } else if (type === 'agility' || type === 'thieving') {
    addCoinsInventoryFirst(state.inventory, bank, Number(sim.coinsGained) || 0)
    // Master Farmer seed rewards (thieving) bank like other idle skill loot.
    if (sim.itemsGained) {
      for (const [itemId, qty] of Object.entries(sim.itemsGained)) bankAdd(bank, itemId, qty)
    }
  } else if (type === 'hunter') {
    for (const reward of sim.rewards || []) bankAdd(bank, reward.itemId, reward.quantity)
  } else if (sim.itemsGained) {
    for (const [itemId, qty] of Object.entries(sim.itemsGained)) bankAdd(bank, itemId, qty)
  }

  return {
    banked,
    stoppedReason: sim.stoppedReason || null,
    ...(type === 'combat' ? {
      died: sim.died === true,
      finalHP: sim.died ? 0 : (Number.isFinite(Number(sim.finalHP)) ? Math.floor(Number(sim.finalHP)) : null),
      monstersKilled: sim.monstersKilled || 0,
    } : {}),
  }
}
