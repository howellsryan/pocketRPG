// Pure semantic authoring: no filesystem, renderer, random global state or server I/O.
// CLI and tests supply canonical data and measured owned-asset bounds.
const DIRECTIONS = [[1,0],[-1,0],[0,1],[0,-1]]
const SPATIAL_SKILLS = new Set(['mining', 'woodcutting', 'fishing'])
const PORTABLE_SKILLS = new Set(['construction','cooking','crafting','firemaking','fletching','herblore','magic','prayer','smithing','runecrafting'])
const DEFERRED_SYSTEMS = new Set(['agility','farming','hunter','quest','thieving','slayer','dungeoneering'])
const FACILITIES = { bank: ['bank_chest'], stove: ['range'], furnace_anvil: ['furnace','anvil'] }
const GROUNDS = new Set(['path_dirt','path_cobble','plaza','sand','farm','floor_plank','floor_stone','floor_tile','ash','water','lava'])
const clone = (v) => JSON.parse(JSON.stringify(v))
const fail = (message) => { throw new Error('Authoring: ' + message) }
const integer = (v) => Number.isInteger(v)
const finite = (v) => typeof v === 'number' && Number.isFinite(v)
const key = (x,z) => x + ',' + z

export function deriveContract(place, context) {
  const location = context.world.places[place]
  const activities = context.activities[place]
  if (!location || !activities) fail('unknown canonical place ' + place)
  const resources = [], monsters = [], deferred = [], portable = []
  for (const a of activities) {
    if (a.kind === 'combat') monsters.push('combat:' + a.ref)
    else if (a.kind === 'gather') resources.push('gather:' + a.ref)
    else if (a.kind === 'skill') {
      const skill=a.ref.split(':')[0]
      if(SPATIAL_SKILLS.has(skill))resources.push('skill:' + a.ref)
      else if(PORTABLE_SKILLS.has(skill))portable.push('skill:' + a.ref)
      else if(DEFERRED_SYSTEMS.has(skill))deferred.push('skill:' + a.ref)
      else fail('unclassified canonical skill '+a.ref+' requires an explicit spatial or portable policy')
    } else if(a.kind==='bank') {
      if(!(location.facilities??[]).includes('bank'))fail('canonical bank activity has no bank facility')
    } else if(DEFERRED_SYSTEMS.has(a.kind))deferred.push(a.kind+':'+a.ref)
    else fail('unclassified canonical activity '+a.kind+':'+a.ref+' requires an explicit adapter policy')
  }
  return {
    resources: [...new Set(resources)].sort(),
    monsters: [...new Set(monsters)].sort(),
    facilities: (location.facilities ?? []).map((f) => 'facility:' + f).sort(),
    deferred: [...new Set(deferred)].sort(), portable: [...new Set(portable)].sort()
  }
}

/** Rotate integer tile centres clockwise. Rectangles rotate their tile centres,
 * not their far edges, so a 1x1 tile remains on the correct tile. */
export function transformPoint(p, origin, turns = 0) {
  const t = ((turns % 4) + 4) % 4
  const [x,z] = t === 0 ? [p.x,p.z] : t === 1 ? [p.z,-p.x] : t === 2 ? [-p.x,-p.z] : [-p.z,p.x]
  return { ...p, x: origin.x + x, z: origin.z + z }
}
function transformRect(r, origin, turns) {
  const corners = [[r.x,r.z],[r.x+r.w-1,r.z],[r.x,r.z+r.h-1],[r.x+r.w-1,r.z+r.h-1]]
    .map(([x,z]) => transformPoint({x,z}, origin, turns))
  const xs = corners.map((p) => p.x), zs = corners.map((p) => p.z)
  return { ...r, x: Math.min(...xs), z: Math.min(...zs), w: Math.max(...xs)-Math.min(...xs)+1, h: Math.max(...zs)-Math.min(...zs)+1 }
}

