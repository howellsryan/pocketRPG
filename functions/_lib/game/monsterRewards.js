import monstersData from '../../../src/data/monsters.json' assert { type: 'json' }

function rollQuantity(quantity, random) {
  if (Array.isArray(quantity)) {
    const min = Math.floor(Number(quantity[0]) || 0)
    const max = Math.floor(Number(quantity[1]) || 0)
    if (max < min) return min
    return Math.floor(random() * (max - min + 1)) + min
  }
  return Math.floor(Number(quantity) || 0)
}

export function rollMonsterRewardsById(monsterId, random = Math.random) {
  const monster = monstersData?.[monsterId]
  if (!monster) return []

  const rolls = Math.max(1, Math.floor(Number(monster?.dropRolls) || 1))
  const loot = []
  for (const drop of monster?.drops || []) {
    const chance = Number(drop?.chance)
    const rollCount = chance === 1 ? 1 : rolls
    for (let i = 0; i < rollCount; i++) {
      if (random() < (Number.isFinite(chance) ? chance : 0)) {
        const qty = rollQuantity(drop?.quantity, random)
        if (qty > 0 && typeof drop?.itemId === 'string') {
          loot.push({ itemId: drop.itemId, quantity: qty })
        }
      }
    }
  }
  return loot
}
