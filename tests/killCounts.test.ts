import { describe, it, expect, vi } from 'vitest'

vi.mock('../functions/_lib/auth.js', () => ({
  requireAuth: async () => ({ identity: { id: 1 } }),
  json: (body: any, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
}))

import { onRequestGet } from '../functions/api/kill-counts.js'
import { makeCompletionHandler } from '../functions/api/actions/_completeShared.js'

describe('GET /api/kill-counts', () => {
  it('returns boss and raid counts, keeping same source_id distinct per type', async () => {
    const env = {
      DB: {
        prepare: (sql: string) => ({
          bind: () => ({
            first: async () => (/FROM characters/.test(sql) ? { id: 42 } : null),
            all: async () => ({
              results: [
                { source_type: 'monsters', source_id: 'dragon', kill_count: 7 },
                { source_type: 'raids', source_id: 'dragon', kill_count: 3 },
              ],
            }),
          }),
        }),
      },
    }
    const req = new Request('https://example.com/api/kill-counts', {
      headers: { 'X-Character-Id': '42' },
    })
    const res = await onRequestGet({ request: req, env: env as any })
    expect(res.status).toBe(200)
    const body = await res.json()
    // The monster 'dragon' and the raid 'dragon' must not collide.
    expect(body.entries).toContainEqual({ sourceType: 'monsters', sourceId: 'dragon', killCount: 7 })
    expect(body.entries).toContainEqual({ sourceType: 'raids', sourceId: 'dragon', killCount: 3 })
  })
})

describe('kill count increment replay safety', () => {
  it('does not touch kill_counts when the action nonce is a replay', async () => {
    const killCountWrites: any[] = []
    const env = {
      DB: {
        prepare: (sql: string) => ({
          bind: () => ({
            first: async () => {
              if (/kill_counts/.test(sql)) killCountWrites.push(sql)
              return { kill_count: 1 }
            },
          }),
        }),
      },
    }
    const handler = makeCompletionHandler('raids', {
      requireAuth: async () => ({ identity: { id: 1 } }),
      claimActionNonce: async () => {
        const { GameApiError } = await import('../functions/_lib/game/errors.js')
        throw new GameApiError('STALE_REPLAYED_ACTION', 'stale_replayed_action', 409)
      },
      loadCharacterWithSave: async () => ({ saveObject: { inventory: [] }, saveRevision: 0 }),
      writeSave: async () => ({ updatedAt: 1, saveRevision: 1 }),
    })
    const req = new Request('https://example.com/api/actions/raid/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Character-Id': '42' },
      body: JSON.stringify({ sourceId: 'cryptbound_champions', actionNonce: 'replay', rewards: [] }),
    })
    const res = await handler({ request: req, env: env as any })
    expect(res.status).toBe(409)
    // The nonce claim throws before the increment runs — no double count.
    expect(killCountWrites.length).toBe(0)
  })
})
