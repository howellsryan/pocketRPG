#!/usr/bin/env node
// Assembles dist_site/ — everything the Worker serves as a static asset.
//
// Pages deployed the repository root (`pages_build_output_dir = "."`) and
// excluded a couple of directories via .assetsignore. A Worker's asset
// directory is uploaded whole with nothing excluded for it, so the set has to
// be named rather than filtered: node_modules alone would blow the 20,000-file
// limit. Anything the site serves must be listed in ROOT_ASSETS below.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'dist_site')

/** Files and directories served at the site root, exactly as Pages served them.
 * `_headers` is honoured by Workers static assets too, so the cache rules move
 * across unchanged rather than being reimplemented in the Worker. */
const ROOT_ASSETS = [
  'index.html',
  'public',
  'robots.txt',
  'sitemap.xml',
  'manifest.json',
  'hosted.html',
  '_headers',
  'guide',
]

/** The open-world client, staged under the prefix its Vite `base` emits. One
 * Worker has one assets directory, so the two builds share it by prefix and
 * worker/worldHost.js maps the world hostname onto this one. */
const WORLD_SOURCE = join(root, 'world', 'client', 'dist')
const WORLD_PREFIX = 'world'

function stage() {
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })

  for (const name of ROOT_ASSETS) {
    const from = join(root, name)
    if (!existsSync(from)) {
      throw new Error(`stage-site: missing ${name} — run \`npm run rebuild\` and \`npm run gen:guide\` first`)
    }
    cpSync(from, join(out, name), { recursive: true })
  }

  // Content-hashed, so its name is only known after the build.
  const chunks = readdirSync(root).filter((f) => /^game-[A-Za-z0-9]+\.js$/.test(f))
  if (chunks.length === 0) {
    throw new Error('stage-site: no game-<hash>.js at the repo root — run `npm run rebuild` first')
  }
  for (const chunk of chunks) copyFileSync(join(root, chunk), join(out, chunk))

  if (existsSync(WORLD_SOURCE)) {
    cpSync(WORLD_SOURCE, join(out, WORLD_PREFIX), { recursive: true })
  } else {
    console.warn('stage-site: world/client/dist absent — the open world will 404. Run `npm --prefix world run build`.')
  }

  console.log(`dist_site: ${ROOT_ASSETS.length} root entries, ${chunks.length} game chunk(s)`)
}

stage()
