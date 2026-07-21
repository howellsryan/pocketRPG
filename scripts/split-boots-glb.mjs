// Split a paired-boots GLB (both boots in one Tripo upload) into a left-foot
// and right-foot GLB for the rigid per-foot boots slot (docs/gear-3d-pipeline.md
// "Boots are the exception"). Companion to split-gear-glb.mjs, but purpose-built
// for boots: the two boots are topologically-separate welded surfaces whose XZ
// footprints OVERLAP (tall boots lean toward each other), so position/k-means
// clustering fails — connected components do not.
//
//   node scripts/split-boots-glb.mjs <in.glb> <outLeft.glb> <outRight.glb> [--eps 0.0015]
//
// Weld+floodfill into islands (same as split-gear-glb.mjs), take the two
// largest as the boot shells, fold every smaller island (buckles/straps) into
// its nearest boot by centroid, and recentre each output to XZ-centre = origin,
// Y-min = 0 so a per-foot bone transform is symmetric. The lower-mean-X boot is
// written as "left" (model -X side). Output is raw — run process-3d-model.mjs on
// each afterwards (--ratio 1.0 --tex 512), then wire the two files into
// defaults.gear.boots.{left,right} and tune in public/3d-preview.html.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { cloneDocument } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith('--'));
const [inFile, outLeft, outRight] = files;
const epsI = args.indexOf('--eps');
const eps = epsI >= 0 ? Number(args[epsI + 1]) : 0.0015;
if (!inFile || !outLeft || !outRight) {
  console.error('usage: node scripts/split-boots-glb.mjs <in.glb> <outLeft.glb> <outRight.glb> [--eps 0.0015]');
  process.exit(1);
}

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(inFile);
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const pos = prim.getAttribute('POSITION'), norm = prim.getAttribute('NORMAL'), uv = prim.getAttribute('TEXCOORD_0');
const ic = prim.getIndices().getArray();
const n = pos.getCount();

// union-find over shared triangle vertices + spatially-close vertices (weld)
const parent = new Int32Array(n);
for (let i = 0; i < n; i++) parent[i] = i;
const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
for (let i = 0; i < ic.length; i += 3) { union(ic[i], ic[i + 1]); union(ic[i + 1], ic[i + 2]); }
const grid = new Map();
for (let i = 0; i < n; i++) {
  const p = pos.getElement(i, []);
  const cx = Math.round(p[0] / eps), cy = Math.round(p[1] / eps), cz = Math.round(p[2] / eps);
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
    const b = grid.get(`${cx + dx}_${cy + dy}_${cz + dz}`);
    if (b) for (const j of b) union(i, j);
  }
  const k = `${cx}_${cy}_${cz}`;
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(i);
}
const groups = new Map();
for (let i = 0; i < n; i++) { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); }
const ranked = [...groups.values()].sort((a, b) => b.length - a.length);

const centroid = (verts) => {
  const c = [0, 0, 0];
  for (const v of verts) { const p = pos.getElement(v, []); c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
  return c.map((x) => x / verts.length);
};
const bootA = ranked[0], bootB = ranked[1];
const ca = centroid(bootA), cb = centroid(bootB);
const sideVerts = [[], []];
for (const isl of ranked) {
  const c = centroid(isl);
  const da = (c[0] - ca[0]) ** 2 + (c[2] - ca[2]) ** 2, db = (c[0] - cb[0]) ** 2 + (c[2] - cb[2]) ** 2;
  const s = isl === bootA ? 0 : isl === bootB ? 1 : (db < da ? 1 : 0);
  for (const v of isl) sideVerts[s].push(v);
}
const order = ca[0] <= cb[0] ? [0, 1] : [1, 0]; // lower mean-X → left (model -X side)

for (const [out, side] of [[outLeft, order[0]], [outRight, order[1]]]) {
  const keep = new Set(sideVerts[side]);
  const remap = new Map();
  const nP = [], nN = [], nU = [];
  for (const v of keep) { remap.set(v, remap.size); nP.push(...pos.getElement(v, [])); if (norm) nN.push(...norm.getElement(v, [])); if (uv) nU.push(...uv.getElement(v, [])); }
  const nI = [];
  for (let i = 0; i < ic.length; i += 3) { const a = ic[i], b = ic[i + 1], c = ic[i + 2]; if (remap.has(a) && remap.has(b) && remap.has(c)) nI.push(remap.get(a), remap.get(b), remap.get(c)); }
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < nP.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], nP[i + k]); mx[k] = Math.max(mx[k], nP[i + k]); }
  const tx = -(mn[0] + mx[0]) / 2, ty = -mn[1], tz = -(mn[2] + mx[2]) / 2;
  for (let i = 0; i < nP.length; i += 3) { nP[i] += tx; nP[i + 1] += ty; nP[i + 2] += tz; }
  const outDoc = cloneDocument(doc);
  const op = outDoc.getRoot().listMeshes()[0].listPrimitives()[0];
  op.setAttribute('POSITION', outDoc.createAccessor().setType('VEC3').setArray(new Float32Array(nP)));
  if (norm) op.setAttribute('NORMAL', outDoc.createAccessor().setType('VEC3').setArray(new Float32Array(nN)));
  if (uv) op.setAttribute('TEXCOORD_0', outDoc.createAccessor().setType('VEC2').setArray(new Float32Array(nU)));
  op.setIndices(outDoc.createAccessor().setType('SCALAR').setArray(new Uint32Array(nI)));
  await io.write(out, outDoc);
  console.log(`${out}  verts=${remap.size} tris=${nI.length / 3}  size=[${mx.map((v, i) => (v - mn[i]).toFixed(3))}]`);
}
console.log('next: process-3d-model.mjs each output --ratio 1.0 --tex 512');
