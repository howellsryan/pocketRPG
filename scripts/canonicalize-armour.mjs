// Bake a raw body/legs armour GLB (static mesh, worn shape) into a SKINNED
// mesh sharing the hero's own skeleton, so it deforms with every animation
// clip instead of just rigidly following one bone. Companion to
// fit-headgear.mjs (rigid-attach slots); full flow in docs/gear-3d-pipeline.md.
//
//   node scripts/canonicalize-armour.mjs <in.glb> <out.glb> --slot body|legs
//     [--margins x,y,z] [--k 3] [--clear 0.035] [--keep-skin]
//
// Stages, all against public/3d-samples/hero.glb (the fixed reference —
// re-run if the hero model or rig ever changes):
//
// 1. STRIP MANNEQUIN SKIN — Tripo suits are generated worn, and the split
//    pieces routinely keep welded scraps of the mannequin itself (a neck
//    stub in a chest piece, bare toes poking out of sabatons). Those scraps
//    are skin-coloured texture on the armour's own atlas, so they can't be
//    dropped geometrically — each triangle's texels are sampled instead and
//    triangles whose corners all read as skin are removed (--keep-skin to
//    disable if a piece legitimately uses skin-like tones).
//
// 2. ALIGN — recenter the piece on its own bbox and scale it UNIFORMLY (one
//    factor on all 3 axes, from matching the piece's own height to the
//    hero's torso/legs region height, measured live from bind-pose vertices
//    dominantly weighted to REGION_BONES). Ballpark only — the mannequin's
//    proportions and stance don't match the hero.
//
// 3. WEIGHT TRANSFER — each vertex binds to its k nearest hero SURFACE
//    vertices (inverse-distance blend of their actual skin weights).
//    Candidates are hero verts dominantly weighted to CANDIDATE_BONES,
//    grouped L/R/C by bone-name prefix; a vertex only searches its own side
//    (+C), so a left plate never binds a right bone while hip/waist blending
//    still crosses over exactly where the hero's own skin does. Restricting
//    candidate VERTICES (not bones, and not an unrestricted whole-body
//    search) keeps per-point surface detail while ruling out anatomically
//    unrelated matches — see git history for the two rejected approaches.
//
// 4. BONE-ANCHORED WARP — a global similarity transform can never fit a
//    multi-limb piece: height-matching alone left a first-cut platelegs ~3x
//    wider-stanced than the hero's legs and a platebody sticking ~2/3 of
//    the hero's whole body depth out of its back; the weights were CORRECT,
//    so the suit deformed plausibly while hovering beside/behind the hero
//    (v1 shipped exactly this). A per-vertex shrinkwrap projection was
//    tried next and shattered the plates — neighbouring vertices project
//    onto different hero regions and the clamped displacement field tears
//    coherent panels apart. This warp instead computes ONE affine map per
//    bone — translate the armour's vertex cluster centroid onto the hero's
//    cluster for that bone, and scale RADIALLY (perpendicular to the bone
//    axis only) so the plate's girth becomes the hero's girth plus a
//    clearance — and blends the per-bone maps per vertex using the
//    transferred skin weights. Same smoothness class as skinning itself:
//    plates move near-rigidly within a bone's influence, seams blend, and
//    nothing can shatter. Normals are recomputed afterwards.
//
// The output mesh is added into hero.glb's OWN document sharing its OWN
// skin/joint hierarchy, so joint indices are correct by construction.
//
// Output is raw — run process-3d-model.mjs on it afterwards. Register with
// `{ "model": "<file>", "slot": "body"|"legs" }` under `gear`; the runtime
// (attachGearList) recognises a skinned piece automatically (its geometry
// has JOINTS_0/WEIGHTS_0) and rebinds it to the hero's live skeleton instead
// of parenting it to a single bone.

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const HERO_PATH = new URL('../public/3d-samples/hero.glb', import.meta.url).pathname;

