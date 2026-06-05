import { requireAuth, json } from '../../../../_lib/auth.js'
import { getOwnedCharacter, sweepStaleRows } from '../../../../_lib/pvp.js'
import { readOwnedActiveMatch, itemsData, readCharacterSave, applyCombatantToSave } from '../../../../_lib/pvpMatch.js'
import { processPvpTick } from '../../../../../src/engine/pvpEngine.js'
import { applyLootTransfer, splitInventoryByTradeable, fillBank, lootEntryValue } from '../../../../../src/engine/lootTransfer.js'
import { appendPvpEndSummaryToState, createPvpEndSummary } from '../../../../../src/engine/pvpEndSummary.js'
import { rollBotLootBox, isZestaUnique } from '../../../../../src/engine/pvpBotRewards.js'
import { computeBotIntents } from '../../../../../src/engine/pvpBotAI.js'
import { resetBotSave } from '../../../../_lib/pvpBot.js'
import { persistPvpBotCollectionLog } from '../../../../_lib/collectionLog.js'
import { gzipJsonString } from '../../../../_lib/saveCodec.js'
import { auditLog } from '../../../../_lib/game/audit.js'

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

// ── Bot-aware terminal finalization ──────────────────────────────────────────

async function finalizeTerminalMatch(env, match, stateNext, terminal, appliedIntentIds) {
  const now      = Date.now()
  const winnerId = terminal.winner
  const loserId  = terminal.loser

  // Detect bot involvement from the match columns.
  const botRow = await env.DB.prepare(
    'SELECT id, bot_template_id FROM characters WHERE id IN (?, ?) AND is_bot = 1 LIMIT 1'
  ).bind(match.character_a, match.character_b).first()

  const isBotMatch  = !!botRow
  const botId       = botRow?.id || null
  const humanWinner = isBotMatch && (winnerId !== botId)
  const humanId     = isBotMatch ? (botId === winnerId ? loserId : winnerId) : null

  for (let attempt = 0; attempt < 2; attempt++) {
    const winnerSave = await readCharacterSave(env, winnerId)
    const loserSave  = await readCharacterSave(env, loserId)
    if (!winnerSave || !loserSave) return { ok: false, reason: 'missing_save' }

    const winnerCombatant = stateNext.combatants[String(winnerId)]
    const loserCombatant  = stateNext.combatants[String(loserId)]

    let winnerSnapshot = applyCombatantToSave(winnerSave.payload, winnerCombatant)
    let loserSnapshot  = applyCombatantToSave(loserSave.payload,  loserCombatant)

    let lootSummary
    let botLootBox = null

    if (isBotMatch) {
      if (humanWinner) {
        // Human wins: roll loot box, add to human's bank. Bot gear not transferred.
        const humanSnapshot = applyCombatantToSave(
          (winnerId === humanId ? winnerSave : loserSave).payload,
          stateNext.combatants[String(humanId)],
        )
        const rewards = rollBotLootBox()
        const fillResult = fillBank(humanSnapshot.bank || {}, rewards, itemsData)
        humanSnapshot.bank = fillResult.bank
        botLootBox = { rewards, added: fillResult.added, dropped: fillResult.dropped }

        if (winnerId === humanId) winnerSnapshot = humanSnapshot
        else                      loserSnapshot  = humanSnapshot

        lootSummary = {
          transferCount: rewards.length,
          added: fillResult.added,
          dropped: fillResult.dropped,
          addedValue: fillResult.addedValue,
          bankedValue: fillResult.addedValue,
          droppedValue: fillResult.droppedValue,
          totalRiskValue: 0,
          isBotLootBox: true,
        }
      } else {
        // Bot wins: strip human's tradeable gear (item sink). No transfer to bot.
        const humanSnapshot = applyCombatantToSave(
          (loserId === humanId ? loserSave : winnerSave).payload,
          stateNext.combatants[String(humanId)],
        )
        const { remainingInventory, remainingEquipment, transfer } =
          splitInventoryByTradeable(humanSnapshot.inventory || [], humanSnapshot.equipment || {}, itemsData)
        humanSnapshot.inventory = remainingInventory
        humanSnapshot.equipment = remainingEquipment

        if (loserId === humanId) loserSnapshot  = humanSnapshot
        else                     winnerSnapshot = humanSnapshot

        lootSummary = {
          transferCount: 0,
          added: [],
          dropped: [],
          addedValue: 0,
          bankedValue: 0,
          droppedValue: 0,
          totalRiskValue: transfer.reduce((s, e) => s + lootEntryValue(e, itemsData), 0),
          isBotLootBox: true,
        }
      }
    } else {
      // Normal human-vs-human loot transfer (existing logic).
      const loot = applyLootTransfer({
        loserInventory: loserSnapshot.inventory || [],
        loserEquipment: loserSnapshot.equipment || {},
        winnerBank: winnerSnapshot.bank || {},
        itemsData,
      })
      winnerSnapshot.bank      = loot.winner.bank
      loserSnapshot.inventory  = loot.loser.inventory
      loserSnapshot.equipment  = loot.loser.equipment
      lootSummary              = loot.summary
    }

    const endSummary  = createPvpEndSummary({ terminal, loot: lootSummary, endedAt: now, writebackOk: true })
    const finalState  = appendPvpEndSummaryToState(stateNext, endSummary)

    // For bot matches, only persist the human's save (bot will be reset separately).
    const winnerJson = JSON.stringify(winnerSnapshot)
    const loserJson  = JSON.stringify(loserSnapshot)
    const winnerBlob = await gzipJsonString(winnerJson)
    const loserBlob  = isBotMatch ? null : await gzipJsonString(loserJson)
    const finalStateJson = JSON.stringify(finalState)

    const writes = [
      env.DB.prepare(
        'UPDATE saves SET save_blob = ?, updated_at = ? WHERE character_id = ? AND updated_at = ?'
      ).bind(winnerBlob, now, winnerId, winnerSave.updatedAt),
    ]
    // Only write loser save for human-vs-human; bots are reset in a separate call.
    if (!isBotMatch) {
      writes.push(
        env.DB.prepare(
          'UPDATE saves SET save_blob = ?, updated_at = ? WHERE character_id = ? AND updated_at = ?'
        ).bind(loserBlob, now, loserId, loserSave.updatedAt),
      )
    } else if (loserId === humanId) {
      // Bot won: write the stripped human (loser) save.
      const humanLoserBlob = await gzipJsonString(loserJson)
      writes.push(
        env.DB.prepare(
          'UPDATE saves SET save_blob = ?, updated_at = ? WHERE character_id = ? AND updated_at = ?'
        ).bind(humanLoserBlob, now, loserId, loserSave.updatedAt),
      )
    }

    writes.push(
      env.DB.prepare(
        `UPDATE pvp_matches
            SET status = 'completed', ended_at = ?, winner_character_id = ?,
                current_tick = ?, state_json = ?, last_tick_at = ?
          WHERE id = ? AND status = 'active' AND current_tick = ?`
      ).bind(now, winnerId, finalState.tick || 0, finalStateJson, now, match.id, match.current_tick),
      env.DB.prepare(
        'UPDATE characters SET active_match_id = NULL WHERE id IN (?, ?) AND active_match_id = ?'
      ).bind(match.character_a, match.character_b, match.id),
    )
    const markIntents = appliedIntentsStatement(env, appliedIntentIds)
    if (markIntents) writes.push(markIntents)
    writes.push(env.DB.prepare(
      `UPDATE characters
          SET total_pvp_kills = COALESCE(total_pvp_kills, 0) + 1,
              last_updated_total_pvp_kills = ?
        WHERE id = ?
          AND EXISTS (
            SELECT 1 FROM pvp_matches
             WHERE id = ?
               AND status = 'completed'
               AND winner_character_id = ?
               AND ended_at = ?
          )`
    ).bind(now, winnerId, match.id, winnerId, now))

    const batchResults = await env.DB.batch(writes)
    const winnerUpdate = batchResults[0]
    const matchUpdate  = batchResults[isBotMatch ? 1 : 2]
    const killUpdate   = batchResults[batchResults.length - 1]

    if (winnerUpdate.meta.changes !== 1 || matchUpdate.meta.changes !== 1 || killUpdate.meta.changes !== 1) {
      continue
    }

    // Reset bot save (both win and loss cases) — idempotent, runs after batch.
    if (isBotMatch && botId) {
      await resetBotSave(env, botId)
    }

    // Collection log for Zesta unique drops.
    const collectionLogEntries = []
    if (humanWinner && botLootBox) {
      for (const entry of botLootBox.rewards || []) {
        if (isZestaUnique(entry.itemId)) {
          const logEntry = await persistPvpBotCollectionLog(env, humanId, entry.itemId)
          if (logEntry) collectionLogEntries.push(logEntry)
        }
      }
    }

    return { ok: true, loot: { summary: lootSummary }, state: finalState, endSummary, collectionLogEntries, botLootBox }
  }

  // Both attempts failed — abort with no loot transfer.
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

  if (isBotMatch && botId) {
    await resetBotSave(env, botId)
  }

  return { ok: false, reason: 'save_conflict' }
}

