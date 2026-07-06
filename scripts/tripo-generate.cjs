#!/usr/bin/env node
// Direct Tripo API client for local dev asset generation — bypasses the Tripo
// MCP server entirely so exploring/iterating on prompts doesn't burn AI tokens.
//
// Usage:
//   node scripts/tripo-generate.cjs image "concept art of a fire elemental boss"
//   node scripts/tripo-generate.cjs model "a rusty iron shortsword"
//   node scripts/tripo-generate.cjs model "a goblin warrior" --rig --animate walk
//
// Requires TRIPO_API_KEY in the environment (export it, or prefix the command:
//   TRIPO_API_KEY=xxx node scripts/tripo-generate.cjs ...).
//
// Modes:
//   image  — text_to_model, saves only the rendered_image preview PNG.
//            (Tripo has no standalone text-to-image endpoint — every task
//            produces a 3D model; this just discards the mesh.)
//   model  — text_to_model, downloads the .glb/.fbx. With --rig, chains an
//            animate_rig task; with --animate <preset>, also chains an
//            animate_retarget task and downloads the final animated asset.
//
// Options:
//   --negative <text>        negative_prompt for text_to_model
//   --model-version <ver>    Tripo model_version (default: Tripo's current default)
//   --no-texture             disable texture generation
//   --no-pbr                 disable PBR materials
//   --rig                    auto-rig the generated model (model mode only)
//   --spec <tripo|mixamo>    rig skeleton spec (default: tripo)
//   --animate <preset>       animation preset name, implies --rig (e.g. walk,
//                            run, idle, jump — "preset:" prefix added if missing)
//   --format <glb|fbx>       output format for rig/animate steps (default: glb)
//   --out <dir>              output directory (default: tripo-output)
//   --timeout <seconds>      max wait per task (default: 600)
//   --poll-interval <sec>    poll frequency (default: 3)

'use strict'

const fs = require('fs')
const path = require('path')
const { parseArgs } = require('util')

const API_BASE = 'https://api.tripo3d.ai/v2/openapi'
const API_KEY = process.env.TRIPO_API_KEY

function fail(message) {
  console.error(`Error: ${message}`)
  process.exit(1)
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'tripo-asset'
}

