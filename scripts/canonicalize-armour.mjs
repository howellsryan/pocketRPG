// Bake a FITTED body/legs/boots/gloves/cape armour GLB (static mesh, already
// positioned on the hero's bind-pose body — see docs/gear-asset-process.md
// for the Blender fitting step) into a SKINNED mesh sharing the hero's own
// skeleton, so it deforms with every animation clip instead of rigidly
// following one bone. Companion to fit-headgear.mjs (rigid-attach slots).
//
//   node scripts/canonicalize-armour.mjs <fitted.glb> <out.glb> --slot body|legs|boots|gloves|cape
//     [--k 3] [--keep-skin]
//
// INPUT CONTRACT: the mesh must already be fitted — same coordinate space,
// scale and pose as public/3d-samples/hero.glb (import hero.glb into
// Blender, arrange the piece on the body, export). This tool deliberately
// does NO automatic alignment or reshaping: two days of attempts (uniform
// height-match scaling, per-vertex shrinkwrap with smoothed displacement,
// per-bone affine blends) proved that auto-fitting an asset authored on a
// different mannequin either leaves it misfitted or destroys its authored
// shape. Fitting is a one-time, few-minute human step per base asset;
// everything downstream of it is automated and reliable. A bounds check
// warns loudly if the input doesn't overlap the hero's region for the slot
// (the usual symptom of exporting in the wrong space or skipping the fit).
//
// What it does:
//
// 1. STRIP MANNEQUIN SKIN — generated suits are made worn, and split pieces
//    routinely keep welded scraps of the source mannequin (a neck stub in a
//    chest piece, bare toes poking out of sabatons). They're skin-coloured
//    texels on the armour's own atlas, so each triangle is sampled at 7 UV
//    points (corners, edge midpoints, centroid) and dropped when most read
//    as flesh tones (--keep-skin to disable for a piece that legitimately
//    uses skin-like colours). A corners-only test was tried first and kept
//    every boundary triangle where skin meets armour texels.
//
// 2. WEIGHT TRANSFER — each vertex binds to its k nearest hero SURFACE
//    vertices (inverse-distance blend of their actual skin weights).
//    Candidates are hero verts dominantly weighted to the slot's
//    CANDIDATE_BONES, grouped L/R/C by bone-name prefix; a vertex only
//    searches its own side (+C), so a left greave never binds a right-leg
//    bone while hip/waist blending still crosses over exactly where the
//    hero's own skin does. Restricting candidate VERTICES (not bones, and
//    not an unrestricted whole-body search) keeps per-point surface detail
//    while ruling out anatomically unrelated matches — see git history for
//    the two rejected approaches. The output mesh is added into hero.glb's
//    OWN document sharing its OWN skin/joint hierarchy, so joint indices
//    are correct by construction.
//
// Output is raw — run process-3d-model.mjs on it afterwards. Register with
// `{ "model": "<file>", "slot": "<slot>", ... }` under `gear` (covering
// pieces add hideBody/hideLegs — see docs/gear-asset-process.md); the
// runtime (attachGearList) recognises a skinned piece automatically (its
// geometry has JOINTS_0/WEIGHTS_0) and rebinds it to the hero's live
// skeleton instead of parenting it to a single bone.

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const HERO_PATH = new URL('../public/3d-samples/hero.glb', import.meta.url).pathname;

// Hero verts a piece may be weighted to, per slot: the anatomical chain the
// piece covers plus the joints it blends into at its edges.
const CANDIDATE_BONES = {
  body: [
    'Spine01', 'Spine02', 'Waist',
    'L_Clavicle', 'L_Upperarm', 'L_UpperarmTwist01', 'L_UpperarmTwist02', 'L_Forearm',
    'R_Clavicle', 'R_Upperarm', 'R_UpperarmTwist01', 'R_UpperarmTwist02', 'R_Forearm',
  ],
  legs: [
    'Hip', 'Pelvis', 'Waist',
    'L_Thigh', 'L_ThighTwist01', 'L_ThighTwist02', 'L_Calf', 'L_CalfTwist01', 'L_CalfTwist02', 'L_Foot', 'L_ToeBase',
    'R_Thigh', 'R_ThighTwist01', 'R_ThighTwist02', 'R_Calf', 'R_CalfTwist01', 'R_CalfTwist02', 'R_Foot', 'R_ToeBase',
  ],
  boots: [
    'L_Calf', 'L_CalfTwist01', 'L_CalfTwist02', 'L_Foot', 'L_ToeBase',
    'R_Calf', 'R_CalfTwist01', 'R_CalfTwist02', 'R_Foot', 'R_ToeBase',
  ],
  gloves: [
    'L_Forearm', 'L_ForearmTwist01', 'L_ForearmTwist02', 'L_Hand',
    'R_Forearm', 'R_ForearmTwist01', 'R_ForearmTwist02', 'R_Hand',
  ],
  cape: ['NeckTwist01', 'NeckTwist02', 'Spine01', 'Spine02', 'Waist', 'L_Clavicle', 'R_Clavicle'],
};

