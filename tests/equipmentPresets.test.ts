import { describe, it, expect } from 'vitest'
import {
  snapshotPreset,
  createPreset,
  renamePreset,
  applyPreset,
  MAX_EQUIPMENT_PRESETS,
} from '../src/engine/equipmentPresets.js'

const ITEMS: any = {
  bronze_sword: { id: 'bronze_sword', name: 'Bronze Sword', type: 'weapon', slot: 'weapon' },
  rune_platebody: { id: 'rune_platebody', name: 'Rune Platebody', type: 'armour', slot: 'body' },
  dragon_scimitar: { id: 'dragon_scimitar', name: 'Dragon Scimitar', type: 'weapon', slot: 'weapon', questUnlock: 'monkey_madness' },
  charged_staff: { id: 'charged_staff', name: 'Charged Staff', type: 'weapon', slot: 'weapon', scaleCharged: true },
  air_rune: { id: 'air_rune', name: 'Air Rune', type: 'rune', stackable: true },
  shark: { id: 'shark', name: 'Shark', type: 'food', heals: 20 },
  bronze_arrow: { id: 'bronze_arrow', name: 'Bronze Arrow', type: 'ammo', slot: 'ammo', stackable: true },
}

// Build a 28-slot inventory from a sparse map of index -> entry.
function inv(map: Record<number, any> = {}) {
  const arr = new Array(28).fill(null)
  for (const [i, v] of Object.entries(map)) arr[Number(i)] = v
  return arr
}

describe('equipmentPresets — snapshot', () => {
  it('captures equipment + inventory, dropping transient flags', () => {
    const equipment = { weapon: { itemId: 'bronze_sword', _twoHanded: false }, body: { itemId: 'rune_platebody' } }
    const inventory = inv({ 0: { itemId: 'shark', quantity: 3 }, 5: { itemId: 'air_rune', quantity: 100 } })
    const snap = snapshotPreset(equipment, inventory)
    expect(snap.equipment.weapon).toEqual({ itemId: 'bronze_sword' }) // no _twoHanded
    expect(snap.equipment.body).toEqual({ itemId: 'rune_platebody' })
    expect(snap.inventory[0]).toEqual({ itemId: 'shark', quantity: 3 })
    expect(snap.inventory[5]).toEqual({ itemId: 'air_rune', quantity: 100 })
    expect(snap.inventory[1]).toBe(null)
    expect(snap.inventory).toHaveLength(28)
  })

  it('preserves charges on snapshot', () => {
    const snap = snapshotPreset({ weapon: { itemId: 'charged_staff', charges: 500 } }, inv())
    expect(snap.equipment.weapon).toEqual({ itemId: 'charged_staff', charges: 500 })
  })

  it('createPreset assigns id + sanitized name; renamePreset trims/caps', () => {
    const p = createPreset('   Mage Setup   ', { weapon: { itemId: 'bronze_sword' } }, inv())
    expect(p.id).toMatch(/^preset_/)
    expect(p.name).toBe('Mage Setup')
    const r = renamePreset(p, 'x'.repeat(40))
    expect(r.name).toHaveLength(24)
    expect(renamePreset(p, '   ').name).toBe('Mage Setup') // empty falls back to current
    expect(MAX_EQUIPMENT_PRESETS).toBeGreaterThan(0)
  })
})

