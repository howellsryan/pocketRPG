function toPositiveInt(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
}

function normaliseLootSummary(loot) {
  if (!loot || typeof loot !== 'object') return null
  return {
    transferCount: Number(loot.transferCount || 0) || 0,
    added: Array.isArray(loot.added) ? loot.added.map(item => ({ ...item })) : [],
    dropped: Array.isArray(loot.dropped) ? loot.dropped.map(item => ({ ...item })) : [],
    addedValue: Math.max(0, Math.floor(Number(loot.addedValue || 0) || 0)),
    bankedValue: Math.max(0, Math.floor(Number(loot.bankedValue ?? loot.addedValue ?? 0) || 0)),
    droppedValue: Math.max(0, Math.floor(Number(loot.droppedValue || 0) || 0)),
    totalRiskValue: Math.max(0, Math.floor(Number(loot.totalRiskValue ?? loot.bankedValue ?? loot.addedValue ?? 0) || 0)),
  }
}

export function createPvpEndSummary({ terminal, loot, endedAt, writebackOk = true }) {
  const winner = toPositiveInt(terminal?.winner ?? terminal?.winnerCharacterId ?? terminal?.winner_character_id)
  const loser = toPositiveInt(terminal?.loser ?? terminal?.loserCharacterId ?? terminal?.loser_character_id)
  if (!winner || !loser) return null

  return {
    terminal: {
      winner,
      loser,
      reason: typeof terminal?.reason === 'string' && terminal.reason ? terminal.reason : 'death',
    },
    loot: normaliseLootSummary(loot),
    writebackOk: writebackOk !== false,
    endedAt: Math.max(0, Math.floor(Number(endedAt || Date.now()) || 0)),
  }
}

export function appendPvpEndSummaryToState(state, endSummary) {
  if (!state || typeof state !== 'object' || !endSummary?.terminal) return state

  const matchEndEvent = {
    type: 'matchEnd',
    winner: endSummary.terminal.winner,
    loser: endSummary.terminal.loser,
    reason: endSummary.terminal.reason,
    loot: endSummary.loot,
    endedAt: endSummary.endedAt,
  }

  return {
    ...state,
    pvpEnd: endSummary,
    recentEvents: [
      ...(Array.isArray(state.recentEvents) ? state.recentEvents : []),
      matchEndEvent,
    ].slice(-20),
  }
}

export function readPvpEndSummary(state, match = null) {
  if (state?.pvpEnd?.terminal) {
    return createPvpEndSummary({
      terminal: state.pvpEnd.terminal,
      loot: state.pvpEnd.loot,
      endedAt: state.pvpEnd.endedAt ?? match?.ended_at,
      writebackOk: state.pvpEnd.writebackOk,
    })
  }

  const status = match?.status
  const winner = toPositiveInt(match?.winner_character_id ?? match?.winnerCharacterId)
  if (status !== 'completed' || !winner) return null

  const combatantIds = Object.keys(state?.combatants || {})
    .map(toPositiveInt)
    .filter(Boolean)
  const loser = combatantIds.find(id => id !== winner)
  if (!loser) return null

  return createPvpEndSummary({
    terminal: { winner, loser, reason: 'death' },
    loot: null,
    endedAt: match?.ended_at,
    writebackOk: true,
  })
}
