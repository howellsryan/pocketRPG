import { describe, it, expect } from 'vitest'
import monstersData from '../src/data/monsters.json'
import itemsData from '../src/data/items.json'
import collectionLog from '../src/data/collectionLog.json'

const monsters = monstersData as Record<string, any>
const items = itemsData as Record<string, any>

function dropChance(monster: any, itemId: string): number | undefined {
  return (monster.drops || []).find((d: any) => d.itemId === itemId)?.chance
}

const slayerMonsters = Object.values(monsters).filter((m: any) => typeof m.slayerRequirement === 'number')

describe('Imbued Crown and Imbued Brain drops', () => {
  it('every slayer-gated monster/boss drops both imbued items at a valid chance', () => {
    expect(slayerMonsters.length).toBeGreaterThan(0)
    for (const m of slayerMonsters) {
      const crownChance = dropChance(m, 'imbued_crown')
      const brainChance = dropChance(m, 'imbued_brain')
      expect(crownChance, `${m.id} missing imbued_crown drop`).toBeGreaterThan(0)
      expect(crownChance).toBeLessThanOrEqual(1)
      expect(brainChance, `${m.id} missing imbued_brain drop`).toBeGreaterThan(0)
      expect(brainChance).toBeLessThanOrEqual(1)
    }
  })

  it('drop chance scales with slayer level - a higher requirement means better (more common) odds', () => {
    const sorted = [...slayerMonsters].sort((a: any, b: any) => a.slayerRequirement - b.slayerRequirement)
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]
      const cur = sorted[i]
      if (cur.slayerRequirement === prev.slayerRequirement) continue
      expect(dropChance(cur, 'imbued_crown')).toBeGreaterThanOrEqual(dropChance(prev, 'imbued_crown')!)
      expect(dropChance(cur, 'imbued_brain')).toBeGreaterThanOrEqual(dropChance(prev, 'imbued_brain')!)
    }
  })

  it('the lowest-level slayer monster drops at the 1/25000 and 1/150000 anchor rates', () => {
    const lowestLevel = Math.min(...slayerMonsters.map((m: any) => m.slayerRequirement))
    const lowest = slayerMonsters.filter((m: any) => m.slayerRequirement === lowestLevel)
    expect(lowest.length).toBeGreaterThan(0)
    for (const m of lowest) {
      expect(dropChance(m, 'imbued_crown')).toBeCloseTo(1 / 25000, 6)
      expect(dropChance(m, 'imbued_brain')).toBeCloseTo(1 / 150000, 6)
    }
  })

  it('the highest-level slayer monster/boss drops Imbued Crown 1/250 and Imbued Brain 1/1500', () => {
    const highestLevel = Math.max(...slayerMonsters.map((m: any) => m.slayerRequirement))
    const highest = slayerMonsters.find((m: any) => m.slayerRequirement === highestLevel)
    expect(dropChance(highest, 'imbued_crown')).toBeCloseTo(1 / 250, 6)
    expect(dropChance(highest, 'imbued_brain')).toBeCloseTo(1 / 1500, 6)
  })

  it('both imbued items are flagged task-only on every slayer-gated monster', () => {
    for (const m of slayerMonsters) {
      const crown = (m.drops || []).find((d: any) => d.itemId === 'imbued_crown')
      const brain = (m.drops || []).find((d: any) => d.itemId === 'imbued_brain')
      expect(crown.taskOnly, `${m.id} imbued_crown should be taskOnly`).toBe(true)
      expect(brain.taskOnly, `${m.id} imbued_brain should be taskOnly`).toBe(true)
    }
  })

  it('Imbued Crown is a crafting material that combines with the slayer helmet', () => {
    const crown = items.imbued_crown
    expect(crown.type).toBe('resource')
    expect(crown.combineWith).toBe('slayer_helmet')
    expect(crown.combineResult).toBe('imbued_slayer_crown')
    expect(items[crown.combineResult]).toBeDefined()
  })

  it('Imbued Slayer Crown mirrors the base helmet melee bonuses into ranged and magic', () => {
    const base = items.slayer_helmet
    const upgraded = items.imbued_slayer_crown
    expect(upgraded.slot).toBe('head')
    for (const style of ['stab', 'slash', 'crush']) {
      expect(upgraded.attackBonus[style]).toBe(base.attackBonus[style])
      expect(upgraded.defenceBonus[style]).toBe(base.defenceBonus[style])
    }
    // Ranged and magic now match the melee bonus columns instead of being penalised.
    expect(upgraded.attackBonus.magic).toBe(upgraded.attackBonus.stab)
    expect(upgraded.attackBonus.ranged).toBe(upgraded.attackBonus.stab)
    expect(upgraded.defenceBonus.magic).toBe(upgraded.defenceBonus.stab)
    expect(upgraded.defenceBonus.ranged).toBe(upgraded.defenceBonus.stab)
    expect(upgraded.otherBonus.rangedStrength).toBe(upgraded.otherBonus.meleeStrength)
    expect(upgraded.otherBonus.magicDamage).toBe(upgraded.otherBonus.meleeStrength)
    // Slayer task bonuses carry over unchanged from the base helmet.
    expect(upgraded.otherBonus.slayerTaskAccuracyPercent).toBe(base.otherBonus.slayerTaskAccuracyPercent)
    expect(upgraded.otherBonus.slayerTaskDamagePercent).toBe(base.otherBonus.slayerTaskDamagePercent)
  })

  it('Imbued Brain is a rare, unlimited-use +18 magic boost potion lasting 5 minutes', () => {
    const brain = items.imbued_brain
    expect(brain.type).toBe('potion')
    expect(brain.effect).toBe('magic')
    expect(brain.boost).toBe(18)
    expect(brain.duration).toBe(300)
    expect(brain.shopValue).toBe(150000000)
    expect(brain.unlimited).toBe(true)
  })

  it('collection log credits Imbued Crown and Imbued Brain from both slayer-gated bosses', () => {
    const log = collectionLog as any
    expect(log.sharedItems).toContain('imbued_crown')
    expect(log.sharedItems).toContain('imbued_brain')
    const monstersCat = log.categories.find((c: any) => c.id === 'monsters')
    for (const bossId of ['sovrathar_the_ashen_sovereign', 'threefang_cerberus']) {
      const section = monstersCat.sections.find((s: any) => s.id === bossId)
      expect(section, `${bossId} section missing`).toBeDefined()
      expect(section.items).toContain('imbued_crown')
      expect(section.items).toContain('imbued_brain')
    }
  })
})
