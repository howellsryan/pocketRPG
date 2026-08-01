// Manual replication of the loadout-preset item-loss bug (fixed in "Stop loadout
// swaps losing items to a stale idle write-back").
//
// NOT part of `npm test` — it drives a real browser and needs `playwright`
// installed separately plus a built bundle (`npm run rebuild`). The durable
// regression protection is tests/holdingsReconcile.test.ts; this exists so the
// end-to-end failure can be reproduced and re-verified against any build.
//
//   node scripts/repro-preset-item-loss.mjs <build-root> [port]
//
// Verified results at the time of writing:
//   pre-fix  (519beb3) -> RESULT: ITEMS DESTROYED (1010 units)
//   fixed    (cfa97be) -> RESULT: CONSERVED
//
// The sequence, which is what a player reported:
//
//   1. Player is idling a gather task (started through the real UI).
//   2. Player loads an equipment preset: bank -> inventory + equipment.
//   3. The app is backgrounded before the 300ms autosave debounce fires. A
//      suspended app runs no timers, so that write never lands -- modelled here
//      by holding the autosave's setTimeout callback.
//   4. The app is resumed. The idle catch-up handler reads equipment/inventory/
//      bank from IndexedDB (still pre-swap), simulates the elapsed window and
//      writes the result back.
//
// Prints the item totals across bank + inventory + equipment before and after.
import { chromium } from 'playwright'
import http from 'http'; import fs from 'fs'; import path from 'path'

const ROOT = process.argv[2]
const PORT = Number(process.argv[3] || 4670)
const TYPES = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'}
const srv = http.createServer((req,res)=>{
  let p = decodeURIComponent(req.url.split('?')[0]); if (p==='/') p='/index.html'
  const f = path.join(ROOT,p)
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end() }
  res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'})
  fs.createReadStream(f).pipe(res)
}).listen(PORT)

const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' })
const pg = await b.newPage({ viewport:{ width:390, height:844 } })
pg.on('pageerror', e => console.log('PAGEERROR', String(e).slice(0,160)))

const invOf = e => { const a = new Array(28).fill(null); e.forEach((x,i)=>a[i]=x); return a }
const PRESET = {
  id:'p_magic', name:'Magic',
  equipment:{ weapon:{ itemId:'bronze_sword' } },
  inventory: invOf([{ itemId:'shark', quantity:10 }, { itemId:'air_rune', quantity:1000 }]),
}
const BANK = {
  shark:{ itemId:'shark', quantity:10 },
  air_rune:{ itemId:'air_rune', quantity:1000 },
  bronze_sword:{ itemId:'bronze_sword', quantity:1 },
  coal:{ itemId:'coal', quantity:500 },
}
const TRACKED = ['shark','air_rune','bronze_sword','coal']

const seedItems = () => pg.evaluate(async ({ PRESET, BANK }) => {
  const db = await new Promise((r,j)=>{ const q=indexedDB.open('PocketRPG',1); q.onsuccess=()=>r(q.result); q.onerror=()=>j(q.error) })
  const put = (store, recs) => new Promise((r,j)=>{
    const tx = db.transaction(store,'readwrite'); tx.objectStore(store).clear()
    for (const [k,v] of recs) tx.objectStore(store).put(v,k)
    tx.oncomplete=()=>r(); tx.onerror=()=>j(tx.error)
  })
  await put('inventory', []); await put('equipment', []); await put('bank', Object.entries(BANK))
  await new Promise((r,j)=>{
    const tx = db.transaction('settings','readwrite')
    tx.objectStore('settings').put({ key:'equipmentPresets', value:[PRESET] }, 'equipmentPresets')
    tx.oncomplete=()=>r(); tx.onerror=()=>j(tx.error)
  })
  db.close()
}, { PRESET, BANK })

const totals = () => pg.evaluate(async () => {
  const db = await new Promise((r,j)=>{ const q=indexedDB.open('PocketRPG',1); q.onsuccess=()=>r(q.result); q.onerror=()=>j(q.error) })
  const all = s => new Promise((r,j)=>{ const q=db.transaction(s,'readonly').objectStore(s).getAll(); q.onsuccess=()=>r(q.result); q.onerror=()=>j(q.error) })
  const [inv,bank,eq] = await Promise.all([all('inventory'),all('bank'),all('equipment')])
  db.close()
  const t = {}; const add=(id,q)=>{ if(id&&q>0) t[id]=(t[id]||0)+q }
  for (const s of inv)  if (s?.itemId) add(s.itemId, s.quantity||1)
  for (const s of bank) if (s?.itemId) add(s.itemId, s.quantity||0)
  for (const s of eq)   if (s?.itemId) add(s.itemId, s.quantity||1)
  return t
})

