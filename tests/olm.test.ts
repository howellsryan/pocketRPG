import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createCombatState, processCombatTick } from '../src/engine/combat.js'
import itemsData from '../src/data/items.json'
import monstersData from '../src/data/monsters.json'

const olm = monstersData['olm']

describe('The Great Olm Boss', () => {
  describe('Boss Stats', () => {
    it('should have correct combat level and hitpoints', () => {
      expect(olm.combatLevel).toBe(1000)
      expect(olm.hitpoints).toBe(800)
    })

    it('should have all combat stats at 250 and defence 150', () => {
      expect(olm.stats.attack).toBe(250)
      expect(olm.stats.strength).toBe(250)
      expect(olm.stats.defence).toBe(150)
      expect(olm.stats.magic).toBe(250)
      expect(olm.stats.ranged).toBe(250)
    })

    it('should have attack speed of 4 ticks', () => {
      expect(olm.attackSpeed).toBe(4)
    })

    it('should require a double kill', () => {
      expect(olm.requiresDoubleKill).toBe(true)
    })

    it('should be flagged as a boss', () => {
      expect(olm.boss).toBe(true)
    })
  })

  describe('Defence Bonuses', () => {
    it('should have melee and magic defence of +200 and zero ranged defence', () => {
      expect(olm.defenceBonus.stab).toBe(200)
      expect(olm.defenceBonus.slash).toBe(200)
      expect(olm.defenceBonus.crush).toBe(200)
      expect(olm.defenceBonus.magic).toBe(200)
      expect(olm.defenceBonus.ranged).toBe(0)
    })

    it('each form should maintain the same defence bonuses (always weak to ranged)', () => {
      for (const form of Object.values(olm.forms)) {
        expect((form as any).defenceBonus.ranged).toBe(0)
        expect((form as any).defenceBonus.stab).toBe(200)
        expect((form as any).defenceBonus.magic).toBe(200)
      }
    })
  })

  describe('Phase Mechanics', () => {
    it('should have three forms: magic, melee, ranged', () => {
      expect(olm.forms).toBeDefined()
      expect(olm.forms.magic).toBeDefined()
      expect(olm.forms.melee).toBeDefined()
      expect(olm.forms.ranged).toBeDefined()
    })

    it('should start in magic phase', () => {
      expect(olm.initialForm).toBe('magic')
    })

    it('should change form every attack (randomFormEveryAttack)', () => {
      expect(olm.randomFormEveryAttack).toBe(true)
    })

    it('should not have a fixed cycle order (random phases)', () => {
      expect(olm.formCycleOrder).toBeUndefined()
    })

    it('each phase should have max hit of 30', () => {
      expect(olm.forms.magic.maxHit).toBe(30)
      expect(olm.forms.melee.maxHit).toBe(30)
      expect(olm.forms.ranged.maxHit).toBe(30)
    })

    it('each phase should have its correct attack style', () => {
      expect(olm.forms.magic.attackStyle).toBe('magic')
      expect(olm.forms.melee.attackStyle).toBe('crush')
      expect(olm.forms.ranged.attackStyle).toBe('ranged')
    })
  })

  describe('Combat Initialization', () => {
    let combatState: ReturnType<typeof createCombatState>

    beforeEach(() => {
      combatState = createCombatState(olm, 'ranged', 'accurate')
    })

    it('should initialize in magic phase', () => {
      expect(combatState.monster.currentForm).toBe('magic')
    })

    it('should initialize with 800 hitpoints', () => {
      expect(combatState.monster.currentHP).toBe(800)
    })

    it('should initialize with doubleKillCount of 0', () => {
      expect(combatState.doubleKillCount).toBe(0)
    })

    it('should have formSwitchThreshold of 1 (per-attack switching)', () => {
      expect(combatState.monster.formSwitchThreshold).toBe(1)
    })
  })

  describe('Random Phase Switching', () => {
    it('should switch to a random phase on each monster attack', () => {
      const state = createCombatState(olm, 'ranged', 'accurate')
      expect(state.monster.currentForm).toBe('magic')

      // Simulate monster attacks to trigger phase switches
      const playerStats = { attack: 99, strength: 99, defence: 99, ranged: 99, magic: 99, hitpoints: 99, currentHP: 99 }
      const emptyEquipment = { weapon: null, shield: null, head: null, body: null, legs: null, feet: null, hands: null, cape: null, neck: null, ring: null, ammo: null }

      // After first monster attack — form should switch to a random phase
      let result = processCombatTick(state, playerStats, emptyEquipment, itemsData)
      let s = result.combatState
      // Manually advance monsterAttackTimer to trigger attack
      s.monsterAttackTimer = 0
      result = processCombatTick(s, playerStats, emptyEquipment, itemsData)
      expect(['magic', 'melee', 'ranged']).toContain(result.combatState.monster.currentForm)

      // After second monster attack — form should switch to another random phase
      s = result.combatState
      s.monsterAttackTimer = 0
      result = processCombatTick(s, playerStats, emptyEquipment, itemsData)
      expect(['magic', 'melee', 'ranged']).toContain(result.combatState.monster.currentForm)

      // After third monster attack — form should switch to another random phase (could be the same as previous)
      s = result.combatState
      s.monsterAttackTimer = 0
      result = processCombatTick(s, playerStats, emptyEquipment, itemsData)
      expect(['magic', 'melee', 'ranged']).toContain(result.combatState.monster.currentForm)
    })
  })

  describe('Double Kill Mechanic', () => {
    // Mock Math.random to always return 0.5 — guarantees hits (acc > 0.5) and non-zero damage
    beforeEach(() => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5)
    })
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('should regenerate on first kill and continue combat', () => {
      const state = createCombatState(olm, 'ranged', 'accurate')
      state.monster.currentHP = 1

      const playerStats = { attack: 99, strength: 99, defence: 99, ranged: 99, magic: 99, hitpoints: 99, currentHP: 99 }
      const equipment = {
        weapon: { itemId: 'bow_of_faerdhinen', charges: 999 },
        shield: null, head: null, body: null, legs: null, feet: null, hands: null, cape: null, neck: null, ring: null, ammo: null
      }
      state.playerAttackTimer = 0

      const result = processCombatTick(state, playerStats, equipment, itemsData)
      const events = result.events

      const phaseReset = events.find(e => e.type === 'bossPhaseReset')
      const monsterDeath = events.find(e => e.type === 'monsterDeath')

      expect(phaseReset).toBeDefined()
      expect(monsterDeath).toBeUndefined()
      expect(result.combatState.active).toBe(true)
      expect(result.combatState.monster.currentHP).toBe(800)
      expect(result.combatState.doubleKillCount).toBe(1)
    })

    it('should grant loot on second kill', () => {
      const state = createCombatState(olm, 'ranged', 'accurate')
      state.monster.currentHP = 1
      state.doubleKillCount = 1

      const playerStats = { attack: 99, strength: 99, defence: 99, ranged: 99, magic: 99, hitpoints: 99, currentHP: 99 }
      const equipment = {
        weapon: { itemId: 'bow_of_faerdhinen', charges: 999 },
        shield: null, head: null, body: null, legs: null, feet: null, hands: null, cape: null, neck: null, ring: null, ammo: null
      }
      state.playerAttackTimer = 0

      const result = processCombatTick(state, playerStats, equipment, itemsData)
      const events = result.events

      const monsterDeath = events.find(e => e.type === 'monsterDeath')
      const phaseReset = events.find(e => e.type === 'bossPhaseReset')

      expect(monsterDeath).toBeDefined()
      expect(phaseReset).toBeUndefined()
      expect(result.combatState.active).toBe(false)
    })

    it('should reset spec energy on phase reset', () => {
      const state = createCombatState(olm, 'ranged', 'accurate')
      state.monster.currentHP = 1
      state.specialAttackEnergy = 25

      const playerStats = { attack: 99, strength: 99, defence: 99, ranged: 99, magic: 99, hitpoints: 99, currentHP: 99 }
      const equipment = {
        weapon: { itemId: 'bow_of_faerdhinen', charges: 999 },
        shield: null, head: null, body: null, legs: null, feet: null, hands: null, cape: null, neck: null, ring: null, ammo: null
      }
      state.playerAttackTimer = 0

      const result = processCombatTick(state, playerStats, equipment, itemsData)
      expect(result.combatState.specialAttackEnergy).toBe(100)
    })
  })

  describe('Drop Table', () => {
    it('should always drop coins', () => {
      const coinsDrop = olm.drops.find((d: any) => d.itemId === 'coins')
      expect(coinsDrop).toBeDefined()
      expect(coinsDrop.chance).toBe(1.0)
    })

    it('should have all 10 unique drops', () => {
      const uniques = [
        'twisted_buckler', 'dragon_hunter_crossbow',
        'dinhs_bulwark', 'ancestral_hat', 'ancestral_robe_top', 'ancestral_robe_bottom', 'dragon_claws',
        'elder_maul', 'kodai_wand', 'twisted_bow'
      ]
      for (const itemId of uniques) {
        const drop = olm.drops.find((d: any) => d.itemId === itemId)
        expect(drop).toBeDefined()
        expect(drop.quantity).toBe(1)
      }
    })

    it('twisted buckler and dragon hunter crossbow should have ~1/17.25 drop rate', () => {
      const buckler = olm.drops.find((d: any) => d.itemId === 'twisted_buckler')
      const dhcb = olm.drops.find((d: any) => d.itemId === 'dragon_hunter_crossbow')
      expect(buckler.chance).toBeCloseTo(0.058, 2)
      expect(dhcb.chance).toBeCloseTo(0.058, 2)
    })

    it('twisted bow, elder maul, and kodai wand should have ~1/34.5 drop rate', () => {
      const tbow = olm.drops.find((d: any) => d.itemId === 'twisted_bow')
      const maul = olm.drops.find((d: any) => d.itemId === 'elder_maul')
      const wand = olm.drops.find((d: any) => d.itemId === 'kodai_wand')
      expect(tbow.chance).toBeCloseTo(0.029, 2)
      expect(maul.chance).toBeCloseTo(0.029, 2)
      expect(wand.chance).toBeCloseTo(0.029, 2)
    })
  })
})

