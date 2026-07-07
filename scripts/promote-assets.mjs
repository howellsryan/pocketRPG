#!/usr/bin/env node
/**
 * Promote R2-hosted 3D assets between environments (preview → production).
 *
 * The registry references site-relative /api/tripo-assets/ URLs, so each
 * deployment serves its own bucket — a model imported against preview does
 * NOT exist in production until promoted. Run this after merging 3D work to
 * main (and before enabling 3D there):
 *
 *   TRIPO_MCP_TOKEN=<target token> node scripts/promote-assets.mjs \
 *     [--from https://preview.pocketrpg.pages.dev] [--to https://pocketrpg.co.uk] [--dry-run]
 *
 * For every /api/tripo-assets/ model in src/data/equipmentModels.json:
 * skip if the key already exists on --to (cache-busted probe), otherwise
 * download from --from's serving route and upload via --to's bridge
 * upload_asset under the SAME key. Requires the bridge with upload_asset
 * deployed on --to and its TRIPO_MCP_TOKEN.
 */

import { readFile } from 'node:fs/promises'

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback
}
const from = argOf('from', 'https://preview.pocketrpg.pages.dev').replace(/\/$/, '')
const to = argOf('to', 'https://pocketrpg.co.uk').replace(/\/$/, '')
const dryRun = args.includes('--dry-run')
const token = process.env.TRIPO_MCP_TOKEN
if (!token && !dryRun) console.warn('TRIPO_MCP_TOKEN is not set — calling the target bridge unauthenticated.')

const registry = JSON.parse(await readFile(new URL('../src/data/equipmentModels.json', import.meta.url), 'utf8'))
const PREFIX = '/api/tripo-assets/'
const keys = new Set()
for (const section of [registry.weapons || {}, registry.monsters || {}]) {
  for (const entry of Object.values(section)) {
    if (entry.model && entry.model.startsWith(PREFIX)) keys.add(entry.model.slice(PREFIX.length))
  }
}
if (keys.size === 0) {
  console.log('No R2-hosted models in the registry — nothing to promote.')
  process.exit(0)
}

let rpcId = 0
async function callTool(name, toolArgs) {
  const res = await fetch(`${to}/api/tripo-mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: toolArgs } }),
  })
  if (!res.ok) throw new Error(`${to}/api/tripo-mcp responded HTTP ${res.status}.`)
  const body = await res.json()
  if (body.error) throw new Error(`JSON-RPC error: ${body.error.message}`)
  const text = body.result?.content?.[0]?.text || ''
  if (body.result?.isError) throw new Error(`${name}: ${text}`)
  return JSON.parse(text)
}

let promoted = 0, skipped = 0
for (const key of [...keys].sort()) {
  const probe = await fetch(`${to}${PREFIX}${key}?probe=${Date.now()}`, { method: 'HEAD' })
  if (probe.ok) {
    skipped++
    console.log(`= ${key} (already on ${to})`)
    continue
  }
  const src = await fetch(`${from}${PREFIX}${key}`)
  if (!src.ok) throw new Error(`${from}${PREFIX}${key} responded HTTP ${src.status} — registry references a missing source asset.`)
  const bytes = Buffer.from(await src.arrayBuffer())
  if (dryRun) {
    console.log(`~ ${key} would promote (${(bytes.length / 1048576).toFixed(2)} MB)`)
    continue
  }
  const info = await callTool('upload_asset', {
    key,
    base64: bytes.toString('base64'),
    content_type: src.headers.get('content-type') || 'model/gltf-binary',
  })
  promoted++
  console.log(`+ ${key} → ${info.url} (${(info.size / 1048576).toFixed(2)} MB)`)
}
console.log(`\n${promoted} promoted, ${skipped} already present, ${keys.size} total.`)
