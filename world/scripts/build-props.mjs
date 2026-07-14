#!/usr/bin/env node
// Processes CC0 kit GLBs (Kenney nature/town/castle, KayKit Medieval Builder)
// into world/client/public/models/: scenery props (props/<name>.glb, visual
// dressing placed by zone JSON) and the interactive tree statics
// (tree_<action>.glb + stump.glb). These kits are already tiny — prune/dedup
// only, no texture work (they're vertex-coloured or palette-textured).
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { prune, dedup } from '@gltf-transform/functions'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const worldDir = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = path.join(worldDir, '..')
const KITS = path.join(repoRoot, 'assets', 'open-world')
const NATURE = path.join(KITS, 'Kenney', 'kenney_nature_kit_glb_cc0_v1', 'kenney_nature_kit_glb_cc0_v1', 'models_glb')
const TOWN = path.join(KITS, 'Kenney', 'kenney_fantasy-town-kit_2.0', 'Models', 'GLB format')
const CASTLE = path.join(KITS, 'Kenney', 'kenney_castle-kit', 'Models', 'GLB format')
const GRAVEYARD = path.join(KITS, 'Kenney', 'kenney_graveyard-kit_5.0', 'Models', 'GLB format')
const BUILDER = path.join(KITS, 'kaykit', 'KayKit Medieval Builder Pack 1.0', 'Models', 'objects', 'gltf')
const DUNGEON = path.join(KITS, 'kaykit', 'dungeon-remastered', 'Assets', 'gltf')
const MODELS = path.join(worldDir, 'client', 'public', 'models')

const BUILDS = [
  // Interactive gather-node statics (statics.ts renders these).
  { src: path.join(NATURE, 'tree_default.glb'), out: 'tree_normal.glb' },
  { src: path.join(NATURE, 'tree_oak.glb'), out: 'tree_oak.glb' },
  { src: path.join(NATURE, 'stump_round.glb'), out: 'stump.glb' },
  // Scenery prop catalogue (props.ts renders these from zone JSON `props`).
  { src: path.join(NATURE, 'tree_pineDefaultA.glb'), out: 'props/pine_a.glb' },
  { src: path.join(NATURE, 'tree_pineRoundC.glb'), out: 'props/pine_b.glb' },
  { src: path.join(NATURE, 'plant_bushDetailed.glb'), out: 'props/bush.glb' },
  { src: path.join(NATURE, 'mushroom_redGroup.glb'), out: 'props/mushrooms.glb' },
  { src: path.join(NATURE, 'flower_purpleA.glb'), out: 'props/flowers.glb' },
  { src: path.join(NATURE, 'rock_largeA.glb'), out: 'props/boulder.glb' },
  // Lumbright town dressing (Phase 7): whole-building objects from the KayKit
  // Medieval Builder pack, street furniture from the Kenney town kit, and
  // per-tile wall/tower pieces from the Kenney castle kit.
  { src: path.join(BUILDER, 'house.gltf.glb'), out: 'props/house.glb' },
  { src: path.join(BUILDER, 'market.gltf.glb'), out: 'props/market.glb' },
  { src: path.join(BUILDER, 'mill.gltf.glb'), out: 'props/mill.glb' },
  { src: path.join(BUILDER, 'lumbermill.gltf.glb'), out: 'props/lumbermill.glb' },
  { src: path.join(BUILDER, 'well.gltf.glb'), out: 'props/well.glb' },
  { src: path.join(BUILDER, 'watchtower.gltf.glb'), out: 'props/watchtower.glb' },
  { src: path.join(TOWN, 'lantern.glb'), out: 'props/lantern.glb' },
  { src: path.join(TOWN, 'cart.glb'), out: 'props/cart.glb' },
  { src: path.join(CASTLE, 'wall.glb'), out: 'props/town_wall.glb' },
  { src: path.join(CASTLE, 'tower-square.glb'), out: 'props/town_tower.glb' },
  // Varrick capital dressing: the grand cathedral/keep, a fountain-square
  // centrepiece, market stalls + banners, the chapel/sanctum stonework
  // (graveyard-kit altar/crypt/column), and the dungeon-entrance stairs.
  { src: path.join(BUILDER, 'castle.gltf.glb'), out: 'props/castle.glb' },
  { src: path.join(TOWN, 'fountain-round-detail.glb'), out: 'props/fountain.glb' },
  { src: path.join(TOWN, 'stall.glb'), out: 'props/stall.glb' },
  { src: path.join(TOWN, 'banner-red.glb'), out: 'props/banner.glb' },
  { src: path.join(GRAVEYARD, 'altar-stone.glb'), out: 'props/altar.glb' },
  { src: path.join(GRAVEYARD, 'crypt-large.glb'), out: 'props/crypt.glb' },
  { src: path.join(GRAVEYARD, 'column-large.glb'), out: 'props/column.glb' },
  { src: path.join(DUNGEON, 'stairs.gltf.glb'), out: 'props/dungeon_stairs.glb' },
  { src: path.join(DUNGEON, 'wall_doorway.glb'), out: 'props/dungeon_door.glb' },
]

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
fs.mkdirSync(path.join(MODELS, 'props'), { recursive: true })

for (const { src, out } of BUILDS) {
  const doc = await io.read(src)
  await doc.transform(dedup(), prune())
  const outPath = path.join(MODELS, out)
  await io.write(outPath, doc)
  console.log(`wrote ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(1)} KiB)`)
}
