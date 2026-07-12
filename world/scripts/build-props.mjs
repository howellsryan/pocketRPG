#!/usr/bin/env node
// Processes Kenney nature-kit GLBs (CC0) into world/client/public/models/:
// scenery props (props/<name>.glb, visual dressing placed by zone JSON) and the
// interactive tree statics (tree_<action>.glb + stump.glb). Kenney models are
// already tiny — prune/dedup only, no texture work (they're vertex-coloured).
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { prune, dedup } from '@gltf-transform/functions'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const worldDir = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = path.join(worldDir, '..')
const KIT = path.join(repoRoot, 'assets', 'open-world', 'Kenney', 'kenney_nature_kit_glb_cc0_v1', 'kenney_nature_kit_glb_cc0_v1', 'models_glb')
const MODELS = path.join(worldDir, 'client', 'public', 'models')

const BUILDS = [
  // Interactive gather-node statics (statics.ts renders these).
  { src: 'tree_default.glb', out: 'tree_normal.glb' },
  { src: 'tree_oak.glb', out: 'tree_oak.glb' },
  { src: 'stump_round.glb', out: 'stump.glb' },
  // Scenery prop catalogue (props.ts renders these from zone JSON `props`).
  { src: 'tree_pineDefaultA.glb', out: 'props/pine_a.glb' },
  { src: 'tree_pineRoundC.glb', out: 'props/pine_b.glb' },
  { src: 'plant_bushDetailed.glb', out: 'props/bush.glb' },
  { src: 'mushroom_redGroup.glb', out: 'props/mushrooms.glb' },
  { src: 'flower_purpleA.glb', out: 'props/flowers.glb' },
  { src: 'rock_largeA.glb', out: 'props/boulder.glb' },
]

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
fs.mkdirSync(path.join(MODELS, 'props'), { recursive: true })

for (const { src, out } of BUILDS) {
  const doc = await io.read(path.join(KIT, src))
  await doc.transform(dedup(), prune())
  const outPath = path.join(MODELS, out)
  await io.write(outPath, doc)
  console.log(`wrote ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(1)} KiB)`)
}
