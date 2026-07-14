import { validateZone, type ZoneDef } from '../shared/zone'
import pastureZone from '../zones/pasture.json'
import forestZone from '../zones/forest.json'
import lumbrightZone from '../zones/lumbright.json'
import varrickZone from '../zones/varrick.json'
import varrickDungeonZone from '../zones/varrick_dungeon.json'

// Bundled zone definitions, baked into the Worker at build time. A D1 row in
// world_zone_defs of the same id overrides these at runtime (see zoneStore.ts);
// these remain the fallback and the seed for the editor's "duplicate" flow.
// JSON imports infer looser types than ZoneDef (array literals widen to number[]
// not tuples; a zone mixing tree + station objects widens `type` to string), so
// a direct `as ZoneDef` cast can stop structurally overlapping. validateZone
// below is the real guarantee — it runs on every zone at module load.
const asZone = (z: unknown): ZoneDef => z as ZoneDef

export const ZONES: Record<string, ZoneDef> = {
  pasture: asZone(pastureZone),
  forest: asZone(forestZone),
  lumbright: asZone(lumbrightZone),
  varrick: asZone(varrickZone),
  varrick_dungeon: asZone(varrickDungeonZone),
}

for (const zone of Object.values(ZONES)) {
  const result = validateZone(zone)
  if (!result.valid) throw new Error(`invalid zone '${zone.id}': ${result.errors.join('; ')}`)
}
