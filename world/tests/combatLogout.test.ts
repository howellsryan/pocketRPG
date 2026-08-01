// Combat logging. Before this, a player at 5 HP could close their browser and
// keep everything: the exit beacon departed them inside a second, and a
// lingering player was skipped by the duel loop even during the grace period.
// "Drop everything on death" is only a rule if death is reachable.
import { describe, expect, it } from 'vitest'
import {
  COMBAT_LINGER_MAX_TICKS,
  COMBAT_LOGOUT_BLOCK_TICKS,
  isFighting,
  lingerExpired,
  logoutBlocked,
  nextCombatBlockUntil,
} from '../server/combatLogout'

const NOBODY: ReadonlySet<string> = new Set()

const subject = (over: Record<string, unknown> = {}) => ({
  charId: 'p1',
  combat: null as { npcId: string } | null,
  pvpOpponentId: null as string | null,
  pvpLockUntilTick: 0,
  ...over,
})

describe('isFighting', () => {
  it('counts a live PvE session', () => {
    expect(isFighting(subject({ combat: { npcId: 'n1' } }), 10, NOBODY)).toBe(true)
  })

  it('counts a Wilderness lock that has not lapsed', () => {
    expect(isFighting(subject({ pvpOpponentId: 'p2', pvpLockUntilTick: 20 }), 10, NOBODY)).toBe(true)
  })

  it('stops counting a Wilderness lock once it lapses', () => {
    expect(isFighting(subject({ pvpOpponentId: 'p2', pvpLockUntilTick: 10 }), 10, NOBODY)).toBe(false)
  })

  it('counts an npc still hunting them after their own session ended', () => {
    // Walking out of reach ends the session but not the fight — the monster is
    // still chasing, and walking away from a dragon is not leaving combat.
    expect(isFighting(subject(), 10, new Set(['p1']))).toBe(true)
  })

  it('leaves a player nobody is fighting free to go', () => {
    expect(isFighting(subject(), 10, new Set(['someone_else']))).toBe(false)
  })
})

describe('the logout block clock', () => {
  it('holds for ten seconds after the last tick of combat', () => {
    let until = 0
    until = nextCombatBlockUntil(until, 100, true)
    expect(logoutBlocked(until, 100)).toBe(true)
    expect(logoutBlocked(until, 100 + COMBAT_LOGOUT_BLOCK_TICKS - 1)).toBe(true)
    expect(logoutBlocked(until, 100 + COMBAT_LOGOUT_BLOCK_TICKS)).toBe(false)
  })

  it('never runs backwards on a tick the fight is briefly out of reach', () => {
    // A monster losing reach for one tick must not hand out a free logout.
    const armed = nextCombatBlockUntil(0, 100, true)
    expect(nextCombatBlockUntil(armed, 101, false)).toBe(armed)
  })

  it('re-arms from the newest tick of combat, not the first', () => {
    const armed = nextCombatBlockUntil(0, 100, true)
    const rearmed = nextCombatBlockUntil(armed, 140, true)
    expect(rearmed).toBe(140 + COMBAT_LOGOUT_BLOCK_TICKS)
    expect(logoutBlocked(rearmed, 150)).toBe(true)
  })
})

describe('linger expiry', () => {
  it('is unchanged for an ordinary dropped socket (no combat deadline)', () => {
    expect(lingerExpired(16, 17, 0, 0)).toBe(false)
    expect(lingerExpired(17, 17, 0, 0)).toBe(true)
  })

  it('holds a combat linger open while the fight is still going', () => {
    const blockUntil = 200
    expect(lingerExpired(120, 117, blockUntil, 300)).toBe(false)
  })

  it('lets them go ten seconds after the fight stops', () => {
    const blockUntil = 200
    expect(lingerExpired(199, 117, blockUntil, 300)).toBe(false)
    expect(lingerExpired(200, 117, blockUntil, 300)).toBe(true)
  })

  it('releases at the ceiling even if somebody keeps poking the body', () => {
    // Without this, an attacker content to hit a frozen player forever would
    // hold that character's save lock for as long as they liked.
    const foreverBlocked = 10_000
    expect(lingerExpired(COMBAT_LINGER_MAX_TICKS, 17, foreverBlocked, COMBAT_LINGER_MAX_TICKS)).toBe(true)
    expect(lingerExpired(COMBAT_LINGER_MAX_TICKS - 1, 17, foreverBlocked, COMBAT_LINGER_MAX_TICKS)).toBe(false)
  })

  it('never releases before the ordinary grace period, deadline or not', () => {
    expect(lingerExpired(5, 17, 0, 10)).toBe(false)
  })
})
