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
  it('uses the rapier lunge/stab animation for every shipped spear-class weapon', () => {
    const spears = Object.entries(items).filter(([, item]) => item?.slot === 'weapon' && item.weaponClass === 'spear')
    expect(spears.length).toBeGreaterThan(0)

    for (const [id, item] of spears) {
      const type = weaponIconTypeFor({ ...item, id })
      expect(type, id).toBe('rapier')
      expect(isLungeWeaponType(type), id).toBe(true)
      expect(isSmashWeaponType(type), id).toBe(false)

      const sprite = playerCombatSprite({ weapon: { itemId: id } }, items)
      expect(sprite.weaponIconType, id).toBe('rapier')
      expect(isLungeWeaponType(sprite.weaponIconType), id).toBe(true)
    }
  })
})
