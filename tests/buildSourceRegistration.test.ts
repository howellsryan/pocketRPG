import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

// The single-file build concatenates exactly the modules listed in
// build_single.cjs `sourceFiles` (imports are stripped; bindings resolve via
// the shared classic-script lexical env). A registered module that statically
// imports an UNREGISTERED sibling ships a bundle where that binding simply
// does not exist — no build error, just a runtime ReferenceError when the
// code path first runs (this is how src/3d/rigs.js silently broke the 3D
// combat arena). This test closes that gap: every static relative import of
// every registered module must itself be registered.

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'src')

function parseSourceFiles(): string[] {
  const build = readFileSync(path.join(ROOT, 'build_single.cjs'), 'utf-8')
  const m = build.match(/const sourceFiles = \[([\s\S]*?)\n\];/)
  if (!m) throw new Error('could not locate sourceFiles array in build_single.cjs')
  return [...m[1].matchAll(/'([^']+)'/g)].map((e) => e[1])
}

// Registry entries name dist_tmp outputs (always .js); source may be .js/.jsx/.ts/.tsx.
function srcPathFor(entry: string): string | null {
  const stem = entry.replace(/\.js$/, '')
  for (const ext of ['.js', '.jsx', '.ts', '.tsx']) {
    const p = path.join(SRC, stem + ext)
    if (existsSync(p)) return p
  }
  return null
}

// Modules whose bindings build_single.cjs injects as generated globals
// instead of concatenating the source file (imports of them are stripped).
const INJECTED_MODULES = new Set(['screens/landingImages', 'utils/homeLogo'])

function staticRelativeImports(filePath: string): string[] {
  const code = readFileSync(filePath, 'utf-8')
  const specs: string[] = []
  for (const m of code.matchAll(/^\s*(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]/gm)) {
    if (m[1].startsWith('.')) specs.push(m[1])
  }
  return specs
}

describe('single-file build source registration', () => {
  const sourceFiles = parseSourceFiles()
  const registered = new Set(sourceFiles.map((e) => e.replace(/\.[jt]sx?$/, '')))

  it('lists only files that exist under src/', () => {
    const missing = sourceFiles.filter((e) => !srcPathFor(e))
    expect(missing, 'sourceFiles entries with no matching src file').toEqual([])
  })

  it('every static relative import of a registered module is itself registered', () => {
    const problems: string[] = []
    for (const entry of sourceFiles) {
      const file = srcPathFor(entry)
      if (!file) continue
      for (const spec of staticRelativeImports(file)) {
        if (/\.(json|css|svg|png)$/.test(spec)) continue // JSON/data injected as globals; assets never concatenated
        const resolved = path
          .relative(SRC, path.resolve(path.dirname(file), spec))
          .split(path.sep)
          .join('/')
          .replace(/\.[jt]sx?$/, '')
        if (INJECTED_MODULES.has(resolved)) continue
        if (!registered.has(resolved)) {
          problems.push(`${entry} imports ${spec} -> ${resolved} which is not in build_single.cjs sourceFiles`)
        }
      }
    }
    expect(problems).toEqual([])
  })
})
