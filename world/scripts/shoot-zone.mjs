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
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'

const worldDir = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2)
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
const yaw = flag('--yaw')
const pitch = flag('--pitch')
const dist = flag('--dist')
const follow = flag('--follow') // "x,z" — stream only chunks near this tile (M2/b demo)
const radius = flag('--radius')
const flagVals = new Set([yaw, pitch, dist, follow, radius].filter((v) => v != null))
const zones = args.filter((a) => !a.startsWith('--') && !flagVals.has(a))
const ZONES = zones.length ? zones : ['overworld']

// Per-zone default framing so `node scripts/shoot-zone.mjs` frames each zone for
// review (the world-design rule's screenshot gate) without hand-tuning the
// camera every time — big capitals want a higher, closer eye than a 32² field;
// the dungeon reads best near top-down. CLI --yaw/--pitch/--dist override these.
const CAMERAS = {
  overworld: { yaw: 0.35, pitch: 1.0, dist: 1.3 }, // wide strip — pull back, look down
}
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

// Cloud sessions ship a pre-installed Chromium and block the post-install
// browser download, so fall back to it rather than failing the visual gate.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM
  || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined)
const browser = await chromium.launch({ executablePath })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })
  for (const zone of ZONES) {
    const cam = CAMERAS[zone] ?? {}
    const y = yaw ?? cam.yaw
    const p = pitch ?? cam.pitch
    const d = dist ?? cam.dist
    const qs = [['yaw', y], ['pitch', p], ['dist', d], ['follow', follow], ['radius', radius]].filter(([, v]) => v != null).map(([k, v]) => `&${k}=${v}`).join('')
    const url = `${base}/preview.html?zone=${zone}${qs}`
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
