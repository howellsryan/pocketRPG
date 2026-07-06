import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// The vendored three.js under public/vendor/three/ is loaded at runtime as a
// real ES-module graph (no bundler, no import map — see src/utils/three3d.js).
// A single missing file or leftover bare specifier fails silently in the app
// (the viewer just falls back to the paper doll), so guard the graph here.
// This caught a real bug: three.module.js imports './three.core.js', which the
// initial hand-vendoring omitted. Regenerate the vendor dir with `npm run
// sync:three` (pinned "three" devDependency), never by hand.

const VENDOR = path.resolve(__dirname, '../public/vendor/three')

// Entry modules three3d.js / 3d-preview.html actually import.
const ENTRIES = [
  'three.module.min.js',
  'jsm/loaders/GLTFLoader.js',
  'jsm/libs/meshopt_decoder.module.js',
  'jsm/controls/OrbitControls.js',
  'jsm/utils/SkeletonUtils.js',
]

function listJs(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? listJs(p) : e.name.endsWith('.js') ? [p] : []
  })
}

// Real static import/export-from specifiers (line-anchored so doc comments
// like `* @three_import import { X } from 'three/addons/...'` don't match).
function importSpecifiers(code: string): string[] {
  const out: string[] = []
  const re = /^[ \t]*(?:import|export)[^;'"]*?from[ \t]*['"]([^'"]+)['"]/gm
  for (let m; (m = re.exec(code)); ) out.push(m[1])
  const bare = /^[ \t]*import[ \t]*['"]([^'"]+)['"]/gm // side-effect imports
  for (let m; (m = bare.exec(code)); ) out.push(m[1])
  return out
}

describe('vendored three.js module graph', () => {
  it('ships every entry module', () => {
    for (const e of ENTRIES) expect(fs.existsSync(path.join(VENDOR, e)), e).toBe(true)
  })

  it('every import in the graph resolves to a vendored file (no bare specifiers)', () => {
    for (const file of listJs(VENDOR)) {
      for (const spec of importSpecifiers(fs.readFileSync(file, 'utf8'))) {
        const rel = path.relative(VENDOR, file)
        expect(spec.startsWith('.'), `${rel}: bare specifier '${spec}' cannot resolve without an import map`).toBe(true)
        const target = path.resolve(path.dirname(file), spec)
        expect(fs.existsSync(target), `${rel}: import '${spec}' -> missing file`).toBe(true)
      }
    }
  })

  it('vendored core build matches the pinned npm three (run npm run sync:three on drift)', () => {
    const npmBuild = path.resolve(__dirname, '../node_modules/three/build')
    if (!fs.existsSync(npmBuild)) return // devDeps not installed; graph checks above still ran
    for (const f of ['three.module.min.js', 'three.core.min.js']) {
      const vendored = fs.readFileSync(path.join(VENDOR, f), 'utf8')
      const npm = fs.readFileSync(path.join(npmBuild, f), 'utf8')
      expect(vendored === npm, `${f} drifted from node_modules/three — run npm run sync:three`).toBe(true)
    }
  })
})
