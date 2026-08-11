// The handle on a co-op room. CoopBossRoom is a local Durable Object class of
// the one Worker now, so a missing binding is no longer a state that can exist
// — but a room that rejects on fetch still is (evicted mid-start, throwing on
// load), and it has to read as "group fights are off" rather than as a broken
// endpoint.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { callCoopRoom } from '../functions/_lib/game/coopRoom.js'

function envWithStub(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  return { COOP_ROOM: { idFromName: (name: string) => name, get: () => ({ fetch: fetchImpl }) } }
}

afterEach(() => { vi.restoreAllMocks() })

describe('callCoopRoom', () => {
  it('passes the room’s own answer straight through', async () => {
    const env = envWithStub(async () => new Response(JSON.stringify({ ok: true, tick: 4 }), { status: 200 }))
    expect(await callCoopRoom(env as never, 12, 'poll', { characterId: 7 }))
      .toEqual({ status: 200, body: { ok: true, tick: 4 } })
  })

  it('sends the session id with every call, since the room switches on it', async () => {
    let sent: unknown = null
    const env = envWithStub(async (_url, init) => {
      sent = JSON.parse(String(init?.body))
      return new Response('{}', { status: 200 })
    })
    await callCoopRoom(env as never, 12, 'intent', { characterId: 7 })
    expect(sent).toEqual({ characterId: 7, sessionId: 12 })
  })

  // The regression: a room that rejects on fetch used to escape as an unmapped
  // 500 — an "Internal server error" on entering a group boss, with nothing
  // logged to say why.
  it('degrades to COOP_UNAVAILABLE when the room is unreachable', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const env = envWithStub(async () => { throw new Error('Durable Object class not found') })

    await expect(callCoopRoom(env as never, 12, 'join', { characterId: 7 })).rejects.toMatchObject({
      code: 'COOP_UNAVAILABLE', status: 503,
    })
    // …and the cause is named, because a 503 with no log is the next blind hour.
    expect(logged).toHaveBeenCalledWith('[PocketRPG][coop] room unreachable', expect.objectContaining({
      sessionId: 12, action: 'join', message: 'Durable Object class not found',
    }))
  })

  it('does not swallow a room that answers with an error status', async () => {
    const env = envWithStub(async () => new Response(JSON.stringify({ error: 'session_full' }), { status: 409 }))
    expect(await callCoopRoom(env as never, 12, 'join')).toEqual({ status: 409, body: { error: 'session_full' } })
  })
})
