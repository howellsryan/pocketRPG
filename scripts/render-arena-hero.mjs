#!/usr/bin/env node
// Screenshot the GLB arena hero (public/3d-samples/hero.glb) with registry
// weapon/gear through the REAL runtime attach path (src/3d/heroAttach.js via
// docs/prototypes/arena-hero-harness.html) — one PNG per combat state, so
// grip/fit transform edits in src/data/equipmentModels.json get visual review
// before commit. Sibling of render-proc.mjs (procedural creatures).
//
// Run: node scripts/render-arena-hero.mjs [--weapon itemId] [--gear id,id]
//        [--out dir] [--front] [--shots idle,attack,special,hit,death]
import fs from 'fs'
import http from 'http'
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

const args = process.argv.slice(2)
const opt = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args.splice(i, 2)[1] : null
}
const flag = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? (args.splice(i, 1), true) : false
}
const outDir = opt('--out') || 'proc-renders'
const weapon = opt('--weapon') || ''
const gear = opt('--gear') || ''
const shotsArg = opt('--shots')
const front = flag('--front')
const yaw = opt('--yaw')

const SHOTS = {
  idle: { clip: null, advance: 0 },
  attack: { clip: 'sword_attack', advance: 0.45 },
  special: { clip: 'sword_regular_combo', advance: 0.5 },
  hit: { clip: 'hit_chest', advance: 0.25 },
  death: { clip: 'death01', advance: 1.6 },
}
const shots = (shotsArg ? shotsArg.split(',') : ['idle', 'attack']).filter((s) => {
  if (!SHOTS[s]) { console.error(`unknown shot '${s}' (have: ${Object.keys(SHOTS).join(', ')})`); process.exit(1) }
  return true
})

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' }
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname))
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404).end()
    return
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})
await new Promise((res) => server.listen(0, '127.0.0.1', res))
const port = server.address().port

const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM ||
  (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined)
const browser = await chromium.launch({
  executablePath,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})

fs.mkdirSync(path.join(ROOT, outDir), { recursive: true })
const label = [weapon, gear.replace(/,/g, '+')].filter(Boolean).join('-') || 'bare'
const query = [
  weapon && `weapon=${encodeURIComponent(weapon)}`,
  gear && `gear=${encodeURIComponent(gear)}`,
  front && 'front',
  yaw && `yaw=${encodeURIComponent(yaw)}`,
].filter(Boolean).join('&')

const page = await browser.newPage({ viewport: { width: 720, height: 560 } })
page.on('pageerror', (e) => { console.error('page error:', e.message); process.exitCode = 1 })
page.on('console', (m) => { if (m.type() === 'error') console.error('console error:', m.text()) })
await page.goto(`http://127.0.0.1:${port}/docs/prototypes/arena-hero-harness.html?${query}`)
await page.waitForFunction('window.__ready === true', null, { timeout: 20000 })

let t = 0.8
await page.evaluate((tt) => window.__setTime(tt), t)
for (const name of shots) {
  const shot = SHOTS[name]
  if (shot.clip) {
    await page.evaluate((c) => window.__trigger(c), shot.clip)
    t += shot.advance
    await page.evaluate((tt) => window.__setTime(tt), t)
  }
  const out = path.join(ROOT, outDir, `hero-${label}${front ? '-front' : ''}-${name}.png`)
  await page.screenshot({ path: out })
  console.log(out)
}
await page.close()
await browser.close()
server.close()
