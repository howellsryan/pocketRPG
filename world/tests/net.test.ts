import { describe, expect, it } from 'vitest'
import { isInstanceDeathClose, isInstanceFullClose, shouldReconnectOnClose } from '../client/src/net'

describe('shouldReconnectOnClose', () => {
  it('does not reconnect after a 1008 policy close (terminal session rejection)', () => {
    expect(shouldReconnectOnClose({ code: 1008 })).toBe(false)
  })

  it('reconnects after an abnormal network drop (1006)', () => {
    expect(shouldReconnectOnClose({ code: 1006 })).toBe(true)
  })

  it('reconnects after a going-away close (1001)', () => {
    expect(shouldReconnectOnClose({ code: 1001 })).toBe(true)
  })

  it('reconnects after a normal close (1000)', () => {
    expect(shouldReconnectOnClose({ code: 1000 })).toBe(true)
  })
})

describe('isInstanceFullClose', () => {
  it('recognises a lair that filled up between assignment and joining', () => {
    expect(isInstanceFullClose({ code: 1008, reason: 'instance_full' })).toBe(true)
  })

  it('does not claim any other 1008 rejection — those really are logouts', () => {
    for (const reason of ['invalid_token', 'character_not_found', 'in_coop_session', '']) {
      expect(isInstanceFullClose({ code: 1008, reason })).toBe(false)
    }
    expect(isInstanceFullClose({ code: 1008 })).toBe(false)
  })

  it('does not claim a network drop that happens to carry the reason', () => {
    expect(isInstanceFullClose({ code: 1006, reason: 'instance_full' })).toBe(false)
  })
})

describe('isInstanceDeathClose', () => {
  it('recognises the eject that follows a death in an instanced boss lair', () => {
    expect(isInstanceDeathClose({ code: 1008, reason: 'instance_death' })).toBe(true)
  })

  it('does not claim any other 1008 rejection — those really are logouts', () => {
    for (const reason of ['invalid_token', 'character_not_found', 'instance_full', '']) {
      expect(isInstanceDeathClose({ code: 1008, reason })).toBe(false)
    }
    expect(isInstanceDeathClose({ code: 1008 })).toBe(false)
  })

  it('does not claim a network drop that happens to carry the reason', () => {
    expect(isInstanceDeathClose({ code: 1006, reason: 'instance_death' })).toBe(false)
  })
})
