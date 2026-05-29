/**
 * Fire the reward-reveal overlay for a completed clue/minigame. The overlay
 * (RewardRevealOverlay) normalises qty/quantity, so raw reward entries from
 * either source can be passed straight through.
 */
export function emitRewardReveal(title, icon, rewards) {
  if (typeof window === 'undefined' || !Array.isArray(rewards) || rewards.length === 0) return
  window.dispatchEvent(new CustomEvent('pocketrpg:reward-reveal', { detail: { title, icon, rewards } }))
}