describe('equipmentPresets — apply', () => {
  it('pulls items from the bank to fulfil a preset and banks the rest', () => {
    const preset = createPreset('Combat', { weapon: { itemId: 'bronze_sword' }, body: { itemId: 'rune_platebody' } },
      inv({ 0: { itemId: 'shark', quantity: 5 } }))
    // Player currently holds the gear in the bank plus an unrelated item equipped.
    const state = {
      equipment: { weapon: { itemId: 'dragon_scimitar', _twoHanded: false } },
      inventory: inv(),
      bank: {
        bronze_sword: { itemId: 'bronze_sword', quantity: 1 },
        rune_platebody: { itemId: 'rune_platebody', quantity: 1 },
        shark: { itemId: 'shark', quantity: 12 },
      },
    }
    const res = applyPreset(preset, state, ITEMS, {}, new Set(['monkey_madness']))
    expect(res.equipment.weapon).toMatchObject({ itemId: 'bronze_sword' })
    expect(res.equipment.body).toMatchObject({ itemId: 'rune_platebody' })
    expect(res.inventory[0]).toEqual({ itemId: 'shark', quantity: 5 })
    expect(res.missing).toEqual([])
    expect(res.partial).toEqual([])
    expect(res.reqFailed).toEqual([])
    // Leftover returns to bank: the previously-equipped scimitar + 7 surplus sharks.
    expect(res.bank.dragon_scimitar).toEqual({ itemId: 'dragon_scimitar', quantity: 1 })
    expect(res.bank.shark).toEqual({ itemId: 'shark', quantity: 7 })
    expect(res.bank.bronze_sword).toBeUndefined()
  })

  it('reports missing items and leaves the slot empty', () => {
    const preset = createPreset('Combat', { weapon: { itemId: 'bronze_sword' }, body: { itemId: 'rune_platebody' } }, inv())
    const state = { equipment: {}, inventory: inv(), bank: { bronze_sword: { itemId: 'bronze_sword', quantity: 1 } } }
    const res = applyPreset(preset, state, ITEMS, {}, new Set())
    expect(res.equipment.weapon).toMatchObject({ itemId: 'bronze_sword' })
    expect(res.equipment.body).toBeUndefined()
    expect(res.missing).toEqual([{ itemId: 'rune_platebody', quantity: 1 }])
  })

  it('reports requirement-locked items and returns them to the bank', () => {
    const preset = createPreset('PvP', { weapon: { itemId: 'dragon_scimitar' } }, inv())
    const state = { equipment: {}, inventory: inv(), bank: { dragon_scimitar: { itemId: 'dragon_scimitar', quantity: 1 } } }
    const res = applyPreset(preset, state, ITEMS, {}, new Set()) // quest NOT completed
    expect(res.equipment.weapon).toBeUndefined()
    expect(res.reqFailed).toEqual([{ itemId: 'dragon_scimitar', reason: { reason: 'quest', questUnlock: 'monkey_madness' } }])
    expect(res.bank.dragon_scimitar).toEqual({ itemId: 'dragon_scimitar', quantity: 1 })
  })

  it('fills stackables partially and reports the shortfall', () => {
    const preset = createPreset('Mage', {}, inv({ 0: { itemId: 'air_rune', quantity: 1000 } }))
    const state = { equipment: {}, inventory: inv(), bank: { air_rune: { itemId: 'air_rune', quantity: 300 } } }
    const res = applyPreset(preset, state, ITEMS, {}, new Set())
    expect(res.inventory[0]).toEqual({ itemId: 'air_rune', quantity: 300 })
    expect(res.partial).toEqual([{ itemId: 'air_rune', wanted: 1000, got: 300 }])
    expect(res.bank.air_rune).toBeUndefined() // all 300 consumed
  })

  it('keeps weapon charges and ammo quantity on equip', () => {
    const preset = createPreset('Charged',
      { weapon: { itemId: 'charged_staff', charges: 400 }, ammo: { itemId: 'bronze_arrow', quantity: 50 } }, inv())
    const state = {
      equipment: {},
      inventory: inv({ 0: { itemId: 'charged_staff', charges: 400 } }),
      bank: { bronze_arrow: { itemId: 'bronze_arrow', quantity: 200 } },
    }
    const res = applyPreset(preset, state, ITEMS, {}, new Set())
    expect(res.equipment.weapon).toMatchObject({ itemId: 'charged_staff', charges: 400 })
    expect(res.equipment.ammo).toMatchObject({ itemId: 'bronze_arrow', quantity: 50 })
    expect(res.bank.bronze_arrow).toEqual({ itemId: 'bronze_arrow', quantity: 150 })
  })
})
