import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyCombatReaction, applyInstantKill, continueRaidCombatState, createCombatState, createRaidCombatState, processCombatTick } from '../src/engine/combat.js'
import { liveAdds } from '../src/engine/bossAdds.js'
import { applyAureliosReaction, aureliosAttackDelay, resolveAureliosAttack, telegraphAureliosAttack, updateAureliosPhase } from '../src/engine/aurelios.js'

const DEF = { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 }
const stats = { attack: 99, strength: 99, defence: 99, ranged: 99, magic: 99, currentHP: 999 }
function foe(id: string, overrides: any = {}) {
  return {
    id, name: id, hitpoints: 1000, combatLevel: 500, attackSpeed: 6, attackStyle: 'crush', maxHit: 30,
    stats: { attack: 250, strength: 250, defence: 200, magic: 200, ranged: 200 },
    attackBonus: 200, strengthBonus: 200, defenceBonus: { ...DEF }, drops: [], noSeedDrops: true, noCharmDrops: true,
    ...overrides,
  }
}

const monsters: any = {
  ashen_warband_blade: foe('ashen_warband_blade'),
  ashen_warband_bow: foe('ashen_warband_bow', { isAdd: true, attackStyle: 'ranged' }),
  ashen_warband_magus: foe('ashen_warband_magus', { isAdd: true, attackStyle: 'magic' }),
  ashen_warband_bulwark: foe('ashen_warband_bulwark', { isAdd: true }),
  triune_chimera: foe('triune_chimera', { isAdd: true, attackSpeed: 5 }),
  resonance_colossus: foe('resonance_colossus', { isAdd: true }),
  ember_swarm: foe('ember_swarm', { isAdd: true, hitpoints: 1, attackSpeed: 5, maxHit: 3 }),
  sunspire_healing_totem: foe('sunspire_healing_totem', { isAdd: true, hitpoints: 1, attackSpeed: 99, maxHit: 0 }),
}

const raid: any = {
  id: 'sunspire_test',
  name: 'Sunspire Test',
  waves: [
    { id: 'w1', primary: 'ashen_warband_blade', initialAdds: ['ashen_warband_bow', 'ashen_warband_magus'], reinforcements: [] },
    { id: 'w2', primary: 'ashen_warband_blade', initialAdds: ['triune_chimera', 'resonance_colossus'], reinforcements: [] },
  ],
  rewards: {},
}

function nextWith(modifierState: Record<string, number>) {
  const first: any = createRaidCombatState(raid, monsters)!
  first.active = false
  first.raid.awaitingDecision = true
  return continueRaidCombatState(first, raid, monsters, { modifierState }) as any
}

afterEach(() => vi.restoreAllMocks())

describe('Sunspire persistent modifiers', () => {
  it('maps Profanation, Deathmark, Withering, Veiled Sight and Unyielding into deterministic combat rules', () => {
    const state = nextWith({ profanation: 2, deathmark: 2, withering: 2, veiled_sight: 2, unyielding: 2 })
    expect(state.sunspireRules).toMatchObject({
      prayerDrainDamagePercent: 0.4,
      doomStackLimit: 10,
      maxHpMultiplier: 0.8,
      rangedMagicAccuracyMultiplier: 0.7,
      enemyDefencePenetration: 0.66,
      enemyMaxHitBonus: 3,
    })
  })

  it('Quartet adds a fourth warband fighter and Twin Resonance duplicates the colossus', () => {
    const state = nextWith({ warband_quartet: 1, twin_resonance: 1 })
    const ids = liveAdds(state).map((add: any) => add.id)
    expect(ids.filter((id: string) => id === 'ashen_warband_bulwark')).toHaveLength(1)
    expect(ids.filter((id: string) => id === 'resonance_colossus')).toHaveLength(2)
  })

  it('Chimera Frenzy changes the authored chimera attack profile without name checks in the screen', () => {
    const state = nextWith({ chimera_frenzy: 3 })
    const chimera: any = liveAdds(state).find((add: any) => add.id === 'triune_chimera')
    expect(chimera.sunspireMultiHit).toBe(4)
    expect(chimera.attackSpeed).toBeLessThan(monsters.triune_chimera.attackSpeed)
  })

  it('Ember Swarm, Afterburn, Sunburst, Sun Totem and Cinderfall expose engine-owned hazard rules', () => {
    const state = nextWith({ ember_swarm: 2, afterburn: 2, sunburst: 2, sun_totem: 1, cinderfall: 3 })
    expect(liveAdds(state).filter((add: any) => add.id === 'ember_swarm')).toHaveLength(2)
    expect(state.sunspireRules).toMatchObject({
      emberSwarmCount: 2,
      afterburnTier: 2,
      sunburstTier: 2,
      sunTotemTier: 1,
      cinderfallTier: 3,
    })
  })

  it('Horncall increases Hornwarden pressure and all selections remain tiered state rather than booleans', () => {
    const state = nextWith({ horncall: 1 })
    expect(state.sunspireRules.horncallTier).toBe(1)
    expect(state.raid.modifierState.horncall).toBe(1)
  })
})

