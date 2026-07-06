#!/usr/bin/env node
/**
 * Manual-asset import pipeline: you author/export a .glb, this puts it in the
 * game — the primary asset workflow now that Tripo generation is unused.
 *
 *   npm run import:model -- --file ~/Downloads/Dragon_scimitar.glb --item dragon_scimitar --variants
 *   npm run import:model -- --file ~/Downloads/KBD.glb --monster king_black_dragon --height 2.6
 *
 * Steps:
 *   1. Shrink the raw GLB with scripts/process-3d-model.mjs (raw exports are
 *      10-50 MB; phones want ~0.5 MB). Skip with --processed if already done.
 *   2. --variants: derive colour-variant GLBs for every entry in
 *      scripts/model-variants.json whose "base" is this item
 *      (scripts/recolor-model.mjs — one model becomes the whole metal tier).
 *   3. Upload each processed GLB to R2 at models/<id>.vN.glb via the Tripo
 *      bridge's upload_asset tool (N = first unused version; keys are cached
 *      immutably, never reused).
 *   4. Register in src/data/equipmentModels.json: --item → weapons.<id>
 *      (hand-bone placement; variants inherit the base transform), --monster →
 *      monsters.<id> ({ model, height }) which unlocks the 3D combat arena for
 *      that monster.
 *
 * Afterwards: tune weapon hand transforms in public/3d-preview.html, run the
 * commit gate, commit the registry change.
 *
 * Flags: --ratio/--tex (processing), --scale/--height (registry seed),
 * --processed (skip step 1), --no-register, --base-url (default TRIPO_MCP_URL
 * env or the preview deployment; TRIPO_MCP_TOKEN env for auth). Needs open
 * egress to the deployment — a network-restricted coding session drives the
 * same steps via the bridge MCP tools instead (upload_asset with the processed
 * file's base64).
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

const file = argOf('file')
const item = argOf('item')
const monster = argOf('monster')
if (!file || (!item && !monster) || (item && monster)) {
  console.error('usage: node scripts/import-model.mjs --file <path.glb> (--item <id> | --monster <id>) [--variants] [--ratio 0.06] [--tex 1024] [--scale 0.32] [--height 2.6] [--processed] [--no-register] [--base-url https://...]')
  process.exit(1)
}

const root = new URL('..', import.meta.url)
const id = item || monster
const catalogue = item
  ? JSON.parse(await readFile(new URL('src/data/items.json', root), 'utf8'))
  : JSON.parse(await readFile(new URL('src/data/monsters.json', root), 'utf8'))
if (!catalogue[id]) {
  console.error(`"${id}" is not ${item ? 'an item' : 'a monster'} id in src/data/${item ? 'items' : 'monsters'}.json.`)
  process.exit(1)
}

const ratio = Number(argOf('ratio', 0.06))
const tex = Number(argOf('tex', 1024))
const baseUrl = (argOf('base-url', process.env.TRIPO_MCP_URL || 'https://preview.pocketrpg.pages.dev')).replace(/\/$/, '')
const token = process.env.TRIPO_MCP_TOKEN
if (!token) console.warn('TRIPO_MCP_TOKEN is not set — calling the bridge unauthenticated (only works while preview auth is disabled).')

let rpcId = 0
async function callTool(name, toolArgs) {
  const res = await fetch(`${baseUrl}/api/tripo-mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: toolArgs } }),
  })
  if (!res.ok) throw new Error(`${baseUrl}/api/tripo-mcp responded HTTP ${res.status}.`)
  const body = await res.json()
  if (body.error) throw new Error(`JSON-RPC error: ${body.error.message}`)
  const text = body.result?.content?.[0]?.text || ''
  if (body.result?.isError) throw new Error(`${name}: ${text}`)
  return JSON.parse(text)
}

const runScript = (script, scriptArgs) => {
  const proc = spawnSync(process.execPath, [new URL(`scripts/${script}`, root).pathname, ...scriptArgs], { stdio: 'inherit' })
  if (proc.status !== 0) process.exit(proc.status || 1)
}

// 1. Process (or take the file as-is with --processed).
const dir = await mkdtemp(join(tmpdir(), 'import-model-'))
let processedPath = file
if (!hasFlag('processed')) {
  processedPath = join(dir, `${id}.glb`)
  runScript('process-3d-model.mjs', [file, processedPath, '--ratio', String(ratio), '--tex', String(tex)])
}

// 2. Colour variants derived from this base.
const variants = []
if (hasFlag('variants')) {
  const specs = JSON.parse(await readFile(new URL('scripts/model-variants.json', root), 'utf8'))
  for (const [variantId, spec] of Object.entries(specs)) {
    if (variantId.startsWith('_') || spec.base !== id) continue
    if (!catalogue[variantId]) {
      console.warn(`Skipping variant "${variantId}" — not in the catalogue.`)
      continue
    }
    const variantPath = join(dir, `${variantId}.glb`)
    runScript('recolor-model.mjs', [
      processedPath, variantPath,
      '--from', String(spec.from ?? 0), '--tol', String(spec.tol ?? 30),
      '--to', String(spec.to), '--sat', String(spec.sat ?? 1), '--light', String(spec.light ?? 1),
    ])
    variants.push({ id: variantId, path: variantPath })
  }
}

// 3. Upload everything to models/<id>.vN.glb.
async function upload(modelId, path) {
  let version = 1
  for (;;) {
    const probe = await fetch(`${baseUrl}/api/tripo-assets/models/${modelId}.v${version}.glb`, { method: 'HEAD' })
    if (probe.status === 404) break
    version += 1
    if (version > 50) throw new Error('Could not find a free version slot under 50 — clean up the bucket?')
  }
  const key = `models/${modelId}.v${version}.glb`
  const bytes = await readFile(path)
  const info = await callTool('upload_asset', {
    key,
    base64: bytes.toString('base64'),
    content_type: 'model/gltf-binary',
    filename: `${modelId}.glb`,
  })
  console.log(`Hosted: ${info.url} (${(info.size / 1048576).toFixed(2)} MB)`)
  return `/api/tripo-assets/${key}`
}

const modelPaths = { [id]: await upload(id, processedPath) }
for (const v of variants) modelPaths[v.id] = await upload(v.id, v.path)

// 4. Register.
if (hasFlag('no-register')) {
  console.log('Skipping registry (--no-register). Model paths:', JSON.stringify(modelPaths, null, 2))
} else {
  const registryUrl = new URL('src/data/equipmentModels.json', root)
  const registry = JSON.parse(await readFile(registryUrl, 'utf8'))
  if (item) {
    registry.weapons = registry.weapons || {}
    const existing = registry.weapons[id] || {}
    const entry = {
      model: modelPaths[id],
      bone: existing.bone ?? null,
      position: existing.position || [0, 0.08, 0.035],
      rotationDeg: existing.rotationDeg || [0, 0, 0],
      scale: Number(argOf('scale', existing.scale ?? 0.32)),
    }
    registry.weapons[id] = entry
    for (const v of variants) registry.weapons[v.id] = { ...entry, model: modelPaths[v.id] }
  } else {
    registry.monsters = registry.monsters || {}
    registry.monsters[id] = {
      model: modelPaths[id],
      height: Number(argOf('height', registry.monsters[id]?.height ?? 2)),
    }
  }
  await writeFile(registryUrl, JSON.stringify(registry, null, 2) + '\n')
  console.log(`Registered ${Object.keys(modelPaths).length} model(s) in src/data/equipmentModels.json.`)
}

console.log('\nNext: tune weapon transforms in public/3d-preview.html if needed, run the commit gate, commit the registry change.')
