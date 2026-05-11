import { describe, it, expect } from 'vitest'
import { makeCompletionHandler } from '../functions/api/actions/_completeShared.js'

function makeHandler() {
  return makeCompletionHandler('raids', {
    requireAuth: async () => ({ identity: { id: 1 } }),
    assertNotInActiveMatch: async () => null,
    loadCharacterWithSave: async () => ({ saveObject: { inventory: [{ id: 'food', quantity: 1 }] }, saveRevision: 0 }),
    writeSave: async () => ({ updatedAt: 1, saveRevision: 1 }),
  })
}

async function post(body: any) {
  const handler = makeHandler()
  const req = new Request('https://example.com/api/actions/raid/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Character-Id': '42' },
    body: JSON.stringify(body),
  })
  const res = await handler({ request: req, env: {} as any })
  return { status: res.status, body: await res.json() }
}

describe('action completion endpoint tamper guards', () => {
  it('rejects source spoofing', async () => {
    const out = await post({ sourceId: 'fake_raid', actionNonce: 'n1', rewards: [{ itemId: 'ahrims_hood', quantity: 1 }] })
    expect(out.status).toBe(403)
  })

  it('rejects protected item injection for wrong source item pair', async () => {
    const out = await post({ sourceId: 'barrows_brothers', actionNonce: 'n2', rewards: [{ itemId: 'twisted_bow', quantity: 1 }] })
    expect(out.status).toBe(403)
  })

  it('rejects stale/replayed nonce', async () => {
    const handler = makeCompletionHandler('raids', {
      requireAuth: async () => ({ identity: { id: 1 } }),
      assertNotInActiveMatch: async () => null,
      loadCharacterWithSave: async () => ({ saveObject: { _serverActionNonces: { replay: 1 }, inventory: [] }, saveRevision: 0 }),
      writeSave: async () => ({ updatedAt: 1, saveRevision: 1 }),
    })
    const req = new Request('https://example.com', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Character-Id': '42' }, body: JSON.stringify({ sourceId: 'barrows_brothers', actionNonce: 'replay', rewards: [] }) })
    const res = await handler({ request: req, env: {} as any })
    expect(res.status).toBe(409)
  })

  it('rejects insufficient supply consumption', async () => {
    const out = await post({ sourceId: 'barrows_brothers', actionNonce: 'n3', consumptions: [{ itemId: 'food', quantity: 5 }], rewards: [{ itemId: 'ahrims_hood', quantity: 1 }] })
    expect(out.status).toBe(400)
  })
})