// REGION_BONES sizes the alignment bbox (torso/legs "core" only, keeps the
// height measurement from being thrown off by wide-swinging limbs).
// CANDIDATE_BONES is the wider set a vertex may be weighted to — includes
// the limb chain so sleeves/pauldrons/greaves that extend past the core
// torso/hip still bind to an arm/leg bone.
const REGION_BONES = {
  body: ['Spine01', 'Spine02', 'Waist', 'L_Clavicle', 'R_Clavicle'],
  legs: ['Hip', 'Pelvis', 'L_Thigh', 'R_Thigh', 'L_Calf', 'R_Calf', 'L_Foot', 'R_Foot', 'L_ToeBase', 'R_ToeBase', 'L_ThighTwist01', 'R_ThighTwist01'],
};
const CANDIDATE_BONES = {
  body: [
    'Spine01', 'Spine02', 'Waist',
    'L_Clavicle', 'L_Upperarm', 'L_UpperarmTwist01', 'L_UpperarmTwist02', 'L_Forearm',
    'R_Clavicle', 'R_Upperarm', 'R_UpperarmTwist01', 'R_UpperarmTwist02', 'R_Forearm',
  ],
  legs: [
    'Hip', 'Pelvis',
    'L_Thigh', 'L_ThighTwist01', 'L_ThighTwist02', 'L_Calf', 'L_CalfTwist01', 'L_CalfTwist02', 'L_Foot', 'L_ToeBase',
    'R_Thigh', 'R_ThighTwist01', 'R_ThighTwist02', 'R_Calf', 'R_CalfTwist01', 'R_CalfTwist02', 'R_Foot', 'R_ToeBase',
  ],
};
// hero local units: full body height = 2.0, so 0.01 ≈ 1cm on a 1.8m person.
// clear = extra girth the plate keeps beyond the hero's own surface radius.
const DEFAULT_CLEAR = { body: 0.035, legs: 0.025 };

const args = process.argv.slice(2);
const files = args.filter((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));
const [inFile, outFile] = files;
const argOf = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def; };
const slot = argOf('slot', null);
if (!inFile || !outFile || !REGION_BONES[slot]) {
  console.error('usage: node scripts/canonicalize-armour.mjs <in.glb> <out.glb> --slot body|legs [--margins x,y,z] [--k 3] [--clear 0.035] [--keep-skin]');
  process.exit(1);
}
const margins = String(argOf('margins', '1,1,1')).split(',').map(Number);
const K = Number(argOf('k', '3'));
const CLEAR = Number(argOf('clear', DEFAULT_CLEAR[slot]));
const KEEP_SKIN = args.includes('--keep-skin');

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const heroDoc = await io.read(HERO_PATH);
const heroRoot = heroDoc.getRoot();
const heroSkin = heroRoot.listSkins()[0];
const joints = heroSkin.listJoints();
const jointNames = joints.map((j) => j.getName());
const heroNode = heroRoot.listNodes().find((n) => n.getSkin() === heroSkin);
const heroMesh = heroNode.getMesh();
const heroPrim = heroMesh.listPrimitives()[0];
const heroPos = heroPrim.getAttribute('POSITION');
const heroJoints = heroPrim.getAttribute('JOINTS_0');
const heroWeights = heroPrim.getAttribute('WEIGHTS_0');
const heroN = heroPos.getCount();

// joint bind-pose world positions + axis directions, from the skin's
// inverse bind matrices (bindWorld = inverse(IBM); axis = toward the mean
// of joint children, or away from the parent for leaf joints)
const invert4 = (m) => {
  // standard 4x4 inverse (column-major)
  const inv = new Array(16);
  inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
  inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
  inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
  inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
  inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
  inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
  inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
  inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
  inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
  inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
  inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
  inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
  inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
  inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
  inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
  inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
  let det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
  if (!det) return null;
  det = 1 / det;
  return inv.map((v) => v * det);
};
const ibm = heroSkin.getInverseBindMatrices();
const jointPos = joints.map((_, j) => {
  const m = invert4(ibm.getElement(j, []));
  return m ? [m[12], m[13], m[14]] : [0, 0, 0];
});
const jointIndexOf = new Map(joints.map((j, i) => [j, i]));
const jointAxis = joints.map((joint, j) => {
  const kids = joint.listChildren().filter((c) => jointIndexOf.has(c));
  let dir;
  if (kids.length) {
    dir = [0, 0, 0];
    for (const k of kids) { const p = jointPos[jointIndexOf.get(k)]; dir[0] += p[0] - jointPos[j][0]; dir[1] += p[1] - jointPos[j][1]; dir[2] += p[2] - jointPos[j][2]; }
  } else {
    const parent = joint.listParents().find((p) => jointIndexOf.has(p));
    const pp = parent ? jointPos[jointIndexOf.get(parent)] : [0, 0, 0];
    dir = [jointPos[j][0] - pp[0], jointPos[j][1] - pp[1], jointPos[j][2] - pp[2]];
  }
  const l = Math.hypot(...dir) || 1;
  return dir.map((v) => v / l);
});

