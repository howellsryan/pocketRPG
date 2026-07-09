#!/usr/bin/env node
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const worldDir = fileURLToPath(new URL('..', import.meta.url))
const modelPath = path.join(worldDir, 'client', 'public', 'models', 'hero.glb')

await MeshoptDecoder.ready
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
const document = await io.read(modelPath)
const animations = document.getRoot().listAnimations()

if (animations.length === 0) {
  console.log('No animation clips found in', modelPath)
} else {
  console.log(`${animations.length} animation clip(s) in ${modelPath}:`)
  for (const anim of animations) console.log(' -', anim.getName())
}
