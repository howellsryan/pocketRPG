// Theme preference: 'light' | 'dark' | 'system'. Resolves to the concrete
// theme stamped on <html data-theme>, which drives the layer-2 tokens in
// src/index.css.
//
// localStorage is the AUTHORITY, not the save blob. The save is locked outright
// during a PvP match, a co-op boss session and a live world session (CLAUDE.md
// §14/§20) — sync.js *drops* a push refused by the co-op lock — so a theme
// changed mid-fight would silently revert on the next pull. The save mirror is
// a cross-device convenience only, and it never wins over a local choice.

export const THEME_STORAGE_KEY = 'pocketrpg_theme'
export const THEME_PREFERENCES = ['light', 'dark', 'system']

export const THEME_OPTIONS = [
  { id: 'light', label: 'Parchment' },
  { id: 'dark', label: 'Iron' },
  { id: 'system', label: 'System' },
]

// Existing players keep the parchment identity they installed; dark is opt-in.
export const DEFAULT_THEME_PREFERENCE = 'light'

export function isThemePreference(value) {
  return THEME_PREFERENCES.includes(value)
}

export function normalizeThemePreference(value) {
  return isThemePreference(value) ? value : DEFAULT_THEME_PREFERENCE
}

export function prefersDarkScheme() {
  try {
    return !!(globalThis.matchMedia && globalThis.matchMedia('(prefers-color-scheme: dark)').matches)
  } catch {
    return false
  }
}

// 'system' is resolved against the OS at call time, so a preference of
// 'system' follows the device without any stored value changing.
export function resolveTheme(preference, systemPrefersDark = prefersDarkScheme()) {
  const pref = normalizeThemePreference(preference)
  if (pref === 'system') return systemPrefersDark ? 'dark' : 'light'
  return pref
}

export function readStoredThemePreference() {
  try {
    const raw = globalThis.localStorage?.getItem(THEME_STORAGE_KEY)
    return isThemePreference(raw) ? raw : null
  } catch {
    return null
  }
}

export function storeThemePreference(preference) {
  try {
    globalThis.localStorage?.setItem(THEME_STORAGE_KEY, normalizeThemePreference(preference))
  } catch { /* private mode — the in-memory preference still applies this session */ }
}

export function applyTheme(preference) {
  const theme = resolveTheme(preference)
  const root = globalThis.document?.documentElement
  if (root) {
    root.setAttribute('data-theme', theme)
    const meta = globalThis.document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#14110d' : '#e6d8b6')
  }
  return theme
}

// Fires only while the preference is 'system'; returns an unsubscribe.
export function watchSystemTheme(onChange) {
  let mq = null
  try {
    mq = globalThis.matchMedia?.('(prefers-color-scheme: dark)') || null
  } catch {
    return () => {}
  }
  if (!mq?.addEventListener) return () => {}
  const handler = () => onChange(mq.matches)
  mq.addEventListener('change', handler)
  return () => mq.removeEventListener('change', handler)
}