export function compileRegion(input, context) {
  const source = clone(input)
  if (source.schemaVersion !== 1) fail('schemaVersion must be 1')
  const {width,height,spawn} = source
  if (![width,height].every((n) => integer(n) && n >= 8 && n <= 256)) fail('dimensions must be integers in 8..256')
  if (!source.id || !source.name || !integer(source.seed)) fail('id, name and integer seed are required')
  const inBounds = (x,z) => finite(x) && finite(z) && x >= 0 && z >= 0 && x < width && z < height
  const tile = (p,label) => { if (!integer(p.x) || !integer(p.z) || !inBounds(p.x,p.z)) fail(label + ' must be an in-bounds integer tile') }
  const rect = (r,label) => {
    if (![r.x,r.z,r.w,r.h].every(integer) || r.w <= 0 || r.h <= 0 || !inBounds(r.x,r.z) || r.x+r.w > width || r.z+r.h > height) fail(label + ' rectangle out of bounds')
  }
  tile(spawn,'spawn')
  const contract = deriveContract(source.place,context)
  const expected = new Set([...contract.resources,...contract.monsters,...contract.facilities])
  const bound = new Set()
  const bind = (ref) => { if (!expected.has(ref)) fail('unexpected content ' + ref); bound.add(ref) }
  const grid = Array.from({length:height},()=>Array(width).fill('.'))
  const routeTiles = new Map()
  const ids = new Set()
  const unique = (id) => { if (!id || ids.has(id)) fail('missing or duplicate id ' + id); ids.add(id) }
  const props = [], objects = [], npcs = [], exits = clone(source.exits ?? []), ground = [], points = clone(source.points ?? [])
  const ambient = clone(source.ambient ?? {critters:[],smoke:[]})
  ambient.critters ??= []; ambient.smoke ??= []
  const resources = clone(source.resources ?? []), encounters = clone(source.encounters ?? [])
  const blocked = [], surfaceTiles = new Set()
  const addGround = (r) => { rect(r,'ground'); if (!GROUNDS.has(r.kind)) fail('unknown ground kind ' + r.kind); ground.push({kind:r.kind,x:r.x,z:r.z,w:r.w,h:r.h}) }
  for (const s of source.surfaces ?? []) { addGround(s); if (s.blocked) blocked.push(s) }
  // Expand complete prefab layers before reserving routes. Semantic refs remain
  // canonical; only instance identities are namespaced.
  for (const lot of source.lots ?? []) {
    unique(lot.id)
    tile(lot,'lot ' + lot.id)
    if (!integer(lot.turns ?? 0)) fail('prefab turns must be quarter turns')
    const prefab = context.prefabs[lot.prefab]
    if (!prefab) fail('unknown prefab ' + lot.prefab)
    const turn = lot.turns ?? 0
    const pt = (p) => transformPoint(p,lot,turn)
    const ns = (p) => ({...pt(p),id:lot.id+':'+p.id})
    for (const p of prefab.points ?? []) points.push(ns(p))
    for (const p of prefab.props ?? []) props.push({...pt(p),rot:(p.rot??0)+turn*Math.PI/2})
    for (const r of prefab.ground ?? []) addGround(transformRect(r,lot,turn))
    for (const r of prefab.blocked ?? []) blocked.push(transformRect(r,lot,turn))
    for (const o of prefab.resources ?? []) resources.push(ns(o))
    for (const e of prefab.exits ?? []) exits.push(ns(e))
    for (const e of prefab.encounters ?? []) encounters.push({...e,id:lot.id+':'+e.id,wander:transformRect(e.wander,lot,turn),spawns:e.spawns.map(pt)})
    for (const c of prefab.ambient?.critters ?? []) ambient.critters.push(transformRect(c,lot,turn))
    for (const s of prefab.ambient?.smoke ?? []) ambient.smoke.push(pt(s))
  }
  const pointMap = new Map()
  for (const p of points) { tile(p,'point '+p.id); unique('point:'+p.id); pointMap.set(p.id,p) }
  const getPoint = (id) => { const p = pointMap.get(id); if (!p) fail('unknown route point '+id); return p }
  const paintRoad = (x,z,w,kind,id) => {
    const half = (w-1)/2
    const r = {kind,x:x-half,z:z-half,w,h:w}
    addGround(r)
    for (let dz=-half;dz<=half;dz++) for (let dx=-half;dx<=half;dx++) routeTiles.set(key(x+dx,z+dz),id)
  }
  for (const route of source.routes ?? []) {
    unique(route.id)
    if (!integer(route.width) || route.width < 1 || route.width > 7 || route.width%2 !== 1) fail('route width must be odd, in 1..7')
    const path = [getPoint(route.from),...(route.via??[]),getPoint(route.to)]
    for (const p of path) tile(p,'route '+route.id)
    for (let i=1;i<path.length;i++) {
      let {x,z}=path[i-1]; const to=path[i]
      if (x !== to.x && z !== to.z) fail('route '+route.id+' needs explicit orthogonal waypoints')
      paintRoad(x,z,route.width,route.kind,route.id)
      while (x!==to.x || z!==to.z) {
        x += Math.sign(to.x-x); z += Math.sign(to.z-z)
        paintRoad(x,z,route.width,route.kind,route.id)
      }
    }
  }
  for (const r of blocked) {
    rect(r,'blocked')
    for(let z=r.z;z<r.z+r.h;z++) for(let x=r.x;x<r.x+r.w;x++) {
      if(routeTiles.has(key(x,z))) fail('blocked surface overlaps route '+routeTiles.get(key(x,z)))
      grid[z][x]='#'; surfaceTiles.add(key(x,z))
    }
  }
  const occupied = new Set()
  const addObject = (o) => { tile(o,'resource '+o.id); unique(o.id); if(occupied.has(key(o.x,o.z))) fail('overlapping resource '+o.id); occupied.add(key(o.x,o.z)); objects.push(o) }
  for(const r of resources) {
    bind(r.ref)
    const parts=r.ref.split(':')
    if(parts[0]==='facility') {
      const types=FACILITIES[parts[1]]
      if(!types) fail('unsupported facility '+r.ref)
      if(types.length!==1) fail('multi-station facility requires explicit component positions: '+r.ref)
      addObject({id:r.id,type:types[0],x:r.x,z:r.z})
    } else if(parts[0]==='skill') {
      const [skill,actionId]=parts.slice(1)
      const action=context.skills[skill]?.actions?.find((a)=>a.id===actionId)
      if(!action?.product) fail('unsupported resource '+r.ref)
      const mapping={mining:['rock','rock'],woodcutting:['tree','tree'],fishing:['fishing_spot','fishing']}[skill]
      if(!mapping) fail('unsupported resource adapter '+r.ref)
      addObject({id:r.id,type:mapping[0],[mapping[1]]:actionId,x:r.x,z:r.z})
    } else if(parts[0]==='gather') {
      const task=context.gatherTasks.find((t)=>t.id===parts[1])
      if(!task?.product || task.materials || task.gpCost || task.requiresItem || task.oneShot || task.isClue) fail('unsupported gather task '+r.ref)
      addObject({id:r.id,type:'gather_site',gather:task.id,x:r.x,z:r.z})
    } else fail('unsupported spatial ref '+r.ref)
  }
  for(const e of encounters) {
    bind(e.ref)
    if(!e.ref.startsWith('combat:')) fail('encounter requires a combat ref')
    const monsterId=e.ref.slice(7)
    if(!context.monsters[monsterId]) fail('unknown monster '+monsterId)
    if(!context.assets.monsters.includes(monsterId)) fail(monsterId+' has no supported visual (fallback forbidden)')
    rect(e.wander,'wander '+e.id); unique(e.id)
    for(let z=e.wander.z;z<e.wander.z+e.wander.h;z++) for(let x=e.wander.x;x<e.wander.x+e.wander.w;x++) {
      if(routeTiles.has(key(x,z))) fail('encounter '+e.id+' overlaps safe route '+routeTiles.get(key(x,z)))
    }
    if(!e.spawns?.length) fail('encounter '+e.id+' needs spawns')
    for(const [i,p] of e.spawns.entries()) {
      tile(p,'npc '+e.id)
      if(p.x<e.wander.x || p.z<e.wander.z || p.x>=e.wander.x+e.wander.w || p.z>=e.wander.z+e.wander.h) fail('npc '+e.id+' outside wander area')
      const id=e.id+':'+i; unique(id)
      npcs.push({id,monsterId,x:p.x,z:p.z,wander:clone(e.wander)})
    }
  }
  // Collision uses the full asymmetric, rotated bounds of the shipped asset.
  // Do not punch holes through mesh footprints to make paths pass.
  const footprints=[]
  const reserveProp=(p,optional=false)=>{
    const a=context.assets.props[p.model]
    if(!a) fail('missing asset '+p.model)
    if(!inBounds(p.x,p.z) || !finite(p.rot??0) || !finite(p.scale??1) || (p.scale??1)<=0) fail('invalid prop '+p.model)
    const scale=a.baseScale*(p.scale??1), yaw=p.rot??0, c=Math.cos(yaw),s=Math.sin(yaw)
    const corners=[[a.min[0],a.min[2]],[a.min[0],a.max[2]],[a.max[0],a.min[2]],[a.max[0],a.max[2]]]
      .map(([x,z])=>[p.x+.5+(x*c+z*s)*scale,p.z+.5+(-x*s+z*c)*scale])
    const xs=corners.map((v)=>v[0]),zs=corners.map((v)=>v[1])
    const box={model:p.model,x0:Math.min(...xs),z0:Math.min(...zs),x1:Math.max(...xs),z1:Math.max(...zs)}
    // Occupy every tile touched by the actual mesh. Centre-only tests miss
    // thin edge-anchored fences and let players walk straight through them.
    const x0=Math.floor(box.x0+1e-6),z0=Math.floor(box.z0+1e-6),x1=Math.ceil(box.x1-1e-6)-1,z1=Math.ceil(box.z1-1e-6)-1
    let reason=''
    if(box.x0<0 || box.z0<0 || box.x1>width || box.z1>height) reason='out of bounds'
    if(footprints.some((b)=>box.x0<b.x1-.03 && box.x1>b.x0+.03 && box.z0<b.z1-.03 && box.z1>b.z0+.03)) reason='mesh overlap'
    for(let z=z0;z<=z1;z++) for(let x=x0;x<=x1;x++) {
      if(routeTiles.has(key(x,z))) reason='overlap with route '+routeTiles.get(key(x,z))
      if(occupied.has(key(x,z))) reason='overlap with resource'
      if(surfaceTiles.has(key(x,z))) reason='overlap with blocked surface'
    }
    if(reason) { if(optional) return false; fail('prop '+p.model+' '+reason+' at '+p.x+','+p.z) }
    footprints.push(box); props.push(p)
    // Low flora/crops have visual extents but do not stop movement. Explicit
    // blocking metadata belongs to the asset, never a per-agent escape hatch.
    if(a.blocking!==false) for(let z=z0;z<=z1;z++) for(let x=x0;x<=x1;x++) if(grid[z]?.[x]!=null) grid[z][x]='#'
    return true
  }
  const prefabProps=props.splice(0)
  for(const p of [...prefabProps,...(source.dressing??[])]) reserveProp(p)
  let state=source.seed>>>0
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296}
  for(const grove of source.groves??[]) {
    unique(grove.id); rect(grove,'grove '+grove.id)
    if(!integer(grove.count)||grove.count<0 || !grove.models?.length) fail('invalid grove '+grove.id)
    for(const model of grove.models) if(!context.assets.props[model]) fail('missing asset '+model)
    let placed=0
    for(let attempt=0;attempt<grove.count*100 && placed<grove.count;attempt++) {
      const p={model:grove.models[Math.floor(random()*grove.models.length)],x:grove.x+Math.floor(random()*grove.w),z:grove.z+Math.floor(random()*grove.h),rot:random()*Math.PI*2,scale:grove.scaleRange[0]+random()*(grove.scaleRange[1]-grove.scaleRange[0])}
      // Keep encounters and semantic point approaches clear of scatter.
      if(points.some((q)=>Math.abs(q.x-p.x)<=2&&Math.abs(q.z-p.z)<=2)) continue
      if(encounters.some((e)=>p.x>=e.wander.x-1&&p.z>=e.wander.z-1&&p.x<e.wander.x+e.wander.w+1&&p.z<e.wander.z+e.wander.h+1)) continue
      if(reserveProp(p,true)) placed++
    }
    if(placed<grove.count) fail('grove '+grove.id+' cannot fit requested density ('+placed+'/'+grove.count+')')
  }
  const walk=(x,z)=>grid[z]?.[x]==='.'
  if(!walk(spawn.x,spawn.z)) fail('spawn blocked')
  const reach=new Set([key(spawn.x,spawn.z)]),queue=[[spawn.x,spawn.z]]
  for(let i=0;i<queue.length;i++) {
    const [x,z]=queue[i]
    for(const [dx,dz] of DIRECTIONS) {const nx=x+dx,nz=z+dz,k=key(nx,nz);if(walk(nx,nz)&&!reach.has(k)){reach.add(k);queue.push([nx,nz])}}
  }
  const accessible=(p,label)=>{if(!walk(p.x,p.z))fail(label+' blocked');if(!reach.has(key(p.x,p.z)))fail(label+' unreachable from spawn')}
  for(const p of points) accessible(p,'point '+p.id)
  for(const o of objects) {
    accessible(o,'resource '+o.id)
    if(!DIRECTIONS.some(([dx,dz])=>reach.has(key(o.x+dx,o.z+dz)))) fail('resource '+o.id+' has no usable approach')
  }
  for(const n of npcs) accessible(n,'npc '+n.id)
  for(const e of exits) {tile(e,'exit '+e.id);unique(e.id);accessible(e,'exit '+e.id)}
  for(const e of encounters) for(let z=e.wander.z;z<e.wander.z+e.wander.h;z++)for(let x=e.wander.x;x<e.wander.x+e.wander.w;x++)accessible({x,z},'wander '+e.id)
  for(const c of ambient.critters) {
    rect(c,'ambient');if(!context.assets.ambient.includes(c.model))fail('missing ambient asset '+c.model)
    if(!integer(c.count)||c.count<1||c.count>24) fail('ambient count must be in 1..24')
    const open=[];for(let z=c.z;z<c.z+c.h;z++)for(let x=c.x;x<c.x+c.w;x++)if(walk(x,z)&&reach.has(key(x,z)))open.push([x,z])
    if(open.length<c.count*3)fail('ambient group '+c.model+' lacks usable wander space')
    if(open.length!==c.w*c.h)fail('ambient group '+c.model+' contains blocked or unreachable tiles; straight-line wander must stay clear')
  }
  for(const s of ambient.smoke) {if(!inBounds(s.x,s.z)||!finite(s.y??0))fail('invalid smoke position')}
  const connections=[]
  if(source.connections) {
    if(!Array.isArray(source.connections)||!context.world.edges)fail('road connections require canonical travel edges')
    const neighbors=new Set(context.world.edges.flatMap(([a,b])=>a===source.place?[b]:b===source.place?[a]:[]))
    const connected=new Set(),pairs=new Set()
    for(const c of source.connections) {
      const p=getPoint(c.point),pair=c.point+':'+c.to
      if(!neighbors.has(c.to)||pairs.has(pair))fail('invalid or duplicate road connection '+pair)
      const normals=[]
      if(p.x===1)normals.push({x:-1,z:0})
      if(p.x===width-2)normals.push({x:1,z:0})
      if(p.z===1)normals.push({x:0,z:-1})
      if(p.z===height-2)normals.push({x:0,z:1})
      if(p.role!=='gateway'||normals.length!==1||!routeTiles.has(key(p.x,p.z)))fail('connection '+pair+' requires a reserved gateway one tile inside an edge')
      const outward=normals[0],boundary={x:p.x+outward.x,z:p.z+outward.z}
      accessible(boundary,'connection boundary '+pair)
      if(!routeTiles.has(key(boundary.x,boundary.z)))fail('connection '+pair+' has no road at the boundary')
      connections.push({...c,x:p.x,z:p.z,outward});pairs.add(pair);connected.add(c.to)
    }
    const missingNeighbors=[...neighbors].filter((id)=>!connected.has(id))
    if(missingNeighbors.length)fail('missing canonical road connections: '+missingNeighbors.join(', '))
  }
  const missing=[...expected].filter((ref)=>!bound.has(ref)).sort()
  if(missing.length) fail('missing canonical content: '+missing.join(', '))
  const budgets=source.budgets
  if(!budgets || !['props','npcs','ambient','maxPropsPer8x8'].every((k)=>integer(budgets[k])&&budgets[k]>=0)) fail('explicit integer budgets are required')
  if(props.length>budgets.props || npcs.length>budgets.npcs || ambient.critters.reduce((n,c)=>n+c.count,0)>budgets.ambient)fail('entity budget exceeded')
  const cells=new Map()
  for(const p of props){const k=key(Math.floor(p.x/8),Math.floor(p.z/8));cells.set(k,(cells.get(k)??0)+1)}
  if([...cells.values()].some((n)=>n>budgets.maxPropsPer8x8))fail('local scenery density budget exceeded')
  if(!source.reviewViews?.length)fail('reviewViews are required; structural checks do not certify visuals')
  const viewIds=new Set(), reviewedContent=new Set()
  let overview=false, gameplay=false
  for(const view of source.reviewViews) {
    if(!/^[a-z][a-z0-9_]*$/.test(view.id) || viewIds.has(view.id) || !pointMap.has(view.target))fail('invalid or duplicate review view '+view.id)
    viewIds.add(view.id)
    if(!['overview','gameplay'].includes(view.mode))fail('invalid review mode '+view.id)
    for(const k of ['yaw','pitch','zoom','distance'])if(view[k]!=null&&!finite(view[k]))fail('invalid review camera '+view.id)
    overview ||= view.mode==='overview'; gameplay ||= view.mode==='gameplay'
    for(const ref of view.covers??[]) {
      if(!expected.has(ref))fail('unknown reviewed content '+ref)
      if(view.mode!=='gameplay')fail('content requires a close gameplay review '+ref)
      reviewedContent.add(ref)
    }
  }
  if(!overview||!gameplay)fail('overview and close gameplay review views are required')
  const uncovered=[...expected].filter((ref)=>!reviewedContent.has(ref)).sort()
  if(uncovered.length)fail('missing close review coverage: '+uncovered.join(', '))
  const zone={id:source.id,name:source.name,width,height,spawn,collision:grid.map((r)=>r.join('')),objects,npcs,exits,props,ground,ambient}
  for(const k of ['palette','ambience','terrain'])if(source[k])zone[k]=source[k]
  return {zone,report:{
    schemaVersion:1,region:source.id,place:source.place,seed:source.seed,
    parity:{scope:'gathering, combat identities and facilities',missing:[],unexpected:[]},contract,points,footprints,connections,
    reviewViews:source.reviewViews.map((v)=>({...v,x:pointMap.get(v.target).x,z:pointMap.get(v.target).z})),
    counts:{props:props.length,npcs:npcs.length,objects:objects.length,ambient:ambient.critters.reduce((n,c)=>n+c.count,0),reachableTiles:reach.size},
    budgets,visualApproval:'pending'
  }}
}
