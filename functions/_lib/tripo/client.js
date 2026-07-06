// Thin wrapper around Tripo AI's task API (https://api.tripo3d.ai/v2/openapi).
// Mirrors the request/poll shape of scripts/tripo-worldmap.mjs, the original
// local-only version of this workflow, but reads the key from env (a
// Cloudflare secret) instead of process.env.

const API_BASE = 'https://api.tripo3d.ai/v2/openapi'

export class TripoApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'TripoApiError'
    this.status = status
  }
}

async function tripoRequest(env, path, init = {}) {
  if (!env.TRIPO_API_KEY) throw new TripoApiError('TRIPO_API_KEY is not configured on this worker.', 500)
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.TRIPO_API_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.code !== 0) {
    throw new TripoApiError(`Tripo ${path} failed (${res.status}): ${JSON.stringify(body)}`, res.status)
  }
  return body.data
}

export function createTripoTask(env, { type, ...params }) {
  if (!type) throw new TripoApiError('type is required.', 400)
  return tripoRequest(env, '/task', { method: 'POST', body: JSON.stringify({ type, ...params }) })
}

export function getTripoTask(env, taskId) {
  if (!taskId) throw new TripoApiError('task_id is required.', 400)
  return tripoRequest(env, `/task/${taskId}`)
}
