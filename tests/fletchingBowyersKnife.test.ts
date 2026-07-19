import { describe, it, expect } from 'vitest'
import minigames from '../src/data/minigames.json'
import items from '../src/data/items.json'
import collectionLog from '../src/data/collectionLog.json'
import worldActivities from '../src/data/worldActivities.json'
import skills from '../src/data/skills.json'
import {
  getEffectiveToolActionTicks,
  isBowFletchingAction,
  hasBowyersKnife,
  BOWYERS_KNIFE_ID,
} from '../src/engine/skilling.js'
import { isEquippable, typeFilterOf, hasPositiveCombatBonus } from '../src/utils/armoury.js'

const itemsData = items as Record<string, any>

describe('Fletching Guild minigame + Bowyer\'s Knife reward', () => {
  it('defines the Fletching Guild venue and its 2-hour Bowyer\'s Knife task', () => {
    const mg = minigames.minigames.find((m: any) => m.id === 'fletching_guild')
    expect(mg?.label).toBe('Fletching Guild')

    const task = minigames.tasks.find((t: any) => t.id === 'fg_bowyers_knife')!
    expect(task.hours).toBe(2)
    expect(task.ticks).toBe(12000)
    expect(task.product).toBe('bowyers_knife')
    expect(task.minigame).toBe('fletching_guild')
    expect(task.oneShot).toBe(true)
    expect(minigames.itemNames.bowyers_knife).toBe("Bowyer's Knife")
  })

  it('prices the knife as a 250k/hour untradeable minigame reward (500k for 2h)', () => {
    const item = itemsData[BOWYERS_KNIFE_ID]
    expect(item.type).toBe('tool')
    expect(item.isUntradeable).toBe(true)
    expect(item.shopValue).toBe(500_000)
  })

  it('is a no-stat weapon-slot tool — equippable like the Angler Net, filed under Skilling', () => {
    const item = itemsData[BOWYERS_KNIFE_ID]
    expect(item.slot).toBe('weapon')
    expect(isEquippable(item)).toBe(true)
    expect(typeFilterOf(item)).toBe('skilling')
    expect(hasPositiveCombatBonus(item)).toBe(false)
  })

  it('is offered at Ardounne and logged under a Fletching Guild collection slot', () => {
    const ardounne = (worldActivities as Record<string, any[]>).ardounne
    expect(ardounne.some((a) => a.kind === 'minigame' && a.ref === 'fletching_guild')).toBe(true)

    const minigameCat = (collectionLog as any).categories.find((c: any) => c.id === 'minigames')
    const section = minigameCat.sections.find((s: any) => s.id === 'fletching_guild')
    expect(section?.items).toContain('bowyers_knife')
  })
})

describe('isBowFletchingAction', () => {
  const byId = new Map(skills.fletching.actions.map((a: any) => [a.id, a]))

  it('is true for every bow cut/string action and false for arrows and bolts', () => {
    expect(isBowFletchingAction('fletching', byId.get('shortbow_u_cut'))).toBe(true)
    expect(isBowFletchingAction('fletching', byId.get('shortbow_string'))).toBe(true)
    expect(isBowFletchingAction('fletching', byId.get('magic_shortbow_string'))).toBe(true)
    expect(isBowFletchingAction('fletching', byId.get('bronze_arrows'))).toBe(false)
    expect(isBowFletchingAction('fletching', byId.get('make_bronze_bolts'))).toBe(false)
    expect(isBowFletchingAction('fletching', byId.get('cut_wooden_stocks'))).toBe(false)
  })

  it('is false for a bow-shaped product outside the fletching skill', () => {
    expect(isBowFletchingAction('crafting', { product: 'magic_shortbow' })).toBe(false)
    expect(isBowFletchingAction('fletching', { product: 'feather' })).toBe(false)
    expect(isBowFletchingAction('fletching', null)).toBe(false)
  })
})

describe('hasBowyersKnife', () => {
  it('detects the knife in the inventory or the weapon slot, nowhere else', () => {
    expect(hasBowyersKnife({}, [{ itemId: BOWYERS_KNIFE_ID, quantity: 1 }])).toBe(true)
    expect(hasBowyersKnife({ weapon: { itemId: BOWYERS_KNIFE_ID } }, [])).toBe(true)
    expect(hasBowyersKnife({}, [{ itemId: 'chisel', quantity: 1 }])).toBe(false)
    expect(hasBowyersKnife({}, [])).toBe(false)
  })
})

describe('getEffectiveToolActionTicks with the Bowyer\'s Knife', () => {
  const bowAction = { id: 'yew_shortbow_string', product: 'yew_shortbow', ticks: 5 }
  const arrowAction = { id: 'bronze_arrows', product: 'bronze_arrow', ticks: 3 }
  const knifeInv = [{ itemId: BOWYERS_KNIFE_ID, quantity: 1 }]

  it('shaves exactly one tick off bow-fletching only when the knife is carried', () => {
    expect(getEffectiveToolActionTicks('fletching', 5, {}, itemsData, {}, [], bowAction)).toBe(5)
    expect(getEffectiveToolActionTicks('fletching', 5, {}, itemsData, {}, knifeInv, bowAction)).toBe(4)
    expect(getEffectiveToolActionTicks('fletching', 3, {}, itemsData, {}, knifeInv, { product: 'shortbow', ticks: 3 })).toBe(2)
    expect(getEffectiveToolActionTicks('fletching', 6, {}, itemsData, {}, knifeInv, { product: 'magic_shortbow', ticks: 6 })).toBe(5)
  })

  it('is a flat one-tick cut, not a 10% multiplier, at high base ticks', () => {
    // 20 → 19 (one tick), not 18 (10%).
    expect(getEffectiveToolActionTicks('fletching', 20, {}, itemsData, {}, knifeInv, { product: 'shortbow', ticks: 20 })).toBe(19)
  })

  it('does not speed up arrows/bolts even while the knife is carried', () => {
    expect(getEffectiveToolActionTicks('fletching', 3, {}, itemsData, {}, knifeInv, arrowAction)).toBe(3)
  })

  it('never drops below one tick', () => {
    expect(getEffectiveToolActionTicks('fletching', 1, {}, itemsData, {}, knifeInv, { product: 'shortbow', ticks: 1 })).toBe(1)
  })
})
