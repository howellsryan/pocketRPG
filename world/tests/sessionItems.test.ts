import { describe, expect, it } from 'vitest'
import { consumeUnits, depositUnits, emptyPools, mintUnits, withdrawUnits } from '../server/sessionItems'
import { BURY_XP, healAmount, primaryInvAction } from '../shared/itemActions'

describe('item pools', () => {
  it('consumes minted first, then bank-sourced, then save-backed', () => {
    const pools = emptyPools({ trout: 2 })
    mintUnits(pools, 'trout', 1)
    withdrawUnits(pools, 'trout', 1)
    consumeUnits(pools, 'trout', 3)
    expect(pools.minted).toEqual({})
    expect(pools.bankSourced).toEqual({})
    expect(pools.consumedBankSourced).toEqual({ trout: 1 })
    expect(pools.consumedSaveBacked).toEqual({ trout: 1 })
    expect(pools.saveBacked).toEqual({ trout: 1 })
  })

  it('consuming a minted unit records no save mutation at all', () => {
    const pools = emptyPools()
    mintUnits(pools, 'bones', 2)
    consumeUnits(pools, 'bones', 1)
    expect(pools.minted).toEqual({ bones: 1 })
    expect(pools.consumedSaveBacked).toEqual({})
    expect(pools.consumedBankSourced).toEqual({})
  })

  it('deposit cancels bank-sourced units silently, then splits minted/save-backed', () => {
    const pools = emptyPools({ tin_ore: 3 })
    mintUnits(pools, 'tin_ore', 2)
    withdrawUnits(pools, 'tin_ore', 1)
    depositUnits(pools, 'tin_ore', 6)
    expect(pools.bankSourced).toEqual({})
    expect(pools.mintedToBank).toEqual({ tin_ore: 2 })
    expect(pools.depositedSaveBacked).toEqual({ tin_ore: 3 })
    expect(pools.minted).toEqual({})
    expect(pools.saveBacked).toEqual({})
  })

  it('withdraw → re-deposit round-trips to nothing owed', () => {
    const pools = emptyPools()
    withdrawUnits(pools, 'trout', 5)
    depositUnits(pools, 'trout', 5)
    expect(pools.bankSourced).toEqual({})
    expect(pools.mintedToBank).toEqual({})
    expect(pools.depositedSaveBacked).toEqual({})
    expect(pools.consumedBankSourced).toEqual({})
  })

  it('pack invariant holds through a mixed session', () => {
    // pack per item === minted + saveBacked + bankSourced at every step
    const pools = emptyPools({ trout: 4 })
    let pack = 4
    withdrawUnits(pools, 'trout', 3); pack += 3
    consumeUnits(pools, 'trout', 2); pack -= 2
    depositUnits(pools, 'trout', 3); pack -= 3
    mintUnits(pools, 'trout', 1); pack += 1
    const held = (pools.minted.trout ?? 0) + (pools.saveBacked.trout ?? 0) + (pools.bankSourced.trout ?? 0)
    expect(held).toBe(pack)
  })
})

describe('primaryInvAction', () => {
  it('derives the main game verbs from items.json', () => {
    expect(primaryInvAction('runeforged_scimitar')).toEqual({ action: 'equip', label: 'Wield' })
    expect(primaryInvAction('trout')).toEqual({ action: 'eat', label: 'Eat' })
    expect(primaryInvAction('bones')).toEqual({ action: 'bury', label: 'Bury' })
    expect(primaryInvAction('tin_ore')).toBeNull()
    expect(primaryInvAction('nonexistent_item')).toBeNull()
  })

  it('non-weapon gear says Wear, weapons say Wield', () => {
    const wear = primaryInvAction('leather_body')
    expect(wear?.action).toBe('equip')
    expect(wear?.label).toBe('Wear')
  })

  it('bury xp comes from skills.json prayer actions', () => {
    expect(BURY_XP.bones).toBe(5)
    expect(BURY_XP.big_bones).toBe(15)
    expect(BURY_XP.dragon_bones).toBe(72)
  })

  it('food heals what items.json says', () => {
    expect(healAmount('trout')).toBeGreaterThan(0)
    expect(healAmount('tin_ore')).toBe(0)
  })
})
