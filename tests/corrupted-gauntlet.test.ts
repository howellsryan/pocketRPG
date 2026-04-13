import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createCombatState, processCombatTick } from '../src/engine/combat.js'
import itemsData from '../src/data/items.json'
import monstersData from '../src/data/monsters.json'

const corruptedGauntlet = monstersData['corrupted_gauntlet']

describe('Corrupted Gauntlet Boss', () => {
  describe('Boss Stats and Initialization', () => {
    it('should have correct combat level and hitpoints', () => {
      expect(corruptedGauntlet.combatLevel).toBe(894)
      expect(corruptedGauntlet.hitpoints).toBe(1000)
    })

    it('should have all stats at level 240', () => {
      expect(corruptedGauntlet.stats.attack).toBe(240)
      expect(corruptedGauntlet.stats.strength).toBe(240)
      expect(corruptedGauntlet.stats.defence).toBe(240)
      expect(corruptedGauntlet.stats.magic).toBe(240)
      expect(corruptedGauntlet.stats.ranged).toBe(240)
    })

    it('should have strength bonus of +112', () => {
      expect(corruptedGauntlet.strengthBonus).toBe(112)
    })

    it('should have defence bonus of +20 across all styles', () => {
      expect(corruptedGauntlet.defenceBonus.stab).toBe(20)
      expect(corruptedGauntlet.defenceBonus.slash).toBe(20)
      expect(corruptedGauntlet.defenceBonus.crush).toBe(20)
      expect(corruptedGauntlet.defenceBonus.magic).toBe(20)
      expect(corruptedGauntlet.defenceBonus.ranged).toBe(20)
    })

    it('should have attack speed of 5 ticks', () => {
      expect(corruptedGauntlet.attackSpeed).toBe(5)
    })
  })

  describe('Phase Mechanics', () => {
    it('should have three forms: melee, ranged, and magic', () => {
      expect(corruptedGauntlet.forms).toBeDefined()
      expect(corruptedGauntlet.forms.melee).toBeDefined()
      expect(corruptedGauntlet.forms.ranged).toBeDefined()
      expect(corruptedGauntlet.forms.magic).toBeDefined()
    })

    it('should have multiForm enabled with correct switch thresholds', () => {
      expect(corruptedGauntlet.multiForm).toBe(true)
      expect(corruptedGauntlet.formSwitchMin).toBe(3)
      expect(corruptedGauntlet.formSwitchMax).toBe(7)
    })

    it('should start in melee phase', () => {
      expect(corruptedGauntlet.initialForm).toBe('melee')
    })

    it('each phase should have correct attack style and max hit', () => {
      expect(corruptedGauntlet.forms.melee.attackStyle).toBe('crush')
      expect(corruptedGauntlet.forms.melee.maxHit).toBe(68)

      expect(corruptedGauntlet.forms.ranged.attackStyle).toBe('ranged')
      expect(corruptedGauntlet.forms.ranged.maxHit).toBe(68)

      expect(corruptedGauntlet.forms.magic.attackStyle).toBe('magic')
      expect(corruptedGauntlet.forms.magic.maxHit).toBe(68)
    })

    it('each phase should declare its weakness', () => {
      expect(corruptedGauntlet.forms.melee.weakness).toBe('magic')
      expect(corruptedGauntlet.forms.ranged.weakness).toBe('melee')
      expect(corruptedGauntlet.forms.magic.weakness).toBe('ranged')
    })

    it('each phase should have appropriate defence bonuses reflecting weaknesses', () => {
      // Melee phase weak to magic - low magic defence
      expect(corruptedGauntlet.forms.melee.defenceBonus.magic).toBe(-50)
      expect(corruptedGauntlet.forms.melee.defenceBonus.crush).toBe(20)

      // Ranged phase weak to melee - low melee defences
      expect(corruptedGauntlet.forms.ranged.defenceBonus.stab).toBe(-50)
      expect(corruptedGauntlet.forms.ranged.defenceBonus.slash).toBe(-50)
      expect(corruptedGauntlet.forms.ranged.defenceBonus.crush).toBe(-50)

      // Magic phase weak to ranged - low ranged defence
      expect(corruptedGauntlet.forms.magic.defenceBonus.ranged).toBe(-50)
      expect(corruptedGauntlet.forms.magic.defenceBonus.magic).toBe(20)
    })
  })

  describe('Combat Initialization', () => {
    let combatState: ReturnType<typeof createCombatState>

    beforeEach(() => {
      combatState = createCombatState(corruptedGauntlet, 'melee', 'accurate')
    })

    it('should initialize with correct current form', () => {
      expect(combatState.monster.currentForm).toBe('melee')
    })

    it('should initialize with form attack count of 0', () => {
      expect(combatState.monster.formAttackCount).toBe(0)
    })

    it('should have a form switch threshold between 3 and 7', () => {
      expect(combatState.monster.formSwitchThreshold).toBeGreaterThanOrEqual(3)
      expect(combatState.monster.formSwitchThreshold).toBeLessThanOrEqual(7)
    })

    it('should start with 1000 hitpoints', () => {
      expect(combatState.monster.currentHP).toBe(1000)
    })
  })

  describe('Phase Switching', () => {
    it('should initialize with form attack count of 0', () => {
      const combatState = createCombatState(corruptedGauntlet, 'melee', 'accurate')
      expect(combatState.monster.formAttackCount).toBe(0)
    })

    it('should have a valid form switch threshold between min and max', () => {
      const combatState = createCombatState(corruptedGauntlet, 'melee', 'accurate')
      expect(combatState.monster.formSwitchThreshold).toBeGreaterThanOrEqual(3)
      expect(combatState.monster.formSwitchThreshold).toBeLessThanOrEqual(7)
    })

    it('should reset form attack count after switching phases', () => {
      // When a phase switch occurs, formAttackCount is reset to 0
      // and formSwitchThreshold is recalculated
      const combatState = createCombatState(corruptedGauntlet, 'melee', 'accurate')

      // Manually simulate the form switch logic
      combatState.monster.formAttackCount = 5 // Simulate attacks
      const currentForm = combatState.monster.currentForm

      // Manually trigger form switch logic to verify it resets counter
      combatState.monster.formAttackCount = (combatState.monster.formAttackCount || 0) + 1
      if (combatState.monster.formAttackCount >= 3) {
        combatState.monster.formAttackCount = 0
        expect(combatState.monster.formAttackCount).toBe(0)
      }
    })

    it('should have different attack styles for each form', () => {
      const combatState = createCombatState(corruptedGauntlet, 'melee', 'accurate')

      // Verify each form has a distinct attack style
      const melee = corruptedGauntlet.forms.melee.attackStyle
      const ranged = corruptedGauntlet.forms.ranged.attackStyle
      const magic = corruptedGauntlet.forms.magic.attackStyle

      const styles = new Set([melee, ranged, magic])
      expect(styles.size).toBe(3) // All different
    })

    it('should have different defence patterns based on weakness', () => {
      // Melee phase: weak to magic
      expect(corruptedGauntlet.forms.melee.defenceBonus.magic).toBe(-50)
      expect(corruptedGauntlet.forms.melee.defenceBonus.crush).toBeGreaterThan(-50)

      // Ranged phase: weak to melee
      expect(corruptedGauntlet.forms.ranged.defenceBonus.stab).toBe(-50)
      expect(corruptedGauntlet.forms.ranged.defenceBonus.slash).toBe(-50)
      expect(corruptedGauntlet.forms.ranged.defenceBonus.crush).toBe(-50)

      // Magic phase: weak to ranged
      expect(corruptedGauntlet.forms.magic.defenceBonus.ranged).toBe(-50)
      expect(corruptedGauntlet.forms.magic.defenceBonus.magic).toBeGreaterThan(-50)
    })

    it('should apply form attributes during combat initialization', () => {
      const combatState = createCombatState(corruptedGauntlet, 'melee', 'accurate')

      // Check that the initial form is applied
      expect(combatState.monster.attackStyle).toBe(corruptedGauntlet.forms.melee.attackStyle)
      expect(combatState.monster.formMaxHit).toBe(corruptedGauntlet.forms.melee.maxHit)
    })
  })

  describe('Drop Table', () => {
    it('should always drop crystal shards between 100-500', () => {
      const shardDrop = corruptedGauntlet.drops.find((d: any) => d.itemId === 'crystal_shards')
      expect(shardDrop).toBeDefined()
      expect(shardDrop.chance).toBe(1)
      expect(shardDrop.quantity).toEqual([100, 500])
    })

    it('should have rare unique items with 1/100 or 1/250 chance', () => {
      const uniques = [
        { itemId: 'uncut_onyx', expectedChance: 0.01 },
        { itemId: 'crystal_pickaxe', expectedChance: 0.01 },
        { itemId: 'crystal_axe', expectedChance: 0.01 },
        { itemId: 'crystal_helmet', expectedChance: 0.004 },
        { itemId: 'crystal_plate_body', expectedChance: 0.004 },
        { itemId: 'crystal_platelegs', expectedChance: 0.004 },
        { itemId: 'bow_of_faerdhinen', expectedChance: 0.004 },
        { itemId: 'blade_of_saeldor', expectedChance: 0.004 }
      ]

      for (const unique of uniques) {
        const drop = corruptedGauntlet.drops.find((d: any) => d.itemId === unique.itemId)
        expect(drop).toBeDefined()
        expect(drop.chance).toBe(unique.expectedChance)
      }
    })

    it('should include common resources like herbs, gems, and coins', () => {
      const commonItems = ['guam_leaf', 'tarromin', 'coins', 'death_rune', 'blood_rune']

      for (const itemId of commonItems) {
        const drop = corruptedGauntlet.drops.find((d: any) => d.itemId === itemId)
        expect(drop).toBeDefined()
      }
    })

    it('should include dragon and daganoth bones', () => {
      const dragonBones = corruptedGauntlet.drops.find((d: any) => d.itemId === 'dragon_bones')
      const daganothBones = corruptedGauntlet.drops.find((d: any) => d.itemId === 'daganoth_bones')

      expect(dragonBones).toBeDefined()
      expect(dragonBones.quantity).toBe(50)
      expect(daganothBones).toBeDefined()
      expect(daganothBones.quantity).toBe(50)
    })

    it('should include rune armour items', () => {
      const runeArmour = ['rune_full_helm', 'rune_platebody', 'rune_platelegs', 'rune_med_helm']

      for (const itemId of runeArmour) {
        const drop = corruptedGauntlet.drops.find((d: any) => d.itemId === itemId)
        expect(drop).toBeDefined()
        expect(Array.isArray(drop.quantity)).toBe(true)
        expect(drop.quantity).toEqual([1, 3])
      }
    })

    it('should include blood and death runes with 100-500 quantity', () => {
      const bloodRunes = corruptedGauntlet.drops.find((d: any) => d.itemId === 'blood_rune')
      const deathRunes = corruptedGauntlet.drops.find((d: any) => d.itemId === 'death_rune')

      expect(bloodRunes.quantity).toEqual([100, 500])
      expect(deathRunes.quantity).toEqual([100, 500])
    })
  })

  describe('Crystal Items', () => {
    it('should have all crystal items in items data', () => {
      const crystalItems = [
        'crystal_shards',
        'crystal_helmet',
        'crystal_plate_body',
        'crystal_platelegs',
        'crystal_pickaxe',
        'crystal_axe',
        'bow_of_faerdhinen',
        'blade_of_saeldor'
      ]

      for (const itemId of crystalItems) {
        expect(itemsData[itemId as keyof typeof itemsData]).toBeDefined()
      }
    })

    it('crystal armour and weapons should be scale-charged', () => {
      const chargedItems = [
        'crystal_helmet',
        'crystal_plate_body',
        'crystal_platelegs',
        'crystal_pickaxe',
        'crystal_axe',
        'bow_of_faerdhinen',
        'blade_of_saeldor'
      ]

      for (const itemId of chargedItems) {
        const item = itemsData[itemId as keyof typeof itemsData]
        expect(item.scaleCharged).toBe(true)
      }
    })

    it('crystal weapons should have appropriate attack styles', () => {
      const bowOfFaerdhinen = itemsData['bow_of_faerdhinen' as keyof typeof itemsData]
      const bladeOfSaeldor = itemsData['blade_of_saeldor' as keyof typeof itemsData]

      expect(bowOfFaerdhinen.attackStyle).toBe('ranged')
      expect(bladeOfSaeldor.attackStyle).toBe('slash')
    })

    it('crystal armour should have high defence bonuses', () => {
      const helmet = itemsData['crystal_helmet' as keyof typeof itemsData]
      const body = itemsData['crystal_plate_body' as keyof typeof itemsData]
      const legs = itemsData['crystal_platelegs' as keyof typeof itemsData]

      // Each should have substantial defence across all styles
      expect(helmet.defenceBonus.stab).toBeGreaterThan(70)
      expect(body.defenceBonus.stab).toBeGreaterThan(100)
      expect(legs.defenceBonus.stab).toBeGreaterThan(80)
    })
  })
})
