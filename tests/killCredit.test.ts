// The one gate behind loot, kill counts, slayer progress and daily tasks, in
// co-op and the open world alike (src/engine/killCredit.js).
import { describe, it, expect } from 'vitest'
import {
  KILL_CREDIT_DAMAGE_SHARE,
  earnedKillCredit,
  killCreditDamageRequired,
  killCreditIds,
} from '../src/engine/killCredit.js'

describe('the damage share a kill is earned at', () => {
  it('asks for a tenth of the health pool', () => {
    expect(KILL_CREDIT_DAMAGE_SHARE).toBe(0.1)
    expect(killCreditDamageRequired(2000)).toBe(200)
    expect(killCreditDamageRequired(255)).toBe(26)
  })

  // Ceil, against §4's round-with-floor house rule: the HUD advertises 10% and
  // must not pay at 9.6%.
  it('rounds the requirement up, never down', () => {
    expect(killCreditDamageRequired(255)).toBe(26)
    expect(killCreditDamageRequired(11)).toBe(2)
  })

  it('never lets a player who has not swung qualify', () => {
    // Floor would make the requirement 0 on a monster this small, so `damage >= 0`
    // would credit everyone standing nearby.
    expect(killCreditDamageRequired(5)).toBe(1)
    expect(killCreditDamageRequired(0)).toBe(1)
    expect(earnedKillCredit(0, 5)).toBe(false)
    expect(earnedKillCredit(0, 0)).toBe(false)
  })

  it('is exactly at-least, not more-than', () => {
    expect(earnedKillCredit(200, 2000)).toBe(true)
    expect(earnedKillCredit(199, 2000)).toBe(false)
  })
})

describe('who a kill is credited to', () => {
  const entry = (id: string, damage: number, tick = 0) => ({ id, damage, tick })

  it('takes everyone past the line and drops everyone under it', () => {
    expect(killCreditIds([entry('a', 1400), entry('b', 400), entry('c', 199)], 2000))
      .toEqual(['a', 'b'])
  })

  it('orders by damage, biggest first', () => {
    expect(killCreditIds([entry('a', 400), entry('b', 1400), entry('c', 200)], 2000))
      .toEqual(['b', 'a', 'c'])
  })

  // Stable order matters: the top entry is the one the loot owner is picked from.
  it('breaks a damage tie toward whoever got there first', () => {
    expect(killCreditIds([entry('late', 500, 90), entry('early', 500, 10)], 2000))
      .toEqual(['early', 'late'])
  })

  it('credits a player who earned their share and then died — damage, not survival', () => {
    // Nothing about the entry describes survival, and that is the point: the
    // callers pass damage totals only, so neither can quietly re-add an alive gate.
    expect(killCreditIds([entry('corpse', 900)], 2000)).toEqual(['corpse'])
  })

  it('handles an empty or absent damage table', () => {
    expect(killCreditIds([], 2000)).toEqual([])
    expect(killCreditIds(undefined as never, 2000)).toEqual([])
  })

  // Eight is the co-op cap, so the biggest contributor always holds at least
  // 12.5% — a kill can never come out dry for everybody.
  it('always credits at least one player on a full room', () => {
    const eight = Array.from({ length: 8 }, (_, i) => entry(`p${i}`, 250))
    expect(killCreditIds(eight, 2000).length).toBeGreaterThan(0)
  })
})
