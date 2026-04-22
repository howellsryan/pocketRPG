/**
 * Calculate progress for any action-based activity (0-1)
 * Used by skilling, gathering, thieving, agility, etc.
 *
 * @param {boolean} active - Whether the action is active
 * @param {number} ticksRemaining - Ticks left in current action
 * @param {number} totalTicks - Total ticks for the action
 * @returns {number} Progress 0-1, or 0 if not active
 */
export function getActionProgress(active, ticksRemaining, totalTicks) {
  if (!active) return 0
  return Math.min(1, Math.max(0, (totalTicks - ticksRemaining) / totalTicks))
}