describe('Sunspire wave death semantics', () => {
  it('keeps alternate kill sources inside finite wave semantics', () => {
    const state: any = createRaidCombatState(raid, monsters)
    expect(state.encounter.finite).toBe(true)

    const events = applyInstantKill(state)

    expect(state.encounter.primaryDefeated).toBe(true)
    expect(events.some((event: any) => event.type === 'raidBossDefeated')).toBe(false)
    expect(events.some((event: any) => event.type === 'raidComplete')).toBe(false)
    // Wave one still has living adds, so killing its primary alone must not
    // prematurely finish the encounter.
    expect(state.active).toBe(true)
  })
})

describe('Aurelios scripted champion', () => {
  const aurelios: any = foe('aurelios_the_unbroken', {
    name: 'Aurelios the Unbroken',
    hitpoints: 4500,
    attackStyle: 'slash',
    weakness: 'slash',
    sunspireChampion: true,
  })

  it('seeds one authoritative deterministic pattern record', () => {
    const state: any = createCombatState(aurelios)
    expect(state.aurelios).toBeTruthy()
    expect(state.aurelios.phaseThresholds).toEqual([0.9, 0.75, 0.5, 0.25, 0.1])
    expect(state.aurelios.pattern.slice(0, 4)).toEqual(['spear_sweep', 'shield_bash', 'spear_pierce', 'shield_surge'])
  })

  it('telegraphs scripted attacks before they resolve', () => {
    const state: any = createCombatState(aurelios)
    state.monsterAttackTimer = 2
    const out = processCombatTick(
      state,
      { attack: 99, strength: 99, defence: 99, ranged: 99, magic: 99, currentHP: 99 },
      {},
      {},
      {},
    )
    const telegraph = out.events.find((event: any) => event.type === 'combatTelegraph')
    expect(telegraph?.bossId).toBe('aurelios_the_unbroken')
    expect(telegraph?.attackId).toBeTruthy()
  })

  it('advances phase pressure at 90, 75, 50, 25 and 10 percent, with enrage at 10 percent', () => {
    const state: any = createCombatState(aurelios)
    const expected = [
      [0.89, 1], [0.74, 2], [0.49, 3], [0.24, 4], [0.09, 5],
    ] as const
    for (const [ratio, phase] of expected) {
      state.monster.currentHP = Math.floor(state.monster.hitpoints * ratio)
      state.playerAttackTimer = 99
      processCombatTick(state, { attack: 1, strength: 1, defence: 99, ranged: 1, magic: 1, currentHP: 99 }, {}, {}, {})
      expect(state.aurelios.phase).toBe(phase)
    }
    expect(state.aurelios.enraged).toBe(true)
  })
})


