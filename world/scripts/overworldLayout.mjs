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

/** Continuous roads from semantic gateways to canonical neighboring districts.
 * The outside bend approaches a cardinal town street and never cuts
 * diagonally back through the protected authored region. */
export function connectionRoadSegments(connections, districts, bounds) {
  const byId=new Map(districts.map((d)=>[d.id,d])),rects=[]
  for(const c of connections) {
    const target=byId.get(c.to)
    if(!target)throw new Error('Unknown road destination '+c.to)
    const outside={
      x:c.outward.x<0?bounds.x0-2:c.outward.x>0?bounds.x1+1:c.x,
      z:c.outward.z<0?bounds.z0-2:c.outward.z>0?bounds.z1+1:c.z,
    }
    const bend=c.outward.x?{x:outside.x,z:target.z}:{x:target.x,z:outside.z}
    const path=[c,outside,bend,target]
    for(let i=1;i<path.length;i++) {
      let {x,z}=path[i-1];const to=path[i]
      if(x!==to.x&&z!==to.z)throw new Error('Road connection needs an orthogonal bend')
      for(;;) {
        // Only the first leg may occupy the region; global paint clips that leg
        // at the boundary and meets its already reserved regional road.
        if(i>1&&x>=bounds.x0&&x<bounds.x1&&z>=bounds.z0&&z<bounds.z1)throw new Error('Road to '+c.to+' re-enters the authored region')
        rects.push({kind:'path_dirt',x:x-1,z:z-1,w:3,h:3})
        if(x===to.x&&z===to.z)break
        x+=Math.sign(to.x-x);z+=Math.sign(to.z-z)
      }
    }
  }
  return rects
}