// region bbox: hero verts dominantly weighted to this slot's bones
const wantedIdx = new Set(REGION_BONES[slot].map((n) => jointNames.indexOf(n)));
let rMin = [Infinity, Infinity, Infinity], rMax = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < heroN; i++) {
  const js = heroJoints.getElement(i, []), ws = heroWeights.getElement(i, []);
  let best = -1, bestW = 0;
  for (let k = 0; k < 4; k++) if (ws[k] > bestW) { bestW = ws[k]; best = js[k]; }
  if (!wantedIdx.has(best)) continue;
  const p = heroPos.getElement(i, []);
  for (let a = 0; a < 3; a++) { rMin[a] = Math.min(rMin[a], p[a]); rMax[a] = Math.max(rMax[a], p[a]); }
}
const rSize = rMax.map((v, a) => v - rMin[a]);
const rCenter = rMax.map((v, a) => (v + rMin[a]) / 2);
console.log(`${slot} region: size ${rSize.map((v) => v.toFixed(3))}, center ${rCenter.map((v) => v.toFixed(3))}`);

// ── load the raw armour mesh into plain arrays ──
const armorDoc = await io.read(inFile);
const armorPrim = armorDoc.getRoot().listMeshes()[0].listPrimitives()[0];
const aPosAcc = armorPrim.getAttribute('POSITION');
const aUVAcc = armorPrim.getAttribute('TEXCOORD_0');
const srcN = aPosAcc.getCount();
let positions = new Float32Array(srcN * 3);
let uvs = aUVAcc ? new Float32Array(srcN * 2) : null;
for (let i = 0; i < srcN; i++) {
  const p = aPosAcc.getElement(i, []);
  positions.set(p, i * 3);
  if (uvs) { const t = aUVAcc.getElement(i, []); uvs.set(t, i * 2); }
}
let indices = Array.from(armorPrim.getIndices().getArray());

// ── stage 1: strip mannequin-skin triangles by sampling the texture ──
const armorMat = armorPrim.getMaterial();
const armorTex = armorMat.getBaseColorTexture();
if (!KEEP_SKIN && uvs && armorTex) {
  const img = sharp(Buffer.from(armorTex.getImage()));
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const texel = (u, v) => {
    const x = Math.min(info.width - 1, Math.max(0, Math.floor((((u % 1) + 1) % 1) * info.width)));
    const y = Math.min(info.height - 1, Math.max(0, Math.floor((((v % 1) + 1) % 1) * info.height)));
    const o = (y * info.width + x) * info.channels;
    return [data[o], data[o + 1], data[o + 2]];
  };
  // pink/tan flesh; darker leather straps (low r) and cream cloth/fur
  // (low r-g) stay
  const isSkin = (u, v) => {
    const [r, g, b] = texel(u, v);
    return r >= 150 && r - b >= 30 && r - g >= 15 && g > b;
  };
  const keptIdx = [];
  for (let t = 0; t < indices.length; t += 3) {
    // sample 7 points across the triangle's UV footprint (corners, edge
    // midpoints, centroid) — a corner-only test keeps every boundary
    // triangle where mannequin skin meets the armour texels
    const [i0, i1, i2] = [indices[t], indices[t + 1], indices[t + 2]];
    const c = [[i0, i1], [i1, i2], [i0, i2]].map(([a, b]) => [(uvs[a * 2] + uvs[b * 2]) / 2, (uvs[a * 2 + 1] + uvs[b * 2 + 1]) / 2]);
    const samples = [
      [uvs[i0 * 2], uvs[i0 * 2 + 1]], [uvs[i1 * 2], uvs[i1 * 2 + 1]], [uvs[i2 * 2], uvs[i2 * 2 + 1]],
      ...c,
      [(uvs[i0 * 2] + uvs[i1 * 2] + uvs[i2 * 2]) / 3, (uvs[i0 * 2 + 1] + uvs[i1 * 2 + 1] + uvs[i2 * 2 + 1]) / 3],
    ];
    if (samples.filter(([u, v]) => isSkin(u, v)).length >= 4) continue;
    keptIdx.push(i0, i1, i2);
  }
  const dropped = (indices.length - keptIdx.length) / 3;
  indices = keptIdx;
  console.log(`${slot} mannequin strip: dropped ${dropped} skin tris`);
}
// compact away unreferenced vertices
{
  const remap = new Int32Array(srcN).fill(-1);
  let n = 0;
  for (const ix of indices) if (remap[ix] < 0) remap[ix] = n++;
  const np = new Float32Array(n * 3), nu = uvs ? new Float32Array(n * 2) : null;
  for (let i = 0; i < srcN; i++) {
    const r = remap[i];
    if (r < 0) continue;
    np.set(positions.subarray(i * 3, i * 3 + 3), r * 3);
    if (nu) nu.set(uvs.subarray(i * 2, i * 2 + 2), r * 2);
  }
  positions = np; uvs = nu;
  indices = indices.map((ix) => remap[ix]);
}
const aN = positions.length / 3;

