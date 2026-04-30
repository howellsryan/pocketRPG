import { expect } from 'vitest'

export function expectFiniteNumber(value: number, label: string) {
  expect(Number.isFinite(value), `${label} should be finite`).toBe(true)
}
