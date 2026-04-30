import { describe, expect, it } from 'vitest'
import { simulateIdleCombat } from '../src/engine/idleEngine.js'

describe('simulateIdleCombat', () => {
  it('awards magic XP (not melee XP) for powered staffs without a selected spell', () => {
    const task: any = {
      stance: 'accurate',
      monster: {
        id: 'test_monster',
        name: 'Test Monster',
        hitpoints: 20,
        stats: { defence: 1, magic: 1 },
        defenceBonus: { magic: 0 },
        drops: []
      }
    }

    const stats: any = {
      attack: { xp: 0 },
      strength: { xp: 0 },
      defence: { xp: 0 },
      ranged: { xp: 0 },
      magic: { xp: 13034431 } // 99 magic
    }

    const equipment: any = {
      weapon: { itemId: 'trident_of_the_swamp', charges: 100 }
    }

    const itemsData: any = {
      trident_of_the_swamp: {
        id: 'trident_of_the_swamp',
        slot: 'weapon',
        attackStyle: 'magic',
        poweredStaff: true,
        scaleCharged: true,
        attackSpeed: 3,
        attackBonus: { magic: 25 },
        defenceBonus: { magic: 0 },
        otherBonus: { magicDamage: 0 }
      }
    }

    const sim = simulateIdleCombat(task, 60_000, stats, equipment, Array(28).fill(null), itemsData)
    expect(sim).toBeTruthy()
    expect(sim!.monstersKilled).toBeGreaterThan(0)
    expect(sim!.xpGained.magic).toBeGreaterThan(0)
    expect(sim!.xpGained.hitpoints).toBeGreaterThan(0)
    expect(sim!.xpGained.attack).toBeUndefined()
    expect(sim!.xpGained.strength).toBeUndefined()
  })

  it('returns completed slayerTaskUpdate with capped task kills and points on idle overkill', () => {
    const task: any = {
      stance: 'accurate',
      monster: { id: 'goblin', name: 'Goblin', hitpoints: 1, stats: { defence: 1 }, defenceBonus: {}, drops: [] }
    }
    const stats: any = { attack: { xp: 13_034_431 }, strength: { xp: 13_034_431 }, defence: { xp: 0 } }
    const sim = simulateIdleCombat(task, 60_000, stats, {}, Array(28).fill(null), {}, {
      monsterId: 'goblin',
      monstersRemaining: 2,
      pointsOnComplete: 4
    })

    expect(sim).toBeTruthy()
    expect(sim!.monstersKilled).toBeGreaterThan(2)
    expect(sim!.monstersKilledOnTask).toBe(2)
    expect(sim!.slayerTaskUpdate?.completed).toBe(true)
    expect(sim!.slayerTaskUpdate?.pointsOnComplete).toBe(4)
  })
})
