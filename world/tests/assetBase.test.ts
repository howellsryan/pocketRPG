import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { withAssetBase } from '../client/src/assetBase'

describe('withAssetBase', () => {
  it('prefixes a root-absolute model path with the deployment base', () => {
    expect(withAssetBase('/world/', '/models/hero.glb')).toBe('/world/models/hero.glb')
  })

  it('is idempotent, so a path that already carries the base is untouched', () => {
    expect(withAssetBase('/world/', '/world/models/hero.glb')).toBe('/world/models/hero.glb')
  })

  it('leaves paths alone when served from the root', () => {
    expect(withAssetBase('/', '/models/hero.glb')).toBe('/models/hero.glb')
  })

  it('ignores anything not root-absolute', () => {
    expect(withAssetBase('/world/', 'data:model/gltf-binary;base64,AAA')).toBe('data:model/gltf-binary;base64,AAA')
    expect(withAssetBase('/world/', 'https://cdn.example/hero.glb')).toBe('https://cdn.example/hero.glb')
  })
})

// The bug this guards: off the world hostname (the preview deployment, which
// reaches the world at /world/ on a shared host) nothing rewrites an unprefixed
// path, so every GLB 404s and the hero renders without its model or gear.
describe('model loads go through modelUrl', () => {
  const dir = join(__dirname, '..', 'client', 'src')

  function sources(root: string): string[] {
    return readdirSync(root, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? sources(join(root, e.name)) : e.name.endsWith('.ts') ? [join(root, e.name)] : [],
    )
  }

  // loadTemplate is itself a choke point that prefixes internally, so a logical
  // /models/ path is correct there. A raw loader call has nothing in front of it.
  it('never hands a bare /models/ path straight to a loader', () => {
    const offenders = sources(dir).filter((file) =>
      /loadAsync\(\s*[`'"]\/models\//.test(readFileSync(file, 'utf-8')),
    )
    expect(offenders).toEqual([])
  })
})
