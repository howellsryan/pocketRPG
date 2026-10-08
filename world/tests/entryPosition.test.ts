import {describe,expect,it} from 'vitest'
import {resolveEntryPosition,type ZoneDef} from '../shared/zone'
const zone={spawn:{x:1,z:1},collision:['...','.#.','...']} as ZoneDef
describe('entry after an authored collision update',()=>{
 it('preserves a valid saved tile without mutating inputs',()=>{const saved={x:2,z:1},before=JSON.stringify(zone);expect(resolveEntryPosition(zone,saved)).toEqual(saved);expect(JSON.stringify(zone)).toBe(before);expect(saved).toEqual({x:2,z:1})})
 it('returns to the authored spawn when scenery now occupies the saved tile',()=>{const valid={...zone,spawn:{x:0,z:0}};expect(resolveEntryPosition(valid,{x:1,z:1})).toEqual({x:0,z:0})})
 it.each([{x:-1,z:0},{x:3,z:0},{x:0,z:-1},{x:0,z:3},{x:0.5,z:0},{x:NaN,z:0},{x:Infinity,z:0},{x:'0',z:0},{x:0},null])('recovers invalid persisted coordinates %j',saved=>{const valid={...zone,spawn:{x:0,z:0}};expect(resolveEntryPosition(valid,saved)).toEqual({x:0,z:0})})
})
