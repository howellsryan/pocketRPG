import { getTotalLevelFromSave } from '../saveSummary.js'

// Total-level regression guard. PocketRPG XP is monotonic — XP only ever
// increases (capped at 200M) and every skill level is derived from it (1–99),
// so there is NO legitimate gameplay path that lowers a character's total
// level. A save whose total level falls below the stored save is the
// signature of a fresh / "level 3" character being written over a real one
// (e.g. a boot that mistook a failed cloud read for "no save yet" and flushed
// a new game). Callers reject the write so that class of bug can never wipe a
// live character. A null/empty next save counts as total level 0.
export function detectTotalLevelRegression(previousSave = {}, nextSave = {}) {
  const previousTotalLevel = getTotalLevelFromSave(previousSave)
  const nextTotalLevel = getTotalLevelFromSave(nextSave)
  return {
    regressed: nextTotalLevel < previousTotalLevel,
    previousTotalLevel,
    nextTotalLevel,
  }
}

// Bank-wipe guard. The bank rides the client-trusted save blob (§14) and lives
// in its own IndexedDB store client-side, so a client-side load/migration bug
// or a stale/empty snapshot can push a save whose `bank` has collapsed to
// nothing — silently overwriting a real, item-full bank on the cloud (the
// total-level guard above never fires because bank contents don't move total
// level). This backstop rejects that write.
//
// The signature we reject is not merely "bank got smaller" — withdrawing a
// whole bank into the 28-slot inventory legitimately empties it, and idle
// combat / alching / shop spends legitimately consume stacks. The tell of a
// WIPE is that a large set of previously-banked items vanished from EVERY
// container at once (bank AND inventory AND equipment): items that were moved
// still show up in inventory/equipment, whereas a wipe makes them disappear
// entirely. We require a substantial prior bank and a near-total vanish so
// the guard never trips on real play.
const BANK_WIPE_MIN_PREVIOUS_ITEMS = 15
const BANK_WIPE_VANISHED_FRACTION = 0.9

function bankItemIds(bank) {
  const ids = new Set()
  if (!bank || typeof bank !== 'object') return ids
  for (const key of Object.keys(bank)) {
    const entry = bank[key]
    const qty = entry && typeof entry === 'object' ? Number(entry.quantity) : Number(entry)
    if (!Number.isFinite(qty) || qty > 0) {
      ids.add(entry && typeof entry === 'object' && entry.itemId ? entry.itemId : key)
    }
  }
  return ids
}

// Every distinct itemId the save is holding anywhere — bank ∪ inventory ∪
// equipment. Used to tell "moved to inventory" (still held) from "vanished".
function allHeldItemIds(save) {
  const ids = new Set(bankItemIds(save && save.bank))
  const inv = save && save.inventory
  if (Array.isArray(inv)) {
    for (const slot of inv) {
      if (slot && slot.itemId) {
        const qty = Number(slot.quantity)
        if (!Number.isFinite(qty) || qty > 0) ids.add(slot.itemId)
      }
    }
  }
  const eq = save && save.equipment
  if (eq && typeof eq === 'object') {
    for (const slot of Object.keys(eq)) {
      const entry = eq[slot]
      if (entry && entry.itemId) ids.add(entry.itemId)
    }
  }
  return ids
}

export function detectBankWipe(previousSave = {}, nextSave = {}) {
  const previousBankIds = bankItemIds(previousSave && previousSave.bank)
  const previousCount = previousBankIds.size
  const nextHeld = allHeldItemIds(nextSave)
  let vanishedCount = 0
  for (const id of previousBankIds) if (!nextHeld.has(id)) vanishedCount++
  const vanishedFraction = previousCount > 0 ? vanishedCount / previousCount : 0
  const wiped = previousCount >= BANK_WIPE_MIN_PREVIOUS_ITEMS &&
                vanishedFraction >= BANK_WIPE_VANISHED_FRACTION
  return {
    wiped,
    previousCount,
    nextBankCount: bankItemIds(nextSave && nextSave.bank).size,
    vanishedCount,
    vanishedFraction,
  }
}
