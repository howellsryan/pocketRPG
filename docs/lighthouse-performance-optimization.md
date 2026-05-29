# Lighthouse Performance Optimization Guide

> **Scope**: How to fix the render-blocking, unused-JS, and best-practice issues
> from the production Lighthouse run of https://pocketrpg.co.uk.
> **Audience**: Contributors editing the single-file build pipeline.
> **Target wins**: ~2,030 ms render-blocking savings, ~275 KiB unused JS, ~170 KiB
> minify savings, and several Best-Practices / SEO failures.

---

## 0) Why these problems exist (root cause)

Production is **not** the Vite app build — it is the concatenated single-file
artifact written to the repo root `index.html` by `build_single.cjs`
(`fs.writeFileSync(path.join(__dirname, 'index.html'), html)`). That script
builds the `<head>` by hand (around lines 221–273) and currently:

1. **Strips the real Tailwind build** — line 219 does
   `readSrc('index.css').replace('@import "tailwindcss";', '')`, throwing away
   the compiled utility classes...
2. **...then re-adds Tailwind as a runtime CDN compiler** — line 231,
   `<script src="https://cdn.tailwindcss.com">`. This ships the **entire JIT
   compiler** (124 KiB transfer, far larger unminified) and runs it on the
   client. It is the single biggest cause of *Render-blocking requests*,
   *Reduce unused JavaScript* (~275 KiB), and *Minify JavaScript* (~170 KiB).
3. **Loads fonts render-blocking** — line 230 is a synchronous
   `<link rel="stylesheet">` to Google Fonts that blocks first paint.
4. **Loads the framework as a 4-deep esm.sh chain** — lines 246–249 import
   `preact`, `preact/compat`, `preact/hooks`, and `idb` from `esm.sh`, each a
   tiny redirect file that then fetches the real `.mjs` (the *Network
   dependency tree* with 1,164 ms max critical path).

The good news: the project **already has** the right local dependencies —
`tailwindcss@4.1.3`, `@tailwindcss/vite`, `@fontsource/cinzel`,
`@fontsource/nunito`, `@fontsource/jetbrains-mono`, `preact`, and `idb` are all
in `package.json`. We are paying a CDN tax for packages we already ship in
`node_modules`. Almost every fix below is "use the local copy at build time."

---

## 1) Priority order (do these in sequence)

| # | Fix | Est. impact | Effort |
|---|-----|-------------|--------|
| 1 | Compile Tailwind at build, inline CSS, drop the CDN script | ~2,000 ms render-block + 275 KiB unused + 170 KiB minify | Medium |
| 2 | Self-host / non-block fonts (`@fontsource`), `font-display: swap` | ~600–1,160 ms of critical font latency | Medium |
| 3 | Remove esm.sh chain (bundle preact + idb) **or** preconnect + modulepreload | ~310 ms LCP + shorten critical chain | Medium / Low |
| 4 | Best Practices: remove `user-scalable=no`, add `<main>`, meta description | 3 audits | Low |
| 5 | SEO/crawl: ship a valid `robots.txt` | 1 audit | Low |
| 6 | Add explicit `width`/`height` to landing images | CLS + 1 audit | Low |

Items 1–3 are the performance score; 4–6 are quick Best-Practices/SEO points.

---

## 2) Fix #1 — Kill the Tailwind CDN (biggest win)

**Goal**: ship a small, pre-compiled CSS file instead of the runtime JIT
compiler. This removes the render-blocking script, the bulk of *unused JS*, and
the *minify JS* finding in one move.

The repo already uses Tailwind v4 (`@import "tailwindcss"` in `src/index.css`)
with `@tailwindcss/vite`. The single-file build just needs to run the compiler
itself instead of deferring to the browser.

### Recommended approach: compile with the Tailwind CLI in `build_single.cjs`

1. Add the Tailwind CLI as the compile step (v4 ships `@tailwindcss/cli`). In
   `package.json` scripts, add a CSS build that runs before the concat:
   ```jsonc
   "build:css": "tailwindcss -i ./src/index.css -o ./.tmp/app.css --minify",
   ```
   Point Tailwind's content scanning at the source so it only emits classes the
   app actually uses (Tailwind v4 auto-detects, but pin it via `@source` in
   `index.css` if needed: `@source "./src/**/*.{js,jsx}";`).

2. In `build_single.cjs`, replace the strip-and-CDN logic:
   ```js
   // BEFORE (line ~219 + ~231)
   const css = readSrc('index.css').replace('@import "tailwindcss";', '').trim();
   // ...later... <script src="https://cdn.tailwindcss.com"></script>

   // AFTER
   const css = fs.readFileSync(path.join(__dirname, '.tmp/app.css'), 'utf8').trim();
   // and DELETE the cdn.tailwindcss.com <script> + the tailwind.config <script>
   ```
   The compiled CSS already contains your custom `:root` variables and
   `@utility` rules from `index.css`, so the inlined `<style>${css}</style>`
   stays as the only style source.

