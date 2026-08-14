// POST /api/grim-reaper/reclaim — buy back everything a hard-mode death took.
//
// One stash, one price, all or nothing (src/engine/grimReaper.js). The stash
// itself is written by whichever death populated it — the client-trusted save
// blob for solo/idle deaths, the co-op room's own write-back for a group
// death (functions/_lib/game/coopBoss.js) — this endpoint only ever reads the
// server's own stored copy and prices it itself; nothing about the reclaim
// trusts a client-submitted item list or cost.
import { requireAuth, json } from '../../_lib/auth.js'
import { assertNotInCoopSession } from '../../_lib/game/coopBoss.js'
import { isWorldSessionLive } from '../../_lib/game/worldSessions.js'
import { loadCharacterWithSave, writeSave } from '../../_lib/game/save.js'
import { addItemToBank } from '../../_lib/game/inventory.js'
import { toErrorResponse } from '../../_lib/game/errors.js'
import { grimReaperCost } from '../../../src/engine/grimReaper.js'
import itemsData from '../../../src/data/items.json' assert { type: 'json' }

// An item id the stash carries but items.json no longer recognises (removed
// content) prices at 0 and is dropped from the grant — it cannot be bought
// back for nothing, and it cannot block reclaiming everything else either.
function resolvableStashItems(items) {
  return (Array.isArray(items) ? items : []).filter((entry) =>
    typeof entry?.itemId === 'string' && Object.prototype.hasOwnProperty.call(itemsData, entry.itemId),
  )
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const characterId = parseInt(request.headers.get('X-Character-Id') || '0', 10)
  if (!characterId) return json({ error: 'Missing X-Character-Id header' }, 400)

  try {
    // Same save-lock trio as every other server-authoritative writer (§14):
    // a co-op room or the open world owns this save's holdings until it
    // releases the lock, so a reclaim underneath either would either be lost
    // or double-grant on the next write-back.
    const coopLock = await assertNotInCoopSession(env, characterId)
    if (coopLock) return coopLock
    if (await isWorldSessionLive(env, characterId)) {
      return json({ error: 'character_in_world_session', code: 'CHARACTER_IN_WORLD_SESSION' }, 409)
    }

    const { saveObject, saveRevision } = await loadCharacterWithSave(env, characterId, auth.identity.id)
    const stash = saveObject.settings?.grimReaper
    const stashItems = resolvableStashItems(stash?.items)
    if (!stash) {
      return json({ error: 'No death stashed with the Grim Reaper', code: 'NO_STASH' }, 404)
    }
    if (stashItems.length === 0) {
      // Every stashed item id has since been removed from items.json — there
      // is nothing left to price or grant. Clear the phantom stash so it
      // doesn't 404 forever; this is a cleanup write, not a reclaim, so no
      // cost/credits are involved.
      const settings = { ...(saveObject.settings && typeof saveObject.settings === 'object' ? saveObject.settings : {}) }
      delete settings.grimReaper
      saveObject.settings = settings
      await writeSave(env, characterId, saveObject, saveRevision, {
        auditEvent: {
          eventType: 'grim_reaper.stash_expired',
          identityId: auth.identity.id,
          payload: { characterId },
        },
      })
      return json({ error: 'No death stashed with the Grim Reaper', code: 'NO_STASH' }, 404)
    }

    const cost = grimReaperCost(stashItems, itemsData)

    const debit = await env.DB.prepare(`
      UPDATE characters
      SET credits = credits - ?1,
          credits_used = credits_used + ?1
      WHERE id = ?2
        AND owner_id = ?3
        AND deleted_at IS NULL
        AND credits >= ?1
      RETURNING credits AS credits_remaining
    `).bind(cost, characterId, auth.identity.id).first()
    if (!debit) return json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS', cost }, 402)

    for (const entry of stashItems) {
      addItemToBank(saveObject, entry.itemId, entry.quantity, { charges: Math.max(0, Math.floor(Number(entry.charges) || 0)) })
    }
    const settings = { ...(saveObject.settings && typeof saveObject.settings === 'object' ? saveObject.settings : {}) }
    delete settings.grimReaper
    saveObject.settings = settings

    let write
    try {
      write = await writeSave(env, characterId, saveObject, saveRevision, {
        auditEvent: {
          eventType: 'grim_reaper.reclaimed',
          identityId: auth.identity.id,
          payload: { characterId, items: stashItems, cost, credits_remaining: debit.credits_remaining ?? 0 },
        },
      })
    } catch (err) {
      // The credits are already spent — a failed write must not keep them.
      // No `credits >= ?` guard here: refunding what was just taken always
      // succeeds regardless of what else happened to the balance meanwhile.
      await env.DB.prepare(`
        UPDATE characters SET credits = credits + ?1, credits_used = credits_used - ?1
        WHERE id = ?2 AND owner_id = ?3
      `).bind(cost, characterId, auth.identity.id).run()
      throw err
    }

    return json({
      ok: true,
      items: stashItems,
      cost,
      credits_remaining: debit.credits_remaining ?? 0,
      updatedAt: write.updatedAt,
      save_revision: write.saveRevision,
    })
  } catch (err) {
    const mapped = toErrorResponse(err)
    return json(mapped.body, mapped.status)
  }
}
