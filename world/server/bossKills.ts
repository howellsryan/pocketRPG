// Server-authoritative side-effects of a world boss kill (§14). The main game's
// /api/actions/monster/complete records a boss kill's collection-log uniques,
// kill count and audit row; world kills only spawned floor loot and flushed the
// item onto the trusted save blob, so a world-dropped unique never hit the
// collection log and no boss KC ever incremented. This records the same
// authoritative log/count/audit. The loot item itself still rides the save blob
// (the deliberate §14 world exception) — this does not re-grant it.
import monstersData from '../../src/data/monsters.json'
import { isValidEntry } from '../../functions/_lib/collectionLog.js'
import { auditLog } from '../../functions/_lib/game/audit.js'
import { epicDropsFrom } from '../../src/engine/lootBroadcast.js'

type Monsters = Record<string, { boss?: boolean } | undefined>
const monsters = monstersData as Monsters

export type BossKill = { monsterId: string; owner: string; loot: { itemId: string; quantity: number }[] }

export type BossKillIO = {
  auditLog: (env: unknown, eventType: string, payload: Record<string, unknown>) => Promise<void>
}
const defaultIO: BossKillIO = { auditLog }

/** True for a monster the world must record authoritatively on death. Only
 * bosses carry collection-log slots / kill counts — regular monster kills ride
 * the save blob, exactly as in the main game. */
export function isBossMonster(monsterId: string): boolean {
  return monsters[monsterId]?.boss === true
}

/** Collection-log-eligible unique item ids in a kill's loot (deduped), for the
 * given boss. Shared by the collection-log write below and the zone-wide
 * unique-drop broadcast (item 11) so both agree on what counts as a "unique". */
export function uniqueDropsFrom(monsterId: string, loot: { itemId: string; quantity: number }[]): string[] {
  return [...new Set(loot.map((l) => l.itemId))].filter((itemId) => isValidEntry('monsters', monsterId, itemId))
}

/**
 * Everything in a kill worth announcing zone-wide, deduped: a boss's
 * collection-log uniques, plus any item past the purple-loot threshold from any
 * kill at all — the value is the reason to shout, not the monster. `epic` marks
 * the latter, and a boss unique that is ALSO legendary announces once, as epic.
 */
export function dropBroadcastsFrom(
  monsterId: string,
  loot: { itemId: string; quantity: number }[],
  itemsData: unknown,
): { itemId: string; epic: boolean }[] {
  const epic = new Set(epicDropsFrom(loot, itemsData))
  const ids = isBossMonster(monsterId)
    ? new Set([...uniqueDropsFrom(monsterId, loot), ...epic])
    : epic
  return [...ids].map((itemId) => ({ itemId, epic: epic.has(itemId) }))
}

/** Records a world boss kill: collection-log uniques from the drop (idempotent),
 * the boss kill count (monotonic), and an audit row. No-op for non-boss monsters
 * or an unresolved owner. Mirrors _completeShared's source_type ('monsters') so
 * world kills land in the same rows the main game would write. */
export async function recordBossKill(env: { DB: D1Database }, kill: BossKill, io: BossKillIO = defaultIO): Promise<void> {
  if (!isBossMonster(kill.monsterId)) return
  const characterId = Number(kill.owner)
  if (!Number.isInteger(characterId) || characterId <= 0) return
  const now = Date.now()

  const uniqueItemIds = uniqueDropsFrom(kill.monsterId, kill.loot)
  if (uniqueItemIds.length > 0) {
    await env.DB.batch(
      uniqueItemIds.map((itemId) =>
        env.DB.prepare(
          `INSERT INTO collection_log (character_id, item_id, source_type, source_id, obtained_at)
           VALUES (?, ?, 'monsters', ?, ?)
           ON CONFLICT(character_id, item_id, source_type, source_id) DO NOTHING`
        ).bind(characterId, itemId, kill.monsterId, now)
      )
    )
  }

  const row = await env.DB.prepare(
    `INSERT INTO kill_counts (character_id, source_type, source_id, kill_count, updated_at)
     VALUES (?, 'monsters', ?, 1, ?)
     ON CONFLICT(character_id, source_type, source_id)
     DO UPDATE SET kill_count = kill_count + 1, updated_at = excluded.updated_at
     RETURNING kill_count`
  ).bind(characterId, kill.monsterId, now).first<{ kill_count: number }>()
  const killCount = Math.max(0, Math.floor(Number(row?.kill_count) || 0))

  await io.auditLog(env, 'world_boss_kill', {
    characterId,
    monsterId: kill.monsterId,
    killCount,
    collectionLog: uniqueItemIds,
  })
}