async function apiRequest(method, urlPath, body) {
  const res = await fetch(`${API_BASE}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    fail(`non-JSON response from ${urlPath} (HTTP ${res.status}): ${text.slice(0, 500)}`)
  }
  if (!res.ok || (json.code && json.code !== 0)) {
    fail(`${urlPath} failed (HTTP ${res.status}): ${JSON.stringify(json)}`)
  }
  return json.data
}

async function createTask(payload) {
  const data = await apiRequest('POST', '/task', payload)
  console.log(`  created ${payload.type} task ${data.task_id}`)
  return data.task_id
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForTask(taskId, { timeoutSec, pollIntervalSec }) {
  const deadline = Date.now() + timeoutSec * 1000
  let lastStatus = ''
  while (Date.now() < deadline) {
    const data = await apiRequest('GET', `/task/${taskId}`)
    if (data.status !== lastStatus) {
      console.log(`  [${taskId}] status: ${data.status}${data.progress != null ? ` (${data.progress}%)` : ''}`)
      lastStatus = data.status
    }
    if (data.status === 'success') return data
    if (['failed', 'cancelled', 'banned', 'expired'].includes(data.status)) {
      fail(`task ${taskId} ended with status "${data.status}": ${data.error_msg || 'no error message'}`)
    }
    await sleep(pollIntervalSec * 1000)
  }
  fail(`task ${taskId} timed out after ${timeoutSec}s`)
}

async function downloadUrl(url, destPath) {
  const res = await fetch(url)
  if (!res.ok) fail(`failed to download ${url} (HTTP ${res.status})`)
  const buf = Buffer.from(await res.arrayBuffer())
  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  fs.writeFileSync(destPath, buf)
  console.log(`  saved ${destPath} (${(buf.length / 1024).toFixed(1)} KiB)`)
}

function extFromUrl(url, fallback) {
  const match = /\.([a-z0-9]{2,5})(?:\?|$)/i.exec(new URL(url).pathname)
  return match ? match[1] : fallback
}

async function runModelMode(prompt, opts) {
  const slug = slugify(prompt)
  const outDir = opts.out

  console.log(`Generating model: "${prompt}"`)
  const modelTaskId = await createTask({
    type: 'text_to_model',
    prompt,
    negative_prompt: opts.negative || undefined,
    model_version: opts.modelVersion || undefined,
    texture: opts.texture,
    pbr: opts.pbr,
  })
  const modelResult = await waitForTask(modelTaskId, opts)
  const meshUrl = modelResult.output.pbr_model || modelResult.output.model
  if (meshUrl) {
    await downloadUrl(meshUrl, path.join(outDir, `${slug}.${extFromUrl(meshUrl, 'glb')}`))
  }
  if (modelResult.output.rendered_image) {
    await downloadUrl(modelResult.output.rendered_image, path.join(outDir, `${slug}-preview.png`))
  }

  if (!opts.rig && !opts.animate) return

  console.log('Rigging model...')
  const rigTaskId = await createTask({
    type: 'animate_rig',
    original_model_task_id: modelTaskId,
    out_format: opts.format,
    spec: opts.spec,
  })
  const rigResult = await waitForTask(rigTaskId, opts)
  const rigUrl = rigResult.output.model || rigResult.output.pbr_model
  if (rigUrl) {
    await downloadUrl(rigUrl, path.join(outDir, `${slug}-rigged.${opts.format}`))
  }

  if (!opts.animate) return

  const animationName = opts.animate.includes(':') ? opts.animate : `preset:${opts.animate}`
  console.log(`Applying animation "${animationName}"...`)
  const animateTaskId = await createTask({
    type: 'animate_retarget',
    original_model_task_id: rigTaskId,
    out_format: opts.format,
    animation: animationName,
  })
  const animateResult = await waitForTask(animateTaskId, opts)
  const animatedUrl = animateResult.output.model || animateResult.output.pbr_model
  if (animatedUrl) {
    await downloadUrl(animatedUrl, path.join(outDir, `${slug}-${opts.animate.replace(/[^a-z0-9]+/gi, '-')}.${opts.format}`))
  }
}

async function runImageMode(prompt, opts) {
  const slug = slugify(prompt)
  console.log(`Generating preview image: "${prompt}"`)
  const taskId = await createTask({
    type: 'text_to_model',
    prompt,
    negative_prompt: opts.negative || undefined,
    model_version: opts.modelVersion || undefined,
    texture: opts.texture,
    pbr: opts.pbr,
  })
  const result = await waitForTask(taskId, opts)
  if (!result.output.rendered_image) {
    fail(`task ${taskId} succeeded but returned no rendered_image`)
  }
  await downloadUrl(result.output.rendered_image, path.join(opts.out, `${slug}-preview.png`))
}

async function main() {
  if (!API_KEY) {
    fail('TRIPO_API_KEY is not set. Export it in your shell before running this script.')
  }

  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      negative: { type: 'string' },
      'model-version': { type: 'string' },
      texture: { type: 'boolean', default: true },
      pbr: { type: 'boolean', default: true },
      rig: { type: 'boolean', default: false },
      spec: { type: 'string', default: 'tripo' },
      animate: { type: 'string' },
      format: { type: 'string', default: 'glb' },
      out: { type: 'string', default: 'tripo-output' },
      timeout: { type: 'string', default: '600' },
      'poll-interval': { type: 'string', default: '3' },
    },
  })

  const [mode, ...promptParts] = positionals
  const prompt = promptParts.join(' ').trim()
  if (!['image', 'model'].includes(mode) || !prompt) {
    fail('usage: node scripts/tripo-generate.cjs <image|model> "<prompt>" [options]')
  }

  const opts = {
    negative: values.negative,
    modelVersion: values['model-version'],
    texture: values.texture,
    pbr: values.pbr,
    rig: values.rig,
    spec: values.spec,
    animate: values.animate,
    format: values.format,
    out: values.out,
    timeoutSec: Number(values.timeout),
    pollIntervalSec: Number(values['poll-interval']),
  }

  if (mode === 'model') {
    await runModelMode(prompt, opts)
  } else {
    await runImageMode(prompt, opts)
  }

  console.log('Done.')
}

main().catch((err) => fail(err.stack || err.message || String(err)))
