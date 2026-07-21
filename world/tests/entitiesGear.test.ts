// Regression: the arena registry's *_full_helm.glb exports are
// meshopt-compressed (EXT_meshopt_compression). GLTFLoader throws
// "setMeshoptDecoder must be called before loading compressed files" without
// it configured, and entities.ts's applyRigidGearPiece swallows any load
// failure into "leave the slot bare" (appearance must never block play) — so
// every equipped helmet silently failed to render in the open world while
// capes/shields/weapons (none of which are meshopt-compressed) worked fine.
// This drives the actual production loader (entities.ts's loadTemplate) with
// a mocked fetch serving the real compressed asset, so a regression here (the
// setMeshoptDecoder call getting dropped again) fails loudly instead of
// silently leaving heads bare.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { loadTemplate } from '../client/src/entities'

const HELM_PATH = path.join(__dirname, '../client/public/models/equip/default_full_helm.glb')

describe('loadTemplate meshopt decoder wiring', () => {
  it('parses a real meshopt-compressed registry model (default_full_helm.glb)', async () => {
    const bytes = fs.readFileSync(HELM_PATH)
    const fetchMock = vi.fn(async () =>
      new Response(bytes, { status: 200, headers: { 'content-type': 'model/gltf-binary' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    // three's FileLoader reports download progress via a browser ProgressEvent
    // that doesn't exist in Node — a bare test-only shim, unrelated to the
    // decoder wiring under test.
    vi.stubGlobal('ProgressEvent', class { constructor(_type: string, _init?: unknown) {} })
    try {
      const gltf = await loadTemplate('http://localhost/models/equip/default_full_helm.glb')
      expect(gltf.scene.children.length).toBeGreaterThan(0)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
