// Guards the native double-tap page-zoom detector: two quick taps at the same
// spot are a zoom (block it); a slower pair, or two taps far apart, are real
// interactions and must pass through.
import { describe, expect, it } from 'vitest'
import { isDoubleTap, type TapPoint } from '../client/src/preventZoom'

const at = (t: number, x = 0, y = 0): TapPoint => ({ t, x, y })

describe('isDoubleTap', () => {
  it('is false with no previous tap', () => {
    expect(isDoubleTap(null, at(100))).toBe(false)
  })

  it('flags two quick taps at the same spot as a double-tap', () => {
    expect(isDoubleTap(at(0, 50, 50), at(200, 52, 48))).toBe(true)
  })

  it('ignores a slow second tap (outside the double-tap window)', () => {
    expect(isDoubleTap(at(0, 50, 50), at(600, 50, 50))).toBe(false)
  })

  it('ignores two quick taps far apart (distinct controls, not a zoom)', () => {
    expect(isDoubleTap(at(0, 20, 20), at(150, 300, 400))).toBe(false)
  })

  it('treats the window and distance bounds as inclusive', () => {
    expect(isDoubleTap(at(0, 0, 0), at(350, 40, 0))).toBe(true)
    expect(isDoubleTap(at(0, 0, 0), at(351, 0, 0))).toBe(false)
  })
})
