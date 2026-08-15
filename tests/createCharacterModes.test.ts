// POST /api/characters against the real schema. The account type is permanent
// and the server is the only thing standing between a player and a combination
// nobody designed, so the refusal is tested at the endpoint rather than at the
// pure predicate alone.
import { describe, it, expect, beforeEach } from 'vitest'
import { onRequestPost } from '../functions/api/characters/index.js'
import { signJWT } from '../functions/_lib/jwt.js'
import { makeD1, FakeD1 } from './helpers/d1'

const TEST_SECRET = 'test-jwt-secret'
const OWNER = 1
let raw: any
let env: any

async function makeAuthHeader(identityId: number | string = OWNER) {
  return `Bearer ${await signJWT({ sub: identityId, provider: 'test' }, TEST_SECRET)}`
}

async function create(body: Record<string, unknown>, { auth = true } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (auth) headers.Authorization = await makeAuthHeader()
  const request = new Request('https://example.test/api/characters', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  return onRequestPost({ request, env } as any)
}

function rowFor(username: string) {
  return raw.prepare('SELECT is_ironman, is_one_life, is_grindman FROM characters WHERE username = ?').get(username)
}

beforeEach(() => {
  const d = makeD1()
  env = { DB: d.DB as FakeD1, JWT_SECRET: TEST_SECRET }
  raw = d.raw
  raw.prepare("INSERT INTO oauth_identities (id, provider, provider_user_id, created_at) VALUES (?, 'test', 'u1', 0)").run(OWNER)
})

describe('POST /api/characters account modes', () => {
  it('creates a grindman and persists the flag', async () => {
    const res = await create({ username: 'Grindy', is_grindman: true })
    expect(res.status).toBe(201)
    expect((await res.json() as any).character.is_grindman).toBe(true)
    expect(rowFor('Grindy')).toMatchObject({ is_grindman: 1, is_ironman: 0, is_one_life: 0 })
  })

  it('refuses grindman stacked on ironman, writing no row', async () => {
    const res = await create({ username: 'Stacky', is_grindman: true, is_ironman: true })
    expect(res.status).toBe(400)
    expect(rowFor('Stacky')).toBeUndefined()
  })

  it('refuses grindman stacked on one life, writing no row', async () => {
    const res = await create({ username: 'Stacky', is_grindman: true, is_one_life: true })
    expect(res.status).toBe(400)
    expect(rowFor('Stacky')).toBeUndefined()
  })

  it('still allows the ironman + one life combination', async () => {
    const res = await create({ username: 'Hardcore', is_ironman: true, is_one_life: true })
    expect(res.status).toBe(201)
    expect(rowFor('Hardcore')).toMatchObject({ is_ironman: 1, is_one_life: 1, is_grindman: 0 })
  })

  it('defaults an ordinary character to no modes at all', async () => {
    const res = await create({ username: 'Plain' })
    expect(res.status).toBe(201)
    expect(rowFor('Plain')).toMatchObject({ is_ironman: 0, is_one_life: 0, is_grindman: 0 })
  })
})
