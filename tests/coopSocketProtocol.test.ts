// The delta codec a co-op room and its clients speak over the socket.
//
// The round trip is the whole invariant: a client's view is rebuilt from
// nothing but these patches, so a field the delta forgets is a field that stays
// wrong on screen until the next reconnect — the classic way a push transport
// rots quietly rather than failing.
import { describe, it, expect } from 'vitest'
import {
  COOP_SOCKET_LINGER_MS,
  COOP_SOCKET_MAX_ATTEMPTS,
  applyProjectionDelta,
  coopSocketBackoffMs,
  deltaWorthSending,
  isFatalCoopSocketReason,
  isRejoinableCoopCloseReason,
  projectionDelta,
} from '../src/engine/coopSocketProtocol.js'
import { projectStateForMember } from '../functions/_lib/game/coopProjection.js'

function member(id: number, over: Record<string, unknown> = {}) {
  return {
    characterId: id,
    username: `player${id}`,
    damage: 0,
    hp: 99,
    maxHP: 99,
    status: 'alive',
    levels: { attack: 99, strength: 99 },
    equipment: { weapon: { itemId: 'krylth_spear', quantity: 1 } },
    inventory: [{ itemId: 'shark', quantity: 10 }, null, null],
    completedQuests: ['the_heart_of_shadows', 'crown_complications'],
    combat: { attackCooldown: 0, prayerPoints: 70, specialAttackEnergy: 100 },
    ...over,
  }
}

function state(over: Record<string, unknown> = {}) {
  return {
    tick: 10,
    bossId: 'corporeal_horror',
    boss: { currentHP: 2000, maxHP: 2000, respawnCountdown: 0 },
    targetCharId: 7,
    phase: 'active',
    hostCharacterId: null,
    raid: null,
    members: { 7: member(7), 8: member(8) },
    ...over,
  }
}

/** The property that matters: whatever changed, applying the delta to the old
 * view has to produce the new one exactly. */
function roundTrips(prev: any, next: any) {
  return applyProjectionDelta(prev, projectionDelta(prev, next))
}

describe('projectionDelta / applyProjectionDelta', () => {
  it('round-trips an ordinary beat', () => {
    const prev = state()
    const next = state({
      tick: 11,
      boss: { currentHP: 1958, maxHP: 2000, respawnCountdown: 0 },
      members: { 7: member(7, { damage: 42, combat: { attackCooldown: 4, prayerPoints: 69, specialAttackEnergy: 100 } }), 8: member(8) },
    })
    expect(roundTrips(prev, next)).toEqual(next)
  })

  it('sends the fields that moved and not the ones that did not', () => {
    const prev = state()
    const next = state({ tick: 11, members: { 7: member(7, { damage: 42 }), 8: member(8) } })
    const delta = projectionDelta(prev, next) as any

    expect(delta.members['7']).toEqual({ damage: 42 })
    // The payload polling re-sent on every beat: a pack, worn gear, levels and
    // a quest list that change a few times an hour.
    expect(delta.members['7'].inventory).toBeUndefined()
    expect(delta.members['7'].completedQuests).toBeUndefined()
    expect(delta.members['8']).toBeUndefined()
    expect(delta.boss).toBeUndefined()
  })

  it('round-trips a member joining and a member leaving', () => {
    const prev = state()
    const joined = state({ members: { 7: member(7), 8: member(8), 9: member(9) } })
    expect(roundTrips(prev, joined)).toEqual(joined)

    const left = state({ members: { 7: member(7) } })
    expect(roundTrips(prev, left)).toEqual(left)
    expect(Object.keys(roundTrips(prev, left).members)).toEqual(['7'])
  })

  // The lobby projects other members with their kit; the fight strips it back.
  // A field patch cannot express a key going away, so the whole record has to
  // be resent — otherwise the fight would keep serving a stale lobby inventory.
  it('replaces a record outright when its key set changes', () => {
    const prev = state({ phase: 'lobby' })
    const next = state({
      phase: 'active',
      members: {
        7: member(7),
        8: { characterId: 8, username: 'player8', damage: 0, hp: 99, maxHP: 99, status: 'alive' },
      },
    })
    const rebuilt = roundTrips(prev, next)
    expect(rebuilt).toEqual(next)
    expect('inventory' in (rebuilt.members['8'] as object)).toBe(false)
  })

  it('has no delta at all when nothing moved', () => {
    expect(projectionDelta(state(), state())).toBeNull()
    expect(applyProjectionDelta(state(), null)).toEqual(state())
  })

  it('sends the whole projection when the client has none', () => {
    const next = state()
    expect(projectionDelta(null, next)).toEqual({ full: next })
    expect(applyProjectionDelta(null, { full: next })).toEqual(next)
  })

  it('round-trips a real projection, not just a hand-built one', () => {
    const raw = {
      tick: 4,
      bossId: 'corporeal_horror',
      boss: { currentHP: 2000, maxHP: 2000 },
      members: { 7: member(7), 8: member(8) },
    }
    const before = projectStateForMember(raw, 7)
    const after = projectStateForMember({ ...raw, tick: 5, boss: { currentHP: 1900, maxHP: 2000 } }, 7)
    expect(roundTrips(before, after)).toEqual(after)
  })
})

