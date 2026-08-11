#!/usr/bin/env node
/**
 * Render a recipe to a TikTok-ready MP4.
 *
 *   node video/render.mjs video/recipes/zero-to-hero.json
 *   node video/render.mjs video/recipes/zero-to-hero.json --out /tmp/x.mp4 --keep-open
 *
 * Runs entirely offline against the built bundle in demo mode — no account, no
 * server, no paid service. Build first: `npm run rebuild`.
 *
 * Output is 1080x1920 H.264, the frame TikTok expects. See video/README.md.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

import { validateRecipe, planTimeline, captionFits, CAPTION_FONT_SIZE } from './lib/recipe.mjs'
import { serveStatic } from './lib/serve.mjs'
import { createCapture } from './lib/capture.mjs'
import { bootDemo, runScene, waitForGame } from './lib/drive.mjs'
import { installOverlay, setCaption, setHook } from './lib/overlay.mjs'
import { applySeed } from './lib/seed.mjs'

const require = createRequire(import.meta.url)
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

// 390x694 CSS at 2.769x device scale lands on exactly 1080x1920, so the game
// fills a 9:16 frame with no letterboxing while still laying out at the ~390px
// width it is designed for. Playwright's recordVideo cannot do this (it ignores
// deviceScaleFactor) — see video/lib/capture.mjs.
const CSS_VIEWPORT = { width: 390, height: 694 }
const DEVICE_SCALE = 2.769
const TIKTOK_FRAME = { width: 1080, height: 1920 }
const TIKTOK_MAX_BYTES = 287.6 * 1024 * 1024

const args = process.argv.slice(2)
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null }
const bool = (name) => { const i = args.indexOf(name); return i >= 0 ? (args.splice(i, 1), true) : false }
const outFlag = flag('--out')
const keepOpen = bool('--keep-open')
const recipePath = args[0]

if (!recipePath) {
  console.error('usage: node video/render.mjs <recipe.json> [--out file.mp4] [--keep-open]')
  process.exit(1)
}

function resolveChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM
  // Cloud sessions ship a pre-installed Chromium and block the postinstall
  // download, same fallback world/scripts/shoot-zone.mjs uses.
  if (fs.existsSync('/opt/pw-browsers/chromium')) return '/opt/pw-browsers/chromium'
  return undefined
}

function resolveFfmpeg() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH
  try {
    const p = require('ffmpeg-static')
    if (p && fs.existsSync(p)) return p
  } catch { /* fall through to the error below */ }
  throw new Error('ffmpeg not found — run `npm install` (ffmpeg-static is a devDependency), or set FFMPEG_PATH')
}

const recipe = validateRecipe(JSON.parse(fs.readFileSync(recipePath, 'utf8')))
const timeline = planTimeline(recipe)

// Catch unreadable captions before spending a full render on them.
for (const scene of timeline.scenes) {
  if (!scene.caption) continue
  const { fits, lines } = captionFits(scene.caption, { fontSize: CAPTION_FONT_SIZE })
  if (!fits) throw new Error(`recipe .scenes[${scene.index}].caption is too long for the safe zone (${lines.length} lines)`)
}

if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
  throw new Error('no build found — run `npm run rebuild` first (index.html is generated and gitignored)')
}

const outDir = path.join(ROOT, 'video', 'out')
fs.mkdirSync(outDir, { recursive: true })
const out = outFlag ? path.resolve(outFlag) : path.join(outDir, `${recipe.id}.mp4`)

const { chromium } = require('playwright')
const ffmpegPath = resolveFfmpeg()
const site = await serveStatic(ROOT)

console.log(`render: ${recipe.id} — ${timeline.scenes.length} scenes, ~${(timeline.durationMs / 1000).toFixed(1)}s planned`)

const browser = await chromium.launch({
  executablePath: resolveChromium(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
})
const context = await browser.newContext({
  viewport: CSS_VIEWPORT,
  deviceScaleFactor: DEVICE_SCALE,
  reducedMotion: 'no-preference',
})
const page = await context.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)))

