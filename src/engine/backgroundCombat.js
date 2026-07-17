/**
 * Background combat eligibility — single source of truth for whether an active
 * combat task is allowed to keep ticking while the player is on another screen.
 *
 * Only standard monster fights qualify (and only when the player opted in).
 * Bosses, raids and dungeon fights always stay foreground (leaving flees them),
 * so a player can never wander off and die to high-stakes content unnoticed.
 */
export function isBackgroundCombatEligible({ task, enabled } = {}) {
  if (!enabled) return false
  if (!task || task.type !== 'combat') return false
  if (task.monster?.boss === true) return false
  if (task.raid === true || task.raidId) return false
  if (task.dungeon === true) return false
  return true
}
