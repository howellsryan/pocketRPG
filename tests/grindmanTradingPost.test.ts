// A Grindman's uniques come from their own drop rate, so the trading post
// refuses to sell them one. Enforced at POST /api/trading-post/list, and tested
// beside that endpoint for the same reason the credit refusal lives in
// stripeCreateSession.test.ts. The refusal has to land before the escrow: a
// refused buy that still debited coins is worse than no refusal at all.
import { describe, it, expect } from 'vitest'
import { onRequestPost } from '../functions/api/trading-post/list.js'
import { isCollectionLogItem, isCollectionLogLineageItem } from '../functions/_lib/collectionLog.js'
import { isOrderBookItem } from '../functions/_lib/game/tradingPost.js'
import { GRINDMAN_UNIQUES_GRINDED } from '../src/engine/grindman.js'
import itemsData from '../src/data/items.json'
import { signJWT } from '../functions/_lib/jwt.js'
import { gzipJsonString } from '../functions/_lib/saveCodec.js'

const TEST_SECRET = 'test-jwt-secret'

// On the log, and an order-book item, so the ONLY way to buy one is this endpoint.
const LOGGED_ITEM = 'twisted_longbow'
// Order-book too, but nothing the collection log tracks.
const PLAIN_ITEM = 'runeforged_scimitar'

