import {afterEach, describe, expect, it, vi} from 'vitest'
import {signJWT} from '../functions/_lib/jwt.js'
import worker from '../worker/index.js'

vi.mock('partyserver', () => ({
  Server: class {},
  getServerByName: vi.fn(),
  routePartykitRequest: vi.fn(async (request: Request) => new URL(request.url).pathname.startsWith('/parties/') ? new Response('world socket', {status: 209}) : null),
}))
vi.mock('../world/server/departInRoom', () => ({
  departInRoom: async (_env: unknown, room: string, character: string) => {
    departures.push({room, character})
    return true
  },
}))
const departures: {room: string, character: string}[] = []
afterEach(() => {departures.length = 0; vi.clearAllMocks()})
const preview = 'https://preview.example.workers.dev'
function env(flag: unknown = 'false') {
  return {
    WORLD_BETA_ENABLED: flag,
    APP_BASE_URL: preview,
    JWT_SECRET: 'world-access-test',
    ASSETS: {fetch: vi.fn(async (request: Request) => new Response(new URL(request.url).pathname))},
    DB: {prepare: vi.fn(() => {throw new Error('Blocked request reached D1')})},
  }
}
const context = {waitUntil: () => {}}
describe('Worker world admission', () => {
  it.each(['/world','/world/','/world/index.html','/world/editor','/world/preview','/world/assets/client.js','/api/world-token','/api/world-token/','/api//world-token','/api/world/session','/api/world/session/','/api/world/editor/zones','/api/world/pvp-count','/parties/world-zone/overworld','/parties/world-zone/grondar_lair~2'])('denies disabled %s before dispatch or assets', async path => {
    const bindings = env()
    const response = await worker.fetch(new Request(preview + path), bindings, context)
    expect(response.status).toBe(404)
    expect(bindings.DB.prepare).not.toHaveBeenCalled()
    expect(bindings.ASSETS.fetch).not.toHaveBeenCalled()
  })
  it('denies the world hostname root with an accidentally true flag', async () => {
    const bindings = env('true')
    const response = await worker.fetch(new Request('https://world.pocketrpg.co.uk/'), bindings, context)
    expect(response.status).toBe(404)
    expect(bindings.ASSETS.fetch).not.toHaveBeenCalled()
  })
  it('denies aliases of a production deployment with an accidentally true flag', async () => {
    const bindings = {...env('true'), APP_BASE_URL: 'https://pocketrpg.co.uk'}
    expect((await worker.fetch(new Request(preview + '/world/'), bindings, context)).status).toBe(404)
    expect(bindings.ASSETS.fetch).not.toHaveBeenCalled()
  })
  it('serves the idle game with the world disabled', async () => {
    const response = await worker.fetch(new Request(preview + '/'), env(), context)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('/')
  })
  it.each(['/api/coop/bosses','/api/coop/raids'])('keeps idle co-op authentication at %s', async path => {
    expect((await worker.fetch(new Request(preview + path), env(), context)).status).toBe(401)
  })
  it('serves world assets and socket upgrades in explicitly enabled preview', async () => {
    const bindings = env('true')
    const response = await worker.fetch(new Request(preview + '/world/'), bindings, context)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('/world/')
    expect((await worker.fetch(new Request(preview + '/parties/world-zone/overworld'), bindings, context)).status).toBe(209)
  })
  it('permits only authenticated departure cleanup while the world is disabled', async () => {
    const bindings = env()
    const token = await signJWT({sub: 'owner', character_id: 42, scope: 'world'}, bindings.JWT_SECRET, 60)
    const response = await worker.fetch(new Request(preview + '/api/world/leave', {method: 'POST', body: JSON.stringify({token, zone: 'overworld', character_id: 99})}), bindings, context)
    expect(response.status).toBe(204)
    expect(departures).toEqual([{room: 'overworld', character: '42'}])
    expect(bindings.DB.prepare).not.toHaveBeenCalled()
  })
  it('rejects forged departure while disabled', async () => {
    const response = await worker.fetch(new Request(preview + '/api/world/leave', {method:'POST',body:JSON.stringify({token:'a.b.c',zone:'overworld'})}), env(), context)
    expect(response.status).toBe(401)
    expect(departures).toEqual([])
  })
})
