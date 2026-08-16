// What the idle client may report a kill count for, and what it may never.
//
// kill_counts is the table the boss entry gates read (§14), so a client-reported
// count is bounded to monsters that could not answer a gate and have no
// server-authoritative completion of their own. The last of those exclusions is
// derived from the content rather than listed by hand — this is where that
// derivation is proven, so a new gated boss cannot quietly become reportable.
import { describe, it, expect } from 'vitest'
import { filterReportableKills, isClientReportableMonster } from '../src/engine/killCountReports.js'
import { killCountRequirementsFor } from '../src/engine/combatRequirements.js'
import monstersData from '../src/data/monsters.json'

describe('isClientReportableMonster', () => {
  it('accepts an ordinary grind monster', () => {
    expect(isClientReportableMonster('green_dragon')).toBe(true)
    expect(isClientReportableMonster('pasture_bull')).toBe(true)
  })

  it('refuses a boss — its own completion already counts it', () => {
    expect(isClientReportableMonster('warlord_grondar')).toBe(false)
  })

  it('refuses a monster with a collection-logged drop, for the same reason', () => {
    expect(isClientReportableMonster('black_dragon')).toBe(false)
  })

  it('refuses anything that is not a monster at all', () => {
    expect(isClientReportableMonster('not_a_monster')).toBe(false)
    expect(isClientReportableMonster('')).toBe(false)
    expect(isClientReportableMonster(undefined as unknown as string)).toBe(false)
  })

  it('refuses EVERY monster named by a kill-count gate, including the hardcoded one', () => {
    const prerequisites = new Set<string>()
    for (const [id, monster] of Object.entries(monstersData as Record<string, Record<string, unknown>>)) {
      for (const requiredId of Object.keys(killCountRequirementsFor({ ...monster, id }))) prerequisites.add(requiredId)
    }
    // The Ashen Crucible's Ember Tyrant prerequisite is hardcoded in the engine,
    // not in the content — if this set were read off `killCountRequirement` raw
    // it would be missing, and a client could unlock the Crucible by claiming.
    expect(prerequisites.has('ember_tyrant')).toBe(true)
    for (const monsterId of prerequisites) {
      expect(isClientReportableMonster(monsterId)).toBe(false)
    }
  })
})

describe('filterReportableKills', () => {
  it('keeps the reportable monsters and drops the rest', () => {
    expect(filterReportableKills({ green_dragon: 4, warlord_grondar: 2, black_dragon: 9 }))
      .toEqual({ green_dragon: 4 })
  })

  it('floors and bounds a count, and drops anything that is not positive', () => {
    expect(filterReportableKills({ green_dragon: 3.9 })).toEqual({ green_dragon: 3 })
    expect(filterReportableKills({ green_dragon: 10 ** 9 })).toEqual({ green_dragon: 100000 })
    expect(filterReportableKills({ green_dragon: 0, pasture_bull: -5 })).toEqual({})
  })

  it('returns an empty map for junk input', () => {
    expect(filterReportableKills(null)).toEqual({})
    expect(filterReportableKills('green_dragon' as unknown as Record<string, number>)).toEqual({})
  })
})
