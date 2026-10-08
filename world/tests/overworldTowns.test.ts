import {describe,expect,it} from 'vitest'
import world from '../../src/data/world.json'
import overworld from '../zones/overworld.json'
import placements from '../authoring/placements.json'
import {findJourneyPath} from '../server/pathfind'
const modules=import.meta.glob('../zones/*.json',{eager:true,import:'default'}) as Record<string,any>
const ow=overworld as any
describe('semantic towns in the connected world',()=>{
 it('assembles all14 authored districts and every canonical supported service',()=>{
  expect(Object.keys(placements.regions).sort()).toEqual(Object.keys(world.places).sort())
  for(const [id,origin]of Object.entries(placements.regions)){
   const zone=modules['../zones/'+id+'.json'],prefix=id==='lumbright'?'lb':id
   for(const object of zone.objects){
    expect(ow.objects.find((o:any)=>o.id===prefix+'_'+object.id),id+' '+object.id).toEqual({...object,id:prefix+'_'+object.id,x:origin.x+object.x,z:origin.z+object.z})
   }
   const facilities=world.places[id as keyof typeof world.places].facilities??[]
   for(const [facility,types]of Object.entries({bank:['bank_chest'],stove:['range'],furnace_anvil:['furnace','anvil']})){
    const actual=zone.objects.filter((o:any)=>types.includes(o.type)).map((o:any)=>o.type)
    expect(actual.sort(),id+' '+facility).toEqual(facilities.includes(facility as never)?[...types].sort():[])
   }
  }
 })
 it('preserves every district arrival and joins every canonical travel edge',()=>{
  for(const [a,b]of world.edges as [string,string,number][]){
   const from=ow.landmarks.find((p:any)=>p.id===a),target=ow.landmarks.find((p:any)=>p.id===b)
   const path=findJourneyPath(ow,from,b)
   expect(path?.at(-1),a+' to '+b).toEqual({x:target.x,z:target.z})
  }
 })
 it('keeps every translated interaction and complete wander rectangle walkable',()=>{
  for(const o of [...ow.objects,...ow.exits,...ow.waymarks])expect(ow.collision[o.z]?.[o.x],o.id).toBe('.')
  for(const n of ow.npcs)for(let z=n.wander.z;z<n.wander.z+n.wander.h;z++)for(let x=n.wander.x;x<n.wander.x+n.wander.w;x++)expect(ow.collision[z]?.[x],n.id+' '+x+','+z).toBe('.')
 })
})
