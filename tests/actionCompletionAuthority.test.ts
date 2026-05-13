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
      sourceId: 'chicken',
      nonce: 'monster:chicken:1',
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
      sourceId: 'chicken',
      nonce: 'monster:chicken:2',
      rewards: [{ itemId: 'abyssal_whip', quantity: 1 }],
    })).toThrow(/Reward item not valid for source/)
  })
})
