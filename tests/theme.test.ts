import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  DEFAULT_THEME_PREFERENCE,
  THEME_OPTIONS,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  isThemePreference,
  normalizeThemePreference,
  readStoredThemePreference,
  resolveTheme,
  storeThemePreference,
} from '../src/utils/theme.js'

const cssPath = resolve(__dirname, '../src/index.css')
const css = readFileSync(cssPath, 'utf8')

function block(selector: string): string {
  const start = css.indexOf(selector)
  if (start === -1) throw new Error(`missing block: ${selector}`)
  const open = css.indexOf('{', start)
  const end = css.indexOf('\n}', open)
  return css.slice(open, end)
}

function declaredTokens(body: string): Set<string> {
  return new Set(Array.from(body.matchAll(/^\s*(--[a-z0-9-]+):/gm), (m) => m[1]))
}

// The semantic layer is the whole theme; a token present in one side and not
// the other resolves to nothing and the rule silently renders unstyled.
const LIGHT = declaredTokens(block(":root,\n[data-theme='light']"))
const DARK = declaredTokens(block("[data-theme='dark']"))

describe('theme preference resolution', () => {
  it('defaults to light so existing players keep the parchment they installed', () => {
    expect(DEFAULT_THEME_PREFERENCE).toBe('light')
    expect(normalizeThemePreference(undefined)).toBe('light')
    expect(normalizeThemePreference('chartreuse')).toBe('light')
    expect(normalizeThemePreference(null)).toBe('light')
  })

  it('resolves system against the device, and light/dark verbatim', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('light', true)).toBe('light')
  })

  it('accepts exactly the three preferences the settings control offers', () => {
    expect(THEME_PREFERENCES).toEqual(['light', 'dark', 'system'])
    expect(THEME_OPTIONS.map((o) => o.id)).toEqual(THEME_PREFERENCES)
    expect(isThemePreference('system')).toBe(true)
    expect(isThemePreference('')).toBe(false)
  })
})

describe('preference storage', () => {
  const store = new Map<string, string>()
  beforeEach(() => {
    store.clear()
    ;(globalThis as any).localStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => { store.set(k, String(v)) },
    }
  })
  afterEach(() => { delete (globalThis as any).localStorage })

  it('round-trips through localStorage, which is the authority', () => {
    expect(readStoredThemePreference()).toBeNull()
    storeThemePreference('dark')
    expect(store.get(THEME_STORAGE_KEY)).toBe('dark')
    expect(readStoredThemePreference()).toBe('dark')
  })

  it('never stores a value the resolver would not accept', () => {
    storeThemePreference('neon' as never)
    expect(store.get(THEME_STORAGE_KEY)).toBe(DEFAULT_THEME_PREFERENCE)
  })

  it('treats a corrupted stored value as absent rather than throwing', () => {
    store.set(THEME_STORAGE_KEY, '{"not":"a theme"}')
    expect(readStoredThemePreference()).toBeNull()
  })

  it('survives storage being unavailable (private mode)', () => {
    ;(globalThis as any).localStorage = {
      getItem() { throw new Error('denied') },
      setItem() { throw new Error('denied') },
    }
    expect(() => storeThemePreference('dark')).not.toThrow()
    expect(readStoredThemePreference()).toBeNull()
  })
})

describe('the pre-paint stanza mirrors the module', () => {
  // build_single.cjs stamps data-theme in <head> before #app-splash paints, so
  // it necessarily re-implements resolveTheme in inline JS. Drift between the
  // two shows up as a flash of the wrong material on every cold load.
  const build = readFileSync(resolve(__dirname, '../build_single.cjs'), 'utf8')
  const stanzaStart = build.indexOf("localStorage.getItem('pocketrpg_theme')")
  const stanza = build.slice(stanzaStart, build.indexOf('</script>', stanzaStart))

  it('reads the same storage key', () => {
    expect(stanza).toContain(THEME_STORAGE_KEY)
  })

  it('falls back to the same default', () => {
    expect(stanza).toContain(`p='${DEFAULT_THEME_PREFERENCE}'`)
    expect(stanza).toContain(`setAttribute('data-theme','${DEFAULT_THEME_PREFERENCE}')`)
  })

  it('resolves system against prefers-color-scheme', () => {
    expect(stanza).toContain('prefers-color-scheme: dark')
  })

  it('swaps the theme-color meta to the two page grounds', () => {
    const lightPage = css.match(/--surface-page:\s*var\(--fm-vellum\)/)
    expect(lightPage).not.toBeNull()
    expect(stanza).toContain('#14110d') // --fm-soot
    expect(stanza).toContain('#e6d8b6') // --fm-vellum
    expect(build).toContain('<meta name="theme-color"')
  })
})

describe('semantic token parity', () => {
  it('declares every semantic token in both themes', () => {
    expect([...LIGHT].sort()).toEqual([...DARK].sort())
  })

  it('covers the surfaces, text ramp and accents screens consume', () => {
    for (const token of [
      '--surface-page', '--surface-panel', '--surface-card', '--surface-raised', '--surface-sunken',
      '--surface-tex', '--surface-face', '--surface-inset', '--surface-vignette',
      '--text-strong', '--text-soft', '--text-faint', '--hairline',
      '--accent', '--accent-metal', '--btn-surface-face', '--btn-surface-ink',
    ]) {
      expect(LIGHT.has(token), `light is missing ${token}`).toBe(true)
    }
  })

  it('keeps the dark accent off --fm-ember-deep, which reads 1.8:1 on iron', () => {
    const dark = block("[data-theme='dark']")
    expect(dark).toMatch(/--accent:\s*var\(--fm-ember-hi\)/)
    expect(dark).not.toMatch(/--accent:\s*var\(--fm-ember-deep\)/)
  })

  it('keeps --text-faint off --fm-ink-faint, which reads 4.2:1 on iron', () => {
    const dark = block("[data-theme='dark']")
    expect(dark).not.toMatch(/--text-faint:\s*var\(--fm-ink-faint\)/)
  })
})

