import { prepareAdd, liveAdds } from './bossAdds.js'
import { nextProtectionPrayerThreat } from '../utils/prayerIcons.js'

// Product feature flag: keep the complete modifier system in place while it is
// temporarily removed from live Sunspire runs. Flip this single value to restore
// modifier offers/effects after the between-wave UX is ready to return.
export const SUNSPIRE_MODIFIERS_ENABLED = false

export const SUNSPIRE_MODIFIERS = Object.freeze({
  ember_swarm: {
    name: 'Ember Swarm', maxTier: 3,
    tiers: ['Adds 1 Ember Swarm to every wave.', 'Adds 2 Ember Swarms to every wave.', 'Adds 3 Ember Swarms to every wave.'],
  },
  profanation: {
    name: 'Profanation', maxTier: 3,
    tiers: [
      'Damage that gets through your protection also drains Prayer equal to 20% of that damage.',
      'Damage that gets through your protection also drains Prayer equal to 40% of that damage.',
      'Damage that gets through your protection also drains Prayer equal to 60% of that damage.',
    ],
  },
  deathmark: {
    name: 'Deathmark', maxTier: 3,
    tiers: [
      'Damaging enemy hits build Doom. The hit that reaches 15 Doom stacks is lethal.',
      'Damaging enemy hits build Doom. The hit that reaches 10 Doom stacks is lethal.',
      'Damaging enemy hits build Doom. The hit that reaches 5 Doom stacks is lethal.',
    ],
  },
  twin_resonance: {
    name: 'Twin Resonance', maxTier: 1,
    tiers: ['A wave that begins with a Resonance Colossus begins with a second one too.'],
  },
  withering: {
    name: 'Withering', maxTier: 3,
    tiers: [
      'Your maximum HP is reduced to 90% of your Hitpoints level for following waves.',
      'Your maximum HP is reduced to 80% of your Hitpoints level for following waves.',
      'Your maximum HP is reduced to 60% of your Hitpoints level for following waves.',
    ],
  },
  chimera_frenzy: {
    name: 'Chimera Frenzy', maxTier: 3,
    tiers: [
      'Triune Chimeras attack twice per swing and attack 1 tick faster.',
      'Triune Chimeras attack three times per swing, attack 2 ticks faster and become venomous.',
      'Triune Chimeras attack four times per swing, stay 2 ticks faster and remain venomous.',
    ],
  },
  veiled_sight: {
    name: 'Veiled Sight', maxTier: 3,
    tiers: [
      'Your Ranged and Magic accuracy is reduced to 85%.',
      'Your Ranged and Magic accuracy is reduced to 70%.',
      'Your Ranged and Magic accuracy is reduced to 55%.',
    ],
  },
  afterburn: {
    name: 'Afterburn', maxTier: 3,
    tiers: [
      'Every 32 ticks, a 2-tick Guard warning threatens 6 damage. Guarding reduces it to 25%.',
      'Every 26 ticks, a 2-tick Guard warning threatens 9 damage. Guarding reduces it to 25%.',
      'Every 20 ticks, a 2-tick Guard warning threatens 12 damage. Guarding reduces it to 25%.',
    ],
  },
  horncall: {
    name: 'Horncall', maxTier: 3,
    tiers: ['Hornwardens gain +3 max hit.', 'Hornwardens gain +6 max hit.', 'Hornwardens gain +9 max hit.'],
  },
  unyielding: {
    name: 'Unyielding', maxTier: 3,
    tiers: [
      'Enemies ignore 33% of your Defence roll and gain +1 max hit.',
      'Enemies ignore 66% of your Defence roll and gain +3 max hit.',
      'Enemies ignore all of your Defence roll and gain +6 max hit.',
    ],
  },
  sunburst: {
    name: 'Sunburst', maxTier: 3,
    tiers: [
      'Every 47 ticks, a 2-tick warning threatens 8 Magic damage. Protect from Magic reduces it to 20%.',
      'Every 39 ticks, a 2-tick warning threatens 12 Magic damage. Protect from Magic reduces it to 20%.',
      'Every 31 ticks, a 2-tick warning threatens 16 Magic damage. Protect from Magic reduces it to 20%.',
    ],
  },
  warband_quartet: {
    name: 'Warband Quartet', maxTier: 1,
    tiers: ['Every wave led by the Ashen Warband Bladesworn gains an Ashen Warband Bulwark.'],
  },
  sun_totem: {
    name: 'Sun Totem', maxTier: 1,
    tiers: ['When an enemy falls to half health, a 1-HP Sun Totem appears. Kill it within 8 ticks or it heals that enemy for 30% max HP.'],
  },
  cinderfall: {
    name: 'Cinderfall', maxTier: 3,
    tiers: [
      'Every enemy death triggers a 1-tick Guard warning for 5 damage. Guarding reduces it to 25%.',
      'Every enemy death triggers a 1-tick Guard warning for 8 damage. Guarding reduces it to 25%.',
      'Every enemy death triggers a 1-tick Guard warning for 11 damage. Guarding reduces it to 25%.',
    ],
  },
})

