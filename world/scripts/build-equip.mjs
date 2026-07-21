#!/usr/bin/env node
// Copies the combat-arena's per-item equipment models
// (src/data/equipmentModels.json → public/3d-samples/**) into the world's own
// asset tree at world/client/public/models/equip/**, preserving the registry's
// relative model paths. The open-world hero (same 65-joint universal rig as the
// arena hero — scripts/build-arena-hero.mjs / world/scripts/build-hero.mjs)
// resolves each equipped item through the SAME registry + placement resolver
// (src/utils/equipModels.js) as the equip modal, so both heroes render an
// identical loadout. The set is derived from the registry, so a new weapon/gear
// model surfaces here automatically on the next run. All referenced .gltf files
// are self-contained (embedded buffers/images) — a plain copy suffices.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const worldDir = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = path.join(worldDir, '..')
const SRC_ROOT = path.join(repoRoot, 'public', '3d-samples')
const OUT_ROOT = path.join(worldDir, 'client', 'public', 'models', 'equip')

const registry = JSON.parse(fs.readFileSync(path.join(repoRoot, 'src', 'data', 'equipmentModels.json'), 'utf8'))
const models = new Set()
for (const section of ['weapons', 'gear']) {
  for (const entry of Object.values(registry[section] || {})) {
    if (entry && entry.model && !/^(https?:)?\/\//.test(entry.model) && !entry.model.startsWith('/')) models.add(entry.model)
  }
}
// The generic default-head model lives under defaults.gear.head.fallbackModel
// (not the itemId-keyed `gear` map above, since it isn't tied to one item).
const fallbackHead = registry.defaults?.gear?.head?.fallbackModel
if (fallbackHead && !/^(https?:)?\/\//.test(fallbackHead) && !fallbackHead.startsWith('/')) models.add(fallbackHead)
// The generic default boots live under defaults.gear.boots.{left,right}.model
// (same reason — one shared L/R pair, not tied to any one boots item).
for (const side of ['left', 'right']) {
  const b = registry.defaults?.gear?.boots?.[side]?.model
  if (b && !/^(https?:)?\/\//.test(b) && !b.startsWith('/')) models.add(b)
}

let copied = 0
for (const model of [...models].sort()) {
  const src = path.join(SRC_ROOT, model)
  const dst = path.join(OUT_ROOT, model)
  if (!fs.existsSync(src)) {
    console.error(`missing source model: ${model}`)
    process.exitCode = 1
    continue
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.copyFileSync(src, dst)
  copied++
}
console.log(`copied ${copied} equipment model(s) to ${path.relative(repoRoot, OUT_ROOT)}/`)
