// Minimal HS256 JWT using Web Crypto. No external deps — works in the
// Cloudflare Workers runtime out of the box.

const enc = new TextEncoder()
const dec = new TextDecoder()

function b64urlEncode(bytes) {
  let str = ''
  if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes)
  if (typeof bytes === 'string') {
    str = btoa(unescape(encodeURIComponent(bytes)))
  } else {
    let s = ''
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
    str = btoa(s)
  }
  return str.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function b64urlDecodeToBytes(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/')
  while (str.length % 4) str += '='
  const bin = atob(str)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function b64urlDecodeToString(str) {
  return dec.decode(b64urlDecodeToBytes(str))
}

async function getKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
}

export async function signJWT(payload, secret, expiresInSeconds = 60 * 60 * 24 * 30) {
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const fullPayload = { ...payload, iat: now, exp: now + expiresInSeconds }
  const headerB64 = b64urlEncode(JSON.stringify(header))
  const payloadB64 = b64urlEncode(JSON.stringify(fullPayload))
  const signingInput = `${headerB64}.${payloadB64}`
  const key = await getKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(signingInput))
  return `${signingInput}.${b64urlEncode(sig)}`
}

export async function verifyJWT(token, secret) {
  if (!token || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [headerB64, payloadB64, sigB64] = parts
  const key = await getKey(secret)
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    b64urlDecodeToBytes(sigB64),
    enc.encode(`${headerB64}.${payloadB64}`)
  )
  if (!valid) return null
  let payload
  try { payload = JSON.parse(b64urlDecodeToString(payloadB64)) } catch { return null }
  if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) return null
  return payload
}
