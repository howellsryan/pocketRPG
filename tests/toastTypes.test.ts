import { describe, it, expect } from 'vitest'
import { TOAST_STYLES, TOAST_ICONS, isSuppressibleToastType } from '../src/utils/toastTypes.js'

describe('toast styling', () => {
  it('gives every toast type both a style and an icon, warning included', () => {
    for (const type of Object.keys(TOAST_STYLES)) {
      expect(TOAST_ICONS[type], `missing icon for '${type}'`).toBeTruthy()
    }
    for (const type of Object.keys(TOAST_ICONS)) {
      expect(TOAST_STYLES[type], `missing style for '${type}'`).toBeTruthy()
    }
    expect(TOAST_STYLES.warning).toEqual({ accent: 'var(--color-amber-light)', bar: 'var(--color-amber)' })
    expect(TOAST_ICONS.warning).toBe('⚠️')
  })
})

describe('toast suppression (showInfoToasts setting)', () => {
  it('only ever suppresses info toasts — a blocking warning always shows', () => {
    expect(isSuppressibleToastType('info')).toBe(true)
    for (const type of Object.keys(TOAST_STYLES)) {
      if (type === 'info') continue
      expect(isSuppressibleToastType(type), `'${type}' must not be suppressible`).toBe(false)
    }
  })
})
