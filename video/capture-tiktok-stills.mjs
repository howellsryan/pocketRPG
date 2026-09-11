#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

import { serveStatic } from './lib/serve.mjs'
import { enterDemo, runScene } from './lib/drive.mjs'
import { installOverlay, setCaption, setHook } from './lib/overlay.mjs'

const require = createRequire(import.meta.url)
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'video', 'out', 'tiktok-first-fight-stills')
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

function resolveChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM
  if (fs.existsSync('/opt/pw-browsers/chromium')) return '/opt/pw-browsers/chromium'
  return undefined
}

const { chromium } = require('playwright')
const site = await serveStatic(ROOT)
const browser = await chromium.launch({
  executablePath: resolveChromium(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
})
const context = await browser.newContext({
  viewport: { width: 540, height: 960 },
  deviceScaleFactor: 2,
  reducedMotion: 'no-preference',
})
const page = await context.newPage()
const ctx = { url: `${site.url}/index.html`, hook: null, overlay: { scale: 2 } }

const shot = async (name) => {
  const p = path.join(OUT, `${name}.png`)
  await page.screenshot({ path: p, fullPage: false })
  console.log('shot:', name)
}

try {
  await page.goto(`${site.url}/index.html`, { waitUntil: 'networkidle' })
  await page.getByText('Play Demo', { exact: true }).first().waitFor({ state: 'visible', timeout: 30000 })
  await installOverlay(page, { scale: 2 })

  await setHook(page, 'A FREE RPG IN YOUR BROWSER')
  await setCaption(page, 'Tap Play Demo — no signup or download.')
  await shot('00-landing-demo')

  await setHook(page, null)
  await enterDemo(page)
  await setCaption(page, 'Jump straight into Combat.')
  await shot('01-demo-home')

  await runScene(page, { action: 'nav', target: 'Combat' }, ctx)
  await setCaption(page, 'Choose your first opponent.')
  await shot('02-combat-picker')

  await runScene(page, { action: 'text', target: 'Training' }, ctx)
  await setCaption(page, 'Field Chicken · Level 1 · 3 HP')
  await shot('03-training-open')

  await runScene(page, { action: 'text', target: 'Field Chicken' }, ctx)
  await setCaption(page, 'The fight starts instantly.')
  await page.waitForTimeout(250)
  await shot('04-fight-start')

  await page.waitForTimeout(700)
  await setCaption(page, 'Real-time 600ms combat ticks.')
  await shot('05-fight-tick-1')

  await page.waitForTimeout(700)
  await shot('06-fight-tick-2')

  await page.waitForTimeout(700)
  await setCaption(page, 'Earn XP, drops and keep progressing.')
  await shot('07-fight-tick-3')

  await page.waitForTimeout(900)
  await setCaption(page, null)
  await setHook(page, 'PLAY FREE → POCKETRPG.CO.UK')
  await shot('08-outro')
} catch (err) {
  await page.screenshot({ path: path.join(OUT, 'failure.png'), fullPage: false }).catch(() => {})
  throw err
} finally {
  await context.close().catch(() => {})
  await browser.close().catch(() => {})
  site.close()
}
console.log('✅ stills captured:', OUT)
