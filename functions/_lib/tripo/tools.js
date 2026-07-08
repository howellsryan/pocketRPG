import { createTripoTask, getTripoTask } from './client.js'
import { TOOL_NAMES } from './schema.js'

function ok(payload) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)
  return { content: [{ type: 'text', text }] }
}

// Keep MCP JSON responses reasonable; a full 3D model file can run well past
// this, in which case the caller should use store_asset's url instead.
const MAX_INLINE_BYTES = 15 * 1024 * 1024

// Decoded-size cap for upload_asset. Processed GLBs are ~1 MB; raw generator
// output should go through store_asset (URL fetch), not an inline upload.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

function arrayBufferToBase64(buf) {
  let binary = ''
  const bytes = new Uint8Array(buf)
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function base64ToArrayBuffer(b64) {
  const binary = atob(b64.replace(/\s+/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

// Stable keys are served at /api/tripo-assets/<key> and cached immutably, so
// they must be plain nested paths: models/dragon_scimitar.v1.glb.
function validateAssetKey(key) {
  if (typeof key !== 'string' || !key) throw new Error('key must be a non-empty string.')
  if (key.length > 200) throw new Error('key is too long (max 200 chars).')
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(key) || key.split('/').some((seg) => !seg || seg === '.' || seg === '..')) {
    throw new Error('key must be a plain nested path like "models/dragon_scimitar.v1.glb" (letters, digits, . _ - and / separators).')
  }
  return key
}

const TOOLS = {
  async create_task(args, { env }) {
    const data = await createTripoTask(env, { type: args.type, ...(args.params || {}) })
    return ok(data)
  },

  async get_task(args, { env }) {
    if (!args.task_id) throw new Error('task_id is required.')
    const data = await getTripoTask(env, args.task_id)
    return ok(data)
  },

  async store_asset(args, { env, origin }) {
    const { url, task_id: taskId, filename } = args
    if (!url) throw new Error('url is required (a URL from a finished task\'s output).')
    if (!env.TRIPO_ASSETS) throw new Error('TRIPO_ASSETS R2 bucket is not bound on this worker.')
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Fetching asset failed (HTTP ${res.status}).`)
    const buf = await res.arrayBuffer()
    const contentType = args.content_type || res.headers.get('Content-Type') || 'application/octet-stream'
    const key = args.key ? validateAssetKey(args.key) : crypto.randomUUID().replace(/-/g, '')
    await env.TRIPO_ASSETS.put(key, buf, {
      httpMetadata: { contentType },
      customMetadata: { taskId: taskId || '', filename: filename || '', sourceUrl: url },
    })
    return ok({ key, url: `${origin}/api/tripo-assets/${key}`, size: buf.byteLength, contentType, sourceUrl: url })
  },

  async upload_asset(args, { env, origin }) {
    const { key: rawKey, base64, content_type: contentType, task_id: taskId, filename } = args
    if (!base64) throw new Error('base64 is required (the asset bytes).')
    if (!contentType) throw new Error('content_type is required (e.g. "model/gltf-binary").')
    if (!env.TRIPO_ASSETS) throw new Error('TRIPO_ASSETS R2 bucket is not bound on this worker.')
    const key = rawKey ? validateAssetKey(rawKey) : crypto.randomUUID().replace(/-/g, '')
    let buf
    try {
      buf = base64ToArrayBuffer(base64)
    } catch {
      throw new Error('base64 could not be decoded.')
    }
    if (buf.byteLength > MAX_UPLOAD_BYTES) {
      throw new Error(
        `Decoded upload is ${buf.byteLength} bytes, over the ${MAX_UPLOAD_BYTES}-byte cap. Raw generator ` +
          'output should be persisted with store_asset (URL fetch); upload_asset is for processed files.',
      )
    }
    await env.TRIPO_ASSETS.put(key, buf, {
      httpMetadata: { contentType },
      customMetadata: { taskId: taskId || '', filename: filename || '', sourceUrl: '' },
    })
    return ok({ key, url: `${origin}/api/tripo-assets/${key}`, size: buf.byteLength, contentType })
  },

  async get_asset(args, { env }) {
    if (!args.key) throw new Error('key is required (returned by store_asset).')
    if (!env.TRIPO_ASSETS) throw new Error('TRIPO_ASSETS R2 bucket is not bound on this worker.')
    const ranged = args.offset !== undefined || args.length !== undefined
    const offset = Math.max(0, Math.floor(args.offset || 0))
    const obj = ranged
      ? await env.TRIPO_ASSETS.get(args.key, { range: { offset, length: Math.min(Math.floor(args.length || MAX_INLINE_BYTES), MAX_INLINE_BYTES) } })
      : await env.TRIPO_ASSETS.get(args.key)
    if (!obj) throw new Error(`No asset stored at key "${args.key}".`)
    const size = obj.size ?? null
    const buf = await obj.arrayBuffer()
    if (buf.byteLength > MAX_INLINE_BYTES) {
      throw new Error(
        `Asset is ${buf.byteLength} bytes, over the ${MAX_INLINE_BYTES}-byte inline limit. ` +
          'Pass offset/length to fetch it in chunks, or use the store_asset url directly.',
      )
    }
    return ok({
      key: args.key,
      size,
      ...(ranged ? { offset, length: buf.byteLength } : {}),
      contentType: obj.httpMetadata?.contentType || 'application/octet-stream',
      base64: arrayBufferToBase64(buf),
    })
  },
}

// Sanity check: dispatch table must match the advertised schema exactly.
for (const name of TOOL_NAMES) {
  if (!TOOLS[name]) throw new Error(`Tripo MCP: "${name}" is advertised in schema.js but has no dispatch handler.`)
}

// Dispatch a tools/call. Unknown tool names throw (surfaced as a JSON-RPC
// error); operational failures are returned as an isError tool result so the
// model can read and react to them.
export async function callTool(name, args, ctx) {
  const tool = TOOLS[name]
  if (!tool) throw new Error(`Unknown tool: ${name}`)
  try {
    return await tool(args || {}, ctx)
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err?.message || String(err)}` }], isError: true }
  }
}
