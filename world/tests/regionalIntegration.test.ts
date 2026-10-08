import {describe,expect,it} from 'vitest'
import {integrateRegions} from '../authoring/integrate.mjs'
const region=(id:string,x:number)=>({
 origin:{x,z:2},
 zone:{id,name:id,width:4,height:5,spawn:{x:1,z:2},collision:['#...','....','....','....','....'],objects:[{id:'ore',type:'rock',rock:'clay',x:1,z:1}],npcs:[{id:'rat',monsterId:'rat',x:2,z:1,wander:{x:2,z:1,w:1,h:1}}],exits:[],props:[{model:'flowers',x:1,z:3}],ground:[{kind:'floor_tile',x:0,z:0,w:4,h:5}],waymarks:[{id:'sign',label:'Neighbor',destination:id==='a'?'b':'a',x:2,z:2}],ambient:{critters:[{model:'villager',x:0,z:3,w:2,h:1,count:1}],smoke:[{x:1,z:3,y:2}]}},
 report:{connections:[id==='a'?{point:'east',to:'b',x:2,z:2,outward:{x:1,z:0}}:{point:'west',to:'a',x:1,z:2,outward:{x:-1,z:0}}]}
})
describe('complete regional overworld integration',()=>{
 it('translates every owned layer and namespaces interactive identities without mutating the region',()=>{
  const entries=[region('a',2),region('b',10)],before=JSON.stringify(entries)
  const result=integrateRegions({width:20,height:10,entries,edges:[['a','b',1]]})
  expect(result.collision[2][2]).toBe('#')
  expect(result.objects.find((o:any)=>o.id==='a_ore')).toMatchObject({x:3,z:3,rock:'clay'})
  expect(result.npcs.find((n:any)=>n.id==='a_rat')).toMatchObject({x:4,z:3,wander:{x:4,z:3,w:1,h:1}})
  expect(result.ambient.critters[0]).toMatchObject({x:2,z:5,w:2,h:1,count:1})
  expect(result.ambient.smoke[0]).toMatchObject({x:3,z:5,y:2})
  expect(result.waymarks.find((s:any)=>s.id==='a_sign')).toMatchObject({x:4,z:4,destination:'b'})
  expect(result.regions.find((r:any)=>r.id==='a')).toMatchObject({x:2,z:2,w:4,h:5})
  expect(JSON.stringify(entries)).toBe(before)
 })
 it('rejects overlapping, out-of-bounds and duplicate stamps instead of carving through them',()=>{
  expect(()=>integrateRegions({width:20,height:10,entries:[region('a',2),region('b',4)],edges:[]})).toThrow(/overlap/)
  expect(()=>integrateRegions({width:12,height:10,entries:[region('a',10)],edges:[]})).toThrow(/bounds/)
  expect(()=>integrateRegions({width:20,height:10,entries:[region('a',2),region('a',10)],edges:[]})).toThrow(/duplicate/)
 })
 it('protects regional paint and joins both authored gateways with a continuous external road',()=>{
  const result=integrateRegions({width:20,height:10,entries:[region('a',2),region('b',10)],edges:[['a','b',1]]})
  for(const rect of result.ground.filter((g:any)=>g.kind==='path_dirt')){
   for(let z=rect.z;z<rect.z+rect.h;z++)for(let x=rect.x;x<rect.x+rect.w;x++)
    expect((x>=2&&x<6&&z>=2&&z<7)||(x>=10&&x<14&&z>=2&&z<7)).toBe(false)
  }
  const roads=new Set(result.ground.flatMap((g:any)=>Array.from({length:g.h*g.w},(_,i)=>(g.x+i%g.w)+','+(g.z+Math.floor(i/g.w)))))
  for(let x=4;x<=11;x++)expect(roads.has(x+',4'),String(x)).toBe(true)
 })
 it('rejects a canonical connection without the destination gateway',()=>{
  const b=region('b',10);b.report.connections=[]
  expect(()=>integrateRegions({width:20,height:10,entries:[region('a',2),b],edges:[['a','b',1]]})).toThrow(/gateway/)
 })
})
