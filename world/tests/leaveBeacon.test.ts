// The exit beacon a closing tab fires. A `leave` frame on the socket may never
// flush during unload, and without one the zone holds this character's save lock
// for the whole linger — so the beacon is what makes closing the browser behave
// like pressing Log out.
import { describe, expect, it } from 'vitest'
import { sendLeaveBeacon, WORLD_LEAVE_PATH } from '../client/src/leaveBeacon'

const ORIGIN = 'https://world.example'

function harness(opts: { beacon?: boolean | 'throws' } = {}) {
  const beaconCalls: { url: string; type: string }[] = []
  const fetchCalls: { url: string; body: string }[] = []
  const deps = {
    token: 'jwt-token',
    room: 'overworld',
    origin: ORIGIN,
    sendBeacon:
      opts.beacon === undefined
        ? null
        : (url: string, body: Blob) => {
            if (opts.beacon === 'throws') throw new Error('nope')
            beaconCalls.push({ url, type: body.type })
            return opts.beacon as boolean
          },
    keepaliveFetch: (url: string, body: string) => void fetchCalls.push({ url, body }),
  }
  return { deps, beaconCalls, fetchCalls }
}

describe('exit beacon', () => {
  it('posts the session token and room to the world leave route', () => {
    const h = harness({ beacon: true })
    expect(sendLeaveBeacon(h.deps)).toBe('beacon')
    expect(h.beaconCalls).toEqual([{ url: ORIGIN + WORLD_LEAVE_PATH, type: 'application/json' }])
    expect(h.fetchCalls).toEqual([])
  })

  it('falls back to a keepalive fetch when sendBeacon refuses or is missing', () => {
    for (const beacon of [false, 'throws' as const, undefined]) {
      const h = harness({ beacon })
      expect(sendLeaveBeacon(h.deps)).toBe('fetch')
      expect(h.fetchCalls).toEqual([
        { url: ORIGIN + WORLD_LEAVE_PATH, body: JSON.stringify({ token: 'jwt-token', zone: 'overworld' }) },
      ])
    }
  })

  it('sends nothing without a session token or a room', () => {
    const h = harness({ beacon: true })
    expect(sendLeaveBeacon({ ...h.deps, token: null })).toBe('skipped')
    expect(sendLeaveBeacon({ ...h.deps, room: '' })).toBe('skipped')
    expect(h.beaconCalls).toEqual([])
    expect(h.fetchCalls).toEqual([])
  })
})
