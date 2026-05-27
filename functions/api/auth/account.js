// DELETE /api/auth/account — permanently deletes the authenticated identity and
// all of its characters' data. Required for in-app account deletion (Apple 5.1.1(v)).
import { requireAuth, json } from '../../_lib/auth.js'
import { accountDeletionPlan } from '../../_lib/accountDeletion.js'

export async function onRequestDelete({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const plan = accountDeletionPlan(auth.identity.id)
  await env.DB.batch(plan.map(({ sql, params }) => env.DB.prepare(sql).bind(...params)))

  return json({ ok: true })
}
