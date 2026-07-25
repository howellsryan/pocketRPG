import { describe, it, expect } from 'vitest'
import { resolveWorldOrigin } from '../src/utils/worldOrigin.js'

const PROD = 'https://world.pocketrpg.co.uk'
const PREVIEW = 'https://pocketrpg-world-preview.rlh.workers.dev'

describe('resolveWorldOrigin', () => {
  it('sends production players at the production world Worker', () => {
    expect(resolveWorldOrigin('pocketrpg.co.uk')).toBe(PROD)
    expect(resolveWorldOrigin('www.pocketrpg.co.uk')).toBe(PROD)
    expect(resolveWorldOrigin('PocketRPG.co.uk')).toBe(PROD)
  })

  it('keeps preview and local players on the preview world Worker (preview D1)', () => {
    expect(resolveWorldOrigin('preview.pocketrpg.pages.dev')).toBe(PREVIEW)
    expect(resolveWorldOrigin('abc123.pocketrpg.pages.dev')).toBe(PREVIEW)
    expect(resolveWorldOrigin('localhost')).toBe(PREVIEW)
    expect(resolveWorldOrigin('')).toBe(PREVIEW)
  })

  it('sends the native shell at production, whatever its local host is', () => {
    expect(resolveWorldOrigin('localhost', true)).toBe(PROD)
  })

  it('never treats a lookalike host as production', () => {
    expect(resolveWorldOrigin('pocketrpg.co.uk.evil.com')).toBe(PREVIEW)
  })
})
