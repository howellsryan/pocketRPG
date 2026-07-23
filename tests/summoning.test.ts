import { describe, expect, it, vi, afterEach } from 'vitest'
import itemsData from '../src/data/items.json'
import {
  SUMMONING_CREATURES,
  getSummoningCreature,
  creatureForPouch,
  creatureForScroll,
  getUnlockedCreatures,
  getPouchRecipe,
  getScrollRecipe,
  charmForCombatLevel,
  getMonsterCharmDrops,
  rollSummonAttack,
  summonHitChance,
  createSummonState,
  SCROLLS_PER_POUCH,
  SUMMON_DURATION_TICKS,
  SUMMON_ATTACK_TICKS,
  CHARM_DROP_CHANCE,
} from '../src/engine/summoning.js'
import { createCombatState, processCombatTick } from '../src/engine/combat.js'

const items: Record<string, any> = itemsData as any

afterEach(() => {
  vi.restoreAllMocks()
})

describe('summoning — content integrity', () => {
  it('every creature references items that exist, with matching charm tiers', () => {
    for (const c of SUMMONING_CREATURES) {
      expect(items[c.charm], `${c.id} charm ${c.charm}`).toBeDefined()
      expect(items[c.secondary], `${c.id} secondary ${c.secondary}`).toBeDefined()
      expect(items[c.pouch], `${c.id} pouch ${c.pouch}`).toBeDefined()
      expect(items[c.scroll], `${c.id} scroll ${c.scroll}`).toBeDefined()
      // Pouches and scrolls must stack (crafted in bulk, spent per attack).
      expect(items[c.pouch].stackable).toBe(true)
      expect(items[c.scroll].stackable).toBe(true)
      expect(['green_charm', 'red_charm', 'blue_charm']).toContain(c.charm)
    }
  })

  it('the Summoning cape is a level-99 skill cape', () => {
    const cape = items['summoning_cape']
    expect(cape).toBeDefined()
    expect(cape.isSkillCape).toBe(true)
    expect(cape.requirements).toEqual({ summoning: 99 })
    expect(cape.slot).toBe('cape')
  })
})

describe('summoning — recipes', () => {
  it('a pouch recipe consumes one charm + one secondary and yields one pouch', () => {
    const dragon = getSummoningCreature('dragon')!
    const recipe = getPouchRecipe(dragon)!
    expect(recipe.product).toBe('dragon_pouch')
    expect(recipe.productQty).toBe(1)
    expect(recipe.materials).toEqual({ red_charm: 1, dragon_bones: 1 })
  })

  it('a scroll recipe infuses one pouch into ten scrolls', () => {
    const titan = getSummoningCreature('steel_titan')!
    const recipe = getScrollRecipe(titan)!
    expect(recipe.product).toBe('steel_titan_scroll')
    expect(recipe.productQty).toBe(SCROLLS_PER_POUCH)
    expect(recipe.productQty).toBe(10)
    expect(recipe.materials).toEqual({ steel_titan_pouch: 1 })
  })

  it('resolves creatures back from their pouch and scroll ids', () => {
    expect(creatureForPouch('gargoyle_crab_pouch')?.id).toBe('gargoyle_crab')
    expect(creatureForScroll('fire_giant_scroll')?.id).toBe('fire_giant')
    expect(creatureForPouch('nonsense')).toBeNull()
  })
})

describe('summoning — unlocks', () => {
  it('only unlocks a creature once the Summoning level meets its requirement', () => {
    expect(getUnlockedCreatures(1).map(c => c.id)).toEqual(['chicken'])
    expect(getUnlockedCreatures(50).map(c => c.id)).toContain('fire_giant')
    expect(getUnlockedCreatures(69).map(c => c.id)).not.toContain('dragon')
    expect(getUnlockedCreatures(70).map(c => c.id)).toContain('dragon')
    expect(getUnlockedCreatures(99).length).toBe(SUMMONING_CREATURES.length)
  })
})

describe('summoning — charm drops', () => {
  it('tiers charms by combat level at the documented boundaries', () => {
    expect(charmForCombatLevel(0)).toBeNull()
    expect(charmForCombatLevel(1)).toBe('green_charm')
    expect(charmForCombatLevel(50)).toBe('green_charm')
    expect(charmForCombatLevel(51)).toBe('red_charm')
    expect(charmForCombatLevel(100)).toBe('red_charm')
    expect(charmForCombatLevel(101)).toBe('blue_charm')
  })

  it('drops the tier charm at a flat 5% for a regular monster', () => {
    const drops = getMonsterCharmDrops({ combatLevel: 40 })
    expect(drops).toEqual([{ itemId: 'green_charm', quantity: 1, chance: CHARM_DROP_CHANCE }])
    expect(CHARM_DROP_CHANCE).toBe(0.05)
  })

  it('never drops charms for bosses or raid bosses', () => {
    expect(getMonsterCharmDrops({ combatLevel: 300, boss: true })).toEqual([])
    expect(getMonsterCharmDrops({ combatLevel: 300, raidBoss: true })).toEqual([])
    expect(getMonsterCharmDrops({ combatLevel: 0 })).toEqual([])
  })
})

