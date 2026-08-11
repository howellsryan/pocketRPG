// functions/api/_middleware.js — CORS decoration + the quest-gate bypass
// install (CLAUDE.md §14, §4). No dedicated test file existed before; the
// WebSocket case below is a regression test for a real crash found in review.

import { describe, it, expect, afterEach } from 'vitest'
import { onRequest as apiMiddleware } from '../functions/api/_middleware.js'
import { questGatesDisabled, setQuestGateBypass } from '../src/engine/questGates.js'

const NATIVE_ORIGIN = 'capacitor://localhost'

afterEach(() => { setQuestGateBypass(false) })

describe('CORS decoration for allowlisted native origins', () => {
  it('answers an OPTIONS preflight without reaching next()', async () => {
    const res = await apiMiddleware({
      request: new Request('https://pocketrpg.co.uk/api/save', {
        method: 'OPTIONS',
        headers: { Origin: NATIVE_ORIGIN },
      }),
      env: {},
      next: async () => { throw new Error('preflight must not reach the handler') },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(NATIVE_ORIGIN)
  })

  it('decorates an ordinary response with CORS headers', async () => {
    const res = await apiMiddleware({
      request: new Request('https://pocketrpg.co.uk/api/save', { headers: { Origin: NATIVE_ORIGIN } }),
      env: {},
      next: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(NATIVE_ORIGIN)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('leaves a same-origin (web) response untouched', async () => {
    const res = await apiMiddleware({
      request: new Request('https://pocketrpg.co.uk/api/save'),
      env: {},
      next: async () => new Response('ok', { status: 200 }),
    })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  // Regression: constructing `new Response(body, { status: 101, ... })` to
  // decorate a WebSocket upgrade throws a RangeError (101 is outside the Fetch
  // spec's 200-599 range for Response()), which used to surface as an
  // unhandled crash — a native app's coop/raid socket connect 500'd instead of
  // ever reaching the graceful "falls back to polling" path.
  //
  // A real 101 with a live `.webSocket` can only be constructed by the
  // Workers runtime itself (its Response() has a Cloudflare-specific carve-out
  // for the `webSocket` init option; Node's spec-compliant Response — what
  // this suite runs under — rejects status 101 unconditionally, even with that
  // property, so it can't be used to build the fixture either). A plain mock
  // is the only way to get a 101-shaped object into this test at all, and it's
  // sufficient: the middleware only ever reads `.status` off it before
  // deciding to return it untouched.
  it('passes a WebSocket upgrade straight through instead of throwing', async () => {
    const upgrade = { status: 101, statusText: 'Switching Protocols', headers: new Headers(), webSocket: {} }
    const res = await apiMiddleware({
      request: new Request('https://pocketrpg.co.uk/api/coop/session/1/socket', {
        headers: { Origin: NATIVE_ORIGIN, Upgrade: 'websocket' },
      }),
      env: {},
      next: async () => upgrade,
    })
    expect(res).toBe(upgrade)
    expect(res.status).toBe(101)
  })
})

describe('quest-gate bypass install (§4)', () => {
  it('installs the bypass before dispatching to next()', async () => {
    await apiMiddleware({
      request: new Request('https://preview.example.workers.dev/api/save'),
      env: { DISABLE_QUEST_REQUIREMENTS: 'true' },
      next: async () => new Response('ok'),
    })
    expect(questGatesDisabled()).toBe(true)
  })

  it('installs the FALSE answer just as reliably, on every request', () => {
    // An isolate that skipped the install on a non-qualifying request would
    // keep answering with a previous request's `true`.
    setQuestGateBypass(true)
    expect(questGatesDisabled()).toBe(true)
    setQuestGateBypass(false)
    expect(questGatesDisabled()).toBe(false)
  })

  it('runs the install before the preflight short-circuit', async () => {
    setQuestGateBypass(false)
    await apiMiddleware({
      request: new Request('https://preview.example.workers.dev/api/save', {
        method: 'OPTIONS',
        headers: { Origin: NATIVE_ORIGIN },
      }),
      env: { DISABLE_QUEST_REQUIREMENTS: 'true' },
      next: async () => { throw new Error('preflight must not reach the handler') },
    })
    expect(questGatesDisabled()).toBe(true)
  })
})
