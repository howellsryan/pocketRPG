// Monsters with an instanced open-world lair. The registry is what puts "Fight
// in the open world" on a monster, and the zone it names is what the world
// Worker is asked to drop the player into — a mismatch between the two sides
// sends the player to a zone that does not exist, so both halves are checked
// here.
import { describe, it, expect } from 'vitest'
import { WORLD_MONSTER_LAIRS, hasWorldLair, worldLairZone } from '../src/engine/worldLairs.js'
import { INSTANCED_ZONES, isInstancedZone } from '../world/shared/instances'
import monstersData from '../src/data/monsters.json'

const monsters = monstersData as Record<string, unknown | undefined>

describe('world monster lairs', () => {
  it('routes Grondar into his lair', () => {
    expect(worldLairZone('warlord_grondar')).toBe('grondar_lair')
    expect(hasWorldLair('warlord_grondar')).toBe(true)
  })

  it('claims no lair for a boss that has none', () => {
    expect(worldLairZone('krylth_the_defiler')).toBe(null)
    expect(hasWorldLair('krylth_the_defiler')).toBe(false)
  })

  it('roosts all three dragons in one room', () => {
    const rooms = ['green_dragon', 'red_dragon', 'black_dragon'].map(worldLairZone)
    expect(new Set(rooms).size).toBe(1)
    expect(rooms[0]).toBe('dragon_roost')
  })

  it('only names monsters that exist', () => {
    for (const monsterId of Object.keys(WORLD_MONSTER_LAIRS)) {
      expect(monsters[monsterId], monsterId).toBeTruthy()
    }
  })

  it('only names zones the world actually serves as instances', () => {
    for (const zoneId of Object.values(WORLD_MONSTER_LAIRS)) {
      expect(isInstancedZone(zoneId), zoneId).toBe(true)
      expect(INSTANCED_ZONES.has(zoneId), zoneId).toBe(true)
    }
  })
})
