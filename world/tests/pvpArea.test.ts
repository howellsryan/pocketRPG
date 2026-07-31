import { describe, it, expect } from 'vitest'
import {
  crossesIntoDanger,
  isDangerTile,
  isPvpZone,
  pvpAttackRefusal,
  pvpRefusalMessage,
  stopPathAtLine,
  withinPvpBracket,
  PVP_LINE_Z,
  PVP_LEVEL_BRACKET,
  type PvpCandidate,
} from '../shared/pvpArea'

const at = (x: number, z: number, over: Partial<PvpCandidate> = {}): PvpCandidate => ({
  charId: 'a', combatLevel: 50, x, z, opponentId: null, locked: false, ...over,
})

describe('the Wilderness line', () => {
  it('puts the gate row itself on the safe side', () => {
    expect(isDangerTile({ x: 10, z: PVP_LINE_Z })).toBe(false)
    expect(isDangerTile({ x: 10, z: PVP_LINE_Z - 1 })).toBe(true)
    expect(isDangerTile({ x: 10, z: PVP_LINE_Z + 1 })).toBe(false)
  })

  it('only calls the crossing when the step actually changes side', () => {
    expect(crossesIntoDanger({ x: 5, z: PVP_LINE_Z }, { x: 5, z: PVP_LINE_Z - 1 })).toBe(true)
    // Already north — walking further north is not a new crossing, so a player
    // deep in the wastes is never re-prompted mid-fight.
    expect(crossesIntoDanger({ x: 5, z: PVP_LINE_Z - 1 }, { x: 5, z: PVP_LINE_Z - 2 })).toBe(false)
    // Heading home is never a crossing.
    expect(crossesIntoDanger({ x: 5, z: PVP_LINE_Z - 1 }, { x: 5, z: PVP_LINE_Z })).toBe(false)
  })

  it('stops a path at the last safe tile and reports that it did', () => {
    const from = { x: 5, z: PVP_LINE_Z + 3 }
    const path = [
      { x: 5, z: PVP_LINE_Z + 2 },
      { x: 5, z: PVP_LINE_Z + 1 },
      { x: 5, z: PVP_LINE_Z },
      { x: 5, z: PVP_LINE_Z - 1 },
      { x: 5, z: PVP_LINE_Z - 2 },
    ]
    const out = stopPathAtLine(from, path)
    expect(out.blocked).toBe(true)
    expect(out.path).toEqual(path.slice(0, 3))
    expect(isDangerTile(out.path[out.path.length - 1])).toBe(false)
  })

  it('leaves a path that never crosses untouched', () => {
    const path = [{ x: 6, z: PVP_LINE_Z + 2 }, { x: 7, z: PVP_LINE_Z + 2 }]
    const out = stopPathAtLine({ x: 5, z: PVP_LINE_Z + 2 }, path)
    expect(out.blocked).toBe(false)
    expect(out.path).toBe(path)
  })

  it('is the only PvP zone', () => {
    expect(isPvpZone('wilderness')).toBe(true)
    expect(isPvpZone('overworld')).toBe(false)
    expect(isPvpZone('zaryth_throne~3')).toBe(false)
  })
})

describe('the combat bracket', () => {
  it('is inclusive at exactly ±10', () => {
    expect(withinPvpBracket(50, 60)).toBe(true)
    expect(withinPvpBracket(50, 40)).toBe(true)
    expect(withinPvpBracket(50, 61)).toBe(false)
    expect(withinPvpBracket(50, 39)).toBe(false)
    expect(PVP_LEVEL_BRACKET).toBe(10)
  })
})

describe('pvpAttackRefusal', () => {
  const north = (over: Partial<PvpCandidate> = {}) => at(10, PVP_LINE_Z - 5, over)

  it('allows an ordinary in-bracket attack north of the line', () => {
    const attacker = north({ charId: 'a', combatLevel: 50 })
    const target = north({ charId: 'b', combatLevel: 58 })
    expect(pvpAttackRefusal('wilderness', attacker, target)).toBeNull()
  })

  it('refuses outside the Wilderness at all', () => {
    const attacker = north({ charId: 'a' })
    const target = north({ charId: 'b' })
    expect(pvpAttackRefusal('overworld', attacker, target)).toBe('not_pvp_zone')
  })

  it('refuses when either side is standing in the camp', () => {
    const safe = at(10, PVP_LINE_Z + 2, { charId: 'a' })
    const danger = north({ charId: 'b' })
    expect(pvpAttackRefusal('wilderness', safe, danger)).toBe('attacker_safe')
    expect(pvpAttackRefusal('wilderness', danger, at(10, PVP_LINE_Z + 2, { charId: 'a' }))).toBe('target_safe')
  })

  it('refuses outside the bracket', () => {
    const attacker = north({ charId: 'a', combatLevel: 50 })
    const target = north({ charId: 'b', combatLevel: 90 })
    expect(pvpAttackRefusal('wilderness', attacker, target)).toBe('out_of_bracket')
  })

  it('refuses to jump a fight that is already under way (single combat)', () => {
    const attacker = north({ charId: 'a' })
    const busy = north({ charId: 'b', opponentId: 'c', locked: true })
    expect(pvpAttackRefusal('wilderness', attacker, busy)).toBe('target_engaged')
  })

  it('refuses to start a second fight of your own', () => {
    const busy = north({ charId: 'a', opponentId: 'c', locked: true })
    const target = north({ charId: 'b' })
    expect(pvpAttackRefusal('wilderness', busy, target)).toBe('attacker_engaged')
  })

  it('always allows re-attacking the opponent you are already locked with', () => {
    // The disengage-and-re-engage case: without this, walking out of reach and
    // clicking back on the same player would be refused by your OWN lock.
    const a = north({ charId: 'a', opponentId: 'b', locked: true })
    const b = north({ charId: 'b', opponentId: 'a', locked: true })
    expect(pvpAttackRefusal('wilderness', a, b)).toBeNull()
  })

  it('lets a lapsed lock free both sides', () => {
    const a = north({ charId: 'a', opponentId: 'stale', locked: false })
    const b = north({ charId: 'b', opponentId: 'stale', locked: false })
    expect(pvpAttackRefusal('wilderness', a, b)).toBeNull()
  })

  it('never attacks yourself', () => {
    const a = north({ charId: 'a' })
    expect(pvpAttackRefusal('wilderness', a, { ...a })).toBe('self')
  })

  it('has player-facing copy for every refusal it can return', () => {
    const refusals = ['not_pvp_zone', 'attacker_safe', 'target_safe', 'self', 'out_of_bracket', 'target_engaged', 'attacker_engaged'] as const
    for (const refusal of refusals) {
      expect(pvpRefusalMessage(refusal, 'Someone').length).toBeGreaterThan(0)
    }
  })
})
