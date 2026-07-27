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

// ---------------------------------------------------------------------------
// Flush bookkeeping
//
// The three functions below are the whole handshake between the pools and a
// grant flush, and they live here rather than in WorldZone because the zone is
// a Durable Object the test harness cannot import — which is how the bug they
// fix shipped unnoticed.
//
// `minted` is the one pool with nothing backing it outside this DO's memory: a
// save-backed unit is still in the save's inventory and a bank-sourced one is
// still in the save's bank, but a minted one exists nowhere else until a flush
// grants it. It therefore rides EVERY flush. Granting it only on `disconnect`
// was the bug: taking gear off mints it into the pack AND marks equipment
// dirty, and the equipment snapshot flushed on the 3s timer while the minted
// unit waited. From that flush until a clean disconnect the item was in neither
// the save's equipment nor its inventory, so any session that ended without a
// disconnect flush destroyed it outright.
//
// `bankSourced` stays disconnect/transition-only on purpose: a withdrawn unit is
// still in the save's bank, so losing the DO returns it to the bank rather than
// deleting it.

export type ItemStack = { itemId: string; quantity: number }

/** The pool state a flush claimed, held so it can be committed or put back. */
export type DrainedFlush = {
  items: ItemStack[]
  moveToBank: ItemStack[]
  removeFromInventory: ItemStack[]
  removeFromBank: ItemStack[]
  mintedToBank: ItemStack[]
  bankToInventory: ItemStack[]
}

export type FlushReason = 'deposit' | 'disconnect' | 'timer' | 'transition'

function toItemList(tally: Tally): ItemStack[] {
  return Object.entries(tally)
    .filter(([, quantity]) => quantity > 0)
    .map(([itemId, quantity]) => ({ itemId, quantity }))
}

function mergeInto(target: Tally, items: ItemStack[]): void {
  for (const item of items) add(target, item.itemId, item.quantity)
}

/**
 * Claims every pending pool mutation for one flush, clearing them so the next
 * flush cannot double-count. `minted` is emptied IN PLACE: the record is
 * aliased by TickPlayer.minted (mining and loot pickups write through that
 * reference), so reassigning would sever the alias and silently stop counting
 * everything gathered afterwards.
 */
export function drainForFlush(pools: ItemPools, reason: FlushReason): DrainedFlush {
  const drained: DrainedFlush = {
    items: toItemList(pools.minted),
    moveToBank: toItemList(pools.depositedSaveBacked),
    removeFromInventory: toItemList(pools.consumedSaveBacked),
    removeFromBank: toItemList(pools.consumedBankSourced),
    mintedToBank: toItemList(pools.mintedToBank),
    bankToInventory: [],
  }
  for (const key of Object.keys(pools.minted)) delete pools.minted[key]
  pools.depositedSaveBacked = {}
  pools.consumedSaveBacked = {}
  pools.consumedBankSourced = {}
  pools.mintedToBank = {}
  if (reason === 'disconnect' || reason === 'transition') {
    drained.bankToInventory = toItemList(pools.bankSourced)
    pools.bankSourced = {}
  }
  return drained
}

/** The grant landed. Minted units are in the save's inventory from now on, so
 * consuming one has to remove it there rather than draining a tally that
 * nothing backs. */
export function commitFlush(pools: ItemPools, drained: DrainedFlush): void {
  mergeInto(pools.saveBacked, drained.items)
}

/** The grant failed. Put every claimed mutation back so the next flush retries
 * it — including the minted units, which stay minted until a flush lands. */
export function restoreFlush(pools: ItemPools, drained: DrainedFlush): void {
  mergeInto(pools.minted, drained.items)
  mergeInto(pools.depositedSaveBacked, drained.moveToBank)
  mergeInto(pools.consumedSaveBacked, drained.removeFromInventory)
  mergeInto(pools.consumedBankSourced, drained.removeFromBank)
  mergeInto(pools.mintedToBank, drained.mintedToBank)
  mergeInto(pools.bankSourced, drained.bankToInventory)
}
