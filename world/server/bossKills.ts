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

/** Records a world boss kill's collection-log uniques (idempotent) and an audit
 * row. No-op for non-boss monsters or an unresolved owner. Mirrors
 * _completeShared's source_type ('monsters') so world kills land in the same
 * rows the main game would write.
 *
 * The KILL COUNT is deliberately not here: every monster earns one, boss or
 * not, and one D1 round trip per trash kill per player is not affordable — it
 * is tallied on the session and flushed in a batch by recordKillCounts below. */
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

  await io.auditLog(env, 'world_boss_kill', {
    characterId,
    monsterId: kill.monsterId,
    collectionLog: uniqueItemIds,
  })
}

/**
 * Applies a session's tally of kills to the kill_counts table, one batched
 * upsert per monster.
 *
 * Every monster counts out here, not just bosses: the world resolves its own
 * combat, so this is a server-authoritative count in the same table the boss
 * entry gates read (§14) — nothing about it is client-trusted. The idle game's
 * ordinary kills still go uncounted, because counting them there would mean
 * either a cloud write per cow (§6 forbids it) or a client-reported number
 * feeding a gate.
 */
export async function recordKillCounts(
  env: { DB: D1Database },
  characterId: number,
  tally: Record<string, number>,
  now = Date.now(),
): Promise<void> {
  if (!Number.isInteger(characterId) || characterId <= 0) return
  const entries = Object.entries(tally || {}).filter(([, count]) => Math.floor(Number(count) || 0) > 0)
  if (entries.length === 0) return
  await env.DB.batch(
    entries.map(([monsterId, count]) =>
      env.DB.prepare(
        `INSERT INTO kill_counts (character_id, source_type, source_id, kill_count, updated_at)
         VALUES (?, 'monsters', ?, ?, ?)
         ON CONFLICT(character_id, source_type, source_id)
         DO UPDATE SET kill_count = kill_count + excluded.kill_count, updated_at = excluded.updated_at`
      ).bind(characterId, monsterId, Math.floor(Number(count) || 0), now)
    )
  )
}
