// beaconSaveNow: the page-teardown durability path. On refresh / close / tab-
// hide a normal fetch is cancelled mid-flight, so the snapshot is flushed via
// navigator.sendBeacon instead. It must skip when nothing changed since the last
// push and otherwise optimistically advance the local revision so a resumed tab
// doesn't 409 its next real push.

import { describe, it, expect, vi } from 'vitest'

const putSave = vi.fn(async () => ({ ok: true, updatedAt: 123, save_revision: 1 }))
const sendSaveBeacon = vi.fn(() => true)

vi.mock('../src/cloud/api.js', () => ({
  api: { putSave: (...args: any[]) => putSave(...args) },
  getToken: () => 'token',
  getCharacterId: () => '42',
  setLocalCharacterId: () => {},
  sendSaveBeacon: (...args: any[]) => sendSaveBeacon(...args),
  SAVE_REVISION_EVENT: 'pocketrpg:save-revision',
}))

vi.mock('../src/db/saveload.js', () => ({
  buildSavePayloadFromSnapshot: (snap: any) => ({ version: 1, timestamp: Date.now(), ...snap }),
  applySavePayload: async () => {},
}))

import { beaconSaveNow, pushNow, resetSyncState } from '../src/cloud/sync.js'

describe('beaconSaveNow', () => {
  it('queues a beacon carrying the save blob when content is new', () => {
    resetSyncState()
    sendSaveBeacon.mockClear()

    expect(beaconSaveNow({ stats: { attack: { xp: 5 } } })).toBe(true)
    expect(sendSaveBeacon).toHaveBeenCalledTimes(1)
    const [json, opts] = sendSaveBeacon.mock.calls[0]
    expect(JSON.parse(json).stats.attack.xp).toBe(5)
    // Teardown saves are interactive so the server never idle-ceilings them.
    expect(opts).toMatchObject({ interactive: true, saveRevision: 0 })
  })

  it('skips when content is unchanged since the last successful push', async () => {
    resetSyncState()
    putSave.mockClear()
    sendSaveBeacon.mockClear()

    expect(await pushNow({ stats: { attack: { xp: 5 } } })).toBe(true)
    expect(putSave).toHaveBeenCalledTimes(1)

    // Same content — nothing new to flush on teardown.
    expect(beaconSaveNow({ stats: { attack: { xp: 5 } } })).toBe(false)
    expect(sendSaveBeacon).not.toHaveBeenCalled()
  })

  it('optimistically bumps the revision so a following push does not 409', () => {
    resetSyncState()
    putSave.mockClear()
    sendSaveBeacon.mockClear()

    // Fresh session: revision 0. Beacon a change → server would write revision 1.
    expect(beaconSaveNow({ stats: { attack: { xp: 5 } } })).toBe(true)
    // A later foreground push of new state must send the bumped revision (1),
    // matching what the server now holds.
    return pushNow({ stats: { attack: { xp: 9 } } }).then(() => {
      expect(putSave).toHaveBeenCalledTimes(1)
      expect(putSave.mock.calls[0][1]).toMatchObject({ saveRevision: 1 })
    })
  })

  it('does not beacon a second identical teardown save', () => {
    resetSyncState()
    sendSaveBeacon.mockClear()

    expect(beaconSaveNow({ stats: { attack: { xp: 5 } } })).toBe(true)
    // Same snapshot again (e.g. beforeunload after pagehide) — already flushed.
    expect(beaconSaveNow({ stats: { attack: { xp: 5 } } })).toBe(false)
    expect(sendSaveBeacon).toHaveBeenCalledTimes(1)
  })

  it('returns false when the beacon transport is unavailable', () => {
    resetSyncState()
    sendSaveBeacon.mockClear()
    sendSaveBeacon.mockReturnValueOnce(false)

    expect(beaconSaveNow({ stats: { attack: { xp: 5 } } })).toBe(false)
    // A failed beacon must NOT advance the local markers — the next real push
    // still needs to send this state.
    sendSaveBeacon.mockReturnValue(true)
    expect(beaconSaveNow({ stats: { attack: { xp: 5 } } })).toBe(true)
  })
})
