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

import { beaconSaveNow, pushNow, resetSyncState, resumeSaves, holdServerOwnedSave, releaseServerOwnedSave, suspendSaves } from '../src/cloud/sync.js'

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

  it('sends nothing while something else owns this character\u2019s save', () => {
    // A co-op room holds the save for the whole fight (CombatScreen suspends the
    // loop on the session), and a beacon fires on exactly the event that ends a
    // co-op socket: the phone locking, the tab going away. Leaking one there
    // aims the client's pre-fight blob at /api/save for the rest of the fight —
    // and because a beacon's outcome is unreadable, it also moved the local
    // revision and settled the ledgers as though the server had taken it.
    resetSyncState()
    sendSaveBeacon.mockClear()
    holdServerOwnedSave()
    try {
      expect(beaconSaveNow({ stats: { attack: { xp: 5 } } })).toBe(false)
      expect(sendSaveBeacon).not.toHaveBeenCalled()
    } finally {
      releaseServerOwnedSave()
    }

    // ...and the hold lifting leaves the beacon working, revision intact.
    expect(beaconSaveNow({ stats: { attack: { xp: 5 } } })).toBe(true)
    expect(sendSaveBeacon.mock.calls[0][1]).toMatchObject({ saveRevision: 0 })
  })

  it('keeps the hold when one fight releases it after the next has taken it', () => {
    // Leaving a room releases only once the server's write-back has been pulled,
    // so a player who joins the next room in between has the old room's release
    // land on top of the new room's hold.
    resetSyncState()
    sendSaveBeacon.mockClear()
    holdServerOwnedSave()
    holdServerOwnedSave()
    releaseServerOwnedSave()

    expect(beaconSaveNow({ stats: { attack: { xp: 5 } } })).toBe(false)
    expect(sendSaveBeacon).not.toHaveBeenCalled()
    releaseServerOwnedSave()
  })

  it('still flushes a teardown while a CLIENT-owned operation holds the loop', () => {
    // suspendSaves is also raised by the paid skip (gameState's lockGame), which
    // holds the only copy of an hour the server has already charged a credit
    // for. A teardown there is the flush that saves it, so the beacon must not
    // be gated on the generic refcount.
    resetSyncState()
    sendSaveBeacon.mockClear()
    suspendSaves()
    try {
      expect(beaconSaveNow({ stats: { attack: { xp: 5 } } })).toBe(true)
      expect(sendSaveBeacon).toHaveBeenCalledTimes(1)
    } finally {
      resumeSaves()
    }
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