export function sunspireModifierDescription(id, tierNumber = 1) {
  const def = SUNSPIRE_MODIFIERS[id]
  if (!def) return ''
  const clamped = Math.max(1, Math.min(def.maxTier, Math.floor(Number(tierNumber) || 1)))
  return def.tiers?.[clamped - 1] || ''
}

/** Backwards-compatible Sunspire name used by its focused mechanic tests. */
export function nextSunspirePrayerFlick({ primary = null, primaryAttackTimer = null, adds = [] } = {}) {
  return nextProtectionPrayerThreat({
    primary,
    primaryAttackTimer,
    adds,
    staggered: true,
  })
}

function tier(state, id) {
  const max = SUNSPIRE_MODIFIERS[id]?.maxTier || 0
  return Math.max(0, Math.min(max, Math.floor(Number(state?.[id]) || 0)))
}

export function raiseSunspireModifierTier(state, id) {
  const def = SUNSPIRE_MODIFIERS[id]
  if (!def) return { ...(state || {}) }
  return { ...(state || {}), [id]: Math.min(def.maxTier, tier(state, id) + 1) }
}

export function offerSunspireModifiers(state, pool = Object.keys(SUNSPIRE_MODIFIERS), rng = Math.random) {
  const eligible = pool.filter(id => SUNSPIRE_MODIFIERS[id] && tier(state, id) < SUNSPIRE_MODIFIERS[id].maxTier)
  const remaining = [...eligible]
  const picks = []
  while (remaining.length && picks.length < 3) {
    const index = Math.min(remaining.length - 1, Math.floor(Math.max(0, Math.min(0.999999, rng())) * remaining.length))
    picks.push(remaining.splice(index, 1)[0])
  }
  return picks
}

export function sunspireModifierRules(modifierState = {}) {
  const profanation = tier(modifierState, 'profanation')
  const deathmark = tier(modifierState, 'deathmark')
  const withering = tier(modifierState, 'withering')
  const veiled = tier(modifierState, 'veiled_sight')
  const unyielding = tier(modifierState, 'unyielding')
  return {
    prayerDrainDamagePercent: [0, 0.2, 0.4, 0.6][profanation],
    doomStackLimit: [Infinity, 15, 10, 5][deathmark],
    maxHpMultiplier: [1, 0.9, 0.8, 0.6][withering],
    rangedMagicAccuracyMultiplier: [1, 0.85, 0.7, 0.55][veiled],
    enemyDefencePenetration: [0, 0.33, 0.66, 1][unyielding],
    enemyMaxHitBonus: [0, 1, 3, 6][unyielding],
    emberSwarmCount: tier(modifierState, 'ember_swarm'),
    afterburnTier: tier(modifierState, 'afterburn'),
    sunburstTier: tier(modifierState, 'sunburst'),
    sunTotemTier: tier(modifierState, 'sun_totem'),
    cinderfallTier: tier(modifierState, 'cinderfall'),
    horncallTier: tier(modifierState, 'horncall'),
    chimeraFrenzyTier: tier(modifierState, 'chimera_frenzy'),
    twinResonance: tier(modifierState, 'twin_resonance') > 0,
    warbandQuartet: tier(modifierState, 'warband_quartet') > 0,
  }
}

function pushPrepared(state, definition, label) {
  if (!definition) return
  const ordinal = (state.encounter?.nextInstanceOrdinal || state.adds.length + 1)
  if (state.encounter) state.encounter.nextInstanceOrdinal = ordinal + 1
  const add = prepareAdd(definition, `${state.encounter?.id || 'sunspire'}:${label}:${ordinal}`)
  if (!add) return
  state.adds.push(add)
  state.addsSpawned = (state.addsSpawned || 0) + 1
}

