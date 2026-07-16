import { describe, expect, it } from 'vitest'
import { isTapNotDrag } from '../client/src/bank'

describe('isTapNotDrag', () => {
  it('is a tap when the pointer barely moved', () => {
    expect(isTapNotDrag(100, 100, 100, 100)).toBe(true)
    expect(isTapNotDrag(100, 100, 105, 103)).toBe(true)
  })
  it('is a drag once movement exceeds the tap threshold', () => {
    expect(isTapNotDrag(100, 100, 100, 140)).toBe(false)
    expect(isTapNotDrag(100, 100, 150, 100)).toBe(false)
  })
})
