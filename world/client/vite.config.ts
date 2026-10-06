import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root,
  esbuild: {jsx: 'automatic', jsxImportSource: 'preact'},
  // The world ships from the same Worker as the game, staged into
  // dist_site/world/ (scripts/stage-site.mjs). Every emitted reference has to
  // carry the prefix, because one Worker has one assets directory and the
  // world hostname is mapped onto this path (worker/worldHost.js) rather than
  // getting a root of its own.
  base: '/world/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        editor: fileURLToPath(new URL('./editor.html', import.meta.url)),
        preview: fileURLToPath(new URL('./preview.html', import.meta.url)),
      },
    },
  },
  server: {
    fs: { allow: ['../..'] },
  },
})
