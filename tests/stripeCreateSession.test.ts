// /api/stripe/create-session — server picks the price from the SKU so a
// tampered request can't escalate the grant (§14 payments boundary).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeD1, FakeD1 } from './helpers/d1'

vi.mock('../functions/_lib/auth.js', () => ({
  requireAuth: async () => ({ identity: { id: 1 } }),
  json: (body: any, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
}))

import { onRequestPost } from '../functions/api/stripe/create-session.js'

const PRICES = {
  STRIPE_PRICE_REMOVE_ADS: 'price_ads',
  STRIPE_PRICE_CREDITS_10: 'price_c10',
  STRIPE_PRICE_CREDITS_100: 'price_c100',
  STRIPE_PRICE_CREDITS_1000: 'price_c1000',
}

let raw: any
function makeEnv(extra: any = {}) {
  const d = makeD1()
  raw = d.raw
  return { DB: d.DB as FakeD1, STRIPE_API_KEY: 'sk_test', APP_BASE_URL: 'https://app', ...PRICES, ...extra }
}
function seedChar(id = 7, ownerId = 1) {
  raw.prepare(
    `INSERT INTO characters (id, owner_id, username, created_at, is_ironman, is_one_life, credits, total_pvp_kills, credits_used, total_level, combat_level, is_bot, total_level_at)
     VALUES (?, ?, 'c', 0, 0, 0, 0, 0, 0, 1, 3, 0, 0)`,
  ).run(id, ownerId)
}
function req(body: any) {
  return new Request('https://x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

let lastForm: URLSearchParams | null
beforeEach(() => {
  lastForm = null
  vi.stubGlobal('fetch', vi.fn(async (_url: string, opts: any) => {
    lastForm = new URLSearchParams(opts.body.toString())
    return new Response(JSON.stringify({ id: 'cs_test_123', url: 'https://stripe/checkout' }), { status: 200 })
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('POST /api/stripe/create-session', () => {
  it('500s when Stripe is not configured', async () => {
    const env = makeEnv({ STRIPE_API_KEY: undefined })
    const res = await onRequestPost({ request: req({ sku: 'credits_10', character_id: 7 }), env } as any)
    expect(res.status).toBe(500)
  })

  it('400s an unknown SKU', async () => {
    const env = makeEnv()
    const res = await onRequestPost({ request: req({ sku: 'credits_9999' }), env } as any)
    expect(res.status).toBe(400)
  })

  it('400s a credit purchase with no character_id', async () => {
    const env = makeEnv()
    const res = await onRequestPost({ request: req({ sku: 'credits_100' }), env } as any)
    expect(res.status).toBe(400)
  })

  it('404s a credit purchase for a character the caller does not own', async () => {
    const env = makeEnv()
    seedChar(7, 999) // owned by someone else
    const res = await onRequestPost({ request: req({ sku: 'credits_100', character_id: 7 }), env } as any)
    expect(res.status).toBe(404)
  })

  it('uses the SERVER price for the SKU and a server-issued client_reference_id', async () => {
    const env = makeEnv()
    seedChar(7, 1)
    const res = await onRequestPost({ request: req({ sku: 'credits_100', character_id: 7 }), env } as any)
    expect(res.status).toBe(200)
    expect((await res.json()).url).toBe('https://stripe/checkout')
    // Client only named the SKU; the server chose the price + amount + ref.
    expect(lastForm!.get('line_items[0][price]')).toBe('price_c100')
    expect(lastForm!.get('client_reference_id')).toBe('1:7')
    expect(lastForm!.get('metadata[amount]')).toBe('100')
  })

  it('502s when Stripe rejects the request', async () => {
    const env = makeEnv()
    seedChar(7, 1)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad', { status: 400 })))
    const res = await onRequestPost({ request: req({ sku: 'credits_100', character_id: 7 }), env } as any)
    expect(res.status).toBe(502)
  })
})
