// Split a multi-part GLB (several armour pieces batched into one file for
// generation efficiency, e.g. a Tripo export with a torso, two legs, and a
// pauldron all in one mesh) into separate per-piece GLBs. Companion to
// fit-headgear.mjs / canonicalize-weapon.mjs; full flow in
// docs/gear-3d-pipeline.md.
//
// Tripo's raw output is rarely watertight-welded at panel seams, so a naive
// "shared index" connected-components pass over-fragments into hundreds of
// disconnected micro-islands (one per unwelded panel). This tool first welds
// vertices that are merely close in space (within --eps) before flood-filling
// components, which recovers the real per-piece islands. Pieces that touch
// in the source scene (e.g. a worn torso whose hem visually overlaps its own
// integrated skirt) still weld into ONE island — use --clip on an --extract
// to cut an island by a Y-band when there's no seam to split on geometrically.
//
//   node scripts/split-gear-glb.mjs <in.glb> --list [--eps 0.0015]
//   node scripts/split-gear-glb.mjs <in.glb> --eps 0.0015 \
//     --extract platebody.glb=0:clip=-0.02,10 \
//     --extract platelegs.glb=1,2
//
// --list prints every island ranked by vertex count with its bbox/Y-range —
// inspect these (render each rank with the isolate/complook pattern in
// docs/gear-3d-pipeline.md, or just read the printed sizes) before choosing
// --extract groups. Each --extract is `<outFile>=<ranks>[:clip=<yMin>,<yMax>]`
// — ranks is a comma list of island ranks (0 = largest) merged into one
// output mesh; clip additionally drops any triangle with a vertex outside
// [yMin,yMax]. Islands not mentioned in any --extract are simply dropped
// (e.g. a stray pauldron nobody asked for).
//
// Output is raw (untrimmed texture, no canonical bake) — run
// process-3d-model.mjs (and fit-headgear.mjs / canonicalize-weapon.mjs, if
// applicable to the slot) on each extracted file afterwards, same as any
// other authored asset.

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { cloneDocument } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const args = process.argv.slice(2);
const inFile = args[0];
const eps = Number(argOf('--eps', '0.0015'));
const listMode = args.includes('--list');
const extractArgs = [];
for (let i = 0; i < args.length; i++) if (args[i] === '--extract') extractArgs.push(args[i + 1]);

function argOf(flag, def) {
  const i = args.indexOf(flag);
  return i === -1 ? def : args[i + 1];
}

if (!inFile || (!listMode && !extractArgs.length)) {
  console.error('usage: node scripts/split-gear-glb.mjs <in.glb> --list [--eps 0.0015]');
  console.error('   or: node scripts/split-gear-glb.mjs <in.glb> --extract out.glb=ranks[:clip=yMin,yMax] [--extract ...] [--eps 0.0015]');
  process.exit(1);
}

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(inFile);
const mesh = doc.getRoot().listMeshes()[0];
const prim = mesh.listPrimitives()[0];
const pos = prim.getAttribute('POSITION');
const norm = prim.getAttribute('NORMAL');
const uv = prim.getAttribute('TEXCOORD_0');
const idx = prim.getIndices();
const n = pos.getCount();
const ic = idx.getArray();

// union-find over shared triangle vertices + spatially-close vertices (weld)
const parent = new Int32Array(n);
for (let i = 0; i < n; i++) parent[i] = i;
function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
function union(a, b) { a = find(a); b = find(b); if (a !== b) parent[a] = b; }
for (let i = 0; i < ic.length; i += 3) { union(ic[i], ic[i + 1]); union(ic[i + 1], ic[i + 2]); }
const grid = new Map();
for (let i = 0; i < n; i++) {
  const p = pos.getElement(i, []);
  const cx = Math.round(p[0] / eps), cy = Math.round(p[1] / eps), cz = Math.round(p[2] / eps);
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
    const bucket = grid.get(`${cx + dx}_${cy + dy}_${cz + dz}`);
    if (bucket) for (const j of bucket) union(i, j);
  }
  const k0 = `${cx}_${cy}_${cz}`;
  if (!grid.has(k0)) grid.set(k0, []);
  grid.get(k0).push(i);
}
const groups = new Map();
for (let i = 0; i < n; i++) { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); }
const ranked = [...groups.values()].sort((a, b) => b.length - a.length);

if (listMode) {
  let cum = 0;
  ranked.forEach((verts, rank) => {
    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const v of verts) { const p = pos.getElement(v, []); for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); } }
    cum += verts.length;
    const size = max.map((v, k) => (v - min[k]).toFixed(3));
    console.log(`rank ${rank}: ${verts.length} verts (cum ${(100 * cum / n).toFixed(1)}%)  y=[${min[1].toFixed(3)},${max[1].toFixed(3)}]  size=${size.join(',')}`);
  });
  console.log(`${n} verts total, ${ranked.length} islands, eps=${eps}`);
  process.exit(0);
}

for (const spec of extractArgs) {
  const eq = spec.indexOf('=');
  const outFile = spec.slice(0, eq);
  const rest = spec.slice(eq + 1);
  const [ranksPart, clipPart] = rest.split(':clip=');
  const ranks = ranksPart.split(',').map(Number);
  const clip = clipPart ? clipPart.split(',').map(Number) : null;

  const keep = new Set();
  for (const r of ranks) for (const v of ranked[r]) keep.add(v);

  const remap = new Map();
  const newPos = [], newNorm = [], newUV = [];
  const inClip = (v) => !clip || (pos.getElement(v, [])[1] >= clip[0] && pos.getElement(v, [])[1] <= clip[1]);
  for (const v of keep) {
    if (!inClip(v)) continue;
    remap.set(v, remap.size);
    newPos.push(...pos.getElement(v, []));
    if (norm) newNorm.push(...norm.getElement(v, []));
    if (uv) newUV.push(...uv.getElement(v, []));
  }
  const newIdx = [];
  for (let i = 0; i < ic.length; i += 3) {
    const [a, b, c] = [ic[i], ic[i + 1], ic[i + 2]];
    if (remap.has(a) && remap.has(b) && remap.has(c)) newIdx.push(remap.get(a), remap.get(b), remap.get(c));
  }

  const outDoc = cloneDocument(doc);
  const om = outDoc.getRoot().listMeshes()[0];
  const op = om.listPrimitives()[0];
  op.setAttribute('POSITION', outDoc.createAccessor().setType('VEC3').setArray(new Float32Array(newPos)));
  if (norm) op.setAttribute('NORMAL', outDoc.createAccessor().setType('VEC3').setArray(new Float32Array(newNorm)));
  if (uv) op.setAttribute('TEXCOORD_0', outDoc.createAccessor().setType('VEC2').setArray(new Float32Array(newUV)));
  op.setIndices(outDoc.createAccessor().setType('SCALAR').setArray(new Uint32Array(newIdx)));
  await io.write(outFile, outDoc);
  console.log(`${outFile}: ranks [${ranks.join(',')}]${clip ? ` clipped y=[${clip}]` : ''} -> ${remap.size} verts, ${newIdx.length / 3} tris`);
}
