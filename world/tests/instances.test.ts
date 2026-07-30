// Instanced boss rooms: room-name ↔ zone-id resolution, and the assigner that
// picks which copy of a lair a player lands in.
import { describe, expect, it } from 'vitest'
import {
  baseRoomZone,
  chooseInstanceRoom,
  instanceDeathEjectTarget,
  instanceRoom,
  INSTANCED_ZONES,
  isInstancedRoom,
  isInstancedZone,
  MAX_INSTANCES,
  MAX_PLAYERS_PER_INSTANCE,
} from '../shared/instances'
import { validateZone, type ZoneDef } from '../shared/zone'
import { ZONES } from '../server/zones'
import grondarLair from '../zones/grondar_lair.json'

describe('instance room names', () => {
  it('resolves a numbered room back to the authored zone id', () => {
    expect(baseRoomZone(instanceRoom('grondar_lair', 3))).toBe('grondar_lair')
    expect(baseRoomZone('grondar_lair')).toBe('grondar_lair')
  })

  it('leaves a non-instanced room name untouched', () => {
    expect(baseRoomZone('overworld')).toBe('overworld')
    // A room that merely LOOKS suffixed must not be truncated into a zone that
    // exists — that would silently serve the wrong map.
    expect(baseRoomZone('overworld~2')).toBe('overworld~2')
  })

  it('treats both the bare id and a numbered room as instanced', () => {
    expect(isInstancedRoom('grondar_lair')).toBe(true)
    expect(isInstancedRoom(instanceRoom('grondar_lair', 7))).toBe(true)
    expect(isInstancedRoom('overworld')).toBe(false)
  })

  it('only instances zones that are actually registered and authored', () => {
    for (const zoneId of INSTANCED_ZONES) {
      expect(isInstancedZone(zoneId)).toBe(true)
      expect(ZONES[zoneId]).toBeTruthy()
    }
  })
})

/** Tiles reachable on foot from the zone's spawn. */
function walkableFrom(zone: ZoneDef): Set<string> {
  const seen = new Set<string>([`${zone.spawn.x},${zone.spawn.z}`])
  const queue = [[zone.spawn.x, zone.spawn.z]]
  while (queue.length) {
    const [x, z] = queue.pop()!
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx
      const nz = z + dz
      const key = `${nx},${nz}`
      if (seen.has(key) || zone.collision[nz]?.[nx] !== '.') continue
      seen.add(key)
      queue.push([nx, nz])
    }
  }
  return seen
}

// Every instanced room, not just Grondar's: a lair whose monsters or exit are
// walled off by a prop footprint is a room the party cannot play, and the
// generators place props by footprint maths that is easy to get wrong.
describe.each([...INSTANCED_ZONES])('instanced lair %s', (zoneId) => {
  const zone = ZONES[zoneId]

  it('is a valid zone', () => {
    expect(validateZone(zone)).toEqual({ valid: true })
  })

  it('has a hidden-marker way back to the overworld on a walkable tile', () => {
    const exit = zone.exits?.[0]
    expect(exit?.toZone).toBe('overworld')
    expect(exit?.hideMarker).toBe(true)
    expect(zone.collision[exit!.z][exit!.x]).toBe('.')
  })

  it('lets a player walk from the spawn to every monster and to the exit', () => {
    const seen = walkableFrom(zone)
    for (const npc of zone.npcs) expect(seen.has(`${npc.x},${npc.z}`), `${zoneId} npc ${npc.id}`).toBe(true)
    for (const exit of zone.exits ?? []) expect(seen.has(`${exit.x},${exit.z}`), `${zoneId} ${exit.id}`).toBe(true)
  })

  it('authors no zone-level deathRespawn', () => {
    // An instanced lair's death handling is server logic (WorldZone's
    // isInstancedRoom branch → instanceDeathEjectTarget), not zone-authored
    // config — a `deathRespawn` field here would be a second, conflicting
    // definition of where a death sends the player.
    expect(zone.deathRespawn).toBeUndefined()
  })

  it('ejects a death out through the lair\'s own exit, never back to its own spawn', () => {
    // Reversal of the room's old "dying respawns you in front of the boss"
    // behaviour: death now ends this player's part of the fight and hands
    // them a choice screen (return to a fresh instance, or the idle game),
    // so the eject target must be the way OUT, not another lap at the spawn.
    const target = instanceDeathEjectTarget(zone, { x: 999, z: 999 })
    expect(target.zone).toBe('overworld')
    expect(target).toEqual({ zone: zone.exits![0].toZone, x: zone.exits![0].toX, z: zone.exits![0].toZ })
  })

  it('puts a bank chest within reach of the tile you arrive and respawn on', () => {
    const chests = zone.objects.filter((o) => o.type === 'bank_chest')
    expect(chests, `${zoneId} bank chest`).toHaveLength(1)
    // chestAdjacent (WorldZone) is Chebyshev <= 1, so this is the difference
    // between banking where you land and walking to find the chest.
    const chest = chests[0]
    expect(Math.max(Math.abs(chest.x - zone.spawn.x), Math.abs(chest.z - zone.spawn.z))).toBeLessThanOrEqual(1)
    expect(zone.collision[chest.z][chest.x]).toBe('.')
  })

  it('gives every monster open ground to be fought on', () => {
    for (const npc of zone.npcs) {
      let open = 0
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (zone.collision[npc.z + dz]?.[npc.x + dx] === '.') open += 1
        }
      }
      expect(open, `${zoneId} npc ${npc.id}`).toBeGreaterThan(12)
    }
  })
})

