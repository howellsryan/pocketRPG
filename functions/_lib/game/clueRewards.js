import cluesData from '../../../src/data/clues.json' assert { type: 'json' }

function weightedPick(rewards, random) {
  const totalWeight = rewards.reduce((sum, item) => sum + (Number(item?.weight) || 0), 0)
  if (totalWeight <= 0) return null
  let roll = random() * totalWeight
  for (const item of rewards) {
    roll -= Number(item?.weight) || 0
    if (roll <= 0) return item
  }
  return rewards[rewards.length - 1] || null
}

export function rollClueRewardsByLevel(clueLevel, random = Math.random) {
  const clue = cluesData?.[clueLevel]
  const table = Array.isArray(clue?.rewards) ? clue.rewards : null
  if (!table || table.length === 0) return []

  const numRewards = Math.floor(random() * 4) + 1
  const merged = []
  for (let i = 0; i < numRewards; i++) {
    const picked = weightedPick(table, random)
    if (!picked || typeof picked.itemId !== 'string') continue
    const qty = Math.floor(Number(picked.quantity) || 0)
    if (qty < 1) continue
    const existing = merged.find(r => r.itemId === picked.itemId)
    if (existing) existing.quantity += qty
    else merged.push({ itemId: picked.itemId, quantity: qty })
  }
  return merged
}

export const VALID_CLUE_REWARD_ITEMS = new Map(
  Object.entries(cluesData || {}).map(([clueLevel, clue]) => {
    const valid = new Set()
    for (const reward of clue?.rewards || []) {
      if (typeof reward?.itemId === 'string') valid.add(reward.itemId)
    }
    return [clueLevel, valid]
  })
)
