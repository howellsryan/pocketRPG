import { describe, expect, it } from 'vitest'
import { appendPvpEndSummaryToState, createPvpEndSummary, readPvpEndSummary } from '../src/engine/pvpEndSummary.js'

describe('pvpEndSummary', () => {
  it('creates and appends a reusable terminal summary with loot', () => {
    const summary = createPvpEndSummary({ terminal: { winner: 1, loser: 2, reason: 'death' }, loot: { added: [{ itemId: 'coins', quantity: 1000 }], dropped: [], addedValue: 1000, bankedValue: 1000, droppedValue: 0, totalRiskValue: 1000 }, endedAt: 12345 })
    expect(summary?.terminal).toEqual({ winner: 1, loser: 2, reason: 'death' })
    expect(summary?.loot?.totalRiskValue).toBe(1000)
    const state = appendPvpEndSummaryToState({ tick: 9, combatants: {}, recentEvents: [] }, summary)
    expect(state.pvpEnd.terminal.winner).toBe(1)
    expect(state.recentEvents.at(-1).type).toBe('matchEnd')
  })

  it('reads persisted pvpEnd', () => {
    const summary = readPvpEndSummary({ pvpEnd: { terminal: { winner: 5, loser: 9, reason: 'forfeit' }, loot: { added: [], dropped: [], totalRiskValue: 250, bankedValue: 250 }, writebackOk: true, endedAt: 999 } }, { status: 'completed' })
    expect(summary?.terminal).toEqual({ winner: 5, loser: 9, reason: 'forfeit' })
    expect(summary?.loot?.totalRiskValue).toBe(250)
  })
})
