import { requireAuth, json } from '../../_lib/auth.js'
import { auditLog } from '../../_lib/game/audit.js'
import { allBlockableSlayerTaskIds } from '../../../src/engine/slayerMasters.js'
import {
  SLAYER_TASK_BLOCK_COST, SLAYER_TASK_BLOCK_MAX,
  listSlayerTaskBlocks, insertSlayerTaskBlock, setSlayerTaskBlockActive, removeSlayerTaskBlock,
} from '../../_lib/game/slayerTaskBlocks.js'

const BLOCKABLE_IDS = new Set(allBlockableSlayerTaskIds())

async function ownedCharacterId(request, env, auth) {
  const characterId = parseInt(request.headers.get('X-Character-Id') || '0', 10)
  if (!characterId) return { error: json({ error: 'Missing X-Character-Id header' }, 400) }
  const character = await env.DB.prepare(
    'SELECT id FROM characters WHERE id = ? AND owner_id = ? AND deleted_at IS NULL'
  ).bind(characterId, auth.identity.id).first()
  if (!character) return { error: json({ error: 'Character not found' }, 404) }
  return { characterId }
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)
  const owned = await ownedCharacterId(request, env, auth)
  if (owned.error) return owned.error

  return json({ entries: await listSlayerTaskBlocks(env, owned.characterId), cost: SLAYER_TASK_BLOCK_COST, max: SLAYER_TASK_BLOCK_MAX })
}

// Purchase a new block: costs SLAYER_TASK_BLOCK_COST credits, refused past
// SLAYER_TASK_BLOCK_MAX or for a monster already blocked. The debit and the
// insert are separate statements (D1 has no conditional multi-statement
// transaction here), so a failed insert refunds — same pattern as
// /api/grim-reaper/reclaim.
export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)
  const owned = await ownedCharacterId(request, env, auth)
  if (owned.error) return owned.error
  const { characterId } = owned

  const body = await request.json().catch(() => null)
  const monsterId = typeof body?.monsterId === 'string' ? body.monsterId : null
  if (!monsterId || !BLOCKABLE_IDS.has(monsterId)) {
    return json({ error: 'Unknown monster', code: 'UNKNOWN_MONSTER' }, 400)
  }

  const debit = await env.DB.prepare(`
    UPDATE characters
    SET credits = credits - ?1,
        credits_used = credits_used + ?1
    WHERE id = ?2
      AND owner_id = ?3
      AND deleted_at IS NULL
      AND credits >= ?1
    RETURNING credits AS credits_remaining
  `).bind(SLAYER_TASK_BLOCK_COST, characterId, auth.identity.id).first()
  if (!debit) return json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' }, 402)

  const inserted = await insertSlayerTaskBlock(env, characterId, monsterId)
  if (!inserted) {
    await env.DB.prepare(`
      UPDATE characters SET credits = credits + ?1, credits_used = credits_used - ?1
      WHERE id = ?2 AND owner_id = ?3
    `).bind(SLAYER_TASK_BLOCK_COST, characterId, auth.identity.id).run()
    const existing = await listSlayerTaskBlocks(env, characterId)
    if (existing.some((b) => b.monsterId === monsterId)) {
      return json({ error: 'Already blocked', code: 'ALREADY_BLOCKED' }, 400)
    }
    return json({ error: 'Block list is full', code: 'BLOCK_LIST_FULL', max: SLAYER_TASK_BLOCK_MAX }, 400)
  }

  await auditLog(env, 'slayer_task_block.purchased', {
    characterId, identityId: auth.identity.id, monsterId, cost: SLAYER_TASK_BLOCK_COST,
    credits_remaining: debit.credits_remaining ?? 0,
  }, { swallow: true })

  return json({ ok: true, monsterId, active: true, credits_remaining: debit.credits_remaining ?? 0 })
}

// Toggle active/inactive — free, keeps the purchase.
export async function onRequestPatch({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)
  const owned = await ownedCharacterId(request, env, auth)
  if (owned.error) return owned.error
  const { characterId } = owned

  const body = await request.json().catch(() => null)
  const monsterId = typeof body?.monsterId === 'string' ? body.monsterId : null
  if (!monsterId) return json({ error: 'Unknown monster', code: 'UNKNOWN_MONSTER' }, 400)
  const active = body?.active === true

  const updated = await setSlayerTaskBlockActive(env, characterId, monsterId, active)
  if (!updated) return json({ error: 'Not blocked', code: 'NOT_BLOCKED' }, 404)

  await auditLog(env, 'slayer_task_block.toggled', {
    characterId, identityId: auth.identity.id, monsterId, active,
  }, { swallow: true })

  return json({ ok: true, monsterId, active })
}

// Removes the purchase outright — the client is responsible for warning the
// player this needs repurchasing; nothing here is refundable.
export async function onRequestDelete({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)
  const owned = await ownedCharacterId(request, env, auth)
  if (owned.error) return owned.error
  const { characterId } = owned

  const body = await request.json().catch(() => null)
  const monsterId = typeof body?.monsterId === 'string' ? body.monsterId : null
  if (!monsterId) return json({ error: 'Unknown monster', code: 'UNKNOWN_MONSTER' }, 400)

  const removed = await removeSlayerTaskBlock(env, characterId, monsterId)
  if (!removed) return json({ error: 'Not blocked', code: 'NOT_BLOCKED' }, 404)

  await auditLog(env, 'slayer_task_block.removed', {
    characterId, identityId: auth.identity.id, monsterId,
  }, { swallow: true })

  return json({ ok: true, monsterId })
}