describe('the three lairs added with the monster models', () => {
  it('fields eight bulls, six fiends, and four of each dragon', () => {
    const count = (zoneId: string, monsterId: string) =>
      ZONES[zoneId].npcs.filter((n) => n.monsterId === monsterId).length
    expect(count('cow_pasture', 'pasture_bull')).toBe(8)
    expect(count('fiend_pit', 'lesser_fiend')).toBe(6)
    expect(count('dragon_roost', 'green_dragon')).toBe(4)
    expect(count('dragon_roost', 'red_dragon')).toBe(4)
    expect(count('dragon_roost', 'black_dragon')).toBe(4)
  })

  it('keeps each dragon brood in its own quarter of the roost', () => {
    // Separate areas is the point of the room: no brood may sit inside another
    // brood's bounding box, or the walk between them stops being a decision.
    const zone = ZONES.dragon_roost
    const boxes = ['green_dragon', 'red_dragon', 'black_dragon'].map((id) => {
      const pts = zone.npcs.filter((n) => n.monsterId === id)
      return {
        id,
        x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)),
        z0: Math.min(...pts.map((p) => p.z)), z1: Math.max(...pts.map((p) => p.z)),
      }
    })
    for (const a of boxes) {
      for (const b of boxes) {
        if (a.id === b.id) continue
        const overlaps = a.x0 <= b.x1 && b.x0 <= a.x1 && a.z0 <= b.z1 && b.z0 <= a.z1
        expect(overlaps, `${a.id} vs ${b.id}`).toBe(false)
      }
    }
  })
})

describe("Grondar's lair zone", () => {
  it('is a valid zone', () => {
    expect(validateZone(grondarLair as unknown as ZoneDef)).toEqual({ valid: true })
  })

  it('holds Grondar and a way out', () => {
    const zone = grondarLair as unknown as ZoneDef
    expect(zone.npcs.map((n) => n.monsterId)).toContain('warlord_grondar')
    expect(zone.exits?.some((e) => e.toZone === 'overworld')).toBe(true)
  })

  it('has room for a full instance to stand around the boss', () => {
    const zone = grondarLair as unknown as ZoneDef
    const boss = zone.npcs.find((n) => n.monsterId === 'warlord_grondar')!
    let open = 0
    for (let dz = -3; dz <= 3; dz++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (zone.collision[boss.z + dz]?.[boss.x + dx] === '.') open += 1
      }
    }
    expect(open).toBeGreaterThan(MAX_PLAYERS_PER_INSTANCE * 2)
  })

  it('lets a player walk from the spawn to the boss and to the exit', () => {
    const zone = grondarLair as unknown as ZoneDef
    const seen = new Set<string>([`${zone.spawn.x},${zone.spawn.z}`])
    const queue = [[zone.spawn.x, zone.spawn.z]]
    while (queue.length) {
      const [x, z] = queue.pop()!
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx
        const nz = z + dz
        const key = `${nx},${nz}`
        if (seen.has(key) || zone.collision[nz]?.[nx] !== '.') continue
        seen.add(key)
        queue.push([nx, nz])
      }
    }
    for (const npc of zone.npcs) expect(seen.has(`${npc.x},${npc.z}`)).toBe(true)
    for (const exit of zone.exits ?? []) expect(seen.has(`${exit.x},${exit.z}`)).toBe(true)
  })
})

