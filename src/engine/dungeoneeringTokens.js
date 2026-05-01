export const DUNGEONEERING_TOKEN_RATE = 0.15

export function calculateDungeoneeringTokensForXp(xp) {
  const normalizedXp = Number(xp)
  if (!Number.isFinite(normalizedXp) || normalizedXp <= 0) return 0
  return Math.ceil(normalizedXp * DUNGEONEERING_TOKEN_RATE)
}

export function calculateDungeoneeringTokensForAction(action) {
  return calculateDungeoneeringTokensForXp(action?.xp)
}

export function getDungeoneeringRewardCost(action) {
  const tokenCost = Number(action?.tokenCost)
  if (!Number.isFinite(tokenCost) || tokenCost <= 0) return 0
  return Math.floor(tokenCost)
}

export function normaliseDungeoneeringTokens(value) {
  return Math.max(0, Math.floor(Number(value) || 0))
}

export function isDungeoneeringTrainingAction(action) {
  return !!action && action.category !== 'reward'
}

export function isDungeoneeringRewardAction(action) {
  return !!action && action.category === 'reward'
}

export function canAffordDungeoneeringReward(action, tokenBalance, skillLevel) {
  const cost = getDungeoneeringRewardCost(action)
  const levelRequired = Math.max(1, Math.floor(Number(action?.level) || 1))
  const tokens = normaliseDungeoneeringTokens(tokenBalance)
  const level = Math.max(1, Math.floor(Number(skillLevel) || 1))
  return cost > 0 && level >= levelRequired && tokens >= cost
}