// ── stage 2: align (uniform, height-matched) ──
let aMin = [Infinity, Infinity, Infinity], aMax = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < aN; i++) for (let a = 0; a < 3; a++) {
  aMin[a] = Math.min(aMin[a], positions[i * 3 + a]);
  aMax[a] = Math.max(aMax[a], positions[i * 3 + a]);
}
const aSize = aMax.map((v, a) => v - aMin[a]);
const aCenter = aMax.map((v, a) => (v + aMin[a]) / 2);
const uniform = rSize[1] / (aSize[1] || 1); // height-matched, applied to all 3 axes
const scale = margins.map((m) => uniform * m);
const alignedPos = new Float32Array(aN * 3);
for (let i = 0; i < aN; i++) for (let a = 0; a < 3; a++) {
  alignedPos[i * 3 + a] = (positions[i * 3 + a] - aCenter[a]) * scale[a] + rCenter[a];
}
console.log(`${slot} align: scale ${scale.map((v) => v.toFixed(3))}, ${aN} verts after strip`);

// ── candidate hero verts, tagged by side ──
const candidateIdx = new Set(CANDIDATE_BONES[slot].map((n) => jointNames.indexOf(n)));
const candidateVerts = []; // { pos:[3], joints:[4], weights:[4], side }
for (let i = 0; i < heroN; i++) {
  const js = heroJoints.getElement(i, []), ws = heroWeights.getElement(i, []);
  let best = -1, bestW = 0;
  for (let k = 0; k < 4; k++) if (ws[k] > bestW) { bestW = ws[k]; best = js[k]; }
  if (!candidateIdx.has(best)) continue;
  const name = jointNames[best];
  const side = name.startsWith('L_') ? 'L' : name.startsWith('R_') ? 'R' : 'C';
  candidateVerts.push({ pos: heroPos.getElement(i, []), joints: js, weights: ws, side });
}
const pools = {
  L: candidateVerts.filter((v) => v.side !== 'R'),
  R: candidateVerts.filter((v) => v.side !== 'L'),
  ALL: candidateVerts,
};
console.log(`${slot} candidate verts: ${candidateVerts.length}`);

const kNearest = (pool, px, py, pz, k) => {
  const best = []; // [d2, vert]
  for (const v of pool) {
    const dx = px - v.pos[0], dy = py - v.pos[1], dz = pz - v.pos[2];
    const d = dx * dx + dy * dy + dz * dz;
    if (best.length < k) { best.push([d, v]); best.sort((a, b) => a[0] - b[0]); }
    else if (d < best[k - 1][0]) { best[k - 1] = [d, v]; best.sort((a, b) => a[0] - b[0]); }
  }
  return best;
};

// ── stage 3: weight transfer (side-restricted k-NN) ──
const outJoints = new Uint8Array(aN * 4);
const outWeights = new Float32Array(aN * 4);
for (let i = 0; i < aN; i++) {
  const px = alignedPos[i * 3], py = alignedPos[i * 3 + 1], pz = alignedPos[i * 3 + 2];
  const side = kNearest(candidateVerts, px, py, pz, 1)[0][1].side;
  const pool = side === 'C' ? pools.ALL : pools[side];
  const best = kNearest(pool, px, py, pz, Math.min(K, pool.length));
  const acc = new Map(); // jointIdx -> weight
  let wsum = 0;
  for (const [d, v] of best) {
    const w = 1 / (d + 1e-8);
    wsum += w;
    for (let k = 0; k < 4; k++) acc.set(v.joints[k], (acc.get(v.joints[k]) || 0) + v.weights[k] * w);
  }
  const entries = [...acc.entries()].map(([j, w]) => [j, w / wsum]).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const total = entries.reduce((s, [, w]) => s + w, 0) || 1;
  for (let k = 0; k < 4; k++) {
    outJoints[i * 4 + k] = entries[k] ? entries[k][0] : 0;
    outWeights[i * 4 + k] = entries[k] ? entries[k][1] / total : 0;
  }
}
console.log(`${slot} weight transfer: ${aN} verts, nearest ${K} candidate vert(s)`);

