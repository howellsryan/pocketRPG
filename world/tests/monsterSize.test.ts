// Large monsters (the dragons) own a 3×3 body: players path around it rather
// than under the jaw, and both sides swing from its edge instead of its centre
// tile. Without this a dragon's model swallows the player standing on the tile
// next to it.
import { describe, expect, it } from 'vitest'
import { collisionWithMonsters, footprintRadius, inFootprint, reachAgainst } from '../shared/monsterSize'
import { findPath } from '../server/pathfind'
import { npcsFromZone } from '../server/npc'
import { ZONES } from '../server/zones'
import { MONSTER_MODELS } from '../shared/monsterModels'
import monstersData from '../../src/data/monsters.json'

const OPEN = Array.from({ length: 12 }, () => '.'.repeat(12))

describe('monster footprints', () => {
  it('gives every dragon a body and ordinary monsters none', () => {
    expect(footprintRadius('green_dragon')).toBe(1)
    expect(footprintRadius('red_dragon')).toBe(1)
    expect(footprintRadius('black_dragon')).toBe(1)
    expect(footprintRadius('pasture_bull')).toBe(0)
    expect(footprintRadius(undefined)).toBe(0)
  })

  it('covers the ring of tiles around a dragon', () => {
    const dragon = { x: 5, z: 5, monsterId: 'green_dragon' }
    expect(inFootprint(dragon, 5, 5)).toBe(true)
    expect(inFootprint(dragon, 6, 4)).toBe(true)
    expect(inFootprint(dragon, 7, 5)).toBe(false)
  })

  it('widens both reaches so the fight happens at the nose', () => {
    expect(reachAgainst('green_dragon', 1)).toBe(2)
    expect(reachAgainst('pasture_bull', 1)).toBe(1)
  })
})

describe('collisionWithMonsters', () => {
  const dragons = () => npcsFromZone([{ id: 'd1', monsterId: 'green_dragon', x: 5, z: 5, wander: { x: 5, z: 5, w: 1, h: 1 } }])

  it('blocks the dragon body for player pathing', () => {
    const grid = collisionWithMonsters(OPEN, dragons().values())
    expect(grid[5][5]).toBe('#')
    expect(grid[4][6]).toBe('#')
    expect(grid[5][7]).toBe('.')
  })

  it('leaves the grid untouched when nothing in the zone is large', () => {
    const bulls = npcsFromZone([{ id: 'b1', monsterId: 'pasture_bull', x: 5, z: 5, wander: { x: 5, z: 5, w: 1, h: 1 } }])
    expect(collisionWithMonsters(OPEN, bulls.values())).toBe(OPEN)
  })

  it('ignores a dead dragon', () => {
    const npcs = dragons()
    npcs.get('d1')!.state = 'dead'
    expect(collisionWithMonsters(OPEN, npcs.values())).toBe(OPEN)
  })

  it('never blocks the tile the pathing player stands on', () => {
    // A dragon wandering onto the player must not wedge them where they stand.
    const grid = collisionWithMonsters(OPEN, dragons().values(), { x: 5, z: 5 })
    expect(grid[5][5]).toBe('.')
    expect(grid[4][4]).toBe('#')
  })

  it('routes a walk around the dragon instead of through it', () => {
    const grid = collisionWithMonsters(OPEN, dragons().values(), { x: 5, z: 8 })
    const path = findPath(grid, { x: 5, z: 8 }, { x: 5, z: 2 })
    expect(path).not.toBeNull()
    for (const step of path!) expect(inFootprint({ x: 5, z: 5, monsterId: 'green_dragon' }, step.x, step.z)).toBe(false)
  })
})

describe('dragon render size', () => {
  // The footprint is what stops a player standing inside a dragon, but the
  // dragon also has to LOOK like the thing you can't walk under: every one of
  // them outsizes every ordinary monster in the world (bosses excepted).
  it('makes every dragon taller than every ordinary monster', () => {
    const monsters = monstersData as Record<string, { boss?: boolean } | undefined>
    const dragons = ['green_dragon', 'red_dragon', 'black_dragon'].map((id) => MONSTER_MODELS[id].targetHeight)
    const ordinary = Object.entries(MONSTER_MODELS)
      .filter(([id]) => footprintRadius(id) === 0 && !monsters[id]?.boss)
      .map(([, m]) => m.targetHeight)
    expect(Math.min(...dragons)).toBeGreaterThan(Math.max(...ordinary))
  })
})

describe('the roost stays walkable around its dragons', () => {
  // A dragon parked in a spine pass would seal a quarter off with a body the
  // zone's own flood-fill test can't see (it walks the static grid).
  it('leaves every dragon and the exit reachable from spawn with all bodies blocked', () => {
    const zone = ZONES.dragon_roost
    const npcs = npcsFromZone(zone.npcs)
    const grid = collisionWithMonsters(zone.collision, npcs.values())
    const seen = new Set<string>([`${zone.spawn.x},${zone.spawn.z}`])
    const queue = [[zone.spawn.x, zone.spawn.z]]
    while (queue.length) {
      const [x, z] = queue.pop()!
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx
        const nz = z + dz
        if (seen.has(`${nx},${nz}`) || grid[nz]?.[nx] !== '.') continue
        seen.add(`${nx},${nz}`)
        queue.push([nx, nz])
      }
    }
    for (const exit of zone.exits ?? []) expect(seen.has(`${exit.x},${exit.z}`), exit.id).toBe(true)
    // Each dragon is reachable up to the edge of its own body: some tile
    // adjacent to its footprint has to be standable, or it cannot be fought.
    for (const npc of zone.npcs) {
      const r = footprintRadius(npc.monsterId) + 1
      const ring: string[] = []
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) ring.push(`${npc.x + dx},${npc.z + dz}`)
      expect(ring.some((tile) => seen.has(tile)), npc.id).toBe(true)
    }
  })
})
