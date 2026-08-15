import monstersData from '../../../src/data/monsters.json' assert { type: 'json' }
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

// `hardMode` comes from the server's own state (hard_mode_targets, or the co-op
// session's column) and `grindman` from characters.is_grindman — never from the
// caller's request body (§14). The two compose: a Grindman on a hard boss rolls
// at six times the authored chance, still clamped at 1.
export function rollMonsterRewardsById(monsterId, random = Math.random, isOnTask = false, hardMode = false, grindman = false) {
  const monster = monstersData?.[monsterId]
  if (!monster) return []

  const rolls = Math.max(1, Math.floor(Number(monster?.dropRolls) || 1))
  const loot = []
  for (const drop of monster?.drops || []) {
    // Task-only drops (e.g. Imbued Crown/Brain) never roll off-task.
    if (drop?.taskOnly && !isOnTask) continue
    // The roll COUNT keys off the authored chance, not the hard-mode one: a
    // doubled 0.5 hitting 1 must not also collapse the table's extra rolls.
    const chance = grindmanDropChance(hardModeDropChance(drop?.chance, hardMode), grindman)
    const rollCount = Number(drop?.chance) === 1 ? 1 : rolls
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
