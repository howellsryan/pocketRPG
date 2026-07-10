// Provenance accounting for the 28-slot session pack. Every unit in the pack
// belongs to exactly one pool — the flush path needs to know where a unit came
// from to know what to write to the save:
//   minted      — created in-world (mined, kill loot, unequipped gear). Granted
//                 to the save on flush; never removed from anything.
//   saveBacked  — seeded from the save's inventory at hello. Still IN the save
//                 inventory, so consuming/depositing one must remove it there.
//   bankSourced — withdrawn from the bank this session. Still IN the save bank,
//                 so consuming one removes it there; re-depositing cancels out.
// Invariant: pack count per item === minted + saveBacked + bankSourced.
export type Tally = Record<string, number>

export type ItemPools = {
  minted: Tally
  saveBacked: Tally
  bankSourced: Tally
  /** Save-inventory units eaten/buried/dropped/equipped → remove at flush. */
  consumedSaveBacked: Tally
  /** Bank units eaten/buried/dropped/equipped → remove from bank at flush. */
  consumedBankSourced: Tally
  /** Minted units deposited via the bank UI → grant straight to the bank. */
  mintedToBank: Tally
  /** Save-inventory units deposited → move inventory→bank at flush. */
  depositedSaveBacked: Tally
}

export function emptyPools(saveBacked: Tally = {}): ItemPools {
  return {
    minted: {},
    saveBacked,
    bankSourced: {},
    consumedSaveBacked: {},
    consumedBankSourced: {},
    mintedToBank: {},
    depositedSaveBacked: {},
  }
}

function add(tally: Tally, itemId: string, qty: number): void {
  if (qty > 0) tally[itemId] = (tally[itemId] ?? 0) + qty
}

function take(tally: Tally, itemId: string, qty: number): number {
  const available = tally[itemId] ?? 0
  const taken = Math.min(available, qty)
  if (taken > 0) {
    if (taken === available) delete tally[itemId]
    else tally[itemId] = available - taken
  }
  return taken
}

/** Units leaving the player's possession (eat/bury/drop/equip). Drains minted
 * first (consuming those needs no save mutation at all), then bank-sourced,
 * then save-backed — recording removals the flush must apply. */
export function consumeUnits(pools: ItemPools, itemId: string, qty: number): void {
  let remaining = qty
  remaining -= take(pools.minted, itemId, remaining)
  const fromBank = take(pools.bankSourced, itemId, remaining)
  add(pools.consumedBankSourced, itemId, fromBank)
  remaining -= fromBank
  const fromSave = take(pools.saveBacked, itemId, remaining)
  add(pools.consumedSaveBacked, itemId, fromSave)
}

/** Units created in-world entering the pack (mining, loot, unequipped gear). */
export function mintUnits(pools: ItemPools, itemId: string, qty: number): void {
  add(pools.minted, itemId, qty)
}

/** Pack → bank. Bank-sourced units cancel silently (they never left the save's
 * bank); minted units become direct bank grants; save-backed units become
 * inventory→bank moves. */
export function depositUnits(pools: ItemPools, itemId: string, qty: number): void {
  let remaining = qty
  remaining -= take(pools.bankSourced, itemId, remaining)
  const fromMinted = take(pools.minted, itemId, remaining)
  add(pools.mintedToBank, itemId, fromMinted)
  remaining -= fromMinted
  const fromSave = take(pools.saveBacked, itemId, remaining)
  add(pools.depositedSaveBacked, itemId, fromSave)
}

/** Bank → pack. */
export function withdrawUnits(pools: ItemPools, itemId: string, qty: number): void {
  add(pools.bankSourced, itemId, qty)
}
