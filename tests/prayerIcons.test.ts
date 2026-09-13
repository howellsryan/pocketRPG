import { describe, expect, it } from 'vitest'
import { nextProtectionPrayerThreat, prayerSkill, protectionPrayerForAttackStyle } from '../src/utils/prayerIcons.js'
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


describe('protection prayer threat cue', () => {
  it('uses the same Protect from Magic definition and crest mapping as the prayer UI', () => {
    const prayer = protectionPrayerForAttackStyle('magic', prayers)
    expect(prayer).toBe(prayers.protection_from_magic)
    expect(prayerSkill(prayer)).toBe('magic')
  })

  it('normalises melee substyles to Protect from Melee', () => {
    for (const style of ['melee', 'stab', 'slash', 'crush']) {
      const prayer = protectionPrayerForAttackStyle(style, prayers)
      expect(prayer).toBe(prayers.protection_from_melee)
      expect(prayerSkill(prayer)).toBe('defence')
    }
  })

  it('shows the next single-enemy attack across ordinary combat', () => {
    const threat = nextProtectionPrayerThreat({
      primary: { id: 'mage', name: 'Mage', currentHP: 10, maxHit: 5, attackStyle: 'magic' },
      primaryAttackTimer: 3,
    })
    expect(threat).toMatchObject({ monsterId: 'mage', style: 'magic', ticksUntil: 3, fromAdd: false })
  })

  it('uses an earlier add timer in multi-enemy combat', () => {
    const threat = nextProtectionPrayerThreat({
      primary: { id: 'boss', name: 'Boss', currentHP: 10, maxHit: 5, attackStyle: 'crush' },
      primaryAttackTimer: 4,
      adds: [
        { id: 'archer', name: 'Archer', currentHP: 10, maxHit: 3, attackStyle: 'ranged', attackTimer: 2 },
      ],
    })
    expect(threat).toMatchObject({ monsterId: 'archer', style: 'ranged', ticksUntil: 2, fromAdd: true })
  })

  it('does not lie when ordinary enemies hit simultaneously with different styles', () => {
    const args = {
      primary: { id: 'boss', name: 'Boss', currentHP: 10, maxHit: 5, attackStyle: 'magic' },
      primaryAttackTimer: 1,
      adds: [
        { id: 'archer', name: 'Archer', currentHP: 10, maxHit: 3, attackStyle: 'ranged', attackTimer: 1 },
      ],
    }
    expect(nextProtectionPrayerThreat(args)).toBeNull()
    expect(nextProtectionPrayerThreat({ ...args, staggered: true })).toMatchObject({
      monsterId: 'boss',
      style: 'magic',
    })
  })

  it('suppresses pre-roll cues for enemies whose attack style is randomly selected at swing time', () => {
    expect(nextProtectionPrayerThreat({
      primary: {
        id: 'random',
        name: 'Random',
        currentHP: 10,
        maxHit: 5,
        attackStyle: 'crush',
        attackStyles: ['melee', 'ranged', 'magic'],
      },
      primaryAttackTimer: 1,
    })).toBeNull()
  })
})
