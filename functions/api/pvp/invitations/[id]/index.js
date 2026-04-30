// DELETE /api/pvp/invitations/:id
//
// Inviter cancels their own pending outgoing invitation. Sets status to
// 'expired' (rather than deleting the row) so future analytics / debug
// queries can distinguish cancelled-by-sender from declined-by-recipient.
// The unique partial index on pending invites releases the moment status
// changes off 'pending'.

import { requireAuth, json } from '../../../../_lib/auth.js'
import { getOwnedCharacter } from '../../../../_lib/pvp.js'

export async function onRequestDelete({ request, env, params }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getOwnedCharacter(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  const inviteId = parseInt(params.id, 10)
  if (!Number.isFinite(inviteId)) return json({ error: 'Invalid invitation id' }, 400)

  const now = Date.now()
  const res = await env.DB.prepare(
    `UPDATE pvp_invitations SET status = 'expired', responded_at = ?
      WHERE id = ? AND from_character = ? AND status = 'pending'`
  ).bind(now, inviteId, ch.id).run()

  if (!res.meta.changes) {
    return json({ error: 'Invitation not found' }, 404)
  }

  return json({ ok: true })
}
