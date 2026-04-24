import cluesData from '../data/clues.json'

function weightedRandom(rewards) {
  const totalWeight = rewards.reduce((sum, item) => sum + item.weight, 0)
  let random = Math.random() * totalWeight
  for (const item of rewards) {
    random -= item.weight
    if (random <= 0) return item.itemId
  }
  return rewards[rewards.length - 1].itemId
}

export function rollClueRewards(clueLevel) {
  const clueData = cluesData[clueLevel]
  if (!clueData) return []

  const numRewards = Math.floor(Math.random() * 4) + 1
  const rewards = []

  for (let i = 0; i < numRewards; i++) {
    const itemId = weightedRandom(clueData.rewards)
    const existingReward = rewards.find(r => r.itemId === itemId)

    if (existingReward) {
      existingReward.quantity += 1
    } else {
      rewards.push({ itemId, quantity: 1 })
    }
  }

  return rewards
}

export function getClueCompletionTicks(clueLevel) {
  const ticksMap = {
    medium: 500,
    hard: 1500,
    elite: 3000,
    master: 6000
  }
  return ticksMap[clueLevel] || 500
}
