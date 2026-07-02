/**
 * Activity taxonomy — single source of truth for which activities
 * run in the background vs. require a modal to stay open.
 *
 * background: task is saved and keeps accruing offline when the app
 *   is hidden; navigating to another screen does NOT stop it.
 *
 * modal: task runs only while its screen/modal is mounted; leaving
 *   stops it immediately (combat = flee, skill = stop crafting).
 */

export const ACTIVITY_POLICY = {
  quest:         { persistence: 'background' },
  minigame:      { persistence: 'background' },
  clue:          { persistence: 'background' },
  gather:        { persistence: 'background' },
  agility:       { persistence: 'background' },
  thieving:      { persistence: 'background' },
  hunter:        { persistence: 'background' },
  // All skills (gathering, production, dungeoneering, etc.) keep accruing in
  // the background; only combat stops when the player leaves its screen.
  skill:         { persistence: 'background' },
  // Travelling between places (map-driven overhaul). A one-shot countdown to
  // arrival that keeps progressing offline; no ledger key (getActivityKey → null).
  travel:        { persistence: 'background' },
  combat:        { persistence: 'modal' },
}

/**
 * Returns the policy object for a task, or null if unknown.
 */
export function getActivityPolicy(task) {
  if (!task?.type) return null
  return ACTIVITY_POLICY[task.type] ?? null
}

/** True when the activity runs (and saves progress) in the background. */
export function isBackground(task) {
  return getActivityPolicy(task)?.persistence === 'background'
}

/**
 * Returns a stable, deterministic string key for per-activity progress
 * storage. Returns null for modal-bound tasks (no ledger entry needed).
 */
export function getActivityKey(task) {
  if (!task?.type) return null
  switch (task.type) {
    case 'quest':
      return `quest:${task.quest?.id || ''}`
    case 'minigame':
      return `minigame:${task.minigameTask?.id || ''}`
    case 'clue':
      return `clue:${task.gatherTask?.clueLevel || ''}`
    case 'gather':
      return `gather:${task.gatherTask?.id || ''}`
    case 'agility':
      return `agility:${task.action?.id || ''}`
    case 'thieving':
      return `thieving:${task.npc?.id || ''}`
    case 'hunter':
      return `hunter:${task.action?.id || ''}`
    case 'skill':
      if (task.skill === 'dungeoneering') {
        return `dungeoneering:${task.action?.id || ''}`
      }
      return `skill:${task.skill || ''}:${task.action?.id || ''}`
    default:
      return null
  }
}
