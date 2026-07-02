#!/usr/bin/env node
/**
 * Generate the World Map background art with Tripo's API.
 *
 * Usage:
 *   TRIPO_API_KEY=tsk_... node scripts/tripo-worldmap.mjs [--type text_to_model] [--prompt "..."]
 *
 * The key is ONLY read from the environment — never hardcode or commit it.
 *
 * Tripo is a 3D generation service: the text pipeline is `text_to_model`, and
 * every finished task carries a `rendered_image` preview in its output next to
 * the model file. We prompt it for a top-down fantasy world-map diorama (a
 * like-for-like homage to the OSRS overworld with PocketRPG naming) and pull
 * that render as the chart background. Iterate on --prompt until the board
 * reads well, then:
 *
 *   1. Save the picked image to public/world/map.webp (cwebp/squoosh it to
 *      ~1640×1160, quality ~80 — the board's aspect).
 *   2. Set `"mapImage": "/public/world/map.webp"` at the top level of
 *      src/data/world.json.
 *   3. Re-place each place's x/y to sit on its analogue region of the art;
 *      regions with no PocketRPG place yet simply stay uninhabited on the art
 *      (future scope — add places later, no code change needed).
 *
 * The World Map screen falls back to the painted procedural terrain whenever
 * `mapImage` is unset or fails to load, so this can land incrementally.
 */

const API = 'https://api.tripo3d.ai/v2/openapi'
const KEY = process.env.TRIPO_API_KEY
if (!KEY) {
  console.error('Set TRIPO_API_KEY in the environment (never commit it).')
  process.exit(1)
}

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const DEFAULT_PROMPT = [
  'A complete top-down fantasy world map of a medieval realm, in the style of a classic',
  'MMORPG overworld chart. Landmass layout: a great walled capital city in the north-east',
  'centre; a white-stone city to its west across mining hills; a small farming town in the',
  'south-east beside a winding river; a desert with a mining town south-east beyond the river;',
  'a fishing port on the southern coast; a swamp and gothic haunted woodland in the far east;',
  'a large western region across the river with an elegant market city; a snowy mountain range',
  'in the north; scattered villages, roads connecting every settlement, forests, lakes and a',
  'sea along the south and west coasts. Painted parchment cartography style, muted greens and',
  'tans, subtle relief shading, no text, no labels, no border, orthographic top-down view.',
].join(' ')

const type = argOf('type', 'text_to_model')
const prompt = argOf('prompt', DEFAULT_PROMPT)

async function tripo(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.code !== 0) {
    throw new Error(`Tripo ${path} failed (${res.status}): ${JSON.stringify(body)}`)
  }
  return body.data
}

// Walk the task output for anything that looks like an image URL —
// rendered_image is the documented preview field, but be liberal so prompt
// iteration can inspect whatever a given model version returns.
function findImageUrls(obj, found = [], keyPath = '') {
  if (typeof obj === 'string') {
    if (/^https?:\/\/.+\.(webp|png|jpe?g)(\?|$)/i.test(obj)) found.push({ keyPath, url: obj })
    return found
  }
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) findImageUrls(v, found, keyPath ? `${keyPath}.${k}` : k)
  }
  return found
}

const { task_id: taskId } = await tripo('/task', {
  method: 'POST',
  body: JSON.stringify({ type, prompt }),
})
console.log(`Task ${taskId} (${type}) submitted — polling…`)

let task
for (;;) {
  await new Promise((r) => setTimeout(r, 5000))
  task = await tripo(`/task/${taskId}`)
  process.stdout.write(`\r${task.status} ${task.progress ?? 0}%   `)
  if (task.status === 'success') break
  if (['failed', 'cancelled', 'banned', 'expired'].includes(task.status)) {
    console.error(`\nTask ended: ${task.status}`, JSON.stringify(task, null, 2))
    process.exit(1)
  }
}

console.log('\nOutput:', JSON.stringify(task.output, null, 2))
const images = findImageUrls(task.output)
if (images.length === 0) {
  console.error('No image URL in the task output — see the dump above.')
  process.exit(1)
}

const { mkdir, writeFile } = await import('node:fs/promises')
await mkdir(new URL('../public/world/', import.meta.url), { recursive: true })
for (const [i, img] of images.entries()) {
  const ext = img.url.match(/\.(webp|png|jpe?g)/i)?.[1] || 'webp'
  const dest = new URL(`../public/world/map-tripo-${i}.${ext}`, import.meta.url)
  const res = await fetch(img.url)
  await writeFile(dest, Buffer.from(await res.arrayBuffer()))
  console.log(`Saved ${img.keyPath} → ${dest.pathname}`)
}
console.log('\nPick the best render, convert/crop to public/world/map.webp, then set "mapImage" in src/data/world.json.')
