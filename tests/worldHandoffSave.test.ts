// The bug this guards: the open world runs in its own TAB, so the idle game
// keeps ticking behind it and every IndexedDB write stamps the local-write
// marker. The world is meanwhile the save's only writer (its grant flush;
// /api/save is locked for the whole session). On the next boot
// isLocalWriteNewerThanCloud() then reported "local is newer" — true by clock,
// false by content — and App.jsx skipped the cloud copy, throwing away
// everything the session earned. A Wilderness kill's whole loot pile vanished,
// and the next push made it permanent.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../src/cloud/api.js', () => ({
  SAVE_REVISION_EVENT: 'pocketrpg:cloud-save-revision',
  api: { putSave: vi.fn(), getSave: vi.fn() },
  getToken: () => 'token',
  getCharacterId: () => 123,
  setLocalCharacterId: vi.fn(),
}))

vi.mock('../src/db/saveload.js', () => ({
  buildSavePayloadFromSnapshot: (snapshot: unknown) => snapshot,
  applySavePayload: vi.fn(),
}))

function fakeLocalStorage() {
  const store = new Map<string, string>()
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
    removeItem: (k: string) => { store.delete(k) },
  }
}

const HOUR = 3_600_000

describe('world handoff vs the boot-time cloud pull', () => {
  beforeEach(() => {
    vi.resetModules()
    ;(globalThis as any).localStorage = fakeLocalStorage()
  })

  afterEach(() => {
    delete (globalThis as any).localStorage
  })

  it('keeps a genuinely newer local change when no world session is involved', async () => {
    const { isLocalWriteNewerThanCloud } = await import('../src/cloud/sync.js')
    localStorage.setItem('pocketrpg_lastLocalWriteAt', String(Date.now()))
    expect(isLocalWriteNewerThanCloud(Date.now() - HOUR)).toBe(true)
  })

  it('lets the cloud copy win after a world handoff, however fresh the local write is', async () => {
    const { isLocalWriteNewerThanCloud } = await import('../src/cloud/sync.js')
    const { markWorldHandoff } = await import('../src/cloud/worldHandoff.js')
    markWorldHandoff()
    // The idle tab kept ticking the whole session, so its marker is newest.
    localStorage.setItem('pocketrpg_lastLocalWriteAt', String(Date.now()))
    expect(isLocalWriteNewerThanCloud(Date.now() - HOUR)).toBe(false)
  })

  it('restores local precedence once we have adopted the cloud copy', async () => {
    const { isLocalWriteNewerThanCloud, applyCloudSave } = await import('../src/cloud/sync.js')
    const { markWorldHandoff } = await import('../src/cloud/worldHandoff.js')
    markWorldHandoff()
    await applyCloudSave({}, Date.now() - HOUR, 7)
    localStorage.setItem('pocketrpg_lastLocalWriteAt', String(Date.now()))
    expect(isLocalWriteNewerThanCloud(Date.now() - HOUR)).toBe(true)
  })

  it('restores local precedence when a push succeeds — nothing else owns the save', async () => {
    const { clearWorldHandoff, markWorldHandoff, hasPendingWorldHandoff } = await import('../src/cloud/worldHandoff.js')
    markWorldHandoff()
    expect(hasPendingWorldHandoff()).toBe(true)
    // sync.js calls this on every accepted putSave; a lock-refused push does not.
    clearWorldHandoff()
    expect(hasPendingWorldHandoff()).toBe(false)
  })
})
