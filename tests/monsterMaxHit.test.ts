import { describe, it, expect } from 'vitest'
import monstersData from '../src/data/monsters.json'
import { monsterMaxHit, monsterMaxHitRange, monsterMaxHitLabel } from '../src/engine/monsterMaxHit.js'
import { getMonsterMaxHit, getMonsterMaxHitLabel } from '../src/utils/combatArt.js'

const monsters = monstersData as Record<string, any>

/** The precedence combat.js applies when it rolls a monster's damage, written
 * out independently here: if this and monsterMaxHit ever disagree, the info
 * surfaces are quoting a number the fight does not roll. */
function engineMaxHit(attacker: any, attackStyle?: string) {
  if (attacker.formMaxHit != null) return attacker.formMaxHit
  if (attacker.maxHit != null) return attacker.maxHit
  const damageStat = attackStyle === 'ranged'
    ? attacker.stats.ranged
    : attackStyle === 'magic'
      ? attacker.stats.magic
      : attacker.stats.strength
  const stat = (damageStat == null) ? attacker.stats.strength : damageStat
  return Math.floor(0.5 + (stat + 8) * ((attacker.strengthBonus || 0) + 64) / 640)
}

describe('monsterMaxHit — one answer for the fight and the info sheet', () => {
  it('prefers the live form, then the authored value, then derivation', () => {
    const m = { stats: { strength: 100 }, strengthBonus: 0, maxHit: 40, formMaxHit: 12 }
    expect(monsterMaxHit(m)).toBe(12)
    expect(monsterMaxHit({ ...m, formMaxHit: undefined })).toBe(40)
    expect(monsterMaxHit({ ...m, formMaxHit: undefined, maxHit: undefined })).toBe(engineMaxHit({ ...m, formMaxHit: undefined, maxHit: undefined }))
  })

  it('derives from the stat matching the attack style, with the fight\'s +8', () => {
    const m = { stats: { strength: 10, ranged: 200, magic: 400 }, strengthBonus: 60 }
    expect(monsterMaxHit(m, 'ranged')).toBe(engineMaxHit(m, 'ranged'))
    expect(monsterMaxHit(m, 'magic')).toBe(engineMaxHit(m, 'magic'))
    expect(monsterMaxHit(m, 'crush')).toBe(engineMaxHit(m, 'crush'))
    // Each style reads a different stat, so they must not collapse together.
    expect(new Set([
      monsterMaxHit(m, 'ranged'), monsterMaxHit(m, 'magic'), monsterMaxHit(m, 'crush'),
    ]).size).toBe(3)
  })

  it('falls back to strength when the style\'s own stat is absent', () => {
    const m = { stats: { strength: 120 }, strengthBonus: 0 }
    expect(monsterMaxHit(m, 'ranged')).toBe(monsterMaxHit(m, 'crush'))
  })

  it('is 0 for nothing, and never throws on a statless monster', () => {
    expect(monsterMaxHit(null)).toBe(0)
    expect(monsterMaxHitRange(null)).toEqual({ min: 0, max: 0 })
    expect(() => monsterMaxHit({} as never)).not.toThrow()
  })
})

describe('the info sheet never advertises a hit the boss cannot land', () => {
  // The regression: getMonsterMaxHit re-derived from stats and ignored every
  // authored maxHit, so it reported 209 for a boss whose hardest form hits 60,
  // 122 for one that hits 55, and 123 for one that hits 30.
  it('quotes the authored value for every boss that authors one', () => {
    const offenders: string[] = []
    for (const [id, m] of Object.entries(monsters)) {
      if (m?.maxHit == null || !m.stats) continue
      if (getMonsterMaxHit(m) !== m.maxHit) offenders.push(`${id}: sheet ${getMonsterMaxHit(m)} vs authored ${m.maxHit}`)
    }
    expect(offenders).toEqual([])
  })

  it('never quotes above the hardest form of a boss that rotates style', () => {
    const offenders: string[] = []
    for (const [id, m] of Object.entries(monsters)) {
      if (!m?.multiForm || !m.forms || !m.stats) continue
      const authored = Object.values(m.forms as Record<string, any>)
        .map((f) => f.maxHit).filter((v) => v != null) as number[]
      if (!authored.length) continue
      const { max } = monsterMaxHitRange(m)
      if (max > Math.max(...authored)) offenders.push(`${id}: sheet ${max} vs hardest form ${Math.max(...authored)}`)
    }
    expect(offenders).toEqual([])
  })

  it('reports Zaryth as the span of its three forms, not a derived 209', () => {
    const zaryth = monsters.zaryth_the_empty_lord
    expect(monsterMaxHitRange(zaryth)).toEqual({ min: 35, max: 60 })
    expect(getMonsterMaxHitLabel(zaryth)).toBe('35–60')
    expect(getMonsterMaxHit(zaryth)).not.toBe(209)
  })

  it('shows a single number when every form hits the same, or there are no forms', () => {
    // The Grand Olm authors 30 on all three of its forms.
    expect(monsterMaxHitLabel(monsters.the_great_olm)).toBe('30')
    expect(monsterMaxHitLabel(monsters.corporeal_horror)).toBe(String(monsters.corporeal_horror.maxHit))
  })

  it('leaves a monster with no authored max hit on its derived value', () => {
    for (const id of ['warlord_grondar', 'king_black_dragon', 'duskmare']) {
      const m = monsters[id]
      expect(m.maxHit, `${id} unexpectedly authors a maxHit`).toBeUndefined()
      expect(monsterMaxHit(m)).toBe(engineMaxHit(m, m.attackStyle))
    }
  })
})
