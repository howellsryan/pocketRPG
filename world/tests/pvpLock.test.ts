// Items 1+2 (P0): the world-side PvP lock check. World entry (session exchange +
// DO hello) and the grant flush all gate on this so a locked PvP match can never
// be mutated through a world session.
import { describe, expect, it } from 'vitest'
import { isCharacterInActiveMatch } from '../server/pvpLock'

/** Fake D1 that answers the two/three queries isCharacterInActiveMatch issues:
 * the character's active_match_id, whether that match is active, and whether the
 * character is in any other active match. */
function fakeEnv(opts: { activeMatchId?: number | null; matchActive?: boolean; otherActive?: boolean }) {
  const db = {
    prepare(sql: string) {
      return {
        bind() {
          return {
            first: async () => {
              if (sql.includes('active_match_id FROM characters')) return { active_match_id: opts.activeMatchId ?? null }
              if (sql.includes("id = ? AND status = 'active'")) return opts.matchActive ? { id: opts.activeMatchId } : null
              if (sql.includes('character_a = ? OR character_b = ?')) return opts.otherActive ? { id: 999 } : null
              return null
            },
          }
        },
      }
    },
  }
  return { DB: db as unknown as D1Database }
}

describe('isCharacterInActiveMatch', () => {
  it('is false when the character has no active_match_id', async () => {
    expect(await isCharacterInActiveMatch(fakeEnv({ activeMatchId: null }), 5)).toBe(false)
  })

  it('is true when active_match_id points at a live match', async () => {
    expect(await isCharacterInActiveMatch(fakeEnv({ activeMatchId: 100, matchActive: true }), 5)).toBe(true)
  })

  it('is true when the pointer is stale but the character is in another live match', async () => {
    expect(await isCharacterInActiveMatch(fakeEnv({ activeMatchId: 100, matchActive: false, otherActive: true }), 5)).toBe(true)
  })

  it('is false when the pointer is stale and no other live match holds the character', async () => {
    expect(await isCharacterInActiveMatch(fakeEnv({ activeMatchId: 100, matchActive: false, otherActive: false }), 5)).toBe(false)
  })
})
