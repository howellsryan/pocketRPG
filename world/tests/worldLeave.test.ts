// POST /api/world/leave — the server side of the closing-tab exit beacon. It
// arrives with no socket and no cookie, so the world session JWT is the only
// authority for which character it may depart.
import { describe, expect, it } from 'vitest'
import { signJWT } from '../../functions/_lib/jwt.js'
import { handleWorldLeave, parseLeaveBeacon } from '../server/leave'
import type { Env } from '../server/env'

const SECRET = 'world-leave-secret'
const env = { JWT_SECRET: SECRET } as unknown as Env

function beacon(body: unknown): Request {
  return new Request('https://world.example/api/world/leave', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function spy() {
  const calls: { room: string; charId: string }[] = []
  return {
    calls,
    depart: async (_env: Env, room: string, charId: string) => {
      calls.push({ room, charId })
      return true
    },
  }
}

const worldToken = (claims: Record<string, unknown> = {}) =>
  signJWT({ sub: 'identity-1', character_id: 42, scope: 'world', ...claims }, SECRET, 60)

describe('parseLeaveBeacon', () => {
  it('accepts a token plus a room name, including an instance room', () => {
    expect(parseLeaveBeacon({ token: 't', zone: 'overworld' })).toEqual({ token: 't', room: 'overworld' })
    expect(parseLeaveBeacon({ token: 't', zone: 'grondar_lair~3' })?.room).toBe('grondar_lair~3')
  })

  it('rejects a missing token, a missing room, and a room that is not a room name', () => {
    expect(parseLeaveBeacon({ zone: 'overworld' })).toBeNull()
    expect(parseLeaveBeacon({ token: 't' })).toBeNull()
    expect(parseLeaveBeacon({ token: 't', zone: '' })).toBeNull()
    expect(parseLeaveBeacon({ token: 't', zone: '../../etc' })).toBeNull()
    expect(parseLeaveBeacon({ token: 't', zone: 'a'.repeat(65) })).toBeNull()
    expect(parseLeaveBeacon(null)).toBeNull()
  })
})

describe('POST /api/world/leave', () => {
  it('departs the character its token names, in the room it names', async () => {
    const s = spy()
    const res = await handleWorldLeave(beacon({ token: await worldToken(), zone: 'overworld' }), env, s.depart)
    expect(res.status).toBe(204)
    expect(s.calls).toEqual([{ room: 'overworld', charId: '42' }])
  })

  it('rejects a malformed body without touching the room', async () => {
    const s = spy()
    expect((await handleWorldLeave(beacon('not json'), env, s.depart)).status).toBe(400)
    expect((await handleWorldLeave(beacon({ token: 't' }), env, s.depart)).status).toBe(400)
    expect(s.calls).toEqual([])
  })

  it('rejects a forged token, a token signed with another secret, and the wrong scope', async () => {
    const s = spy()
    const foreign = await signJWT({ sub: 'x', character_id: 42, scope: 'world' }, 'other-secret', 60)
    const handoff = await worldToken({ scope: 'world_handoff' })
    expect((await handleWorldLeave(beacon({ token: 'a.b.c', zone: 'overworld' }), env, s.depart)).status).toBe(401)
    expect((await handleWorldLeave(beacon({ token: foreign, zone: 'overworld' }), env, s.depart)).status).toBe(401)
    expect((await handleWorldLeave(beacon({ token: handoff, zone: 'overworld' }), env, s.depart)).status).toBe(401)
    expect(s.calls).toEqual([])
  })

  it('still succeeds when the room is unreachable — the socket close covers it', async () => {
    const res = await handleWorldLeave(beacon({ token: await worldToken(), zone: 'overworld' }), env, async () => {
      throw new Error('no such durable object')
    })
    expect(res.status).toBe(204)
  })
})
