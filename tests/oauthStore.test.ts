// OAuth 2.1 storage layer (§14 identity): PKCE authorization codes are
// single-use, clients round-trip, and tokens verify. Real schema + real crypto.
import { describe, it, expect, beforeEach } from 'vitest'
import { makeD1, FakeD1 } from './helpers/d1'
import {
  registerClient, getClient, issueCode, consumeCode,
  mintRequestToken, verifyRequestToken, mintAccessToken,
} from '../functions/_lib/oauth/store.js'
import { verifyJWT } from '../functions/_lib/jwt.js'

let raw: any
let env: any
beforeEach(() => {
  const d = makeD1()
  env = { DB: d.DB as FakeD1, JWT_SECRET: 'test-secret-please-change' }
  raw = d.raw
})

describe('oauth clients', () => {
  it('registers and reads back a client with parsed redirect URIs', async () => {
    const { clientId } = await registerClient(env, { clientName: 'MCP', redirectUris: ['https://a/cb', 'https://b/cb'] })
    const c = await getClient(env, clientId)
    expect(c!.clientName).toBe('MCP')
    expect(c!.redirectUris).toEqual(['https://a/cb', 'https://b/cb'])
  })
  it('returns null for an unknown client', async () => {
    expect(await getClient(env, 'mcp_nope')).toBeNull()
    expect(await getClient(env, '')).toBeNull()
  })
})

describe('authorization codes are single-use (PKCE)', () => {
  it('issues a code that consumes exactly once', async () => {
    const code = await issueCode(env, { clientId: 'c1', identityId: 42, redirectUri: 'https://a/cb', codeChallenge: 'chal', scope: 'mcp' })
    const first = await consumeCode(env, code)
    expect(first!.identity_id).toBe(42)
    expect(first!.code_challenge).toBe('chal')
    // Second consume is refused — the atomic 0->1 claim guards replay.
    expect(await consumeCode(env, code)).toBeNull()
  })
  it('refuses an expired code', async () => {
    raw.prepare(
      `INSERT INTO oauth_codes (code, client_id, identity_id, redirect_uri, code_challenge, scope, expires_at, consumed, created_at)
       VALUES ('expired', 'c1', 1, 'https://a/cb', 'chal', 'mcp', ?, 0, 0)`,
    ).run(Date.now() - 1000)
    expect(await consumeCode(env, 'expired')).toBeNull()
  })
  it('returns null for a missing code', async () => {
    expect(await consumeCode(env, 'does-not-exist')).toBeNull()
    expect(await consumeCode(env, '')).toBeNull()
  })
})

describe('tokens', () => {
  it('round-trips a request token and rejects the wrong type', async () => {
    const tok = await mintRequestToken(env, { clientId: 'c1', identityId: 7 })
    const payload = await verifyRequestToken(env, tok)
    expect(payload!.clientId).toBe('c1')
    expect(payload!.typ).toBe('oauth_req')
    // An access token is not a request token.
    const access = await mintAccessToken(env, { id: 7, provider: 'github' })
    expect(await verifyRequestToken(env, access)).toBeNull()
  })
  it('mints an access token that verifies as the identity', async () => {
    const access = await mintAccessToken(env, { id: 99, provider: 'google', displayName: 'X' })
    const payload = await verifyJWT(access, env.JWT_SECRET)
    expect(payload!.sub).toBe(99)
  })
})
