import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { worldBetaEnabled, worldBossLairsEnabled, worldOrigin } from '../src/utils/helpers.js'

beforeEach(() => vi.stubGlobal('window', { location: { href: 'https://preview.example.workers.dev/' } }))
afterEach(() => vi.unstubAllGlobals())

describe('preview-only world entry', () => {
  it('keeps all world entry closed without baked flags, including Vite/native builds', () => {
    expect(worldBetaEnabled()).toBe(false)
    expect(worldBossLairsEnabled()).toBe(false)
  })
  it('closes boss lairs when the world beta is disabled', () => {
    vi.stubGlobal('pocketWorldBetaEnabled', false)
    vi.stubGlobal('pocketWorldLairsEnabled', true)
    expect(worldBetaEnabled()).toBe(false)
    expect(worldBossLairsEnabled()).toBe(false)
  })
  it('allows preview world entry while retaining the independent lair opt-out', () => {
    vi.stubGlobal('pocketWorldBetaEnabled', true)
    vi.stubGlobal('pocketWorldLairsEnabled', false)
    expect(worldBetaEnabled()).toBe(true)
    expect(worldBossLairsEnabled()).toBe(false)
  })
  it('does not accept truthy strings as baked opt-in', () => {
    vi.stubGlobal('pocketWorldBetaEnabled', 'true')
    expect(worldBetaEnabled()).toBe(false)
    expect(worldBossLairsEnabled()).toBe(false)
  })
  it.each(['https://pocketrpg.co.uk/', 'https://www.pocketrpg.co.uk/', 'https://world.pocketrpg.co.uk/', 'https://pocketrpg.co.uk./', 'https://pocketrpg-app.rlh.workers.dev/'])('refuses an accidentally enabled bundle at %s', href => {
    vi.stubGlobal('window', { location: { href } })
    vi.stubGlobal('pocketWorldBetaEnabled', true)
    vi.stubGlobal('pocketWorldLairsEnabled', true)
    expect(worldBetaEnabled()).toBe(false)
    expect(worldBossLairsEnabled()).toBe(false)
  })
  it('refuses a native shell pointing to the production API', () => {
    vi.stubGlobal('window', { location: { href: 'capacitor://localhost/' } })
    vi.stubGlobal('Capacitor', { isNativePlatform: () => true })
    vi.stubGlobal('pocketWorldBetaEnabled', true)
    expect(worldBetaEnabled()).toBe(false)
  })
})

describe('world origin', () => {
  it('uses the baked same-origin world path', () => {
    vi.stubGlobal('pocketWorldOrigin', '/world')
    expect(worldOrigin()).toBe('/world')
  })
  it('falls back to a same-origin path when unbaked', () => {
    expect(worldOrigin()).toBe('/world')
  })
})
