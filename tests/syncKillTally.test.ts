// How the idle game's kill tally rides a cloud push. It is a side channel on
// the save, exactly like the declared loss ledger, and for the same reason: an
// ordinary kill must build a kill count without costing a cloud write of its
// own (§6).
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

import { pushNow, resetSyncState, applyCloudSave, beaconSaveNow } from '../src/cloud/sync.js'
import { readKillTally, recordKills, resetKillTally } from '../src/engine/killTally.js'

const killsOf = (call: number) => putSave.mock.calls[call]?.[1]?.kills ?? null

beforeEach(() => {
  putSave.mockClear()
  sendSaveBeacon.mockClear()
  resetSyncState()
  resetKillTally()
})

describe('kill tally on a push', () => {
  it('ships the tally and settles it once the push lands', async () => {
    recordKills('green_dragon', 12)
    await pushNow({ stats: { attack: { xp: 1 } } })

    expect(killsOf(0)).toEqual({ green_dragon: 12 })
    expect(readKillTally()).toBeNull()
  })

  it('sends no kills field when nothing was killed', async () => {
    await pushNow({ stats: { attack: { xp: 1 } } })
    expect(killsOf(0)).toBeNull()
  })

  it('keeps kills made while the push was on the wire for the next one', async () => {
    recordKills('green_dragon', 5)
    let release: () => void = () => {}
    putSave.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { release = resolve })
      return { ok: true, updatedAt: 123, save_revision: 1 }
    })
    const inFlight = pushNow({ stats: { attack: { xp: 1 } } })
    recordKills('green_dragon', 3)
    release()
    await inFlight

    expect(killsOf(0)).toEqual({ green_dragon: 5 })
    expect(readKillTally()).toEqual({ green_dragon: 3 })
  })

  it('never re-sends a tally that is still on the wire', async () => {
    // Captured with the snapshot, a batch scheduled during an in-flight push
    // still contained that push's kills (it is only settled when the push
    // LANDS), so D1 recorded them twice.
    recordKills('green_dragon', 15)
    let release: () => void = () => {}
    putSave.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { release = resolve })
      return { ok: true, updatedAt: 123, save_revision: 1 }
    })
    const first = pushNow({ stats: { attack: { xp: 1 } } })
    // A second push is queued while the first is still open.
    const second = pushNow({ stats: { attack: { xp: 2 } } })
    release()
    await first
    await second

    expect(killsOf(0)).toEqual({ green_dragon: 15 })
    expect(killsOf(1)).toBeNull()
    expect(readKillTally()).toBeNull()
  })

  it('ships the tally on a teardown beacon too', async () => {
    recordKills('green_dragon', 4)
    beaconSaveNow({ stats: { attack: { xp: 1 } } })
    expect(sendSaveBeacon.mock.calls[0][1].kills).toEqual({ green_dragon: 4 })
    expect(readKillTally()).toBeNull()
  })

  it('leaves the tally to the in-flight push rather than beaconing it twice', async () => {
    // Both would apply on the idle-ceiling path, which answers ok without
    // bumping the revision — so the guard that 409s one of them is not there.
    recordKills('green_dragon', 6)
    let release: () => void = () => {}
    putSave.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { release = resolve })
      return { ok: true, updatedAt: 123, save_revision: 1 }
    })
    const inFlight = pushNow({ stats: { attack: { xp: 1 } } })
    beaconSaveNow({ stats: { attack: { xp: 2 } } })
    expect(sendSaveBeacon.mock.calls[0][1].kills).toBeNull()
    release()
    await inFlight
    expect(killsOf(0)).toEqual({ green_dragon: 6 })
    expect(readKillTally()).toBeNull()
  })

  // Unlike the loss ledger, which describes the very blob the server replaced.
  // Kill counts live in their own D1 table, and every /api/save path that banks
  // them answers `ok` — all three refusals return first. So a rolled-back write
  // banked nothing, and the tally it kept is exactly what still needs sending.
  it('keeps the tally when a server copy is adopted — kill counts are not in the blob', async () => {
    recordKills('green_dragon', 9)
    await applyCloudSave({ version: 1 }, 123, 4)
    expect(readKillTally()).toEqual({ green_dragon: 9 })
  })

  // Co-op exit is leave → pullSave → applyCloudSave, and the co-op lock branch
  // in performPush deliberately keeps the tally through the refused push. The
  // adopt that follows a moment later must not undo that.
  it('survives the pull that follows a co-op fight, which the lock branch preserved it for', async () => {
    recordKills('green_dragon', 4)
    putSave.mockRejectedValueOnce(Object.assign(new Error('locked'), {
      status: 409, body: { code: 'CHARACTER_IN_COOP_SESSION' },
    }))
    await pushNow({ stats: {} })
    expect(readKillTally()).toEqual({ green_dragon: 4 })
    await applyCloudSave({ version: 1 }, 456, 7)
    expect(readKillTally()).toEqual({ green_dragon: 4 })
  })

  // A closing tab's beacon skips the tally when a push is already on the wire,
  // on the documented promise that it "rides the next session's first save".
  // Boot is pull-then-adopt, so an adopt that reset would break that promise
  // before the next session ever pushed.
  it('carries a closing tab\'s unsent kills through the next boot\'s adopt', async () => {
    recordKills('field_chicken', 12)
    await applyCloudSave({ version: 1 }, 999, 3)
    await pushNow({ stats: { attack: { xp: 40 } } })
    expect(killsOf(0)).toEqual({ field_chicken: 12 })
  })

  // The one case where the tally may already have been banked: a push whose ok
  // was lost still wrote, and the next push 409s on the revision that write
  // moved. Keeping the tally there would count the same kills twice.
  it('drops the tally on a save-revision conflict, which is evidence a push landed unseen', async () => {
    recordKills('field_chicken', 7)
    putSave.mockRejectedValueOnce(Object.assign(new Error('stale'), {
      status: 409, body: { code: 'SAVE_REVISION_CONFLICT', current_revision: 9 },
    }))
    await pushNow({ stats: { attack: { xp: 40 } } })
    expect(readKillTally()).toBeNull()
  })

  it('is cleared by resetSyncState, which owns logout and character switch', async () => {
    recordKills('green_dragon', 5)
    resetSyncState()
    expect(readKillTally()).toBeNull()
  })
})
