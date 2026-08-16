// Regression guard: /api/save stamps settings.activeTask onto the server's idle
// row (character_idle_state), which is what boot and visibility-return read to
// decide what to idle-simulate. A queued save is built from a snapshot captured
// EARLIER — up to the push debounce — so starting an action and going idle
// straight away used to flush a payload whose activeTask predated the action,
// blanking the row and losing the idle resume entirely. The sync layer therefore
// reads the task live at push time.

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

import { pushNow, beaconSaveNow, resetSyncState, saveContentKey, setLiveActiveTaskProvider } from '../src/cloud/sync.js'

const chopping = { type: 'skill', skill: 'woodcutting', action: { id: 'oak' } }

// The snapshot a periodic save captured before the player started chopping.
const staleSnapshot = () => ({ stats: { woodcutting: { xp: 100 } }, settings: { currentHP: 10, activeTask: null } })

function pushedPayload() {
  return JSON.parse(putSave.mock.calls[putSave.mock.calls.length - 1][0] as string)
}
function beaconedPayload() {
  return JSON.parse(sendSaveBeacon.mock.calls[sendSaveBeacon.mock.calls.length - 1][0] as string)
}

describe('live active-task override on save push', () => {
  beforeEach(() => {
    resetSyncState()
    setLiveActiveTaskProvider(null)
    putSave.mockClear()
    sendSaveBeacon.mockClear()
  })

  it('sends the task the player actually started, not the one the snapshot was captured with', async () => {
    setLiveActiveTaskProvider(() => chopping)

    expect(await pushNow(staleSnapshot())).toBe(true)
    expect(pushedPayload().settings.activeTask).toEqual(chopping)
  })

  it('applies the same override on the teardown beacon', () => {
    setLiveActiveTaskProvider(() => chopping)

    expect(beaconSaveNow(staleSnapshot())).toBe(true)
    expect(beaconedPayload().settings.activeTask).toEqual(chopping)
  })

  it('writes null when the player has genuinely stopped, so the idle row clears', async () => {
    setLiveActiveTaskProvider(() => null)

    expect(await pushNow({ stats: {}, settings: { activeTask: chopping } })).toBe(true)
    expect(pushedPayload().settings.activeTask).toBeNull()
  })

  it('adds a settings object to a payload that has none rather than dropping the task', async () => {
    setLiveActiveTaskProvider(() => chopping)

    expect(await pushNow({ stats: { woodcutting: { xp: 100 } } })).toBe(true)
    expect(pushedPayload().settings.activeTask).toEqual(chopping)
  })

  it('leaves the payload untouched with no provider registered (offline mode)', async () => {
    expect(await pushNow(staleSnapshot())).toBe(true)
    expect(pushedPayload().settings.activeTask).toBeNull()
  })

  it('leaves the payload untouched when the provider throws', async () => {
    setLiveActiveTaskProvider(() => { throw new Error('boom') })

    expect(await pushNow(staleSnapshot())).toBe(true)
    expect(pushedPayload().settings.activeTask).toBeNull()
  })

  it('runs before the dirty check, so starting an action is never skipped as a no-op', async () => {
    // Same snapshot both times — only the live task changes. The override has to
    // be applied before saveContentKey or the second push is skipped as a no-op
    // and the idle row keeps saying "nothing running".
    setLiveActiveTaskProvider(() => null)
    expect(await pushNow(staleSnapshot())).toBe(true)
    expect(putSave).toHaveBeenCalledTimes(1)

    setLiveActiveTaskProvider(() => chopping)
    expect(await pushNow(staleSnapshot())).toBe(true)
    expect(putSave).toHaveBeenCalledTimes(2)
    expect(pushedPayload().settings.activeTask).toEqual(chopping)
  })

  it('does not defeat the no-op skip once the task is unchanged', async () => {
    setLiveActiveTaskProvider(() => chopping)
    expect(await pushNow(staleSnapshot())).toBe(true)
    expect(putSave).toHaveBeenCalledTimes(1)

    // Task counted down a tick; nothing else moved → still a no-op.
    setLiveActiveTaskProvider(() => ({ ...chopping, ticksRemaining: 3 }))
    expect(await pushNow(staleSnapshot())).toBe(true)
    expect(putSave).toHaveBeenCalledTimes(1)
  })
})

describe('saveContentKey with an overridden task', () => {
  it('keys on task identity so a start/stop always reaches the server', () => {
    const stopped = { timestamp: 1, settings: { activeTask: null } }
    const started = { timestamp: 1, settings: { activeTask: chopping } }
    expect(saveContentKey(stopped)).not.toBe(saveContentKey(started))
  })
})
