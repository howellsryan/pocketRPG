import { describe, it, expect } from 'vitest'
import monsters from '../src/data/monsters.json'
import items from '../src/data/items.json'
import collectionLog from '../src/data/collectionLog.json'
import bespokeIcons from '../src/data/bespokeIcons.json'
import {
  getAddSpec,
  addDefinitionsFor,
  selectAddDefinition,
  addPicksAtRandom,
  maxActiveAdds,
} from '../src/engine/bossAdds.js'
import { checkBossRequirementsPure, killCountRequirementsFor } from '../src/engine/combatRequirements.js'
import { isClientReportableMonster } from '../src/engine/killCountReports.js'
import { dropArrivesNoted } from '../src/engine/notedDrops.js'
import { monsterMaxHit, monsterMaxHitRange } from '../src/engine/monsterMaxHit.js'
import { applyForm, isMultiForm, randomFormSwitchThreshold } from '../src/engine/bossForms.js'
import { COOP_BOSSES } from '../src/engine/coopBossEngine.js'
import { placesForActivity } from '../src/engine/worldContent.js'
import { getMonsterArt } from '../src/utils/combatArt.js'

const monstersData = monsters as Record<string, any>
const itemsData = items as Record<string, any>
const QUEEN = 'nagadoth_queen'
const queen = monstersData[QUEEN]
const KINGS = ['nagadoth_rex', 'nagadoth_prime', 'nagadoth_supreme']
const SUMMONS = ['nagadoth_rex_summon', 'nagadoth_prime_summon', 'nagadoth_supreme_summon']

