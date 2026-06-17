// Pure predicates for "is this thing fully completed?" — the single source of
// truth driving the gilded completion treatment (see components/GildedComplete.jsx)
// across the skills, quests, minigames and character-unlock screens.

import { MAX_TOTAL_LEVEL } from './constants.js'

// A skill is mastered at the level cap (99).
export function isSkillMaxed(level) {
  return Number(level) >= 99
}

// An account is maxed when its total level reaches the cap (every skill at 99).
// Drives the max cape unlock and the gilded leaderboard treatment.
export function isMaxedTotal(totalLevel) {
  return Number(totalLevel) >= MAX_TOTAL_LEVEL
}

// A quest is complete when its id is in the completed-quests set.
export function isQuestComplete(completedQuests, questId) {
  return !!completedQuests && typeof completedQuests.has === 'function' && completedQuests.has(questId)
}

// A minigame reward is earned when its product item id is in the unlocked set.
export function isMinigameItemUnlocked(unlockedItems, productId) {
  return !!unlockedItems && typeof unlockedItems.has === 'function' && unlockedItems.has(productId)
}

// A character unlock is owned when its state flag is strictly true.
export function isUnlockOwned(characterUnlocks, stateKey) {
  return characterUnlocks?.[stateKey] === true
}
