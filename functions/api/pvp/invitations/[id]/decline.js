// POST /api/pvp/invitations/:id/decline
//
// Recipient declines a pending invitation. The row is kept (status =
// 'declined') for audit / future analytics; the unique partial index on
// pending invites only blocks duplicates while status='pending'.

import { requireAuth, json } from '../../../../_lib/auth.js'
import { getOwnedCharacter } from '../../../../_lib/pvp.js'

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getOwnedCharacter(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  const inviteId = parseInt(params.id, 10)
  if (!Number.isFinite(inviteId)) return json({ error: 'Invalid invitation id' }, 400)

  const now = Date.now()
  const res = await env.DB.prepare(
    `UPDATE pvp_invitations SET status = 'declined', responded_at = ?
      WHERE id = ? AND to_character = ? AND status = 'pending'`
  ).bind(now, inviteId, ch.id).run()

  if (!res.meta.changes) {
    // Either the invite doesn't exist, isn't ours, or isn't pending. Don't
    // leak which — return a generic 404.
    return json({ error: 'Invitation not found' }, 404)
  }

  return json({ ok: true })
}
