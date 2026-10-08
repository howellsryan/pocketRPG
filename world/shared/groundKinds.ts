// Ground-paint art direction (docs/world-design-review-2026-07.md §4.1). One
// registry of terrain "kinds" a zone can paint onto its ground — dirt paths,
// cobbled streets, plazas, water, farm soil, interior floors — the migla-proven
// layer that turns a flat green field into a place with roads that lead
// somewhere. Pure decoration: collision stays in the ASCII grid, the server
// stays flat-tile authoritative. Both the renderer and the editor import this,
// so adding a kind here surfaces it everywhere.
//
// Colours are warm and saturated (no pure grey/black), mirroring the biome
// language in src/data/biomes3d.json and the world-design rule's palette bar.

export type GroundKind = {
  /** Stable id stored in zone JSON. */
  id: string
  /** Editor label. */
  label: string
  /** Base albedo, painted over the zone's grass/terrain. Hex string. */
  color: string
  /** Water kinds also get a translucent animated surface plane; the painted
   * colour is the riverbed beneath it. */
  water?: boolean
  /** Colour of that surface plane. Defaults to river blue. */
  surface?: string
  /** Surface plane lights itself — molten rock, not water reflecting a sky. */
  molten?: boolean
}

export const GROUND_KINDS: GroundKind[] = [
  { id: 'path_dirt', label: 'Dirt Path', color: '#8a6f4a' },
  { id: 'path_cobble', label: 'Cobble Road', color: '#8f8a80' },
  { id: 'plaza', label: 'Plaza / Paving', color: '#a89e88' },
  { id: 'sand', label: 'Sand', color: '#cdb888' },
  { id: 'farm', label: 'Farm Soil', color: '#6b4f34' },
  { id: 'marsh', label: 'Marsh / Moss', color: '#46594b' },
  { id: 'floor_plank', label: 'Wood Floor', color: '#7a5a38' },
  { id: 'floor_stone', label: 'Stone Floor', color: '#8b8578' },
  { id: 'floor_tile', label: 'Tiled Floor', color: '#9a9488' },
  { id: 'ash', label: 'Ash / Scorched', color: '#4a3b33' },
  { id: 'water', label: 'Water', color: '#2f5a74', water: true },
  // Lava is a water kind: it wants the same animated surface plane, just poured
  // in a colour that reads as molten rather than wet.
  { id: 'lava', label: 'Lava', color: '#8f3312', water: true, surface: '#d2571d', molten: true },
]

const KIND_BY_ID = new Map(GROUND_KINDS.map((k) => [k.id, k]))

export function groundKind(id: string | undefined): GroundKind | undefined {
  return id == null ? undefined : KIND_BY_ID.get(id)
}

export function isGroundKind(id: string | undefined): boolean {
  return id != null && KIND_BY_ID.has(id)
}

/** A painted rectangle of one kind. Rects overlap freely; the LAST region
 * covering a tile wins (migla's rule — later brush strokes paint over earlier
 * ones). Coordinates are tile space; the rect covers [x, x+w) × [z, z+h). */
export type ZoneGroundRegion = { kind: string; x: number; z: number; w: number; h: number }

/** Resolves painted regions to a per-tile kind-id grid (row-major, x fastest;
 * length width*height). Empty string = unpainted (base grass/terrain shows).
 * Pure — the renderer and any test share this exact resolution. */
export function groundKindGrid(width: number, height: number, ground: ZoneGroundRegion[] | undefined): string[] {
  const grid = new Array<string>(width * height).fill('')
  if (!ground) return grid
  for (const r of ground) {
    if (!isGroundKind(r.kind)) continue
    const x0 = Math.max(0, Math.floor(r.x))
    const z0 = Math.max(0, Math.floor(r.z))
    const x1 = Math.min(width, Math.floor(r.x + r.w))
    const z1 = Math.min(height, Math.floor(r.z + r.h))
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) grid[z * width + x] = r.kind
  }
  return grid
}
