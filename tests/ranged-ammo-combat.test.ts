import { describe, it, expect, vi, afterEach } from 'vitest'
import { createCombatState, processCombatTick } from '../src/engine/combat.js'
import itemsData from '../src/data/items.json'
import { getEquipmentBonuses } from '../src/engine/equipment.js'

afterEach(() => vi.restoreAllMocks())
const player: any = { ranged: 99, hitpoints: 99, attack: 99, strength: 99, defence: 99, magic: 99, currentHP: 99 }
const monster: any = { id: 'm', name: 'Dummy', stats: { defence: 1, magic: 1 }, defenceBonus: { ranged: 0, magic: 0, stab: 0, slash: 0, crush: 0 }, hitpoints: 100, currentHP: 100 }

describe('ranged ammo gating pve', () => {
  it('blocks heavy ballista without ammo', () => {
    const state = createCombatState(monster, 'ranged', 'accurate')
    const out = processCombatTick(state, player, { weapon: { itemId: 'heavy_ballista' } }, itemsData)
    expect(out.events.some((e:any)=>e.type==='noAmmo')).toBe(true)
    expect(out.events.some((e:any)=>e.type==='playerHit')).toBe(false)
  })
  it('chaotic crossbow requires bolts', () => {
    const state = createCombatState(monster, 'ranged', 'accurate')
    const out = processCombatTick(state, player, { weapon: { itemId: 'chaotic_crossbow' } }, itemsData)
    expect(out.events.some((e:any)=>e.type==='noAmmo')).toBe(true)
  })
  it('consumes ammo when valid', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const state = createCombatState(monster, 'ranged', 'accurate')
    const out = processCombatTick(state, player, { weapon: { itemId: 'heavy_ballista' }, ammo: { itemId: 'dragon_javelin', quantity: 3 } }, itemsData)
    expect(out.events.some((e:any)=>e.type==='consumeAmmo')).toBe(true)
    const withAmmo = getEquipmentBonuses({ weapon: { itemId: 'heavy_ballista' }, ammo: { itemId: 'dragon_javelin' } }, itemsData)
    const withoutAmmo = getEquipmentBonuses({ weapon: { itemId: 'heavy_ballista' } }, itemsData)
    expect(withAmmo.otherBonus.rangedStrength).toBeGreaterThan(withoutAmmo.otherBonus.rangedStrength)
  })
})
