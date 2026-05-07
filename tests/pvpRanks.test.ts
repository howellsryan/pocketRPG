import { describe, expect, it, vi } from 'vitest'
import { applyPvpRankToCombatant, readCharacterPvpRank } from '../functions/_lib/pvpRanks.js'

describe('pvpRanks', () => {
  it('returns neutral rank and skips DB for invalid character ids', async () => {
    const prepare = vi.fn()
    const env = { DB: { prepare } }

    for (const invalidId of [null, undefined, 0, -10, 'abc']) {
      await expect(readCharacterPvpRank(env as any, invalidId as any)).resolves.toEqual({
        totalPvpKills: 0,
        lastUpdatedTotalPvpKills: null,
        rank: null,
      })
    }

    expect(prepare).not.toHaveBeenCalled()
  })

  it('binds parsed numeric id and keeps SQL ranking contract', async () => {
    const first = vi.fn().mockResolvedValue({ total_pvp_kills: 7, last_updated_total_pvp_kills: 123, pvp_rank: 2 })
    const bind = vi.fn(() => ({ first }))
    const prepare = vi.fn(() => ({ bind }))
    const env = { DB: { prepare } }

    await readCharacterPvpRank(env as any, '42')

    expect(bind).toHaveBeenCalledWith(42)
    const sql = prepare.mock.calls[0][0]
    expect(sql).toContain('ROW_NUMBER() OVER')
    expect(sql).toContain('COALESCE(total_pvp_kills, 0) DESC')
    expect(sql).toContain('last_updated_total_pvp_kills')
    expect(sql).toContain('deleted_at IS NULL')
    expect(sql).toContain('WHERE c.id = ?')
  })

  it('normalizes rank rows and missing rows', async () => {
    const first = vi
      .fn()
      .mockResolvedValueOnce({ total_pvp_kills: 13, last_updated_total_pvp_kills: 2000, pvp_rank: 5.9 })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ total_pvp_kills: -99, last_updated_total_pvp_kills: 0, pvp_rank: -3 })
      .mockResolvedValueOnce({ total_pvp_kills: 'NaN', last_updated_total_pvp_kills: 'abc', pvp_rank: 'oops' })
    const env = { DB: { prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first })) })) } }

    await expect(readCharacterPvpRank(env as any, 1)).resolves.toEqual({
      totalPvpKills: 13,
      lastUpdatedTotalPvpKills: 2000,
      rank: 5,
    })
    await expect(readCharacterPvpRank(env as any, 2)).resolves.toEqual({
      totalPvpKills: 0,
      lastUpdatedTotalPvpKills: null,
      rank: null,
    })
    await expect(readCharacterPvpRank(env as any, 3)).resolves.toEqual({
      totalPvpKills: 0,
      lastUpdatedTotalPvpKills: null,
      rank: null,
    })
    await expect(readCharacterPvpRank(env as any, 4)).resolves.toEqual({
      totalPvpKills: 0,
      lastUpdatedTotalPvpKills: null,
      rank: null,
    })
  })

  it('applies rank fields while preserving combatant data', () => {
    expect(applyPvpRankToCombatant(null as any, {} as any)).toBeNull()
    expect(applyPvpRankToCombatant(undefined as any, {} as any)).toBeUndefined()
    expect(applyPvpRankToCombatant(123 as any, {} as any)).toBe(123)

    const out = applyPvpRankToCombatant(
      { id: 1, name: 'Hero', hp: 99 } as any,
      { totalPvpKills: -2, lastUpdatedTotalPvpKills: undefined, rank: undefined } as any,
    )

    expect(out).toMatchObject({
      id: 1,
      name: 'Hero',
      hp: 99,
      totalPvpKills: 0,
      lastUpdatedTotalPvpKills: null,
      pvpRank: null,
    })
  })
})
