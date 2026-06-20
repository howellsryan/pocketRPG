/**
 * Activity session accumulator — the per-session tally (actions, XP, coins,
 * items, …) for a running idle activity, persisted ON the active task so it
 * survives navigation and stays continuous whether the activity's own screen
 * is driving it or the App-level background runner is.
 *
 * Both the activity screens and the background runner read/write this through
 * the helpers here so there is a single shared shape and no duplicated math.
 */

export function emptySession(startedAt = Date.now()) {
  return { startedAt, actions: 0, xp: 0, coins: 0, items: 0, seeds: 0, tokens: 0 }
}

/** Merge an additive patch into a session, preserving startedAt. */
export function mergeSession(base, patch = {}) {
  const s = base || emptySession()
  return {
    startedAt: s.startedAt || Date.now(),
    actions: (s.actions || 0) + (patch.actions || 0),
    xp: (s.xp || 0) + (patch.xp || 0),
    coins: (s.coins || 0) + (patch.coins || 0),
    items: (s.items || 0) + (patch.items || 0),
    seeds: (s.seeds || 0) + (patch.seeds || 0),
    tokens: (s.tokens || 0) + (patch.tokens || 0),
  }
}

/** Whole-number actions/XP per hour, or null until there's a usable sample. */
export function ratePerHour(total, startedAt) {
  if (!startedAt || !total) return null
  const elapsed = Date.now() - startedAt
  if (elapsed <= 5000) return null
  return Math.round(total / (elapsed / 3_600_000))
}

/**
 * Derive a session patch from a background idle-sim result for a given task,
 * so the App-level runner can keep the session tally counting while away.
 */
export function sessionPatchFromResult(task, result) {
  if (!result) return {}
  const actions = result.actions ?? result.laps ?? 0
  let xp = 0
  if (result.xpGained) {
    const skill = task.type === 'skill' ? task.skill : task.type
    xp = result.xpGained[skill] || 0
  }
  const coins = result.coinsGained || 0
  const tokens = result.dungeoneeringTokensGained || 0
  let items = 0
  let seeds = 0
  if (result.itemsGained && typeof result.itemsGained === 'object') {
    const n = Object.values(result.itemsGained).reduce((sum, v) => sum + (Number(v) || 0), 0)
    if (task.type === 'thieving') seeds = n
    else items = n
  }
  if (task.type === 'gather') items = actions * (task.gatherTask?.qty || 1)
  if (task.type === 'hunter' && Array.isArray(result.rewards)) {
    items = result.rewards.reduce((sum, r) => sum + (r.quantity || 0), 0)
  }
  return { actions, xp, coins, items, seeds, tokens }
}
