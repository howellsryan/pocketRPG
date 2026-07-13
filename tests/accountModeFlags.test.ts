import { describe, it, expect, beforeEach } from 'vitest'
import { syncAccountModeFlags, getOneLifeMode, getIronmanMode } from '../src/cloud/api.js'

// Minimal localStorage shim — api.js reads/writes these flags synchronously.
function installLocalStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial))
  ;(globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
    removeItem: (k: string) => { store.delete(k) },
  }
}

describe('syncAccountModeFlags', () => {
  beforeEach(() => installLocalStorage())

  it('re-anchors a stale one_life=true to a normal loaded profile (no wrongful wipe)', () => {
    installLocalStorage({ pocketrpg_one_life_mode: 'true', pocketrpg_ironman_mode: 'true' })
    syncAccountModeFlags({ is_ironman: false, is_one_life: false })
    expect(getOneLifeMode()).toBe(false)
    expect(getIronmanMode()).toBe(false)
  })

  it('re-anchors a stale one_life=false to a one-life loaded profile (death now reverts the flag)', () => {
    installLocalStorage({ pocketrpg_one_life_mode: 'false' })
    syncAccountModeFlags({ is_ironman: true, is_one_life: true })
    expect(getOneLifeMode()).toBe(true)
    expect(getIronmanMode()).toBe(true)
  })

  it('ignores a missing/invalid profile rather than clobbering the flags', () => {
    installLocalStorage({ pocketrpg_one_life_mode: 'true' })
    syncAccountModeFlags(null as any)
    syncAccountModeFlags(undefined as any)
    expect(getOneLifeMode()).toBe(true)
  })

  it('only touches a field the profile actually carries', () => {
    installLocalStorage({ pocketrpg_one_life_mode: 'true', pocketrpg_ironman_mode: 'true' })
    syncAccountModeFlags({ is_one_life: false }) // no is_ironman key present
    expect(getOneLifeMode()).toBe(false)
    expect(getIronmanMode()).toBe(true) // untouched
  })
})
