export const AURELIOS_PHASE_THRESHOLDS = Object.freeze([0.9, 0.75, 0.5, 0.25, 0.1])
export const AURELIOS_PATTERN = Object.freeze([
  'spear_sweep',
  'shield_bash',
  'spear_pierce',
  'shield_surge',
  'grapple',
  'triple_parry',
])

const ATTACKS = Object.freeze({
  spear_sweep: { label: 'Solar Sweep', responseType: 'guard', style: 'slash' },
  shield_bash: { label: 'Sunwall Bash', responseType: 'guard', style: 'crush' },
  spear_pierce: { label: 'Dawnpiercer', responseType: 'guard', style: 'stab' },
  shield_surge: { label: 'Radiant Surge', responseType: 'prayer', style: 'magic' },
  grapple: { label: 'Grapple', responseType: 'equipment_parry', style: 'slash' },
  triple_parry: { label: 'Triple Parry', responseType: 'prayer_sequence', style: 'slash' },
})

export function createAureliosState() {
  return {
    phase: 0,
    phaseThresholds: [...AURELIOS_PHASE_THRESHOLDS],
    pattern: [...AURELIOS_PATTERN],
    patternIndex: 0,
    pendingAttack: null,
    reaction: null,
    enraged: false,
    perfectParryTicks: 0,
    tripleStep: 0,
  }
}

export function aureliosAttackDelay(state, monster) {
  const base = Math.max(1, Math.floor(Number(monster?.attackSpeed) || 4))
  return state?.aurelios?.enraged ? Math.max(2, base - 1) : base
}

export function updateAureliosPhase(state, monster, events = []) {
  if (!state?.aurelios || !monster?.hitpoints) return
  const ratio = Math.max(0, monster.currentHP / monster.hitpoints)
  let phase = 0
  for (const threshold of AURELIOS_PHASE_THRESHOLDS) if (ratio <= threshold) phase += 1
  if (phase <= state.aurelios.phase) return
  while (state.aurelios.phase < phase) {
    state.aurelios.phase += 1
    const threshold = AURELIOS_PHASE_THRESHOLDS[state.aurelios.phase - 1]
    events.push({
      type: 'bossPhaseChange',
      bossId: monster.id,
      phase: state.aurelios.phase,
      threshold,
      label: state.aurelios.phase === 5 ? 'Final Radiance' : `Radiance ${state.aurelios.phase}`,
    })
  }
  if (state.aurelios.phase >= 5 && !state.aurelios.enraged) {
    state.aurelios.enraged = true
    events.push({
      type: 'bossEnrage',
      bossId: monster.id,
      label: 'Final Radiance',
      attackDelay: aureliosAttackDelay(state, monster),
      damageMultiplier: 1.25,
    })
  }
}

function grappleSlot(index) {
  return ['body', 'weapon', 'cape', 'shield'][index % 4]
}

export function telegraphAureliosAttack(state, monster, events = []) {
  if (!state?.aurelios || state.aurelios.pendingAttack || !state.active) return null
  const attackId = state.aurelios.pattern[state.aurelios.patternIndex % state.aurelios.pattern.length]
  const attack = ATTACKS[attackId]
  const pending = {
    attackId,
    label: attack.label,
    responseType: attack.responseType,
    style: attack.style,
    openedAtTick: state.tickCount,
    resolveAtTick: state.tickCount + 1,
    requiredSlot: attackId === 'grapple' ? grappleSlot(state.aurelios.patternIndex) : null,
    prayerSequence: attackId === 'triple_parry' ? ['melee', 'ranged', 'magic'] : null,
  }
  state.aurelios.pendingAttack = pending
  state.aurelios.reaction = null
  events.push({
    type: 'combatTelegraph',
    bossId: monster.id,
    attackId,
    label: attack.label,
    responseType: attack.responseType,
    style: pending.style,
    requiredSlot: pending.requiredSlot,
    prayerSequence: pending.prayerSequence,
    resolveInTicks: 1,
  })
  return pending
}

export function applyAureliosReaction(state, reaction) {
  if (!state?.aurelios?.pendingAttack || !reaction) return { ok: false, reason: 'no_pending_attack' }
  state.aurelios.reaction = { ...reaction, tick: state.tickCount }
  return { ok: true }
}

export function resolveAureliosAttack(state, monster, events = []) {
  const pending = state?.aurelios?.pendingAttack
  if (!pending) return { style: monster.attackStyle, damageMultiplier: 1, blocked: false }
  const reaction = state.aurelios.reaction
  let blocked = false
  let damageMultiplier = 1

  if (pending.attackId === 'grapple') {
    const correct = reaction?.type === 'parry' && reaction?.slot === pending.requiredSlot
    const inWindow = Number.isFinite(reaction?.tick) && reaction.tick >= pending.openedAtTick && reaction.tick <= pending.resolveAtTick
    blocked = correct && inWindow
    if (blocked) {
      const perfect = reaction.tick === pending.resolveAtTick
      if (perfect) state.aurelios.perfectParryTicks = 4
      events.push({ type: 'combatReaction', bossId: monster.id, attackId: pending.attackId, success: true, perfect })
    } else {
      damageMultiplier = 1.35
      events.push({ type: 'combatReaction', bossId: monster.id, attackId: pending.attackId, success: false })
    }
  } else if (pending.attackId === 'triple_parry') {
    const seq = Array.isArray(reaction?.prayers) ? reaction.prayers : []
    blocked = pending.prayerSequence.every((style, i) => seq[i] === style)
    damageMultiplier = blocked ? 0 : 1.5
    events.push({ type: 'combatReaction', bossId: monster.id, attackId: pending.attackId, success: blocked })
  } else if (pending.responseType === 'prayer') {
    blocked = reaction?.type === 'prayer' && reaction?.style === pending.style
    damageMultiplier = blocked ? 0.2 : 1.15
    events.push({ type: 'combatReaction', bossId: monster.id, attackId: pending.attackId, success: blocked })
  } else if (pending.responseType === 'guard') {
    blocked = reaction?.type === 'guard'
    damageMultiplier = blocked ? 0.35 : 1
    events.push({ type: 'combatReaction', bossId: monster.id, attackId: pending.attackId, success: blocked })
  }

  if (state.aurelios.enraged && !blocked) damageMultiplier *= 1.25

  state.aurelios.patternIndex = (state.aurelios.patternIndex + 1) % state.aurelios.pattern.length
  state.aurelios.pendingAttack = null
  state.aurelios.reaction = null
  if (state.aurelios.perfectParryTicks > 0) state.aurelios.perfectParryTicks -= 1
  return { style: pending.style || monster.attackStyle, damageMultiplier, blocked }
}
