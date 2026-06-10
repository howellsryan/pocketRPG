// Client-side save dirty check (Phase 6.2): the sync layer skips the network
// push when the snapshot serializes to the same content as the last
// successful push (ignoring the volatile payload timestamp), so pure-idle
// tabs stop generating a DB write every 60s.

import { describe, it, expect, vi } from 'vitest'

const putSave = vi.fn(async () => ({ ok: true, updatedAt: 123, save_revision: 1 }))

vi.mock('../src/cloud/api.js', () => ({
  api: { putSave: (...args: any[]) => putSave(...args) },
  getToken: () => 'token',
  getCharacterId: () => '42',
  setLocalCharacterId: () => {},
  SAVE_REVISION_EVENT: 'pocketrpg:save-revision',
}))

vi.mock('../src/db/saveload.js', () => ({
  // Mirrors the real builder's volatile timestamp stamp.
  buildSavePayloadFromSnapshot: (snap: any) => ({ version: 1, timestamp: Date.now(), ...snap }),
  applySavePayload: async () => {},
}))

import { pushNow, resetSyncState, saveContentKey } from '../src/cloud/sync.js'

describe('saveContentKey', () => {
  it('ignores the volatile timestamp but nothing else', () => {
    const a = saveContentKey({ timestamp: 1, stats: { attack: { xp: 5 } } })
    const b = saveContentKey({ timestamp: 2, stats: { attack: { xp: 5 } } })
    const c = saveContentKey({ timestamp: 2, stats: { attack: { xp: 6 } } })
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })
})

describe('push dirty check', () => {
  it('skips the network push when content is unchanged since the last success', async () => {
    resetSyncState()
    putSave.mockClear()

    const snap = { stats: { attack: { xp: 5 } } }
    expect(await pushNow(snap)).toBe(true)
    expect(putSave).toHaveBeenCalledTimes(1)

    // Same content, new timestamp — no push.
    expect(await pushNow({ stats: { attack: { xp: 5 } } })).toBe(true)
    expect(putSave).toHaveBeenCalledTimes(1)

    // Changed content — pushes again.
    expect(await pushNow({ stats: { attack: { xp: 9 } } })).toBe(true)
    expect(putSave).toHaveBeenCalledTimes(2)
  })

  it('resetSyncState clears the cached content key', async () => {
    resetSyncState()
    putSave.mockClear()

    const snap = { stats: { attack: { xp: 5 } } }
    await pushNow(snap)
    resetSyncState()
    await pushNow({ stats: { attack: { xp: 5 } } })
    expect(putSave).toHaveBeenCalledTimes(2)
  })
})
