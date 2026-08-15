import raidsData from '../../../src/data/raids.json' assert { type: 'json' }
import { hardModeDropChance } from '../../../src/engine/hardMode.js'
import { grindmanDropChance } from '../../../src/engine/grindman.js'

function rollQuantity(quantity, random) {
  if (Array.isArray(quantity)) {
    const min = Math.floor(Number(quantity[0]) || 0)
    const max = Math.floor(Number(quantity[1]) || 0)
    if (max < min) return min
    return Math.floor(random() * (max - min + 1)) + min
  }
  return Math.floor(Number(quantity) || 0)
}

// `hardMode` is the server's own state (§14) — the raid party's session column,
// or hard_mode_targets for a solo raid. `grindman` is characters.is_grindman.
// Never request body fields.
export function rollRaidRewardsById(raidId, random = Math.random, hardMode = false, grindman = false) {
  const raid = raidsData?.[raidId]
  if (!raid?.rewards) return []

  const rewards = raid.rewards
  const loot = []
  for (const drop of rewards.always || []) {
    const chance = grindmanDropChance(hardModeDropChance(drop?.chance, hardMode), grindman)
    if (random() < (Number.isFinite(chance) ? chance : 0)) {
      const qty = rollQuantity(drop?.quantity, random)
      if (qty > 0 && typeof drop?.itemId === 'string') loot.push({ itemId: drop.itemId, quantity: qty })
    }
  }

  // Hard mode doubles the odds of a unique dropping at all; which unique it is
  // stays the authored weighting.
  if (rewards.unique && random() < grindmanDropChance(hardModeDropChance(rewards.unique.chance, hardMode), grindman)) {
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
