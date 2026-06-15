import { describe, it, expect } from 'vitest'
import { settleActionCompletion } from '../functions/_lib/game/actionCompletion.js'

function makeSave() {
  return {
    inventory: [],
    bank: [],
    settings: {},
    _serverActionNonces: {},
  } as any
}

describe('action completion authority helpers', () => {
  it('accepts regular monster drops that are not collection-log entries', () => {
    const save = makeSave()
    const out = settleActionCompletion(save, {
      sourceType: 'monsters',
      sourceId: 'field_chicken',
      nonce: 'monster:field_chicken:1',
      rewards: [{ itemId: 'raw_chicken', quantity: 1 }],
    })

    expect(out.granted).toEqual([{ itemId: 'raw_chicken', quantity: 1, destination: 'inventory' }])
  })

  it('accepts boss source type using monster drop validation', () => {
    const save = makeSave()
    const out = settleActionCompletion(save, {
      sourceType: 'boss',
      sourceId: 'king_black_dragon',
      nonce: 'boss:kbd:1',
      rewards: [{ itemId: 'dragon_bones', quantity: 1 }],
    })

    expect(out.granted).toEqual([{ itemId: 'dragon_bones', quantity: 1, destination: 'inventory' }])
  })

  it('still rejects items not valid for the provided monster source', () => {
    const save = makeSave()
    expect(() => settleActionCompletion(save, {
      sourceType: 'monsters',
      sourceId: 'field_chicken',
      nonce: 'monster:field_chicken:2',
      rewards: [{ itemId: 'nether_demon_whip', quantity: 1 }],
    })).toThrow(/Reward item not valid for source/)
  })

  it('routes non-stackable rewards to bank when inventory fills during completion', () => {
    const save = makeSave()
    save.inventory = Array.from({ length: 27 }, (_, i) => ({ itemId: `filler_${i}`, quantity: 1 }))
    const out = settleActionCompletion(save, {
      sourceType: 'monsters',
      sourceId: 'field_chicken',
      nonce: 'monster:field_chicken:3',
      rewards: [{ itemId: 'raw_chicken', quantity: 2 }],
    })

    expect(out.granted).toEqual([
      { itemId: 'raw_chicken', quantity: 1, destination: 'inventory' },
      { itemId: 'raw_chicken', quantity: 1, destination: 'bank' },
    ])
  })

  it('keeps stackable rewards in inventory when stack already exists even if full', () => {
    const save = makeSave()
    save.inventory = [
      { itemId: 'feather', quantity: 10 },
      ...Array.from({ length: 27 }, (_, i) => ({ itemId: `filler_${i}`, quantity: 1 })),
    ]
    const out = settleActionCompletion(save, {
      sourceType: 'monsters',
      sourceId: 'field_chicken',
      nonce: 'monster:field_chicken:4',
      rewards: [{ itemId: 'feather', quantity: 50 }],
    })

    expect(out.granted).toEqual([{ itemId: 'feather', quantity: 50, destination: 'inventory' }])
  })

  it('spends slayer points from settings.slayerPoints (the canonical save location)', () => {
    // Regression: a slayer unlock purchase (e.g. slayer_helmet, cost 400)
    // round-trips through this handler with slayerPoints: -cost. The points
    // live at settings.slayerPoints, so reading them anywhere else makes the
    // server see 0 and reject the spend with INSUFFICIENT_SUPPLIES.
    const save = makeSave()
    save.settings.slayerPoints = 500
    const out = settleActionCompletion(save, {
      sourceType: 'slayer',
      sourceId: 'slayer',
      nonce: 'slayer:slayer_helmet:1',
      rewards: [{ itemId: 'slayer_helmet', quantity: 1 }],
      slayerPoints: -400,
    })

    expect(out.slayerPoints).toBe(-400)
    expect(save.settings.slayerPoints).toBe(100)
    expect(out.granted).toEqual([{ itemId: 'slayer_helmet', quantity: 1, destination: 'inventory' }])
  })

  it('rejects a slayer-points spend the player cannot afford', () => {
    const save = makeSave()
    save.settings.slayerPoints = 100
    expect(() => settleActionCompletion(save, {
      sourceType: 'slayer',
      sourceId: 'slayer',
      nonce: 'slayer:slayer_defender:1',
      rewards: [{ itemId: 'slayer_defender', quantity: 1 }],
      slayerPoints: -1500,
    })).toThrow(/Insufficient supplies/)
    // The save must be left untouched when the spend is refused.
    expect(save.settings.slayerPoints).toBe(100)
  })
})
