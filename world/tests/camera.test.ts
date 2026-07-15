import { describe, expect, it } from 'vitest'
import { applyDrag, applyPinch, applyWheel, isTypingTarget, yawFromKeys, zoomFromKeys } from '../client/src/cameraControls'
import { ZOOM_MAX, ZOOM_MIN } from '../client/src/scene'

describe('yawFromKeys', () => {
  it('holds still when neither or both arrow keys are held', () => {
    expect(yawFromKeys(1, false, false, 1)).toBe(1)
    expect(yawFromKeys(1, true, true, 1)).toBe(1)
  })
  it('rotates opposite directions for left vs right', () => {
    const left = yawFromKeys(0, true, false, 1)
    const right = yawFromKeys(0, false, true, 1)
    expect(left).toBeGreaterThan(0)
    expect(right).toBeLessThan(0)
    expect(left).toBeCloseTo(-right)
  })
  it('scales with elapsed time', () => {
    const half = yawFromKeys(0, true, false, 0.5)
    const full = yawFromKeys(0, true, false, 1)
    expect(full).toBeCloseTo(half * 2)
  })
})

describe('zoomFromKeys', () => {
  it('holds still when neither or both zoom keys are held', () => {
    expect(zoomFromKeys(1, false, false, 1)).toBe(1)
    expect(zoomFromKeys(1, true, true, 1)).toBe(1)
  })
  it('up zooms in, down zooms out', () => {
    expect(zoomFromKeys(1, true, false, 0.1)).toBeLessThan(1)
    expect(zoomFromKeys(1, false, true, 0.1)).toBeGreaterThan(1)
  })
  it('clamps to the zoom range', () => {
    expect(zoomFromKeys(ZOOM_MIN, true, false, 10)).toBe(ZOOM_MIN)
    expect(zoomFromKeys(ZOOM_MAX, false, true, 10)).toBe(ZOOM_MAX)
  })
})

describe('applyWheel', () => {
  it('matches the previous inline main.ts math (deltaY * 0.001)', () => {
    expect(applyWheel(1, 100)).toBeCloseTo(1.1)
    expect(applyWheel(1, -100)).toBeCloseTo(0.9)
  })
  it('clamps to the zoom range', () => {
    expect(applyWheel(ZOOM_MAX, 100000)).toBe(ZOOM_MAX)
    expect(applyWheel(ZOOM_MIN, -100000)).toBe(ZOOM_MIN)
  })
})

describe('applyDrag', () => {
  it('rotates opposite directions for opposite drag directions', () => {
    expect(applyDrag(0, 100)).toBeLessThan(0)
    expect(applyDrag(0, -100)).toBeGreaterThan(0)
  })
  it('is proportional to drag distance', () => {
    expect(applyDrag(0, 200)).toBeCloseTo(applyDrag(0, 100) * 2)
  })
})

describe('applyPinch', () => {
  it('divides by the ratio — fingers spreading (ratio > 1) zooms in', () => {
    expect(applyPinch(1.5, 2)).toBeCloseTo(0.75)
    expect(applyPinch(0.8, 0.5)).toBeCloseTo(1.6)
  })
  it('clamps to the zoom range', () => {
    expect(applyPinch(ZOOM_MIN, 100)).toBe(ZOOM_MIN)
    expect(applyPinch(ZOOM_MAX, 0.001)).toBe(ZOOM_MAX)
  })
})

describe('isTypingTarget', () => {
  it('is true for inputs, textareas, and contenteditable elements', () => {
    expect(isTypingTarget({ tagName: 'INPUT' } as Element)).toBe(true)
    expect(isTypingTarget({ tagName: 'TEXTAREA' } as Element)).toBe(true)
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true } as unknown as Element)).toBe(true)
  })
  it('is false for everything else, including null', () => {
    expect(isTypingTarget({ tagName: 'CANVAS' } as Element)).toBe(false)
    expect(isTypingTarget({ tagName: 'BODY' } as Element)).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})
