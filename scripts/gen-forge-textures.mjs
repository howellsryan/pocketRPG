#!/usr/bin/env node
// Pre-rasterise the Forgemark noise textures (public/forge/*.svg → *.webp).
//
// The SVG sources use feTurbulence/feDiffuseLighting, which browsers evaluate
// per pixel at raster time — as tiled page backgrounds they cost seconds of
// RasterTask on mobile every time the scroll area grows. The CSS therefore
// points at these pre-baked bitmaps (src/index.css --fm-tex-*); the SVGs stay
// as the authoring source. Re-run after editing an SVG and commit the webp.
//
// Run: node scripts/gen-forge-textures.mjs   (needs playwright + chromium,
// e.g. via PLAYWRIGHT_BROWSERS_PATH or an installed browser)
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const require = (await import('module')).createRequire(import.meta.url)
let chromium
try {
  ({ chromium } = require('playwright-core'))
} catch {
  ({ chromium } = require('playwright'))
}

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const TEXTURES = [
  { src: 'public/forge/parchment.svg', out: 'public/forge/parchment.webp', width: 600, height: 600 },
  { src: 'public/forge/iron.svg', out: 'public/forge/iron.webp', width: 400, height: 400 },
]

const executablePath = process.env.PLAYWRIGHT_CHROMIUM || undefined
const browser = await chromium.launch(executablePath ? { executablePath } : {})
for (const t of TEXTURES) {
  const page = await browser.newPage({ viewport: { width: t.width, height: t.height } })
  const svg = fs.readFileSync(path.join(ROOT, t.src), 'utf8')
  await page.setContent(`<!doctype html><style>*{margin:0}</style>${svg}`)
  await page.waitForTimeout(300)
  const buf = await page.screenshot({ type: 'jpeg', quality: 90, clip: { x: 0, y: 0, width: t.width, height: t.height } })
  // Playwright can't emit webp — write jpeg via canvas re-encode in-page instead.
  const dataUrl = await page.evaluate(async (jpegB64) => {
    const img = new Image()
    img.src = 'data:image/jpeg;base64,' + jpegB64
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.width; c.height = img.height
    c.getContext('2d').drawImage(img, 0, 0)
    return c.toDataURL('image/webp', 0.9)
  }, buf.toString('base64'))
  const webp = Buffer.from(dataUrl.split(',')[1], 'base64')
  fs.writeFileSync(path.join(ROOT, t.out), webp)
  console.log(`${t.out}: ${(webp.length / 1024).toFixed(1)} KiB`)
  await page.close()
}
await browser.close()
