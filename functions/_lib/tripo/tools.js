import { createTripoTask, getTripoTask } from './client.js'
import { TOOL_NAMES } from './schema.js'

function ok(payload) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)
  return { content: [{ type: 'text', text }] }
}

// Keep MCP JSON responses reasonable; a full 3D model file can run well past
// this, in which case the caller should use store_asset's url instead.
const MAX_INLINE_BYTES = 15 * 1024 * 1024

function arrayBufferToBase64(buf) {
  let binary = ''
  const bytes = new Uint8Array(buf)
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
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
    const contentType = res.headers.get('Content-Type') || 'application/octet-stream'
    const key = crypto.randomUUID().replace(/-/g, '')
    await env.TRIPO_ASSETS.put(key, buf, {
      httpMetadata: { contentType },
      customMetadata: { taskId: taskId || '', filename: filename || '', sourceUrl: url },
    })
    return ok({ key, url: `${origin}/api/tripo-assets/${key}`, size: buf.byteLength, contentType, sourceUrl: url })
  },

  async get_asset(args, { env }) {
    if (!args.key) throw new Error('key is required (returned by store_asset).')
    if (!env.TRIPO_ASSETS) throw new Error('TRIPO_ASSETS R2 bucket is not bound on this worker.')
    const obj = await env.TRIPO_ASSETS.get(args.key)
    if (!obj) throw new Error(`No asset stored at key "${args.key}".`)
    const buf = await obj.arrayBuffer()
    if (buf.byteLength > MAX_INLINE_BYTES) {
      throw new Error(
        `Asset is ${buf.byteLength} bytes, over the ${MAX_INLINE_BYTES}-byte inline limit. Only the ` +
          'rendered image is currently used as game art — fetch that output instead of the full 3D model.',
      )
    }
    return ok({
      key: args.key,
      size: buf.byteLength,
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
