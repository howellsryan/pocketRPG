// Who a kill counts for.
//
// One rule, one place. A kill is worth four things — its loot, a kill count,
// progress on your slayer task, and whatever daily tasks it feeds — and every
// one of them is earned by the same threshold: 10% of the health pool the fight
// was measured against. Co-op and the open world both run on this; before it
// they disagreed three ways (co-op paid loot at 10% but counted kills and
// slayer for anyone alive who swung, and the world credited nothing but the
// top-damage player), so the same fight paid differently depending on which
// screen you fought it from.
//
// Pure and dependency-free, so the co-op room and the world zone can both run it
// inside a Durable Object.

export const KILL_CREDIT_DAMAGE_SHARE = 0.1

/**
 * Damage that earns credit against a health pool.
 *
 * Ceil, against the §4 round-with-floor house rule, for two reasons: the HUD
 * advertises "10%" and must not pay out at 9.6%, and a monster small enough to
 * floor to 0 would otherwise credit someone who never swung. The floor of 1 is
 * what makes `damage >= required` imply `damage > 0`.
 */
export function killCreditDamageRequired(basisHP) {
  const hp = Math.max(0, Math.floor(Number(basisHP) || 0))
  return Math.max(1, Math.ceil(hp * KILL_CREDIT_DAMAGE_SHARE))
}

/** Did this much damage earn the kill? */
export function earnedKillCredit(damage, basisHP) {
  return Math.max(0, Math.floor(Number(damage) || 0)) >= killCreditDamageRequired(basisHP)
}

/**
 * Everyone a kill is credited to, biggest contributor first.
 *
 * `entries` is anything iterable of `{ id, damage, tick }` — a co-op member
 * list, a world npc's damage map — because the two contexts store the same
 * numbers in different shapes and neither should have to convert to the other's.
 * `tick` breaks a tie toward whoever got there first, so the order is stable and
 * the top entry is the same one the loot owner is picked from.
 *
 * Damage, never survival: someone who earned their share and then died is still
 * paid, exactly as the loot gate has always worked.
 */
export function killCreditIds(entries, basisHP) {
  const required = killCreditDamageRequired(basisHP)
  const earned = []
  for (const entry of entries || []) {
    const damage = Math.max(0, Math.floor(Number(entry?.damage) || 0))
    if (damage < required) continue
    earned.push({ id: entry.id, damage, tick: Number(entry.tick) || 0 })
  }
  earned.sort((a, b) => b.damage - a.damage || a.tick - b.tick)
  return earned.map((e) => e.id)
}
