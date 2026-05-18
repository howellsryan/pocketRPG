import { describe, it, expect } from 'vitest'
import monstersData from '../src/data/monsters.json'
import itemsData from '../src/data/items.json'
import collectionLog from '../src/data/collectionLog.json'

const monsters = monstersData as Record<string, any>
const items = itemsData as Record<string, any>

const NEW_MID_TIER_MONSTERS = [
  'dustpaw_rat', 'bogling_sprite', 'frostbite_imp', 'marshfen_toad', 'cinderpaw_cub',
  'glaive_skeleton', 'mirebound_husk', 'verdant_stalker', 'stoneglare_basilisk',
  'embertongue_lizard', 'hollow_reaver', 'briarheart_treant', 'frostmaw_direwolf',
  'pyreclaw_demon', 'wraithgale_specter', 'bloodmoon_stalker', 'ironfang_drake',
  'shadeglass_golem', 'tidereaper_crab', 'voidweave_stalker', 'drakthul_wyrmling',
  'bonelight_pyromancer', 'cinderfang_reaver', 'ashen_marauder',
]

describe('New slayer monsters', () => {
  it('adds 24 mid-tier monsters within combat level 1-99', () => {
    expect(NEW_MID_TIER_MONSTERS).toHaveLength(24)
    for (const id of NEW_MID_TIER_MONSTERS) {
      const m = monsters[id]
      expect(m, `${id} should be defined`).toBeDefined()
      expect(m.combatLevel).toBeGreaterThanOrEqual(1)
      expect(m.combatLevel).toBeLessThanOrEqual(99)
      expect(m.slayerRequirement).toBeGreaterThanOrEqual(1)
      expect(m.boss).not.toBe(true)
    }
  })

  it('every new monster has unique stats, attack style, and drop table', () => {
    const validStyles = new Set(['stab', 'slash', 'crush', 'magic', 'ranged'])
    for (const id of NEW_MID_TIER_MONSTERS) {
      const m = monsters[id]
      expect(validStyles.has(m.attackStyle), `${id} attackStyle must be valid`).toBe(true)
      expect(m.attackSpeed).toBeGreaterThanOrEqual(2)
      expect(m.attackSpeed).toBeLessThanOrEqual(6)
      expect(Array.isArray(m.drops)).toBe(true)
      expect(m.drops.length).toBeGreaterThan(2)
      for (const d of m.drops) {
        expect(items[d.itemId], `${id} drop ${d.itemId} must exist in items.json`).toBeDefined()
        expect(d.chance).toBeGreaterThan(0)
        expect(d.chance).toBeLessThanOrEqual(1)
      }
    }
  })

  it('attack styles vary across the new monster set', () => {
    const styles = new Set(NEW_MID_TIER_MONSTERS.map(id => monsters[id].attackStyle))
    expect(styles.size).toBeGreaterThanOrEqual(4)
  })

  it('weighted mid/high: most new monsters are combat level 50+', () => {
    const midHigh = NEW_MID_TIER_MONSTERS.filter(id => monsters[id].combatLevel >= 50)
    expect(midHigh.length).toBeGreaterThanOrEqual(15)
  })
})

describe('Sovrathar, the Ashen Sovereign (level-250 slayer boss)', () => {
  const boss = monsters.sovrathar_the_ashen_sovereign

  it('exists with expected core config', () => {
    expect(boss).toBeDefined()
    expect(boss.name).toBe('Sovrathar, the Ashen Sovereign')
    expect(boss.boss).toBe(true)
    expect(boss.combatLevel).toBe(250)
    expect(boss.slayerRequirement).toBe(80)
  })

  it('has an enrage form triggered at low HP', () => {
    expect(boss.multiForm).toBe(true)
    expect(boss.initialForm).toBe('calm')
    expect(boss.enrageHpPercent).toBe(33)
    expect(boss.enrageFormKey).toBe('enraged')
    expect(boss.forms.calm).toBeDefined()
    expect(boss.forms.enraged).toBeDefined()
    expect(boss.forms.enraged.maxHit).toBeGreaterThan(boss.forms.calm.maxHit)
    expect(boss.forms.enraged.attackBonus).toBeGreaterThan(boss.forms.calm.attackBonus)
    expect(boss.forms.enraged.strengthBonus).toBeGreaterThan(boss.forms.calm.strengthBonus)
  })

  it('drops the five Sovrathar uniques plus standard supplies', () => {
    const dropIds = new Set(boss.drops.map((d: any) => d.itemId))
    expect(dropIds.has('sovrathar_ashen_hilt')).toBe(true)
    expect(dropIds.has('cinderforged_helm')).toBe(true)
    expect(dropIds.has('sovereigns_cinderplate')).toBe(true)
    expect(dropIds.has('sovereigns_cindergreaves')).toBe(true)
    expect(dropIds.has('ashen_sovereigns_edge')).toBe(true)
    expect(dropIds.has('dragon_bones')).toBe(true)
    expect(dropIds.has('clue_scroll_master')).toBe(true)
  })

  it('weapon drop is rarer than armour drops, which are rarer than the crafting material', () => {
    const get = (id: string) => boss.drops.find((d: any) => d.itemId === id)!.chance
    expect(get('sovrathar_ashen_hilt')).toBeGreaterThan(get('cinderforged_helm'))
    expect(get('cinderforged_helm')).toBeGreaterThan(get('ashen_sovereigns_edge'))
  })
})

