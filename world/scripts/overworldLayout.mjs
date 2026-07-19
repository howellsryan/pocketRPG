// Overworld layout projection (M3, docs/single-world-map-investigation.md). The
// idle game's src/data/world.json already fixes every place at an (x,y) on a
// 1640x879 map board and links them with a travel-edge graph. M3 reuses that as
// the physical layout of the open-world overworld — projecting board pixels to
// map tiles — so the 3D world's geography matches the map players already read,
// instead of inventing arbitrary coordinates. Pure + unit-tested; the generator
// (gen-overworld.mjs) turns the projection into a zone.

/** Projects world.json places to overworld tile coordinates. `scale` is tiles
 * per board pixel; `margin` pads the map edge (tiles). Returns the map dims and
 * a district per place (tile centre + tier), preserving relative board layout. */
export function projectPlaces(places, { scale = 0.32, margin = 20 } = {}) {
  const xs = places.map((p) => p.x)
  const ys = places.map((p) => p.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const maxX = Math.max(...xs)
  const maxY = Math.max(...ys)
  const proj = (v, min) => Math.round((v - min) * scale) + margin
  const districts = places.map((p) => ({
    id: p.id,
    tier: p.tier ?? 'village',
    // Board y increases downward, tile z increases "south" — same sense, so the
    // overworld isn't flipped relative to the idle map.
    x: proj(p.x, minX),
    z: proj(p.y, minY),
  }))
  const W = Math.round((maxX - minX) * scale) + margin * 2
  const H = Math.round((maxY - minY) * scale) + margin * 2
  return { W, H, districts }
}

/** Straight cosmetic dirt-road segments between the district centres of every
 * travel edge — small path rects stepped along the line (visual only; the
 * collision grid stays open wilderness). `edges` is world.json's [a,b,mins]. */
export function roadSegments(edges, districts, { step = 3, halfWidth = 1 } = {}) {
  const byId = new Map(districts.map((d) => [d.id, d]))
  const rects = []
  const size = halfWidth * 2 + 1
  for (const [a, b] of edges) {
    const da = byId.get(a)
    const db = byId.get(b)
    if (!da || !db) continue
    const dist = Math.max(Math.abs(db.x - da.x), Math.abs(db.z - da.z))
    const n = Math.max(1, Math.round(dist / step))
    for (let i = 0; i <= n; i++) {
      const t = i / n
      const cx = Math.round(da.x + (db.x - da.x) * t)
      const cz = Math.round(da.z + (db.z - da.z) * t)
      rects.push({ kind: 'path_dirt', x: cx - halfWidth, z: cz - halfWidth, w: size, h: size })
    }
  }
  return rects
}
