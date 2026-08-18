// The /admin portal: the shell served to anyone, and the secret-gated catalog
// that is the only way to get data into it. The invariant that matters is that
// the shell ships a locked door and nothing else — no character list, no item
// list — so an unauthorized visitor cannot read anything out of the page.
import { describe, it, expect, beforeEach } from 'vitest'
import { makeD1, FakeD1 } from './helpers/d1'
import items from '../src/data/items.json' with { type: 'json' }

import { onRequestGet as portalGet } from '../functions/admin.js'
import { onRequestGet as catalogGet } from '../functions/api/admin/catalog.js'

const SECRET = 'a-very-long-admin-portal-secret'

let raw: any
let env: any

function character(id: number, username: string, { isBot = 0, deletedAt = null as number | null, withSave = true, totalLevel = 42, credits = 0 } = {}) {
  raw.prepare(
    `INSERT INTO characters (id, owner_id, username, created_at, is_ironman, is_one_life, credits, total_pvp_kills, credits_used, total_level, combat_level, is_bot, total_level_at, deleted_at)
     VALUES (?, 1, ?, 0, 0, 0, ?, 0, 0, ?, 3, ?, 0, ?)`,
  ).run(id, username, credits, totalLevel, isBot, deletedAt)
  if (withSave) {
    raw.prepare(`INSERT INTO saves (character_id, save_blob, save_data, updated_at, save_revision) VALUES (?, NULL, '{}', 0, 1)`).run(id)
  }
}

function catalogReq(secret: string | null) {
  const headers: Record<string, string> = {}
  if (secret !== null) headers['X-Admin-Secret'] = secret
  return new Request('https://x/api/admin/catalog', { headers })
}

beforeEach(() => {
  const d = makeD1()
  env = { DB: d.DB as FakeD1, ADMIN_SECRET: SECRET }
  raw = d.raw
})

describe('GET /admin', () => {
  it('serves the portal shell', async () => {
    const res = await portalGet()
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/html')
  })

  it('ships no character or item data to an unauthenticated visitor', async () => {
    const html = await (await portalGet()).text()
    // The gate is all that is in the document; every list arrives over the
    // secret-gated catalog call.
    expect(html).not.toContain('dragon_scimitar')
    expect(html).not.toContain('Abyssal Whip')
    expect(html.match(/<option\b/g)).toBe(null)
  })

  it('never lets the page be cached, indexed or framed', async () => {
    const res = await portalGet()
    expect(res.headers.get('Cache-Control')).toContain('no-store')
    expect(res.headers.get('X-Robots-Tag')).toContain('noindex')
    expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'")
  })

  it('does not contain the admin secret', async () => {
    const html = await (await portalGet()).text()
    expect(html).not.toContain(SECRET)
  })
})

describe('GET /api/admin/catalog', () => {
  it('401s without a secret', async () => {
    character(1, 'alice')
    const res = await catalogGet({ request: catalogReq(null), env } as any)
    expect(res.status).toBe(401)
  })

  it('401s a wrong secret and returns no data', async () => {
    character(1, 'alice')
    const res = await catalogGet({ request: catalogReq('nope-but-long-enough-secret'), env } as any)
    expect(res.status).toBe(401)
    expect(await res.json()).not.toHaveProperty('characters')
  })

  it('fails closed when ADMIN_SECRET is unset', async () => {
    character(1, 'alice')
    env.ADMIN_SECRET = undefined
    const res = await catalogGet({ request: catalogReq(''), env } as any)
    expect(res.status).toBe(401)
  })

  it('returns every grantable character, sorted by name', async () => {
    character(3, 'zara')
    character(1, 'alice')
    character(2, 'Mallory')
    const body = await (await catalogGet({ request: catalogReq(SECRET), env } as any)).json()
    expect(body.characters.map((c: any) => c.username)).toEqual(['alice', 'Mallory', 'zara'])
    expect(body.characters[0]).toMatchObject({ id: 1, totalLevel: 42, hasSave: true })
  })

  it('omits deleted characters and PvP bots', async () => {
    character(1, 'alice')
    character(2, 'botty', { isBot: 1 })
    character(3, 'gone', { deletedAt: 1000 })
    const body = await (await catalogGet({ request: catalogReq(SECRET), env } as any)).json()
    expect(body.characters.map((c: any) => c.username)).toEqual(['alice'])
  })

  it('flags a character that has never synced a save so the portal can grey it out', async () => {
    character(1, 'alice', { withSave: false })
    const body = await (await catalogGet({ request: catalogReq(SECRET), env } as any)).json()
    expect(body.characters[0].hasSave).toBe(false)
  })

  it('reports each character\'s credit balance, even with no save at all', async () => {
    character(1, 'alice', { withSave: false, credits: 250 })
    const body = await (await catalogGet({ request: catalogReq(SECRET), env } as any)).json()
    expect(body.characters[0]).toMatchObject({ credits: 250, hasSave: false })
  })

  it('returns every item, name-sorted, with the stackability the grant form needs', async () => {
    const body = await (await catalogGet({ request: catalogReq(SECRET), env } as any)).json()
    expect(body.items).toHaveLength(Object.keys(items).length)
    const names = body.items.map((i: any) => i.name)
    expect([...names].sort((a: string, b: string) => a.localeCompare(b))).toEqual(names)
    const coins = body.items.find((i: any) => i.id === 'coins')
    expect(coins).toMatchObject({ name: 'Coins', stackable: true })
    expect(body.items.find((i: any) => i.id === 'runeforged_scimitar').stackable).toBe(false)
  })

  it('is never cached', async () => {
    const res = await catalogGet({ request: catalogReq(SECRET), env } as any)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })
})
