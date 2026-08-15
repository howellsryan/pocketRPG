// @ts-check
import { getLevelFromXP } from './experience.js'
import { bankXp } from './xpBank.js'

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
 * @property {number} [chargesConsumed]                  combat, and skill (shardglass gather tools).
 * @property {Record<string, number>} [armourChargesConsumed] combat only (shardglass armour, per equipped slot).
 * @property {Record<string, number>} [itemsConsumed]    bank items spent.
 * @property {Array<any>} [finalInventory]               replaces inventory (skill/gather/clue/combat).
 * @property {Record<string, number>} [lootBanked]       ADDITIVE bank loot.
 * @property {Record<string, number>} [itemsBanked]      ADDITIVE bank loot (alias).
 * @property {Record<string, number>} [chargesBanked]    ADDITIVE charges carried in by banked items.
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
// { banked, consumed, stoppedReason, died?, finalHP?, monstersKilled? }
// `consumed` is what this call actually took out of holdings — the declared half
// of the item-loss ledger (src/engine/lossLedger.js); callers route it to the
// client ledger or to writeSave's declaredLosses.

// `charges` pools an auto-banked item's charges onto the entry. Never write an
// explicit 0 for an item carrying none: an absent field means "untouched" to
// preserveBankCharges, an explicit 0 would wipe a pool this call knows nothing
// about (src/engine/bankCharges.js).
/** @param {Record<string, any>} bank @param {string} itemId @param {number} qty @param {number} [charges] */
function bankAdd(bank, itemId, qty, charges = 0) {
  if (qty <= 0) return
  const existing = bank[itemId]
  const entry = existing
    ? { ...existing, quantity: (Number(existing.quantity) || 0) + qty }
    : { itemId, quantity: qty }
  const incoming = Math.max(0, Math.floor(Number(charges) || 0))
  if (incoming > 0) entry.charges = (Math.max(0, Math.floor(Number(entry.charges) || 0))) + incoming
  bank[itemId] = entry
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
 * `isGrindman` halves the XP this result banks. The cut belongs to whatever
 * funnel writes XP INTO the stats — this one, or the client's grantXP — never
 * to the simulation, which would double-cut on the paths that use both.
 *
 * @param {{stats?: any, inventory?: any[], bank?: any, equipment?: any, settings?: any}} state
 * @param {TaskResult} sim
 * @param {string} type
 * @param {{isGrindman?: boolean}} [options]
 */
export function applyTaskResult(state, sim, type, { isGrindman = false } = {}) {
  if (!state.stats || typeof state.stats !== 'object') state.stats = {}
  if (!state.bank || typeof state.bank !== 'object') state.bank = {}
  if (!state.equipment || typeof state.equipment !== 'object') state.equipment = {}
  if (!state.settings || typeof state.settings !== 'object') state.settings = {}
  if (!Array.isArray(state.inventory)) state.inventory = new Array(28).fill(null)

  const { stats, bank, equipment, settings } = state

  // Units this call actually removes from holdings, for the declared-loss ledger
  // (src/engine/lossLedger.js). Tallied from what LEFT, never from what the sim
  // asked for: every debit below is clamped by what the container held.
  /** @type {Record<string, number>} */
  const consumed = {}
  // What this call actually WROTE into the stats, per skill — the Grindman cut
  // makes it differ from sim.xpGained, and the caller reports one of the two.
  /** @type {Record<string, number>} */
  const xpBanked = {}
  /** @param {string} itemId @param {number} qty */
  const tally = (itemId, qty) => {
    if (itemId && qty > 0) consumed[itemId] = (consumed[itemId] || 0) + qty
  }

  // XP (all non-quest types)
  if (type !== 'quest' && sim.xpGained) {
    for (const [skill, xp] of Object.entries(sim.xpGained)) {
      if (xp > 0) {
        const banked = bankXp(stats, skill, xp, { isGrindman })
        if (banked > 0) xpBanked[skill] = banked
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
      const held = Number(equipment.ammo.quantity) || 0
      const remaining = Math.max(0, held - sim.ammoConsumed.quantity)
      equipment.ammo = remaining > 0 ? { ...equipment.ammo, quantity: remaining } : null
      tally(sim.ammoConsumed.itemId, held - remaining)
    }

    // Scale-charged armour (shardglass) drains one charge per worn piece per hit.
    if (sim.armourChargesConsumed && typeof sim.armourChargesConsumed === 'object') {
      for (const [slot, qty] of Object.entries(sim.armourChargesConsumed)) {
        const piece = equipment[slot]
        if (piece && (qty || 0) > 0) {
          const remaining = Math.max(0, (Number(piece.charges) || 0) - qty)
          equipment[slot] = { ...piece, charges: remaining }
        }
      }
    }
  }

  // Weapon charge drain: combat swings and the shardglass gather perk (skill
  // type, mining/woodcutting) both report chargesConsumed against the
  // equipped weapon the same way.
  if (type === 'combat' || type === 'skill') {
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
      const had = Number(existing.quantity) || 0
      const newQty = had - qty
      if (newQty <= 0) delete bank[itemId]
      else bank[itemId] = { ...existing, quantity: newQty }
      tally(itemId, had - Math.max(0, newQty))
    }
  }

  // Inventory / bank loot
  let banked = {}
  if (type === 'skill' || type === 'gather' || type === 'clue' || type === 'combat') {
    if (Array.isArray(sim.finalInventory)) state.inventory = sim.finalInventory
    banked = sim.lootBanked || sim.itemsBanked || {}
    const bankedCharges = sim.chargesBanked || {}
    for (const [itemId, qty] of Object.entries(banked)) bankAdd(bank, itemId, qty, bankedCharges[itemId])
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
    consumed,
    xpBanked,
    stoppedReason: sim.stoppedReason || null,
    ...(type === 'combat' ? {
      died: sim.died === true,
      finalHP: sim.died ? 0 : (Number.isFinite(Number(sim.finalHP)) ? Math.floor(Number(sim.finalHP)) : null),
      monstersKilled: sim.monstersKilled || 0,
    } : {}),
  }
}
