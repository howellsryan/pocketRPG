// Bake a weapon GLB into the canonical grip space so ONE registry transform
// (equipmentModels.json `defaults.weapon`) places every weapon in the hero's
// hand — no per-item tuning. Canonical space: grip point at the origin, blade
// pointing +Y, blade-axis length exactly 1 unit.
//
//   node scripts/canonicalize-weapon.mjs <in.glb> <out.glb> [--grip 0.12] [--flip] [--json]
//
// Heuristic: the bounding-box longest axis is the blade axis; the grip end is
// the end with the smaller mean cross-section (handles are thinner than
// blades); the grip point sits --grip (default 12%) of the length in from
// that end. --flip overrides the grip-end pick when a weapon fools the
// heuristic (e.g. a mace with a slim head). --json prints machine-readable
// results incl. the canonicalization matrix, mainly for inspection.
//
// Since the canonical grip point IS the mesh origin, `defaults.weapon.position`
// should stay at (or very near) [0, 0, 0] — attaching a canonical weapon to
// the hand bone with a zero offset already puts the grip exactly at the
// bone. Only rotationDeg (which way +Y/blade-forward should point relative to
// the bone's own axes) and scale need real tuning; verify with the aligner
// (public/3d-preview.html) rather than re-deriving position algebraically —
// composing this matrix with an old non-canonical tuned transform is an easy
// place to introduce a scale-vs-translation-order bug that LOOKS plausible in
// a single static screenshot but places the grip far from the hand once
// checked numerically (getWorldPosition distance to the hand bone).
//
// Run on the PROCESSED (post process-3d-model.mjs) file, before recolour
// variants — variants inherit canonical geometry for free.

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import * as THREE from 'three';

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? def : Number(process.argv[i + 1]);
}

const [inFile, outFile] = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && (i === 0 || !all[i - 1].startsWith('--')));
if (!inFile || !outFile) {
  console.error('usage: node scripts/canonicalize-weapon.mjs <in.glb> <out.glb> [--grip 0.12] [--flip] [--json]');
  process.exit(1);
}
const gripFrac = arg('--grip', 0.12);
const flip = process.argv.includes('--flip');
const asJson = process.argv.includes('--json');

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;

const doc = await io.read(inFile);
const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];

// World-space vertex cloud.
const points = [];
const collect = (node) => {
  const mesh = node.getMesh();
  if (mesh) {
    const world = new THREE.Matrix4().fromArray(node.getWorldMatrix());
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const count = pos.getCount();
      const stride = Math.max(1, Math.floor(count / 20000));
      const el = [];
      for (let i = 0; i < count; i += stride) {
        pos.getElement(i, el);
        points.push(new THREE.Vector3(el[0], el[1], el[2]).applyMatrix4(world));
      }
    }
  }
  for (const child of node.listChildren()) collect(child);
};
for (const node of scene.listChildren()) collect(node);
if (points.length < 3) {
  console.error('No geometry found.');
  process.exit(1);
}

const box = new THREE.Box3().setFromPoints(points);
const size = box.getSize(new THREE.Vector3());
const dims = ['x', 'y', 'z'];
const axis = dims[[size.x, size.y, size.z].indexOf(Math.max(size.x, size.y, size.z))];
const others = dims.filter((d) => d !== axis);
const len = size[axis];

// Cross-section per slice along the blade axis → the thinner end is the grip.
const BINS = 12;
const bins = Array.from({ length: BINS }, () => ({
  min0: Infinity, max0: -Infinity, min1: Infinity, max1: -Infinity, n: 0,
}));
for (const p of points) {
  const t = Math.min(BINS - 1, Math.floor(((p[axis] - box.min[axis]) / len) * BINS));
  const b = bins[t];
  b.min0 = Math.min(b.min0, p[others[0]]); b.max0 = Math.max(b.max0, p[others[0]]);
  b.min1 = Math.min(b.min1, p[others[1]]); b.max1 = Math.max(b.max1, p[others[1]]);
  b.n++;
}
const area = (b) => (b.n === 0 ? 0 : (b.max0 - b.min0) * (b.max1 - b.min1));
const lowArea = area(bins[0]) + area(bins[1]);
const highArea = area(bins[BINS - 1]) + area(bins[BINS - 2]);
let gripAtMin = lowArea <= highArea;
if (flip) gripAtMin = !gripAtMin;

// Rotation mapping the blade direction (grip → tip) onto +Y.
const bladeDir = { axis, sign: gripAtMin ? 1 : -1 };
const ROT = {
  'x+1': new THREE.Euler(0, 0, Math.PI / 2),
  'x-1': new THREE.Euler(0, 0, -Math.PI / 2),
  'y+1': new THREE.Euler(0, 0, 0),
  'y-1': new THREE.Euler(Math.PI, 0, 0),
  'z+1': new THREE.Euler(-Math.PI / 2, 0, 0),
  'z-1': new THREE.Euler(Math.PI / 2, 0, 0),
};
const rot = ROT[`${bladeDir.axis}${bladeDir.sign > 0 ? '+1' : '-1'}`];

// Grip point: --grip of the way along the axis from the grip end, centred on
// the grip-end slice in the other two dims (better than bbox centre for
// curved blades).
const gripBin = bins[gripAtMin ? 0 : BINS - 1];
const g = new THREE.Vector3();
g[axis] = gripAtMin ? box.min[axis] + gripFrac * len : box.max[axis] - gripFrac * len;
g[others[0]] = (gripBin.min0 + gripBin.max0) / 2;
g[others[1]] = (gripBin.min1 + gripBin.max1) / 2;

// C: p' = s · R · (p - g), with s normalising blade length to 1.
const s = 1 / len;
const C = new THREE.Matrix4()
  .makeScale(s, s, s)
  .multiply(new THREE.Matrix4().makeRotationFromEuler(rot))
  .multiply(new THREE.Matrix4().makeTranslation(-g.x, -g.y, -g.z));

for (const node of scene.listChildren()) {
  const local = new THREE.Matrix4().fromArray(node.getMatrix());
  node.setMatrix(local.premultiply(C).toArray());
}

await io.write(outFile, doc);

const report = {
  bladeAxis: `${bladeDir.sign > 0 ? '+' : '-'}${axis}`,
  gripEnd: gripAtMin ? 'min' : 'max',
  length: Number(len.toFixed(4)),
  gripPoint: [g.x, g.y, g.z].map((v) => Number(v.toFixed(4))),
  crossSections: { gripSide: Number(lowArea.toFixed(4)), tipSide: Number(highArea.toFixed(4)) },
  canonicalMatrix: C.toArray(),
};
if (asJson) console.log(JSON.stringify(report));
else console.log(`${outFile}  blade ${report.bladeAxis} len ${report.length} grip@${report.gripEnd} (${flip ? 'flipped' : 'auto'}) — canonical: grip at origin, blade +Y, length 1`);
