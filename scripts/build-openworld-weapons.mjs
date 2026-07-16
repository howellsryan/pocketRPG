#!/usr/bin/env node
// Builds public/3d-samples/weapons/*.glb from the loose Poly Pizza GLBs in
// assets/open-world/ (each its own CC-BY download, not part of a CC0 pack —
// see assets/open-world/CREDITS.md). Unlike the Quaternius OBJ pipeline,
// these arrive as already-built GLBs with arbitrary authored scale/pivot
// (some have geometry many orders of magnitude off-origin, and some sit on a
// local axis other than the handle-along-Y convention the other weapons
// use), so this script: applies an optional per-source axis-swap rotation to
// land the handle on Y, then recentres the (post-swap) bounds and applies a
// uniform scale that brings the longest dimension to a hand-tool size
// comparable to the other weapon archetypes. Diagonally-authored sources
// (e.g. the spear/staff, whose long axis isn't aligned to any single axis)
// skip the swap and get their final in-hand orientation from the registry's
// own per-item rotationDeg instead. All of this wraps the original nodes
// rather than rewriting vertex data.
//
// Run: node scripts/build-openworld-weapons.mjs
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { getBounds, prune, dedup } from '@gltf-transform/functions'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC_DIR = path.join(ROOT, 'assets', 'open-world')
const OUT_DIR = path.join(ROOT, 'public', '3d-samples', 'weapons')

const SOURCES = [
  { src: 'Mace.glb', out: 'mace.glb', targetSize: 0.9, swapDeg: [0, 0, -90] },
  { src: 'Pickaxe.glb', out: 'pickaxe.glb', targetSize: 0.85, swapDeg: [90, 0, 0] },
  { src: 'Crossbow.glb', out: 'crossbow.glb', targetSize: 0.9, swapDeg: [0, 0, 0] },
  { src: 'SCI-FI Blue Spear.glb', out: 'spear.glb', targetSize: 1.5, swapDeg: [0, 0, 0] },
  { src: 'SCI-FI Staff.glb', out: 'staff.glb', targetSize: 1.5, swapDeg: [0, 0, 0] },
  { src: 'Talwar.glb', out: 'talwar.glb', targetSize: 0.958, swapDeg: [0, 0, 0] },
  { src: 'Trident.glb', out: 'trident.glb', targetSize: 1.4, swapDeg: [0, 0, 0] },
]

// Quaternion for an XYZ-order Euler (matches THREE.Euler's default order,
// which is how heroAttach.js applies the registry's own rotationDeg).
function quatFromEulerXYZDeg([xDeg, yDeg, zDeg]) {
  const x = (xDeg * Math.PI) / 180 / 2
  const y = (yDeg * Math.PI) / 180 / 2
  const z = (zDeg * Math.PI) / 180 / 2
  const [cx, sx] = [Math.cos(x), Math.sin(x)]
  const [cy, sy] = [Math.cos(y), Math.sin(y)]
  const [cz, sz] = [Math.cos(z), Math.sin(z)]
  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ]
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)

for (const { src, out, targetSize, swapDeg } of SOURCES) {
  const doc = await io.read(path.join(SRC_DIR, src))
  const scene = doc.getRoot().listScenes()[0]

  let originalChildren = scene.listChildren()
  if (swapDeg.some((d) => d !== 0)) {
    const swap = doc.createNode('AxisSwap').setRotation(quatFromEulerXYZDeg(swapDeg))
    for (const child of originalChildren) swap.addChild(child)
    for (const child of originalChildren) scene.removeChild(child)
    scene.addChild(swap)
    originalChildren = [swap]
  }

  const bounds = getBounds(scene)
  const center = bounds.min.map((v, i) => (v + bounds.max[i]) / 2)
  const size = bounds.max.map((v, i) => v - bounds.min[i])
  const scale = targetSize / Math.max(...size)

  const recenter = doc.createNode('Recenter').setTranslation([-center[0], -center[1], -center[2]])
  for (const child of originalChildren) recenter.addChild(child)
  const wrapper = doc.createNode('Normalize').setScale([scale, scale, scale]).addChild(recenter)
  for (const child of originalChildren) scene.removeChild(child)
  scene.addChild(wrapper)

  await doc.transform(prune(), dedup())
  const file = path.join(OUT_DIR, out)
  await io.write(file, doc)
  const newBounds = getBounds(scene)
  console.log(`wrote ${file} (${(await import('node:fs')).statSync(file).size} bytes), size ${newBounds.max.map((v, i) => (v - newBounds.min[i]).toFixed(3))}`)
}
