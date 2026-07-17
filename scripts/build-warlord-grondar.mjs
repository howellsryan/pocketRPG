#!/usr/bin/env node
// Builds the Warlord Grondar boss GLBs from assets/open-world/Warlord+Grondar.glb
// (a ~75 MB / 1.87 M-triangle authored orc with three clips) for BOTH render
// surfaces, replacing the procedural blend-shell creature (src/data/creatures3d.json
// warlord_grondar) that stood in before:
//   • public/3d-samples/monsters/warlord_grondar.glb  — the combat arena
//     (CombatArena3D); clips Idle + Attack.
//   • world/client/public/models/warlord_grondar.glb  — the open-world client
//     (entities.createMonsterMesh); clips idle + die (walk aliases idle in
//     makeAnimator — the source ships no locomotion clip).
//
// The 71 MiB source is git-ignored (it exceeds Cloudflare Pages' 25 MiB
// per-file deploy limit) — drop it at assets/open-world/Warlord+Grondar.glb to
// re-run this. The committed runtime GLBs are the decimated outputs below.
//
// The source is far too heavy for the web, so it is welded + meshopt-simplified
// (skin weights preserved), textures recompressed to webp, and the output
// meshopt-compressed. Source clips are anonymous NlaTrack* — identified by
// review (scripts/render-glb.mjs): NlaTrack=idle loop, NlaTrack.001=a bare-
// handed overhead chop swing (used as the attack clip on both surfaces),
// NlaTrack.002=a stand-in-place roar that returns upright (no collapse) — not
// exported; there's no genuine fall/death pose in this source, so death is a
// coded rotate-to-the-ground collapse instead (CombatArena3D.jsx / world's
// entities.ts), not a baked clip.
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
const TMP = path.join(ROOT, 'public', '3d-samples', 'monsters', '.grondar-decimated.glb')

const SIMPLIFY_RATIO = 0.05 // 1.87M tris → ~90k, plenty for boss silhouette
const SIMPLIFY_ERROR = 0.005

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready])
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder,
})

// ── Heavy pass (once): decimate + recompress textures → intermediate GLB ──
fs.mkdirSync(path.dirname(ARENA_OUT), { recursive: true })
fs.mkdirSync(path.dirname(WORLD_OUT), { recursive: true })
{
  const doc = await io.read(SRC)
  await doc.transform(
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: SIMPLIFY_RATIO, error: SIMPLIFY_ERROR }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024] }),
    resample(), dedup(), prune(),
  )
  await io.write(TMP, doc)
  let tris = 0
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const i = p.getIndices(); tris += i ? i.getCount() / 3 : 0 }
  console.log(`decimated → ${(tris).toFixed(0)} tris`)
}

// ── Light passes: per-surface clip naming + final compression ──
async function emit(outPath, clipMap, { printBounds = false } = {}) {
  const doc = await io.read(TMP)
  const anims = doc.getRoot().listAnimations()
  for (const anim of anims) {
    const as = clipMap[anim.getName()]
    if (as) anim.setName(as)
    else { for (const c of anim.listChannels()) c.dispose(); for (const s of anim.listSamplers()) s.dispose(); anim.dispose() }
  }
  await doc.transform(quantize(), prune())
  await io.write(outPath, doc)
  console.log(`wrote ${outPath} (${(fs.statSync(outPath).size / 1024 / 1024).toFixed(2)} MiB) clips: ${doc.getRoot().listAnimations().map((a) => a.getName()).join(', ')}`)
  if (printBounds) {
    const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]
    const b = getBounds(scene)
    console.log(`  world bounds min [${b.min.map((v) => v.toFixed(3))}] max [${b.max.map((v) => v.toFixed(3))}]`)
  }
}

await emit(ARENA_OUT, { NlaTrack: 'Idle', 'NlaTrack.001': 'Attack' })
await emit(WORLD_OUT, { NlaTrack: 'idle', 'NlaTrack.001': 'attack' }, { printBounds: true })

fs.rmSync(TMP, { force: true })
