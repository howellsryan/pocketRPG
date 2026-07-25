// Pure open-world HUD-preference logic: schema-tolerant merge (corrupt saves
// degrade to defaults, never poison the HUD), device-driven minimap default,
// and the bottom-sheet snap thresholds.
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  hudScaleValue,
  isTabletViewport,
  mergeSettings,
  resolveMinimapMode,
  sheetHeightFor,
  sheetSnap,
  TABLET_MIN_SIDE,
} from '../client/src/uxSettings'

describe('mergeSettings', () => {
  it('returns the defaults for a null/empty payload', () => {
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(mergeSettings({})).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps valid stored fields', () => {
    const merged = mergeSettings({ minimapMode: 'off', hudScale: 'large', dock: 'left', panelOpacity: 0.75, chatAutoFade: false, haptics: false, hideChatBar: true })
    expect(merged).toEqual({ minimapMode: 'off', hudScale: 'large', dock: 'left', panelOpacity: 0.75, chatAutoFade: false, haptics: false, hideChatBar: true })
  })

  it('keeps a stored hideChatBar and rejects a non-boolean back to the default', () => {
    expect(mergeSettings({ hideChatBar: true }).hideChatBar).toBe(true)
    expect(mergeSettings({ hideChatBar: 'yes' }).hideChatBar).toBe(DEFAULT_SETTINGS.hideChatBar)
  })

  it('drops invalid fields back to their default individually', () => {
    const merged = mergeSettings({ minimapMode: 'satellite', hudScale: 'huge', dock: 'up', chatAutoFade: 'yes' })
    expect(merged.minimapMode).toBe(DEFAULT_SETTINGS.minimapMode)
    expect(merged.hudScale).toBe(DEFAULT_SETTINGS.hudScale)
    expect(merged.dock).toBe(DEFAULT_SETTINGS.dock)
    expect(merged.chatAutoFade).toBe(DEFAULT_SETTINGS.chatAutoFade)
  })

  it('preserves an explicit null minimapMode (device-decides)', () => {
    expect(mergeSettings({ minimapMode: null }).minimapMode).toBeNull()
  })

  it('clamps panel opacity into the 0.6–1 range and rejects non-numbers', () => {
    expect(mergeSettings({ panelOpacity: 0.1 }).panelOpacity).toBe(0.6)
    expect(mergeSettings({ panelOpacity: 5 }).panelOpacity).toBe(1)
    expect(mergeSettings({ panelOpacity: 'lots' }).panelOpacity).toBe(DEFAULT_SETTINGS.panelOpacity)
    expect(mergeSettings({ panelOpacity: NaN }).panelOpacity).toBe(DEFAULT_SETTINGS.panelOpacity)
  })

  it('tolerates non-object payloads', () => {
    expect(mergeSettings('nonsense')).toEqual(DEFAULT_SETTINGS)
    expect(mergeSettings(42)).toEqual(DEFAULT_SETTINGS)
  })
})

describe('resolveMinimapMode', () => {
  it('lets an explicit mode win over the device default', () => {
    expect(resolveMinimapMode({ ...DEFAULT_SETTINGS, minimapMode: 'off' }, false)).toBe('off')
    expect(resolveMinimapMode({ ...DEFAULT_SETTINGS, minimapMode: 'full' }, false)).toBe('full')
  })

  it('defaults a phone to compass and a tablet to full when unset', () => {
    expect(resolveMinimapMode({ ...DEFAULT_SETTINGS, minimapMode: null }, false)).toBe('compass')
    expect(resolveMinimapMode({ ...DEFAULT_SETTINGS, minimapMode: null }, true)).toBe('full')
  })
})

describe('isTabletViewport', () => {
  it('splits on the tablet short-side threshold', () => {
    expect(isTabletViewport(TABLET_MIN_SIDE - 1)).toBe(false)
    expect(isTabletViewport(TABLET_MIN_SIDE)).toBe(true)
    expect(isTabletViewport(393)).toBe(false) // iPhone
    expect(isTabletViewport(768)).toBe(true) // iPad
  })
})

describe('hudScaleValue', () => {
  it('maps each scale to its multiplier', () => {
    expect(hudScaleValue('compact')).toBeLessThan(1)
    expect(hudScaleValue('normal')).toBe(1)
    expect(hudScaleValue('large')).toBeGreaterThan(1)
  })
})

describe('sheetSnap', () => {
  const vh = 800
  it('dismisses when dragged below the dismiss threshold', () => {
    expect(sheetSnap(0.1 * vh, vh)).toBe('dismiss')
  })
  it('rests at peek in the low-middle band', () => {
    expect(sheetSnap(0.42 * vh, vh)).toBe('peek')
  })
  it('opens full past the peek/full midpoint', () => {
    expect(sheetSnap(0.68 * vh, vh)).toBe('full')
  })
  it('is safe with a zero viewport', () => {
    expect(sheetSnap(100, 0)).toBe('peek')
  })
})

describe('sheetHeightFor', () => {
  it('gives a taller body at full than at peek', () => {
    expect(sheetHeightFor('full', 800)).toBeGreaterThan(sheetHeightFor('peek', 800))
  })
})
