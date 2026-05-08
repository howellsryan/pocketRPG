import { json } from '../../_lib/auth.js'
import { computeSaveSummaryFromJson } from '../../_lib/saveSummary.js'

const DEFAULT_BATCH_SIZE = 250
const MAX_BATCH_SIZE = 1000

function isAuthorized(request, env) {
  const expected = env.MAINTENANCE_SECRET
  if (!expected) return false
  const provided = request.headers.get('X-Maintenance-Secret') || ''
  return provided && provided === expected
}

export async function onRequestPost({ request, env }) {
  if (!isAuthorized(request, env)) return json({ error: 'unauthorized' }, 401)

  const url = new URL(request.url)
  const limit = Math.max(1, Math.min(MAX_BATCH_SIZE, parseInt(url.searchParams.get('limit') || `${DEFAULT_BATCH_SIZE}`, 10) || DEFAULT_BATCH_SIZE))

  const rows = await env.DB.prepare(
    `SELECT c.id AS character_id, s.save_data
       FROM characters c
       JOIN saves s ON s.character_id = c.id
      WHERE c.deleted_at IS NULL
        AND (c.total_level = 0 OR c.combat_level = 3)
      LIMIT ?`
  ).bind(limit).all()

  const updates = []
  for (const row of rows.results || []) {
    const summary = computeSaveSummaryFromJson(row.save_data)
    if (summary.totalLevel > 0 || summary.combatLevel > 3) {
      updates.push(
        env.DB.prepare('UPDATE characters SET total_level = ?, combat_level = ? WHERE id = ?').bind(
          summary.totalLevel,
          summary.combatLevel,
          row.character_id,
        ),
      )
    }
  }

  if (updates.length) await env.DB.batch(updates)

  return json({ ok: true, scanned: (rows.results || []).length, updated: updates.length })
}
