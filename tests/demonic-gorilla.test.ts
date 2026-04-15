import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createCombatState, processCombatTick } from '../src/engine/combat.js'
import itemsData from '../src/data/items.json'
import monstersData from '../src/data/monsters.json'

const gorilla = monstersData['demonic_gorilla']

const basePlayerStats = {
  attack: 99, strength: 99, defence: 99,
  ranged: 99, magic: 99, hitpoints: 99, currentHP: 99
}
const emptyEquipment = {
  weapon: null, shield: null, head: null, body: null,
  legs: null, feet: null, hands: null, cape: null,
  neck: null, ring: null, ammo: null
}

describe('Demonic Gorilla', () => {
  describe('Stats', () => {
    it('should exist in monsters data', () => {
      expect(gorilla).toBeDefined()
    })

    it('should have combat level 275', () => {
      expect(gorilla.combatLevel).toBe(275)
    })

    it('should have 205 hitpoints', () => {
      expect(gorilla.hitpoints).toBe(205)
    })

    it('should have correct combat stats', () => {
      expect(gorilla.stats.attack).toBe(195)
      expect(gorilla.stats.strength).toBe(200)
      expect(gorilla.stats.defence).toBe(195)
      expect(gorilla.stats.magic).toBe(275)
      expect(gorilla.stats.ranged).toBe(380)
    })

    it('should be flagged as a boss', () => {
      expect(gorilla.boss).toBe(true)
    })
  })

  describe('Phase Mechanic', () => {
    it('should have three forms: melee, ranged, magic', () => {
      expect(gorilla.forms).toBeDefined()
      expect(gorilla.forms.melee).toBeDefined()
      expect(gorilla.forms.ranged).toBeDefined()
      expect(gorilla.forms.magic).toBeDefined()
    })

    it('should start in melee phase', () => {
      expect(gorilla.initialForm).toBe('melee')
    })

    it('should cycle in order: melee → ranged → magic', () => {
      expect(gorilla.formCycleOrder).toEqual(['melee', 'ranged', 'magic'])
    })

    it('each phase should have max hit of 30', () => {
      expect(gorilla.forms.melee.maxHit).toBe(30)
      expect(gorilla.forms.ranged.maxHit).toBe(30)
      expect(gorilla.forms.magic.maxHit).toBe(30)
    })

    it('each phase attacks with and is immune to its own style', () => {
      expect(gorilla.forms.melee.attackStyle).toBe('crush')
      expect(gorilla.forms.melee.immunity).toBe('melee')

      expect(gorilla.forms.ranged.attackStyle).toBe('ranged')
      expect(gorilla.forms.ranged.immunity).toBe('ranged')

      expect(gorilla.forms.magic.attackStyle).toBe('magic')
      expect(gorilla.forms.magic.immunity).toBe('magic')
    })

    it('immune phase should have extremely high defenceBonus for its own style', () => {
      expect(gorilla.forms.melee.defenceBonus.stab).toBeGreaterThan(1000)
      expect(gorilla.forms.ranged.defenceBonus.ranged).toBeGreaterThan(1000)
      expect(gorilla.forms.magic.defenceBonus.magic).toBeGreaterThan(1000)
    })
  })

  describe('Combat Initialization', () => {
    it('should initialize in melee phase', () => {
      const state = createCombatState(gorilla, 'ranged', 'accurate')
      expect(state.monster.currentForm).toBe('melee')
    })

    it('should initialize with 205 hitpoints', () => {
      const state = createCombatState(gorilla, 'ranged', 'accurate')
      expect(state.monster.currentHP).toBe(205)
    })
  })

  describe('Immunity Mechanic', () => {
    beforeEach(() => {
      // Mock Math.random to always return 0.5 — guarantees hits
      vi.spyOn(Math, 'random').mockReturnValue(0.5)
    })
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('should deal 0 damage when player uses the immune combat type', () => {
      // Gorilla starts in melee phase — melee is immune
      const state = createCombatState(gorilla, 'melee', 'accurate')
      state.playerAttackTimer = 0
      state.monsterAttackTimer = 999  // suppress monster attack

      const result = processCombatTick(state, basePlayerStats, emptyEquipment, itemsData)
      const immuneEvent = result.events.find(e => e.type === 'immuneHit')
      expect(immuneEvent).toBeDefined()
      expect(immuneEvent?.immunity).toBe('melee')
      // Monster should still have full HP
      expect(result.combatState.monster.currentHP).toBe(205)
    })

    it('should deal damage when player uses a non-immune combat type', () => {
      // Gorilla starts in melee phase — ranged is not immune
      const state = createCombatState(gorilla, 'ranged', 'accurate')
      state.playerAttackTimer = 0
      state.monsterAttackTimer = 999

      // Equip a ranged weapon so ranged attack can fire
      const equipment = {
        ...emptyEquipment,
        weapon: { itemId: 'armadyl_crossbow' },
        ammo: { itemId: 'runite_bolts', quantity: 100 }
      }
      const result = processCombatTick(state, basePlayerStats, equipment, itemsData)
      const playerHit = result.events.find(e => e.type === 'playerHit')
      expect(playerHit).toBeDefined()
      // No immuneHit event
      expect(result.events.find(e => e.type === 'immuneHit')).toBeUndefined()
    })

    it('should emit immuneHit with correct immunity type', () => {
      // Force gorilla into ranged phase and attack with ranged
      const state = createCombatState(gorilla, 'ranged', 'accurate')
      // Manually switch to ranged form
      state.monster.currentForm = 'ranged'
      const rangedForm = gorilla.forms.ranged
      state.monster.attackStyle = rangedForm.attackStyle
      state.monster.defenceBonus = { ...rangedForm.defenceBonus }
      state.monster.formMaxHit = rangedForm.maxHit

      state.playerAttackTimer = 0
      state.monsterAttackTimer = 999

      const result = processCombatTick(state, basePlayerStats, emptyEquipment, itemsData)
      const immuneEvent = result.events.find(e => e.type === 'immuneHit')
      expect(immuneEvent).toBeDefined()
      expect(immuneEvent?.immunity).toBe('ranged')
    })

    it('should not grant XP when attack is immune', () => {
      const state = createCombatState(gorilla, 'melee', 'accurate')
      state.playerAttackTimer = 0
      state.monsterAttackTimer = 999

      const result = processCombatTick(state, basePlayerStats, emptyEquipment, itemsData)
      const xpEvent = result.events.find(e => e.type === 'xp')
      // Either no xp event, or xp values are all 0
      if (xpEvent) {
        const totalXP = Object.values(xpEvent.xpSkills as Record<string, number>).reduce((a, b) => a + b, 0)
        expect(totalXP).toBe(0)
      }
    })
  })

  describe('Phase Cycling', () => {
    it('should cycle melee → ranged → magic in order after form switches', () => {
      const state = createCombatState(gorilla, 'ranged', 'accurate')
      expect(state.monster.currentForm).toBe('melee')

      const playerStats = basePlayerStats
      // Suppress player attacks, trigger monster attacks to cycle forms
      state.playerAttackTimer = 999

      // Force immediate form switch by setting count to threshold
      state.monster.formAttackCount = state.monster.formSwitchThreshold - 1
      state.monsterAttackTimer = 0

      const r1 = processCombatTick(state, playerStats, emptyEquipment, itemsData)
      expect(r1.combatState.monster.currentForm).toBe('ranged')

      const s2 = r1.combatState
      s2.playerAttackTimer = 999
      s2.monster.formAttackCount = s2.monster.formSwitchThreshold - 1
      s2.monsterAttackTimer = 0

      const r2 = processCombatTick(s2, playerStats, emptyEquipment, itemsData)
      expect(r2.combatState.monster.currentForm).toBe('magic')

      const s3 = r2.combatState
      s3.playerAttackTimer = 999
      s3.monster.formAttackCount = s3.monster.formSwitchThreshold - 1
      s3.monsterAttackTimer = 0

      const r3 = processCombatTick(s3, playerStats, emptyEquipment, itemsData)
      expect(r3.combatState.monster.currentForm).toBe('melee')
    })
  })

  describe('Drop Table', () => {
    it('should always drop coins', () => {
      const coinDrop = gorilla.drops.find((d: any) => d.itemId === 'coins')
      expect(coinDrop).toBeDefined()
      expect(coinDrop.chance).toBe(1.0)
    })

    it('should have zenyte_shard as a rare drop (~1/300)', () => {
      const zenyteDrop = gorilla.drops.find((d: any) => d.itemId === 'zenyte_shard')
      expect(zenyteDrop).toBeDefined()
      expect(zenyteDrop.chance).toBeLessThan(0.01)
    })

    it('should have heavy_ballista as a rare drop', () => {
      const ballistaDrop = gorilla.drops.find((d: any) => d.itemId === 'heavy_ballista')
      expect(ballistaDrop).toBeDefined()
      expect(ballistaDrop.chance).toBeLessThan(0.01)
    })
  })

  describe('New Items', () => {
    it('zenyte_shard should exist in items data', () => {
      expect((itemsData as any)['zenyte_shard']).toBeDefined()
      expect((itemsData as any)['zenyte_shard'].name).toBe('Zenyte shard')
    })

    it('heavy_ballista should exist in items data', () => {
      expect((itemsData as any)['heavy_ballista']).toBeDefined()
      expect((itemsData as any)['heavy_ballista'].name).toBe('Heavy ballista')
    })

    it('heavy_ballista should require level 75 ranged', () => {
      expect((itemsData as any)['heavy_ballista'].requirements?.ranged).toBe(75)
    })

    it('heavy_ballista should have +110 ranged attack and +125 ranged strength', () => {
      const ballista = (itemsData as any)['heavy_ballista']
      expect(ballista.attackBonus.ranged).toBe(110)
      expect(ballista.otherBonus.rangedStrength).toBe(125)
    })
  })
})
