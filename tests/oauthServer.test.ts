import { describe, it, expect } from 'vitest'
import { base64UrlEncode, randomToken, sha256Base64Url, verifyPkceS256 } from '../functions/_lib/oauth/pkce.js'
import { authServerMetadata, protectedResourceMetadata } from '../functions/_lib/oauth/metadata.js'

describe('OAuth PKCE (S256)', () => {
  it('verifies a correct verifier/challenge pair', async () => {
    const verifier = randomToken(48) // 64 url-safe chars, within 43–128
    const challenge = await sha256Base64Url(verifier)
    expect(await verifyPkceS256(verifier, challenge)).toBe(true)
  })

  it('rejects a wrong verifier', async () => {
    const challenge = await sha256Base64Url(randomToken(48))
    expect(await verifyPkceS256(randomToken(48), challenge)).toBe(false)
  })

  it('matches the RFC 7636 test vector', async () => {
    // Appendix B vector.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    const expected = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
    expect(await sha256Base64Url(verifier)).toBe(expected)
    expect(await verifyPkceS256(verifier, expected)).toBe(true)
  })

  it('rejects verifiers outside the 43–128 length bounds', async () => {
    const challenge = await sha256Base64Url('x'.repeat(43))
    expect(await verifyPkceS256('short', challenge)).toBe(false)
  })

  it('produces url-safe base64 (no +/=)', () => {
    const out = base64UrlEncode(new Uint8Array([251, 252, 253, 254, 255]))
    expect(out).not.toMatch(/[+/=]/)
  })
})

describe('OAuth discovery metadata', () => {
  const origin = 'https://pocketrpg.co.uk'

  it('authorization server metadata advertises the endpoints + PKCE', () => {
    const m = authServerMetadata(origin)
    expect(m.issuer).toBe(origin)
    expect(m.authorization_endpoint).toBe(`${origin}/api/oauth/authorize`)
    expect(m.token_endpoint).toBe(`${origin}/api/oauth/token`)
    expect(m.registration_endpoint).toBe(`${origin}/api/oauth/register`)
    expect(m.code_challenge_methods_supported).toContain('S256')
    expect(m.grant_types_supported).toContain('authorization_code')
    expect(m.token_endpoint_auth_methods_supported).toContain('none')
  })

  it('protected resource metadata points at this server', () => {
    const m = protectedResourceMetadata(origin)
    expect(m.resource).toBe(`${origin}/api/mcp`)
    expect(m.authorization_servers).toEqual([origin])
  })
})
