// Instanced boss rooms: room-name ↔ zone-id resolution, and the assigner that
// picks which copy of a lair a player lands in.
import { describe, expect, it } from 'vitest'
import {
  baseRoomZone,
  chooseInstanceRoom,
  instanceRoom,
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
    for (const zoneId of ['grondar_lair']) {
      expect(isInstancedZone(zoneId)).toBe(true)
      expect(ZONES[zoneId]).toBeTruthy()
    }
  })
})

describe("Grondar's lair zone", () => {
  it('is a valid zone', () => {
    expect(validateZone(grondarLair as unknown as ZoneDef)).toEqual({ valid: true })
  })

  it('holds Grondar, a way out, and a death trip out of the instance', () => {
    const zone = grondarLair as unknown as ZoneDef
    expect(zone.npcs.map((n) => n.monsterId)).toContain('warlord_grondar')
    expect(zone.exits?.some((e) => e.toZone === 'overworld')).toBe(true)
    expect(zone.deathRespawn?.zone).toBe('overworld')
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
