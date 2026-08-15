// A monster/boss/raid drop of more than one NON-stackable item arrives as a
// note: one inventory slot instead of N. Locks the rule itself, both loot-roll
// paths that carry it (live PvE combat, the raid completion table) and the
// server-authoritative grant — plus the sources that deliberately do NOT note.

import { describe, expect, it } from 'vitest'
import { dropArrivesNoted, applyNotedDrops } from '../src/engine/notedDrops.js'
import { createCombatState, applyInstantKill } from '../src/engine/combat.js'
import { addLootEntry, addNotedItem } from '../src/engine/inventory.js'
import { settleActionCompletion } from '../functions/_lib/game/actionCompletion.js'
import itemsData from '../src/data/items.json'

// Real ids, because the loot rollers read the real items.json.
const NON_STACKABLE = 'runeforged_ore'   // king_black_dragon drops [2, 5]
const STACKABLE = 'coins'

function buildDummy(drops: any[]) {
  return {
    id: 'training_dummy',
    name: 'Training Dummy',
    hitpoints: 1,
    combatLevel: 1,
    attackSpeed: 99,
    attackStyle: 'crush',
    stats: { attack: 1, strength: 1, defence: 1, magic: 1, ranged: 1 },
    attackBonus: 0,
    strengthBonus: 0,
    defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    drops,
    noSeedDrops: true,
    noCharmDrops: true,
  }
}

function killLoot(drops: any[]) {
  const state: any = createCombatState(buildDummy(drops), 'melee', 'accurate')
  const events = applyInstantKill(state)
  return events.find((e: any) => e.type === 'monsterDeath')?.loot ?? []
}

describe('dropArrivesNoted', () => {
  it('notes more than one of a non-stackable item', () => {
    expect(dropArrivesNoted(NON_STACKABLE, 2)).toBe(true)
    expect(dropArrivesNoted(NON_STACKABLE, 25)).toBe(true)
  })

  it('never notes a single copy — a lone note is worse than the item', () => {
    expect(dropArrivesNoted(NON_STACKABLE, 1)).toBe(false)
  })

  it('never notes a stackable item, which already fits one slot', () => {
    expect(dropArrivesNoted(STACKABLE, 5000)).toBe(false)
  })

  it('ignores junk input rather than noting it', () => {
    expect(dropArrivesNoted('', 5)).toBe(false)
    expect(dropArrivesNoted(NON_STACKABLE, 0)).toBe(false)
    expect(dropArrivesNoted(NON_STACKABLE, undefined as any)).toBe(false)
  })
})

describe('applyNotedDrops', () => {
  it('keeps an authored noted flag at quantity 1', () => {
    const [entry] = applyNotedDrops([{ itemId: NON_STACKABLE, quantity: 1, noted: true }]) as any[]
    expect(entry.noted).toBe(true)
  })

  it('leaves qualifying entries untouched apart from the flag', () => {
    const [entry] = applyNotedDrops([{ itemId: NON_STACKABLE, quantity: 4, chance: 1 }]) as any[]
    expect(entry).toEqual({ itemId: NON_STACKABLE, quantity: 4, chance: 1, noted: true })
  })
})

describe('live PvE combat drops', () => {
  it('notes a rolled quantity above 1', () => {
    const loot = killLoot([{ itemId: NON_STACKABLE, quantity: 3, chance: 1 }])
    expect(loot.find((l: any) => l.itemId === NON_STACKABLE)?.noted).toBe(true)
  })

  it('hands over a single copy un-noted', () => {
    const loot = killLoot([{ itemId: NON_STACKABLE, quantity: 1, chance: 1 }])
    expect(loot.find((l: any) => l.itemId === NON_STACKABLE)?.noted).toBeUndefined()
  })

  it('leaves a stackable drop alone', () => {
    const loot = killLoot([{ itemId: STACKABLE, quantity: 5000, chance: 1 }])
    expect(loot.find((l: any) => l.itemId === STACKABLE)?.noted).toBeUndefined()
  })

  it('notes the raid completion table the same way', () => {
    const state: any = createCombatState(buildDummy([]), 'melee', 'accurate')
    state.raid = {
      raidId: 'test_raid',
      name: 'Test Raid',
      bosses: ['training_dummy'],
      currentBossIndex: 0,
      monstersData: {},
      rewards: {
        always: [
          { itemId: NON_STACKABLE, quantity: 6, chance: 1 },
          { itemId: STACKABLE, quantity: 9000, chance: 1 },
        ],
      },
    }
    const events = applyInstantKill(state)
    const loot = events.find((e: any) => e.type === 'raidComplete')?.loot ?? []
    expect(loot.find((l: any) => l.itemId === NON_STACKABLE)?.noted).toBe(true)
    expect(loot.find((l: any) => l.itemId === STACKABLE)?.noted).toBeUndefined()
  })
})

