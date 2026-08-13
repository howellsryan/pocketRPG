// Folding banked slayer progress into a save. Shared by the co-op room's
// write-back and the open world's grant flush — both hold the player's task in
// a session and hand it back the same way.

import { emptySlayerCredit } from '../../../src/engine/slayerKillCredit.js'

export { emptySlayerCredit }

/**
 * Folds a session's banked slayer progress into a save.
 *
 * The task itself is state and is written outright; points and completion
 * counts are DELTAS and are added, so the caller must clear the credit after a
 * successful write or a second write-back pays them twice.
 *
 * `session` is anything carrying `{ slayerTask, slayerCredit,
 * slayerTasksCompleted }`. An absent `slayerTask` FIELD means a session that
 * predates slayer support: leave the save's task alone rather than cancelling
 * it with a null.
 */
export function applySlayerCreditToSave(saveObject, session) {
  if (!Object.prototype.hasOwnProperty.call(session || {}, 'slayerTask')) return saveObject
  const settings = { ...(saveObject.settings && typeof saveObject.settings === 'object' ? saveObject.settings : {}) }
  settings.slayerTask = session.slayerTask || null

  const credit = session.slayerCredit
  if (credit?.tasksCompleted > 0 || credit?.pointsEarned > 0) {
    settings.slayerPoints = Math.max(0, Math.floor(Number(settings.slayerPoints) || 0))
      + Math.max(0, Math.floor(Number(credit.pointsEarned) || 0))
    settings.slayerTasksCompleted = Math.max(
      Math.max(0, Math.floor(Number(settings.slayerTasksCompleted) || 0)),
      Math.max(0, Math.floor(Number(session.slayerTasksCompleted) || 0)),
    )
    const completions = { ...(settings.slayerMasterTaskCompletions && typeof settings.slayerMasterTaskCompletions === 'object' ? settings.slayerMasterTaskCompletions : {}) }
    for (const [masterId, count] of Object.entries(credit.masterCompletions || {})) {
      completions[masterId] = (Math.floor(Number(completions[masterId]) || 0)) + Math.max(0, Math.floor(Number(count) || 0))
    }
    settings.slayerMasterTaskCompletions = completions
  }
  saveObject.settings = settings
  return saveObject
}
