/**
 * Fire the reward-reveal overlay for a completed clue/minigame. The overlay
 * (RewardRevealOverlay) normalises qty/quantity, so raw reward entries from
 * either source can be passed straight through.
 */
export function emitRewardReveal(title, icon, rewards) {
  if (typeof window === 'undefined' || !Array.isArray(rewards) || rewards.length === 0) return
  window.dispatchEvent(new CustomEvent('pocketrpg:reward-reveal', { detail: { title, icon, rewards } }))
}

/**
 * Fire the same reveal for completed quests — quests award XP + coins rather
 * than items, so the entries are `{ skill, xp }` chips plus a coins chip.
 * Replaces the idle-results modal for every quest-cascade completion path
 * (live journeys toast per quest; skips and offline catch-up reveal here).
 */
export function emitQuestCompletionReveal(completedQuests, xpReward, coinsGained) {
  const count = completedQuests?.length || 0
  if (count === 0) return
  const title = count > 1
    ? `Completed ${count} Quests`
    : `Quest Complete: ${completedQuests[0]?.name || 'Quest'}`
  const rewards = []
  if ((coinsGained || 0) > 0) rewards.push({ itemId: 'coins', quantity: coinsGained })
  for (const [skill, xp] of Object.entries(xpReward || {})) {
    const amount = Math.floor(Number(xp) || 0)
    if (amount > 0) rewards.push({ skill, xp: amount })
  }
  emitRewardReveal(title, '🏆', rewards)
}
