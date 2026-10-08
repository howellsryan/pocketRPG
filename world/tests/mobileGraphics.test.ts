import { describe, expect, it } from 'vitest'
import { createGraphicsBudget } from '../client/src/graphics'

describe('mobile framebuffer budget', () => {
  it('keeps phone rendering below double-resolution while respecting native DPR', () => {
    expect(createGraphicsBudget(3, true).current.pixelRatio).toBeLessThanOrEqual(1.25)
    expect(createGraphicsBudget(1, true).current.pixelRatio).toBe(1)
    expect(createGraphicsBudget(2, false).current.pixelRatio).toBe(2)
  })
  it('reduces sustained slow-frame cost without changing gameplay time', () => {
    const budget = createGraphicsBudget(3, true)
    const initial = budget.current.pixelRatio
    for (let i = 0; i < 100; i++) budget.observe(40)
    expect(budget.current.pixelRatio).toBeLessThan(initial)
    expect(budget.current.shadowSize).toBeLessThanOrEqual(512)
  })
  it('ignores an isolated hitch and background gaps', () => {
    const budget = createGraphicsBudget(3, true)
    const initial = { ...budget.current }
    for (let i = 0; i < 120; i++) budget.observe(16.7)
    budget.observe(250)
    budget.observe(60_000)
    for (let i = 0; i < 120; i++) budget.observe(16.7)
    expect(budget.current).toEqual(initial)
  })
  it('clears partial measurements on resume and never oscillates or falls below its floor', () => {
    const budget = createGraphicsBudget(3, true)
    const initial = { ...budget.current }
    for (let i = 0; i < 30; i++) budget.observe(40)
    budget.reset()
    for (let i = 0; i < 120; i++) budget.observe(16.7)
    expect(budget.current).toEqual(initial)
    for (let i = 0; i < 1000; i++) budget.observe(40)
    expect(budget.current.pixelRatio).toBeGreaterThanOrEqual(1)
    const lowered = { ...budget.current }
    for (let i = 0; i < 1000; i++) budget.observe(16.7)
    expect(budget.current).toEqual(lowered)
  })
})
