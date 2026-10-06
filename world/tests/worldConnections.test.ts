import {describe,expect,it} from 'vitest'
import {validateExitGraph} from '../shared/zone'
import {ZONES} from '../server/zones'
import {findJourneyPath,findPath} from '../server/pathfind'
import {createExitMarkers} from '../client/src/exits'
import * as THREE from 'three'
describe('connected world arrivals',()=>{
  it('keeps every registered return walkable and away from another entrance',()=> {
    expect(validateExitGraph(ZONES)).toEqual({valid:true})
  })
  it('requires explicit entry into every lair from the overworld',()=>{
    for(const zone of Object.values(ZONES).filter(z=>z.id!=='overworld'&&z.exits?.some(e=>e.toZone==='overworld'))) {
      const entrances=(ZONES.overworld.exits??[]).filter(e=>e.toZone===zone.id)
      expect(entrances.length,zone.id).toBeGreaterThan(0)
      for(const entrance of entrances) expect(entrance.activation).toBe('interact')
    }
  })
  it('keeps a framed hidden-pad door selectable',()=>{
    const layer=createExitMarkers(new THREE.Scene(),[{id:'door',x:2,z:3,label:'Lumbright',hideMarker:true,presentation:'door'}])
    expect(layer.tiles.get('door')).toEqual({x:2,z:3})
    expect(layer.pickables).toHaveLength(1)
    expect(layer.pickables[0].userData.pick.name).toBe('Lumbright')
  })
  it('prefers the authored road over an unmarked shortcut',()=>{
    const collision=Array(5).fill('.'.repeat(9))
    const zone={collision,width:9,height:5,landmarks:[{id:'town',label:'Town',x:8,z:2}],
      ground:[{kind:'path_dirt',x:0,z:1,w:9,h:1},{kind:'path_dirt',x:0,z:2,w:1,h:1},{kind:'path_dirt',x:8,z:2,w:1,h:1}]}
    const path=findJourneyPath(zone,{x:0,z:2},'town')!
    expect(path.some(p=>p.z===1)).toBe(true)
    expect(path.filter(p=>p.z===2&&p.x>0&&p.x<8)).toHaveLength(0)
  })
  it('plans the complete named journey while ordinary walking stays bounded',()=>{
    const collision=['.'.repeat(130)]
    const zone={collision,width:130,height:1,landmarks:[{id:'far',label:'Far',x:129,z:0}]}
    const full=findJourneyPath(zone,{x:0,z:0},'far')
    expect(full?.at(-1)).toEqual({x:129,z:0})
    expect(findPath(collision,{x:0,z:0},{x:129,z:0})?.at(-1)).toEqual({x:63,z:0})
    expect(findJourneyPath(zone,{x:0,z:0},'unknown')).toBeNull()
  })
})
