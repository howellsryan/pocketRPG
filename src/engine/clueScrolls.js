import cluesData from '../data/clues.json'

function weightedRandom(rewards) {
  const totalWeight = rewards.reduce((sum, item) => sum + item.weight, 0)
  let random = Math.random() * totalWeight
  for (const item of rewards) {
    random -= item.weight
    if (random <= 0) return item
  }
  return rewards[rewards.length - 1]
}

export function rollClueRewards(clueLevel) {
  const clueData = cluesData[clueLevel]
  if (!clueData) return []

  const numRewards = Math.floor(Math.random() * 4) + 1
  const rewards = []

  for (let i = 0; i < numRewards; i++) {
    const rewardItem = weightedRandom(clueData.rewards)
    const existingReward = rewards.find(r => r.itemId === rewardItem.itemId)

    if (existingReward) {
      existingReward.quantity += rewardItem.quantity
    } else {
      rewards.push({ itemId: rewardItem.itemId, quantity: rewardItem.quantity })
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
