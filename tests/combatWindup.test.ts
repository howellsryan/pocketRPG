// The shared monster-attack wind-up timing that aligns a rigged monster's swing
// impact onto the engine's hit-splat tick, used identically by the combat arena
// (CombatArena3D) and the open world (world server pre-signal + world client
// sub-tick clip delay). See src/utils/combatWindup.js.
import { describe, expect, it } from 'vitest'
import { monsterAttackWindup, resolveWindupTick } from '../src/utils/combatWindup.js'
import equipmentModels from '../src/data/equipmentModels.json'
import monsters from '../src/data/monsters.json'

const TICK = 600

describe('monsterAttackWindup', () => {
  it('leads a mid-clip impact by ceil(impact/tick) ticks and offsets the remainder as a sub-tick delay', () => {
    // Warlord Grondar: 2.25s impact -> ceil(3.75)=4 ticks lead, 4*600-2250=150ms delay.
    expect(monsterAttackWindup(2.25, TICK)).toEqual({ leadTicks: 4, startDelayMs: 150 })
  })

  it('an impact that falls exactly on a tick boundary needs no sub-tick delay', () => {
    expect(monsterAttackWindup(1.2, TICK)).toEqual({ leadTicks: 2, startDelayMs: 0 })
  })

  it('falls back to a single-tick lead with no delay when the monster has no impact metadata', () => {
    expect(monsterAttackWindup(null, TICK)).toEqual({ leadTicks: 1, startDelayMs: 0 })
    expect(monsterAttackWindup(0, TICK)).toEqual({ leadTicks: 1, startDelayMs: 0 })
    expect(monsterAttackWindup(undefined as unknown as number, TICK)).toEqual({ leadTicks: 1, startDelayMs: 0 })
  })

  it('never leads by less than one tick even for a near-instant impact', () => {
    expect(monsterAttackWindup(0.05, TICK)).toEqual({ leadTicks: 1, startDelayMs: 550 })
  })
})

describe('resolveWindupTick (arena live per-tick form)', () => {
  it('launches only on the single tick whose remaining time hosts the impact, matching the lead', () => {
    const impactMs = 2250
    // Too early / too late ticks return null; the lead tick returns the delay.
    expect(resolveWindupTick(6, impactMs, TICK)).toBeNull()
    expect(resolveWindupTick(5, impactMs, TICK)).toBeNull()
    expect(resolveWindupTick(4, impactMs, TICK)).toEqual({ startDelayMs: 150 })
    expect(resolveWindupTick(3, impactMs, TICK)).toBeNull()
  })

  it('agrees with monsterAttackWindup on which tick fires and its delay', () => {
    for (const impactSec of [0.6, 1.2, 1.5, 2.25, 3.0]) {
      const { leadTicks, startDelayMs } = monsterAttackWindup(impactSec, TICK)
      expect(resolveWindupTick(leadTicks, impactSec * 1000, TICK)).toEqual({ startDelayMs })
    }
  })
})

describe('shipped monster attackImpactSec authoring constraint', () => {
  // The wind-up can only fit if the impact lands before the swing does. The
  // engine's monsterAttackTimer counts S-1, S-2 … 1 before the first swing of a
  // fight and only reaches S again on a swing tick (where it resets), so a lead
  // equal to the attack speed skips the OPENING swing's animation and a longer
  // lead is never reachable at all. The lead must therefore be strictly under
  // the attack speed: impact < (attackSpeed - 1) cycles.
  it('every registered attackImpactSec leaves a reachable lead tick inside the attack cycle', () => {
    const monsterModels = (equipmentModels as { monsters?: Record<string, { attackImpactSec?: number }> }).monsters ?? {}
    const monsterData = monsters as Record<string, { attackSpeed?: number }>
    for (const [id, spec] of Object.entries(monsterModels)) {
      if (typeof spec.attackImpactSec !== 'number') continue
      const attackSpeed = monsterData[id]?.attackSpeed
      expect(attackSpeed, `monster ${id} has attackImpactSec but no attackSpeed`).toBeTypeOf('number')
      const { leadTicks } = monsterAttackWindup(spec.attackImpactSec, TICK)
      expect(leadTicks, `${id} lead must be reachable before its first swing`).toBeLessThan(attackSpeed as number)
    }
  })
})
