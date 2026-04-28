import { requireAuth, json } from '../../../../_lib/auth.js'
import { getOwnedCharacter, sweepStaleRows } from '../../../../_lib/pvp.js'
import { readOwnedActiveMatch, itemsData, readCharacterSave, applyCombatantToSave } from '../../../../_lib/pvpMatch.js'
import { processPvpTick } from '../../../../../src/engine/pvpEngine.js'
import { applyLootTransfer } from '../../../../../src/engine/lootTransfer.js'

const PVP_TICK_MS = 600
const PVP_TICK_GRACE_MS = 75

export function shouldAdvancePvpTick(now, lastTickAt) {
  const safeNow = Number(now) || 0
  const safeLastTickAt = Number(lastTickAt) || 0
  if (safeLastTickAt <= 0) return { advance: true, nextTickAt: safeNow + PVP_TICK_MS }
  const nextTickAt = safeLastTickAt + PVP_TICK_MS
  return {
    advance: safeNow + PVP_TICK_GRACE_MS >= nextTickAt,
    nextTickAt,
  }
}

function appliedIntentsStatement(env, intentIds) {
  if (!intentIds.length) return null
  const ids = intentIds.map(() => '?').join(',')
  return env.DB.prepare(
    `UPDATE pvp_intents SET applied = 1 WHERE id IN (${ids})`
  ).bind(...intentIds)
}

function parseMatchState(match) {
  try {
    return JSON.parse(match.state_json)
  } catch {
    return null
  }
}

