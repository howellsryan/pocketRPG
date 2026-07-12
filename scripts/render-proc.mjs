#!/usr/bin/env node
// Screenshot a procedural creature (src/data/creatures3d.json) through the
// REAL runtime (src/3d/rigs.js + blendShell.js) via the Phase 1 dev harness
// docs/prototypes/proc-creature-harness.html — one PNG per combat state
// (idle / attack / hit / death), so AI-authored specs get visual review
// before commit (docs/procedural-3d-plan.md Phase 3).
//
// Run: node scripts/render-proc.mjs <monsterId> [more ids...] [--out dir]
// Needs playwright-core (`npm i --no-save playwright-core`) + a Chromium
// (auto-detects /opt/pw-browsers/chromium; override with PLAYWRIGHT_CHROMIUM).
// WebGL runs on SwiftShader, so this works headless on CPU-only machines.
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
const outFlag = args.indexOf('--out')
const outDir = outFlag >= 0 ? args.splice(outFlag, 2)[1] : 'proc-renders'
const ids = args.filter((a) => !a.startsWith('-'))
if (!ids.length) {
  console.error('usage: node scripts/render-proc.mjs <monsterId> [more ids...] [--out dir]')
  process.exit(1)
}
const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/creatures3d.json'), 'utf8'))
for (const id of ids) {
  if (!registry.monsters[id]) {
    console.error(`no creatures3d.json entry for "${id}" (have: ${Object.keys(registry.monsters).join(', ')})`)
    process.exit(1)
  }
}

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
  // Software WebGL: required on CPU-only/headless boxes, harmless elsewhere.
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})

// State → capture plan. Times are seconds fed to the harness clock; attack and
// hit are captured mid-motion (rig durations: attack 0.6s, hit 0.45s, death
// 1.1s — RIG_DURATIONS in src/3d/rigs.js), death after the collapse settles.
const SHOTS = [
  { name: 'idle', trigger: null, advance: 0 },
  { name: 'attack', trigger: 'attack', advance: 0.38 },
  { name: 'hit', trigger: 'hit', advance: 0.2 },
  { name: 'death', trigger: 'death', advance: 1.05 },
]

fs.mkdirSync(path.join(ROOT, outDir), { recursive: true })
for (const id of ids) {
  const page = await browser.newPage({ viewport: { width: 720, height: 560 } })
  page.on('pageerror', (e) => { console.error(`[${id}] page error:`, e.message); process.exitCode = 1 })
  await page.goto(`http://127.0.0.1:${port}/docs/prototypes/proc-creature-harness.html?monster=${id}`)
  await page.waitForFunction('window.__ready === true', null, { timeout: 15000 })

  let t = 0.8
  await page.evaluate((tt) => window.__setTime(tt), t)
  for (const shot of SHOTS) {
    if (shot.trigger) {
      await page.evaluate((name) => window.__trigger(name), shot.trigger)
      t += shot.advance
      await page.evaluate((tt) => window.__setTime(tt), t)
    }
    const out = path.join(ROOT, outDir, `${id}-${shot.name}.png`)
    await page.screenshot({ path: out })
    console.log(out)
    if (shot.trigger) {
      await page.evaluate(() => window.__trigger('respawn'))
      t += 0.4
      await page.evaluate((tt) => window.__setTime(tt), t)
    }
  }
  await page.close()
}

await browser.close()
server.close()
