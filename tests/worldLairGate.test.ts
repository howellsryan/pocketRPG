// Grondar's lair ships to production while the overworld does not, so the two
// gates must stay separate flags. Collapsing them back together is exactly the
// regression these tests exist to catch — one of them would either hide the
// boss room or open the whole world.
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { worldBetaEnabled, worldBossLairsEnabled, worldOrigin } from '../src/utils/helpers.js'

const root = (p: string) => resolve(__dirname, '..', p)
const globals = globalThis as Record<string, unknown>

afterEach(() => {
  delete globals.pocketWorldBetaEnabled
  delete globals.pocketWorldLairsEnabled
  delete globals.pocketWorldOrigin
})

describe('open-world gates', () => {
  it('opens the boss lair while the overworld stays shut — the production shape', () => {
    globals.pocketWorldBetaEnabled = false
    globals.pocketWorldLairsEnabled = true
    expect(worldBossLairsEnabled()).toBe(true)
    expect(worldBetaEnabled()).toBe(false)
  })

  it('lets the lair flag shut the boss room without touching the beta', () => {
    globals.pocketWorldBetaEnabled = true
    globals.pocketWorldLairsEnabled = false
    expect(worldBossLairsEnabled()).toBe(false)
    expect(worldBetaEnabled()).toBe(true)
  })

  it('defaults both on when nothing is baked (Vite dev)', () => {
    expect(worldBossLairsEnabled()).toBe(true)
    expect(worldBetaEnabled()).toBe(true)
  })
})

describe('world origin', () => {
  it('uses the baked origin', () => {
    globals.pocketWorldOrigin = 'https://world.pocketrpg.co.uk'
    expect(worldOrigin()).toBe('https://world.pocketrpg.co.uk')
  })

  it('falls back to preview, never production, when unbaked', () => {
    expect(worldOrigin()).toBe('https://pocketrpg-world-preview.rlh.workers.dev')
  })
})

describe('build bake', () => {
  const build = readFileSync(root('build_single.cjs'), 'utf8')

  it('ships both new globals in the game chunk', () => {
    expect(build).toContain('const pocketWorldLairsEnabled = ${worldLairsEnabled}')
    expect(build).toContain('const pocketWorldOrigin = ${JSON.stringify(worldOrigin)}')
  })

  it('sends only a main build at the production world Worker', () => {
    expect(build).toContain("process.env.CF_PAGES_BRANCH === 'main'\n    ? 'https://world.pocketrpg.co.uk'")
  })
})

describe('entry points', () => {
  it('gates the combat picker on the lair flag, not the world beta', () => {
    const screen = readFileSync(root('src/screens/CombatScreen.jsx'), 'utf8')
    expect(screen).toContain('worldBossLairsEnabled()')
    expect(screen).not.toContain('worldBetaEnabled')
  })

  it('keeps the Help screen "Enter World" button on the world beta', () => {
    const screen = readFileSync(root('src/screens/HelpScreen.jsx'), 'utf8')
    expect(screen).toContain('worldBetaEnabled()')
    expect(screen).not.toContain('worldBossLairsEnabled')
  })
})
