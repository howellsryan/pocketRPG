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
    if (screenshots) await page.screenshot({ path: resolve(screenshots, `${browserName}-${standalone}-zero-inset.png`) })
    if (browserName === 'chromium') {
      const cdp = await context.newCDPSession(page)
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
    await page.setViewportSize({ width: 1280, height: 800 })
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
