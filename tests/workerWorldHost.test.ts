// One Worker serves the game and the open-world client from a single assets
// directory, so the world hostname is mapped onto the /world prefix its build
// emits. Getting this wrong is not subtle — world.pocketrpg.co.uk would serve
// the idle game's index.html — but it is invisible until a deploy.

import { describe, it, expect } from 'vitest'
import { isWorldHost, worldAssetPath, rewriteForWorldHost } from '../worker/worldHost.js'

describe('world host detection', () => {
  it('recognises the production world domain and the local dev one', () => {
    expect(isWorldHost('world.pocketrpg.co.uk')).toBe(true)
    expect(isWorldHost('world.localhost')).toBe(true)
  })

  it('leaves the game host alone', () => {
    expect(isWorldHost('pocketrpg.co.uk')).toBe(false)
    expect(isWorldHost('pocketrpg-app-preview.rlh.workers.dev')).toBe(false)
    // A host merely containing the word is not the world.
    expect(isWorldHost('underworld.pocketrpg.co.uk')).toBe(false)
  })
})

describe('mapping the world host onto the /world prefix', () => {
  const world = (path: string) => worldAssetPath('world.pocketrpg.co.uk', path)

  it('serves the client at the root of its own hostname', () => {
    // The canonical form, not /world/index.html: the asset server answers that
    // with a 307 to /world/, which drops the player off the clean world root.
    expect(world('/')).toBe('/world/')
    expect(world('/index.html')).toBe('/world/')
  })

  it('resolves the editor and preview documents without a redirect', () => {
    expect(world('/editor')).toBe('/world/editor')
    expect(world('/editor.html')).toBe('/world/editor')
    expect(world('/preview')).toBe('/world/preview')
  })

  it('prefixes any other path', () => {
    expect(world('/assets/index-abc123.js')).toBe('/world/assets/index-abc123.js')
  })

  it('does not double-prefix a path that already carries it', () => {
    // The client's Vite base emits /world/... references, so on the world
    // hostname those arrive already prefixed. Prefixing again 404s the bundle.
    expect(world('/world/assets/index-abc123.js')).toBeNull()
  })

  it('leaves the game host untouched', () => {
    expect(worldAssetPath('pocketrpg.co.uk', '/')).toBeNull()
    expect(worldAssetPath('pocketrpg.co.uk', '/world/index.html')).toBeNull()
  })
})

describe('rewriteForWorldHost', () => {
  it('rewrites the request bound for the assets binding', () => {
    const url = new URL('https://world.pocketrpg.co.uk/')
    const out = rewriteForWorldHost(new Request(url), url)
    expect(new URL(out.url).pathname).toBe('/world/')
  })

  it('preserves the query string a handoff or a zone hint rides on', () => {
    const url = new URL('https://world.pocketrpg.co.uk/preview?zone=wilderness')
    const out = rewriteForWorldHost(new Request(url), url)
    expect(new URL(out.url).pathname).toBe('/world/preview')
    expect(new URL(out.url).search).toBe('?zone=wilderness')
  })

  it('returns the original request untouched on the game host', () => {
    const url = new URL('https://pocketrpg.co.uk/public/fonts/x.woff2')
    const request = new Request(url)
    expect(rewriteForWorldHost(request, url)).toBe(request)
  })
})
