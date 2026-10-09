// Run against the production bundle after `npm run rebuild`:
//   node scripts/repro-ios-home-screen.mjs [build-root] [chromium|webkit]
// Checks rendered layout, including iOS standalone's zero-inset case. Chromium
// also emulates a notched phone's safe areas. The iOS system compositor still
// needs a real Home Screen check; desktop WebKit cannot reproduce that layer.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve, sep, extname } from 'node:path'
import { chromium, webkit } from 'playwright'

const root = resolve(process.argv[2] || '.')
const browserName = process.argv[3] || 'chromium'
const screenshots = process.env.POCKETRPG_REPRO_SCREENSHOTS
if (screenshots) await mkdir(screenshots, { recursive: true })
const browserType = { chromium, webkit }[browserName]
assert.ok(browserType, 'Choose chromium or webkit')
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' }
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`)
    if (!file.startsWith(root + sep)) throw new Error('Invalid path')
    const body = await readFile(file)
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' })
    response.end(body)
  } catch {
    response.writeHead(404)
    response.end()
  }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await browserType.launch()
  for (const standalone of [true, false]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 })
    await context.addInitScript(standalone => {
      Object.defineProperty(navigator, 'standalone', { value: standalone })
      localStorage.setItem('pocketrpg_demo', '1')
    }, standalone)
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(String(error)))
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' })
    if (standalone) {
      assert.equal(
        await page.locator('meta[name="apple-mobile-web-app-status-bar-style"]').getAttribute('content'),
        'default',
        'Installation must place the web viewport below the status bar; translucent mode shifts it into the blurred region',
      )
    }
    await page.getByRole('navigation', { name: 'Quick actions' }).waitFor()
    await page.getByRole('button', { name: 'Close modal', exact: true }).click()
    await page.evaluate(() => document.fonts.ready)

    const geometry = () => page.evaluate(() => {
      const box = selector => document.querySelector(selector).getBoundingClientRect().toJSON()
      const scroll = document.querySelector('.gf-main .overflow-y-auto')
      return {
        viewport: { width: innerWidth, height: innerHeight },
        root: box('#app'), shell: box('.gf-shell'), main: box('.gf-main'),
        top: box('[aria-label="Quick actions"]'), bottom: box('[aria-label="Menu"]'),
        firstButton: box('[aria-label="Quick actions"] button'),
        lastButton: box('[aria-label="Menu"] button'),
        scrollPadding: scroll ? getComputedStyle(scroll).paddingBottom : null,
        documentHeight: document.documentElement.scrollHeight,
      }
    })
    const check = async (topInset = 0, bottomInset = 0) => {
      const g = await geometry()
      // WebKit rounds viewport units to fractional CSS pixels at high DPR.
      assert.equal(Math.round(g.root.height), g.viewport.height, 'App fills the visible viewport')
      assert.equal(Math.round(g.shell.bottom), g.viewport.height, 'Wooden frame reaches the bottom edge')
      assert.ok(g.firstButton.top >= topInset + 8, 'Top buttons and their rings clear the status-bar edge')
      assert.ok(g.lastButton.bottom <= g.viewport.height - bottomInset, 'Bottom buttons clear the home indicator')
      assert.ok(g.main.height > 0 && g.main.top >= g.top.bottom && g.main.bottom <= g.bottom.top, 'Both rails leave usable content space')
      assert.equal(g.documentHeight, g.viewport.height, 'Only screen contents scroll, not the document')
      assert.deepEqual(errors, [], 'App boots without browser errors')
      console.log(`${browserName} standalone=${standalone} ${g.viewport.width}x${g.viewport.height} insets=${topInset}/${bottomInset}: PASS`)
      return g
    }
    const initial = await check()
    assert.equal(await page.locator('.pwa-status-bar').isVisible(), standalone, 'The status-bar colour sampler is limited to installed iOS apps')
    if (screenshots) await page.screenshot({ path: resolve(screenshots, `${browserName}-${standalone}-zero-inset.png`) })
    const cdp = browserName === 'chromium' ? await context.newCDPSession(page) : null
    if (browserName === 'chromium') {
      await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 59, bottom: 34, left: 0, right: 0 } })
      await page.evaluate(() => new Promise(requestAnimationFrame))
      const notched = await check(59, 34)
      assert.equal(notched.scrollPadding, initial.scrollPadding, 'Scroll content does not repeat the bottom rail safe area')
      if (screenshots) await page.screenshot({ path: resolve(screenshots, `${browserName}-${standalone}-notched.png`) })
      await page.setViewportSize({ width: 744, height: 390 })
      await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, bottom: 21, left: 44, right: 44 } })
      await page.evaluate(() => new Promise(requestAnimationFrame))
      const landscape = await check(0, 21)
      assert.ok(landscape.main.left >= 44 && landscape.main.right <= 700, 'Landscape content clears the notch on both sides')
      await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, bottom: 0, left: 0, right: 0 } })
    }
    await page.setViewportSize({ width: 320, height: 568 })
    await check()
    await page.getByRole('navigation', { name: 'Quick actions' }).getByRole('button', { name: 'Equip', exact: true }).click()
    await page.getByRole('heading', { name: 'Equipment', exact: true }).waitFor()
    await page.getByRole('navigation', { name: 'Menu' }).getByRole('button', { name: 'Home', exact: true }).click()
    if (standalone) {
      // Model the available web window after iOS reserves the 59px status bar.
      // This checks the page inside that window, not the native compositor.
      await page.setViewportSize({ width: 390, height: 785 })
      const bottomInset = cdp ? 34 : 0
      if (cdp) await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, bottom: bottomInset, left: 0, right: 0 } })
      await page.evaluate(() => new Promise(requestAnimationFrame))
      await check(0, bottomInset)
      const sampler = await page.locator('.pwa-status-bar').boundingBox()
      assert.ok(sampler && sampler.y === 0 && sampler.height === 1 && sampler.width === 390, 'An opaque status-bar colour sampler spans the viewport without taking layout space')
      const samplerStyle = await page.locator('.pwa-status-bar').evaluate(element => {
        const style = getComputedStyle(element)
        return { pointerEvents: style.pointerEvents, background: style.backgroundColor, opacity: style.opacity }
      })
      assert.deepEqual(samplerStyle, { pointerEvents: 'none', background: 'rgb(36, 24, 17)', opacity: '1' }, 'The sampler is opaque and cannot intercept taps')

      // Disposable demo data reproduces the player's Firemaking screen without
      // signing in or touching a cloud character.
      await page.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('PocketRPG', 1)
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        await new Promise((resolve, reject) => {
          const transaction = db.transaction(['stats', 'bank'], 'readwrite')
          transaction.objectStore('stats').put({ skill: 'firemaking', xp: 273742, level: 60 }, 'firemaking')
          transaction.objectStore('bank').put({ itemId: 'yew_logs', quantity: 10000 }, 'yew_logs')
          transaction.oncomplete = resolve
          transaction.onerror = () => reject(transaction.error)
        })
        db.close()
        localStorage.setItem('pocketrpg_theme', 'dark')
      })
      await page.reload({ waitUntil: 'load' })
      await page.getByRole('button', { name: 'Firemaking, level 60', exact: true }).click()
      await page.getByRole('button', { name: 'Skill Actions' }).click()
      await page.getByRole('button', { name: /Burn yew logs/ }).click()
      await page.getByRole('button', { name: 'Stop & Back', exact: true }).waitFor()
      await page.evaluate(() => document.fonts.ready)
      const active = await check(0, bottomInset)
      const stop = await page.getByRole('button', { name: 'Stop & Back', exact: true }).boundingBox()
      assert.ok(stop && stop.y + stop.height <= active.bottom.top, 'The action stop control stays above the bottom navigation')
      if (screenshots) await page.screenshot({ path: resolve(screenshots, `${browserName}-firemaking-installed-window.png`) })
      await page.getByRole('button', { name: 'Stop & Back', exact: true }).click()
      if (cdp) await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, bottom: 0, left: 0, right: 0 } })
    }
    await page.setViewportSize({ width: 1280, height: 800 })
    assert.equal(await page.locator('.pwa-status-bar').isVisible(), false, 'Desktop does not render the iOS colour sampler')
    assert.equal(await page.getByRole('navigation', { name: 'Quick actions' }).isVisible(), false, 'Desktop keeps its own navigation')
    const desktop = await geometry()
    assert.equal(Math.round(desktop.root.height), 800, 'Desktop app fills the resized viewport')
    assert.equal(Math.round(desktop.shell.bottom), 800, 'Desktop shell reaches the bottom edge')
    assert.deepEqual(errors, [], 'Navigation and resizing produce no browser errors')
    await context.close()
  }
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
