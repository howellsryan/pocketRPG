import raidsData from '../../../src/data/raids.json' assert { type: 'json' }

function rollQuantity(quantity, random) {
  if (Array.isArray(quantity)) {
    const min = Math.floor(Number(quantity[0]) || 0)
    const max = Math.floor(Number(quantity[1]) || 0)
    if (max < min) return min
    return Math.floor(random() * (max - min + 1)) + min
  }
  return Math.floor(Number(quantity) || 0)
}

export function rollRaidRewardsById(raidId, random = Math.random) {
  const raid = raidsData?.[raidId]
  if (!raid?.rewards) return []

  const rewards = raid.rewards
  const loot = []
  for (const drop of rewards.always || []) {
    const chance = Number(drop?.chance)
    if (random() < (Number.isFinite(chance) ? chance : 0)) {
      const qty = rollQuantity(drop?.quantity, random)
      if (qty > 0 && typeof drop?.itemId === 'string') loot.push({ itemId: drop.itemId, quantity: qty })
    }
  }

  if (rewards.unique && random() < (Number(rewards.unique.chance) || 0)) {
    const items = Array.isArray(rewards.unique.items) ? rewards.unique.items : []
    const totalWeight = items.reduce((sum, item) => sum + (Number(item?.weight) || 0), 0)
    if (totalWeight > 0) {
      let roll = random() * totalWeight
      for (const item of items) {
        roll -= Number(item?.weight) || 0
        if (roll <= 0 && typeof item?.itemId === 'string') {
          loot.push({ itemId: item.itemId, quantity: 1 })
          break
        }
      }
    }
  }
  return loot
}
