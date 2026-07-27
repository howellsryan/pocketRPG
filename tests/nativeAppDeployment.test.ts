import { describe, it, expect } from 'vitest'
import { isNativeRequest, withNativeFlag, stateIsNative, tokenRedirectLocation } from '../functions/_lib/authRedirect.js'
import { isAllowedOrigin, corsHeaders } from '../functions/_lib/cors.js'
import { accountDeletionPlan } from '../functions/_lib/accountDeletion.js'

describe('native OAuth redirect helper', () => {
  it('detects the native platform flag on the start URL', () => {
    expect(isNativeRequest(new URL('https://x/api/auth/github?platform=native'))).toBe(true)
    expect(isNativeRequest(new URL('https://x/api/auth/github'))).toBe(false)
  })

  it('round-trips the native flag through the CSRF state', () => {
    const base = 'abc123'
    expect(stateIsNative(withNativeFlag(base, true))).toBe(true)
    expect(stateIsNative(withNativeFlag(base, false))).toBe(false)
    // The random component is preserved so the cookie===state check still holds.
    expect(withNativeFlag(base, true).startsWith(base)).toBe(true)
  })

  it('redirects web to the fragment and native to the deep link', () => {
    expect(tokenRedirectLocation('tok', false)).toBe('/#token=tok')
    expect(tokenRedirectLocation('tok', true)).toBe('pocketrpg://auth/callback#token=tok')
  })

  it('url-encodes the token in the redirect', () => {
    expect(tokenRedirectLocation('a/b+c', false)).toBe('/#token=a%2Fb%2Bc')
  })
})

describe('CORS for native clients', () => {
  it('allowlists the Capacitor origins only', () => {
    expect(isAllowedOrigin('capacitor://localhost')).toBe(true)
    expect(isAllowedOrigin('https://localhost')).toBe(true)
    expect(isAllowedOrigin('https://evil.example')).toBe(false)
    expect(isAllowedOrigin(null)).toBe(false)
  })

  it('emits headers for allowed origins and nothing for others', () => {
    const allowed = corsHeaders('capacitor://localhost')
    expect(allowed['Access-Control-Allow-Origin']).toBe('capacitor://localhost')
    expect(allowed['Access-Control-Allow-Headers']).toContain('Authorization')
    expect(allowed['Access-Control-Allow-Headers']).toContain('X-Character-Id')
    expect(corsHeaders('https://pocketrpg.co.uk')).toEqual({})
  })
})

describe('account deletion cascade plan', () => {
  const plan = accountDeletionPlan(42, { now: 1000 })
  const tables = (re: RegExp) => plan.find(s => re.test(s.sql))

  it('purges every per-character and identity table', () => {
    for (const t of [
      /DELETE FROM saves/, /DELETE FROM character_idle_state/, /DELETE FROM collection_log/,
      /DELETE FROM trading_post_offers/, /DELETE FROM kill_counts/, /DELETE FROM action_nonces/,
      /DELETE FROM pvp_waiting_room/, /DELETE FROM pvp_invitations/,
      /DELETE FROM pvp_matches/, /DELETE FROM characters/, /DELETE FROM oauth_identities/,
    ]) {
      expect(tables(t)).toBeTruthy()
    }
  })

  it('records an audit event first and deletes the identity last', () => {
    expect(plan[0].sql).toContain('INSERT INTO audit_events')
    expect(plan[0].params[0]).toBe('account_deleted')
    expect(plan[plan.length - 1].sql).toContain('DELETE FROM oauth_identities')
  })

  it('removes child rows before the characters they reference', () => {
    const charsIdx = plan.findIndex(s => /DELETE FROM characters WHERE owner_id/.test(s.sql))
    const savesIdx = plan.findIndex(s => /DELETE FROM saves/.test(s.sql))
    expect(savesIdx).toBeLessThan(charsIdx)
  })

  it('binds the identity id to every statement', () => {
    expect(plan.every(s => s.params.includes(42))).toBe(true)
  })
})
