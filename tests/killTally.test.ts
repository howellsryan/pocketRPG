// The idle game's pending kill counts. Window semantics mirror the loss ledger:
// settled by subtraction on a successful push, retained on a failure, reset when
// a server copy is adopted.
import { describe, it, expect, beforeEach } from 'vitest'
import {
  readKillTally, recordKills, recordKillsFromGameEvent, resetKillTally, settleKillTally,
} from '../src/engine/killTally.js'

// The node harness has no DOM. The tally persists so a reload does not drop
// kills that have not been reported yet, and that branch is worth proving — so
// a minimal store stands in for the browser's.
const store = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)) },
  removeItem: (k: string) => { store.delete(k) },
  clear: () => store.clear(),
}

beforeEach(() => {
  store.clear()
  resetKillTally()
})

describe('recordKills', () => {
  it('accumulates kills per monster', () => {
    recordKills('green_dragon', 3)
    recordKills('green_dragon')
    recordKills('pasture_bull', 2)
    expect(readKillTally()).toEqual({ green_dragon: 4, pasture_bull: 2 })
  })

  it('records nothing for a monster the server would refuse', () => {
    recordKills('warlord_grondar', 5)
    recordKills('black_dragon', 5)
    expect(readKillTally()).toBe(null)
  })

  it('records nothing for a non-positive count', () => {
    recordKills('green_dragon', 0)
    recordKills('green_dragon', -3)
    expect(readKillTally()).toBe(null)
  })

  it('never tallies one monster past what a single report may carry', () => {
    // The client settles what it SENT and the server clamps what it accepts, so
    // anything tallied above the ceiling would be silently dropped.
    recordKills('green_dragon', 100000)
    recordKills('green_dragon', 500)
    expect(readKillTally()).toEqual({ green_dragon: 100000 })
  })

  it('is null rather than empty when nothing is pending, so the push omits the field', () => {
    expect(readKillTally()).toBe(null)
  })
})

describe('recordKillsFromGameEvent', () => {
  it('tallies a monster kill event with its count', () => {
    recordKillsFromGameEvent({ kind: 'monster_kill', monsterId: 'green_dragon', count: 7 })
    expect(readKillTally()).toEqual({ green_dragon: 7 })
  })

  it('defaults a countless event to one kill', () => {
    recordKillsFromGameEvent({ kind: 'monster_kill', monsterId: 'green_dragon' })
    expect(readKillTally()).toEqual({ green_dragon: 1 })
  })

  it('ignores every event kind that is not a kill', () => {
    recordKillsFromGameEvent({ kind: 'skill_xp', skill: 'mining', xp: 400 })
    recordKillsFromGameEvent({ kind: 'raid_complete', raidId: 'cryptbound_champions' })
    recordKillsFromGameEvent(null)
    expect(readKillTally()).toBe(null)
  })
})

describe('settleKillTally', () => {
  it('subtracts what a push carried, keeping kills made while it was on the wire', () => {
    recordKills('green_dragon', 5)
    const shipped = readKillTally()
    recordKills('green_dragon', 2)
    settleKillTally(shipped)
    expect(readKillTally()).toEqual({ green_dragon: 2 })
  })

  it('clears a monster whose whole tally landed', () => {
    recordKills('green_dragon', 5)
    settleKillTally(readKillTally())
    expect(readKillTally()).toBe(null)
  })

  it('ignores junk rather than corrupting the tally', () => {
    recordKills('green_dragon', 5)
    settleKillTally(null)
    expect(readKillTally()).toEqual({ green_dragon: 5 })
  })
})

describe('persistence', () => {
  it('survives a reload, because the kills it describes have not been reported yet', () => {
    recordKills('green_dragon', 4)
    expect(JSON.parse(store.get('pocketrpg_kill_tally') as string)).toEqual({ green_dragon: 4 })
  })

  it('drops the stored copy once everything has landed', () => {
    recordKills('green_dragon', 4)
    settleKillTally({ green_dragon: 4 })
    expect(store.has('pocketrpg_kill_tally')).toBe(false)
  })

  it('resets outright when a server copy is adopted', () => {
    recordKills('green_dragon', 4)
    resetKillTally()
    expect(readKillTally()).toBe(null)
    expect(store.has('pocketrpg_kill_tally')).toBe(false)
  })
})
