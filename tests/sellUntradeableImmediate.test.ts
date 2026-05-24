import { describe, it, expect } from 'vitest'
import { onRequestPost } from '../functions/api/trading-post/sell-immediate.js'
import { signJWT } from '../functions/_lib/jwt.js'
import { gzipJsonString } from '../functions/_lib/saveCodec.js'

const TEST_SECRET = 'test-jwt-secret'
const IDENTITY = 'identity-1'

async function makeRequest(body: any, characterId = '7') {
  const token = await signJWT({ sub: IDENTITY, provider: 'test' }, TEST_SECRET)
  return new Request('https://example.test/api/trading-post/sell-immediate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Character-Id': characterId,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
}

function mockEnv({ save, isIronman = false }: { save: any; isIronman?: boolean }) {
  const captured: { saveData: string | null } = { saveData: null }
  const blob = gzipJsonString(JSON.stringify(save))
  const prepare = (sql: string) => ({
    bind: (...args: any[]) => ({
      first: async () => {
        if (sql.includes('active_match_id FROM characters')) return { active_match_id: null }
        if (sql.includes('FROM pvp_matches')) return null
        if (sql.includes('LEFT JOIN saves')) {
          return {
            id: Number(args[0]),
            owner_id: args[1],
            is_ironman: isIronman ? 1 : 0,
            save_blob: await blob,
            save_data: null,
            updated_at: 123,
            save_revision: 0,
          }
        }
        if (sql.includes('save_revision FROM saves')) return { save_revision: 1 }
        return null
      },
      run: async () => {
        // writeSave binds (save_blob, save_data, now, characterId, expectedRevision)
        if (sql.startsWith('UPDATE saves')) captured.saveData = args[1]
        return { meta: { changes: 1 } }
      },
    }),
  })
  return { env: { DB: { prepare }, JWT_SECRET: TEST_SECRET } as any, captured }
}

describe('POST /api/trading-post/sell-immediate — untradeable items', () => {
  it('sells an untradeable item for its shopValue, removing it and paying coins', async () => {
    const save = { inventory: [{ itemId: 'fighter_helm', quantity: 1 }], bank: {} }
    const { env, captured } = mockEnv({ save })
    const res = await onRequestPost({ request: await makeRequest({ item_id: 'fighter_helm', quantity: 1 }), env })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.total_payout).toBe(40000)

    const written = JSON.parse(captured.saveData!)
    expect(written.inventory.find((s: any) => s.itemId === 'fighter_helm')).toBeUndefined()
    expect(written.inventory.find((s: any) => s.itemId === 'coins')?.quantity).toBe(40000)
  })

  it('does not pay out when the player does not own the item', async () => {
    const save = { inventory: [], bank: {} }
    const { env, captured } = mockEnv({ save })
    const res = await onRequestPost({ request: await makeRequest({ item_id: 'fighter_helm', quantity: 1 }), env })
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.code).toBe('INSUFFICIENT_SUPPLIES')
    expect(captured.saveData).toBeNull()
  })

  it('still refuses untradeable items with no shop value (e.g. prestige capes)', async () => {
    const save = { inventory: [{ itemId: 'fire_cape', quantity: 1 }], bank: {} }
    const { env } = mockEnv({ save })
    const res = await onRequestPost({ request: await makeRequest({ item_id: 'fire_cape', quantity: 1 }), env })
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.code).toBe('NO_VALUE')
  })

  it('still routes order-book uniques to the listing endpoint', async () => {
    const save = { inventory: [{ itemId: 'twisted_longbow', quantity: 1 }], bank: {} }
    const { env } = mockEnv({ save })
    const res = await onRequestPost({ request: await makeRequest({ item_id: 'twisted_longbow', quantity: 1 }), env })
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.code).toBe('ORDER_BOOK_REQUIRED')
  })
})
