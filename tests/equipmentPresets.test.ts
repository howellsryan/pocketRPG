import { describe, it, expect } from 'vitest'
import {
  snapshotPreset,
  createPreset,
  renamePreset,
  applyPreset,
  MAX_EQUIPMENT_PRESETS,
  equipmentPresetLimit,
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
    expect(MAX_EQUIPMENT_PRESETS).toBe(3)
  })
})

describe('equipmentPresetLimit — purchased extra tabs', () => {
  it('starts at three and grows by one per purchased tab, without a ceiling', () => {
    expect(equipmentPresetLimit({ extraEquipmentTabs: 0 })).toBe(3)
    expect(equipmentPresetLimit({ extraEquipmentTabs: 1 })).toBe(4)
    expect(equipmentPresetLimit({ extraEquipmentTabs: 25 })).toBe(28)
  })

  it('falls back to the base three for a save predating the unlock', () => {
    expect(equipmentPresetLimit(undefined)).toBe(3)
    expect(equipmentPresetLimit({})).toBe(3)
    expect(equipmentPresetLimit({ doubleSlayerXp: true })).toBe(3)
  })

  it('never shrinks the base limit on a junk or negative count', () => {
    expect(equipmentPresetLimit({ extraEquipmentTabs: -5 })).toBe(3)
    expect(equipmentPresetLimit({ extraEquipmentTabs: 'lots' })).toBe(3)
    expect(equipmentPresetLimit({ extraEquipmentTabs: 2.7 })).toBe(5)
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

// A preset only ever RE-ARRANGES items the character already owns — it may never
// create or destroy one. This is the invariant the reported item-loss bug was
// first suspected of breaking (it holds; the loss was at the write-back boundary,
// covered by holdingsReconcile.test.ts), and it must stay true as the draw/bank
// rules evolve. Deterministic PRNG so a failure is reproducible.
describe('equipmentPresets — item conservation', () => {
  const SLOTS = ['weapon', 'body', 'ring', 'ammo']
  const IDS = Object.keys(ITEMS)

  function seeded(seed: number) {
    let s = seed
    return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
  }

  function totals(equipment: any, inventory: any[], bank: any) {
    const t: Record<string, number> = {}
    const add = (id: string, q: number) => { if (id && q > 0) t[id] = (t[id] || 0) + q }
    for (const slot of Object.keys(equipment || {})) {
      const e = equipment[slot]
      if (e?.itemId) add(e.itemId, e.quantity || 1)
    }
    for (const slot of inventory || []) if (slot?.itemId) add(slot.itemId, slot.quantity || 1)
    for (const [id, entry] of Object.entries<any>(bank || {})) if (entry) add(id, entry.quantity || 0)
    return t
  }

  // Charges are pooled per itemId (one scalar on a bank entry, per-instance
  // elsewhere), so §4 makes them as destructible as the items themselves.
  function chargeTotals(equipment: any, inventory: any[], bank: any) {
    const t: Record<string, number> = {}
    const add = (id: string, c: number) => { if (id && c > 0) t[id] = (t[id] || 0) + c }
    for (const slot of Object.keys(equipment || {})) {
      const e = equipment[slot]
      if (e?.itemId) add(e.itemId, Number(e.charges) || 0)
    }
    for (const slot of inventory || []) if (slot?.itemId) add(slot.itemId, Number(slot.charges) || 0)
    for (const [id, entry] of Object.entries<any>(bank || {})) if (entry) add(id, Number(entry.charges) || 0)
    return t
  }

  it('never creates or destroys an item across 2000 randomised loadout swaps', () => {
    const rand = seeded(20260801)
    const build = () => {
      const equipment: any = {}
      for (const slot of SLOTS) {
        if (rand() >= 0.5) continue
        const id = IDS[Math.floor(rand() * IDS.length)]
        equipment[slot] = { itemId: id, quantity: ITEMS[id].stackable ? 1 + Math.floor(rand() * 500) : 1 }
        if (id === 'charged_staff') equipment[slot].charges = 1 + Math.floor(rand() * 5000)
      }
      const inventory = new Array(28).fill(null).map(() => {
        if (rand() < 0.4) return null
        const id = IDS[Math.floor(rand() * IDS.length)]
        const entry: any = { itemId: id, quantity: ITEMS[id].stackable ? 1 + Math.floor(rand() * 5000) : 1 }
        if (id === 'charged_staff') entry.charges = 1 + Math.floor(rand() * 5000)
        return entry
      })
      return { equipment, inventory }
    }

    for (let iteration = 0; iteration < 2000; iteration++) {
      const snapshot = build()
      const preset = createPreset(`P${iteration}`, snapshot.equipment, snapshot.inventory)
      const live = build()
      const bank: any = {}
      for (const id of IDS) {
        if (rand() >= 0.6) continue
        bank[id] = { itemId: id, quantity: 1 + Math.floor(rand() * 10000) }
        if (id === 'charged_staff') bank[id].charges = 1 + Math.floor(rand() * 20000)
      }

      const before = totals(live.equipment, live.inventory, bank)
      const beforeCharges = chargeTotals(live.equipment, live.inventory, bank)
      const res = applyPreset(preset, { equipment: live.equipment, inventory: live.inventory, bank }, ITEMS, {}, new Set())
      const after = totals(res.equipment, res.inventory, res.bank)
      const afterCharges = chargeTotals(res.equipment, res.inventory, res.bank)

      expect({ iteration, ...after }).toEqual({ iteration, ...before })
      expect({ iteration, ...afterCharges }).toEqual({ iteration, ...beforeCharges })
    }
  })
})
