import { vi } from 'vitest'

export function mockRandomSequence(values: number[]) {
  let index = 0
  return vi.spyOn(Math, 'random').mockImplementation(() => {
    const value = values[Math.min(index, values.length - 1)] ?? 0
    index += 1
    return value
  })
}
