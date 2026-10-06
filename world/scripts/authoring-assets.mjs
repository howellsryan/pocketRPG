import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { getBounds } from '@gltf-transform/functions'
import { PROP_BASE_SCALE } from '../shared/propScale.js'
import { MONSTER_MODELS } from '../shared/monsterModels.ts'
import { AMBIENT_MODELS } from '../shared/ambientModels.ts'

const worldDir = fileURLToPath(new URL('..', import.meta.url))
export async function measureAuthoringAssets(policy) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  const props = {}
  for (const [model, rules] of Object.entries(policy.props)) {
    const file = path.join(worldDir, 'client/public/models/props', model + '.glb')
    const bytes = fs.readFileSync(file)
    const document = await io.read(file)
    const scene = document.getRoot().listScenes()[0]
    if (!scene) throw new Error('No scene in ' + model)
    const { min, max } = getBounds(scene)
    if (![...min,...max].every(Number.isFinite)) throw new Error('Invalid bounds in ' + model)
    props[model] = { min, max, baseScale: PROP_BASE_SCALE[model] ?? 1,
      blocking: rules.blocking !== false, role: rules.role,
      source: 'world/client/public/models/props/' + model + '.glb',
      sha256: createHash('sha256').update(bytes).digest('hex') }
  }
  const creatures = JSON.parse(fs.readFileSync(path.join(worldDir,'../src/data/creatures3d.json'),'utf8'))
  const monsters = new Set()
  for (const [id, model] of Object.entries(MONSTER_MODELS)) {
    if (fs.existsSync(path.join(worldDir,'client/public',model.url))) monsters.add(id)
  }
  for (const [id, spec] of Object.entries(creatures.monsters)) {
    if (spec.parts?.length || Object.values(spec.forms ?? {}).some((f) => f.parts?.length)) monsters.add(id)
  }
  const ambient = Object.entries(AMBIENT_MODELS).filter(([,spec])=>fs.existsSync(path.join(worldDir,'client/public',spec.url))).map(([id])=>id)
  return { schemaVersion: 1, props, monsters: [...monsters].sort(), ambient: ambient.sort() }
}