describe('Dragon Hunter Crossbow', () => {
  const dhcb = itemsData['dragon_hunter_crossbow' as keyof typeof itemsData]

  it('should exist in items data', () => {
    expect(dhcb).toBeDefined()
  })

  it('should have dragonHunter passive flag', () => {
    expect((dhcb as any).dragonHunter).toBe(true)
  })

  it('should require level 70 ranged', () => {
    expect((dhcb as any).requirements.ranged).toBe(70)
  })

  it('should have +95 ranged attack bonus', () => {
    expect((dhcb as any).attackBonus.ranged).toBe(95)
  })
})

describe('Twisted Bow', () => {
  const tbow = itemsData['twisted_bow' as keyof typeof itemsData]

  it('should exist in items data', () => {
    expect(tbow).toBeDefined()
  })

  it('should have scalesWithMagic passive flag', () => {
    expect((tbow as any).scalesWithMagic).toBe(true)
  })

  it('should require level 75 ranged', () => {
    expect((tbow as any).requirements.ranged).toBe(75)
  })

  it('should be two-handed', () => {
    expect((tbow as any).twoHanded).toBe(true)
  })
})

describe('Dragon Hunter passive on dragon monsters', () => {
  it('green dragon should be flagged as a dragon', () => {
    expect((monstersData['green_dragon'] as any).isDragon).toBe(true)
  })

  it('king black dragon should be flagged as a dragon', () => {
    expect((monstersData['king_black_dragon'] as any).isDragon).toBe(true)
  })

  it('olm should NOT be flagged as a dragon', () => {
    expect((monstersData['olm'] as any).isDragon).toBeUndefined()
  })
})