async function finalizeTerminalMatch(env, match, stateNext, terminal, appliedIntentIds) {
  const now = Date.now()
  const winnerId = terminal.winner
  const loserId = terminal.loser

  for (let attempt = 0; attempt < 2; attempt++) {
    const winnerSave = await readCharacterSave(env, winnerId)
    const loserSave = await readCharacterSave(env, loserId)
    if (!winnerSave || !loserSave) return { ok: false, reason: 'missing_save' }

    const winnerCombatant = stateNext.combatants[String(winnerId)]
    const loserCombatant = stateNext.combatants[String(loserId)]

    const winnerSnapshot = applyCombatantToSave(winnerSave.payload, winnerCombatant)
    const loserSnapshot = applyCombatantToSave(loserSave.payload, loserCombatant)

    const loot = applyLootTransfer({
      loserInventory: loserSnapshot.inventory || [],
      loserEquipment: loserSnapshot.equipment || {},
      winnerBank: winnerSnapshot.bank || {},
      itemsData,
    })

    winnerSnapshot.bank = loot.winner.bank
    loserSnapshot.inventory = loot.loser.inventory
    loserSnapshot.equipment = loot.loser.equipment

    const winnerJson = JSON.stringify(winnerSnapshot)
    const loserJson = JSON.stringify(loserSnapshot)

    const writes = [
      env.DB.prepare(
        'UPDATE saves SET save_data = ?, updated_at = ? WHERE character_id = ? AND updated_at = ?'
      ).bind(winnerJson, now, winnerId, winnerSave.updatedAt),
      env.DB.prepare(
        'UPDATE saves SET save_data = ?, updated_at = ? WHERE character_id = ? AND updated_at = ?'
      ).bind(loserJson, now, loserId, loserSave.updatedAt),
      env.DB.prepare(
        `UPDATE pvp_matches
            SET status = 'completed', ended_at = ?, winner_character_id = ?,
                current_tick = ?, state_json = ?, last_tick_at = ?
          WHERE id = ? AND status = 'active' AND current_tick = ?`
      ).bind(now, winnerId, stateNext.tick || 0, JSON.stringify(stateNext), now, match.id, match.current_tick),
      env.DB.prepare(
        'UPDATE characters SET active_match_id = NULL WHERE id IN (?, ?) AND active_match_id = ?'
      ).bind(match.character_a, match.character_b, match.id),
    ]
    const markIntents = appliedIntentsStatement(env, appliedIntentIds)
    if (markIntents) writes.push(markIntents)
    const [winnerUpdate, loserUpdate, matchUpdate] = await env.DB.batch(writes)

    if (winnerUpdate.meta.changes !== 1 || loserUpdate.meta.changes !== 1 || matchUpdate.meta.changes !== 1) {
      continue
    }
    return { ok: true, loot }
  }

  const abortWrites = [
    env.DB.prepare(
      "UPDATE pvp_matches SET status = 'aborted', ended_at = ?, state_json = ?, last_tick_at = ? WHERE id = ? AND status = 'active'"
    ).bind(now, JSON.stringify(stateNext), now, match.id),
    env.DB.prepare(
      'UPDATE characters SET active_match_id = NULL WHERE id IN (?, ?) AND active_match_id = ?'
    ).bind(match.character_a, match.character_b, match.id),
  ]
  const abortMarkIntents = appliedIntentsStatement(env, appliedIntentIds)
  if (abortMarkIntents) abortWrites.push(abortMarkIntents)
  await env.DB.batch(abortWrites)

  return { ok: false, reason: 'save_conflict' }
}

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getOwnedCharacter(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  const matchId = parseInt(params.id, 10)
  if (!Number.isFinite(matchId)) return json({ error: 'Invalid match id' }, 400)

  await sweepStaleRows(env)

  const found = await readOwnedActiveMatch(env, matchId, ch.id)
  if (found.error) return json({ error: found.error }, found.status)

  const match = found.row
  if (match.status !== 'active') return json({ error: 'match_not_active' }, 409)

  const state = parseMatchState(match)
  if (!state) return json({ error: 'invalid_match_state' }, 500)
  const now = Date.now()
  const pacing = shouldAdvancePvpTick(now, match.last_tick_at)
  if (!pacing.advance) {
    return json({
      ok: true,
      advanced: false,
      terminal: null,
      state: null,
      events: [],
      current_tick: match.current_tick,
      next_tick_at: pacing.nextTickAt,
    })
  }

  const intentsRows = await env.DB.prepare(
    `SELECT id, character_id, tick_number, character_seq, action_json
       FROM pvp_intents
      WHERE match_id = ?
        AND tick_number <= ?
        AND applied = 0
      ORDER BY tick_number ASC, character_id ASC, character_seq ASC`
  ).bind(matchId, (state.tick || 0) + 1).all()

  const intents = []
  const appliedIntentIds = []
  for (const row of intentsRows.results || []) {
    try {
      intents.push({
        tick_number: row.tick_number,
        characterId: row.character_id,
        characterSeq: row.character_seq,
        action: JSON.parse(row.action_json),
      })
      appliedIntentIds.push(row.id)
    } catch {
      // Ignore malformed intent payloads but still consume them so they
      // cannot poison every future tick forever.
      appliedIntentIds.push(row.id)
    }
  }

  const out = processPvpTick(state, intents, itemsData)

  if (out.terminal) {
    const terminal = await finalizeTerminalMatch(env, match, out.stateNext, out.terminal, appliedIntentIds)
    if (!terminal.ok) {
      console.error('[PocketRPG][PvP] terminal writeback failed', {
        matchId: match.id,
        winnerId: out.terminal.winner,
        loserId: out.terminal.loser,
        reason: terminal.reason,
      })
    }

    return json({
      ok: true,
      advanced: true,
      terminal: out.terminal,
      terminal_writeback: terminal.ok,
      state: out.stateNext,
      events: out.events,
      loot: terminal.loot?.summary || null,
      ended_at: now,
    })
  }

  const stateJson = JSON.stringify(out.stateNext)
  const writes = [
    env.DB.prepare(
      `UPDATE pvp_matches
          SET state_json = ?, current_tick = ?, last_tick_at = ?
        WHERE id = ? AND status = 'active' AND current_tick = ?`
    ).bind(stateJson, out.stateNext.tick || 0, now, matchId, match.current_tick),
  ]
  const markIntents = appliedIntentsStatement(env, appliedIntentIds)
  if (markIntents) writes.push(markIntents)
  const [updateRes] = await env.DB.batch(writes)

  if (updateRes.meta.changes === 0) {
    const current = await readOwnedActiveMatch(env, matchId, ch.id)
    if (current.error) return json({ error: current.error }, current.status)
    return json({
      ok: true,
      advanced: false,
      current_tick: current.row.current_tick,
      next_tick_at: (Number(current.row.last_tick_at) || Date.now()) + PVP_TICK_MS,
    })
  }

  return json({
    ok: true,
    advanced: true,
    terminal: null,
    state: out.stateNext,
    events: out.events,
  })
}