// ── Request handler ───────────────────────────────────────────────────────────

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
      appliedIntentIds.push(row.id)
    }
  }

  // Inject bot intents in-memory (no DB write — state snapshot is authoritative).
  const botCombatantIds = Object.keys(state.combatants || {}).filter(
    (id) => state.combatants[id]?.isBot,
  )
  for (const botIdStr of botCombatantIds) {
    const botId      = Number(botIdStr)
    const botActions = computeBotIntents(state, botId, itemsData)
    let   botSeq     = 1000  // high seq so bot acts after any human intent on same tick
    for (const action of botActions) {
      intents.push({
        tick_number:  (state.tick || 0) + 1,
        characterId:  botId,
        characterSeq: botSeq++,
        action,
      })
    }
  }

  const out = processPvpTick(state, intents, itemsData, now)

  if (out.terminal) {
    const terminalWrite = await finalizeTerminalMatch(env, match, out.stateNext, out.terminal, appliedIntentIds)
    if (!terminalWrite.ok) {
      console.error('[PocketRPG][PvP] terminal writeback failed', {
        matchId: match.id,
        winnerId: out.terminal.winner,
        loserId: out.terminal.loser,
        reason: terminalWrite.reason,
      })
    }
    await auditLog(env, 'pvp.match.settled', {
      matchId: match.id,
      winnerCharacterId: out.terminal.winner,
      loserCharacterId: out.terminal.loser,
      reason: out.terminal.reason || null,
      writebackOk: terminalWrite.ok,
      loot: terminalWrite.loot?.summary || null,
      botLootBox: terminalWrite.botLootBox || null,
    }, { swallow: true })

    return json({
      ok: true,
      advanced: true,
      terminal: terminalWrite.endSummary?.terminal || out.terminal,
      terminal_writeback: terminalWrite.ok,
      end_summary: terminalWrite.endSummary || null,
      state: terminalWrite.state || out.stateNext,
      events: out.events,
      loot: terminalWrite.loot?.summary || null,
      bot_loot_box: terminalWrite.botLootBox || null,
      collection_log_entries: terminalWrite.collectionLogEntries || [],
      ended_at: terminalWrite.endSummary?.endedAt || now,
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
