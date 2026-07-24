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
  craftableTimes,
  EMPTY_POUCH_ID,
  CRAFT_ACTION_TICKS,
  charmForCombatLevel,
  charmDropChance,
  getMonsterCharmDrops,
  rollSummonAttack,
  summonHitChance,
  createSummonState,
  SCROLLS_PER_POUCH,
  SUMMON_DURATION_TICKS,
  SUMMON_ATTACK_TICKS,
  CHARM_DROP_CHANCE_BASE,
  CHARM_DROP_CHANCE_MAX,
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
  it('a pouch recipe consumes one charm + secondary + empty pouch and grants pouch XP', () => {
    const dragon = getSummoningCreature('dragon')!
    const recipe = getPouchRecipe(dragon)!
    expect(recipe.product).toBe('dragon_pouch')
    expect(recipe.productQty).toBe(1)
    expect(recipe.materials).toEqual({ red_charm: 1, dragon_bones: 1, [EMPTY_POUCH_ID]: 1 })
    expect(recipe.xp).toBe(dragon.pouchXp)
    expect(recipe.xp).toBeGreaterThan(0)
  })

  it('a scroll recipe infuses one pouch into ten scrolls and grants scroll XP', () => {
    const titan = getSummoningCreature('steel_titan')!
    const recipe = getScrollRecipe(titan)!
    expect(recipe.product).toBe('steel_titan_scroll')
    expect(recipe.productQty).toBe(SCROLLS_PER_POUCH)
    expect(recipe.productQty).toBe(10)
    expect(recipe.materials).toEqual({ steel_titan_pouch: 1 })
    expect(recipe.xp).toBe(titan.scrollXp)
    expect(recipe.xp).toBeGreaterThan(0)
  })

  it('the empty pouch is a buyable Skilling-Equipment shop resource', () => {
    const pouch = items[EMPTY_POUCH_ID]
    expect(pouch).toBeDefined()
    expect(pouch.isGeneralStore).toBe(true)
    expect(pouch.type).toBe('resource')
    expect(pouch.shopValue).toBeGreaterThan(0)
  })

  it('resolves creatures back from their pouch and scroll ids', () => {
    expect(creatureForPouch('gargoyle_crab_pouch')?.id).toBe('gargoyle_crab')
    expect(creatureForScroll('fire_giant_scroll')?.id).toBe('fire_giant')
    expect(creatureForPouch('nonsense')).toBeNull()
  })
})

describe('summoning — crafting (inventory + bank)', () => {
  const slot = (id: string, quantity: number) => ({ itemId: id, quantity })
  // Real inventories are fixed 28-slot arrays padded with nulls (addItem needs a
  // free slot for a new stackable product).
  const inv = (...slots: any[]) => { const a = slots.slice(); while (a.length < 28) a.push(null); return a }
  const chicken = getSummoningCreature('chicken')!
  const pouchRecipe = getPouchRecipe(chicken)! // green_charm + raw_chicken + empty_pouch

  it('counts makeable batches across inventory and bank combined', () => {
    const inventory = inv(slot('green_charm', 1), slot('raw_chicken', 3), slot('empty_pouch', 5))
    const bank = { green_charm: { quantity: 4 } }
    // limited by raw_chicken (3 in inv, 0 in bank)
    expect(craftableTimes(pouchRecipe, inventory, bank)).toBe(3)
  })

  it('returns zero makeable when a material is missing from both inventory and bank', () => {
    const inventory = inv(slot('green_charm', 1), slot('empty_pouch', 1))
    expect(craftableTimes(pouchRecipe, inventory, {})).toBe(0)
  })

  it('crafts one product every two ticks', () => {
    expect(CRAFT_ACTION_TICKS).toBe(2)
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

  it('drops the tier charm at the bracket-floor rate for the lowest monster in a tier', () => {
    expect(getMonsterCharmDrops({ combatLevel: 1 })).toEqual([{ itemId: 'green_charm', quantity: 1, chance: CHARM_DROP_CHANCE_BASE }])
    expect(getMonsterCharmDrops({ combatLevel: 51 })).toEqual([{ itemId: 'red_charm', quantity: 1, chance: CHARM_DROP_CHANCE_BASE }])
    expect(getMonsterCharmDrops({ combatLevel: 101 })).toEqual([{ itemId: 'blue_charm', quantity: 1, chance: CHARM_DROP_CHANCE_BASE }])
    expect(CHARM_DROP_CHANCE_BASE).toBe(0.05)
    expect(CHARM_DROP_CHANCE_MAX).toBe(0.25)
  })

  it('scales charm chance up toward the max as combat level rises within a bracket', () => {
    const drops = getMonsterCharmDrops({ combatLevel: 40 })
    expect(drops).toEqual([{ itemId: 'green_charm', quantity: 1, chance: charmDropChance(40) }])
    expect(charmDropChance(40)).toBeGreaterThan(CHARM_DROP_CHANCE_BASE)
    expect(charmDropChance(40)).toBeLessThan(CHARM_DROP_CHANCE_MAX)
  })

  it('hits the max chance at the top of the green and red brackets', () => {
    expect(charmDropChance(50)).toBe(CHARM_DROP_CHANCE_MAX)
    expect(charmDropChance(100)).toBe(CHARM_DROP_CHANCE_MAX)
  })

  it('caps blue-tier chance at combat level 200 and holds it flat beyond', () => {
    expect(charmDropChance(200)).toBe(CHARM_DROP_CHANCE_MAX)
    expect(charmDropChance(380)).toBe(CHARM_DROP_CHANCE_MAX)
    expect(charmDropChance(150)).toBeGreaterThan(CHARM_DROP_CHANCE_BASE)
    expect(charmDropChance(150)).toBeLessThan(CHARM_DROP_CHANCE_MAX)
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