describe('inventory placement', () => {
  it('a note occupies one slot however large the quantity', () => {
    const inv: any[] = Array(28).fill(null)
    addLootEntry(inv, { itemId: NON_STACKABLE, quantity: 12, noted: true }, itemsData)
    expect(inv.filter(Boolean)).toEqual([{ itemId: NON_STACKABLE, quantity: 12, noted: true }])
  })

  it('merges into an existing note, never into the un-noted copies', () => {
    const inv: any[] = Array(28).fill(null)
    inv[0] = { itemId: NON_STACKABLE, quantity: 1 }
    addNotedItem(inv, NON_STACKABLE, 3)
    addNotedItem(inv, NON_STACKABLE, 2)
    expect(inv[0]).toEqual({ itemId: NON_STACKABLE, quantity: 1 })
    expect(inv[1]).toEqual({ itemId: NON_STACKABLE, quantity: 5, noted: true })
    expect(inv.filter(Boolean)).toHaveLength(2)
  })

  it('refuses a note when the pack is full', () => {
    const inv: any[] = Array(28).fill(null).map(() => ({ itemId: 'bones', quantity: 1 }))
    expect(addNotedItem(inv, NON_STACKABLE, 4)).toBe(false)
  })
})

describe('server-authoritative grant', () => {
  const KBD = 'king_black_dragon'

  it('grants more than one non-stackable monster drop as a single note', () => {
    const save: any = { inventory: [], bank: {} }
    const res = settleActionCompletion(save, {
      sourceType: 'monsters',
      sourceId: KBD,
      rewards: [{ itemId: NON_STACKABLE, quantity: 5 }],
    })
    expect(save.inventory).toEqual([{ itemId: NON_STACKABLE, quantity: 5, noted: true }])
    expect(res.granted).toEqual([
      { itemId: NON_STACKABLE, quantity: 5, destination: 'inventory', noted: true },
    ])
  })

  it('still grants a single copy un-noted', () => {
    const save: any = { inventory: [], bank: {} }
    settleActionCompletion(save, {
      sourceType: 'monsters',
      sourceId: KBD,
      rewards: [{ itemId: NON_STACKABLE, quantity: 1 }],
    })
    expect(save.inventory).toEqual([{ itemId: NON_STACKABLE, quantity: 1 }])
  })

  it('banks the drop when there is no slot for the note', () => {
    const save: any = { inventory: Array(28).fill(null).map(() => ({ itemId: 'bones', quantity: 1 })), bank: {} }
    const res = settleActionCompletion(save, {
      sourceType: 'monsters',
      sourceId: KBD,
      rewards: [{ itemId: NON_STACKABLE, quantity: 5 }],
    })
    expect(save.bank[NON_STACKABLE]).toEqual({ itemId: NON_STACKABLE, quantity: 5 })
    expect(res.granted[0].destination).toBe('bank')
  })

  it('merges into an existing note in a full pack', () => {
    const inventory = Array(27).fill(null).map(() => ({ itemId: 'bones', quantity: 1 }))
    inventory.push({ itemId: NON_STACKABLE, quantity: 2, noted: true } as any)
    const save: any = { inventory, bank: {} }
    settleActionCompletion(save, {
      sourceType: 'monsters',
      sourceId: KBD,
      rewards: [{ itemId: NON_STACKABLE, quantity: 5 }],
    })
    expect(save.bank[NON_STACKABLE]).toBeUndefined()
    expect(save.inventory.at(-1)).toEqual({ itemId: NON_STACKABLE, quantity: 7, noted: true })
  })

  it('does not note a clue casket, and never trusts a noted flag off the body', () => {
    const save: any = { inventory: [], bank: {} }
    const res = settleActionCompletion(save, {
      sourceType: 'clues',
      sourceId: 'medium',
      rewards: [{ itemId: 'mithril_platebody', quantity: 3, noted: true }],
    })
    expect(save.inventory).toEqual([
      { itemId: 'mithril_platebody', quantity: 1 },
      { itemId: 'mithril_platebody', quantity: 1 },
      { itemId: 'mithril_platebody', quantity: 1 },
    ])
    expect(res.granted.every((g: any) => g.noted === undefined)).toBe(true)
  })
})