describe('Sunspire reaction windows', () => {
  const champion: any = foe('aurelios_the_unbroken', {
    name: 'Aurelios the Unbroken',
    hitpoints: 4500,
    attackStyle: 'slash',
    weakness: 'slash',
    sunspireChampion: true,
  })

  it('rewards a correct Grapple parry and punishes ignoring it', () => {
    const success: any = createCombatState(champion)
    success.aurelios.pattern = ['grapple']
    success.tickCount = 20
    const telegraphEvents: any[] = []
    const pending = telegraphAureliosAttack(success, success.monster, telegraphEvents)
    expect(pending?.requiredSlot).toBeTruthy()
    expect(applyAureliosReaction(success, { type: 'parry', slot: pending.requiredSlot }).ok).toBe(true)
    success.tickCount = pending.resolveAtTick
    const resolvedEvents: any[] = []
    resolveAureliosAttack(success, success.monster, resolvedEvents)
    expect(resolvedEvents.find((e: any) => e.type === 'combatReaction' && e.attackId === 'grapple')?.success).toBe(true)

    const fail: any = createCombatState(champion)
    fail.aurelios.pattern = ['grapple']
    const failEvents: any[] = []
    telegraphAureliosAttack(fail, fail.monster, failEvents)
    const failedEvents: any[] = []
    resolveAureliosAttack(fail, fail.monster, failedEvents)
    expect(failedEvents.find((e: any) => e.type === 'combatReaction' && e.attackId === 'grapple')?.success).toBe(false)
  })

  it('accepts the exact Triple Parry prayer sequence and rejects the wrong order', () => {
    const ok: any = createCombatState(champion)
    ok.aurelios.pattern = ['triple_parry']
    telegraphAureliosAttack(ok, ok.monster, [])
    applyAureliosReaction(ok, { type: 'prayer_sequence', prayers: ['melee', 'ranged', 'magic'] })
    const goodEvents: any[] = []
    resolveAureliosAttack(ok, ok.monster, goodEvents)
    expect(goodEvents.find((e: any) => e.type === 'combatReaction' && e.attackId === 'triple_parry')?.success).toBe(true)

    const bad: any = createCombatState(champion)
    bad.aurelios.pattern = ['triple_parry']
    telegraphAureliosAttack(bad, bad.monster, [])
    applyAureliosReaction(bad, { type: 'prayer_sequence', prayers: ['magic', 'ranged', 'melee'] })
    const badEvents: any[] = []
    resolveAureliosAttack(bad, bad.monster, badEvents)
    expect(badEvents.find((e: any) => e.type === 'combatReaction' && e.attackId === 'triple_parry')?.success).toBe(false)
  })

  it('makes the final 10% Aurelios enrage mechanically faster and harder', () => {
    const state: any = createCombatState(champion)
    state.monster.currentHP = Math.floor(state.monster.hitpoints * 0.09)
    const phaseEvents: any[] = []
    updateAureliosPhase(state, state.monster, phaseEvents)
    expect(state.aurelios.enraged).toBe(true)
    expect(aureliosAttackDelay(state, state.monster)).toBe(Math.max(2, state.monster.attackSpeed - 1))
    expect(phaseEvents.some((e: any) => e.type === 'bossEnrage')).toBe(true)

    state.aurelios.pattern = ['grapple']
    telegraphAureliosAttack(state, state.monster, [])
    const events: any[] = []
    const resolved = resolveAureliosAttack(state, state.monster, events)
    expect(resolved.damageMultiplier).toBeGreaterThan(1.35)
    expect(events.find((e: any) => e.type === 'combatReaction')?.success).toBe(false)
  })

  it('makes timed Sunspire hazards reactable rather than unavoidable presentation events', () => {
    const state: any = nextWith({ afterburn: 1 })
    state.sunspireHazards.afterburnNext = 3
    state.playerAttackTimer = 99
    state.monsterAttackTimer = 99
    let out = processCombatTick(state, { ...stats, currentHP: 999 }, {}, {}, {})
    const telegraph = out.events.find((e: any) => e.type === 'combatTelegraph' && e.attackId === 'afterburn')
    expect(telegraph?.responseType).toBe('guard')
    expect(applyCombatReaction(state, { attackId: 'afterburn', type: 'guard' }).ok).toBe(true)
    processCombatTick(state, { ...stats, currentHP: 999 }, {}, {}, {})
    out = processCombatTick(state, { ...stats, currentHP: 999 }, {}, {}, {})
    const hazard = out.events.find((e: any) => e.type === 'sunspireHazard' && e.hazardId === 'afterburn')
    expect(hazard?.success).toBe(true)
    expect(hazard?.damage).toBeLessThan(hazard?.baseDamage)
  })
})