async function makeRequest(body: any) {
  const token = await signJWT({ sub: 'identity-1', provider: 'test' }, TEST_SECRET)
  return new Request('https://example.test/api/trading-post/list', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Character-Id': '7',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
}

function mockEnv({ save, isGrindman = false }: { save: any; isGrindman?: boolean }) {
  const captured: { saveData: string | null; offersInserted: number } = { saveData: null, offersInserted: 0 }
  const blob = gzipJsonString(JSON.stringify(save))
  const prepare = (sql: string) => ({
    bind: (...args: any[]) => ({
      first: async () => {
        if (sql.includes('LEFT JOIN saves')) {
          return {
            id: Number(args[0]),
            owner_id: args[1],
            is_ironman: 0,
            is_grindman: isGrindman ? 1 : 0,
            save_blob: await blob,
            save_data: null,
            updated_at: 123,
            save_revision: 0,
          }
        }
        if (sql.includes('COUNT(*) AS n FROM trading_post_offers')) return { n: 0 }
        // finalizeOfferStatus: leave the new offer resting so it is never deleted.
        if (sql.includes('quantity_remaining, coins_pending, items_pending')) {
          return { quantity_remaining: 1, coins_pending: 0, items_pending: 0 }
        }
        if (sql.includes('save_revision FROM saves')) return { save_revision: 1 }
        return null
      },
      // An empty book: nothing to match against, so the offer just rests.
      all: async () => ({ results: [] }),
      run: async () => {
        if (sql.startsWith('INSERT INTO trading_post_offers')) {
          captured.offersInserted += 1
          return { meta: { changes: 1, last_row_id: 1 } }
        }
        if (sql.startsWith('UPDATE saves')) captured.saveData = args[1]
        return { meta: { changes: 1 } }
      },
    }),
  })
  const batch = async (statements: any[]) => {
    const out = []
    for (const statement of statements) out.push(await statement.run())
    return out
  }
  return { env: { DB: { prepare, batch }, JWT_SECRET: TEST_SECRET } as any, captured }
}

function saveWithCoins(coins: number, extra: any[] = []) {
  return { inventory: [{ itemId: 'coins', quantity: coins }, ...extra], bank: {} }
}

describe('isCollectionLogItem', () => {
  it('knows the items the log tracks, whatever fills their slot', () => {
    expect(isCollectionLogItem(LOGGED_ITEM)).toBe(true)
    // Shared across three sections — one item id, still one answer.
    expect(isCollectionLogItem('dragon_axe')).toBe(true)
    expect(isCollectionLogItem(PLAIN_ITEM)).toBe(false)
    expect(isCollectionLogItem('shark')).toBe(false)
  })

  it('answers false rather than throwing on a missing id', () => {
    expect(isCollectionLogItem(undefined as unknown as string)).toBe(false)
    expect(isCollectionLogItem('')).toBe(false)
  })

  it('does not itself claim the gear a logged drop is forged into', () => {
    // The log tracks the visage, not the shield — which is exactly why the
    // trading post guard reads the lineage set instead of this one.
    expect(isCollectionLogItem('dragon_visage')).toBe(true)
    expect(isCollectionLogItem('visage_shield')).toBe(false)
  })
})

describe('isCollectionLogLineageItem', () => {
  it('covers the logged drop itself', () => {
    expect(isCollectionLogLineageItem(LOGGED_ITEM)).toBe(true)
  })

  it('covers a one-hop upgrade of a logged drop', () => {
    // dragon_visage (logged) + anti_dragon_shield -> visage_shield
    expect(isCollectionLogLineageItem('visage_shield')).toBe(true)
    // deepmaw_kraken_tentacle (logged) + nether_demon_whip -> abyssal_tentacle
    expect(isCollectionLogLineageItem('abyssal_tentacle')).toBe(true)
    // primeval_crystal (logged) + dragon_boots -> primeval_boots
    expect(isCollectionLogLineageItem('primeval_boots')).toBe(true)
  })

  it('follows a crafting chain all the way down', () => {
    // uncut_onyx (logged) -> onyx -> onyx_amulet -> amulet_of_fury. A one-hop
    // rule would stop at the onyx and sell the fury.
    expect(isCollectionLogItem('amulet_of_fury')).toBe(false)
    expect(isCollectionLogLineageItem('onyx')).toBe(true)
    expect(isCollectionLogLineageItem('onyx_amulet')).toBe(true)
    expect(isCollectionLogLineageItem('amulet_of_fury')).toBe(true)
  })

  it('leaves no lineage item buyable through a path the guard cannot see', () => {
    // The guard lives on the order-book listing path. Anything NOT order-book is
    // bought from the General Store or a quest shop via /api/purchase instead, so
    // a lineage item landing there would be a hole. Today every one of them is
    // either order-book or untradeable; this fails the moment that stops holding.
    const leaks = Object.keys(itemsData).filter((id) => {
      if (!isCollectionLogLineageItem(id)) return false
      const item = (itemsData as any)[id]
      return !isOrderBookItem(item) && !item?.isUntradeable
    })
    expect(leaks).toEqual([])
  })

  it('leaves ordinary crafted goods alone', () => {
    expect(isCollectionLogLineageItem(PLAIN_ITEM)).toBe(false)
    expect(isCollectionLogLineageItem('shark')).toBe(false)
    expect(isCollectionLogLineageItem('rune_platebody')).toBe(false)
    expect(isCollectionLogLineageItem('')).toBe(false)
    expect(isCollectionLogLineageItem(undefined as unknown as string)).toBe(false)
  })
})

describe('POST /api/trading-post/list — grindman uniques', () => {
  it('refuses a grindman buy offer on a collection-logged item', async () => {
    const { env, captured } = mockEnv({ save: saveWithCoins(500_000_000), isGrindman: true })
    const res = await onRequestPost({
      request: await makeRequest({ offer_type: 'buy', item_id: LOGGED_ITEM, price: 1000, quantity: 1 }),
      env,
    } as any)
    expect(res.status).toBe(403)
    const body = await res.json() as any
    expect(body.code).toBe('GRINDMAN_UNIQUE_RESTRICTED')
    expect(body.error).toBe(GRINDMAN_UNIQUES_GRINDED)
  })

  it('escrows nothing and books no offer when it refuses', async () => {
    const { env, captured } = mockEnv({ save: saveWithCoins(500_000_000), isGrindman: true })
    await onRequestPost({
      request: await makeRequest({ offer_type: 'buy', item_id: LOGGED_ITEM, price: 1000, quantity: 1 }),
      env,
    } as any)
    expect(captured.saveData).toBeNull()
    expect(captured.offersInserted).toBe(0)
  })

  it('refuses the legacy synonym of a logged item too', async () => {
    // The log is authored in canonical ids and the handler canonicalises before
    // the check, so a stale client sending 'abyssal_whip' is refused exactly as
    // 'nether_demon_whip' is — otherwise the old id is an open door.
    expect(isCollectionLogItem('nether_demon_whip')).toBe(true)
    expect(isCollectionLogItem('abyssal_whip')).toBe(false)
    const { env, captured } = mockEnv({ save: saveWithCoins(500_000_000), isGrindman: true })
    const res = await onRequestPost({
      request: await makeRequest({ offer_type: 'buy', item_id: 'abyssal_whip', price: 1000, quantity: 1 }),
      env,
    } as any)
    expect(res.status).toBe(403)
    expect(captured.offersInserted).toBe(0)
  })

  it('refuses the gear a logged drop is forged into', async () => {
    const { env, captured } = mockEnv({ save: saveWithCoins(500_000_000), isGrindman: true })
    const res = await onRequestPost({
      request: await makeRequest({ offer_type: 'buy', item_id: 'amulet_of_fury', price: 1000, quantity: 1 }),
      env,
    } as any)
    expect(res.status).toBe(403)
    const body = await res.json() as any
    expect(body.code).toBe('GRINDMAN_UNIQUE_RESTRICTED')
    expect(captured.offersInserted).toBe(0)
  })

  it('still lets a grindman SELL what they grind', async () => {
    const { env, captured } = mockEnv({
      save: saveWithCoins(1000, [{ itemId: LOGGED_ITEM, quantity: 1 }]),
      isGrindman: true,
    })
    const res = await onRequestPost({
      request: await makeRequest({ offer_type: 'sell', item_id: LOGGED_ITEM, price: 1000, quantity: 1 }),
      env,
    } as any)
    expect(res.status).toBe(200)
    expect(captured.offersInserted).toBe(1)
  })

  it('leaves a grindman buying an ordinary order-book item alone', async () => {
    const { env, captured } = mockEnv({ save: saveWithCoins(500_000), isGrindman: true })
    const res = await onRequestPost({
      request: await makeRequest({ offer_type: 'buy', item_id: PLAIN_ITEM, price: 1000, quantity: 1 }),
      env,
    } as any)
    expect(res.status).toBe(200)
    expect(captured.offersInserted).toBe(1)
  })

  it('leaves every other account type buying the same unique alone', async () => {
    const { env, captured } = mockEnv({ save: saveWithCoins(500_000_000) })
    const res = await onRequestPost({
      request: await makeRequest({ offer_type: 'buy', item_id: LOGGED_ITEM, price: 1000, quantity: 1 }),
      env,
    } as any)
    expect(res.status).toBe(200)
    expect(captured.offersInserted).toBe(1)
  })
})