describe('Nagadoth Queen — monster data', () => {
  it('doubles every one of the kings\' stats', () => {
    expect(queen.boss).toBe(true)
    expect(queen.hardMode).toBe(true)
    expect(queen.hitpoints).toBe(2 * monstersData.nagadoth_rex.hitpoints)
    expect(queen.combatLevel).toBe(2 * monstersData.nagadoth_rex.combatLevel)
    // Each king's signature stat, doubled: Rex's attack/strength, Prime's
    // magic, Supreme's ranged, and the defence all three share.
    expect(queen.stats.attack).toBe(2 * monstersData.nagadoth_rex.stats.attack)
    expect(queen.stats.strength).toBe(2 * monstersData.nagadoth_rex.stats.strength)
    expect(queen.stats.magic).toBe(2 * monstersData.nagadoth_prime.stats.magic)
    expect(queen.stats.ranged).toBe(2 * monstersData.nagadoth_supreme.stats.ranged)
    for (const king of KINGS) expect(queen.stats.defence).toBe(2 * monstersData[king].stats.defence)
    for (const style of Object.keys(queen.defenceBonus)) {
      expect(queen.defenceBonus[style], style).toBe(2 * monstersData.nagadoth_rex.defenceBonus.crush)
    }
  })

  it('is a tribrid: three styles, 2-5 attacks each, switched at random', () => {
    expect(isMultiForm(queen)).toBe(true)
    expect(Object.keys(queen.forms).sort()).toEqual(['magic', 'melee', 'ranged'])
    expect(queen.forms.ranged.attackStyle).toBe('ranged')
    expect(queen.forms.magic.attackStyle).toBe('magic')
    expect(['crush', 'stab', 'slash']).toContain(queen.forms.melee.attackStyle)
    expect(queen.formSwitchMin).toBe(2)
    expect(queen.formSwitchMax).toBe(5)
    // No formCycleOrder, so pickNextForm rolls rather than walking a rota.
    expect(queen.formCycleOrder).toBeUndefined()
    expect(queen.randomFormEveryAttack).toBeUndefined()
    expect(randomFormSwitchThreshold(queen, () => 0)).toBe(2)
    expect(randomFormSwitchThreshold(queen, () => 0.999)).toBe(5)
  })

  it('hits equally hard and equally often whichever style it is in', () => {
    const maxHits = new Set<number>()
    const rolls = new Set<number>()
    for (const key of Object.keys(queen.forms)) {
      const inForm = { ...queen, stats: { ...queen.stats }, defenceBonus: { ...queen.defenceBonus } }
      applyForm(inForm, key)
      maxHits.add(monsterMaxHit(inForm, inForm.attackStyle))
      // resolveEnemySwing's attack roll, which is style-independent by design:
      // (stats.magic || stats.attack) + 9, times attackBonus + 64.
      rolls.add(((inForm.stats.magic || inForm.stats.attack) + 9) * ((inForm.attackBonus || 0) + 64))
    }
    expect([...maxHits]).toEqual([42])
    expect(rolls.size).toBe(1)
    expect(monsterMaxHitRange(queen)).toEqual({ min: 42, max: 42 })
  })

  it('summons one of the three kings at random, one at a time', () => {
    const spec = getAddSpec(queen)!
    expect(spec.monsterIds).toEqual(SUMMONS)
    expect(addPicksAtRandom(spec)).toBe(true)
    expect(maxActiveAdds(spec)).toBe(1)
    // Same cadence as the Corporeal Horror, which this mechanic mirrors.
    expect(spec.firstSpawnAfterAttacks).toEqual(monstersData.corporeal_horror.spawnsAdd.firstSpawnAfterAttacks)
    expect(spec.respawnAfterAttacks).toEqual(monstersData.corporeal_horror.spawnsAdd.respawnAfterAttacks)

    const definitions = addDefinitionsFor(spec, monstersData)!
    // The roster is keyed by id, so the queen's own form never selects one.
    for (const key of Object.keys(queen.forms)) {
      expect(selectAddDefinition(definitions, { currentForm: key }, 0, () => 0).id).toBe(SUMMONS[0])
    }
    expect(selectAddDefinition(definitions, queen, 0, () => 0.99).id).toBe(SUMMONS[2])
    expect(selectAddDefinition(definitions, queen, 0, () => 0.5).id).toBe(SUMMONS[1])
  })

  it('summons kings at the kings\' own strength, dropping nothing', () => {
    for (const [summonId, kingId] of SUMMONS.map((s, i) => [s, KINGS[i]] as const)) {
      const summon = monstersData[summonId]
      const king = monstersData[kingId]
      expect(summon.isAdd, summonId).toBe(true)
      expect(summon.summonedBy).toBe(QUEEN)
      expect(summon.drops).toEqual([])
      expect(summon.hitpoints).toBe(king.hitpoints)
      expect(summon.stats).toEqual(king.stats)
      expect(summon.attackStyle).toBe(king.attackStyle)
      expect(summon.attackSpeed).toBe(king.attackSpeed)
      expect(summon.defenceBonus).toEqual(king.defenceBonus)
      expect(monsterMaxHit(summon)).toBe(monsterMaxHit(king))
    }
  })
})

describe('Nagadoth Queen — drops', () => {
  const byId = Object.fromEntries(queen.drops.map((d: any) => [d.itemId, d]))

  it('every drop resolves to a real item', () => {
    for (const drop of queen.drops) expect(itemsData[drop.itemId], `unknown ${drop.itemId}`).toBeDefined()
  })

  it('pays 5 nagadoth bones a kill, noted', () => {
    expect(byId.nagadoth_bones.quantity).toBe(5)
    expect(byId.nagadoth_bones.chance).toBe(1)
    expect(byId.nagadoth_bones.noted).toBe(true)
    // The quantity rule would note it anyway — the flag is belt and braces.
    expect(dropArrivesNoted('nagadoth_bones', 5, itemsData)).toBe(true)
  })

  it('drops the Ring of Royalty at 1/256 and nothing else unique', () => {
    expect(byId.ring_of_royalty.chance).toBeCloseTo(1 / 256, 8)
    expect(byId.ring_of_royalty.quantity).toBe(1)
    for (const ring of ['berserker_ring', 'archers_ring', 'seers_ring', 'warriors_ring']) {
      expect(byId[ring], `${ring} belongs to its own king`).toBeUndefined()
    }
  })

  it('otherwise carries the kings\' table', () => {
    const shared = monstersData.nagadoth_rex.drops
      .filter((d: any) => d.itemId !== 'nagadoth_bones' && !itemsData[d.itemId].isBossUnique)
    for (const drop of shared) {
      expect(byId[drop.itemId], `missing ${drop.itemId}`).toBeDefined()
      expect(byId[drop.itemId].chance, drop.itemId).toBe(drop.chance)
      expect(byId[drop.itemId].quantity, drop.itemId).toEqual(drop.quantity)
    }
  })
})