/** Occupancy reader over a fixed table. `probed` records which rooms were
 * actually asked, so a test can assert the assigner doesn't wake every instance
 * on every entry. */
function reader(counts: Record<string, number>, probed?: string[]) {
  return async (room: string) => {
    probed?.push(room)
    return counts[room] ?? 0
  }
}

describe('chooseInstanceRoom', () => {
  it('opens the first instance when nothing is running', async () => {
    expect(await chooseInstanceRoom('grondar_lair', reader({}))).toBe(instanceRoom('grondar_lair', 1))
  })

  it('fills the lowest-numbered room with space, so parties end up together', async () => {
    const counts = {
      [instanceRoom('grondar_lair', 1)]: MAX_PLAYERS_PER_INSTANCE,
      [instanceRoom('grondar_lair', 2)]: 3,
    }
    expect(await chooseInstanceRoom('grondar_lair', reader(counts))).toBe(instanceRoom('grondar_lair', 2))
  })

  it('stops probing as soon as it finds a room with space', async () => {
    const probed: string[] = []
    const counts = { [instanceRoom('grondar_lair', 1)]: MAX_PLAYERS_PER_INSTANCE }
    await chooseInstanceRoom('grondar_lair', reader(counts, probed))
    expect(probed).toEqual([instanceRoom('grondar_lair', 1), instanceRoom('grondar_lair', 2)])
  })

  it('routes around a room that reports itself full because it is unreachable', async () => {
    const counts = { [instanceRoom('grondar_lair', 1)]: MAX_PLAYERS_PER_INSTANCE }
    expect(await chooseInstanceRoom('grondar_lair', reader(counts))).toBe(instanceRoom('grondar_lair', 2))
  })

  it('falls back to the first room when every instance is full', async () => {
    const counts: Record<string, number> = {}
    for (let n = 1; n <= MAX_INSTANCES; n++) counts[instanceRoom('grondar_lair', n)] = MAX_PLAYERS_PER_INSTANCE
    expect(await chooseInstanceRoom('grondar_lair', reader(counts))).toBe(instanceRoom('grondar_lair', 1))
  })

  it('never hands out more than the cap in one room', async () => {
    const counts = { [instanceRoom('grondar_lair', 1)]: MAX_PLAYERS_PER_INSTANCE - 1 }
    expect(await chooseInstanceRoom('grondar_lair', reader(counts))).toBe(instanceRoom('grondar_lair', 1))
    counts[instanceRoom('grondar_lair', 1)] = MAX_PLAYERS_PER_INSTANCE
    expect(await chooseInstanceRoom('grondar_lair', reader(counts))).not.toBe(instanceRoom('grondar_lair', 1))
  })

  it('passes a non-instanced zone straight through', async () => {
    expect(await chooseInstanceRoom('overworld', reader({}))).toBe('overworld')
  })
})

describe('instanceDeathEjectTarget', () => {
  it('ejects through the zone\'s own exit when one is authored', () => {
    const zone = { exits: [{ toZone: 'overworld', toX: 280, toZ: 56 }] }
    expect(instanceDeathEjectTarget(zone, { x: 1, z: 1 })).toEqual({ zone: 'overworld', x: 280, z: 56 })
  })

  it('falls back to the overworld spawn if a lair is ever authored with no exit', () => {
    expect(instanceDeathEjectTarget({}, { x: 12, z: 34 })).toEqual({ zone: 'overworld', x: 12, z: 34 })
  })
})
