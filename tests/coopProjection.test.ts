// What a co-op room puts on the wire, and what it replays to a client that
// missed ticks. Both are transport concerns the old D1 polling model got wrong:
// it broadcast every member's private state, and it handed each client only the
// events from the one request that happened to advance the tick.
import { describe, it, expect } from 'vitest'
import {
  COOP_EVENT_HISTORY_MAX,
  COOP_EVENT_HISTORY_TICKS,
  eventsSince,
  projectEventsForMember,
  projectStateForMember,
  publicMember,
  pushEvents,
  staleMemberIds,
} from '../functions/_lib/game/coopProjection.js'

function member(id: number, overrides: Record<string, unknown> = {}) {
  return {
    characterId: id,
    username: `player${id}`,
    hp: 90,
    maxHP: 99,
    status: 'alive',
    damage: id * 10,
    inventory: [{ itemId: 'shark', quantity: 20 }],
    equipment: { weapon: { itemId: 'krylth_spear' } },
    levels: { attack: 99, slayer: 91 },
    completedQuests: ['the_heart_of_shadows'],
    ownerId: 'identity-1',
    saveRevision: 4,
    ...overrides,
  }
}

function state() {
  return {
    tick: 12,
    bossId: 'corporeal_horror',
    boss: { currentHP: 1500, maxHP: 2000 },
    targetCharId: '7',
    members: { 7: member(7), 8: member(8) },
  }
}

describe('projecting room state for one member', () => {
  it('gives a member their own record in full', () => {
    const projected = projectStateForMember(state(), 7) as any
    expect(projected.members['7'].inventory).toEqual([{ itemId: 'shark', quantity: 20 }])
    expect(projected.members['7'].equipment.weapon.itemId).toBe('krylth_spear')
  })

  it('never puts another member\'s pack, gear, levels or quests on the wire', () => {
    const projected = projectStateForMember(state(), 7) as any
    const other = projected.members['8']
    expect(other.inventory).toBeUndefined()
    expect(other.equipment).toBeUndefined()
    expect(other.levels).toBeUndefined()
    expect(other.completedQuests).toBeUndefined()
    expect(other.saveRevision).toBeUndefined()
    expect(other.ownerId).toBeUndefined()
  })

  it('still carries what the damage table and target indicator need', () => {
    const projected = projectStateForMember(state(), 7) as any
    expect(projected.members['8']).toEqual({
      characterId: 8, username: 'player8', damage: 80, hp: 90, maxHP: 99, status: 'alive',
    })
    expect(projected.targetCharId).toBe('7')
    expect(projected.memberCount).toBe(2)
  })

  it('keeps the shared boss record intact', () => {
    const projected = projectStateForMember(state(), 7) as any
    expect(projected.boss).toEqual({ currentHP: 1500, maxHP: 2000 })
    expect(projected.bossId).toBe('corporeal_horror')
  })

  it('leaks nothing when the viewer is not in the fight at all', () => {
    const projected = projectStateForMember(state(), 99) as any
    expect(projected.members['7'].inventory).toBeUndefined()
    expect(projected.members['8'].inventory).toBeUndefined()
  })

  it('reduces a member to exactly the public fields', () => {
    expect(Object.keys(publicMember(member(7))).sort())
      .toEqual(['characterId', 'damage', 'hp', 'maxHP', 'status', 'username'])
  })
})

describe('replaying events a client missed', () => {
  const events = [
    { type: 'playerHit', tick: 10 },
    { type: 'monsterHit', tick: 11 },
    { type: 'playerHit', tick: 12 },
  ]

  it('returns everything after the tick the client acknowledged', () => {
    expect(eventsSince(events, 10)).toEqual([
      { type: 'monsterHit', tick: 11 },
      { type: 'playerHit', tick: 12 },
    ])
  })

  it('returns nothing when the client is already current', () => {
    expect(eventsSince(events, 12)).toEqual([])
  })

  it('returns the whole ring for a client that has never polled', () => {
    expect(eventsSince(events, null)).toHaveLength(3)
  })

  it('replays several ticks at once, so a slow poll misses no hits', () => {
    // The bug this guards: a member used to receive only the events from the
    // single request that advanced the tick, so with eight members they saw
    // roughly one tick in eight.
    expect(eventsSince(events, 9)).toHaveLength(3)
  })
})

