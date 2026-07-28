// The Pages edge for the co-op socket: mint a ticket, spend it on an upgrade.
//
// A browser cannot put an Authorization header on a WebSocket handshake, so the
// session JWT is exchanged for a short-lived, single-fight token the URL may
// carry. Everything here exists so that an unauthenticated socket never reaches
// a Durable Object — and so that a Pages build ahead of the world Worker
// degrades to polling instead of breaking the fight (§20's two-deploy rule).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { onRequestGet, onRequestPost } from '../functions/api/coop/session/[id]/socket.js'
import { signJWT } from '../functions/_lib/jwt.js'

const SECRET = 'test-secret-that-is-long-enough-for-hs256'
const SESSION_ID = 12

let env: any
let roomAnswer: () => Promise<any>

function envWithRoom() {
  return {
    JWT_SECRET: SECRET,
    DB: {
      prepare: () => ({
        bind: () => ({
          first: async () => ({ id: 7, username: 'player7', is_ironman: 0, is_one_life: 0 }),
        }),
      }),
    },
    COOP_ROOM: {
      idFromName: (name: string) => name,
      get: () => ({ fetch: () => roomAnswer() }),
    },
  }
}

async function sessionToken() {
  return signJWT({ sub: 1, provider: 'github' }, SECRET, 3600)
}

function request(url: string, init: RequestInit = {}) {
  return new Request(url, init)
}

async function mintTicket() {
  const res = await onRequestPost({
    request: request('https://pocketrpg.co.uk/api/coop/session/12/socket', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await sessionToken()}`, 'X-Character-Id': '7' },
      body: '{}',
    }),
    env,
    params: { id: String(SESSION_ID) },
  } as never)
  return { res, body: await res.json() as any }
}

function upgrade(query: string) {
  return onRequestGet({
    request: request(`https://pocketrpg.co.uk/api/coop/session/12/socket?${query}`, {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    }),
    env,
    params: { id: String(SESSION_ID) },
  } as never)
}

beforeEach(() => {
  env = envWithRoom()
  // The room's half of an upgrade. A real 101 carries a `webSocket`; the test
  // only needs the status the route branches on.
  roomAnswer = async () => ({ status: 101, webSocket: {} })
})

describe('minting a socket ticket', () => {
  it('needs the session token, like every other route', async () => {
    const res = await onRequestPost({
      request: request('https://pocketrpg.co.uk/api/coop/session/12/socket', { method: 'POST', body: '{}' }),
      env,
      params: { id: String(SESSION_ID) },
    } as never)
    expect(res.status).toBe(401)
  })

  it('hands back a short-lived ticket', async () => {
    const { res, body } = await mintTicket()
    expect(res.status).toBe(200)
    expect(typeof body.ticket).toBe('string')
    // Long enough to open a socket, short enough that a leaked URL is worthless.
    expect(body.expires_in).toBeLessThanOrEqual(60)
  })
})

describe('spending it', () => {
  it('upgrades and hands the room’s socket straight back', async () => {
    const { body } = await mintTicket()
    const res = await upgrade(`ticket=${body.ticket}`)
    expect(res.status).toBe(101)
  })

  it('refuses a request that is not an upgrade at all', async () => {
    const { body } = await mintTicket()
    const res = await onRequestGet({
      request: request(`https://pocketrpg.co.uk/api/coop/session/12/socket?ticket=${body.ticket}`),
      env,
      params: { id: String(SESSION_ID) },
    } as never)
    expect(res.status).toBe(426)
  })

  it('refuses a missing or forged ticket before the room is touched', async () => {
    let touched = false
    roomAnswer = async () => { touched = true; return { status: 101 } }

    expect((await upgrade('')).status).toBe(401)
    expect((await upgrade('ticket=not-a-jwt')).status).toBe(401)
    const wrongSecret = await signJWT({ sub: 1, character_id: 7, session_id: SESSION_ID, scope: 'coop_socket' }, 'other-secret-value-entirely', 60)
    expect((await upgrade(`ticket=${wrongSecret}`)).status).toBe(401)
    expect(touched).toBe(false)
  })

  // A signature being good is not the same as the ticket being for this fight.
  it('refuses a valid ticket issued for a different session', async () => {
    const other = await signJWT({ sub: 1, character_id: 7, session_id: 99, scope: 'coop_socket' }, SECRET, 60)
    expect((await upgrade(`ticket=${other}`)).status).toBe(401)
  })

  it('refuses a session token used as a ticket', async () => {
    expect((await upgrade(`ticket=${await sessionToken()}`)).status).toBe(401)
  })

  it('refuses an expired ticket', async () => {
    const stale = await signJWT({ sub: 1, character_id: 7, session_id: SESSION_ID, scope: 'coop_socket' }, SECRET, -1)
    expect((await upgrade(`ticket=${stale}`)).status).toBe(401)
  })

  // The two-deploy case: a Worker with no `socket` action answers 404, and that
  // has to reach the client as a refusal it can fall back from — not a 101 and
  // not a 500.
  it('passes a stale Worker’s refusal through, so the client falls back to polling', async () => {
    roomAnswer = async () => new Response(JSON.stringify({ error: 'unknown_action' }), { status: 404 })
    const { body } = await mintTicket()
    const res = await upgrade(`ticket=${body.ticket}`)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'unknown_action' })
  })

  it('degrades rather than throwing when the world Worker is unreachable', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    roomAnswer = async () => { throw new Error('Durable Object class not found') }
    const { body } = await mintTicket()
    const res = await upgrade(`ticket=${body.ticket}`)
    expect(res.status).toBe(503)
    expect(logged).toHaveBeenCalled()
    logged.mockRestore()
  })

  it('says group fights are off when the binding is missing entirely', async () => {
    const { body } = await mintTicket()
    delete env.COOP_ROOM
    const res = await upgrade(`ticket=${body.ticket}`)
    expect(res.status).toBe(503)
  })
})
