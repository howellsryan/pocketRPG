// Terminal settlement for a PvP match: loot transfer, both saves, the kill
// count, the audit event.
//
// This used to live inside the tick endpoint, which meant it ran BEFORE the
// optimistic write that decided whether the caller's tick counted — two clients
// polling into the same 600ms window each computed the same death and each
// tried to settle it.
//
// The old defence was to put the claim in the same D1 batch as the loot and
// check afterwards whether it had taken. That does not hold: a batch is one
// transaction, but a conditional UPDATE matching zero rows does not abort it —
// so the save writes committed anyway and only the claim no-opped. A second
// settler re-read the freshly written saves, overwrote the loser's stripped
// inventory from its own (pre-death) combatant snapshot, and transferred the
// same gear a second time. tests/pvpMatchRoom.test.ts reproduces it.
//
// So the claim comes FIRST and alone: flip 'active' → 'settling', and if that
// matched no rows, somebody else owns this death and we touch nothing. The
// room being single-threaded makes the race rare; this makes it impossible,
// including across an eviction replay.

import { applyLootTransfer, splitInventoryByTradeable, fillBank, lootEntryValue } from '../../src/engine/lootTransfer.js'
import { appendPvpEndSummaryToState, createPvpEndSummary } from '../../src/engine/pvpEndSummary.js'
import { rollBotLootBox, isZestaUnique } from '../../src/engine/pvpBotRewards.js'
import { resetBotSave } from './pvpBot.js'
import { persistPvpBotCollectionLog } from './collectionLog.js'
import { gzipJsonString } from './saveCodec.js'
import { auditLog } from './game/audit.js'
import { itemsData, readCharacterSave, applyCombatantToSave } from './pvpMatch.js'

export async function settlePvpMatch(env, match, stateNext, terminal) {
  const now      = Date.now()
  const winnerId = terminal.winner
  const loserId  = terminal.loser

  const botRow = await env.DB.prepare(
    'SELECT id, bot_template_id FROM characters WHERE id IN (?, ?) AND is_bot = 1 LIMIT 1'
  ).bind(match.character_a, match.character_b).first()

  const isBotMatch  = !!botRow
  const botId       = botRow?.id || null
  const humanWinner = isBotMatch && (winnerId !== botId)
  const humanId     = isBotMatch ? (botId === winnerId ? loserId : winnerId) : null

  const claim = await env.DB.prepare(
    "UPDATE pvp_matches SET status = 'settling', last_tick_at = ? WHERE id = ? AND status = 'active'"
  ).bind(now, match.id).run()
  if (claim.meta.changes !== 1) return { ok: false, reason: 'already_settled' }

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
    if (!isBotMatch) {
      writes.push(
        env.DB.prepare(
          'UPDATE saves SET save_blob = ?, updated_at = ? WHERE character_id = ? AND updated_at = ?'
        ).bind(loserBlob, now, loserId, loserSave.updatedAt),
      )
    } else if (loserId === humanId) {
      const humanLoserBlob = await gzipJsonString(loserJson)
      writes.push(
        env.DB.prepare(
          'UPDATE saves SET save_blob = ?, updated_at = ? WHERE character_id = ? AND updated_at = ?'
        ).bind(humanLoserBlob, now, loserId, loserSave.updatedAt),
      )
    }

    // Tracked rather than derived: the old index arithmetic
    // (`batchResults[isBotMatch ? 1 : 2]`) read the human loser's save write as
    // the match result whenever a bot won, so a failed write reported success.
    const matchCompleteIndex = writes.length
    writes.push(
      env.DB.prepare(
        `UPDATE pvp_matches
            SET status = 'completed', ended_at = ?, winner_character_id = ?,
                current_tick = ?, state_json = ?, last_tick_at = ?
          WHERE id = ? AND status = 'settling'`
      ).bind(now, winnerId, finalState.tick || 0, finalStateJson, now, match.id),
      env.DB.prepare(
        'UPDATE characters SET active_match_id = NULL WHERE id IN (?, ?) AND active_match_id = ?'
      ).bind(match.character_a, match.character_b, match.id),
      env.DB.prepare(
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
      ).bind(now, winnerId, match.id, winnerId, now),
    )

    const batchResults = await env.DB.batch(writes)
    const winnerUpdate = batchResults[0]
    const matchUpdate  = batchResults[matchCompleteIndex]
    const killUpdate   = batchResults[batchResults.length - 1]

    if (winnerUpdate.meta.changes !== 1 || matchUpdate.meta.changes !== 1 || killUpdate.meta.changes !== 1) {
      continue
    }

    if (isBotMatch && botId) await resetBotSave(env, botId)

    const collectionLogEntries = []
    if (humanWinner && botLootBox) {
      for (const entry of botLootBox.rewards || []) {
        if (isZestaUnique(entry.itemId)) {
          const logEntry = await persistPvpBotCollectionLog(env, humanId, entry.itemId)
          if (logEntry) collectionLogEntries.push(logEntry)
        }
      }
    }

    await auditLog(env, 'pvp.match.settled', {
      matchId: match.id,
      winnerCharacterId: winnerId,
      loserCharacterId: loserId,
      reason: terminal.reason || null,
      writebackOk: true,
      loot: lootSummary,
      botLootBox,
    }, { swallow: true })

    return { ok: true, loot: { summary: lootSummary }, state: finalState, endSummary, collectionLogEntries, botLootBox }
  }

  await abortPvpMatch(env, match, stateNext)
  if (isBotMatch && botId) await resetBotSave(env, botId)

  await auditLog(env, 'pvp.match.settled', {
    matchId: match.id,
    winnerCharacterId: winnerId,
    loserCharacterId: loserId,
    reason: terminal.reason || null,
    writebackOk: false,
    loot: null,
    botLootBox: null,
  }, { swallow: true })

  return { ok: false, reason: 'save_conflict' }
}

/** Ends a match without moving any items — the engine never resolved a winner,
 * so both inventories are left exactly as they were. Also the release valve for
 * a claim that could not be honoured, hence 'settling' as well as 'active'. */
export async function abortPvpMatch(env, match, stateNext) {
  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE pvp_matches SET status = 'aborted', ended_at = ?, state_json = ?, last_tick_at = ? WHERE id = ? AND status IN ('active', 'settling')"
    ).bind(now, JSON.stringify(stateNext || {}), now, match.id),
    env.DB.prepare(
      'UPDATE characters SET active_match_id = NULL WHERE id IN (?, ?) AND active_match_id = ?'
    ).bind(match.character_a, match.character_b, match.id),
  ])
}
