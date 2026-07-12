#!/usr/bin/env node
// Builds the Phase 7 station models: furnace.glb from the Medieval Village
// MegaKit chimney ([Standard] pack — strip normal/roughness, shrink base color
// to 512px webp per the guide §2.1 rule) and range.glb from the Kenney nature
// kit's brick fire ring (CC0, prune only — the client adds the flame mesh).
// No anvil asset exists in the library; statics.ts composes one from
// primitives until a bespoke model lands.
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { prune, dedup, textureCompress } from '@gltf-transform/functions'
import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const worldDir = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = path.join(worldDir, '..')
const MEGAKIT = path.join(repoRoot, 'assets', 'open-world', 'Quaternius', 'Medieval Village MegaKit[Standard]', 'Medieval Village MegaKit[Standard]', 'glTF')
const NATURE = path.join(repoRoot, 'assets', 'open-world', 'Kenney', 'kenney_nature_kit_glb_cc0_v1', 'kenney_nature_kit_glb_cc0_v1', 'models_glb')
const MODELS = path.join(worldDir, 'client', 'public', 'models')

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)

// Furnace: the MegaKit brick chimney reads as a smelting furnace at world scale.
{
  const doc = await io.read(path.join(MEGAKIT, 'Prop_Chimney2.gltf'))
  for (const material of doc.getRoot().listMaterials()) {
    material.setNormalTexture(null)
    material.setMetallicRoughnessTexture(null)
    material.setRoughnessFactor(1)
  }
  await doc.transform(
    dedup(),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512] })
  )
  const outPath = path.join(MODELS, 'furnace.glb')
  await io.write(outPath, doc)
  console.log(`wrote ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(1)} KiB)`)
}

// Range: brick fire ring; the flame itself is an emissive mesh in statics.ts.
{
  const doc = await io.read(path.join(NATURE, 'campfire_bricks.glb'))
  await doc.transform(dedup(), prune())
  const outPath = path.join(MODELS, 'range.glb')
  await io.write(outPath, doc)
  console.log(`wrote ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(1)} KiB)`)
}
