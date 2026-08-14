// A world kill's drops, once per player who earned it.
//
// The killer's own roll comes out of the combat engine with the death event, so
// that one is already done by the time a kill reaches here. This is everyone
// ELSE past the 10% line (killCredit.js): each gets an independent roll of the
// same table, exactly as a co-op room pays its winners — not a share of one
// drop. Their pile is spawned under their own ownership, so the existing floor
// rules (loot.ts `isVisibleTo`) hide it from everyone else for the owner window
// without anything new: two players who fought the same dragon walk away with
// two piles on one tile and never see each other's.
//
// On task is decided PER PLAYER, which is the whole reason this is not a single
// roll copied N times: a task-only drop (the Imbued Crown and Brain) must roll
// only for someone who actually has this monster assigned.
import { rollDrops } from '../../src/engine/combat.js'
import { doesSlayerTaskMatchMonster } from '../../src/engine/slayerTasks.js'
import monstersData from '../../src/data/monsters.json'

export type Drop = { itemId: string; quantity: number }

/** What a caller must tell us about each player who earned the kill. */
export type CreditedPlayer = {
  charId: string
  /** Their own slayer task, or null — never the killer's. */
  slayerTask: { monsterId?: string } | null
}

export type CreditedRoll = { charId: string; loot: Drop[] }

/** Does this monster count toward that player's task? Same predicate the solo
 * screen and the engine use, so task-only drops behave identically out here. */
export function isOnTaskFor(slayerTask: { monsterId?: string } | null, monsterId: string): boolean {
  const taskMonsterId = slayerTask?.monsterId
  if (!taskMonsterId) return false
  return doesSlayerTaskMatchMonster(taskMonsterId, monsterId) === true
}

/**
 * One roll per credited player, skipping `ownerCharId` — whose loot the engine
 * already rolled and whose pile is already on the floor.
 *
 * `roll` is injectable so a test can pin the table; production passes nothing
 * and gets the engine's own `rollDrops`, which is what makes these piles the
 * same table the killer rolled rather than a second implementation of it.
 */
export function rollLootForCredited(
  monsterId: string,
  credited: CreditedPlayer[],
  ownerCharId: string,
  roll: (monster: unknown, isOnTask: boolean) => Drop[] = rollDrops as never,
): CreditedRoll[] {
  const monster = (monstersData as Record<string, unknown>)[monsterId]
  if (!monster) return []
  const out: CreditedRoll[] = []
  const seen = new Set<string>([ownerCharId])
  for (const player of credited) {
    if (!player?.charId || seen.has(player.charId)) continue
    seen.add(player.charId)
    const loot = roll(monster, isOnTaskFor(player.slayerTask, monsterId)) || []
    if (loot.length > 0) out.push({ charId: player.charId, loot })
  }
  return out
}
