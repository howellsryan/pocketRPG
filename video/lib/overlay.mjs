/**
 * Caption and hook overlay, rendered INSIDE the page rather than burned on by
 * ffmpeg.
 *
 * The page already has the game's fonts loaded, so captions come out in Grenze
 * Gotisch / Spectral on the real palette instead of whatever TTF happens to sit
 * in a container's font path — on-brand for free, and it keeps ffmpeg a pure
 * encoder (no drawtext escaping, no font shipping). The tradeoff is that text
 * is baked into the capture, so changing copy means re-recording; re-recording
 * is automated and cheap.
 *
 * The overlay is video furniture, never a game surface: it is injected at
 * capture time into a throwaway browser and is not part of the §12 build.
 * Positions come from video/lib/recipe.mjs's safe box so nothing lands under
 * TikTok's own UI.
 */
import { SAFE_ZONE } from './recipe.mjs'

/**
 * `zone` and the font sizes are expressed in FRAME pixels (the 1080x1920 the
 * video is encoded at), but CSS inside the page is in CSS pixels — the two
 * differ by deviceScaleFactor. Everything is divided by `scale` on the way in;
 * getting this wrong puts the hook in the middle of the screen at triple size.
 */
export async function installOverlay(page, { zone = SAFE_ZONE, scale = 1, captionSize = 52, hookSize = 76 } = {}) {
  await page.evaluate(({ z, s, capPx, hookPx }) => {
    if (document.getElementById('pr-video-overlay')) return
    const style = document.createElement('style')
    style.textContent = `
      /* The overlay sits above the whole app, so every node in it must be
         click-through or it silently eats the taps the recipe is driving. */
      #pr-video-overlay, #pr-video-overlay * {
        pointer-events: none !important;
      }
      #pr-video-overlay {
        position: fixed; inset: 0; z-index: 2147483647;
        font-family: var(--font-display, 'Cinzel', serif);
      }
      #pr-video-overlay .pr-cap {
        position: absolute; left: ${z.left / s}px; right: ${z.right / s}px;
        bottom: ${z.bottom / s}px;
        text-align: center; opacity: 0; transition: opacity 220ms ease;
      }
      #pr-video-overlay .pr-cap.is-on { opacity: 1; }
      #pr-video-overlay .pr-cap span {
        display: inline-block; padding: 0.42em 0.7em;
        font-size: ${capPx / s}px; line-height: 1.25; font-weight: 700;
        color: var(--color-parchment, #f5e6c8);
        background: rgba(15, 15, 15, 0.86);
        border: ${Math.max(1, 3 / s)}px solid var(--color-gold-dim, #8b6914);
        border-radius: ${14 / s}px;
        text-shadow: 0 2px 6px rgba(0, 0, 0, 0.9);
      }
      #pr-video-overlay .pr-hook {
        position: absolute; left: ${z.left / s}px; right: ${z.right / s}px; top: ${z.top / s}px;
        text-align: center; opacity: 0; transition: opacity 220ms ease;
      }
      #pr-video-overlay .pr-hook.is-on { opacity: 1; }
      #pr-video-overlay .pr-hook span {
        display: inline-block; padding: 0.3em 0.6em;
        font-size: ${hookPx / s}px; line-height: 1.15; font-weight: 700;
        color: var(--color-gold-light, #f0c040);
        background: rgba(15, 15, 15, 0.7);
        border-radius: ${12 / s}px;
        text-shadow: 0 ${3 / s}px 0 #0f0f0f, 0 0 ${18 / s}px rgba(0, 0, 0, 0.95);
      }
    `
    const root = document.createElement('div')
    root.id = 'pr-video-overlay'
    root.innerHTML = '<div class="pr-hook"><span></span></div><div class="pr-cap"><span></span></div>'
    document.documentElement.appendChild(style)
    document.documentElement.appendChild(root)
  }, { z: zone, s: scale, capPx: captionSize, hookPx: hookSize })
}

/** Show a caption, or clear it when text is null. */
export async function setCaption(page, text) {
  await page.evaluate((t) => {
    const el = document.querySelector('#pr-video-overlay .pr-cap')
    if (!el) return
    if (t) { el.querySelector('span').textContent = t; el.classList.add('is-on') }
    else el.classList.remove('is-on')
  }, text ?? null)
}

/** Show the persistent hook line (the scroll-stopper), or clear it. */
export async function setHook(page, text) {
  await page.evaluate((t) => {
    const el = document.querySelector('#pr-video-overlay .pr-hook')
    if (!el) return
    if (t) { el.querySelector('span').textContent = t; el.classList.add('is-on') }
    else el.classList.remove('is-on')
  }, text ?? null)
}
