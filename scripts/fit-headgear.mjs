// Bake a raw headgear GLB (Tripo smart mesh, worn shape, facing +x) into the
// canonical head space so the single defaults.gear.head transform in
// src/data/equipmentModels.json places it snugly on the hero — no per-item
// tuning. Companion to canonicalize-weapon.mjs; full flow in
// docs/gear-3d-pipeline.md.
//
//   node scripts/fit-headgear.mjs <in.glb> <out.glb> [--margins 0.78,0.80,0.78] [--shift 0.05] [--lift 0.05]
//
// It recenters the mesh on the origin, then scales each axis so the piece
// wraps the hero's head with the given margins (x depth, y height, z width —
// fractions of the hero head's world-space bbox, which INCLUDES the hair),
// then shifts it forward/up. The defaults are the snug knight fit for
// fully-enclosing helms, sized to the skull rather than the hair — they only
// work together with `"hideHead": true` on the registry entry (the runtime
// shrinks the Head bone so hair can't clip through the shell). Open headwear
// that leaves the head visible needs hair-containing margins >1 (e.g.
// 1.25,1.12,1.06 with --shift 0.06 --lift 0) and no hideHead.
// Output is raw — run process-3d-model.mjs on it afterwards.
//
// The head constants were measured from public/3d-samples/hero.glb (animated
// rest frame, vertices dominant-weighted to the Head bone). Re-measure if the
// hero model or its skeleton ever changes.

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { transformMesh } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

// Hero head bbox in world units at the arena's model scale, and the uniform
// scale defaults.gear.head applies in Head-bone space (bone scale ≈ 1).
const HEAD_WORLD = [0.1654, 0.2076, 0.1477]; // x depth, y height, z width
const REGISTRY_SCALE = 0.242;

const args = process.argv.slice(2);
const files = args.filter((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));
const [inFile, outFile] = files;
const argOf = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def;
};
if (!inFile || !outFile) {
  console.error('usage: node scripts/fit-headgear.mjs <in.glb> <out.glb> [--margins x,y,z] [--shift 0.05] [--lift 0.05]');
  process.exit(1);
}
const margins = String(argOf('margins', '0.78,0.80,0.78')).split(',').map(Number);
const shiftFrac = Number(argOf('shift', 0.05)); // forward shift as a fraction of head depth
const liftFrac = Number(argOf('lift', 0.05)); // upward shift as a fraction of head height

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;

const doc = await io.read(inFile);
const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
  const pos = prim.getAttribute('POSITION');
  const mn = pos.getMin([]), mx = pos.getMax([]);
  for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], mn[i]); max[i] = Math.max(max[i], mx[i]); }
}
const size = min.map((v, i) => max[i] - v);
const center = min.map((v, i) => (v + max[i]) / 2);
const scale = size.map((s, i) => (HEAD_WORLD[i] * margins[i]) / (REGISTRY_SCALE * (s || 1)));
const tx = (HEAD_WORLD[0] * shiftFrac) / REGISTRY_SCALE;
const ty = (HEAD_WORLD[1] * liftFrac) / REGISTRY_SCALE;

// recenter → per-axis scale → forward/up shift, in one baked matrix
const m = [
  scale[0], 0, 0, 0,
  0, scale[1], 0, 0,
  0, 0, scale[2], 0,
  -center[0] * scale[0] + tx, -center[1] * scale[1] + ty, -center[2] * scale[2], 1,
];
for (const mesh of doc.getRoot().listMeshes()) transformMesh(mesh, m);
await io.write(outFile, doc);
console.log(`${outFile}  scale ${scale.map((s) => s.toFixed(3)).join('/')} shift +x ${tx.toFixed(3)} +y ${ty.toFixed(3)}`);
console.log(`next: node scripts/process-3d-model.mjs ${outFile} <final.glb> --ratio 1.0 --tex 512`);