const args = process.argv.slice(2);
const files = args.filter((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));
const [inFile, outFile] = files;
const argOf = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def; };
const slot = argOf('slot', null);
if (!inFile || !outFile || !CANDIDATE_BONES[slot]) {
  console.error(`usage: node scripts/canonicalize-armour.mjs <fitted.glb> <out.glb> --slot ${Object.keys(CANDIDATE_BONES).join('|')} [--k 3] [--keep-skin]`);
  process.exit(1);
}
const K = Number(argOf('k', '3'));
const KEEP_SKIN = args.includes('--keep-skin');

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const heroDoc = await io.read(HERO_PATH);
const heroRoot = heroDoc.getRoot();
const heroSkin = heroRoot.listSkins()[0];
const jointNames = heroSkin.listJoints().map((j) => j.getName());
const heroNode = heroRoot.listNodes().find((n) => n.getSkin() === heroSkin);
const heroMesh = heroNode.getMesh();
const heroPrim = heroMesh.listPrimitives()[0];
const heroPos = heroPrim.getAttribute('POSITION');
const heroJoints = heroPrim.getAttribute('JOINTS_0');
const heroWeights = heroPrim.getAttribute('WEIGHTS_0');
const heroN = heroPos.getCount();

// candidate hero verts (dominantly weighted to the slot's chain), tagged by
// side, and the region bbox they span — used only to sanity-check the fit
const candidateIdx = new Set(CANDIDATE_BONES[slot].map((n) => jointNames.indexOf(n)));
const candidateVerts = []; // { pos:[3], joints:[4], weights:[4], side }
let rMin = [Infinity, Infinity, Infinity], rMax = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < heroN; i++) {
  const js = heroJoints.getElement(i, []), ws = heroWeights.getElement(i, []);
  let best = -1, bestW = 0;
  for (let k = 0; k < 4; k++) if (ws[k] > bestW) { bestW = ws[k]; best = js[k]; }
  if (!candidateIdx.has(best)) continue;
  const name = jointNames[best];
  const side = name.startsWith('L_') ? 'L' : name.startsWith('R_') ? 'R' : 'C';
  const pos = heroPos.getElement(i, []);
  for (let a = 0; a < 3; a++) { rMin[a] = Math.min(rMin[a], pos[a]); rMax[a] = Math.max(rMax[a], pos[a]); }
  candidateVerts.push({ pos, joints: js, weights: ws, side });
}
const pools = {
  L: candidateVerts.filter((v) => v.side !== 'R'),
  R: candidateVerts.filter((v) => v.side !== 'L'),
  ALL: candidateVerts,
};
console.log(`${slot} candidate verts: ${candidateVerts.length}`);

// ── load the fitted armour mesh into plain arrays ──
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

// fit sanity check happens after the skin strip (see below) — a fitted
// piece hugs the hero's surface, an unfitted one doesn't

// ── strip mannequin-skin triangles by sampling the texture ──
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
  if (dropped) console.log(`${slot} mannequin strip: dropped ${dropped} skin tris`);
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

// fit sanity check: on a piece fitted to the hero, ~every vertex sits within
// a few cm of the slot's skin (hero local units: body height 2.0 ≈ 1.8m, so
// 0.01 ≈ 1cm). An unfitted export (wrong space, wrong scale, fitting step
// skipped) puts a large share of vertices far from the surface — refuse to
// bake garbage silently.
{
  const dists = [];
  for (let i = 0; i < aN; i += 3) {
    const px = positions[i * 3], py = positions[i * 3 + 1], pz = positions[i * 3 + 2];
    let best = Infinity;
    for (const v of candidateVerts) {
      const dx = px - v.pos[0], dy = py - v.pos[1], dz = pz - v.pos[2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d < best) best = d;
    }
    dists.push(Math.sqrt(best));
  }
  dists.sort((a, b) => a - b);
  const p90 = dists[Math.floor(0.9 * (dists.length - 1))];
  if (p90 > 0.15) {
    console.error(`FIT CHECK FAILED for --slot ${slot}: 10% of vertices sit more than ${p90.toFixed(2)} units off the hero's ${slot} surface (limit 0.15 ≈ 13cm).`);
    console.error('  The input must be fitted onto public/3d-samples/hero.glb first (same space,');
    console.error('  scale and pose) — see docs/gear-asset-process.md, "Fit the piece in Blender".');
    process.exit(1);
  }
  console.log(`${slot} fit check: p90 surface distance ${p90.toFixed(3)}`);
}

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

// ── weight transfer (side-restricted k-NN) ──
const outJoints = new Uint8Array(aN * 4);
const outWeights = new Float32Array(aN * 4);
for (let i = 0; i < aN; i++) {
  const px = positions[i * 3], py = positions[i * 3 + 1], pz = positions[i * 3 + 2];
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

// normals: recompute from the (possibly skin-stripped) triangles —
// per-index accumulation keeps hard edges since split vertices stay split
const outNorm = new Float32Array(aN * 3);
for (let t = 0; t < indices.length; t += 3) {
  const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
  const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
  const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
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
  .setAttribute('POSITION', heroDoc.createAccessor().setType('VEC3').setArray(positions))
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
