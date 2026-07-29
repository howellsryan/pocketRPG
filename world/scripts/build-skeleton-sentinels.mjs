#!/usr/bin/env node
// Builds the world models for Zaryth's three summoned sentinels from the CC0
// KayKit skeleton pack (assets/open-world/kaykit/skeletons — CC0, see its
// LICENSE.txt), one GLB per sentinel.
//
// The pack's Warrior/Rogue/Mage are one rig in three kits, which is exactly the
// shape of the boss's `spawnsAdd.monsterIdByStyle`: the sentinel it summons
// matches the style it is attacking with, so the melee one carries a blade, the
// ranged one a crossbow and the magic one a staff without any of them needing a
// bespoke model.
//
// Each source ships 95 clips — every animation in KayKit's shared library. All
// but the four the world protocol uses are dropped, which is most of the file
// size. The one attack clip each keeps is named for that sentinel's OWN style,
// because the server picks the anim from the monster's `attackStyle`
// (tick.ts monsterAttackAnim) and a clip under any other name would never play.
//
// The pack ships its characters EMPTY-HANDED: `handslot.l`/`handslot.r` are
// childless joints and the weapons are separate files, so a straight conversion
// gives three identical unarmed skeletons and nothing to tell blade from bolt
// from rune. Each weapon is merged in and parented to a hand slot, which the
// rig then animates for free.
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { mergeDocuments, prune, dedup, resample, unpartition, getBounds, textureCompress } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const worldDir = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = path.join(worldDir, '..')
const PACK = path.join(repoRoot, 'assets', 'open-world', 'kaykit', 'skeletons')
const SRC = path.join(PACK, 'Characters', 'gltf')
const ARMS = path.join(PACK, 'Assets', 'gltf')
const MODELS = path.join(worldDir, 'client', 'public', 'models')

// Walking_D_Skeletons is the pack's skeleton-specific shamble; the generic
// Walking_A reads as a living soldier's stride on a rig with no flesh.
const SHARED = { Idle: 'idle', Walking_D_Skeletons: 'walk', Death_A: 'die' }

const BUILDS = [
  {
    src: 'Skeleton_Warrior.glb', out: 'skeleton_warrior.glb',
    clips: { ...SHARED, '1H_Melee_Attack_Slice_Diagonal': 'attack' },
    hold: [{ file: 'Skeleton_Blade.gltf', slot: 'handslot.r' }, { file: 'Skeleton_Shield_Large_A.gltf', slot: 'handslot.l' }],
  },
  {
    src: 'Skeleton_Rogue.glb', out: 'skeleton_rogue.glb',
    clips: { ...SHARED, '1H_Ranged_Shoot': 'attack_ranged' },
    hold: [{ file: 'Skeleton_Crossbow.gltf', slot: 'handslot.r' }],
  },
  {
    src: 'Skeleton_Mage.glb', out: 'skeleton_mage.glb',
    clips: { ...SHARED, Spellcast_Shoot: 'attack_magic' },
    hold: [{ file: 'Skeleton_Staff.gltf', slot: 'handslot.r' }],
  },
]

await MeshoptDecoder.ready
await MeshoptEncoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })

/** Merges a weapon file in and parents its scene roots under the named joint.
 * The pack authors every weapon at the origin of the slot it is made for, so
 * the joint's own transform is the whole placement — no offset to tune. */
async function attach(doc, spec) {
  const slot = doc.getRoot().listNodes().find((n) => n.getName() === spec.slot)
  if (!slot) throw new Error(`no '${spec.slot}' joint to attach ${spec.file} to`)
  const arm = await io.read(path.join(ARMS, spec.file))
  const roots = arm.getRoot().listScenes().flatMap((s) => s.listChildren())
  const map = mergeDocuments(doc, arm)
  for (const root of roots) {
    const merged = map.get(root)
    if (merged) slot.addChild(merged)
  }
  // The weapon's own scene came across with it and would otherwise ship as a
  // second, unparented copy of the model.
  for (const scene of doc.getRoot().listScenes().slice(1)) scene.dispose()
}

for (const { src, out, clips, hold } of BUILDS) {
  const doc = await io.read(path.join(SRC, src))
  for (const spec of hold) await attach(doc, spec)
  const keep = new Map()
  for (const anim of doc.getRoot().listAnimations()) {
    const name = anim.getName()
    const spec = Object.entries(clips).find(([clip]) => name === clip || name.endsWith(`|${clip}`))
    if (spec && !keep.has(spec[1])) {
      keep.set(spec[1], anim)
    } else {
      for (const channel of anim.listChannels()) channel.dispose()
      for (const sampler of anim.listSamplers()) sampler.dispose()
      anim.dispose()
    }
  }
  for (const as of Object.values(clips)) {
    if (!keep.has(as)) throw new Error(`clip for '${as}' not found in ${src}`)
  }
  for (const [as, anim] of keep) anim.setName(as)

  // unpartition: each merged weapon arrived with its own buffer, and a GLB may
  // only have one.
  await doc.transform(resample(), dedup(), prune(), unpartition(), textureCompress({ encoder: sharp, targetFormat: 'webp' }))
  const outPath = path.join(MODELS, out)
  await io.write(outPath, doc)
  const b = getBounds(doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0])
  const f = (n) => Number(n.toFixed(3))
  console.log(`wrote ${path.relative(repoRoot, outPath)} (${(fs.statSync(outPath).size / 1024).toFixed(0)} KiB) clips: ${[...keep.keys()].join(', ')}`)
  console.log(`  bounds: { minX: ${f(b.min[0])}, minY: ${f(b.min[1])}, minZ: ${f(b.min[2])}, maxX: ${f(b.max[0])}, maxY: ${f(b.max[1])}, maxZ: ${f(b.max[2])} }`)
}
