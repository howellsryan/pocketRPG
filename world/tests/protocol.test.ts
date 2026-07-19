// Guards parseClientMessage against the class of bug that broke teleporting:
// a ClientMessage variant added to the union but never wired into the parser's
// switch, so every send of that message type silently closes the socket
// (WorldZone.onMessage closes on a null parse). One well-formed instance per
// literal `t` value must round-trip through the parser.
import { describe, expect, it } from 'vitest'
import { parseClientMessage } from '../shared/protocol'

const WELL_FORMED: Record<string, unknown> = {
  hello: { t: 'hello', token: 'abc' },
  walk: { t: 'walk', x: 1, z: 2 },
  interact: { t: 'interact', kind: 'rock', id: 'r1', action: 'mine' },
  cancel: { t: 'cancel' },
  chat: { t: 'chat', text: 'hi' },
  moveInv: { t: 'moveInv', from: 0, to: 1 },
  invAction: { t: 'invAction', slot: 0, action: 'equip' },
  bank: { t: 'bank', op: 'deposit', itemId: 'bronze_bar', qty: 1 },
  craft: { t: 'craft', station: 'furnace', recipeId: 'smelt_bronze_bar', qty: 1 },
  setRun: { t: 'setRun', run: true },
  setStance: { t: 'setStance', stance: 'accurate' },
  setSpell: { t: 'setSpell', spell: null },
  special: { t: 'special' },
  pray: { t: 'pray', prayerId: 'protect_from_melee' },
  unequip: { t: 'unequip', slot: 'weapon' },
  teleport: { t: 'teleport', placeId: 'lumbright' },
  logout: { t: 'logout' },
  ping: { t: 'ping', n: 1 },
}

describe('parseClientMessage — every ClientMessage variant', () => {
  // Hand-maintained against the ClientMessage union in shared/protocol.ts:
  // when a new `t` literal is added there, add its well-formed instance above
  // — this test fails loudly instead of the bug surfacing as a silent
  // connection close in production.
  for (const [t, message] of Object.entries(WELL_FORMED)) {
    it(`accepts a well-formed '${t}' message`, () => {
      expect(parseClientMessage(message)).not.toBeNull()
    })
  }

  it('rejects an unknown t', () => {
    expect(parseClientMessage({ t: 'not_a_real_message' })).toBeNull()
  })
})

describe('parseClientMessage — teleport', () => {
  it('accepts a well-formed placeId', () => {
    expect(parseClientMessage({ t: 'teleport', placeId: 'varrick' })).toEqual({ t: 'teleport', placeId: 'varrick' })
  })

  it('rejects a missing or empty placeId', () => {
    expect(parseClientMessage({ t: 'teleport' })).toBeNull()
    expect(parseClientMessage({ t: 'teleport', placeId: '' })).toBeNull()
  })

  it('rejects a non-string placeId', () => {
    expect(parseClientMessage({ t: 'teleport', placeId: 123 })).toBeNull()
  })

  it('rejects an over-length placeId', () => {
    expect(parseClientMessage({ t: 'teleport', placeId: 'x'.repeat(65) })).toBeNull()
  })
})
