import { beforeAll, describe, expect, it } from 'vitest'
import { getRunPref, parseHandoffFromHash, resolvePocketRpgUrl, resolveZone, storeRunPref } from '../client/src/auth'

describe('parseHandoffFromHash', () => {
  it('extracts the token from a #handoff=<jwt> hash', () => {
    expect(parseHandoffFromHash('#handoff=abc.def.ghi')).toBe('abc.def.ghi')
  })

  it('decodes a URL-encoded token', () => {
    expect(parseHandoffFromHash('#handoff=abc%2Edef')).toBe('abc.def')
  })

  it('returns null for an empty hash', () => {
    expect(parseHandoffFromHash('')).toBeNull()
  })

  it('returns null for an unrelated hash', () => {
    expect(parseHandoffFromHash('#something-else')).toBeNull()
  })
})

describe('resolvePocketRpgUrl', () => {
  it('prefers the referring PocketRPG site over the world hostname heuristic', () => {
    expect(resolvePocketRpgUrl('https://preview.pocketrpg.pages.dev/help', 'pocketrpg.co.uk')).toBe(
      'https://preview.pocketrpg.pages.dev'
    )
    expect(resolvePocketRpgUrl('https://pocketrpg.co.uk/', 'pocketrpg-app-preview.rlh.workers.dev')).toBe(
      'https://pocketrpg.co.uk'
    )
  })

  it('ignores an unrecognized referrer and falls back to the hostname heuristic', () => {
    expect(resolvePocketRpgUrl('https://evil.example.com/', 'pocketrpg.co.uk')).toBe('https://pocketrpg.co.uk')
    expect(resolvePocketRpgUrl('https://evil.example.com/', 'pocketrpg-app-preview.rlh.workers.dev')).toBe(
      'https://pocketrpg-app-preview.rlh.workers.dev'
    )
  })

  it('falls back to the hostname heuristic when there is no referrer at all', () => {
    // The world client ships from the game's own Worker now — pocketrpg.co.uk
    // is production, Workers preview returns to itself, and local development
    // retains the legacy preview fallback.
    expect(resolvePocketRpgUrl('', 'pocketrpg.co.uk')).toBe('https://pocketrpg.co.uk')
    expect(resolvePocketRpgUrl('', 'pocketrpg-app-preview.rlh.workers.dev')).toBe('https://pocketrpg-app-preview.rlh.workers.dev')
    expect(resolvePocketRpgUrl('', 'localhost')).toBe('https://preview.pocketrpg.pages.dev')
  })
})

describe('resolveZone', () => {
  it('routes a fresh browser (no stored zone) to the merged overworld', () => {
    expect(resolveZone(null)).toBe('overworld')
    expect(resolveZone(undefined)).toBe('overworld')
    expect(resolveZone('')).toBe('overworld')
  })

  it('redirects every zone folded into the overworld to it', () => {
    for (const z of ['pasture', 'forest', 'lumbright', 'varrick', 'varrick_dungeon']) {
      expect(resolveZone(z), z).toBe('overworld')
    }
  })

  it('passes the overworld (and any unknown id) through unchanged', () => {
    expect(resolveZone('overworld')).toBe('overworld')
    expect(resolveZone('some_future_zone')).toBe('some_future_zone')
  })
})

describe('run toggle preference', () => {
  const store = new Map<string, string>()
  beforeAll(() => {
    ;(globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as Storage
  })

  it('defaults to off (walking) when never set', () => {
    store.clear()
    expect(getRunPref()).toBe(false)
  })

  it('persists the toggle so a refresh/logout/transition keeps run selected', () => {
    storeRunPref(true)
    expect(getRunPref()).toBe(true)
    storeRunPref(false)
    expect(getRunPref()).toBe(false)
  })
})

describe('Workers preview return', () => {
  it('returns a bookmarked world to its own Workers preview', () => {
    expect(resolvePocketRpgUrl('', 'pocketrpg-app-preview.rlh.workers.dev')).toBe('https://pocketrpg-app-preview.rlh.workers.dev')
  })
  it('accepts the current Workers preview as a trusted referring game', () => {
    expect(resolvePocketRpgUrl('https://pocketrpg-app-preview.rlh.workers.dev/', 'world.pocketrpg.co.uk')).toBe('https://pocketrpg-app-preview.rlh.workers.dev')
  })
})
