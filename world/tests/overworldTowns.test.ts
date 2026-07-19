import { describe, expect, it } from 'vitest'
import overworldZone from '../zones/overworld.json'
import * as overworldLayout from '../scripts/overworldLayout.mjs'
import worldData from '../../src/data/world.json'
import type { ZoneDef, ZoneObjectDef } from '../shared/zone'

// The overworld dresses each of the 12 zoneless places into a town whose
// interactive facilities are driven by that place's world.json `facilities`.
// These are structural — derived from world.json, so adding a facility to a
// place forces its station to appear, and no station drifts from the data.

const world = worldData as unknown as { places: Record<string, { id: string; facilities?: string[] }> }
const places = Object.values(world.places)
const projectPlaces = overworldLayout.projectPlaces as (p: unknown[], o?: unknown) => { districts: { id: string; x: number; z: number }[] }
const districts = new Map(projectPlaces(places).districts.map((d) => [d.id, d]))
const ow = overworldZone as unknown as ZoneDef
const objectsById = new Map(ow.objects.map((o) => [o.id, o]))

// Facility → the interactive object types it must place. Lumbright is stamped
// inline (its own objects, prefixed lb_); Varrick is a portal (no inline
// facilities). sawmill/altar are landmark props, not engine object types.
const FACILITY_OBJECTS: Record<string, { suffix: string; type: ZoneObjectDef['type'] }[]> = {
  bank: [{ suffix: 'bank', type: 'bank_chest' }],
  furnace_anvil: [{ suffix: 'furnace', type: 'furnace' }, { suffix: 'anvil', type: 'anvil' }],
  stove: [{ suffix: 'range', type: 'range' }],
}
const dressed = places.filter((p) => p.id !== 'lumbright' && p.id !== 'varrick')

describe('overworld town facilities', () => {
  it('places every interactive facility from world.json as its station object, near its district', () => {
    for (const place of dressed) {
      const d = districts.get(place.id)!
      for (const fac of place.facilities ?? []) {
        for (const { suffix, type } of FACILITY_OBJECTS[fac] ?? []) {
          const obj = objectsById.get(`${place.id}_${suffix}`)
          expect(obj, `${place.id} ${fac} → ${suffix}`).toBeTruthy()
          expect(obj!.type).toBe(type)
          const cheb = Math.max(Math.abs(obj!.x - d.x), Math.abs(obj!.z - d.z))
          expect(cheb, `${place.id} ${suffix} distance from centre`).toBeLessThanOrEqual(10)
        }
      }
    }
  })

  it('gives no facility station to a place that lacks that facility', () => {
    for (const place of dressed) {
      const facs = new Set(place.facilities ?? [])
      if (!facs.has('bank')) expect(objectsById.has(`${place.id}_bank`)).toBe(false)
      if (!facs.has('stove')) expect(objectsById.has(`${place.id}_range`)).toBe(false)
      if (!facs.has('furnace_anvil')) expect(objectsById.has(`${place.id}_furnace`)).toBe(false)
    }
  })

  it('lands every facility station on walkable ground', () => {
    for (const o of ow.objects) {
      expect(ow.collision[o.z]?.[o.x], `${o.id} at (${o.x},${o.z})`).toBe('.')
    }
  })
})
