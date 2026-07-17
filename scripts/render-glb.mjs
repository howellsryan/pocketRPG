#!/usr/bin/env node
// Screenshot an arbitrary GLB's animation clips via docs/prototypes/glb-clip-harness.html
// — one PNG per (clip × time sample), for identifying/reviewing imported monster
// models. Sibling of render-arena-hero.mjs.
//
// Run: node scripts/render-glb.mjs --src <public-relative-or-abs-url> [--height 2.4]
//        [--out dir] [--times 0,0.5,1,1.5] [--yaw 30] [--label name]
import fs from 'fs'
import http from 'http'
import path from 'path'
import { fileURLToPath } from 'url'

const require = (await import('module')).createRequire(import.meta.url)
let chromium
try { ({ chromium } = require('playwright-core')) } catch { ({ chromium } = require('playwright')) }

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const opt = (name, def = null) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : def }
const src = opt('--src')
if (!src) { console.error('need --src'); process.exit(1) }
const height = opt('--height', '2.4')
const yaw = opt('--yaw', '30')
const outDir = opt('--out', 'proc-renders')
const label = opt('--label', 'glb')
const times = (opt('--times', '0,0.4,0.8,1.2')).split(',').map(Number)

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' }
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname))
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})
await new Promise((res) => server.listen(0, '127.0.0.1', res))
const port = server.address().port
const srcUrl = /^(https?:)?\/\//.test(src) || src.startsWith('/') ? src : '/' + src

const executablePath = process.env.PLAYWRIGHT_CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined)
const browser = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
fs.mkdirSync(path.join(ROOT, outDir), { recursive: true })
const page = await browser.newPage({ viewport: { width: 600, height: 640 } })
page.on('pageerror', (e) => { console.error('page error:', e.message); process.exitCode = 1 })
page.on('console', (m) => { if (m.type() === 'error') console.error('console error:', m.text()) })
await page.goto(`http://127.0.0.1:${port}/docs/prototypes/glb-clip-harness.html?src=${encodeURIComponent(srcUrl)}&height=${height}&yaw=${yaw}`)
await page.waitForFunction('window.__ready === true', null, { timeout: 60000 })
const clips = await page.evaluate('window.__clips')
console.log('clips:', JSON.stringify(clips))

if (!clips.length) {
  const out = path.join(ROOT, outDir, `${label}-static.png`)
  await page.screenshot({ path: out })
  console.log(out)
}
for (const clip of clips) {
  await page.evaluate((n) => window.__play(n), clip.name)
  for (const t of times) {
    await page.evaluate((tt) => window.__setTime(tt), t)
    const out = path.join(ROOT, outDir, `${label}-${clip.name}-t${t}.png`)
    await page.screenshot({ path: out })
    console.log(out)
  }
}
await page.close()
await browser.close()
server.close()
