import raidsData from '../data/raids.json'

const RAID_ID = 'sunspire_colosseum'
const raid = raidsData?.[RAID_ID] || {}
const rewardRules = raid?.sunspireRewards || {}
const armourOrder = Array.isArray(rewardRules.armourOrder) ? rewardRules.armourOrder : []
const headlineItem = rewardRules.headlineItem || 'sunweaver_quiver'

export function cloneSunspireRewards(rewards) {
  return (Array.isArray(rewards) ? rewards : []).map(r => ({
    itemId: r.itemId,
    quantity: Math.max(1, Math.floor(Number(r.quantity) || 1)),
  }))
}

export function mergeSunspireRewards(...groups) {
  const map = new Map()
  for (const group of groups) {
    for (const reward of cloneSunspireRewards(group)) {
      if (!reward?.itemId) continue
      map.set(reward.itemId, (map.get(reward.itemId) || 0) + reward.quantity)
    }
  }
  return [...map.entries()].map(([itemId, quantity]) => ({ itemId, quantity }))
}

function rollQuantity(quantity, random) {
  if (!Array.isArray(quantity)) return Math.max(0, Math.floor(Number(quantity) || 0))
  const min = Math.max(0, Math.floor(Number(quantity[0]) || 0))
  const max = Math.max(min, Math.floor(Number(quantity[1]) || min))
  return min + Math.floor(Math.max(0, Math.min(0.999999, random())) * (max - min + 1))
}

function weightedUnique(candidates, random) {
  const total = candidates.reduce((sum, item) => sum + Math.max(0, Number(item.weight) || 0), 0)
  if (!(total > 0)) return null
  let roll = Math.max(0, Math.min(0.999999, random())) * total
  for (const item of candidates) {
    roll -= Math.max(0, Number(item.weight) || 0)
    if (roll < 0) return item
  }
  return candidates[candidates.length - 1] || null
}

function stagedIds(stagedRewards) {
  return new Set(cloneSunspireRewards(stagedRewards).map(r => r.itemId))
}

/**
 * Pure server/room reward roll for one cleared Sunspire wave.
 * No caller-provided reward identity ever enters this function.
 */
export function rollSunspireWaveReward({ wave, random = Math.random, obtainedIds = new Set(), stagedRewards = [] } = {}) {
  const depth = Math.max(1, Math.min(12, Math.floor(Number(wave) || 1)))
  const loot = []
  const staged = stagedIds(stagedRewards)

  // Stable injected RNG order: unique chance -> unique selection -> materials.
  const chance = Number(rewardRules?.uniqueChanceByWave?.[String(depth)]) || 0
  if (chance > 0 && random() < chance) {
    const unlocked = []
    for (const entry of raid?.rewards?.unique?.items || []) {
      const itemId = entry?.itemId
      if (!itemId || itemId === headlineItem) continue
      const unlockWave = Math.max(1, Number(rewardRules?.uniqueUnlockWave?.[itemId]) || 4)
      if (depth < unlockWave) continue
      unlocked.push({ itemId, weight: Math.max(0, Number(entry.weight) || 0) })
    }

    const missingArmour = armourOrder.filter(id => !obtainedIds.has(id) && !staged.has(id))
    let candidates = unlocked
    if (missingArmour.length > 0) {
      const nonArmour = unlocked.filter(entry => !armourOrder.includes(entry.itemId))
      const nextPiece = unlocked.find(entry => entry.itemId === missingArmour[0])
      candidates = [...(nextPiece ? [nextPiece] : []), ...nonArmour]
    }
    const unique = weightedUnique(candidates, random)
    if (unique?.itemId) loot.push({ itemId: unique.itemId, quantity: 1 })
  }

  const shardBase = 18 + depth * 8
  loot.push({ itemId: 'sunshards', quantity: shardBase + rollQuantity([0, depth * 4], random) })
  loot.push({ itemId: 'coins', quantity: 5000 + depth * 3500 + rollQuantity([0, depth * 1200], random) })

  if (depth === 12) {
    if (!obtainedIds.has(headlineItem) && !staged.has(headlineItem) && rewardRules.guaranteedFirstClear !== false) {
      loot.push({ itemId: headlineItem, quantity: 1 })
    } else {
      loot.push({ itemId: 'sunshards', quantity: 500 })
    }
  }

  return mergeSunspireRewards(loot)
}
