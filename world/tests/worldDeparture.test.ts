import {describe,expect,it,vi} from 'vitest'
import {prepareWorldDeparture} from '../server/lairEntry'
describe('confirmed return to idle',()=>{
  it('saves grants and position before releasing the world writer',async()=>{
    const order:string[]=[]
    expect(await prepareWorldDeparture({flush:async()=>{order.push('grants');return true},checkpoint:async()=>{order.push('position')},release:async()=>{order.push('release')},current:()=>true})).toBe(null)
    expect(order).toEqual(['grants','position','release'])
  })
  it('retains the writer when grant saving fails',async()=>{
    let released=false,wrote=false
    expect(await prepareWorldDeparture({flush:async()=>false,checkpoint:async()=>{wrote=true},release:async()=>{released=true},current:()=>true})).toMatch(/save/i)
    expect(wrote).toBe(false);expect(released).toBe(false)
  })
  it('retains the writer when the position cannot be saved',async()=>{
    let released=false
    expect(await prepareWorldDeparture({flush:async()=>true,checkpoint:async()=>{throw new Error('D1 unavailable')},release:async()=>{released=true},current:()=>true})).toMatch(/save/i)
    expect(released).toBe(false)
  })
  it('does not release a replaced session after an asynchronous save',async()=>{
    let current=true,released=false
    expect(await prepareWorldDeparture({flush:async()=>{current=false;return true},checkpoint:async()=>{},release:async()=>{released=true},current:()=>current})).toBeTruthy()
    expect(released).toBe(false)
  })
})

vi.mock('partyserver',()=>({Server:class{},getServerByName:vi.fn()}))
import {WorldZone} from '../server/WorldZone'

describe('unload beacons during authoritative saving',()=>{
  function roomFor(transitioning:boolean, combatBlockUntilTick=0) {
    const room=Object.create(WorldZone.prototype) as WorldZone
    const player={charId:'42',transitioning,combatBlockUntilTick,conn:{close:vi.fn()}}
    const remove=vi.fn(async()=>{room.players.delete(player.charId)})
    const linger=vi.fn()
    Object.assign(room,{players:new Map([[player.charId,player]]),tickCount:10,removeAndFlush:remove,beginCombatLinger:linger})
    return {room,player,remove,linger}
  }
  it('keeps an in-flight source player when the unload beacon arrives',async()=>{
    const {room,player,remove}=roomFor(true)
    expect(await room.departCharacter('42')).toBe(true)
    expect(room.players.get('42')).toBe(player)
    expect(remove).not.toHaveBeenCalled()
    expect(player.conn.close).not.toHaveBeenCalled()
  })
  it('does not interrupt an in-flight save with combat linger',async()=>{
    const {room,player,linger,remove}=roomFor(true,99)
    await room.departCharacter('42')
    expect(linger).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
    expect(player.conn.close).not.toHaveBeenCalled()
  })
  it('still releases a normal non-transitioning leave',async()=>{
    const {room,player,remove}=roomFor(false)
    await room.departCharacter('42')
    expect(remove).toHaveBeenCalledOnce()
    expect(room.players.has('42')).toBe(false)
    expect(player.conn.close).toHaveBeenCalledWith(1000,'leave')
  })
})
