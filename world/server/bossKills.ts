// Server-authoritative side-effects of a world kill (§14). The main game's
// /api/actions/monster/complete records a kill's collection-log uniques, kill
// count and audit row; world kills only spawned floor loot and flushed the item
// onto the trusted save blob, so a world-dropped unique never hit the collection
// log and no KC ever incremented. This records the same authoritative
// log/count/audit. The loot item itself still rides the save blob (the
// deliberate §14 world exception) — this does not re-grant it.
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

/** True for a monster with a boss's rules — kept for the callers that branch on
 * it (respawn timing, leash, the zone-wide kill feed). It is deliberately NOT
 * what decides whether a kill is recorded: a collection-log slot belongs to
 * whichever monster drops the item, boss or not. */
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

/**
 * Records a world kill's collection-log uniques (idempotent) and an audit row.
 * Mirrors _completeShared's source_type ('monsters') so world kills land in the
 * same rows the main game would write.
 *
 * Gated on the DROP, not on the monster: solo fills a log slot for any monster
 * that owns one — a Black Dragon's visage is a logged unique and its killer is
 * not a boss — so gating this on `boss` left exactly those slots unfillable in
 * the world. `uniqueDropsFrom` is a pure filter over the drop, so an ordinary
 * kill with nothing logged reaches no D1 at all and a grind costs nothing.
 *
 * The KILL COUNT is deliberately not here: every monster earns one, boss or
 * not, and one D1 round trip per trash kill per player is not affordable — it
 * is tallied on the session and flushed in a batch by recordKillCounts below.
 */
export async function recordBossKill(env: { DB: D1Database }, kill: BossKill, io: BossKillIO = defaultIO): Promise<void> {
  const uniqueItemIds = uniqueDropsFrom(kill.monsterId, kill.loot)
  const isBoss = isBossMonster(kill.monsterId)
  // An ordinary kill that dropped nothing logged is the overwhelmingly common
  // case and must cost nothing. A boss still audits its kill either way.
  if (uniqueItemIds.length === 0 && !isBoss) return
  const characterId = Number(kill.owner)
  if (!Number.isInteger(characterId) || characterId <= 0) return
  const now = Date.now()

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
    boss: isBoss,
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
