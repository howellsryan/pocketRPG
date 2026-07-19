import { describe, expect, it } from 'vitest'
import { prayerSkill } from '../src/utils/prayerIcons.js'
import prayersData from '../src/data/prayers.json'

const prayers = prayersData as Record<string, Record<string, unknown>>

describe('prayerSkill', () => {
  it('maps a stat-boost prayer to the stat it boosts', () => {
    expect(prayerSkill(prayers.thick_skin)).toBe('defence')
    expect(prayerSkill(prayers.burst_of_strength)).toBe('strength')
    expect(prayerSkill(prayers.clarity_of_thought)).toBe('attack')
    expect(prayerSkill(prayers.sharp_eye)).toBe('ranged')
    expect(prayerSkill(prayers.mystic_will)).toBe('magic')
  })

  it('maps a protection prayer to the style it blocks (melee → defence)', () => {
    expect(prayerSkill(prayers.protection_from_melee)).toBe('defence')
    expect(prayerSkill(prayers.protection_from_missiles)).toBe('ranged')
    expect(prayerSkill(prayers.protection_from_magic)).toBe('magic')
  })

  it('maps a multi-stat prayer to its primary style', () => {
    expect(prayerSkill(prayers.piety)).toBe('strength') // melee headline
    expect(prayerSkill(prayers.rigour)).toBe('ranged')
    expect(prayerSkill(prayers.augury)).toBe('magic')
  })

  it('returns null for a missing prayer', () => {
    expect(prayerSkill(null)).toBeNull()
    expect(prayerSkill(undefined)).toBeNull()
  })

  it('resolves a real skill id for every prayer in the data', () => {
    const SKILLS = new Set(['attack', 'strength', 'defence', 'ranged', 'magic'])
    for (const p of Object.values(prayers)) {
      expect(SKILLS.has(prayerSkill(p) as string), (p as { id: string }).id).toBe(true)
    }
  })
})
