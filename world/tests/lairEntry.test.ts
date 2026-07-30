// The lair gate at the socket door.
//
// /api/world-token refuses a locked lair before it signs a handoff, and
// tests/worldToken.test.ts covers that. It is not the only door: the session
// token names no zone, room names are URL path segments, and the WorldZone DO is
// routed to by name — so a socket opened straight at `zaryth_throne~1` walked
// past the endpoint entirely and reached a boss whose collection-log slots and
// kill counts the world writes server-side.
import { describe, expect, it, vi } from 'vitest'
import { lairEntryFailure } from '../server/lairEntry'
import { instanceRoom } from '../shared/instances'

const ZARYTH_LAIR = 'zaryth_throne'
const GENERALS = ['warlord_grondar', 'commander_zephyra', 'krylth_the_defiler', 'skyrender_kharra']

/** A save in the shape one actually deserialises to: quests under `settings`,
 * and NO kill counts at all — saveload.js strips them, because the kill_counts
 * table owns them (functions/_lib/game/bossEntry.js). */
const save = () => ({
  version: 1,
  stats: { slayer: { xp: 13034431 } },
  inventory: [],
  equipment: {},
  settings: { completedQuests: [] },
})

function mockEnv(kills: string[] = []) {
  const all = vi.fn().mockResolvedValue({
    results: kills.map((id) => ({ source_id: id, kill_count: 1 })),
  })
  const prepare = vi.fn(() => ({ bind: vi.fn(() => ({ all })) }))
  return { env: { DB: { prepare } } as never, prepare, all }
}

describe('lairEntryFailure — the gate on the socket', () => {
  it('refuses the throne to a character with none of the generals down', async () => {
    const { env } = mockEnv([])
    const reason = await lairEntryFailure(env, instanceRoom(ZARYTH_LAIR, 1), save(), 42)
    expect(reason).toBeTruthy()
    expect(reason).toContain('Zaryth')
  })

  it('still refuses when only some of them are down', async () => {
    const { env } = mockEnv(GENERALS.slice(0, 3))
    expect(await lairEntryFailure(env, instanceRoom(ZARYTH_LAIR, 1), save(), 42)).toBeTruthy()
  })

  it('admits a character who has earned it', async () => {
    const { env } = mockEnv(GENERALS)
    expect(await lairEntryFailure(env, instanceRoom(ZARYTH_LAIR, 1), save(), 42)).toBeNull()
  })

  it('gates the bare zone id as well as a numbered instance room', async () => {
    // The room a socket names is `zaryth_throne~7`, not `zaryth_throne` — a gate
    // that only recognised the authored id would be bypassed by every real
    // connection, since instanced rooms are the only way this lair is served.
    const { env } = mockEnv([])
    expect(await lairEntryFailure(env, ZARYTH_LAIR, save(), 42)).toBeTruthy()
    for (const n of [1, 7, 12]) {
      expect(await lairEntryFailure(env, instanceRoom(ZARYTH_LAIR, n), save(), 42)).toBeTruthy()
    }
  })

  it('costs no D1 read for a lair that gates nothing, or for ordinary geography', async () => {
    // Most lairs have no requirements at all. Paying two round-trips per entry
    // to prove it is waste the gate must not introduce.
    const { env, prepare } = mockEnv([])
    for (const room of ['overworld', 'varrick', 'cow_pasture~1', 'fiend_pit~2', 'dragon_roost~1', 'grondar_lair~3']) {
      expect(await lairEntryFailure(env, room, save(), 42), room).toBeNull()
    }
    expect(prepare).not.toHaveBeenCalled()
  })

  it('fails CLOSED when the kill counts cannot be read', async () => {
    // The thing behind this door hands out the game's best-in-slot table, so a
    // D1 blip must refuse entry rather than wave the player through.
    const prepare = vi.fn(() => ({ bind: vi.fn(() => ({ all: vi.fn().mockRejectedValue(new Error('D1 down')) })) }))
    const reason = await lairEntryFailure({ DB: { prepare } } as never, instanceRoom(ZARYTH_LAIR, 1), save(), 42)
    expect(reason).toBeTruthy()
  })

  it('refuses a save it cannot read rather than treating it as empty progress', async () => {
    const { env } = mockEnv(GENERALS)
    expect(await lairEntryFailure(env, instanceRoom(ZARYTH_LAIR, 1), null, 42)).toBeTruthy()
  })
})
