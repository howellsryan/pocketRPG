import { NodeIO, getBounds } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'

await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })

for (const file of process.argv.slice(2)) {
  const doc = await io.read(file)
  const root = doc.getRoot()
  console.log('===', file.split('/').pop())
  const scene = root.getDefaultScene() || root.listScenes()[0]
  if (scene) {
    const b = getBounds(scene)
    console.log('bounds min', b.min.map(n => +n.toFixed(2)), 'max', b.max.map(n => +n.toFixed(2)))
  }
  console.log('meshes:', root.listMeshes().length, 'skins:', root.listSkins().length, 'textures:', root.listTextures().map(t => `${t.getName()} ${t.getMimeType()}`))
  const skin = root.listSkins()[0]
  if (skin) console.log('joints[', skin.listJoints().length, ']:', skin.listJoints().slice(0, 12).map(j => j.getName()).join(', '), '...')
  const anims = root.listAnimations()
  console.log('anims[', anims.length, ']:', anims.map(a => a.getName()).join(', '))
  console.log('top nodes:', scene ? scene.listChildren().map(n => n.getName()) : [])
}
