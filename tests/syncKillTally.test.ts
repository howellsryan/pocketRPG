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

  it('ships the tally on a teardown beacon too', async () => {
    recordKills('green_dragon', 4)
    beaconSaveNow({ stats: { attack: { xp: 1 } } })
    expect(sendSaveBeacon.mock.calls[0][1].kills).toEqual({ green_dragon: 4 })
    expect(readKillTally()).toBeNull()
  })

  it('drops the tally when a server copy is adopted — that window is superseded', async () => {
    recordKills('green_dragon', 9)
    await applyCloudSave({ version: 1 }, 123, 4)
    expect(readKillTally()).toBeNull()
  })
})
