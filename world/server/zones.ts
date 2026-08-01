import { validateZone, type ZoneDef } from '../shared/zone'
import overworldZone from '../zones/overworld.json'
import grondarLairZone from '../zones/grondar_lair.json'
import cowPastureZone from '../zones/cow_pasture.json'
import fiendPitZone from '../zones/fiend_pit.json'
import dragonRoostZone from '../zones/dragon_roost.json'
import zarythThroneZone from '../zones/zaryth_throne.json'
import wildernessZone from '../zones/wilderness.json'

// Bundled zone definitions, baked into the Worker at build time. A D1 row in
// world_zone_defs of the same id overrides these at runtime (see zoneStore.ts);
// these remain the fallback and the seed for the editor's "duplicate" flow.
// JSON imports infer looser types than ZoneDef (array literals widen to number[]
// not tuples; a zone mixing tree + station objects widens `type` to string), so
// a direct `as ZoneDef` cast can stop structurally overlapping. validateZone
// below is the real guarantee — it runs on every zone at module load.
//
// The overworld is the one true zone for open play: every place lives in it as
// a district. (zones/lumbright.json survives only as the generator's inline-stamp
// source — it is not served.) Instanced boss lairs are the exception: they are
// keyed here by their BASE id and served under numbered room names
// (world/shared/instances.ts).
const asZone = (z: unknown): ZoneDef => z as ZoneDef

export const ZONES: Record<string, ZoneDef> = {
  overworld: asZone(overworldZone),
  grondar_lair: asZone(grondarLairZone),
  cow_pasture: asZone(cowPastureZone),
  fiend_pit: asZone(fiendPitZone),
  dragon_roost: asZone(dragonRoostZone),
  zaryth_throne: asZone(zarythThroneZone),
  wilderness: asZone(wildernessZone),
}

for (const zone of Object.values(ZONES)) {
  const result = validateZone(zone)
  if (!result.valid) throw new Error(`invalid zone '${zone.id}': ${result.errors.join('; ')}`)
}
