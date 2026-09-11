#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

import { validateRecipe, planTimeline } from './lib/recipe.mjs'
import { serveStatic } from './lib/serve.mjs'
import { runScene } from './lib/drive.mjs'
import { installOverlay, setCaption, setHook } from './lib/overlay.mjs'

const require = createRequire(import.meta.url)
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const VIEWPORT = { width: 540, height: 960 }
const OVERLAY_SCALE = 2
const SPEED = Number(process.env.VIDEO_SPEED || 1.85)

function resolveChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM
  if (fs.existsSync('/opt/pw-browsers/chromium')) return '/opt/pw-browsers/chromium'
  return undefined
}

function resolveFfmpeg() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH
  const p = require('ffmpeg-static')
  if (p && fs.existsSync(p)) return p
  throw new Error('ffmpeg not found')
}

const recipePath = process.argv[2]
if (!recipePath) throw new Error('usage: node video/render-native.mjs <recipe.json>')
const recipe = validateRecipe(JSON.parse(fs.readFileSync(recipePath, 'utf8')))
const timeline = planTimeline(recipe)
const outDir = path.join(ROOT, 'video', 'out')
const rawDir = path.join(outDir, 'raw')
fs.mkdirSync(rawDir, { recursive: true })
const out = path.join(outDir, `${recipe.id}.mp4`)
const { chromium } = require('playwright')
const ffmpeg = resolveFfmpeg()
const site = await serveStatic(ROOT)

console.log(`native render: ${recipe.id} — real browser recording, ${SPEED}x final pace`)

const browser = await chromium.launch({
  executablePath: resolveChromium(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
})
const context = await browser.newContext({
  viewport: VIEWPORT,
  reducedMotion: 'no-preference',
  recordVideo: { dir: rawDir, size: VIEWPORT },
})
const page = await context.newPage()
const video = page.video()
const pageErrors = []
page.on('pageerror', e => pageErrors.push(String(e).slice(0, 240)))

let raw
try {
  await page.goto(`${site.url}/index.html`, { waitUntil: 'networkidle' })
  await page.getByText('Play Demo', { exact: true }).first().waitFor({ state: 'visible', timeout: 30000 })
  await installOverlay(page, { scale: OVERLAY_SCALE })
  if (recipe.hook) await setHook(page, recipe.hook)
  await page.waitForTimeout(400)

  const hookMs = recipe.hookMs ?? 3000
  const started = Date.now()
  const ctx = { url: `${site.url}/index.html`, hook: recipe.hook ?? null, overlay: { scale: OVERLAY_SCALE } }

  for (const scene of timeline.scenes) {
    const source = recipe.scenes[scene.index]
    if (ctx.hook && Date.now() - started >= hookMs) {
      ctx.hook = null
      await setHook(page, null)
    }
    await setCaption(page, scene.caption)
    try {
      await runScene(page, source, ctx)
    } catch (err) {
      const shot = path.join(outDir, `${recipe.id}-failure.png`)
      await page.screenshot({ path: shot, fullPage: false }).catch(() => {})
      throw new Error(`scene ${scene.index} (${source.action} "${source.target ?? ''}") failed: ${err.message}; screenshot: ${shot}`)
    }
    await page.waitForTimeout(source.holdMs)
  }

  await setCaption(page, null)
  if (recipe.outro) {
    await setHook(page, recipe.outro)
    await page.waitForTimeout(1800)
  }
} finally {
  await context.close().catch(() => {})
  raw = await video?.path().catch(() => null)
  await browser.close().catch(() => {})
  site.close()
}

if (!raw || !fs.existsSync(raw)) throw new Error('native Playwright recording was not produced')

const x = spawnSync(ffmpeg, [
  '-y', '-hide_banner', '-loglevel', 'error',
  '-i', raw,
  '-vf', `setpts=PTS/${SPEED},scale=1080:1920:flags=lanczos,setsar=1,fps=30`,
  '-an',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  out,
], { encoding: 'utf8' })
if (x.status !== 0) throw new Error(`ffmpeg failed: ${x.stderr?.slice(-2000)}`)

if (pageErrors.length) {
  console.warn(`warning: ${pageErrors.length} page error(s):`)
  for (const e of [...new Set(pageErrors)].slice(0, 5)) console.warn(' ', e)
}

fs.rmSync(raw, { force: true })
console.log(`✅ ${out}`)
