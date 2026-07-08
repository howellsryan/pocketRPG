// Offline 3D asset pipeline: turn a raw generated GLB (e.g. Tripo3D output) into
// a phone-shippable one — decimate, downscale textures, meshopt-compress.
//
// Raw generator output is ~40-55 MB and 1-2M triangles per model; that is
// 20-100x over a mobile web budget. This step gets a character down to ~1 MB /
// ~40k tris with meshopt compression. Run offline; commit only the processed
// output (never the raw GLB, never generate at runtime).
//
//   node scripts/process-3d-model.mjs <in.glb> <out.glb> [--ratio 0.03] [--tex 1024]
//
// --ratio : target fraction of triangles to keep (0.03 = keep 3%).
// --tex   : max texture edge in px (textures are re-encoded to WebP q85).
//
// Skin weights + joints survive `simplify`, so a rigged character stays rigged.
// Tune --ratio per asset: heroes/bosses seen close up want more (0.05-0.1),
// background props less. Deps are devDependencies (pipeline only, never shipped).
//
// Reader registers meshopt.decoder (not just encoder) because input can
// itself be meshopt-compressed — canonicalize-armour.mjs's output shares
// hero.glb's own (compressed) buffers, so extensionsRequired still lists
// EXT_meshopt_compression even though the new accessors it adds aren't.

import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMaterialsVolume, KHRTextureBasisu } from '@gltf-transform/extensions';
import { weld, simplify, dedup, prune, textureCompress, flatten, join } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'fs';

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? def : Number(process.argv[i + 1]);
}

const [inFile, outFile] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!inFile || !outFile) {
  console.error('usage: node scripts/process-3d-model.mjs <in.glb> <out.glb> [--ratio 0.03] [--tex 1024]');
  process.exit(1);
}
const ratio = arg('--ratio', 0.03);
const tex = arg('--tex', 1024);

const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMaterialsVolume, KHRTextureBasisu])
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder, 'meshopt.simplifier': MeshoptSimplifier });

await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;

const before = fs.statSync(inFile).size;
const doc = await io.read(inFile);

// --clip old=new (repeatable): rename animation clips to the semantic names
// the runtime looks up (Idle/Attack/Box/…) — generators export NLA junk.
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] !== '--clip' || !process.argv[i + 1]) continue;
  const [from, to] = process.argv[i + 1].split('=');
  for (const anim of doc.getRoot().listAnimations()) if (anim.getName() === from) anim.setName(to);
}

// flatten/join can merge or re-parent nodes that animation channels target,
// silently breaking node-transform clips — keep the node graph for animated
// models (skinned meshes survive either way; statics still get both).
const animated = doc.getRoot().listAnimations().length > 0;
if (animated) console.log('animations present — keeping node graph (flatten/join skipped)');

await doc.transform(
  dedup(),
  ...(animated ? [] : [flatten(), join()]),
  weld({ tolerance: 0.0001 }),
  simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.01 }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [tex, tex], quality: 85 }),
  prune(),
);

doc.createExtension(EXTMeshoptCompression)
  .setRequired(true)
  .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });

await io.write(outFile, doc);

const after = fs.statSync(outFile).size;
let tris = 0;
for (const m of doc.getRoot().listMeshes()) {
  for (const p of m.listPrimitives()) {
    const idx = p.getIndices();
    tris += idx ? idx.getCount() / 3 : (p.getAttribute('POSITION')?.getCount() || 0) / 3;
  }
}
console.log(
  `${outFile}  ${(before / 1048576).toFixed(1)}MB -> ${(after / 1048576).toFixed(2)}MB` +
  ` (${(100 * after / before).toFixed(1)}%)  ~${Math.round(tris).toLocaleString()} tris`,
);
