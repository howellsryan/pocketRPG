#!/usr/bin/env node
// Headless terrain screenshots. Builds the client, serves dist with `vite
// preview`, and Playwright-shoots preview.html for each zone to
// world/preview-shots/<zone>.png. No server, no auth — renders straight from the
// bundled zone JSON through the real terrain pipeline.
//
//   node scripts/shoot-zone.mjs                 # all zones
//   node scripts/shoot-zone.mjs forest          # one zone
//   node scripts/shoot-zone.mjs pasture --yaw 1.2

import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const worldDir = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2)
const yawIdx = args.indexOf('--yaw')
const yaw = yawIdx >= 0 ? args[yawIdx + 1] : null
const zones = args.filter((a) => !a.startsWith('--') && a !== yaw)
const ZONES = zones.length ? zones : ['pasture', 'forest', 'lumbright']
const outDir = path.join(worldDir, 'preview-shots')
mkdirSync(outDir, { recursive: true })

console.log('shoot-zone: building client…')
execFileSync('npm', ['run', 'build'], { cwd: worldDir, stdio: 'inherit' })

console.log('shoot-zone: starting vite preview…')
const server = spawn('npx', ['vite', 'preview', '--config', 'client/vite.config.ts', '--port', '4174', '--strictPort'], {
  cwd: worldDir,
  stdio: ['ignore', 'pipe', 'inherit'],
})
const base = 'http://localhost:4174'
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('vite preview did not start in 20s')), 20000)
  server.stdout.on('data', (d) => {
    if (d.toString().includes('localhost:4174')) { clearTimeout(timer); resolve() }
  })
})

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })
  for (const zone of ZONES) {
    const url = `${base}/preview.html?zone=${zone}${yaw != null ? `&yaw=${yaw}` : ''}`
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__previewReady === true, { timeout: 15000 }).catch(() => {})
    const file = path.join(outDir, `${zone}.png`)
    await page.screenshot({ path: file })
    console.log(`shoot-zone: wrote ${path.relative(worldDir, file)}`)
  }
} finally {
  await browser.close()
  server.kill()
}
console.log('shoot-zone: done →', path.relative(worldDir, outDir))
