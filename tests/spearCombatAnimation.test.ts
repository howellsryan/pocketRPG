import { describe, expect, it } from 'vitest'
import itemsData from '../src/data/items.json'
import {
  isLungeWeaponType,
  isSmashWeaponType,
  playerCombatSprite,
  weaponIconTypeFor,
} from '../src/utils/actionSprites.js'

const items = itemsData as Record<string, any>

describe('spear combat animation', () => {
  it('uses the lunge/stab animation for every shipped spear without reclassifying its visual shape as a rapier', () => {
    const spears = Object.entries(items).filter(([, item]) => item?.slot === 'weapon' && item.weaponClass === 'spear')
    expect(spears.length).toBeGreaterThan(0)
    expect(isLungeWeaponType('spear')).toBe(true)
    expect(isSmashWeaponType('spear')).toBe(false)

    for (const [id, item] of spears) {
      const visualType = weaponIconTypeFor({ ...item, id })
      expect(visualType, id).not.toBe('rapier')

      const sprite = playerCombatSprite({ weapon: { itemId: id } }, items)
      expect(sprite.weaponIconType, id).toBe(visualType)
      expect(sprite.weaponAnimationType, id).toBe('spear')
      expect(isLungeWeaponType(sprite.weaponAnimationType), id).toBe(true)
      expect(isSmashWeaponType(sprite.weaponAnimationType), id).toBe(false)
    }
  })
})
