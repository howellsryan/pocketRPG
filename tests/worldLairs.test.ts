// Bosses with an instanced open-world lair. The registry is what puts "Fight in
// the open world" on a boss, and the zone it names is what the world Worker is
// asked to drop the player into — a mismatch between the two sides sends the
// player to a zone that does not exist, so both halves are checked here.
import { describe, it, expect } from 'vitest'
import { WORLD_BOSS_LAIRS, hasWorldLair, worldLairZone } from '../src/engine/worldLairs.js'
import { INSTANCED_ZONES, isInstancedZone } from '../world/shared/instances'
import monstersData from '../src/data/monsters.json'

const monsters = monstersData as Record<string, { boss?: boolean } | undefined>

describe('world boss lairs', () => {
  it('routes Grondar into his lair', () => {
    expect(worldLairZone('warlord_grondar')).toBe('grondar_lair')
    expect(hasWorldLair('warlord_grondar')).toBe(true)
  })

  it('claims no lair for a boss that has none', () => {
    expect(worldLairZone('krylth_the_defiler')).toBe(null)
    expect(hasWorldLair('krylth_the_defiler')).toBe(false)
  })

  it('only names monsters that exist and are bosses', () => {
    for (const monsterId of Object.keys(WORLD_BOSS_LAIRS)) {
      expect(monsters[monsterId], monsterId).toBeTruthy()
      expect(monsters[monsterId]?.boss, monsterId).toBe(true)
    }
  })

  it('only names zones the world actually serves as instances', () => {
    for (const zoneId of Object.values(WORLD_BOSS_LAIRS)) {
      expect(isInstancedZone(zoneId), zoneId).toBe(true)
      expect(INSTANCED_ZONES.has(zoneId), zoneId).toBe(true)
    }
  })
})
