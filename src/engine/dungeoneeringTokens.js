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
  return tokenCost
}
