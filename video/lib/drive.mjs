/**
 * The action vocabulary a recipe's scenes compile down to.
 *
 * Selector rule: target the ACCESSIBLE NAME via getByRole, never visible text.
 * PocketRPG's nav buttons label themselves with visually-hidden text, so
 * Playwright's `hasText` (which matches rendered text) misses every one of
 * them — a mistake that fails as a 30s timeout, not an error.
 *
 * Every failure here throws. A recipe that cannot find its target must stop the
 * render, because the alternative is silently filming the wrong screen and
 * shipping it as a capture bug.
 */
import { applySeed } from './seed.mjs'
import { installOverlay, setCaption, setHook } from './overlay.mjs'

const CLICK_TIMEOUT = 8000

/** Boot the app into demo mode with the overlay installed. */
export async function bootDemo(page, url, overlayOpts = {}) {
  await page.goto(url, { waitUntil: 'networkidle' })
  await enterDemo(page)
  await installOverlay(page, overlayOpts)
}

/** Enter the accountless demo from the public landing page while recording. */
export async function enterDemo(page) {
  await page.getByText('Play Demo', { exact: true }).first().click({ timeout: 15000 })
  await waitForGame(page)
}

/** Wait for the game chunk to finish booting, then clear any welcome modal. */
export async function waitForGame(page) {
  // The lazy game chunk lands after cloudPhase flips; the skills grid is the
  // first thing that only exists once it has.
  await page.getByRole('button', { name: 'Home' }).first().waitFor({ state: 'visible', timeout: 30000 })
  await dismissModals(page)
}

export async function dismissModals(page) {
  for (let i = 0; i < 3; i++) {
    const close = page.locator('button:visible', { hasText: /^✕$/ }).first()
    if (!(await close.isVisible().catch(() => false))) break
    await close.click().catch(() => {})
    await page.waitForTimeout(300)
  }
}

/** Click a control by accessible name. */
export async function click(page, name) {
  const target = page.getByRole('button', { name, exact: false }).first()
  await target.click({ timeout: CLICK_TIMEOUT })
}

/**
 * Click by visible text. Needed because parts of this UI hang onClick on a
 * plain div with no role — the mobile monster rows (`cb-mon`) are the ones that
 * matter here — so getByRole cannot see them. The click lands on the text node
 * and bubbles to whichever ancestor owns the handler.
 */
export async function clickText(page, text) {
  await page.getByText(text, { exact: false }).first().click({ timeout: CLICK_TIMEOUT })
}

/**
 * Jump the character forward mid-recipe. This is what makes a progression
 * montage possible: seed, reload, and the app boots at the new state. The
 * reload destroys the overlay, so it is reinstalled and the visible text
 * restored before returning.
 */
export async function reseed(page, url, spec, { caption = null, hook = null, overlay = {} } = {}) {
  await applySeed(page, spec)
  await page.goto(url, { waitUntil: 'networkidle' })
  await waitForGame(page)
  await installOverlay(page, overlay)
  if (hook) await setHook(page, hook)
  if (caption) await setCaption(page, caption)
}

export async function scroll(page, deltaY = 400) {
  await page.mouse.wheel(0, deltaY)
}

/** Execute one scene. Returns nothing; throws on any failure. */
export async function runScene(page, scene, ctx) {
  switch (scene.action) {
    case 'nav':
    case 'click':
      await click(page, scene.target)
      break
    case 'text':
      await clickText(page, scene.target)
      break
    case 'back':
      await click(page, '← Back')
      break
    case 'scroll':
      await scroll(page, scene.deltaY ?? 400)
      break
    case 'reseed':
      await reseed(page, ctx.url, scene.seed, { caption: scene.caption, hook: ctx.hook, overlay: ctx.overlay })
      break
    case 'demo':
      await enterDemo(page)
      break
    case 'hold':
      break
    default:
      throw new Error(`drive: unhandled action '${scene.action}'`)
  }
}
