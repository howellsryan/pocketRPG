import raidsData from '../../../src/data/raids.json' assert { type: 'json' }
import { offerSunspireModifiers, raiseSunspireModifierTier } from '../../../src/engine/sunspireModifiers.js'

const RAID_ID = 'sunspire_colosseum'
const raid = raidsData?.[RAID_ID] || {}
const rewardRules = raid?.sunspireRewards || {}
const armourOrder = Array.isArray(rewardRules.armourOrder) ? rewardRules.armourOrder : []
const headlineItem = rewardRules.headlineItem || 'sunweaver_quiver'

function cloneRewards(rewards) {
  return (Array.isArray(rewards) ? rewards : []).map(r => ({ itemId: r.itemId, quantity: Math.max(1, Math.floor(Number(r.quantity) || 1)) }))
}

function mergeRewards(...groups) {
  const map = new Map()
  for (const group of groups) {
    for (const reward of cloneRewards(group)) {
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
  return new Set(cloneRewards(stagedRewards).map(r => r.itemId))
}

/**
 * Server-owned reward roll for one cleared wave.
 * The caller supplies only server state: wave, character collection ownership,
 * prior staged rewards, and injected RNG. No client reward payload is accepted.
 */
export function rollSunspireWaveReward({ wave, random = Math.random, obtainedIds = new Set(), stagedRewards = [] } = {}) {
  const depth = Math.max(1, Math.min(12, Math.floor(Number(wave) || 1)))
  const loot = []
  const staged = stagedIds(stagedRewards)

  // Ordinary material value rises with depth. This remains intentionally simple
  // and PocketRPG-native; uniques below carry the Colosseum-style progression.
  const shardBase = 18 + depth * 8
  loot.push({ itemId: 'sunshards', quantity: shardBase + rollQuantity([0, depth * 4], random) })
  loot.push({ itemId: 'coins', quantity: 5000 + depth * 3500 + rollQuantity([0, depth * 1200], random) })

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

    // Finish the prayer armour set before permitting armour duplicates.
    const missingArmour = armourOrder.filter(id => !obtainedIds.has(id) && !staged.has(id))
    let candidates = unlocked
    if (missingArmour.length > 0) {
      const nonArmour = unlocked.filter(entry => !armourOrder.includes(entry.itemId))
      const nextPiece = unlocked.find(entry => entry.itemId === missingArmour[0])
      candidates = [...nonArmour, ...(nextPiece ? [nextPiece] : [])]
    }
    const unique = weightedUnique(candidates, random)
    if (unique?.itemId) loot.push({ itemId: unique.itemId, quantity: 1 })
  }

  if (depth === 12) {
    if (!obtainedIds.has(headlineItem) && !staged.has(headlineItem) && rewardRules.guaranteedFirstClear !== false) {
      loot.push({ itemId: headlineItem, quantity: 1 })
    } else {
      // Repeat clears stay valuable without injecting a guaranteed second quiver.
      loot.push({ itemId: 'sunshards', quantity: 500 })
    }
  }

  return mergeRewards(loot)
}

export function clearSunspireRunState(run, { random = Math.random, obtainedIds = new Set() } = {}) {
  if (!run || run.status !== 'active') throw new Error('Sunspire run is not active')
  const wave = Math.max(1, Math.min(12, Math.floor(Number(run.current_wave) || 1)))
  const staged = rollSunspireWaveReward({ wave, random, obtainedIds, stagedRewards: run.chest || [] })
  const chest = mergeRewards(run.chest || [], staged)
  const finalWave = wave >= 12
  return {
    ...run,
    status: 'decision',
    cleared_wave: wave,
    current_wave: wave,
    chest,
    staged,
    offers: finalWave ? [] : offerSunspireModifiers(run.modifierState || {}, raid.modifierPool || [], random),
    final_wave_cleared: finalWave,
  }
}

export function chooseSunspireModifier(run, modifierId) {
  if (!run || run.status !== 'decision') throw new Error('Sunspire run is not awaiting a decision')
  if (run.final_wave_cleared) throw new Error('Final wave has already been cleared')
  if (!Array.isArray(run.offers) || !run.offers.includes(modifierId)) throw new Error('Modifier is not in the current offer')
  return {
    ...run,
    status: 'active',
    current_wave: Math.max(1, Math.floor(Number(run.cleared_wave) || 0) + 1),
    modifierState: raiseSunspireModifierTier(run.modifierState || {}, modifierId),
    offers: [],
    staged: [],
  }
}

export function prepareSunspireClaim(run, actionNonce) {
  if (!run) throw new Error('Missing Sunspire run')
  if (run.status === 'settled') return run
  if (run.status === 'settling' && run.settlement) return run
  if (run.status !== 'decision') throw new Error('Sunspire rewards can only be claimed between waves')
  if (!actionNonce || typeof actionNonce !== 'string') throw new Error('Missing action nonce')
  return {
    ...run,
    status: 'settling',
    claim_nonce: actionNonce,
    settlement: cloneRewards(run.chest || []),
  }
}

export function settleSunspireRunState(run) {
  if (!run || run.status !== 'settling') throw new Error('Sunspire run is not settling')
  return {
    ...run,
    status: 'settled',
    chest: [],
    staged: [],
    offers: [],
    settled_at: Date.now(),
  }
}

export function forfeitSunspireRunState(run) {
  if (!run) return run
  if (run.status === 'settled' || run.status === 'forfeited') return run
  return {
    ...run,
    status: 'forfeited',
    chest: [],
    staged: [],
    offers: [],
    settlement: null,
    claim_nonce: null,
  }
}

export const SUNSPIRE_RAID_ID = RAID_ID