describe('Ring of Royalty', () => {
  const ring = itemsData.ring_of_royalty

  it('is a 200m ring-slot boss unique', () => {
    expect(ring.name).toBe('Ring of Royalty')
    expect(ring.slot).toBe('ring')
    expect(ring.shopValue).toBe(200_000_000)
    expect(ring.isBossUnique).toBe(true)
    expect(ring.stackable).toBe(false)
    expect(ring.requirements).toEqual({})
  })

  it('carries every positive bonus of the three kings\' rings at once', () => {
    const sources = ['berserker_ring', 'archers_ring', 'seers_ring']
    for (const key of ['meleeStrength', 'rangedStrength', 'magicDamage', 'meleeDamage']) {
      const best = Math.max(...sources.map((id) => Number(itemsData[id].otherBonus?.[key]) || 0))
      expect(ring.otherBonus[key], key).toBe(best)
      expect(best, `${key} comes from a king's ring`).toBeGreaterThan(0)
    }
    // Nothing invented beyond those three rings.
    for (const value of Object.values(ring.attackBonus)) expect(value).toBe(0)
    for (const value of Object.values(ring.defenceBonus)) expect(value).toBe(0)
  })

  it('has its own bespoke icon and a collection log slot', () => {
    expect(bespokeIcons).toHaveProperty('ring_of_royalty')
    const sections = (collectionLog as any).categories.flatMap((c: any) => c.sections || [])
    const slot = sections.find((s: any) => s.id === QUEEN)
    expect(slot, 'queen collection log section').toBeDefined()
    expect(slot.items).toContain('ring_of_royalty')
  })
})

describe('Nagadoth Queen — entry gate', () => {
  const ctx = (bossKillCounts: Record<string, number>) => ({
    slayerLevel: 99,
    completedQuests: new Set<string>(),
    bossKillCounts,
    questsData: [],
    monstersData,
  })

  it('requires one kill of each king', () => {
    expect(killCountRequirementsFor(queen)).toEqual({
      nagadoth_rex: 1, nagadoth_prime: 1, nagadoth_supreme: 1,
    })
  })

  it('stays locked while any king is unkilled', () => {
    for (const missing of KINGS) {
      const counts = Object.fromEntries(KINGS.filter((k) => k !== missing).map((k) => [k, 1]))
      const gate = checkBossRequirementsPure(queen, ctx(counts))
      expect(gate.locked, `without ${missing}`).toBe(true)
      expect(gate.reason).toContain(monstersData[missing].name)
    }
  })

  it('opens once all three are on record', () => {
    expect(checkBossRequirementsPure(queen, ctx({ nagadoth_rex: 1, nagadoth_prime: 1, nagadoth_supreme: 1 })).locked).toBe(false)
  })

  it('waits rather than guessing while the counts are still loading', () => {
    const gate = checkBossRequirementsPure(queen, { ...ctx({}), bossKillCountsLoaded: false })
    expect(gate.locked).toBe(true)
    expect(gate.pending).toBe(true)
  })

  it('keeps the gate off the client-reported kill-count channel', () => {
    // The queen is a boss; the kings now answer a boss door, so neither side of
    // the gate may be counted on anything a client says (CLAUDE.md §14).
    expect(isClientReportableMonster(QUEEN)).toBe(false)
    for (const king of KINGS) expect(isClientReportableMonster(king), king).toBe(false)
  })
})

describe('Nagadoth Queen — surfaces', () => {
  it('stands with the kings at Ardounne', () => {
    expect(placesForActivity('combat', QUEEN)).toEqual(placesForActivity('combat', 'nagadoth_rex'))
  })

  it('can be fought as a group', () => {
    expect(COOP_BOSSES).toHaveProperty(QUEEN)
  })

  it('has its own combat emblem', () => {
    expect(getMonsterArt(queen, undefined).icon).toBe('queen_crown')
  })
})
