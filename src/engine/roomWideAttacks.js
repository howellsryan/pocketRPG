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
 * The same clock for the boss's MINION, which strikes the room alongside it —
 * a minion is the boss's reach, not a separate duellist.
 *
 * Returns false when there is no minion, and clears the clock so the next one
 * to spawn gets a full wind-up instead of inheriting the dead one's countdown.
 */
export function advanceAddAttackTimer(boss) {
  const add = boss?.add
  if (!add) {
    if (boss) boss.addAttackTimer = null
    return false
  }
  const speed = Math.max(1, Math.floor(Number(add.attackSpeed) || 4))
  // `null` is the cleared clock, and Number(null) is a finite 0 — reading it as
  // a countdown would swing a just-spawned minion on its first tick.
  const stored = boss.addAttackTimer
  const current = stored == null || !Number.isFinite(Number(stored)) ? speed : Number(stored)
  const next = current - 1
  if (next > 0) {
    boss.addAttackTimer = next
    return false
  }
  boss.addAttackTimer = speed
  return true
}
