// The Pages-side handle on a co-op room. Co-op needs TWO deploys (Pages and the
// pocketrpg-world Worker that hosts the Durable Object class), so "the room
// cannot be reached" is a routine state, not an exceptional one — and it has to
// read as "group fights are off" rather than as a broken endpoint.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { callCoopRoom, coopRoomsAvailable } from '../functions/_lib/game/coopRoom.js'

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

  it('degrades to COOP_UNAVAILABLE when the binding is missing entirely', async () => {
    expect(coopRoomsAvailable({} as never)).toBe(false)
    await expect(callCoopRoom({} as never, 12, 'poll')).rejects.toMatchObject({
      code: 'COOP_UNAVAILABLE', status: 503,
    })
  })

  // The regression: a Pages deploy whose bound Worker has no CoopBossRoom (not
  // deployed yet, or throwing on start) passes the binding check and then
  // rejects on fetch. That used to escape as an unmapped 500 — an "Internal
  // server error" on entering a group boss, with nothing logged to say why.
  it('degrades the same way when the binding exists but the room is unreachable', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const env = envWithStub(async () => { throw new Error('Durable Object class not found') })

    expect(coopRoomsAvailable(env as never)).toBe(true)
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