3. Port the runtime config. The current inline config sets
   `future: { hoverOnlyWhenSupported: true }`. In Tailwind v4 this is the
   **default** (hover only applies under `@media (hover: hover)`), so the
   `tailwind.config` script can simply be deleted. Verify hover states don't
   stick on touch after the change.

4. Wire it into the pipeline so `npm run rebuild` produces a CDN-free file:
   ```jsonc
   "rebuild": "npm run build:css && tsc --project tsconfig.build.json && node build_single.cjs",
   ```

### Verification
- `npm run rebuild && npm run check:single` must pass.
- `grep cdn.tailwindcss.com index.html` returns **nothing**.
- Open the built `index.html` and confirm styling is intact (landing,
  combat, inventory, stats screens).
- The inlined `<style>` should be a few tens of KiB of *used* utilities, not the
  124 KiB compiler.

> ⚠️ This is purely a build-pipeline change; no gameplay logic is touched, so
> the logic test suite is unaffected — but still run the full commit gate
> (`npm test && npm run build && npm run rebuild && npm run check:single`).

---

## 3) Fix #2 — Fonts: stop blocking first paint

Currently (line 229–230):
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cinzel...&display=swap" rel="stylesheet">
```
The stylesheet `<link>` is render-blocking, and the two `.woff2` files sit at
the **end** of the 1,164 ms critical chain (39 KiB + 26 KiB from
`fonts.gstatic.com`).

Pick **one** of the following. Option A is best for an offline-first app.

### Option A — Self-host via `@fontsource` (recommended, offline-friendly)
The `@fontsource/cinzel`, `@fontsource/nunito`, and `@fontsource/jetbrains-mono`
packages are already installed. Their `.woff2` files live in
`node_modules/@fontsource/*/files/`.

1. In `build_single.cjs`, read the needed weights' `.woff2` files, base64-encode
   them, and emit `@font-face` rules with inline `data:` URLs (or copy them to
   `public/fonts/` and reference relative paths if you prefer to avoid base64
   bloat). Use only the weights the CSS actually needs:
   - Cinzel 400/700/900 (`--font-display`)
   - Nunito 400/600/700 (`--font-body`)
   - JetBrains Mono 400/700 (`--font-mono`)
2. Every `@font-face` must include `font-display: swap;` so text renders
   immediately in a fallback and swaps when the font arrives.
3. Delete both Google Fonts `<link>` tags. This removes `fonts.googleapis.com`
   and `fonts.gstatic.com` from the critical path entirely.

> Trade-off: inlining ~5 weights as base64 adds to the HTML size. Prefer subset
> `.woff2` (Latin only) and consider copying to `public/fonts/` + `preload`
> instead of base64 if the HTML grows too large. For a menu-driven RPG with a
> known glyph set, Latin subset is plenty.

### Option B — Keep Google Fonts but make it non-blocking
If you must keep the CDN, at minimum:
1. Add the missing preconnect for the file host:
   ```html
   <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
   ```
2. Load the stylesheet asynchronously so it doesn't block paint:
   ```html
   <link rel="preload" as="style"
     href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700;900&family=Nunito:wght@400;600;700&family=JetBrains+Mono:wght@400;700&display=swap"
     onload="this.onload=null;this.rel='stylesheet'">
   <noscript><link rel="stylesheet" href="...same..."></noscript>
   ```
The `display=swap` param is already present; keep it.

### Verification
- DevTools → Network: no render-blocking request to `fonts.googleapis.com`.
- Text is visible during load (fallback), then swaps — no invisible-text FOIT.

---

## 4) Fix #3 — Remove the esm.sh dependency chain

Lines 246–249 import the framework from `esm.sh`. Lighthouse flags this twice:
*Network dependency tree* (each esm.sh URL is a redirect stub that fetches a
second `.mjs`, doubling round-trips) and *Preconnect candidates* (esm.sh, ~310 ms).

### Option A — Bundle preact + idb into the single file (recommended)
`preact` and `idb` are already dependencies. Resolve them from `node_modules` at
build time and inline them so the app has **zero** third-party module requests:
- Easiest: add a tiny pre-bundle step (esbuild/Vite) that emits an IIFE/ESM
  bundle of `{ h, render, Fragment, createContext, Component, createPortal,
  useState, useEffect, useRef, useMemo, useCallback, useContext, openDB }`, then
  inline that bundle into the `<script type="module">` ahead of `${allJS}` in
  `build_single.cjs`. Replace the four `import ... from 'https://esm.sh/...'`
  lines with the local symbols.
- This makes the app fully self-contained and offline-capable on first load —
  aligned with the project's offline-first goal.

### Option B — Keep esm.sh but shorten the chain (low effort)
If bundling is out of scope right now:
1. Add the preconnect Lighthouse asked for:
   ```html
   <link rel="preconnect" href="https://esm.sh" crossorigin>
   ```
2. Add `modulepreload` hints for the **resolved** `.mjs` files so the browser
   fetches them in parallel instead of discovering them via redirect:
   ```html
   <link rel="modulepreload" href="https://esm.sh/es2022/preact.mjs">
   <link rel="modulepreload" href="https://esm.sh/es2022/hooks.mjs">
   <link rel="modulepreload" href="https://esm.sh/es2022/compat.mjs">
   <link rel="modulepreload" href="https://esm.sh/es2022/idb.mjs">
   ```
   (Use pinned esm.sh URLs that include the version + build target so they don't
   churn.)

Keep total preconnect hints to **≤ 4** origins (Lighthouse guidance).

---

## 5) Fix #4 — Best Practices (quick wins in `build_single.cjs` head)

These are in the hand-written head block (and mirrored in `src/index.html`).

1. **Remove `user-scalable=no`** (accessibility failure). Change line 225 /
   `src/index.html` line 5:
   ```html
   <!-- BEFORE -->
   <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no">
   <!-- AFTER -->
   <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
   ```
   Low-vision users rely on pinch-zoom. If accidental zoom during gameplay is a
   concern, handle it on specific interactive elements with `touch-action`
   rather than disabling zoom globally.

2. **Add a `<main>` landmark.** The app mounts into `<div id="app">`. Either
   render the top-level screen wrapper as `<main>` in the Preact tree, or change
   the mount node to `<main id="app">` in both `build_single.cjs` (line 244) and
   `src/index.html` (line 11). Ensure there is exactly one `<main>`.

3. **Add a meta description** (SEO audit) to the head:
   ```html
   <meta name="description" content="PocketRPG — a menu-driven idle fantasy RPG. Train skills, fight monsters, and grow your character, fully offline.">
   ```

> Apply each head change in **both** `build_single.cjs` (the production
> artifact) and `src/index.html` (the Vite dev template) so dev and prod match.

---

## 6) Fix #5 — Valid `robots.txt`

Lighthouse couldn't download `robots.txt`. Add one to `public/` so it ships at
the site root:

`public/robots.txt`
```
User-agent: *
Allow: /

Sitemap: https://pocketrpg.co.uk/sitemap.xml
```
Only reference a sitemap line if you actually publish one; otherwise drop it.
Confirm the deploy (Cloudflare/`wrangler.toml`) serves `/robots.txt` with
`Content-Type: text/plain` and a 200.

---

## 7) Fix #6 — Explicit image dimensions

*"Image elements do not have explicit width and height"* causes layout shift.
The landing screenshots come from `src/screens/landingImages.js` /
`public/landing/*.webp` and the logo from `src/utils/homeLogo.js`, rendered in
`LandingScreen.jsx` / `DesktopLandingScreen.jsx`.

For each `<img>` in those screens, add the intrinsic `width` and `height`
attributes (the browser reserves space before the image loads, preventing CLS).
Keep CSS responsive sizing via `style`/classes; the attributes only set the
aspect ratio. Also add `loading="lazy"` to below-the-fold screenshots and
`decoding="async"`.

---

## 8) Notes on items you can't fully control

- **Cloudflare beacon cache TTL (`/beacon.min.js`, ~5 KiB)** — this is injected
  by Cloudflare Web Analytics and served with a 1-day TTL by Cloudflare, not by
  us. If the 5 KiB savings matters more than the analytics, disable Cloudflare
  Web Analytics for the zone; otherwise it's safe to ignore.
- **Long main-thread tasks** — most of these disappear once the Tailwind CDN
  compiler (Fix #1) stops running in the browser. Re-measure after Fix #1 before
  doing further main-thread work.

---

## 9) Definition of done / verification checklist

Run the full commit gate after changes:
```
npm test && npm run build && npm run rebuild && npm run check:single
```
Then confirm against the built `index.html`:

- [ ] `grep cdn.tailwindcss.com index.html` → no matches (Fix #1)
- [ ] Inlined `<style>` is compiled utilities, not the JIT compiler
- [ ] No render-blocking `fonts.googleapis.com` stylesheet (Fix #2)
- [ ] All `@font-face` use `font-display: swap`
- [ ] No `esm.sh` chain, or preconnect + modulepreload present (Fix #3)
- [ ] No `user-scalable=no`; exactly one `<main>`; meta description present (Fix #4)
- [ ] `public/robots.txt` ships and returns 200 (Fix #5)
- [ ] Landing/logo `<img>` have explicit `width`/`height` (Fix #6)
- [ ] Head changes mirrored in both `build_single.cjs` and `src/index.html`
- [ ] Re-run Lighthouse on a preview deploy; confirm render-blocking and
      unused-JS savings dropped and Best-Practices/SEO audits pass

> Per `CLAUDE.md`: the root `index.html` is a build artifact. Land the
> **source** changes (`build_single.cjs`, `src/index.css`, `src/index.html`,
> `package.json`, `public/robots.txt`) and let the build regenerate
> `index.html`; don't hand-edit the generated file.