describe('New Items', () => {
  it('ancestral hat should give +2% magic damage bonus', () => {
    const hat = itemsData['ancestral_hat' as keyof typeof itemsData]
    expect((hat as any).otherBonus.magicDamage).toBe(2)
  })

  it('ancestral robe top should give +2% magic damage bonus', () => {
    const top = itemsData['ancestral_robe_top' as keyof typeof itemsData]
    expect((top as any).otherBonus.magicDamage).toBe(2)
  })

  it('ancestral robe bottom should give +2% magic damage bonus', () => {
    const bot = itemsData['ancestral_robe_bottom' as keyof typeof itemsData]
    expect((bot as any).otherBonus.magicDamage).toBe(2)
  })

  it('kodai wand should give +15% magic damage bonus and provide water runes', () => {
    const wand = itemsData['kodai_wand' as keyof typeof itemsData]
    expect((wand as any).otherBonus.magicDamage).toBe(15)
    expect((wand as any).elemental).toBe('water_rune')
  })

  it('elder maul should have crush +135 and strength +147', () => {
    const maul = itemsData['elder_maul' as keyof typeof itemsData]
    expect((maul as any).attackBonus.crush).toBe(135)
    expect((maul as any).otherBonus.meleeStrength).toBe(147)
  })

  it('dragon claws should have slice_and_dice special attack at 50% cost', () => {
    const claws = itemsData['dragon_claws' as keyof typeof itemsData]
    expect((claws as any).specialAttack.type).toBe('slice_and_dice')
    expect((claws as any).specialAttack.energyCost).toBe(50)
  })

  it("dinh's bulwark should have lunge special attack at 50% cost", () => {
    const bulwark = itemsData['dinhs_bulwark' as keyof typeof itemsData]
    expect((bulwark as any).specialAttack.type).toBe('lunge')
    expect((bulwark as any).specialAttack.energyCost).toBe(50)
  })

  it("dinh's bulwark should have very high defence bonuses", () => {
    const bulwark = itemsData['dinhs_bulwark' as keyof typeof itemsData]
    expect((bulwark as any).defenceBonus.stab).toBe(153)
    expect((bulwark as any).defenceBonus.slash).toBe(153)
    expect((bulwark as any).defenceBonus.crush).toBe(143)
    expect((bulwark as any).defenceBonus.ranged).toBe(153)
  })

  it('twisted buckler should occupy the shield slot', () => {
    const buckler = itemsData['twisted_buckler' as keyof typeof itemsData]
    expect((buckler as any).slot).toBe('shield')
    expect((buckler as any).attackBonus.ranged).toBe(18)
  })
})
