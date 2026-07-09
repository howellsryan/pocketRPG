import { describe, expect, it } from 'vitest'
import { parseHandoffFromHash, resolvePocketRpgUrl } from '../client/src/auth'

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
