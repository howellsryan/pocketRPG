import {describe,expect,it} from 'vitest'
import {describeDestination as guide} from '../client/src/worldMap'
describe('destination guidance',()=>{
  it('points from Lumbright toward Draynar with a remaining walking distance',()=>{
    expect(guide({x:178,z:120},{x:138,z:143})).toEqual({direction:'southwest',distance:40,arrived:false})
  })
  it('recognizes arrival without asking the player to overshoot',()=>{
    expect(guide({x:10,z:10},{x:11,z:10})).toEqual({direction:'here',distance:1,arrived:true})
  })
})