describe('Sovrathar endgame items', () => {
  it('Ashen Sovereign\'s Edge is a slayer-task situational BiS weapon', () => {
    const w = items.ashen_sovereigns_edge
    expect(w).toBeDefined()
    expect(w.type).toBe('weapon')
    expect(w.slot).toBe('weapon')
    expect(w.requirements.attack).toBe(60)
    expect(w.requirements.slayer).toBe(80)
    // Off-task strength bonus must NOT exceed current top-tier (Ancient Maul = 147)
    expect(w.otherBonus.meleeStrength).toBeLessThan(items.ancient_maul.otherBonus.meleeStrength)
    // But on-task slayer bonuses are significant
    expect(w.otherBonus.slayerTaskAccuracyFlat).toBeGreaterThanOrEqual(20)
    expect(w.otherBonus.slayerTaskDamageFlat).toBeGreaterThanOrEqual(5)
  })

  it('Sovrathar armour pieces are magic-defence specialised with lower combat req than Justicar', () => {
    const justicarBody = items.justicar_chestguard
    const plate = items.sovereigns_cinderplate
    expect(plate.requirements.defence).toBeLessThan(justicarBody.requirements.defence)
    expect(plate.defenceBonus.stab).toBeLessThan(justicarBody.defenceBonus.stab)
    // Magic defence is the situational niche — much higher than Justicar's negative magic def
    expect(plate.defenceBonus.magic).toBeGreaterThan(justicarBody.defenceBonus.magic)
    expect(plate.otherBonus.slayerTaskAccuracyFlat).toBeGreaterThan(0)

    for (const id of ['cinderforged_helm', 'sovereigns_cindergreaves']) {
      const piece = items[id]
      expect(piece.requirements.defence).toBe(60)
      expect(piece.requirements.slayer).toBe(80)
      expect(piece.otherBonus.slayerTaskAccuracyFlat).toBeGreaterThan(0)
    }
  })

  it('Ashen Hilt is a crafting material combining with the slayer helmet', () => {
    const hilt = items.sovrathar_ashen_hilt
    expect(hilt.type).toBe('resource')
    expect(hilt.combineWith).toBe('slayer_helmet')
    expect(hilt.combineResult).toBe('ashen_slayer_helm')
    expect(items[hilt.combineResult]).toBeDefined()
  })

  it('Ashen Slayer Helm upgrades the base slayer helmet stats', () => {
    const base = items.slayer_helmet
    const upgraded = items.ashen_slayer_helm
    expect(upgraded.slot).toBe('head')
    expect(upgraded.otherBonus.slayerTaskAccuracyFlat).toBeGreaterThan(base.otherBonus.slayerTaskAccuracyFlat)
    expect(upgraded.otherBonus.slayerTaskDamageFlat).toBeGreaterThan(base.otherBonus.slayerTaskDamageFlat)
    expect(upgraded.defenceBonus.stab).toBeGreaterThan(base.defenceBonus.stab)
    expect(upgraded.requirements.slayer).toBe(80)
  })
})

describe('Sovrathar collection log entry', () => {
  it('adds a Sovrathar section listing all uniques', () => {
    const log = collectionLog as any
    const monstersCat = log.categories.find((c: any) => c.id === 'monsters')
    const section = monstersCat.sections.find((s: any) => s.id === 'sovrathar_the_ashen_sovereign')
    expect(section).toBeDefined()
    expect(section.items).toContain('sovrathar_ashen_hilt')
    expect(section.items).toContain('cinderforged_helm')
    expect(section.items).toContain('sovereigns_cinderplate')
    expect(section.items).toContain('sovereigns_cindergreaves')
    expect(section.items).toContain('ashen_sovereigns_edge')
    expect(section.items).toContain('ashen_slayer_helm')
  })
})
