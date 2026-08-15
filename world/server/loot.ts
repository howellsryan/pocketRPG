// Floor loot: entities dropped on a death tile, owner-only for a window, then
// public, then despawned. Visibility is enforced server-side when building each
// client's diff (WorldZone diffs each player's visible set tick-to-tick, which
// naturally handles the owner→public transition, pickup and despawn).
import type { InvSlot, LootItem } from '../shared/protocol'
import { addToInventory, isStackable } from './mining'

export type LootEntity = {
  id: string
  itemId: string
  qty: number
  x: number
  z: number
  ownerCharId: string
  spawnTick: number
  /** Owner-only window override (player drops go public faster than kill loot). */
  ownerTicks?: number
  /** This stack came off a player killed in the Wilderness. A self-sufficient
   * account may never take it — not even when they are the killer who owns it —
   * because every unit in it was earned on somebody else's account. Bot drops
   * carry no flag: those are a drop table, and rolling one has earned it. */
  fromPlayer?: boolean
}

export const LOOT_OWNER_TICKS = 100
export const LOOT_DESPAWN_TICKS = 300
/** A player-dropped item shows for everyone after ~10s (spec: drop visibility). */
export const PLAYER_DROP_OWNER_TICKS = 17
/**
 * A Wilderness KILL's pile is the killer's for ~36s, not the 10s a voluntarily
 * dropped item gets. Pickup is one item per tick and a death can put a 28-slot
 * pack plus eleven worn pieces on one tile (each non-stackable unit is its own
 * entity — see spawnDrops), so 39 ticks of clicking is the realistic worst
 * case: at 17 the loot a player actually won went public while they were still
 * bending down for it, and the fight was decided by whoever loitered nearby.
 */
export const KILL_DROP_OWNER_TICKS = 60

let lootSeq = 0

/** Turns rolled drops into loot entities at the death tile, owned by the killer
 * for the owner window. Zero-quantity rolls are skipped.
 *
 * A NON-STACKABLE drop becomes one entity per unit, never a single qty-N pile.
 * Three sharks in the pack are three things on the floor, so the take menu lists
 * three rows and a killer with two free slots gets two of them instead of the
 * whole stack failing at addToInventory. It is also what makes `qty > 1` mean
 * "this is a stack" everywhere downstream — the client renders the count on that
 * rule alone and never needs the item table to decide. */
export function spawnDrops(
  drops: { itemId: string; quantity: number }[],
  x: number,
  z: number,
  ownerCharId: string,
  tick: number,
  ownerTicks?: number,
  opts?: { fromPlayer?: boolean }
): LootEntity[] {
  const out: LootEntity[] = []
  for (const drop of drops) {
    if (!drop.itemId || drop.quantity < 1) continue
    const stackable = isStackable(drop.itemId)
    const piles = stackable ? 1 : Math.floor(drop.quantity)
    const per = stackable ? Math.floor(drop.quantity) : 1
    for (let i = 0; i < piles; i++) {
      const loot: LootEntity = { id: `loot_${++lootSeq}`, itemId: drop.itemId, qty: per, x, z, ownerCharId, spawnTick: tick }
      if (ownerTicks !== undefined) loot.ownerTicks = ownerTicks
      if (opts?.fromPlayer) loot.fromPlayer = true
      out.push(loot)
    }
  }
  return out
}

/** Who is looking at the floor. Passed as an object rather than a charId + flag
 * so adding an account rule here is a compile error at every call site instead
 * of a silently permissive default. */
export type LootViewer = { charId: string; isIronman: boolean; isGrindman: boolean }

/**
 * Accounts that may only ever hold what they earned themselves. Ironman is the
 * original; Grindman rides on the same rule because its triple drop rates are
 * paid for with half XP, and loot handed over by another player is a grind the
 * account never did. Every floor-loot rule below reads this, never a mode flag,
 * so a third self-sufficient mode is one line here.
 */
export function takesOwnLootOnly(viewer: LootViewer): boolean {
  return viewer.isIronman || viewer.isGrindman
}

/** The refusal, naming the mode that caused it — a player who reads "Ironman"
 * on a Grindman account learns nothing about their own restriction. */
export function ownLootOnlyMessage(viewer: LootViewer): string {
  return viewer.isGrindman && !viewer.isIronman
    ? 'Grindman characters can only take their own loot.'
    : 'Ironman characters can only take their own loot.'
}

export function isExpired(loot: LootEntity, tick: number): boolean {
  return tick - loot.spawnTick >= LOOT_DESPAWN_TICKS
}

/** A self-sufficient account may only ever have loot they own — a public window
 * never opens for them, so another player cannot hand them items by dropping on
 * the floor (the world equivalent of the Trading Post ban). Their own drops and
 * kill loot are unaffected. */
export function isOwnedBy(loot: LootEntity, viewer: LootViewer): boolean {
  return loot.ownerCharId === viewer.charId
}

/** The account rule at the moment of pickup, deliberately independent of
 * isVisibleTo: a restricted account may only take loot they own. Visibility
 * already hides it, so this only fires on a stale client view, a replayed take,
 * or a future change to the windows above — none of which may put the item in
 * the pack. Checked immediately before the inventory mutation, so it is the
 * last word. */
export function mayTake(loot: LootEntity, viewer: LootViewer): boolean {
  if (!takesOwnLootOnly(viewer)) return true
  // Ownership is not enough for a player kill: winning a fight in the
  // Wilderness still does not let these accounts pick the loser's account up
  // off the floor. They keep the fight, the rank and every bot drop — this is
  // the one thing the modes cost them.
  if (loot.fromPlayer) return false
  return isOwnedBy(loot, viewer)
}

/** Owner-only until the owner window elapses, then visible to everyone (until
 * despawn, which the caller removes separately) — except to a restricted
 * account, for whom loot they don't own never becomes visible at all. */
export function isVisibleTo(loot: LootEntity, viewer: LootViewer, tick: number): boolean {
  if (isExpired(loot, tick)) return false
  if (takesOwnLootOnly(viewer) && loot.fromPlayer) return false
  if (takesOwnLootOnly(viewer) && !isOwnedBy(loot, viewer)) return false
  if (tick - loot.spawnTick < (loot.ownerTicks ?? LOOT_OWNER_TICKS)) return isOwnedBy(loot, viewer)
  return true
}

/** Picks loot into the 28-slot pack. Inventory-first rule (§ STEP 2.4): a
 * successful take MUST also count the units as world-minted, or the flush path
 * treats them as neither save-backed nor minted and silently drops them on
 * deposit/disconnect. Coupling both mutations here makes that impossible to
 * forget at a call site. Returns false (pack full) without changing anything. */
export function takeLoot(inventory: InvSlot[], minted: Record<string, number>, itemId: string, qty: number): boolean {
  if (!addToInventory(inventory, itemId, qty)) return false
  minted[itemId] = (minted[itemId] ?? 0) + qty
  return true
}

/** The loot list to send a given client: everything currently visible to them.
 * (WorldZone compares this to the client's last view to derive add/remove.) */
export function visibleLootFor(loot: Iterable<LootEntity>, viewer: LootViewer, tick: number): LootItem[] {
  const out: LootItem[] = []
  for (const l of loot) {
    if (isVisibleTo(l, viewer, tick)) out.push({ id: l.id, itemId: l.itemId, qty: l.qty, x: l.x, z: l.z })
  }
  return out
}
