import { validateZone, type ZoneDef } from '../shared/zone'
import pastureZone from '../zones/pasture.json'
import forestZone from '../zones/forest.json'

// Bundled zone definitions, baked into the Worker at build time. A D1 row in
// world_zone_defs of the same id overrides these at runtime (see zoneStore.ts);
// these remain the fallback and the seed for the editor's "duplicate" flow.
export const ZONES: Record<string, ZoneDef> = {
  pasture: pastureZone as ZoneDef,
  forest: forestZone as ZoneDef,
}

for (const zone of Object.values(ZONES)) {
  const result = validateZone(zone)
  if (!result.valid) throw new Error(`invalid zone '${zone.id}': ${result.errors.join('; ')}`)
}