describe('deltaWorthSending', () => {
  // A raid party can sit in a lobby for minutes. Pushing a frame every 600ms to
  // say only that time passed is the cost the push transport exists to avoid.
  it('treats a beat that only moved the tick counter as silence', () => {
    expect(deltaWorthSending({ tick: 11 }, 0)).toBe(false)
    expect(deltaWorthSending(null, 0)).toBe(false)
  })

  it('sends anything with an event behind it, even a silent one', () => {
    expect(deltaWorthSending({ tick: 11 }, 1)).toBe(true)
    expect(deltaWorthSending(null, 1)).toBe(true)
  })

  it('sends a beat where the fight actually moved', () => {
    expect(deltaWorthSending({ tick: 11, boss: { currentHP: 5 } }, 0)).toBe(true)
    expect(deltaWorthSending({ full: state() }, 0)).toBe(true)
  })
})

describe('reconnect policy', () => {
  it('backs off, and stops doubling', () => {
    expect(coopSocketBackoffMs(0)).toBe(500)
    expect(coopSocketBackoffMs(1)).toBe(1000)
    expect(coopSocketBackoffMs(2)).toBe(2000)
    expect(coopSocketBackoffMs(99)).toBe(8000)
  })

  it('gives up on sockets quickly enough to fall back mid-fight', () => {
    let total = 0
    for (let i = 0; i < COOP_SOCKET_MAX_ATTEMPTS; i++) total += coopSocketBackoffMs(i)
    expect(total).toBeLessThan(5000)
  })

  // Reconnecting past one of these re-runs the same refusal forever.
  it('knows which closes are the end of the fight', () => {
    expect(isFatalCoopSocketReason('not_a_member')).toBe(true)
    expect(isFatalCoopSocketReason('session_ended')).toBe(true)
    expect(isFatalCoopSocketReason('ejected')).toBe(true)
    expect(isFatalCoopSocketReason('idle')).toBe(false)
    expect(isFatalCoopSocketReason(undefined)).toBe(false)
  })

  // …but "this socket is finished" is not "this player is finished". Being let
  // go while your screen was locked has to end in a fight, not an error screen.
  it('separates a session the player can rejoin from a genuine dead end', () => {
    expect(isRejoinableCoopCloseReason('not_a_member')).toBe(true)
    expect(isRejoinableCoopCloseReason('ejected')).toBe(true)
    expect(isRejoinableCoopCloseReason('session_ended')).toBe(true)
    expect(isRejoinableCoopCloseReason('flooding')).toBe(false)
    expect(isRejoinableCoopCloseReason('idle')).toBe(false)
  })

  // The number that caused the bug: at 10s, glancing at a notification cost you
  // the fight. It must stay well inside the 90s lock TTL all the same.
  it('gives a returning player longer than a glance, and still beats the lock TTL', () => {
    expect(COOP_SOCKET_LINGER_MS).toBeGreaterThanOrEqual(30_000)
    expect(COOP_SOCKET_LINGER_MS).toBeLessThan(90_000)
  })
})

describe('what a delta costs the wire', () => {
  // The reason the transport is delta-encoded at all: polling re-sent this
  // whole projection to every member ~1.7 times a second.
  it('costs a fraction of the projection it describes', () => {
    const prev = state()
    const next = state({
      tick: 11,
      boss: { currentHP: 1958, maxHP: 2000, respawnCountdown: 0 },
      members: {
        7: member(7, { damage: 42, hp: 91, combat: { attackCooldown: 4, prayerPoints: 69, specialAttackEnergy: 100 } }),
        8: member(8, { damage: 17 }),
      },
    })
    const full = JSON.stringify(next).length
    const delta = JSON.stringify(projectionDelta(prev, next)).length
    expect(delta).toBeLessThan(full / 4)
  })
})
