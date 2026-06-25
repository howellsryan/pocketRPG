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

import { pushNow, resetSyncState, saveContentKey, applyCloudSave } from '../src/cloud/sync.js'

describe('saveContentKey', () => {
  it('ignores the volatile timestamp but nothing else', () => {
    const a = saveContentKey({ timestamp: 1, stats: { attack: { xp: 5 } } })
    const b = saveContentKey({ timestamp: 2, stats: { attack: { xp: 5 } } })
    const c = saveContentKey({ timestamp: 2, stats: { attack: { xp: 6 } } })
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it('ignores the per-tick activeTask countdown/session churn', () => {
    const base = {
      timestamp: 1,
      stats: { mining: { xp: 100 } },
      settings: {
        currentHP: 10,
        activeTask: { type: 'skill', skill: 'mining', action: { id: 'iron_ore' }, ticksRemaining: 4, pendingTicks: 0, totalTicks: 5, session: { actions: 3, xp: 105 } },
      },
    }
    // Same real progress, task merely counted down a tick → identical key (no write).
    const ticked = {
      ...base,
      timestamp: 2,
      settings: { ...base.settings, activeTask: { ...base.settings.activeTask, ticksRemaining: 3, pendingTicks: 1, session: { actions: 3, xp: 105 } } },
    }
    expect(saveContentKey(base)).toBe(saveContentKey(ticked))
  })

  it('still keys on real progress and on task identity changes', () => {
    const base = {
      timestamp: 1,
      stats: { mining: { xp: 100 } },
      settings: { activeTask: { type: 'skill', skill: 'mining', action: { id: 'iron_ore' }, ticksRemaining: 4 } },
    }
    // Real XP gain → different key (must still write).
    const progressed = { ...base, stats: { mining: { xp: 130 } } }
    expect(saveContentKey(base)).not.toBe(saveContentKey(progressed))
    // Switched to a different action → different key (start/stop/switch still saves).
    const switched = { ...base, settings: { activeTask: { ...base.settings.activeTask, action: { id: 'coal' } } } }
    expect(saveContentKey(base)).not.toBe(saveContentKey(switched))
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

  it('applyCloudSave seeds the content key so an identical push never hits the network', async () => {
    resetSyncState()
    putSave.mockClear()

    // Adopt a cloud copy (boot pull / server-authoritative save). Its content is
    // already durable, so a subsequent push of the SAME state must be a no-op
    // client-side — never reaching the server (which would otherwise write
    // updated_at for nothing).
    await applyCloudSave({ version: 1, timestamp: 1, stats: { attack: { xp: 5 } } }, 123, 1)
    expect(await pushNow({ stats: { attack: { xp: 5 } } })).toBe(true)
    expect(putSave).not.toHaveBeenCalled()

    // Changed state still pushes.
    expect(await pushNow({ stats: { attack: { xp: 9 } } })).toBe(true)
    expect(putSave).toHaveBeenCalledTimes(1)
  })

  it('touch:true forces an identical push through the dirty check', async () => {
    resetSyncState()
    putSave.mockClear()

    const snap = { stats: { attack: { xp: 5 } } }
    await pushNow(snap)
    expect(putSave).toHaveBeenCalledTimes(1)

    // Same content without touch — skipped.
    await pushNow({ stats: { attack: { xp: 5 } } })
    expect(putSave).toHaveBeenCalledTimes(1)

    // Same content WITH touch — sent, carrying the touch flag (PvP freshness).
    await pushNow({ stats: { attack: { xp: 5 } } }, { touch: true })
    expect(putSave).toHaveBeenCalledTimes(2)
    expect(putSave.mock.calls[1][1]).toMatchObject({ touch: true })
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
