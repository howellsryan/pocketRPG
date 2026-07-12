import { describe, it, expect } from 'vitest'
import itemsData from '../src/data/items.json' assert { type: 'json' }
import monstersData from '../src/data/monsters.json' assert { type: 'json' }
import minigamesData from '../src/data/minigames.json' assert { type: 'json' }
import collectionLog from '../src/data/collectionLog.json' assert { type: 'json' }
import { applySpecialAttack } from '../src/engine/combat.js'

const items: any = itemsData
const monsters: any = monstersData

const clSection = (catId: string, secId: string) => {
  const cat = (collectionLog as any).categories.find((c: any) => c.id === catId)
  return cat?.sections.find((s: any) => s.id === secId) || null
}

describe('The Duskmare boss + orb-forged staffs', () => {
  const uniques = ['duskmare_staff', 'umbral_orb', 'attuned_orb', 'volatile_orb']

  it('boss exists and drops every unique', () => {
    const boss = monsters.duskmare
    expect(boss?.boss).toBe(true)
    const dropIds = new Set(boss.drops.map((d: any) => d.itemId))
    for (const id of uniques) expect(dropIds.has(id)).toBe(true)
  })

  it('every dropped item id resolves in items.json', () => {
    for (const d of monsters.duskmare.drops) expect(items[d.itemId], d.itemId).toBeTruthy()
  })

  it('logs the uniques under monsters:duskmare', () => {
    const sec = clSection('monsters', 'duskmare')
    expect(sec).toBeTruthy()
    for (const id of uniques) expect(sec.items).toContain(id)
  })

  it('each orb combines with the base staff into its forged staff', () => {
    const map = {
      umbral_orb: 'umbral_duskmare_staff',
      attuned_orb: 'attuned_duskmare_staff',
      volatile_orb: 'volatile_duskmare_staff',
    } as const
    for (const [orb, result] of Object.entries(map)) {
      expect(items[orb].combineWith).toBe('duskmare_staff')
      expect(items[orb].combineResult).toBe(result)
      expect(items[result]).toBeTruthy()
    }
  })

  it('forged staffs carry the right effects', () => {
    // Attuned = faster standard spells (lower attackSpeed), no special.
    expect(items.attuned_duskmare_staff.attackSpeed).toBe(4)
    expect(items.attuned_duskmare_staff.specialAttack).toBeUndefined()
    expect(items.umbral_duskmare_staff.specialAttack.type).toBe('soul_drain')
    expect(items.volatile_duskmare_staff.specialAttack.type).toBe('volatile_surge')
  })
})

describe('magic special attacks', () => {
  const makeState = () => ({
    monster: { name: 'Dummy', currentHP: 5000, hitpoints: 5000, stats: { magic: 1, defence: 1 }, defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 }, attackSpeed: 4 },
    stance: 'accurate',
    combatType: 'magic',
    prayerPoints: 0,
    maxPrayerPoints: 99,
    xpGained: {},
    specialAttackEnergy: 100,
  })
  const playerStats: any = { attack: 1, strength: 1, defence: 1, magic: 99, ranged: 1, hitpoints: 99 }

  it('Soul Drain deals damage and restores Prayer points', () => {
    const eq: any = { weapon: { itemId: 'umbral_duskmare_staff' } }
    let totalPrayer = 0
    let totalDamage = 0
    for (let i = 0; i < 80; i++) {
      const st: any = makeState()
      const { combatState, events } = applySpecialAttack(st, playerStats, eq, items, null)
      const hit = events.find((e: any) => e.type === 'specialHit')
      expect(hit.specType).toBe('soul_drain')
      totalDamage += hit.totalDamage
      totalPrayer += combatState.prayerPoints
    }
    expect(totalDamage).toBeGreaterThan(0)
    expect(totalPrayer).toBeGreaterThan(0)
  })

  it('Volatile Surge scales harder at higher Magic level', () => {
    const eq: any = { weapon: { itemId: 'volatile_duskmare_staff' } }
    const maxHitFor = (magic: number) => {
      let best = 0
      for (let i = 0; i < 200; i++) {
        const st: any = makeState()
        const { events } = applySpecialAttack(st, { ...playerStats, magic }, eq, items, null)
        const hit = events.find((e: any) => e.type === 'specialHit')
        expect(hit.specType).toBe('volatile_surge')
        best = Math.max(best, hit.hits[0])
      }
      return best
    }
    expect(maxHitFor(99)).toBeGreaterThan(maxHitFor(50))
  })
})

describe('Arcane Proving Grounds minigame', () => {
  const rewards = ['boundless_hat', 'boundless_robe_top', 'boundless_robe_bottom', 'boundless_boots', 'boundless_gloves', 'arcane_grimoire', 'archmage_wand']
  const tasks = minigamesData.tasks.filter((t: any) => t.minigame === 'arcane_proving_grounds')

  it('registers the minigame gated behind Magic 50', () => {
    const mg = minigamesData.minigames.find((m: any) => m.id === 'arcane_proving_grounds') as any
    expect(mg).toBeTruthy()
    expect(mg.req).toEqual({ skill: 'magic', level: 50 })
  })

  it('offers one grind task per reward and every product resolves', () => {
    expect(tasks.map((t: any) => t.product).sort()).toEqual([...rewards].sort())
    for (const t of tasks) {
      expect(items[t.product], t.product).toBeTruthy()
      expect(t.ticks).toBe((t as any).hours * 6000)
    }
  })

  it('logs every reward under minigames:arcane_proving_grounds', () => {
    const sec = clSection('minigames', 'arcane_proving_grounds')
    expect(sec).toBeTruthy()
    for (const id of rewards) expect(sec.items).toContain(id)
  })
})
