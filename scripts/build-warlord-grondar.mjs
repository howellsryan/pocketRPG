#!/usr/bin/env node
// Builds the Warlord Grondar boss GLBs from assets/open-world/Warlord+Grondar.glb
// (a ~75 MB / 1.87 M-triangle authored orc with three clips) for BOTH render
// surfaces, replacing the procedural blend-shell creature (src/data/creatures3d.json
// warlord_grondar) that stood in before:
//   • public/3d-samples/monsters/warlord_grondar.glb  — the combat arena
//     (CombatArena3D); clips Idle + Attack + Death.
//   • world/client/public/models/warlord_grondar.glb  — the open-world client
//     (entities.createMonsterMesh); clips idle + attack + die (walk aliases
//     idle in makeAnimator — the source ships no locomotion clip).
//
// The 71 MiB source is git-ignored (it exceeds Cloudflare Pages' 25 MiB
// per-file deploy limit) — drop it at assets/open-world/Warlord+Grondar.glb to
// re-run this. The committed runtime GLBs are the decimated outputs below.
//
// The source is far too heavy for the web, so it is welded + meshopt-simplified
// (skin weights preserved), textures recompressed to webp, and the output
// meshopt-compressed. Source clips are anonymous NlaTrack* — per the author:
// NlaTrack=idle loop, NlaTrack.001=fall/death (a forward tumble — root bone
// stays ground-level while the body tucks into a roll, so it reads as a
// collapse rather than a strike), NlaTrack.002=a two-fisted overhead chop
// (the attack clip on both surfaces).
//
// Run: node scripts/build-warlord-grondar.mjs
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { weld, simplify, textureCompress, resample, dedup, prune, quantize, getBounds } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'assets', 'open-world', 'Warlord+Grondar.glb')
const ARENA_OUT = path.join(ROOT, 'public', '3d-samples', 'monsters', 'warlord_grondar.glb')
const WORLD_OUT = path.join(ROOT, 'world', 'client', 'public', 'models', 'warlord_grondar.glb')
const TMP = path.join(ROOT, 'public', '3d-samples', 'monsters', '.grondar-base.glb')

const SIMPLIFY_ERROR = 0.005
// The arena renders a single close-up monster, so it keeps the richer mesh; the
// open world draws Grondar as a skinned + shadow-casting, frustum-cull-disabled
// entity amongst many others, where ~90k tris measurably drop the frame rate
// near him — so he decimates harder there (~40k tris) with half-res textures.
// Animations are untouched by either (simplify preserves the skin + clips), so
// both surfaces play byte-identical idle/attack/death.
const ARENA_RATIO = 0.05 // 1.87M tris → ~90k
const WORLD_RATIO = 0.021 // 1.87M tris → ~40k

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready])
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder,
})

// ── Heavy pass (once): weld geometry + fix animation interpolation → base GLB
// (still full-res; each surface decimates it independently below). ──
fs.mkdirSync(path.dirname(ARENA_OUT), { recursive: true })
fs.mkdirSync(path.dirname(WORLD_OUT), { recursive: true })
{
  const doc = await io.read(SRC)
  await doc.transform(weld(), resample(), dedup(), prune())
  // resample() only dedupes redundant keyframes within a sampler's existing
  // interpolation mode — it never converts STEP to LINEAR (gltf-transform's
  // resample.ts branches on the sampler's own interpolation). The idle loop
  // (NlaTrack) ships heavily STEP-interpolated from the source authoring
  // tool, which reads as "frozen, occasional pops" rather than a breathing
  // idle. Force it to LINEAR here — attack/death (NlaTrack.001/.002) keep
  // whatever interpolation they were authored with, since a snappy STEP pose
  // change may be intentional for an impact frame.
  for (const anim of doc.getRoot().listAnimations()) {
    if (anim.getName() !== 'NlaTrack') continue
    for (const sampler of anim.listSamplers()) {
      if (sampler.getInterpolation() === 'STEP') sampler.setInterpolation('LINEAR')
    }
  }
  await io.write(TMP, doc)
}

// ── Per-surface passes: decimate to the target weight, recompress textures,
// rename clips → final compressed GLB. ──
async function emit(outPath, clipMap, { ratio, textureSize, printBounds = false }) {
  const doc = await io.read(TMP)
  await doc.transform(
    simplify({ simplifier: MeshoptSimplifier, ratio, error: SIMPLIFY_ERROR }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [textureSize, textureSize] }),
  )
  const anims = doc.getRoot().listAnimations()
  for (const anim of anims) {
    const as = clipMap[anim.getName()]
    if (as) anim.setName(as)
    else { for (const c of anim.listChannels()) c.dispose(); for (const s of anim.listSamplers()) s.dispose(); anim.dispose() }
  }
  await doc.transform(quantize(), prune())
  await io.write(outPath, doc)
  let tris = 0
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const i = p.getIndices(); tris += i ? i.getCount() / 3 : 0 }
  console.log(`wrote ${outPath} (${(fs.statSync(outPath).size / 1024 / 1024).toFixed(2)} MiB, ${tris.toFixed(0)} tris) clips: ${doc.getRoot().listAnimations().map((a) => a.getName()).join(', ')}`)
  if (printBounds) {
    const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]
    const b = getBounds(scene)
    console.log(`  world bounds min [${b.min.map((v) => v.toFixed(3))}] max [${b.max.map((v) => v.toFixed(3))}]`)
  }
}

await emit(ARENA_OUT, { NlaTrack: 'Idle', 'NlaTrack.002': 'Attack', 'NlaTrack.001': 'Death' }, { ratio: ARENA_RATIO, textureSize: 1024 })
await emit(WORLD_OUT, { NlaTrack: 'idle', 'NlaTrack.002': 'attack', 'NlaTrack.001': 'die' }, { ratio: WORLD_RATIO, textureSize: 512, printBounds: true })

fs.rmSync(TMP, { force: true })
