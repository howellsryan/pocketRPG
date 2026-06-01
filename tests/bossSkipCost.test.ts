import { describe, it, expect } from 'vitest'
import monsters from '../src/data/monsters.json'

// Server-authoritative boss/raid instant-kill skip costs live as `skipCost` on
// the monster definition (functions/api/skip-hour.js reads the same field).
// Defaults to 1 credit when absent.
describe('boss skip cost data', () => {
  it('Ember Tyrant costs 10 credits to skip', () => {
    expect((monsters as Record<string, any>).ember_tyrant.skipCost).toBe(10)
  })

  it('Ashen Crucible costs 250 credits to skip', () => {
    expect((monsters as Record<string, any>).ashen_crucible.skipCost).toBe(250)
  })

  it('any declared skipCost is a positive integer', () => {
    for (const [id, monster] of Object.entries(monsters as Record<string, any>)) {
      if (monster.skipCost === undefined) continue
      expect(Number.isInteger(monster.skipCost), `${id} skipCost must be an integer`).toBe(true)
      expect(monster.skipCost, `${id} skipCost must be > 0`).toBeGreaterThan(0)
    }
  })
})