describe('summoning — combat rolls', () => {
  const monster = {
    stats: { defence: 1 },
    defenceBonus: { stab: 0, slash: 0, crush: -20, magic: 0, ranged: 0 },
  }

  it('rolls one damage value per creature hit (Steel Titan swings three times)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0) // force a hit, min damage per swing
    const titan = getSummoningCreature('steel_titan')!
    const res = rollSummonAttack(titan, monster)
    expect(res.hits.length).toBe(3)
    expect(res.damage).toBe(res.hits.reduce((a, b) => a + b, 0))
    for (const h of res.hits) {
      expect(h).toBeGreaterThanOrEqual(1)
      expect(h).toBeLessThanOrEqual(titan.maxHit)
    }
  })

  it('a single-hit creature rolls exactly one swing capped at its max hit', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999) // near-miss high roll
    const chicken = getSummoningCreature('chicken')!
    const res = rollSummonAttack(chicken, monster)
    expect(res.hits.length).toBe(1)
  })

  it('higher-tier creatures have higher accuracy against the same monster', () => {
    const chicken = getSummoningCreature('chicken')!
    const dragon = getSummoningCreature('dragon')!
    expect(summonHitChance(dragon, monster)).toBeGreaterThan(summonHitChance(chicken, monster))
  })
})

describe('summoning — live combat integration', () => {
  const itemsForFight: any = {}
  const maxedStats = { attack: 99, strength: 99, defence: 99, ranged: 99, magic: 99, currentHP: 99 }

  function tankMonster(overrides: any = {}) {
    return {
      id: 'summon_dummy',
      name: 'Summon Dummy',
      hitpoints: 1_000_000,
      combatLevel: 40,
      attackSpeed: 999, // never attacks the player during the window
      attackStyle: 'crush',
      stats: { attack: 1, strength: 1, defence: 1, magic: 1, ranged: 1 },
      attackBonus: 0,
      strengthBonus: 0,
      defenceBonus: { stab: -50, slash: -50, crush: -50, magic: 0, ranged: 0 },
      drops: [],
      noSeedDrops: true,
      ...overrides,
    }
  }

  function withSummon(creatureId: string) {
    const state: any = createCombatState(tankMonster(), 'melee', 'accurate')
    state.summon = createSummonState(creatureId)
    return state
  }

  it('the creature attacks every SUMMON_ATTACK_TICKS, dealing damage and spending one scroll', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0) // force a hit
    let state = withSummon('dragon')
    const inventory = [{ itemId: 'dragon_scroll', quantity: 10 }]
    const all: any[] = []
    for (let i = 0; i < SUMMON_ATTACK_TICKS; i++) {
      const { combatState, events } = processCombatTick(state, maxedStats, {}, itemsForFight, {}, inventory)
      state = combatState
      all.push(...events)
    }
    const hit = all.find(e => e.type === 'summonHit')
    const consume = all.find(e => e.type === 'consumeScroll')
    expect(hit, 'creature should attack within the cadence').toBeDefined()
    expect(hit.creatureId).toBe('dragon')
    expect(hit.damage).toBeGreaterThan(0)
    expect(consume).toEqual({ type: 'consumeScroll', itemId: 'dragon_scroll', qty: 1 })
  })

  it('emits summonNoScrolls (and no damage) when the creature has no scrolls', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    let state = withSummon('dragon')
    const emptyInv: any[] = []
    const all: any[] = []
    for (let i = 0; i < SUMMON_ATTACK_TICKS; i++) {
      const { combatState, events } = processCombatTick(state, maxedStats, {}, itemsForFight, {}, emptyInv)
      state = combatState
      all.push(...events)
    }
    expect(all.some(e => e.type === 'summonNoScrolls')).toBe(true)
    expect(all.some(e => e.type === 'summonHit')).toBe(false)
    expect(all.some(e => e.type === 'consumeScroll')).toBe(false)
  })

  it('expires the summon after SUMMON_DURATION_TICKS and clears it from state', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    let state = withSummon('chicken')
    const inventory = [{ itemId: 'chicken_scroll', quantity: 999 }]
    let expired = false
    for (let i = 0; i < SUMMON_DURATION_TICKS + 1; i++) {
      const { combatState, events } = processCombatTick(state, maxedStats, {}, itemsForFight, {}, inventory)
      state = combatState
      if (events.some(e => e.type === 'summonExpired')) expired = true
    }
    expect(expired).toBe(true)
    expect(state.summon).toBeNull()
  })
})
