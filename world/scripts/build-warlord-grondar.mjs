#!/usr/bin/env node
// Builds world/client/public/models/warlord_grondar.glb from the arena's
// full-detail boss model (public/3d-samples/monsters/warlord_grondar.glb).
//
// Same shape as build-monster.mjs — rename the clips to the protocol's anim
// states (§5 EntityDiff.anim) and drop the rest — plus a decimation pass the
// other monsters don't need. Grondar is the only world monster in the tens of
// thousands of triangles, and characters render with `frustumCulled = false`
// and `castShadow = true` (entities.ts), so every triangle is paid twice a
// frame (main pass + shadow pass) whether or not he is on screen. The arena
// keeps the full-detail source: it draws one monster on a fixed camera, the
// open world draws him alongside a zone.
//
// The registry bounds in world/shared/monsterModels.ts are printed below —
// decimation leaves the skeleton and bind pose alone, so they should not move.
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { prune, dedup, resample, simplify, weld, getBounds } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const worldDir = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = path.join(worldDir, '..')
const SRC = path.join(repoRoot, 'public', '3d-samples', 'monsters', 'warlord_grondar.glb')
const OUT = path.join(worldDir, 'client', 'public', 'models', 'warlord_grondar.glb')

// No locomotion clip — makeAnimator aliases walk to idle (noLocomotionClip).
const CLIPS = [
  { clip: 'Idle', as: 'idle' },
  { clip: 'Attack', as: 'attack' },
  { clip: 'Death', as: 'die' },
]

// Fraction of the source triangles to keep. `error` is the cap on how far the
// simplifier may move the surface (fraction of the mesh's extent), so silhouette
// error stays bounded even if the ratio alone would push it further.
const TARGET_RATIO = 0.14
const MAX_ERROR = 0.008

await MeshoptDecoder.ready
await MeshoptSimplifier.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })

const doc = await io.read(SRC)

const keep = new Map()
for (const anim of doc.getRoot().listAnimations()) {
  const name = anim.getName()
  const spec = CLIPS.find(({ clip }) => name === clip || name.endsWith(`|${clip}`))
  if (spec && !keep.has(spec.as)) {
    keep.set(spec.as, anim)
  } else {
    for (const channel of anim.listChannels()) channel.dispose()
    for (const sampler of anim.listSamplers()) sampler.dispose()
    anim.dispose()
  }
}
for (const { as } of CLIPS) {
  if (!keep.has(as)) throw new Error(`clip for '${as}' not found in ${SRC}`)
}
for (const [as, anim] of keep) anim.setName(as)

const triangles = () => doc.getRoot().listMeshes()
  .flatMap((m) => m.listPrimitives())
  .reduce((sum, p) => sum + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')?.getCount() ?? 0) / 3, 0)

const before = triangles()
// weld first — simplify needs shared vertices to collapse across, and the
// source ships split verts from the authoring tool.
await doc.transform(
  resample(),
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: TARGET_RATIO, error: MAX_ERROR }),
  dedup(),
  prune(),
)
const after = triangles()

await io.write(OUT, doc)
const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]
const b = getBounds(scene)
console.log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KiB)`)
console.log(`  triangles ${Math.round(before)} -> ${Math.round(after)} (${((after / before) * 100).toFixed(1)}%)`)
console.log(`  clips ${[...keep.keys()].join(', ')}`)
console.log(`  bounds min [${b.min.map((v) => v.toFixed(3))}] max [${b.max.map((v) => v.toFixed(3))}]`)