let capture
let finished = false
try {
  const overlayOpts = { scale: DEVICE_SCALE }
  await bootDemo(page, `${site.url}/index.html`, overlayOpts)

  if (recipe.seed) {
    await applySeed(page, recipe.seed)
    await page.goto(`${site.url}/index.html`, { waitUntil: 'networkidle' })
    await waitForGame(page)
    await installOverlay(page, overlayOpts)
  }
  if (recipe.hook) await setHook(page, recipe.hook)
  await page.waitForTimeout(400)

  const cdpSession = await context.newCDPSession(page)
  capture = createCapture({
    page, cdpSession, fps: recipe.fps, out, ffmpegPath,
    width: TIKTOK_FRAME.width, height: TIKTOK_FRAME.height,
  })
  await capture.start()

  // The hook is a scroll-stopper, not a watermark: it holds for the opening
  // beat and then clears so it never fights the captions for the same frame.
  const hookMs = recipe.hookMs ?? 3500
  const ctx = { url: `${site.url}/index.html`, hook: recipe.hook ?? null, overlay: overlayOpts }
  const captureStart = Date.now()
  for (const scene of timeline.scenes) {
    const source = recipe.scenes[scene.index]
    if (ctx.hook && Date.now() - captureStart >= hookMs) {
      ctx.hook = null
      await setHook(page, null)
    }
    // A reseed reloads the page and restores its own caption; setting it here
    // first would be wiped by that navigation.
    if (source.action !== 'reseed') await setCaption(page, scene.caption)
    try {
      // A reseed's page reload is boot chrome nobody wants to watch — hold the
      // recording across it so the cut lands straight on the new state.
      if (source.action === 'reseed') capture.pause()
      await runScene(page, source, ctx)
      if (source.action === 'reseed') capture.resume()
    } catch (err) {
      // A recipe that cannot find its target is the most common failure, and
      // the message alone rarely says why. Leave a frame behind to look at.
      const shot = path.join(outDir, `${recipe.id}-failure.png`)
      await page.screenshot({ path: shot }).catch(() => {})
      throw new Error(`scene ${scene.index} (${source.action} "${source.target ?? ''}") failed: ${err.message}\nscreen at failure: ${shot}`)
    }
    await page.waitForTimeout(source.holdMs)
  }
  await setCaption(page, null)
  if (recipe.outro) { await setHook(page, recipe.outro); await page.waitForTimeout(1800) }

  const stats = await capture.stop()
  finished = true
  console.log(`capture: ${stats.frames} frames, ${(stats.durationMs / 1000).toFixed(1)}s @ ${recipe.fps}fps`)
} finally {
  // A render that threw mid-capture leaves ffmpeg holding an open stdin.
  if (!finished) capture?.abort()
  if (!keepOpen) { await browser.close().catch(() => {}) }
  site.close()
}

if (pageErrors.length) {
  console.warn(`warning: ${pageErrors.length} page error(s) during capture:`)
  for (const e of [...new Set(pageErrors)].slice(0, 5)) console.warn('  ', e)
}

// Verify what actually landed on disk. A render that silently comes out at the
// wrong resolution still plays fine locally and is only obvious once TikTok has
// upscaled it, so this is an assertion rather than a log line.
const probe = verifyOutput(out, ffmpegPath, recipe.fps)
const size = fs.statSync(out).size
console.log(`✅ ${out} (${(size / 1024 / 1024).toFixed(1)} MB, ${probe.width}x${probe.height} ${probe.codec} ${probe.fps}fps)`)
if (size > TIKTOK_MAX_BYTES) console.warn("warning: exceeds TikTok's 287.6MB upload limit")

function verifyOutput(file, ffmpeg, expectedFps) {
  // ffmpeg-static ships no ffprobe, so read the stream header off ffmpeg itself.
  const { execFileSync } = require('node:child_process')
  let header = ''
  try { execFileSync(ffmpeg, ['-hide_banner', '-i', file], { stdio: 'pipe' }) } catch (e) { header = String(e.stderr) }
  const stream = /Stream #0:0.*?: Video: (\w+).*?, (\d+)x(\d+)(?: \[SAR (\d+):(\d+)[^\]]*\])?.*?, ([\d.]+) fps/s.exec(header)
  if (!stream) throw new Error(`could not read video stream from ${file}`)
  const [, codec, w, h, sarN, sarD, fps] = stream
  const width = Number(w); const height = Number(h)
  // Square pixels, or the frame encodes at 1080x1920 but displays off-ratio.
  if (sarN && sarN !== sarD) throw new Error(`output has non-square pixels (SAR ${sarN}:${sarD})`)
  if (width !== TIKTOK_FRAME.width || height !== TIKTOK_FRAME.height) {
    throw new Error(`output is ${width}x${height}, expected ${TIKTOK_FRAME.width}x${TIKTOK_FRAME.height}`)
  }
  if (codec !== 'h264') throw new Error(`output codec is ${codec}, expected h264`)
  if (Math.abs(Number(fps) - expectedFps) > 0.5) throw new Error(`output is ${fps}fps, expected ${expectedFps}`)
  return { width, height, codec, fps: Number(fps) }
}
