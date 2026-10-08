// Pure assembly of owned semantic stamps. Roads connect authored gateways,
// never reopen collision or replace paint inside a district.
const clone=v=>JSON.parse(JSON.stringify(v))
const key=(x,z)=>x+','+z
export function integrateRegions({width,height,entries,edges,extra={}}){
 const grid=Array.from({length:height},()=>Array(width).fill('.')),owner=Array.from({length:height},()=>Array(width).fill(null))
 /** @type {Required<Pick<import('../shared/zone').ZoneDef,'objects'|'npcs'|'props'|'ground'|'exits'|'landmarks'|'waymarks'>> & {ambient:Required<import('../shared/zone').ZoneAmbient>,collision:string[],regions:Array<{id:string,name:string,x:number,z:number,w:number,h:number}>}} */
 const result={collision:[],objects:[],npcs:[],props:[],ground:[],exits:[],landmarks:[],waymarks:[],ambient:{critters:[],smoke:[]},regions:[]}
 const byId=new Map(),exitIds=new Set()
 const inside=(x,z)=>x>=0&&z>=0&&x<width&&z<height
 for(const entry of entries){
  const {zone,origin}=entry,id=zone.id
  if(byId.has(id))throw Error('duplicate regional stamp '+id)
  if(!Number.isInteger(origin.x)||!Number.isInteger(origin.z)||origin.x<0||origin.z<0||origin.x+zone.width>width||origin.z+zone.height>height)throw Error('regional bounds '+id)
  for(let z=0;z<zone.height;z++)for(let x=0;x<zone.width;x++){
   const gx=x+origin.x,gz=z+origin.z
   if(owner[gz][gx])throw Error('regional overlap '+id+' with '+owner[gz][gx])
   owner[gz][gx]=id;grid[gz][gx]=zone.collision[z][x]
  }
  byId.set(id,entry)
  result.regions.push({id,name:zone.name,x:origin.x,z:origin.z,w:zone.width,h:zone.height})
  const translate=p=>({...clone(p),x:p.x+origin.x,z:p.z+origin.z})
  for(const layer of ['objects','npcs','props','ground','landmarks','waymarks'])for(const p of zone[layer]??[]){
   const next=translate(p)
   if(next.id)next.id=(id==='lumbright'?'lb':id)+'_'+next.id
   if(p.wander)next.wander=translate(p.wander)
   result[layer].push(next)
  }
  for(const p of zone.exits??[]){
   if(exitIds.has(p.id))throw Error('duplicate instance entrance '+p.id)
   exitIds.add(p.id);result.exits.push(translate(p))
  }
  for(const p of zone.ambient?.critters??[])result.ambient.critters.push(translate(p))
  for(const p of zone.ambient?.smoke??[])result.ambient.smoke.push(translate(p))
 }
 for(const layer of ['objects','npcs','props','ground','exits','landmarks','waymarks'])result[layer].push(...clone(extra[layer]??[]))
 for(const p of extra.blocked??[])for(let z=p.z;z<p.z+p.h;z++)for(let x=p.x;x<p.x+p.w;x++){
  if(!inside(x,z)||owner[z][x])throw Error('extra collision overlaps district or bounds')
  grid[z][x]='#'
 }
 for(const p of extra.ambient?.critters??[])result.ambient.critters.push(clone(p))
 for(const p of extra.ambient?.smoke??[])result.ambient.smoke.push(clone(p))
 const roads=new Set(),unsafeRoad=new Set()
 for(const n of result.npcs)if(n.wander)for(let z=n.wander.z;z<n.wander.z+n.wander.h;z++)for(let x=n.wander.x;x<n.wander.x+n.wander.w;x++)unsafeRoad.add(key(x,z))
 const endpoint=(entry,c)=>{
  let x=c.x+entry.origin.x,z=c.z+entry.origin.z
  const d=c.outward
  if(!d||Math.abs(d.x)+Math.abs(d.z)!==1)throw Error('invalid gateway normal '+entry.zone.id)
  while(inside(x,z)&&owner[z][x]===entry.zone.id){
   if(grid[z][x]!=='.')throw Error('blocked gateway '+entry.zone.id)
   x+=d.x;z+=d.z
  }
  if(!inside(x,z)||owner[z][x]||grid[z][x]!=='.')throw Error('blocked external gateway '+entry.zone.id)
  return {x,z}
 }
 const connect=(from,to)=>{
  const start=from.z*width+from.x,end=to.z*width+to.x,parents=new Int32Array(width*height);parents.fill(-2)
  const queue=new Int32Array(width*height);queue[0]=start;parents[start]=-1;let head=0,tail=1
  while(head<tail&&parents[end]===-2){
   const cur=queue[head++],x=cur%width,z=Math.floor(cur/width)
   for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
    const nx=x+dx,nz=z+dz,next=nz*width+nx
    if(!inside(nx,nz)||owner[nz][nx]||grid[nz][nx]!=='.'||unsafeRoad.has(key(nx,nz))||parents[next]!==-2)continue
    parents[next]=cur;queue[tail++]=next
   }
  }
  if(parents[end]===-2)throw Error('no external road between gateways')
  for(let cur=end;cur!==-1;cur=parents[cur]){
   const x=cur%width,z=Math.floor(cur/width)
   for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
    const nx=x+dx,nz=z+dz
    if(inside(nx,nz)&&!owner[nz][nx]&&grid[nz][nx]==='.'&&!unsafeRoad.has(key(nx,nz)))roads.add(key(nx,nz))
   }
  }
 }
 for(const [a,b] of edges){
  const aa=byId.get(a),bb=byId.get(b)
  if(!aa||!bb)throw Error('missing regional stamp for '+a+' / '+b)
  const ac=(aa.report.connections??[]).filter(c=>c.to===b),bc=(bb.report.connections??[]).filter(c=>c.to===a)
  if(!ac.length||!bc.length)throw Error('missing destination gateway '+a+' / '+b)
  for(const c of ac)connect(endpoint(aa,c),endpoint(bb,bc[0]))
  for(const c of bc.slice(1))connect(endpoint(aa,ac[0]),endpoint(bb,c))
 }
 for(let z=0;z<height;z++)for(let x=0;x<width;x++){
  if(!roads.has(key(x,z)))continue
  const start=x;while(x+1<width&&roads.has(key(x+1,z)))x++
  result.ground.push({kind:'path_dirt',x:start,z,w:x-start+1,h:1})
 }
 result.collision=grid.map(row=>row.join(''))
 return result
}
