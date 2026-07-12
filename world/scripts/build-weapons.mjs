#!/usr/bin/env node
// Builds world/client/public/models/weapons/<archetype>.glb — one model per
// weapon archetype (guide §11 / docs/open-world-asset-coverage.md). KayKit
// Adventurers weapons are static single-node glTFs with the grip at the origin;
// the Quaternius Hammer_Double OBJ (the one archetype KayKit lacks) goes
// through obj2gltf (devDependency-less: installed --no-save when regenerating).
// Tier tinting happens client-side (material color multiply), not here.
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { prune, dedup } from '@gltf-transform/functions'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const worldDir = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = path.join(worldDir, '..')
const KAYKIT = path.join(repoRoot, 'assets', 'open-world', 'kaykit', 'KayKit_Adventurers_2.0_FREE', 'KayKit_Adventurers_2.0_FREE', 'Assets', 'gltf')
const QUAT_OBJ = path.join(repoRoot, 'assets', 'open-world', 'Quaternius', 'Ultimate RPG Items Pack - Aug 2019-20260709T194650Z-2-001', 'Ultimate RPG Items Pack - Aug 2019', 'OBJ')
const OUT_DIR = path.join(worldDir, 'client', 'public', 'models', 'weapons')

const KAYKIT_MODELS = {
  sword: 'sword_1handed.gltf',
  sword2h: 'sword_2handed.gltf',
  dagger: 'dagger.gltf',
  axe: 'axe_1handed.gltf',
  axe2h: 'axe_2handed.gltf',
  bow: 'bow_withString.gltf',
  crossbow: 'crossbow_2handed.gltf',
  staff: 'staff.gltf',
  wand: 'wand.gltf',
}

fs.mkdirSync(OUT_DIR, { recursive: true })
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)

for (const [archetype, file] of Object.entries(KAYKIT_MODELS)) {
  const doc = await io.read(path.join(KAYKIT, file))
  await doc.transform(dedup(), prune())
  const out = path.join(OUT_DIR, `${archetype}.glb`)
  await io.write(out, doc)
  console.log(`wrote ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KiB)`)
}

// blunt (mace/maul/warhammer/flail) — Quaternius Hammer_Double via obj2gltf.
try {
  const { default: obj2gltf } = await import('obj2gltf')
  const glb = await obj2gltf(path.join(QUAT_OBJ, 'Hammer_Double.obj'), { binary: true })
  const out = path.join(OUT_DIR, 'blunt.glb')
  fs.writeFileSync(out, glb)
  console.log(`wrote ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KiB)`)
} catch (err) {
  console.error('blunt.glb skipped — install obj2gltf (`npm i --no-save obj2gltf`) to build it:', err.message)
  process.exitCode = 1
}
