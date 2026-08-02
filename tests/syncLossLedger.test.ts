// How the declared loss ledger rides a cloud push (Phase 3a of the item-loss
// safety net). The invariant these guard is the pairing: the ledger a push
// declares must describe the SNAPSHOT it is sending, not the moment it happens
// to reach the network. A snapshot is captured on the 60s/120s heartbeat and
// then sits in the 120s debounce, so a flush-time read declares spends the
// payload does not yet contain — and settling drops them, leaving the save that
// finally carries them looking unexplained. That is the exact noise the ledger
// exists to remove.
import { describe, it, expect, vi, beforeEach } from 'vitest'

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

import { pushNow, schedulePushSave, resetSyncState, applyCloudSave } from '../src/cloud/sync.js'
import { readItemLossLedger, recordItemLosses, resetItemLossLedger } from '../src/engine/lossLedger.js'

const lossesOf = (call: number) => putSave.mock.calls[call]?.[1]?.losses ?? null

beforeEach(() => {
  putSave.mockClear()
  sendSaveBeacon.mockClear()
  resetSyncState()
  resetItemLossLedger()
})

describe('declared losses on a push', () => {
  it('ships what was spent and settles it once the push lands', async () => {
    recordItemLosses({ steel_platebody: 200 })
    await pushNow({ stats: { crafting: { xp: 1 } } })

    expect(lossesOf(0)).toEqual({ steel_platebody: 200 })
    expect(readItemLossLedger()).toBeNull()
  })

  it('sends no losses field when nothing was declared', async () => {
    await pushNow({ stats: { crafting: { xp: 1 } } })
    expect(lossesOf(0)).toBeNull()
  })

  // The regression that matters: spends made after the snapshot was pinned are
  // not in the payload, so they must not be declared against it — and must
  // survive the settle to be declared by the save that does carry them.
  it('declares only what the pinned snapshot covers, and keeps the rest', async () => {
    recordItemLosses({ steel_platebody: 200 })
    schedulePushSave({ stats: { crafting: { xp: 1 } } })
    // The debounce window: the activity runner keeps spending while the pinned
    // snapshot waits to be flushed.
    recordItemLosses({ steel_platebody: 50 })

    await pushNow()
    expect(lossesOf(0)).toEqual({ steel_platebody: 200 })
    expect(readItemLossLedger()).toEqual({ steel_platebody: 50 })

    // The next save carries the later spend, and declares it.
    schedulePushSave({ stats: { crafting: { xp: 2 } } })
    await pushNow()
    expect(lossesOf(1)).toEqual({ steel_platebody: 50 })
    expect(readItemLossLedger()).toBeNull()
  })

  it('keeps the ledger when the push fails, and re-declares it on the retry', async () => {
    recordItemLosses({ steel_platebody: 200 })
    putSave.mockRejectedValueOnce(new Error('network down'))

    await pushNow({ stats: { crafting: { xp: 1 } } })
    expect(readItemLossLedger()).toEqual({ steel_platebody: 200 })

    await pushNow({ stats: { crafting: { xp: 1 } } })
    expect(lossesOf(1)).toEqual({ steel_platebody: 200 })
    expect(readItemLossLedger()).toBeNull()
  })

  // Adopting the server's copy supersedes the window the ledger described.
  it('drops the ledger when the cloud copy is adopted', async () => {
    recordItemLosses({ steel_platebody: 200 })
    await applyCloudSave({ stats: {} }, 999, 5)
    expect(readItemLossLedger()).toBeNull()
  })
})
