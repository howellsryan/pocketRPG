// Floor loot: entities dropped on a death tile, owner-only for a window, then
// public, then despawned. Visibility is enforced server-side when building each
// client's diff (WorldZone diffs each player's visible set tick-to-tick, which
// naturally handles the owner→public transition, pickup and despawn).
import type { InvSlot, LootItem } from '../shared/protocol'
import { addToInventory } from './mining'

export type LootEntity = {
  id: string
  itemId: string
  qty: number
  x: number
  z: number
  ownerCharId: string
  spawnTick: number
}

export const LOOT_OWNER_TICKS = 100
export const LOOT_DESPAWN_TICKS = 300

let lootSeq = 0

/** Turns rolled drops into loot entities at the death tile, owned by the killer
 * for the owner window. Zero-quantity rolls are skipped. */
export function spawnDrops(
  drops: { itemId: string; quantity: number }[],
  x: number,
  z: number,
  ownerCharId: string,
  tick: number
): LootEntity[] {
  const out: LootEntity[] = []
  for (const drop of drops) {
    if (!drop.itemId || drop.quantity < 1) continue
    out.push({ id: `loot_${++lootSeq}`, itemId: drop.itemId, qty: drop.quantity, x, z, ownerCharId, spawnTick: tick })
  }
  return out
}

export function isExpired(loot: LootEntity, tick: number): boolean {
  return tick - loot.spawnTick >= LOOT_DESPAWN_TICKS
}

/** Owner-only until the owner window elapses, then visible to everyone (until
 * despawn, which the caller removes separately). */
export function isVisibleTo(loot: LootEntity, charId: string, tick: number): boolean {
  if (isExpired(loot, tick)) return false
  if (tick - loot.spawnTick < LOOT_OWNER_TICKS) return loot.ownerCharId === charId
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
export function visibleLootFor(loot: Iterable<LootEntity>, charId: string, tick: number): LootItem[] {
  const out: LootItem[] = []
  for (const l of loot) {
    if (isVisibleTo(l, charId, tick)) out.push({ id: l.id, itemId: l.itemId, qty: l.qty, x: l.x, z: l.z })
  }
  return out
}
