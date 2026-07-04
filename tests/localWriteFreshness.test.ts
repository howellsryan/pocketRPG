// Boot-time cloud pull vs. local IndexedDB freshness. A fresh page load has no
// memory of what this device already pushed (lastPushedAt/lastSaveRevision in
// cloud/sync.js reset to zero on every reload), so without a persisted marker
// a boot-time cloud pull always wins over IDB — even when IDB holds a
// just-made local change (settings toggle, bank tag edit, world-map move)
// that the debounced/critical push hasn't reached the server yet.

import { describe, it, expect, beforeEach, vi } from 'vitest'

function installLocalStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial))
  ;(globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
    removeItem: (k: string) => { store.delete(k) },
  }
}

vi.mock('../src/cloud/api.js', () => ({
  api: { putSave: vi.fn(async () => ({ ok: true, updatedAt: 123, save_revision: 1 })) },
  getToken: () => 'token',
  getCharacterId: () => '42',
  setLocalCharacterId: () => {},
  sendSaveBeacon: () => true,
  SAVE_REVISION_EVENT: 'pocketrpg:save-revision',
}))

vi.mock('../src/db/saveload.js', () => ({
  buildSavePayloadFromSnapshot: (snap: any) => ({ version: 1, timestamp: Date.now(), ...snap }),
  applySavePayload: vi.fn(async () => {}),
}))

import { applyCloudSave, isLocalWriteNewerThanCloud, resetSyncState } from '../src/cloud/sync.js'
import { saveSetting } from '../src/db/stores.js'

vi.mock('../src/db/database.js', () => {
  const settings = new Map<string, any>()
  return {
    getDB: async () => ({
      get: async (store: string, key: string) => (store === 'settings' ? settings.get(key) : undefined),
      put: async (store: string, value: any, key: string) => { if (store === 'settings') settings.set(key, value) },
    }),
  }
})

describe('isLocalWriteNewerThanCloud', () => {
  beforeEach(() => {
    installLocalStorage()
    resetSyncState()
  })

  it('is false with no local-write marker (fresh device / never mutated)', () => {
    expect(isLocalWriteNewerThanCloud(1_000_000)).toBe(false)
  })

  it('is true once a setting is saved locally after the cloud copy was made', async () => {
    const cloudUpdatedAt = Date.now() - 60_000 // cloud save from a minute ago
    await saveSetting('showInfoToasts', true) // stamps the marker to "now"
    expect(isLocalWriteNewerThanCloud(cloudUpdatedAt)).toBe(true)
  })

  it('is false when the cloud save is newer than the local write (another device pushed since)', async () => {
    await saveSetting('worldLocation', 'oak_village')
    const cloudUpdatedAt = Date.now() + 60_000 // cloud save from the future relative to our write
    expect(isLocalWriteNewerThanCloud(cloudUpdatedAt)).toBe(false)
  })

  it('applyCloudSave resets the marker so the adoption itself is not mistaken for a pending local change', async () => {
    await saveSetting('bankConfig', { tabs: ['Runes'] })
    expect(isLocalWriteNewerThanCloud(Date.now() - 60_000)).toBe(true)

    await applyCloudSave({ version: 1, timestamp: Date.now(), settings: {} }, Date.now())

    // Immediately after adopting the cloud copy, IDB matches the cloud — a
    // boot moments later must not think there's still an unsynced local write.
    expect(isLocalWriteNewerThanCloud(Date.now())).toBe(false)
  })
})
