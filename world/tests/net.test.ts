import { describe, expect, it } from 'vitest'
import { shouldReconnectOnClose } from '../client/src/net'

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