describe('themed rules do not regain parchment literals', () => {
  // The layer-1 palette is frozen because two of its names are load-bearing in
  // both themes at once (--fm-btn-ink: var(--fm-parch) is light text on an iron
  // button). A themed rule that reaches back past the semantic layer to a
  // parchment token renders parchment-on-iron in dark. This guard is allowed to
  // shrink, never to grow.
  const PARCHMENT = String.raw`--fm-(?:ink|ink-soft|ink-faint|rule|parch|parch-hi|parch-lo|parch-face|parch-inset|vellum|tex-parch)`

  function themedRegion(): string {
    // Everything after the .fm-on-iron escape block, minus the pre-login
    // landing page (out of scope — it never flips) which runs from .lp-root to
    // the boot splash.
    const start = css.indexOf('\n}', css.indexOf('.fm-on-iron,'))
    const lpStart = css.indexOf('.lp-root {')
    const lpEnd = css.indexOf('#app-splash {')
    expect(start).toBeGreaterThan(-1)
    expect(lpStart).toBeGreaterThan(start)
    expect(lpEnd).toBeGreaterThan(lpStart)
    return css.slice(start, lpStart) + css.slice(lpEnd)
  }

  // Panels that are deliberately dark in BOTH themes — the combat log, the
  // royal raid tags, the ember chat badge, the completed-collection sheet, the
  // place-map back button. Parchment there is light text on a dark chip, so it
  // is a literal, not a theme value. Shrink this list, never grow it.
  const ALWAYS_DARK = [
    '.fm-btn--iron', '.cb-area__raidtag', '.cb-logwrap', '.cb-logline--sys',
    '.cb-chat__badge', '.cb-raid__tag', '.clog-sheet.is-done', '.pm-back',
  ]

  // Split into whole rules so a declaration is judged with its selector — the
  // offenders are multi-line, and a line-by-line scan loses which rule they
  // belong to.
  function rules(region: string): { selector: string; body: string }[] {
    const stripped = region.replace(/\/\*[\s\S]*?\*\//g, '')
    return Array.from(stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g), (m) => ({
      selector: m[1].trim().replace(/\s+/g, ' '),
      body: m[2],
    }))
  }

  it('leaves no parchment token in a themed rule', () => {
    const offenders = rules(themedRegion())
      .filter((r) => new RegExp(String.raw`var\(${PARCHMENT}\)`).test(r.body))
      .filter((r) => !ALWAYS_DARK.some((sel) => r.selector.includes(sel)))
      .map((r) => r.selector)
    expect(offenders).toEqual([])
  })

  // Screens and components read the same semantic layer. A parchment token in
  // an in-game JSX file renders ink-on-iron in dark exactly as it would in CSS.
  //
  // .claude/rules/testing.md bans new source-regex tests over JSX because the
  // usual cause is logic sitting where it cannot be imported. That does not
  // apply here: `text-[var(--fm-ink)]` is a styling literal with no runtime
  // representation to extract into src/engine — the same reason the CSS guards
  // above read the stylesheet. This is a static-asset invariant, in the shape
  // of questGateProduction.test.ts, not a stand-in for a unit test.
  it('leaves no parchment token in in-game JSX', () => {
    const files = [
      ...globSync(resolve(__dirname, '../src/components/*.jsx')),
      ...globSync(resolve(__dirname, '../src/screens/*.jsx')),
    ].filter((f) => !/LandingScreen|AuthScreen|OAuthConsent/.test(f))

    const offenders: string[] = []
    for (const file of files) {
      const body = readFileSync(file, 'utf8')
      for (const m of body.matchAll(new RegExp(String.raw`var\(${PARCHMENT}\)`, 'g'))) {
        offenders.push(`${file.split('/').slice(-2).join('/')}: ${m[0]}`)
      }
    }
    expect(offenders).toEqual([])
  })

  // Same static-asset invariant as the guard above, catching the other way a
  // themed rule silently fails: an UNDECLARED token. `var(--text-secondary)`
  // with no fallback is an invalid declaration, so `color` never applies and the
  // text inherits — which on a parchment modal is near-white on cream, i.e.
  // invisible. Nothing else notices: it builds, it renders, it has no contrast.
  it('reads no semantic token that neither theme declares', () => {
    const files = [
      ...globSync(resolve(__dirname, '../src/components/*.jsx')),
      ...globSync(resolve(__dirname, '../src/screens/*.jsx')),
    ]
    const declared = new Set([...LIGHT, ...DARK])
    const offenders: string[] = []
    for (const file of files) {
      const body = readFileSync(file, 'utf8')
      // Only the semantic families this test owns. A `var(--x, fallback)` is
      // fine by construction, and `--fm-*` is the frozen palette the guard
      // above polices instead.
      for (const m of body.matchAll(/var\((--(?:text|surface|accent|hairline)[a-z0-9-]*)\)/g)) {
        if (!declared.has(m[1])) offenders.push(`${file.split('/').slice(-2).join('/')}: ${m[1]}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('leaves no raw vellum hex in a themed rule', () => {
    const offenders = Array.from(
      themedRegion().matchAll(/^.*#(?:e6d8b6|e9dcbd|f3ead0|d8c69e)\b.*$/gim),
      (m) => m[0].trim(),
    )
    expect(offenders).toEqual([])
  })
})
