import { describe, it, expect } from 'vitest'
import { makeCompletionHandler } from '../functions/api/actions/_completeShared.js'

function makeHandler() {
  return makeCompletionHandler('raids', {
    requireAuth: async () => ({ identity: { id: 1 } }),
    assertNotInActiveMatch: async () => null,
    loadCharacterWithSave: async () => ({ saveObject: { inventory: [{ id: 'food', quantity: 1 }] }, saveRevision: 0 }),
    writeSave: async () => ({ updatedAt: 1, saveRevision: 1 }),
    resolveRewards: () => [],
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
    const out = await post({ sourceId: 'fake_raid', actionNonce: 'n1', rewards: [{ itemId: 'morvyn_s_hood', quantity: 1 }] })
    expect(out.status).toBe(403)
  })

  it('rejects protected item injection for wrong source item pair', async () => {
    const out = await post({ sourceId: 'barrows_brothers', actionNonce: 'n2', rewards: [{ itemId: 'warped_bow', quantity: 1 }] })
    expect(out.status).toBe(200)
    expect(out.body.ok).toBe(true)
    expect(Array.isArray(out.body.granted)).toBe(true)
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
    const out = await post({ sourceId: 'barrows_brothers', actionNonce: 'n3', consumptions: [{ itemId: 'food', quantity: 5 }], rewards: [{ itemId: 'morvyn_s_hood', quantity: 1 }] })
    expect(out.status).toBe(400)
  })

  it('accepts server-resolved raid common rewards for the matching raid source', async () => {
    const handler = makeCompletionHandler('raids', {
      requireAuth: async () => ({ identity: { id: 1 } }),
      assertNotInActiveMatch: async () => null,
      loadCharacterWithSave: async () => ({ saveObject: { inventory: [] }, saveRevision: 0 }),
      writeSave: async () => ({ updatedAt: 1, saveRevision: 1 }),
      resolveRewards: () => [{ itemId: 'coins', quantity: 41030 }, { itemId: 'death_rune', quantity: 253 }],
    })
    const req = new Request('https://example.com/api/actions/raid/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Character-Id': '42' },
      body: JSON.stringify({ sourceId: 'barrows_brothers', actionNonce: 'n3b' }),
    })
    const res = await handler({ request: req, env: {} as any })
    expect(res.status).toBe(200)
  })

  it('accepts dungeoneering reward claims mapped to skilling collection sources', async () => {
    const handler = makeCompletionHandler('dungeoneering', {
      requireAuth: async () => ({ identity: { id: 1 } }),
      assertNotInActiveMatch: async () => null,
      loadCharacterWithSave: async () => ({ saveObject: { inventory: [], settings: { dungeoneeringTokens: 100000 } }, saveRevision: 0 }),
      writeSave: async () => ({ updatedAt: 1, saveRevision: 1 }),
    })
    const req = new Request('https://example.com/api/actions/dungeoneering/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Character-Id': '42' },
      body: JSON.stringify({
        sourceId: 'dungeoneering',
        actionNonce: 'n4',
        rewards: [{ itemId: 'arcane_necklace', quantity: 1 }],
        dungeoneeringTokens: -65000,
      }),
    })
    const res = await handler({ request: req, env: {} as any })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
  })

  it('rejects non-dungeoneering items on dungeoneering completion endpoint', async () => {
    const handler = makeCompletionHandler('dungeoneering', {
      requireAuth: async () => ({ identity: { id: 1 } }),
      assertNotInActiveMatch: async () => null,
      loadCharacterWithSave: async () => ({ saveObject: { inventory: [], dungeoneeringTokens: 100000 }, saveRevision: 0 }),
      writeSave: async () => ({ updatedAt: 1, saveRevision: 1 }),
    })
    const req = new Request('https://example.com/api/actions/dungeoneering/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Character-Id': '42' },
      body: JSON.stringify({
        sourceId: 'dungeoneering',
        actionNonce: 'n5',
        rewards: [{ itemId: 'warped_bow', quantity: 1 }],
      }),
    })
    const res = await handler({ request: req, env: {} as any })
    expect(res.status).toBe(403)
  })

  it('accepts raid completion when inventory has free slots in sparse 28-slot payloads', async () => {
    const sparseInventory = Array.from({ length: 28 }, (_, i) => (i < 19 ? { itemId: `occupied_${i}`, quantity: 1 } : null))
    const handler = makeCompletionHandler('raids', {
      requireAuth: async () => ({ identity: { id: 1 } }),
      assertNotInActiveMatch: async () => null,
      loadCharacterWithSave: async () => ({ saveObject: { inventory: sparseInventory }, saveRevision: 0 }),
      writeSave: async () => ({ updatedAt: 1, saveRevision: 1 }),
      resolveRewards: () => [
        { itemId: 'coins', quantity: 41030 },
        { itemId: 'death_rune', quantity: 253 },
        { itemId: 'blood_rune', quantity: 57 },
        { itemId: 'soul_rune', quantity: 47 },
        { itemId: 'morvyn_s_hood', quantity: 1 },
        { itemId: 'dravok_s_helm', quantity: 1 },
        { itemId: 'gorath_s_helm', quantity: 1 },
      ],
    })
    const req = new Request('https://example.com/api/actions/raid/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Character-Id': '42' },
      body: JSON.stringify({ sourceId: 'barrows_brothers', actionNonce: 'n6' }),
    })
    const res = await handler({ request: req, env: {} as any })
    expect(res.status).toBe(200)
  })


  it('banks overflow raid rewards instead of failing when inventory is full', async () => {
    const fullInventory = Array.from({ length: 28 }, (_, i) => ({ itemId: `occupied_${i}`, quantity: 1 }))
    const handler = makeCompletionHandler('raids', {
      requireAuth: async () => ({ identity: { id: 1 } }),
      assertNotInActiveMatch: async () => null,
      loadCharacterWithSave: async () => ({ saveObject: { inventory: fullInventory, bank: {} }, saveRevision: 0 }),
      writeSave: async () => ({ updatedAt: 1, saveRevision: 1 }),
      resolveRewards: () => [{ itemId: 'coins', quantity: 41030 }, { itemId: 'death_rune', quantity: 253 }],
    })
    const req = new Request('https://example.com/api/actions/raid/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Character-Id': '42' },
      body: JSON.stringify({ sourceId: 'barrows_brothers', actionNonce: 'n7' }),
    })
    const res = await handler({ request: req, env: {} as any })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.granted).toEqual([
      { itemId: 'coins', quantity: 41030, destination: 'bank' },
      { itemId: 'death_rune', quantity: 253, destination: 'bank' },
    ])
    const saved = JSON.parse(body.save.save_data)
    expect(saved.bank.coins.quantity).toBe(41030)
    expect(saved.bank.death_rune.quantity).toBe(253)
  })

  it('persists raid KC into save settings for cloud-authoritative completions', async () => {
    const handler = makeCompletionHandler('raids', {
      requireAuth: async () => ({ identity: { id: 1 } }),
      assertNotInActiveMatch: async () => null,
      loadCharacterWithSave: async () => ({ saveObject: { inventory: [], settings: { raidKillCounts: { barrows_brothers: 4 } } }, saveRevision: 0 }),
      writeSave: async () => ({ updatedAt: 1, saveRevision: 1 }),
      resolveRewards: () => [],
    })
    const req = new Request('https://example.com/api/actions/raid/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Character-Id': '42' },
      body: JSON.stringify({ sourceId: 'barrows_brothers', actionNonce: 'n8' }),
    })
    const res = await handler({ request: req, env: {} as any })
    const body = await res.json()
    expect(res.status).toBe(200)
    const saved = JSON.parse(body.save.save_data)
    expect(saved.settings.raidKillCounts.barrows_brothers).toBe(5)
  })

  it('accepts minigame rewards validated by minigame task id', async () => {
    const handler = makeCompletionHandler('minigames', {
      requireAuth: async () => ({ identity: { id: 1 } }),
      assertNotInActiveMatch: async () => null,
      loadCharacterWithSave: async () => ({ saveObject: { inventory: [] }, saveRevision: 0 }),
      writeSave: async () => ({ updatedAt: 1, saveRevision: 1 }),
      resolveRewards: () => [{ itemId: 'fighter_helm', quantity: 1 }],
    })
    const req = new Request('https://example.com/api/actions/minigame/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Character-Id': '42' },
      body: JSON.stringify({ sourceId: 'ba_fighter_hat', actionNonce: 'n9' }),
    })
    const res = await handler({ request: req, env: {} as any })
    expect(res.status).toBe(200)
    const body = await res.json()
    const saved = JSON.parse(body.save.save_data)
    expect(saved.settings.unlockedMinigameItems).toContain('fighter_helm')
  })



})
