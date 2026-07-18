#!/usr/bin/env node
// Builds world/client/public/models/armor/{body,legs}.glb from the combat
// arena's already-built outfit pieces (public/3d-samples/outfits/ranger_*.glb
// — scripts/build-quaternius-outfits.mjs) — same 65-joint universal rig as
// world's hero.glb, so no new source-asset authoring is needed here, just a
// re-export into world's own asset tree. Tier tinting happens client-side
// (material color multiply), not here — mirrors build-weapons.mjs.
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { prune, dedup } from '@gltf-transform/functions'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const worldDir = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = path.join(worldDir, '..')
const OUTFITS = path.join(repoRoot, 'public', '3d-samples', 'outfits')
const OUT_DIR = path.join(worldDir, 'client', 'public', 'models', 'armor')

const SLOTS = {
  body: 'ranger_body.glb',
  legs: 'ranger_legs.glb',
}

fs.mkdirSync(OUT_DIR, { recursive: true })
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)

for (const [slot, file] of Object.entries(SLOTS)) {
  const doc = await io.read(path.join(OUTFITS, file))
  await doc.transform(dedup(), prune())
  const out = path.join(OUT_DIR, `${slot}.glb`)
  await io.write(out, doc)
  console.log(`wrote ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KiB)`)
}
