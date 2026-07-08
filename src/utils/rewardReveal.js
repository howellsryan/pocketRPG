/**
 * Fire the reward-reveal overlay for a completed clue/minigame/quest. The
 * overlay (RewardRevealOverlay) normalises qty/quantity, so raw reward entries
 * from any source can be passed straight through. `levelUps` (optional —
 * quests only, so far) renders as a "Levels Gained" summary within the same
 * card, alongside the reward chips.
 */
export function emitRewardReveal(title, icon, rewards, levelUps = []) {
  if (typeof window === 'undefined' || !Array.isArray(rewards) || rewards.length === 0) return
  window.dispatchEvent(new CustomEvent('pocketrpg:reward-reveal', { detail: { title, icon, rewards, levelUps } }))
}

/**
 * Fire the full-screen level-up takeover (LevelUpOverlay) — a bigger
 * celebration than the reward-reveal card for when a quest's XP actually
 * bumped a level. Deliberately covers the whole screen and sits above the
 * reward-reveal card (higher z-index): a Grandmaster quest's levels are the
 * headline, the coins/XP chips are secondary. No-ops with no level-ups.
 */
export function emitLevelUpReveal(levelUps) {
  if (typeof window === 'undefined' || !Array.isArray(levelUps) || levelUps.length === 0) return
  window.dispatchEvent(new CustomEvent('pocketrpg:levelup-reveal', { detail: { levelUps } }))
}

/**
 * Fire the same reveal for completed quests — quests award XP + coins rather
 * than items, so the entries are `{ skill, xp }` chips plus a coins chip.
 * Replaces the idle-results modal AND the toast level-up notifications for
 * every quest completion path (live single completions, cascades, skips,
 * offline catch-up) — this reveal (plus the full-screen level-up overlay when
 * `levelUps` is non-empty) is the only completion UI for quests.
 */
export function emitQuestCompletionReveal(completedQuests, xpReward, coinsGained, levelUps = []) {
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
  emitRewardReveal(title, '🏆', rewards, levelUps)
  emitLevelUpReveal(levelUps)
}
