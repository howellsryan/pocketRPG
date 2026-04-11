import { describe, it, expect, beforeEach } from 'vitest'
import {
  createInventory,
  freeSlots,
  findItem,
  findAllItems,
  countItem,
  addItem,
  removeItem,
  swapSlots
} from '../src/engine/inventory.js'

const INVENTORY_SIZE = 28

describe('Inventory System', () => {
  let inventory: any[]

  beforeEach(() => {
    inventory = createInventory()
  })

  describe('createInventory', () => {
    it('should create an array of 28 null slots', () => {
      const inv = createInventory()
      expect(inv.length).toBe(INVENTORY_SIZE)
      expect(inv.every(slot => slot === null)).toBe(true)
    })

    it('should create a new inventory each time', () => {
      const inv1 = createInventory()
      const inv2 = createInventory()

      expect(inv1).not.toBe(inv2)
    })
  })

  describe('freeSlots', () => {
    it('should return 28 for empty inventory', () => {
      expect(freeSlots(inventory)).toBe(28)
    })

    it('should decrease when items are added', () => {
      addItem(inventory, 'sword', 1)
      expect(freeSlots(inventory)).toBe(27)
    })

    it('should return 0 for full inventory', () => {
      for (let i = 0; i < 28; i++) {
        inventory[i] = { itemId: 'item' + i, quantity: 1 }
      }
      expect(freeSlots(inventory)).toBe(0)
    })

    it('should account for all slots', () => {
      inventory[0] = { itemId: 'item1', quantity: 1 }
      inventory[5] = { itemId: 'item2', quantity: 1 }
      inventory[10] = { itemId: 'item3', quantity: 1 }

      expect(freeSlots(inventory)).toBe(25)
    })
  })

  describe('findItem', () => {
    it('should return -1 for missing item', () => {
      expect(findItem(inventory, 'sword')).toBe(-1)
    })

    it('should find item in first slot', () => {
      inventory[0] = { itemId: 'sword', quantity: 1 }
      expect(findItem(inventory, 'sword')).toBe(0)
    })

    it('should find item and return first occurrence', () => {
      inventory[5] = { itemId: 'shield', quantity: 3 }
      inventory[10] = { itemId: 'shield', quantity: 2 }

      expect(findItem(inventory, 'shield')).toBe(5)
    })

    it('should not find null slots', () => {
      expect(findItem(inventory, null)).toBe(-1)
    })
  })

  describe('findAllItems', () => {
    it('should return empty array for missing item', () => {
      expect(findAllItems(inventory, 'sword')).toEqual([])
    })

    it('should find single item', () => {
      inventory[0] = { itemId: 'sword', quantity: 1 }
      expect(findAllItems(inventory, 'sword')).toEqual([0])
    })

    it('should find multiple instances of same item', () => {
      inventory[5] = { itemId: 'shield', quantity: 3 }
      inventory[10] = { itemId: 'shield', quantity: 2 }
      inventory[20] = { itemId: 'shield', quantity: 1 }

      expect(findAllItems(inventory, 'shield')).toEqual([5, 10, 20])
    })

    it('should return slots in order', () => {
      inventory[2] = { itemId: 'potion', quantity: 1 }
      inventory[7] = { itemId: 'potion', quantity: 1 }
      inventory[15] = { itemId: 'potion', quantity: 1 }

      const slots = findAllItems(inventory, 'potion')
      expect(slots).toEqual([2, 7, 15])
    })
  })

  describe('countItem', () => {
    it('should return 0 for missing item', () => {
      expect(countItem(inventory, 'sword')).toBe(0)
    })

    it('should count single stack', () => {
      addItem(inventory, 'gold', 100, true)
      expect(countItem(inventory, 'gold')).toBe(100)
    })

    it('should count multiple stacks of same item', () => {
      inventory[0] = { itemId: 'coins', quantity: 1000 }
      inventory[5] = { itemId: 'coins', quantity: 2000 }
      inventory[10] = { itemId: 'coins', quantity: 500 }

      expect(countItem(inventory, 'coins')).toBe(3500)
    })

    it('should handle non-stackable items', () => {
      addItem(inventory, 'sword', 3, false) // 3 separate slots
      expect(countItem(inventory, 'sword')).toBe(3)
    })
  })

  describe('addItem - Stackable', () => {
    it('should add stackable item to empty slot', () => {
      const result = addItem(inventory, 'coins', 100, true)
      expect(result).toBe(true)
      expect(inventory[0].itemId).toBe('coins')
      expect(inventory[0].quantity).toBe(100)
    })

    it('should stack on existing item', () => {
      addItem(inventory, 'coins', 100, true)
      addItem(inventory, 'coins', 50, true)

      expect(inventory[0].quantity).toBe(150)
      expect(inventory[1]).toBeNull() // Shouldn't create new slot
    })

    it('should create new slot when no stack exists', () => {
      addItem(inventory, 'coins', 100, true)
      addItem(inventory, 'ore', 50, true)

      expect(inventory[0].itemId).toBe('coins')
      expect(inventory[1].itemId).toBe('ore')
    })

    it('should fail when inventory is full', () => {
      for (let i = 0; i < 28; i++) {
        inventory[i] = { itemId: 'item', quantity: 1 }
      }

      const result = addItem(inventory, 'newitem', 1, true)
      expect(result).toBe(false)
    })

    it('should succeed for multiple stackable adds', () => {
      for (let i = 0; i < 27; i++) {
        const result = addItem(inventory, 'item' + i, 100, true) // Different item each time
        expect(result).toBe(true)
      }
      expect(freeSlots(inventory)).toBe(1)
    })
  })

  describe('addItem - Non-stackable', () => {
    it('should add single non-stackable item', () => {
      const result = addItem(inventory, 'sword', 1, false)
      expect(result).toBe(true)
      expect(inventory[0].itemId).toBe('sword')
      expect(inventory[0].quantity).toBe(1)
    })

    it('should add multiple non-stackable items to separate slots', () => {
      const result = addItem(inventory, 'shield', 3, false)
      expect(result).toBe(true)
      expect(inventory[0].itemId).toBe('shield')
      expect(inventory[1].itemId).toBe('shield')
      expect(inventory[2].itemId).toBe('shield')
      expect(inventory[3]).toBeNull()
    })

    it('should fail if not enough free slots', () => {
      for (let i = 0; i < 26; i++) {
        inventory[i] = { itemId: 'other', quantity: 1 }
      }

      // Try to add 3 items with only 2 slots free
      const result = addItem(inventory, 'sword', 3, false)
      expect(result).toBe(false)
    })

    it('should succeed with exact slots available', () => {
      for (let i = 0; i < 25; i++) {
        inventory[i] = { itemId: 'other', quantity: 1 }
      }

      // Exactly 3 slots free, adding 3 items
      const result = addItem(inventory, 'sword', 3, false)
      expect(result).toBe(true)
      expect(freeSlots(inventory)).toBe(0)
    })
  })

  describe('removeItem', () => {
    it('should fail if item not in inventory', () => {
      const result = removeItem(inventory, 'sword', 1)
      expect(result).toBe(false)
    })

    it('should fail if removing more than available', () => {
      addItem(inventory, 'coins', 100, true)
      const result = removeItem(inventory, 'coins', 150)
      expect(result).toBe(false)
    })

    it('should remove partial stack', () => {
      addItem(inventory, 'coins', 100, true)
      const result = removeItem(inventory, 'coins', 30)
      expect(result).toBe(true)
      expect(countItem(inventory, 'coins')).toBe(70)
    })

    it('should remove entire stack', () => {
      addItem(inventory, 'coins', 100, true)
      removeItem(inventory, 'coins', 100)
      expect(inventory[0]).toBeNull()
    })

    it('should remove from multiple slots', () => {
      inventory[0] = { itemId: 'ore', quantity: 50 }
      inventory[1] = { itemId: 'ore', quantity: 30 }
      inventory[2] = { itemId: 'ore', quantity: 20 }

      removeItem(inventory, 'ore', 60) // 50 + 10 from next slot

      expect(inventory[0]).toBeNull()
      expect(inventory[1].quantity).toBe(20)
      expect(inventory[2].quantity).toBe(20)
    })

    it('should default to removing 1', () => {
      addItem(inventory, 'sword', 5, false)
      removeItem(inventory, 'sword') // No quantity specified

      expect(countItem(inventory, 'sword')).toBe(4)
    })

    it('should handle removing across many slots', () => {
      for (let i = 0; i < 10; i++) {
        inventory[i] = { itemId: 'item', quantity: 10 }
      }

      const result = removeItem(inventory, 'item', 75)
      expect(result).toBe(true)
      expect(countItem(inventory, 'item')).toBe(25)
    })
  })

  describe('swapSlots', () => {
    it('should swap two items', () => {
      inventory[0] = { itemId: 'sword', quantity: 1 }
      inventory[5] = { itemId: 'shield', quantity: 1 }

      swapSlots(inventory, 0, 5)

      expect(inventory[0].itemId).toBe('shield')
      expect(inventory[5].itemId).toBe('sword')
    })

    it('should swap with null slots', () => {
      inventory[0] = { itemId: 'sword', quantity: 1 }
      inventory[5] = null

      swapSlots(inventory, 0, 5)

      expect(inventory[0]).toBeNull()
      expect(inventory[5].itemId).toBe('sword')
    })

    it('should swap two null slots (no-op)', () => {
      swapSlots(inventory, 0, 5)

      expect(inventory[0]).toBeNull()
      expect(inventory[5]).toBeNull()
    })

    it('should work with adjacent slots', () => {
      inventory[0] = { itemId: 'a', quantity: 1 }
      inventory[1] = { itemId: 'b', quantity: 1 }

      swapSlots(inventory, 0, 1)

      expect(inventory[0].itemId).toBe('b')
      expect(inventory[1].itemId).toBe('a')
    })

    it('should work with slots at boundaries', () => {
      inventory[0] = { itemId: 'first', quantity: 1 }
      inventory[27] = { itemId: 'last', quantity: 1 }

      swapSlots(inventory, 0, 27)

      expect(inventory[0].itemId).toBe('last')
      expect(inventory[27].itemId).toBe('first')
    })
  })

  describe('Integration - Common Workflows', () => {
    it('should handle drop and pickup', () => {
      addItem(inventory, 'sword', 1, false)
      addItem(inventory, 'shield', 1, false)

      // "Drop" sword (remove)
      removeItem(inventory, 'sword', 1)
      expect(countItem(inventory, 'sword')).toBe(0)

      // "Pick up" something else
      addItem(inventory, 'potion', 5, true)
      expect(countItem(inventory, 'potion')).toBe(5)
    })

    it('should handle looting multiple items', () => {
      const loot = [
        { itemId: 'ore', quantity: 10, stackable: true },
        { itemId: 'coins', quantity: 500, stackable: true },
        { itemId: 'key', quantity: 1, stackable: false }
      ]

      for (const item of loot) {
        addItem(inventory, item.itemId, item.quantity, item.stackable)
      }

      expect(countItem(inventory, 'ore')).toBe(10)
      expect(countItem(inventory, 'coins')).toBe(500)
      expect(countItem(inventory, 'key')).toBe(1)
      expect(freeSlots(inventory)).toBe(25)
    })

    it('should handle banking workflow', () => {
      addItem(inventory, 'ore', 100, true)
      addItem(inventory, 'sword', 2, false)

      // Bank ore and swords
      removeItem(inventory, 'ore', 100)
      removeItem(inventory, 'sword', 2)

      expect(freeSlots(inventory)).toBe(28)
    })
  })
})
