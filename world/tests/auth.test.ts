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
  it('prefers the referring PocketRPG site over the world hostname', () => {
    expect(resolvePocketRpgUrl('https://preview.pocketrpg.pages.dev/help', 'world.pocketrpg.co.uk')).toBe(
      'https://preview.pocketrpg.pages.dev'
    )
    expect(resolvePocketRpgUrl('https://pocketrpg.co.uk/', 'pocketrpg-world.rlh.workers.dev')).toBe(
      'https://pocketrpg.co.uk'
    )
  })

  it('ignores an unrecognized referrer and falls back to the hostname heuristic', () => {
    expect(resolvePocketRpgUrl('https://evil.example.com/', 'world.pocketrpg.co.uk')).toBe('https://pocketrpg.co.uk')
    expect(resolvePocketRpgUrl('https://evil.example.com/', 'pocketrpg-world.rlh.workers.dev')).toBe(
      'https://preview.pocketrpg.pages.dev'
    )
  })

  it('falls back to the hostname heuristic when there is no referrer at all', () => {
    expect(resolvePocketRpgUrl('', 'world.pocketrpg.co.uk')).toBe('https://pocketrpg.co.uk')
    expect(resolvePocketRpgUrl('', 'pocketrpg-world.rlh.workers.dev')).toBe('https://preview.pocketrpg.pages.dev')
    expect(resolvePocketRpgUrl('', 'localhost')).toBe('https://preview.pocketrpg.pages.dev')
  })
})

describe('resolveZone', () => {
  it('routes a fresh browser (no stored zone) to the merged overworld', () => {
    expect(resolveZone(null)).toBe('overworld')
    expect(resolveZone(undefined)).toBe('overworld')
    expect(resolveZone('')).toBe('overworld')
  })

  it('redirects zones folded into the overworld to it', () => {
    expect(resolveZone('pasture')).toBe('overworld')
    expect(resolveZone('forest')).toBe('overworld')
    expect(resolveZone('lumbright')).toBe('overworld')
  })

  it('passes a still-standalone zone through unchanged', () => {
    expect(resolveZone('overworld')).toBe('overworld')
    expect(resolveZone('varrick')).toBe('varrick')
    expect(resolveZone('varrick_dungeon')).toBe('varrick_dungeon')
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