export function applySunspireModifiersToState(state, wave, monstersData, modifierState = {}) {
  if (!state) return state
  const rules = sunspireModifierRules(modifierState)
  state.sunspireRules = rules
  if (state.raid) state.raid = { ...state.raid, modifierState: { ...modifierState } }

  if (rules.warbandQuartet && wave?.primary === 'ashen_warband_blade') {
    const already = liveAdds(state).some(add => add.id === 'ashen_warband_bulwark')
    if (!already) pushPrepared(state, monstersData?.ashen_warband_bulwark, 'quartet')
  }

  if (rules.twinResonance) {
    const resonance = liveAdds(state).find(add => add.id === 'resonance_colossus')
    if (resonance) pushPrepared(state, monstersData?.resonance_colossus, 'twin-resonance')
  }

  if (rules.chimeraFrenzyTier > 0) {
    for (const add of state.adds || []) {
      if (add.id !== 'triune_chimera') continue
      add.sunspireMultiHit = rules.chimeraFrenzyTier + 1
      add.attackSpeed = Math.max(2, (add.attackSpeed || 5) - Math.min(2, rules.chimeraFrenzyTier))
      if (rules.chimeraFrenzyTier >= 2) add.venomous = true
    }
  }

  for (let i = 0; i < rules.emberSwarmCount; i++) {
    pushPrepared(state, monstersData?.ember_swarm, `ember-swarm-${i + 1}`)
  }

  state.sunspireHazards = {
    tick: 0,
    afterburnNext: rules.afterburnTier ? Math.max(16, 38 - rules.afterburnTier * 6) : null,
    sunburstNext: rules.sunburstTier ? Math.max(20, 55 - rules.sunburstTier * 8) : null,
    totemSpawned: false,
    totemHealAt: null,
    cinderfallCount: 0,
    pending: [],
    definitions: {
      totem: monstersData?.sunspire_healing_totem || null,
      swarm: monstersData?.ember_swarm || null,
    },
  }
  return state
}

function eligibleHealingTarget(state) {
  const candidates = [state.monster, ...liveAdds(state)].filter(enemy =>
    enemy && enemy.id !== 'sunspire_healing_totem' && enemy.currentHP > 0 && enemy.hitpoints > 0
  )
  return candidates.find(enemy => enemy.currentHP <= Math.floor(enemy.hitpoints * 0.5)) || null
}

function queueHazard(state, events, { hazardId, label, resolveInTicks, responseType, damage, protectionStyle = null }) {
  const hz = state?.sunspireHazards
  if (!hz) return null
  // One outstanding copy of a named periodic hazard at a time. Cinderfall can
  // still queue separately from Afterburn/Sunburst, so overlapping pressure is
  // possible without duplicate timers racing themselves.
  const existing = (hz.pending || []).find((p) => p.hazardId === hazardId && !p.resolved)
  if (existing) return existing
  const pending = {
    hazardId,
    label,
    responseType,
    baseDamage: Math.max(0, Math.floor(Number(damage) || 0)),
    protectionStyle,
    openedAtTick: hz.tick,
    resolveAtTick: hz.tick + Math.max(1, Math.floor(Number(resolveInTicks) || 1)),
    reaction: null,
    resolved: false,
  }
  hz.pending.push(pending)
  events.push({
    type: 'combatTelegraph',
    source: 'sunspire',
    attackId: hazardId,
    label,
    resolveInTicks: pending.resolveAtTick - hz.tick,
    responseType,
    protectionStyle,
  })
  return pending
}

function resolveHazard(pending, events) {
  const reaction = pending.reaction
  let success = false
  let multiplier = 1
  if (pending.responseType === 'guard') {
    success = reaction?.type === 'guard'
    multiplier = success ? 0.25 : 1
  } else if (pending.responseType === 'prayer') {
    success = reaction?.type === 'prayer' && (!pending.protectionStyle || reaction?.style === pending.protectionStyle)
    multiplier = success ? 0.2 : 1
  } else if (pending.responseType === 'target') {
    // Target hazards (healing totems) are answered by actually killing the
    // target, not by this reaction channel.
    return
  }
  const damage = Math.max(0, Math.floor(pending.baseDamage * multiplier))
  pending.resolved = true
  events.push({
    type: 'sunspireHazard',
    hazardId: pending.hazardId,
    baseDamage: pending.baseDamage,
    damage,
    success,
    responseType: pending.responseType,
    protectionStyle: pending.protectionStyle,
    unavoidable: false,
  })
  events.push({
    type: 'combatReaction',
    source: 'sunspire',
    attackId: pending.hazardId,
    success,
  })
}

