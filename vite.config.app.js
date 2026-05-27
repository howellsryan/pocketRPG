// Build config for the packaged (Capacitor) app. Produces a fully self-contained
// bundle in www/ — no CDN dependencies — so the offline-first game works inside
// a native WebView and passes offline App Review.
//
// Differences from the web vite.config.js:
//   - root = app/ (clean entry HTML, no CDN <script>/<link> tags)
//   - base = './' (assets load from capacitor://localhost, not /pocketrpg/)
//   - outputs to www/ (Capacitor's webDir)
import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: resolve(here, 'app'),
  base: './',
  plugins: [preact(), tailwindcss()],
  build: {
    outDir: resolve(here, 'www'),
    emptyOutDir: true,
  },
})
