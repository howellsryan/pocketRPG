import { killRevealRewards } from './lootModal.js'
import { grindmanXP } from '../engine/grindman.js'

/**
 * Fire the reward-reveal overlay for a completed clue/minigame/quest. The
 * overlay (RewardRevealOverlay) normalises qty/quantity, so raw reward entries
 * from any source can be passed straight through. `levelUps` (optional —
 * quests only, so far) renders as a "Levels Gained" summary within the same
 * card, alongside the reward chips.
 *
 * `mergeKey` (optional) folds a reveal into the queued card carrying the same
 * key instead of queueing behind it — see mergeRevealQueue.
 */
export function emitRewardReveal(title, icon, rewards, levelUps = [], mergeKey = null) {
  if (typeof window === 'undefined' || !Array.isArray(rewards) || rewards.length === 0) return
  window.dispatchEvent(new CustomEvent('pocketrpg:reward-reveal', { detail: { title, icon, rewards, levelUps, mergeKey } }))
}

/**
 * Announce an ordinary (non-boss, non-raid) kill's loot. This is the whole
 * post-kill UI for those fights — they no longer stop on the full-screen loot
 * modal — so it must not queue: a cow dies well inside the card's lifetime, and
 * a queue would show loot from four kills ago. Merging by monster means a grind
 * reads as one running "Cow Slain ×7" card instead.
 *
 * A kill that dropped nothing shows nothing; the combat log already said so.
 */
export function emitKillReveal(monsterId, monsterName, drops) {
  const rewards = killRevealRewards(drops)
  if (rewards.length === 0) return
  emitRewardReveal(`${monsterName || 'Monster'} Slain`, '⚔️', rewards, [], `kill:${monsterId || monsterName}`)
}

function mergeRewardLists(existing, incoming) {
  const out = []
  const index = new Map()
  for (const reward of [...(existing || []), ...(incoming || [])]) {
    const key = reward.skill ? `skill:${reward.skill}` : `item:${reward.itemId}`
    const at = index.get(key)
    if (at == null) {
      index.set(key, out.length)
      out.push({ ...reward })
    } else if (reward.skill) {
      out[at] = { ...out[at], xp: out[at].xp + reward.xp }
    } else {
      out[at] = { ...out[at], quantity: out[at].quantity + reward.quantity }
    }
  }
  return out
}

/**
 * Queue a reveal, folding it into an existing card when both carry the same
 * `mergeKey`. The merged card keeps its place in the queue (so an older reveal
 * still shows first) but takes the newcomer's title, a bumped `count`, and a
 * bumped `rev` — the overlay restarts the dismiss timer off `rev`, so a card
 * that keeps absorbing kills stays up rather than expiring mid-grind.
 */
export function mergeRevealQueue(queue, reveal) {
  const list = queue || []
  if (!reveal?.mergeKey) return [...list, reveal]
  const at = list.findIndex((r) => r.mergeKey === reveal.mergeKey)
  if (at === -1) return [...list, reveal]
  const prev = list[at]
  const merged = {
    ...prev,
    title: reveal.title || prev.title,
    icon: reveal.icon || prev.icon,
    count: (prev.count || 1) + (reveal.count || 1),
    rev: (prev.rev || 0) + 1,
    rewards: mergeRewardLists(prev.rewards, reveal.rewards),
    levelUps: [...(prev.levelUps || []), ...(reveal.levelUps || [])],
  }
  return list.map((r, i) => (i === at ? merged : r))
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
 *
 * Every caller hands over the quest's AUTHORED reward, so the account cut is
 * taken here and nowhere else on this route: cutting it at the four call sites
 * that build the reward map instead would be four rules to keep in step, and
 * one of them (the boot cascade) builds its map in gameState.jsx, a file away
 * from the emit. `grindmanXP` is the same function grantXP banks through, so
 * the number on the card is the number that reached the skill.
 */
export function emitQuestCompletionReveal(completedQuests, xpReward, coinsGained, levelUps = [], { isGrindman = false } = {}) {
  const count = completedQuests?.length || 0
  if (count === 0) return
  const title = count > 1
    ? `Completed ${count} Quests`
    : `Quest Complete: ${completedQuests[0]?.name || 'Quest'}`
  const rewards = []
  if ((coinsGained || 0) > 0) rewards.push({ itemId: 'coins', quantity: coinsGained })
  for (const [skill, xp] of Object.entries(xpReward || {})) {
    const amount = grindmanXP(Math.floor(Number(xp) || 0), isGrindman)
    if (amount > 0) rewards.push({ skill, xp: amount })
  }
  emitRewardReveal(title, '🏆', rewards, levelUps)
  emitLevelUpReveal(levelUps)
}
