import {describe,expect,it,vi} from 'vitest'
import * as THREE from 'three'
import {createStatics} from '../client/src/statics'
vi.mock('three/examples/jsm/loaders/GLTFLoader.js',()=>({GLTFLoader:class {loadAsync(){return Promise.reject(new Error('No asset I/O in presentation logic test'))}}}))
describe('canonical regional resource presentation',()=>{
 it('names later trees and gathering sites after their actual interaction identities',async()=>{
  const layer=await createStatics(new THREE.Scene(),[
   {id:'willow',type:'tree',tree:'willow',x:0,z:0},
   {id:'berries',type:'gather_site',gather:'pick_white_berries',x:3,z:0},
   {id:'seaweed',type:'gather_site',gather:'collect_seaweed',x:6,z:0},
  ])
  expect(layer.pickables.map(p=>p.userData.pick.name)).toEqual(['Willow','Pick White Berries','Collect Seaweed'])
  expect(layer.pickables.map(p=>p.userData.pick.actions[0].action)).toEqual(['chop','gather','gather'])
 })
 it('distinguishes coal and runeforged deposits and preserves their depleted appearance',async()=>{
  const layer=await createStatics(new THREE.Scene(),[{id:'coal',type:'rock',rock:'coal',x:0,z:0},{id:'runite',type:'rock',rock:'runite',x:3,z:0}])
  const colors=layer.pickables.map(p=>{let color='';p.traverse(c=>{if(c instanceof THREE.Mesh)color=c.material.color.getHexString()});return color})
  expect(colors[0]).not.toEqual(colors[1])
  const initial=layer.pickables[0].scale.x
  layer.setRockDepleted('coal',true);expect(layer.pickables[0].scale.x).toBeLessThan(initial)
  layer.setRockDepleted('coal',false);expect(layer.pickables[0].scale.x).toBe(initial)
 })
})
