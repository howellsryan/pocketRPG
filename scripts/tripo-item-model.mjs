#!/usr/bin/env node
/**
 * One-command item→3D-model pipeline via the Tripo MCP bridge (/api/tripo-mcp).
 *
 *   npm run gen:item-model -- --item dragon_scimitar
 *   node scripts/tripo-item-model.mjs --item <itemId> [--prompt "..."] [flags]
 *
 * Does end-to-end what used to be five manual steps:
 *   1. Submit a Tripo text_to_model task (prompt from --prompt or
 *      scripts/tripo-item-prompts.json) and poll until it finishes.
 *   2. Persist the rendered preview + raw GLB to R2 via store_asset
 *      (renders/<item>.<task>.webp, raw/<item>.<task>.glb) for eyeballing and
 *      traceability.
 *   3. Download the raw GLB and shrink it with scripts/process-3d-model.mjs
 *      (~40-55 MB generator output → ~1 MB phone-shippable meshopt GLB).
 *   4. Upload the processed GLB to R2 at models/<item>.vN.glb via upload_asset
 *      (N = first unused version — keys are cached immutably, never reused).
 *   5. Register the weapon in src/data/equipmentModels.json pointing at
 *      /api/tripo-assets/models/<item>.vN.glb (site-relative: every deployment
 *      serves its own environment's bucket).
 *
 * Afterwards: eyeball the printed render URL, tune the hand transform in
 * public/3d-preview.html, run the commit gate, commit the JSON change.
 *
 * Flags: --prompt, --type (text_to_model), --task <id> (resume an existing
 * task, e.g. after an interrupt — skips step 1), --ratio, --tex, --scale,
 * --no-register (skip step 5), --base-url (default TRIPO_MCP_URL env or the
 * preview deployment). Auth: TRIPO_MCP_TOKEN env, sent as a bearer token when
 * set. Assets land in the bucket of whichever deployment --base-url points at
 * (preview vs production have separate buckets).
 */

import { readFile, writeFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback
}
const hasFlag = (name) => args.includes(`--${name}`)

const item = argOf('item')
if (!item) {
  console.error('usage: node scripts/tripo-item-model.mjs --item <itemId> [--prompt "..."] [--task <id>] [--ratio 0.25] [--tex 1024] [--scale 0.32] [--no-register] [--base-url https://...]')
  process.exit(1)
}

const root = new URL('..', import.meta.url)
const items = JSON.parse(await readFile(new URL('src/data/items.json', root), 'utf8'))
if (!items[item]) {
  console.error(`"${item}" is not an item id in src/data/items.json.`)
  process.exit(1)
}

const presets = JSON.parse(await readFile(new URL('scripts/tripo-item-prompts.json', root), 'utf8'))
const preset = presets[item] || {}
const prompt = argOf('prompt', preset.prompt)
const taskArg = argOf('task')
if (!prompt && !taskArg) {
  console.error(`No --prompt given and no preset for "${item}" in scripts/tripo-item-prompts.json.`)
  process.exit(1)
}

const type = argOf('type', 'text_to_model')
const ratio = Number(argOf('ratio', preset.ratio ?? 0.25))
const tex = Number(argOf('tex', preset.tex ?? 1024))
const scale = Number(argOf('scale', preset.scale ?? 0.32))
const position = preset.position ?? [0, 0.08, 0.035]
const rotationDeg = preset.rotationDeg ?? [0, 0, 0]

const baseUrl = (argOf('base-url', process.env.TRIPO_MCP_URL || 'https://preview.pocketrpg.pages.dev')).replace(/\/$/, '')
const token = process.env.TRIPO_MCP_TOKEN
if (!token) console.warn('TRIPO_MCP_TOKEN is not set — calling the bridge unauthenticated (only works while preview auth is disabled).')