// ── stage 4: bone-anchored warp ──
// per-bone weighted stats over hero verts and armour verts: centroid +
// mean radial distance from the bone's axis line
const radial = (p, j) => {
  const c = jointPos[j], d = jointAxis[j];
  const qx = p[0] - c[0], qy = p[1] - c[1], qz = p[2] - c[2];
  const t = qx * d[0] + qy * d[1] + qz * d[2];
  return Math.hypot(qx - t * d[0], qy - t * d[1], qz - t * d[2]);
};
const nJ = joints.length;
const hCent = Array.from({ length: nJ }, () => [0, 0, 0]);
const hRad = new Float64Array(nJ), hW = new Float64Array(nJ);
for (const v of candidateVerts) {
  for (let k = 0; k < 4; k++) {
    const j = v.joints[k], w = v.weights[k];
    if (!w) continue;
    hW[j] += w;
    hCent[j][0] += v.pos[0] * w; hCent[j][1] += v.pos[1] * w; hCent[j][2] += v.pos[2] * w;
    hRad[j] += radial(v.pos, j) * w;
  }
}
const aCent = Array.from({ length: nJ }, () => [0, 0, 0]);
const aRad = new Float64Array(nJ), aW = new Float64Array(nJ);
for (let i = 0; i < aN; i++) {
  const p = [alignedPos[i * 3], alignedPos[i * 3 + 1], alignedPos[i * 3 + 2]];
  for (let k = 0; k < 4; k++) {
    const j = outJoints[i * 4 + k], w = outWeights[i * 4 + k];
    if (!w) continue;
    aW[j] += w;
    aCent[j][0] += p[0] * w; aCent[j][1] += p[1] * w; aCent[j][2] += p[2] * w;
    aRad[j] += radial(p, j) * w;
  }
}
const MIN_MASS = 0.5; // total weight below this → too few verts to trust stats
const boneMap = new Array(nJ).fill(null);
for (let j = 0; j < nJ; j++) {
  if (hW[j] < MIN_MASS || aW[j] < MIN_MASS) continue;
  const hc = hCent[j].map((v) => v / hW[j]);
  const ac = aCent[j].map((v) => v / aW[j]);
  const hr = hRad[j] / hW[j], ar = aRad[j] / aW[j];
  const kRad = Math.min(1.5, Math.max(0.4, (hr + CLEAR) / (ar || 1e-6)));
  boneMap[j] = { hc, ac, kRad };
}
console.log(`${slot} bone warp: ${boneMap.filter(Boolean).length} bones mapped (clear ${CLEAR})`);

for (let i = 0; i < aN; i++) {
  const px = alignedPos[i * 3], py = alignedPos[i * 3 + 1], pz = alignedPos[i * 3 + 2];
  let ox = 0, oy = 0, oz = 0, wsum = 0;
  for (let k = 0; k < 4; k++) {
    const j = outJoints[i * 4 + k], w = outWeights[i * 4 + k];
    const map = boneMap[j];
    if (!w || !map) continue;
    wsum += w;
    // decompose about the armour cluster centroid along the bone axis
    const d = jointAxis[j];
    const qx = px - map.ac[0], qy = py - map.ac[1], qz = pz - map.ac[2];
    const t = qx * d[0] + qy * d[1] + qz * d[2];
    const rx = qx - t * d[0], ry = qy - t * d[1], rz = qz - t * d[2];
    ox += (map.hc[0] + t * d[0] + rx * map.kRad) * w;
    oy += (map.hc[1] + t * d[1] + ry * map.kRad) * w;
    oz += (map.hc[2] + t * d[2] + rz * map.kRad) * w;
  }
  if (wsum > 0) {
    alignedPos[i * 3] = ox / wsum;
    alignedPos[i * 3 + 1] = oy / wsum;
    alignedPos[i * 3 + 2] = oz / wsum;
  }
}

