import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    fs: { allow: ['../..'] },
  },
})