let rpcId = 0
async function rpc(method, params) {
  const res = await fetch(`${baseUrl}/api/tripo-mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  })
  if (!res.ok) throw new Error(`${baseUrl}/api/tripo-mcp responded HTTP ${res.status}.`)
  const body = await res.json()
  if (body.error) throw new Error(`JSON-RPC error: ${body.error.message}`)
  return body.result
}

async function callTool(name, toolArgs) {
  const result = await rpc('tools/call', { name, arguments: toolArgs })
  const text = result?.content?.[0]?.text || ''
  if (result?.isError) throw new Error(`${name}: ${text}`)
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function findUrls(obj, test, found = []) {
  if (typeof obj === 'string') {
    if (/^https?:\/\//.test(obj) && test(obj)) found.push(obj)
    return found
  }
  if (obj && typeof obj === 'object') for (const v of Object.values(obj)) findUrls(v, test, found)
  return found
}

// 1. Submit (or resume) the generation task.
let taskId = taskArg
if (!taskId) {
  const created = await callTool('create_task', { type, params: { prompt } })
  taskId = created.task_id
  console.log(`Task ${taskId} (${type}) submitted — polling…`)
}

let task
for (;;) {
  task = await callTool('get_task', { task_id: taskId })
  process.stdout.write(`\r${task.status} ${task.progress ?? 0}%   `)
  if (task.status === 'success') break
  if (['failed', 'cancelled', 'banned', 'expired'].includes(task.status)) {
    console.error(`\nTask ended: ${task.status}\n${JSON.stringify(task, null, 2)}`)
    process.exit(1)
  }
  await new Promise((r) => setTimeout(r, 5000))
}
console.log()

const modelUrl = findUrls(task.output, (u) => /\.glb(\?|$)/i.test(u))[0]
const renderUrl = findUrls(task.output, (u) => /\.(webp|png|jpe?g)(\?|$)/i.test(u))[0]
if (!modelUrl) {
  console.error(`No .glb URL in the task output:\n${JSON.stringify(task.output, null, 2)}`)
  process.exit(1)
}

// 2. Persist render + raw model to R2.
if (renderUrl) {
  const render = await callTool('store_asset', {
    url: renderUrl,
    key: `renders/${item}.${taskId}.webp`,
    task_id: taskId,
    filename: `${item}-render.webp`,
  })
  console.log(`Render (eyeball this): ${render.url}`)
}
const raw = await callTool('store_asset', {
  url: modelUrl,
  key: `raw/${item}.${taskId}.glb`,
  content_type: 'model/gltf-binary',
  task_id: taskId,
  filename: `${item}-raw.glb`,
})
console.log(`Raw GLB stored: ${raw.url} (${(raw.size / 1048576).toFixed(1)} MB)`)

// 3. Download the raw GLB and shrink it for mobile.
const dir = await mkdtemp(join(tmpdir(), 'tripo-'))
const rawPath = join(dir, `${item}.raw.glb`)
const outPath = join(dir, `${item}.glb`)
const rawRes = await fetch(raw.url)
if (!rawRes.ok) throw new Error(`Downloading raw GLB failed (HTTP ${rawRes.status}).`)
await writeFile(rawPath, Buffer.from(await rawRes.arrayBuffer()))
const proc = spawnSync(
  process.execPath,
  [new URL('scripts/process-3d-model.mjs', root).pathname, rawPath, outPath, '--ratio', String(ratio), '--tex', String(tex)],
  { stdio: 'inherit' },
)
if (proc.status !== 0) process.exit(proc.status || 1)

// 4. Upload the processed GLB under the first unused models/<item>.vN.glb key.
let version = 1
for (;;) {
  const probe = await fetch(`${baseUrl}/api/tripo-assets/models/${item}.v${version}.glb`, { method: 'HEAD' })
  if (probe.status === 404) break
  version += 1
  if (version > 50) throw new Error('Could not find a free version slot under 50 — clean up the bucket?')
}
const key = `models/${item}.v${version}.glb`
const processed = await readFile(outPath)
const uploaded = await callTool('upload_asset', {
  key,
  base64: processed.toString('base64'),
  content_type: 'model/gltf-binary',
  task_id: taskId,
  filename: `${item}.glb`,
})
console.log(`Processed GLB hosted: ${uploaded.url} (${(uploaded.size / 1048576).toFixed(2)} MB)`)

// 5. Register in the equipment model registry.
if (hasFlag('no-register')) {
  console.log(`Skipping registry (--no-register). Model path: /api/tripo-assets/${key}`)
} else {
  const registryUrl = new URL('src/data/equipmentModels.json', root)
  const registry = JSON.parse(await readFile(registryUrl, 'utf8'))
  registry.weapons = registry.weapons || {}
  registry.weapons[item] = {
    model: `/api/tripo-assets/${key}`,
    bone: null,
    position,
    rotationDeg,
    scale,
  }
  await writeFile(registryUrl, JSON.stringify(registry, null, 2) + '\n')
  console.log(`Registered "${item}" in src/data/equipmentModels.json → /api/tripo-assets/${key}`)
}

console.log('\nNext: eyeball the render URL above, tune the hand transform in public/3d-preview.html, run the commit gate, commit the registry change.')
