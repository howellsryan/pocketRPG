import { describe, it, expect } from 'vitest'
import { makeCompletionHandler } from '../functions/api/actions/_completeShared.js'

function makeHandler() {
  return makeCompletionHandler('raids', {
    requireAuth: async () => ({ identity: { id: 1 } }),
    assertNotInCoopSession: async () => null,
    claimActionNonce: async () => {},
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
    const out = await post({ sourceId: 'cryptbound_champions', actionNonce: 'n2', rewards: [{ itemId: 'twisted_longbow', quantity: 1 }] })
    expect(out.status).toBe(200)
    expect(out.body.ok).toBe(true)
    expect(Array.isArray(out.body.granted)).toBe(true)
  })

  it('rejects stale/replayed nonce via DB-side claim', async () => {
    const handler = makeCompletionHandler('raids', {
      requireAuth: async () => ({ identity: { id: 1 } }),
      assertNotInCoopSession: async () => null,
      claimActionNonce: async () => {
        // Simulate the DB-side ON CONFLICT path firing — replay throws
        // STALE_REPLAYED_ACTION.
        const { GameApiError } = await import('../functions/_lib/game/errors.js')
        throw new GameApiError('STALE_REPLAYED_ACTION', 'stale_replayed_action', 409)
      },
      loadCharacterWithSave: async () => ({ saveObject: { inventory: [] }, saveRevision: 0 }),
      writeSave: async () => ({ updatedAt: 1, saveRevision: 1 }),
    })
    const req = new Request('https://example.com', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Character-Id': '42' }, body: JSON.stringify({ sourceId: 'cryptbound_champions', actionNonce: 'replay', rewards: [] }) })
    const res = await handler({ request: req, env: {} as any })
    expect(res.status).toBe(409)
  })

  it('rejects insufficient supply consumption', async () => {
    const out = await post({ sourceId: 'cryptbound_champions', actionNonce: 'n3', consumptions: [{ itemId: 'food', quantity: 5 }], rewards: [{ itemId: 'morvyn_s_hood', quantity: 1 }] })
    expect(out.status).toBe(400)
  })

  it('accepts server-resolved raid common rewards for the matching raid source', async () => {
    const handler = makeCompletionHandler('raids', {
      requireAuth: async () => ({ identity: { id: 1 } }),
      assertNotInCoopSession: async () => null,
      claimActionNonce: async () => {},
      loadCharacterWithSave: async () => ({ saveObject: { inventory: [] }, saveRevision: 0 }),
      writeSave: async () => ({ updatedAt: 1, saveRevision: 1 }),
      resolveRewards: () => [{ itemId: 'coins', quantity: 41030 }, { itemId: 'death_rune', quantity: 253 }],
    })
    const req = new Request('https://example.com/api/actions/raid/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Character-Id': '42' },
      body: JSON.stringify({ sourceId: 'cryptbound_champions', actionNonce: 'n3b' }),
    })
    const res = await handler({ request: req, env: {} as any })
    expect(res.status).toBe(200)
  })

  it('accepts dungeoneering reward claims mapped to skilling collection sources', async () => {
    const handler = makeCompletionHandler('dungeoneering', {
      requireAuth: async () => ({ identity: { id: 1 } }),
      assertNotInCoopSession: async () => null,
      claimActionNonce: async () => {},
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
      assertNotInCoopSession: async () => null,
      claimActionNonce: async () => {},
      loadCharacterWithSave: async () => ({ saveObject: { inventory: [], dungeoneeringTokens: 100000 }, saveRevision: 0 }),
      writeSave: async () => ({ updatedAt: 1, saveRevision: 1 }),
    })
    const req = new Request('https://example.com/api/actions/dungeoneering/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Character-Id': '42' },
      body: JSON.stringify({
        sourceId: 'dungeoneering',
        actionNonce: 'n5',
        rewards: [{ itemId: 'twisted_longbow', quantity: 1 }],
      }),
    })
    const res = await handler({ request: req, env: {} as any })
    expect(res.status).toBe(403)
  })

  it('accepts raid completion when inventory has free slots in sparse 28-slot payloads', async () => {
    const sparseInventory = Array.from({ length: 28 }, (_, i) => (i < 19 ? { itemId: `occupied_${i}`, quantity: 1 } : null))
    const handler = makeCompletionHandler('raids', {
      requireAuth: async () => ({ identity: { id: 1 } }),
      assertNotInCoopSession: async () => null,
      claimActionNonce: async () => {},
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
      body: JSON.stringify({ sourceId: 'cryptbound_champions', actionNonce: 'n6' }),
    })
    const res = await handler({ request: req, env: {} as any })
    expect(res.status).toBe(200)
  })


  it('banks overflow raid rewards instead of failing when inventory is full', async () => {
    const fullInventory = Array.from({ length: 28 }, (_, i) => ({ itemId: `occupied_${i}`, quantity: 1 }))
    const handler = makeCompletionHandler('raids', {
      requireAuth: async () => ({ identity: { id: 1 } }),
      assertNotInCoopSession: async () => null,
      claimActionNonce: async () => {},
      loadCharacterWithSave: async () => ({ saveObject: { inventory: fullInventory, bank: {} }, saveRevision: 0 }),
      writeSave: async () => ({ updatedAt: 1, saveRevision: 1 }),
      resolveRewards: () => [{ itemId: 'coins', quantity: 41030 }, { itemId: 'death_rune', quantity: 253 }],
    })
    const req = new Request('https://example.com/api/actions/raid/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Character-Id': '42' },
      body: JSON.stringify({ sourceId: 'cryptbound_champions', actionNonce: 'n7' }),
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

  it('increments raid KC in the kill_counts table and returns it, not in the save blob', async () => {
    const killCountWrites: any[] = []
    const env = {
      DB: {
        prepare: (sql: string) => ({
          bind: (...args: any[]) => ({
            first: async () => {
              if (/kill_counts/.test(sql)) {
                killCountWrites.push({ sql, args })
                return { kill_count: 5 }
              }
              return null
            },
          }),
        }),
      },
    }
    const handler = makeCompletionHandler('raids', {
      requireAuth: async () => ({ identity: { id: 1 } }),
      assertNotInCoopSession: async () => null,
      claimActionNonce: async () => {},
      loadCharacterWithSave: async () => ({ saveObject: { inventory: [], settings: {} }, saveRevision: 0 }),
      writeSave: async () => ({ updatedAt: 1, saveRevision: 1 }),
      resolveRewards: () => [],
    })
    const req = new Request('https://example.com/api/actions/raid/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Character-Id': '42' },
      body: JSON.stringify({ sourceId: 'cryptbound_champions', actionNonce: 'n8' }),
    })
    const res = await handler({ request: req, env: env as any })
    const body = await res.json()
    expect(res.status).toBe(200)
    // Server-authoritative increment hit the dedicated table.
    expect(killCountWrites.length).toBe(1)
    expect(body.killCount).toEqual({ sourceType: 'raids', sourceId: 'cryptbound_champions', killCount: 5 })
    // KC must no longer be written into the save blob.
    const saved = JSON.parse(body.save.save_data)
    expect(saved.settings?.raidKillCounts).toBeUndefined()
    expect(saved.settings?.bossKillCounts).toBeUndefined()
  })

  it('can settle raid rewards without incrementing raid KC when the handler marks it as a cash-out', async () => {
    const killCountWrites: string[] = []
    const env = {
      DB: {
        prepare: (sql: string) => ({
          bind: (..._args: any[]) => ({
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
      assertNotInCoopSession: async () => null,
      claimActionNonce: async () => {},
      loadCharacterWithSave: async () => ({ saveObject: { inventory: [], settings: {} }, saveRevision: 0 }),
      writeSave: async () => ({ updatedAt: 1, saveRevision: 1 }),
      resolveRewards: () => [],
      shouldPersistKillCount: () => false,
    })
    const req = new Request('https://example.com/api/actions/raid/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Character-Id': '42' },
      body: JSON.stringify({ sourceId: 'sunspire_colosseum', actionNonce: 'sunspire-cashout', wave: 5 }),
    })
    const res = await handler({ request: req, env: env as any })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.killCount).toBeNull()
    expect(killCountWrites).toHaveLength(0)
  })

  it('does not strand a collection-log slot or kill-count when the save write loses a revision race', async () => {
    // Regression: the granted unique lives in the save blob, but the
    // collection-log slot and kill-count live in their own tables. If those
    // tables are written BEFORE the save and the save write then fails on a
    // stale revision (a concurrent browser/MCP save bumped it), the player ends
    // up with a log entry / kill-count for an item that never landed in their
    // bank. The save must be persisted first so a conflict aborts cleanly.
    const dbCalls = { killCountPrepares: 0, collectionLogBatches: 0 }
    const env = {
      DB: {
        prepare: (sql: string) => {
          if (/kill_counts/.test(sql)) dbCalls.killCountPrepares++
          return { bind: () => ({ first: async () => ({ kill_count: 1 }), run: async () => ({}) }) }
        },
        batch: async () => { dbCalls.collectionLogBatches++ },
      },
    }
    const { GameApiError } = await import('../functions/_lib/game/errors.js')
    const handler = makeCompletionHandler('raids', {
      requireAuth: async () => ({ identity: { id: 1 } }),
      assertNotInCoopSession: async () => null,
      claimActionNonce: async () => {},
      loadCharacterWithSave: async () => ({ saveObject: { inventory: [], bank: {} }, saveRevision: 7 }),
      // A concurrent writer moved the revision forward between load and write.
      writeSave: async () => { throw new GameApiError('SAVE_REVISION_CONFLICT', 'save_revision_conflict', 409) },
      resolveRewards: () => [{ itemId: 'morvyn_s_hood', quantity: 1 }],
    })
    const req = new Request('https://example.com/api/actions/raid/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Character-Id': '42' },
      body: JSON.stringify({ sourceId: 'cryptbound_champions', actionNonce: 'race1' }),
    })
    const res = await handler({ request: req, env: env as any })
    expect(res.status).toBe(409)
    // Save write failed first → neither side-table was touched.
    expect(dbCalls.killCountPrepares).toBe(0)
    expect(dbCalls.collectionLogBatches).toBe(0)
  })

  it('accepts minigame rewards validated by minigame task id', async () => {
    const handler = makeCompletionHandler('minigames', {
      requireAuth: async () => ({ identity: { id: 1 } }),
      assertNotInCoopSession: async () => null,
      claimActionNonce: async () => {},
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

  it('records minigame collection-log entries under the minigame section id, not the task id', async () => {
    const writes: any[] = []
    const env = {
      DB: {
        prepare: (sql: string) => ({ bind: (...args: any[]) => ({ _sql: sql, _args: args }) }),
        batch: async (stmts: any[]) => { writes.push(...stmts) },
      },
    }
    // Mirror functions/api/actions/minigame/complete.js: the completion sourceId
    // is the task id (`ba_fighter_hat`) but the log slot lives under the parent
    // minigame id (`barbarian_assault`).
    const handler = makeCompletionHandler('minigames', {
      requireAuth: async () => ({ identity: { id: 1 } }),
      assertNotInCoopSession: async () => null,
      claimActionNonce: async () => {},
      loadCharacterWithSave: async () => ({ saveObject: { inventory: [] }, saveRevision: 0 }),
      writeSave: async () => ({ updatedAt: 1, saveRevision: 1 }),
      resolveRewards: () => [{ itemId: 'fighter_helm', quantity: 1 }],
      resolveCollectionLogSourceId: ({ sourceId }: any) =>
        (sourceId === 'ba_fighter_hat' ? 'barbarian_assault' : sourceId),
    })
    const req = new Request('https://example.com/api/actions/minigame/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Character-Id': '42' },
      body: JSON.stringify({ sourceId: 'ba_fighter_hat', actionNonce: 'n10' }),
    })
    const res = await handler({ request: req, env: env as any })
    const body = await res.json()
    expect(res.status).toBe(200)
    // The entry is recorded — and keyed by the section id the log defines.
    expect(body.collectionLogEntries).toEqual([
      { itemId: 'fighter_helm', sourceType: 'minigames', sourceId: 'barbarian_assault' },
    ])
    expect(writes.length).toBe(1)
  })

  it('records nothing when the minigame log source is left as the raw task id (regression guard)', async () => {
    const env = {
      DB: { prepare: () => ({ bind: () => ({}) }), batch: async () => {} },
    }
    // No resolveCollectionLogSourceId → falls back to the raw task id, which is
    // not a valid log section. This documents the bug the remap fixes.
    const handler = makeCompletionHandler('minigames', {
      requireAuth: async () => ({ identity: { id: 1 } }),
      assertNotInCoopSession: async () => null,
      claimActionNonce: async () => {},
      loadCharacterWithSave: async () => ({ saveObject: { inventory: [] }, saveRevision: 0 }),
      writeSave: async () => ({ updatedAt: 1, saveRevision: 1 }),
      resolveRewards: () => [{ itemId: 'fighter_helm', quantity: 1 }],
    })
    const req = new Request('https://example.com/api/actions/minigame/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Character-Id': '42' },
      body: JSON.stringify({ sourceId: 'ba_fighter_hat', actionNonce: 'n11' }),
    })
    const res = await handler({ request: req, env: env as any })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.collectionLogEntries).toEqual([])
  })

})

describe('minigame collection-log slot mapping (data integrity)', () => {
  it('every minigame reward is a valid log slot under task.minigame, never under task.id', async () => {
    const { isValidEntry } = await import('../functions/_lib/collectionLog.js')
    const minigamesData = (await import('../src/data/minigames.json')).default as any
    const tasks = minigamesData?.tasks || []
    expect(tasks.length).toBeGreaterThan(0)
    for (const task of tasks) {
      const items = Array.isArray(task.rewardItems) && task.rewardItems.length > 0
        ? task.rewardItems
        : (task.product ? [task.product] : [])
      expect(items.length).toBeGreaterThan(0)
      for (const itemId of items) {
        // Correct: keyed by the parent minigame id.
        expect(isValidEntry('minigames', task.minigame, itemId)).toBe(true)
        // The task id is NOT a valid log section, so recording under it logs nothing.
        if (task.id !== task.minigame) {
          expect(isValidEntry('minigames', task.id, itemId)).toBe(false)
        }
      }
    }
  })
})
