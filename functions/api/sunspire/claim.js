import { json } from '../../_lib/auth.js'
import { auditLog } from '../../_lib/game/audit.js'
import { claimActionNonce } from '../../_lib/game/nonces.js'
import { settleActionCompletion } from '../../_lib/game/actionCompletion.js'
import { loadCharacterWithSave, writeSave } from '../../_lib/game/save.js'
import { isValidEntry } from '../../_lib/collectionLog.js'
import { prepareSunspireClaim } from '../../_lib/game/sunspireRun.js'
import { getOpenSunspireRun, getSunspireRunById, persistSunspireRun } from '../../_lib/game/sunspireStore.js'
import { sunspireBody, sunspireCharacter, sunspireError } from '../../_lib/game/sunspireApi.js'
import { GameApiError } from '../../_lib/game/errors.js'

const SOURCE_TYPE = 'raids'
const SOURCE_ID = 'sunspire_colosseum'

function markerFragment(runId, nonce) {
  return `${JSON.stringify(runId)}:${JSON.stringify(nonce)}`
}

function settlementMarker(saveObject, runId) {
  return saveObject?._serverSettlements?.sunspire?.[runId] || null
}

function setSettlementMarker(saveObject, runId, nonce) {
  if (!saveObject._serverSettlements || typeof saveObject._serverSettlements !== 'object') saveObject._serverSettlements = {}
  if (!saveObject._serverSettlements.sunspire || typeof saveObject._serverSettlements.sunspire !== 'object') saveObject._serverSettlements.sunspire = {}
  saveObject._serverSettlements.sunspire[runId] = nonce
}

function settlementSideEffects(env, characterId, run, nextRevision, marker, now) {
  const checks = `EXISTS (
    SELECT 1 FROM saves WHERE character_id = ? AND save_revision = ? AND instr(save_data, ?) > 0
  )`
  const out = []

  for (const reward of run.settlement || []) {
    if (!isValidEntry(SOURCE_TYPE, SOURCE_ID, reward?.itemId)) continue
    out.push(env.DB.prepare(
      `INSERT INTO collection_log (character_id, item_id, source_type, source_id, obtained_at)
       SELECT ?, ?, 'raids', 'sunspire_colosseum', ? WHERE ${checks}
       ON CONFLICT(character_id, item_id, source_type, source_id) DO NOTHING`
    ).bind(characterId, reward.itemId, now, characterId, nextRevision, marker))
  }

  if (run.final_wave_cleared) {
    out.push(env.DB.prepare(
      `INSERT INTO kill_counts (character_id, source_type, source_id, kill_count, updated_at)
       SELECT ?, 'raids', 'sunspire_colosseum', 1, ?
       WHERE EXISTS (
         SELECT 1 FROM sunspire_runs WHERE character_id = ? AND run_id = ? AND completion_counted = 0
       ) AND ${checks}
       ON CONFLICT(character_id, source_type, source_id)
       DO UPDATE SET kill_count = kill_count + 1, updated_at = excluded.updated_at`
    ).bind(characterId, now, characterId, run.run_id, characterId, nextRevision, marker))
    out.push(env.DB.prepare(
      `UPDATE sunspire_runs SET completion_counted = 1
       WHERE character_id = ? AND run_id = ? AND completion_counted = 0 AND ${checks}`
    ).bind(characterId, run.run_id, characterId, nextRevision, marker))
  }

  out.push(env.DB.prepare(
    `UPDATE sunspire_runs
     SET status = 'settled', chest_json = '[]', staged_json = '[]', offers_json = '[]',
         settled_at = ?, updated_at = ?
     WHERE character_id = ? AND run_id = ? AND status = 'settling' AND ${checks}`
  ).bind(now, now, characterId, run.run_id, characterId, nextRevision, marker))
  return out
}

export async function onRequestPost({ request, env }) {
  const ctx = await sunspireCharacter(request, env)
  if (ctx.response) return ctx.response
  try {
    const body = await sunspireBody(request)
    const nonce = typeof body?.actionNonce === 'string' ? body.actionNonce : null
    let run = await getOpenSunspireRun(env, ctx.character.id)
    if (!run) throw new GameApiError('SUNSPIRE_RUN_MISSING', 'No claimable Sunspire run', 404)

    if (run.status === 'decision') {
      await claimActionNonce(env, ctx.character.id, nonce)
      run = prepareSunspireClaim(run, nonce)
      run.last_action_nonce = nonce
      run = await persistSunspireRun(env, ctx.character.id, run)
    } else if (run.status === 'settling') {
      // The first request already claimed its nonce and froze the settlement.
      // A network retry with that nonce resumes rather than trying to claim it
      // again; a fresh nonce may also resume the SAME immutable settlement.
      if (nonce !== run.claim_nonce) await claimActionNonce(env, ctx.character.id, nonce)
    } else {
      throw new GameApiError('SUNSPIRE_NOT_CLAIMABLE', 'Sunspire run is not claimable', 409)
    }

    const { saveObject, saveRevision } = await loadCharacterWithSave(env, ctx.character.id, ctx.auth.identity.id)
    const marker = markerFragment(run.run_id, run.claim_nonce)
    let settled = { granted: (run.settlement || []).map(r => ({ ...r, destination: null })) }

    if (settlementMarker(saveObject, run.run_id) !== run.claim_nonce) {
      settled = settleActionCompletion(saveObject, {
        sourceType: SOURCE_TYPE,
        sourceId: SOURCE_ID,
        rewards: run.settlement || [],
      })
      setSettlementMarker(saveObject, run.run_id, run.claim_nonce)
    }

    const nextRevision = saveRevision + 1
    const now = Date.now()
    const write = await writeSave(env, ctx.character.id, saveObject, saveRevision, {
      extraStatements: settlementSideEffects(env, ctx.character.id, run, nextRevision, marker, now),
      auditEvent: {
        eventType: 'sunspire.claim',
        identityId: ctx.auth.identity.id,
        payload: {
          runId: run.run_id,
          clearedWave: run.cleared_wave,
          finalWave: run.final_wave_cleared,
          rewards: (run.settlement || []).map(r => ({ itemId: r.itemId, quantity: r.quantity })),
        },
      },
    })

    const finalRun = await getSunspireRunById(env, ctx.character.id, run.run_id)
    const kc = run.final_wave_cleared
      ? await env.DB.prepare(
        `SELECT kill_count FROM kill_counts WHERE character_id = ? AND source_type = 'raids' AND source_id = 'sunspire_colosseum'`
      ).bind(ctx.character.id).first()
      : null

    await auditLog(env, 'sunspire.run.settled', {
      characterId: ctx.character.id, runId: run.run_id, clearedWave: run.cleared_wave,
      finalWave: run.final_wave_cleared, granted: settled.granted?.length || 0,
    }, { swallow: true })

    return json({
      ok: true,
      run: finalRun,
      granted: settled.granted || [],
      fullClear: run.final_wave_cleared,
      killCount: kc ? { sourceType: SOURCE_TYPE, sourceId: SOURCE_ID, killCount: Math.max(0, Number(kc.kill_count) || 0) } : null,
      save: { save_data: JSON.stringify(saveObject), updatedAt: write.updatedAt, save_revision: write.saveRevision },
    })
  } catch (err) {
    return sunspireError(err)
  }
}
