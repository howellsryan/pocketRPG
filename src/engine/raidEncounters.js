// Data-driven raid encounter orchestration.
//
// Combat math stays in combat.js. This module only describes finite groups that
// share the existing boss-add primitives: one primary enemy, authored companions
// and one-shot reinforcement groups. Ordinary spawnsAdd bosses deliberately do
// not use this contract, so their respawn treadmill remains unchanged.
import { liveAdds, prepareAdd } from './bossAdds.js'

export function isWaveRaid(raid) {
  return Array.isArray(raid?.waves) && raid.waves.length > 0
}

export function raidWaves(raid) {
  return isWaveRaid(raid) ? raid.waves : []
}

export function encounterHitpoints(wave, monstersData) {
  if (!wave || !monstersData) return 0
  const ids = [
    wave.primary,
    ...(Array.isArray(wave.initialAdds) ? wave.initialAdds : []),
    ...((wave.reinforcements || []).flatMap(group => Array.isArray(group?.monsterIds) ? group.monsterIds : [])),
  ].filter(Boolean)
  return ids.reduce((sum, id) => sum + Math.max(0, Math.floor(Number(monstersData?.[id]?.hitpoints) || 0)), 0)
}

export function raidEncounterHitpoints(raid, monstersData) {
  return raidWaves(raid).reduce((sum, wave) => sum + encounterHitpoints(wave, monstersData), 0)
}

function reinforcementGroups(wave, monstersData) {
  return (Array.isArray(wave?.reinforcements) ? wave.reinforcements : []).map((group, index) => ({
    id: group.id || `${wave.id || 'wave'}_reinforcement_${index + 1}`,
    afterTicks: Math.max(1, Math.floor(Number(group.afterTicks) || 1)),
    monsterDefinitions: (Array.isArray(group.monsterIds) ? group.monsterIds : [])
      .map(id => monstersData?.[id])
      .filter(Boolean),
    spawned: false,
  }))
}

export function seedEncounterState(state, wave, monstersData, waveIndex = 0) {
  if (!state || !wave) return state
  const initial = (Array.isArray(wave.initialAdds) ? wave.initialAdds : [])
    .map(id => monstersData?.[id])
    .filter(Boolean)
  state.addDefinition = null
  state.addDefinitions = null
  state.addSpawnCountdown = null
  state.maxActiveAdds = Number.MAX_SAFE_INTEGER
  state.adds = initial.map((definition, index) => prepareAdd(definition, `${wave.id || waveIndex + 1}:initial:${index + 1}`))
  state.addsSpawned = state.adds.length
  state.addsDefeated = 0
  state.addTargetIndex = null
  state.encounter = {
    finite: true,
    id: wave.id || `wave_${waveIndex + 1}`,
    waveIndex,
    elapsedTicks: 0,
    primaryDefeated: false,
    reinforcements: reinforcementGroups(wave, monstersData),
    nextInstanceOrdinal: state.adds.length + 1,
  }
  return state
}

export function advanceEncounterReinforcements(state, events = []) {
  const encounter = state?.encounter
  if (!encounter?.finite || !state.active) return state
  encounter.elapsedTicks = Math.max(0, Math.floor(Number(encounter.elapsedTicks) || 0)) + 1
  if (encounter.primaryDefeated && liveAdds(state).length === 0) return state

  for (const group of encounter.reinforcements || []) {
    if (group.spawned || encounter.elapsedTicks < group.afterTicks) continue
    group.spawned = true
    for (const definition of group.monsterDefinitions || []) {
      const ordinal = encounter.nextInstanceOrdinal++
      const add = prepareAdd(definition, `${encounter.id}:reinforcement:${ordinal}`)
      if (!add) continue
      state.adds.push(add)
      state.addsSpawned = (state.addsSpawned || 0) + 1
      events.push({
        type: 'addSpawned',
        reinforcement: true,
        monsterName: add.name,
        bossName: state.monster?.name,
        hitpoints: add.hitpoints,
        icon: add.icon || '',
      })
    }
  }
  return state
}

export function finishEncounterIfCleared(state, events = []) {
  const encounter = state?.encounter
  if (!encounter?.finite || !encounter.primaryDefeated || liveAdds(state).length > 0) return false
  state.active = false
  state.addSpawnCountdown = null
  state.addTargetIndex = null
  state.specialAttackEnergy = 100

  if (state.raid?.waves) {
    const waveIndex = Math.max(0, Number(state.raid.currentWaveIndex) || 0)
    state.raid = { ...state.raid, awaitingDecision: true }
    events.push({
      type: 'raidWaveCleared',
      raidId: state.raid.raidId,
      raidName: state.raid.name,
      waveIndex,
      wave: waveIndex + 1,
      totalWaves: state.raid.waves.length,
      finalWave: waveIndex >= state.raid.waves.length - 1,
      xpGained: { ...(state.xpGained || {}) },
    })
  } else {
    events.push({ type: 'encounterCleared', encounterId: encounter.id })
  }
  return true
}

export function markEncounterPrimaryDefeated(state, events = []) {
  if (!state?.encounter?.finite) return false
  state.monster.currentHP = 0
  state.encounter.primaryDefeated = true
  events.push({ type: 'encounterEnemyDefeated', monsterName: state.monster?.name, primary: true })
  return finishEncounterIfCleared(state, events)
}

export function markEncounterAddDefeated(state, target, events = []) {
  if (!state?.encounter?.finite) return false
  events.push({ type: 'encounterEnemyDefeated', monsterName: target?.name, primary: false })
  return finishEncounterIfCleared(state, events)
}
