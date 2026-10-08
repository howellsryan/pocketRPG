import {describe,expect,it} from 'vitest'
import {prepareZoneTransition as prepare} from '../server/lairEntry'
describe('durable entrance admission',()=>{
  it('checks admission and chooses a numbered room before saving the arrival',async()=>{
    const order:string[]=[]
    const result=await prepare({
      gate:async()=>{order.push('gate');return null},
      assign:async()=>{order.push('assign');return 'lair~2'},
      flush:async()=>{order.push('save');return true},
      persist:async(room:string)=>{order.push('arrival:'+room)},
      current:()=>true,
    })
    expect(result).toEqual({room:'lair~2'})
    expect(order).toEqual(['gate','assign','save','arrival:lair~2'])
  })
  it('keeps a locked character in the overworld without writing an arrival',async()=>{
    const writes:string[]=[]
    const result=await prepare({gate:async()=> 'Requires a quest',assign:async()=>{writes.push('assign');return 'lair~1'},flush:async()=>{writes.push('save');return true},persist:async()=>{writes.push('arrival')},current:()=>true})
    expect(result).toEqual({error:'Requires a quest'})
    expect(writes).toEqual([])
  })
  it('preserves the current session when its save cannot be made durable',async()=>{
    let wrote=false
    const result=await prepare({gate:async()=>null,assign:async()=> 'lair~1',flush:async()=>false,persist:async()=>{wrote=true},current:()=>true})
    expect(result?.error).toMatch(/save/i)
    expect(wrote).toBe(false)
  })
  it('does not hand off a session that changed during admission',async()=>{
    let current=true,wrote=false
    const result=await prepare({gate:async()=>null,assign:async()=>{current=false;return 'lair~1'},flush:async()=>true,persist:async()=>{wrote=true},current:()=>current})
    expect(result?.error).toBeTruthy()
    expect(wrote).toBe(false)
  })
})
