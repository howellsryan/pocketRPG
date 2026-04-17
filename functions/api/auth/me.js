import { requireAuth, json } from '../../_lib/auth.js'

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)
  return json({ identity: auth.identity })
}
