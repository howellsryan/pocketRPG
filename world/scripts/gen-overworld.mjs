#!/usr/bin/env node
// Generate the connected world from semantic regions, never from generic town rings.
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {projectPlaces} from './overworldLayout.mjs'
import {integrateRegions} from '../authoring/integrate.mjs'
const worldDir=fileURLToPath(new URL('..',import.meta.url))
const read=file=>JSON.parse(fs.readFileSync(path.join(worldDir,file),'utf8'))
const world=JSON.parse(fs.readFileSync(path.join(worldDir,'../src/data/world.json'),'utf8'))
const {W,H,districts}=projectPlaces(Object.values(world.places),{scale:.32,margin:20})
const placements=read('authoring/placements.json').regions
const entries=Object.entries(placements).map(([id,p])=>{
 const zone=read('zones/'+id+'.json')
 if(zone.width!==p.w||zone.height!==p.h)throw Error('Region size differs from placement '+id)
 const anchor=districts.find(d=>d.id===id)
 if(p.x+zone.spawn.x!==anchor.x||p.z+zone.spawn.z!==anchor.z)throw Error('Destination anchor moved '+id)
 return {origin:{x:p.x,z:p.z},zone,report:read('authoring/reports/'+id+'.json')}
})
if(Object.keys(world.places).some(id=>!placements[id]))throw Error('Missing canonical town source')
const layers=integrateRegions({width:W,height:H,entries,edges:world.edges,extra:read('authoring/wilderness.json')})
const spawn=districts.find(d=>d.id==='lumbright')
const zone={id:'overworld',name:'Eldermoor Overworld',width:W,height:H,spawn:{x:spawn.x,z:spawn.z},...layers,
 landmarks:districts.map(d=>({id:d.id,label:world.places[d.id].name,x:d.x,z:d.z})),
  aoiRadius: 40,
  palette: { walkableA: '#8a9a55', walkableB: '#7e8e4c', blockedA: '#9a9186', blockedB: '#89806f' },
  terrain: {
    relief: 0.6,
    procedural: { seed: 7000, frequency: 0.04 },
    material: 'meadow',
    scatter: [
      { model: 'flowers', density: 0.8, scaleRange: [0.8, 1.1] },
      { model: 'bush', density: 0.6, scaleRange: [0.7, 1] },
    ],
  },
}


const walk=(x,z)=>zone.collision[z]?.[x]==='.'
const seen=new Set(),reachable=new Set([spawn.x+','+spawn.z]),queue=[spawn]
for(let i=0;i<queue.length;i++)for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]]){
 const x=queue[i].x+dx,z=queue[i].z+dz,k=x+','+z
 if(walk(x,z)&&!reachable.has(k)){reachable.add(k);queue.push({x,z})}
}
for(const p of [...zone.objects,...zone.npcs,...zone.exits,...zone.landmarks,...zone.waymarks]){
 if(seen.has(p.id))throw Error('Duplicate world identity '+p.id);seen.add(p.id)
 if(!walk(p.x,p.z)||!reachable.has(p.x+','+p.z))throw Error('Unreachable world identity '+p.id)
}
for(const n of zone.npcs)if(n.wander)for(let z=n.wander.z;z<n.wander.z+n.wander.h;z++)for(let x=n.wander.x;x<n.wander.x+n.wander.w;x++)if(!walk(x,z))throw Error('Blocked wilderness wander '+n.id)
const output=JSON.stringify(zone,null,1)+'\n',file=path.join(worldDir,'zones/overworld.json')
if(process.argv.includes('--check')){if(fs.readFileSync(file,'utf8')!==output)throw Error('Generated overworld drift; run npm run author:build')}
else fs.writeFileSync(file,output)
console.log('OVERWORLD_SUMMARY '+JSON.stringify({width:W,height:H,regions:entries.length,props:zone.props.length,objects:zone.objects.length,npcs:zone.npcs.length,reachable:reachable.size}))
