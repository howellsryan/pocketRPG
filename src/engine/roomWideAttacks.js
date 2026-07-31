/**
 * A boss that swings at everybody present rather than at one target.
 *
 * Its own module because two independent servers run this mechanic — the co-op
 * room (src/engine/coopBossEngine.js) and the open world
 * (world/server/combat.ts) — and each rebuilds a per-player combat session every
 * tick. The clock therefore cannot live on those sessions: they would each run
 * their own copy and the boss would swing once per player instead of once per
 * room. Whoever owns the shared monster record owns the clock and calls
 * `advanceRoomWideAttackTimer` exactly once a tick, before the sessions run.
 *
 * Pure logic, no imports.
 */

/** Data-driven, so opening the mechanic to another boss is a monsters.json edit. */
export function isRoomWideAttacker(monster) {
  return !!monster?.roomWideAttacks
}

/**
 * Advances the shared attack clock and answers whether it swings this tick.
 * An absent timer is a record that predates the mechanic — start it at the
 * boss's own speed rather than 0, which would swing the instant it reloads.
 */
export function advanceRoomWideAttackTimer(boss) {
  const speed = Math.max(1, Math.floor(Number(boss?.attackSpeed) || 4))
  const stored = boss?.attackTimer
  const current = stored == null || !Number.isFinite(Number(stored)) ? speed : Number(stored)
  const next = current - 1
  if (next > 0) {
    boss.attackTimer = next
    return false
  }
  boss.attackTimer = speed
  return true
}

/**
 * The same clock for each of the boss's MINIONS, which strike the room alongside
 * it — a minion is the boss's reach, not a separate duellist.
 *
 * Each add carries its own `attackTimer`, so the clock rides the add itself and
 * dies with it: a replacement gets a full wind-up rather than inheriting the
 * countdown of the one it replaced. Returns one flag per add, in list order.
 */
export function advanceAddAttackTimers(boss) {
  const adds = Array.isArray(boss?.adds) ? boss.adds : []
  return adds.map((add) => (add ? advanceRoomWideAttackTimer(add) : false))
}