// A backgrounded app runs no timers. Hold the autosave debounce's callback
// (AUTO_SAVE_DEBOUNCE = 300ms) instead of letting it fire.
const suspendAutosaveTimer = () => pg.evaluate(() => {
  window.__held = []
  window.__realST = window.setTimeout.bind(window)
  window.setTimeout = (fn, ms, ...a) => (ms === 300 ? (window.__held.push(fn), -1) : window.__realST(fn, ms, ...a))
})
const resumeAutosaveTimer = () => pg.evaluate(() => {
  window.setTimeout = window.__realST
  const held = window.__held || []; window.__held = []
  for (const fn of held) try { fn() } catch {}
  return held.length
})

const dismiss = async () => { await pg.locator('button:visible',{hasText:/^✕$/}).first().click().catch(()=>{}); await pg.waitForTimeout(500) }

await pg.goto(`http://localhost:${PORT}/index.html`, { waitUntil:'networkidle' })
await pg.waitForTimeout(1200)
await pg.getByText('Play Demo',{ exact:true }).first().click()
await pg.waitForTimeout(4000)
await dismiss()

// Start a real background gather task through the UI.
await pg.mouse.click(65,34); await pg.waitForTimeout(2500)                                  // world map
await pg.locator('button:visible',{hasText:/^Lumbright/}).first().click(); await pg.waitForTimeout(2000)
await pg.locator('button:visible',{hasText:/^Wheat Field/}).first().click(); await pg.waitForTimeout(2500)
const task = await pg.evaluate(()=>localStorage.getItem('pocketrpg_activeTask'))
if (!task) { console.log('*** NO ACTIVE TASK — HARNESS INVALID ***'); await b.close(); srv.close(); process.exit(1) }
console.log('active task:', JSON.parse(task).gatherTask.id)

// Seed the holdings, then reload so the app boots from them (the task rides
// localStorage and comes back with it).
await seedItems()
await pg.reload({ waitUntil:'networkidle' }); await pg.waitForTimeout(5000)
await dismiss()
await pg.mouse.click(325,34); await pg.waitForTimeout(2500)   // Equipment

// HARNESS CHECK: without a ticking background task this experiment is vacuous.
const p1 = await totals(); await pg.waitForTimeout(8000); const p2 = await totals()
console.log(`harness check: bowstring ${p1.bowstring||0} -> ${p2.bowstring||0} over 8s`,
  (p2.bowstring||0) > (p1.bowstring||0) ? '(background task IS running)' : '*** NOT RUNNING — VACUOUS ***')

const before = await totals()
console.log('BEFORE', JSON.stringify(Object.fromEntries(TRACKED.map(k=>[k,before[k]||0]))))

await suspendAutosaveTimer()
await pg.locator('div.flex.items-stretch button').first().click()   // load the loadout
await pg.waitForTimeout(80)

// Resume: the catch-up handler runs while the autosave write is still held.
await pg.evaluate(() => {
  localStorage.setItem('pocketrpg_hiddenAt', String(Date.now() - 60_000))
  document.dispatchEvent(new Event('visibilitychange'))
})
await pg.waitForTimeout(3000)
console.log('released held autosave callbacks:', await resumeAutosaveTimer())
await pg.waitForTimeout(3000)

const after = await totals()
console.log('AFTER ', JSON.stringify(Object.fromEntries(TRACKED.map(k=>[k,after[k]||0]))))
let lost = 0
for (const k of TRACKED) { const d = (before[k]||0) - (after[k]||0); if (d > 0) { lost += d; console.log(`  LOST ${k}: ${before[k]||0} -> ${after[k]||0}`) } }
console.log(lost === 0 ? 'RESULT: CONSERVED' : `RESULT: ITEMS DESTROYED (${lost} units)`)
await b.close(); srv.close()
