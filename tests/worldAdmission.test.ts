import {afterEach, describe, expect, it, vi} from 'vitest'
import {signJWT, verifyJWT} from '../functions/_lib/jwt.js'
import {handleWorldSession} from '../world/server/session'
import {WorldZone} from '../world/server/WorldZone'
import {ZONES} from '../world/server/zones'
import type {Env} from '../world/server/env'

vi.mock('partyserver', () => ({
  Server: class {env: Env; name = 'overworld'; constructor(_ctx: unknown, env: Env) {this.env = env}},
  getServerByName: vi.fn(),
}))
const preview = 'https://preview.example.workers.dev'
function bindings(flag: unknown = 'false') {
  return {
    WORLD_BETA_ENABLED: flag,
    APP_BASE_URL: preview,
    JWT_SECRET: 'world-admission-test',
    DB: {prepare: vi.fn(() => {throw new Error('Denied admission touched D1')})},
  }
}
function connection() {
  return {id:'c1',state:null,setState:vi.fn(),close:vi.fn(),send:vi.fn()}
}
afterEach(() => vi.useRealTimers())
describe('previous world credentials cannot bypass a disabled deployment', () => {
  it.each(['false', undefined, true])('rejects a valid handoff with flag %s before character lookup', async flag => {
    const env = bindings(flag)
    // bindings(undefined) uses the default; remove explicitly to exercise unset.
    if (flag === undefined) delete (env as any).WORLD_BETA_ENABLED
    const handoff = await signJWT({sub:'owner',character_id:42,scope:'world_handoff'}, env.JWT_SECRET, 60)
    const response = await handleWorldSession(new Request(preview + '/api/world/session',{method:'POST',body:JSON.stringify({handoff})}), env as unknown as Env)
    expect(response.status).toBe(404)
    expect(await response.json()).not.toHaveProperty('token')
    expect(env.DB.prepare).not.toHaveBeenCalled()
  })
  it('rejects an enabled production deployment through its alias', async () => {
    const env = {...bindings('true'), APP_BASE_URL:'https://pocketrpg.co.uk'}
    const response = await handleWorldSession(new Request(preview + '/api/world/session',{method:'POST',body:'{}'}), env as unknown as Env)
    expect(response.status).toBe(404)
    expect(env.DB.prepare).not.toHaveBeenCalled()
  })
  it('still exchanges an owned preview handoff and resumes the overworld', async () => {
    const env = bindings('true')
    env.DB.prepare = vi.fn((sql: string) => ({bind: () => ({first: async () => sql.includes('username') ? {id:42,username:'Explorer'} : null})})) as any
    const handoff = await signJWT({sub:'owner',character_id:42,scope:'world_handoff'}, env.JWT_SECRET, 60)
    const response = await handleWorldSession(new Request(preview + '/api/world/session',{method:'POST',body:JSON.stringify({handoff})}), env as unknown as Env)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({zone:'overworld',character:{id:42,name:'Explorer'}})
    expect(await verifyJWT(body.token, env.JWT_SECRET)).toMatchObject({sub:'owner',character_id:42,scope:'world'})
  })
  it('refuses socket admission before loading zones or starting authentication', async () => {
    const env = bindings()
    const room = new WorldZone({} as any, env as unknown as Env)
    const conn = connection()
    await room.onConnect(conn as any,{request:new Request(preview + '/parties/world-zone/overworld')})
    expect(conn.close).toHaveBeenCalledWith(1008,'world_disabled')
    expect(conn.setState).not.toHaveBeenCalled()
    expect(env.DB.prepare).not.toHaveBeenCalled()
    expect(room.authTimers.size).toBe(0)
    expect(room.players.size).toBe(0)
  })
  it('refuses a hello racing admission with a previously valid world token', async () => {
    const env = bindings()
    const room = new WorldZone({} as any, env as unknown as Env)
    room.loadedZone = ZONES.overworld
    const conn = connection()
    const token = await signJWT({sub:'owner',character_id:42,scope:'world'}, env.JWT_SECRET, 60)
    await room.onMessage(conn as any, JSON.stringify({t:'hello',token}))
    expect(conn.close).toHaveBeenCalledWith(1008,'world_disabled')
    expect(env.DB.prepare).not.toHaveBeenCalled()
  })
  it('admits preview sockets for normal authenticated hello', async () => {
    vi.useFakeTimers()
    const env = bindings('true')
    const room = new WorldZone({} as any, env as unknown as Env)
    room.loadedZone = ZONES.overworld
    const conn = connection()
    await room.onConnect(conn as any,{request:new Request(preview + '/parties/world-zone/overworld')})
    expect(conn.close).not.toHaveBeenCalled()
    expect(conn.setState).toHaveBeenCalledWith({charId:null})
    expect(room.authTimers.size).toBe(1)
    vi.clearAllTimers()
  })
})