export function applySunspireHazardReaction(state, reaction) {
  const pending = state?.sunspireHazards?.pending
  if (!Array.isArray(pending) || !reaction) return { ok: false, reason: 'no_pending_hazard' }
  const target = reaction.attackId
    ? pending.find((p) => !p.resolved && p.hazardId === reaction.attackId)
    : [...pending].reverse().find((p) => !p.resolved && p.responseType !== 'target')
  if (!target) return { ok: false, reason: 'no_pending_hazard' }
  target.reaction = { ...reaction }
  return { ok: true }
}

export function tickSunspireHazards(state, events = []) {
  const rules = state?.sunspireRules
  const hz = state?.sunspireHazards
  if (!rules || !hz || !state.active) return
  hz.tick += 1

  if (hz.afterburnNext && hz.tick === hz.afterburnNext - 2) {
    queueHazard(state, events, {
      hazardId: 'afterburn',
      label: 'Afterburn',
      resolveInTicks: 2,
      responseType: 'guard',
      damage: 3 + rules.afterburnTier * 3,
    })
  }
  if (hz.afterburnNext && hz.tick >= hz.afterburnNext) {
    hz.afterburnNext += Math.max(16, 38 - rules.afterburnTier * 6)
  }

  if (hz.sunburstNext && hz.tick === hz.sunburstNext - 2) {
    queueHazard(state, events, {
      hazardId: 'sunburst',
      label: 'Sunburst',
      resolveInTicks: 2,
      responseType: 'prayer',
      protectionStyle: 'magic',
      damage: 4 + rules.sunburstTier * 4,
    })
  }
  if (hz.sunburstNext && hz.tick >= hz.sunburstNext) {
    hz.sunburstNext += Math.max(20, 55 - rules.sunburstTier * 8)
  }

  for (const pending of hz.pending || []) {
    if (!pending.resolved && pending.responseType !== 'target' && hz.tick >= pending.resolveAtTick) {
      resolveHazard(pending, events)
    }
  }
  hz.pending = (hz.pending || []).filter((pending) => !pending.resolved || hz.tick - pending.resolveAtTick < 2)

  if (rules.sunTotemTier && !hz.totemSpawned) {
    const target = eligibleHealingTarget(state)
    if (target && hz.definitions.totem) {
      pushPrepared(state, hz.definitions.totem, 'healing-totem')
      hz.totemSpawned = true
      hz.totemHealAt = hz.tick + 8
      hz.totemTargetInstanceId = target.instanceId || null
      hz.totemTargetId = target.id
      events.push({ type: 'addSpawned', monsterName: hz.definitions.totem.name, bossName: state.monster?.name, hitpoints: 1, icon: hz.definitions.totem.icon || '' })
      events.push({ type: 'combatTelegraph', source: 'sunspire', attackId: 'sun_totem', label: 'Healing totem', resolveInTicks: 8, responseType: 'target' })
    }
  }

  if (hz.totemHealAt && hz.tick >= hz.totemHealAt) {
    const totemAlive = liveAdds(state).some(add => add.id === 'sunspire_healing_totem')
    if (totemAlive) {
      const target = [state.monster, ...liveAdds(state)].find(enemy =>
        enemy && enemy.id !== 'sunspire_healing_totem' &&
        ((hz.totemTargetInstanceId && enemy.instanceId === hz.totemTargetInstanceId) || (!hz.totemTargetInstanceId && enemy.id === hz.totemTargetId))
      )
      if (target?.currentHP > 0) {
        const amount = Math.max(1, Math.floor(target.hitpoints * 0.3))
        target.currentHP = Math.min(target.hitpoints, target.currentHP + amount)
        events.push({ type: 'enemyHealed', monsterName: target.name, amount, source: 'Sun Totem' })
      }
    }
    state.adds = (state.adds || []).filter(add => add.id !== 'sunspire_healing_totem')
    hz.totemHealAt = null
  }
}

export function triggerSunspireCinderfall(state, defeated, events = []) {
  const tierValue = state?.sunspireRules?.cinderfallTier || 0
  if (!tierValue || !defeated || defeated.id === 'sunspire_healing_totem') return
  const damage = 2 + tierValue * 3
  state.sunspireHazards.cinderfallCount += 1
  queueHazard(state, events, {
    hazardId: `cinderfall_${state.sunspireHazards.cinderfallCount}`,
    label: 'Cinderfall',
    resolveInTicks: 1,
    responseType: 'guard',
    damage,
  })
}