describe('the room event ring', () => {
  it('drops events older than the history window', () => {
    const ring = [{ type: 'old', tick: 1 }, { type: 'recent', tick: 200 }]
    const next = pushEvents(ring, [{ type: 'new', tick: 201 }], 201)
    expect(next.map((e: any) => e.type)).toEqual(['recent', 'new'])
  })

  it('keeps events inside the window', () => {
    const next = pushEvents([{ type: 'a', tick: 100 }], [{ type: 'b', tick: 101 }], 101)
    expect(next).toHaveLength(2)
  })

  it('caps the ring even when a busy tick floods it', () => {
    const flood = Array.from({ length: COOP_EVENT_HISTORY_MAX + 50 }, (_, i) => ({ type: 'hit', tick: 500 + (i % 5) }))
    expect(pushEvents([], flood, 502)).toHaveLength(COOP_EVENT_HISTORY_MAX)
  })

  it('keeps a window long enough to cover a lapsed poll', () => {
    expect(COOP_EVENT_HISTORY_TICKS * 600).toBeGreaterThan(60_000)
  })
})

describe('spotting members whose client has gone quiet', () => {
  const s = { members: { 7: {}, 8: {} } }

  it('names the member who stopped checking in', () => {
    expect(staleMemberIds(s, { 7: 1_000, 8: 100_000 }, 100_000, 90_000)).toEqual(['7'])
  })

  it('leaves a member who is still polling alone', () => {
    expect(staleMemberIds(s, { 7: 99_000, 8: 100_000 }, 100_000, 90_000)).toEqual([])
  })

  it('treats a member with no heartbeat at all as gone', () => {
    expect(staleMemberIds(s, { 8: 100_000 }, 100_000, 90_000)).toEqual(['7'])
  })

  it('does not keep one member alive on another member\'s heartbeat', () => {
    // The bug: the lock used to key off the SESSION's last tick, which any
    // member refreshed — so a crashed player stayed locked out of their own
    // save for as long as anybody else kept fighting.
    expect(staleMemberIds(s, { 7: 0, 8: 100_000 }, 100_000, 90_000)).toEqual(['7'])
  })
})

describe('projectEventsForMember', () => {
  const settled = {
    type: 'killSettled',
    tick: 12,
    ownerCharacterId: 7,
    granted: [{ itemId: 'dragon_axe', quantity: 1 }],
    killCount: 4,
    settlements: [
      { characterId: 7, granted: [{ itemId: 'dragon_axe', quantity: 1 }], killCount: 4, diverged: false },
      { characterId: 8, granted: [{ itemId: 'shard_of_night', quantity: 1 }], killCount: 9, diverged: false },
    ],
  }

  it('hands a winner their own drops in full', () => {
    const [ev] = projectEventsForMember([settled], 8) as any[]
    expect(ev.settlements.find((s: any) => s.characterId === 8).granted).toEqual([{ itemId: 'shard_of_night', quantity: 1 }])
  })

  it('tells everyone WHO won without telling them WHAT they got', () => {
    // The event ring is shared by the whole room, so eight winners' drop tables
    // would otherwise ride every poll — the same leak projectStateForMember
    // exists to close for packs.
    const [ev] = projectEventsForMember([settled], 8) as any[]
    const other = ev.settlements.find((s: any) => s.characterId === 7)
    expect(other.granted).toBeUndefined()
    expect(ev.settlements).toHaveLength(2)
    // Legacy single-winner fields describe the top-damage member, so they are
    // emptied for everybody else too.
    expect(ev.granted).toEqual([])
    expect(ev.killCount).toBeNull()
  })

  it('keeps the top-damage member their legacy fields', () => {
    const [ev] = projectEventsForMember([settled], 7) as any[]
    expect(ev.granted).toEqual([{ itemId: 'dragon_axe', quantity: 1 }])
    expect(ev.killCount).toBe(4)
  })

  it('leaves every other event exactly as it was', () => {
    const hit = { type: 'playerHit', tick: 3, damage: 12 }
    expect(projectEventsForMember([hit], 7)[0]).toBe(hit)
  })
})
