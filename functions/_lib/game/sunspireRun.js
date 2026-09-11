import raidsData from '../../../src/data/raids.json' assert { type: 'json' }
import { offerSunspireModifiers, raiseSunspireModifierTier } from '../../../src/engine/sunspireModifiers.js'
import { cloneSunspireRewards, mergeSunspireRewards, rollSunspireWaveReward } from '../../../src/engine/sunspireRewards.js'

const RAID_ID = 'sunspire_colosseum'
const raid = raidsData?.[RAID_ID] || {}
const rewardRules = raid?.sunspireRewards || {}
const armourOrder = Array.isArray(rewardRules.armourOrder) ? rewardRules.armourOrder : []
const headlineItem = rewardRules.headlineItem || 'sunweaver_quiver'

export { rollSunspireWaveReward } from '../../../src/engine/sunspireRewards.js'

export function clearSunspireRunState(run, { random = Math.random, obtainedIds = new Set() } = {}) {
  if (!run || run.status !== 'active') throw new Error('Sunspire run is not active')
  const wave = Math.max(1, Math.min(12, Math.floor(Number(run.current_wave) || 1)))
  const staged = rollSunspireWaveReward({ wave, random, obtainedIds, stagedRewards: run.chest || [] })
  const chest = mergeSunspireRewards(run.chest || [], staged)
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
    settlement: cloneSunspireRewards(run.chest || []),
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