// recompute normals from the warped triangles (per-index accumulation keeps
// hard edges: split vertices stay split)
const outNorm = new Float32Array(aN * 3);
for (let t = 0; t < indices.length; t += 3) {
  const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
  const ux = alignedPos[b] - alignedPos[a], uy = alignedPos[b + 1] - alignedPos[a + 1], uz = alignedPos[b + 2] - alignedPos[a + 2];
  const vx = alignedPos[c] - alignedPos[a], vy = alignedPos[c + 1] - alignedPos[a + 1], vz = alignedPos[c + 2] - alignedPos[a + 2];
  const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
  for (const o of [a, b, c]) { outNorm[o] += fx; outNorm[o + 1] += fy; outNorm[o + 2] += fz; }
}
for (let i = 0; i < aN; i++) {
  const l = Math.hypot(outNorm[i * 3], outNorm[i * 3 + 1], outNorm[i * 3 + 2]) || 1;
  outNorm[i * 3] /= l; outNorm[i * 3 + 1] /= l; outNorm[i * 3 + 2] /= l;
}

// texture: copy the armour's own material/texture into hero's document
const newTex = heroDoc.createTexture().setImage(armorTex.getImage()).setMimeType(armorTex.getMimeType());
const newMat = heroDoc.createMaterial(`${slot}_armour`).setBaseColorTexture(newTex).setRoughnessFactor(armorMat.getRoughnessFactor()).setMetallicFactor(armorMat.getMetallicFactor());

const newMesh = heroDoc.createMesh(`${slot}_armour`);
const newPrim = heroDoc.createPrimitive()
  .setAttribute('POSITION', heroDoc.createAccessor().setType('VEC3').setArray(alignedPos))
  .setAttribute('NORMAL', heroDoc.createAccessor().setType('VEC3').setArray(outNorm))
  .setAttribute('JOINTS_0', heroDoc.createAccessor().setType('VEC4').setArray(outJoints))
  .setAttribute('WEIGHTS_0', heroDoc.createAccessor().setType('VEC4').setArray(outWeights))
  .setMaterial(newMat);
if (uvs) newPrim.setAttribute('TEXCOORD_0', heroDoc.createAccessor().setType('VEC2').setArray(uvs));
newPrim.setIndices(heroDoc.createAccessor().setType('SCALAR').setArray(new Uint32Array(indices)));
newMesh.addPrimitive(newPrim);

const newNode = heroDoc.createNode(`${slot}_armour`).setMesh(newMesh).setSkin(heroSkin);
heroRoot.listScenes()[0].addChild(newNode);

// drop the hero's own mesh/node AND all ~84 of its animation clips — they
// target the skeleton's joint nodes (never the mesh), so they're never
// "orphaned" by removing the mesh and would otherwise silently ride along
// into a static armour file. Then aggressive prune (no keepAttributes/
// keepIndices) so the orphaned original hero mesh's accessors/bufferViews/
// textures are actually removed, not just detached; otherwise
// EXT_meshopt_compression / EXT_texture_webp stay in extensionsRequired for
// buffers nothing still references, and a reader that (reasonably) didn't
// register decoders for extensions the file no longer needs refuses to open it.
heroNode.setMesh(null);
for (const anim of heroRoot.listAnimations()) anim.dispose();
// prune() alone leaves the original hero mesh, material and texture behind
// as zero-referrer orphans in some gltf-transform versions (reachability
// graph quirk — they're genuinely unreferenced by any node/primitive,
// confirmed by inspection, but survive the pass) — dispose them explicitly
// rather than trust prune to infer it.
for (const m of heroRoot.listMeshes()) if (m !== newMesh) m.dispose();
for (const m of heroRoot.listMaterials()) if (m !== newMat) m.dispose();
for (const t of heroRoot.listTextures()) if (t !== newTex) t.dispose();
await prune(heroDoc);

// belt-and-braces: drop any extension left with zero users after pruning
// (prune() clears property references but hasn't always dropped the now-
// unused Extension registration itself in every gltf-transform version).
for (const ext of heroRoot.listExtensionsUsed()) {
  if (ext.listProperties && ext.listProperties().length === 0) ext.dispose();
}

await io.write(outFile, heroDoc);
console.log(`${outFile}: ${aN} verts, ${indices.length / 3} tris, shares hero's ${jointNames.length}-joint skeleton`);
console.log(`next: node scripts/process-3d-model.mjs ${outFile} <final.glb> --ratio 1.0 --tex 512`);
