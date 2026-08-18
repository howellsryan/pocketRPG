// POST /api/admin/grant-credits — grant a one-off credit boost to any
// character, for free (refunds, welcome bonuses, goodwill).
//
// Unlike /api/admin/grant-item, this never touches the save blob: credits
// live on the `characters` row itself (§14's other credit writers — daily
// tasks, unlocks, skip-hour — all mutate that same column directly), so none
// of the three save locks apply and there is no save_revision to guard. The
// write is a single atomic UPDATE.
//
// Authorization is the ADMIN_SECRET only (functions/_lib/adminAuth.js) — a
// session JWT grants nothing here. The /admin portal is a front end for this
// endpoint and sends the same header.
import { json } from '../../_lib/auth.js'
import { isAdminRequest } from '../../_lib/adminAuth.js'
import { auditLog } from '../../_lib/game/audit.js'
import { toErrorResponse } from '../../_lib/game/errors.js'

// Far above the largest purchasable bundle (1,000 — src/../create-session.js),
// so a legitimate refund or compensation batch always fits, while a typo'd
// extra zero or two still gets caught.
const MAX_GRANT_AMOUNT = 100_000

export async function onRequestPost({ request, env }) {
  if (!isAdminRequest(request, env)) return json({ error: 'unauthorized', code: 'UNAUTHORIZED' }, 401)

  try {
    let body
    try {
      body = await request.json()
    } catch {
      return json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, 400)
    }

    const characterId = Math.floor(Number(body?.character_id) || 0)
    if (!Number.isInteger(characterId) || characterId <= 0) {
      return json({ error: 'character_id must be a positive integer', code: 'INVALID_CHARACTER_ID' }, 400)
    }

    const amount = Math.floor(Number(body?.amount) || 0)
    if (amount < 1 || amount > MAX_GRANT_AMOUNT) {
      return json({ error: `amount must be between 1 and ${MAX_GRANT_AMOUNT}`, code: 'INVALID_AMOUNT' }, 400)
    }

    const reason = typeof body?.reason === 'string' ? body.reason.slice(0, 200) : null
    const dryRun = Boolean(body?.dry_run)

    const row = await env.DB.prepare(
      'SELECT id, owner_id, username, credits FROM characters WHERE id = ? AND deleted_at IS NULL',
    ).bind(characterId).first()
    if (!row) return json({ error: 'Character not found', code: 'CHARACTER_NOT_FOUND' }, 404)

    const before = Number(row.credits) || 0

    if (dryRun) {
      return json({
        ok: true,
        dry_run: true,
        character_id: characterId,
        username: row.username,
        amount,
        before,
        after: before + amount,
      })
    }

    const write = await env.DB.prepare(
      'UPDATE characters SET credits = credits + ?1 WHERE id = ?2 AND deleted_at IS NULL RETURNING credits',
    ).bind(amount, characterId).first()
    if (!write) return json({ error: 'Character not found', code: 'CHARACTER_NOT_FOUND' }, 404)
    const after = Number(write.credits) || 0

    // No identityId — the admin secret is not an account, and stamping the
    // character's OWNER into the actor column would read as the player having
    // granted it to themselves.
    await auditLog(env, 'admin_credit_grant', {
      characterId,
      ownerId: row.owner_id,
      amount,
      before,
      after,
      reason,
    }, { swallow: true })

    return json({
      ok: true,
      character_id: characterId,
      username: row.username,
      amount,
      before,
      after,
    })
  } catch (err) {
    const mapped = toErrorResponse(err)
    return json(mapped.body, mapped.status)
  }
}
