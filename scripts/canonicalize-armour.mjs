// Bake a raw body/legs armour GLB (static mesh, worn shape) into a SKINNED
// mesh sharing the hero's own skeleton, so it deforms with every animation
// clip instead of just rigidly following one bone. Companion to
// fit-headgear.mjs (rigid-attach slots); full flow in docs/gear-3d-pipeline.md.
//
//   node scripts/canonicalize-armour.mjs <in.glb> <out.glb> --slot body|legs [--margins x,y,z] [--k 3]
//
// Two things happen, both against public/3d-samples/hero.glb (the fixed
// reference — re-run if the hero model or rig ever changes):
//
// 1. ALIGN — the source piece was worn on Tripo's own mannequin, not our
//    hero, so its proportions don't match. This recenters the mesh on its
//    own bbox and scales it UNIFORMLY (one factor on all 3 axes, derived
//    from matching the piece's own height to the hero's torso/legs region
//    height — measured live from the hero's bind-pose vertices dominantly
//    weighted to the relevant bones, no hardcoded constants to go stale).
//    Uniform, not per-axis, because a differently-proportioned mannequin
//    stretched independently per axis squashes/distorts the shape (a
//    pauldron sized for a stockier build flares out sideways if X gets
//    scaled less than Y); matching height and trusting the source piece's
//    own proportions for width/depth reads far more natural. --margins is
//    still a per-axis multiplier on TOP of the uniform factor for the rare
//    piece that needs a deliberate nudge (default 1,1,1 = pure uniform).
//
// 2. WEIGHT TRANSFER — each aligned armour vertex binds to its k nearest
//    hero SURFACE vertices (inverse-distance blend), but the candidate pool
//    is pre-filtered to hero vertices dominantly weighted to CANDIDATE_BONES
//    (the relevant torso/arm or hip/leg chain) — an unrestricted search
//    across the WHOLE body will happily match a chest-plate hem to the
//    nearest THIGH skin vertex once the piece is scaled into place, and the
//    plate tears the moment legs and torso move independently. Collapsing
//    each candidate bone to a single centroid point was tried and discarded
//    too: it stops the cross-contamination but loses the real shape of each
//    bone's region, so a broad bone (Waist) "wins" nearest-point for a wide
//    swath of vertices that are visually much closer to a neighbouring bone
//    (Spine02). Restricting candidate VERTICES, not bones, keeps the real
//    per-point surface detail while still ruling out anatomically unrelated
//    matches. Since the output mesh is added into hero.glb's OWN document
//    sharing its OWN skin/joint hierarchy, the assigned joint indices are
//    correct by construction — no separate skeleton to keep in sync, and no
//    runtime retargeting step needed. The hero's original mesh/node is
//    pruned from the output so only the new armour mesh + shared
//    skin/skeleton remain.
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

const HERO_PATH = new URL('../public/3d-samples/hero.glb', import.meta.url).pathname;

// REGION_BONES sizes the alignment bbox (torso/legs "core" only, keeps the
// height measurement from being thrown off by wide-swinging limbs).
// CANDIDATE_BONES is the wider set a vertex may actually be WEIGHTED to —
// includes the limb chain so sleeves/pauldrons/greaves that extend past the
// core torso/hip still bind to an arm/leg bone instead of falling back to
// the (much closer to the shell's outer surface, but semantically wrong)
// torso/pelvis bone. See the weight-transfer comment below for why this
// list, not the mesh's nearest SURFACE vertex, is what a shell vertex binds to.
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

const args = process.argv.slice(2);
const files = args.filter((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));
const [inFile, outFile] = files;
const argOf = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def; };
const slot = argOf('slot', null);
if (!inFile || !outFile || !REGION_BONES[slot]) {
  console.error('usage: node scripts/canonicalize-armour.mjs <in.glb> <out.glb> --slot body|legs [--margins x,y,z] [--k 3]');
  process.exit(1);
}
const margins = String(argOf('margins', '1,1,1')).split(',').map(Number);
const K = Number(argOf('k', '3'));

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

// load + align the raw armour mesh into that region
const armorDoc = await io.read(inFile);
const armorPrim = armorDoc.getRoot().listMeshes()[0].listPrimitives()[0];
const aPos = armorPrim.getAttribute('POSITION');
const aNorm = armorPrim.getAttribute('NORMAL');
const aUV = armorPrim.getAttribute('TEXCOORD_0');
const aIdx = armorPrim.getIndices();
const aN = aPos.getCount();
let aMin = [Infinity, Infinity, Infinity], aMax = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < aN; i++) { const p = aPos.getElement(i, []); for (let a = 0; a < 3; a++) { aMin[a] = Math.min(aMin[a], p[a]); aMax[a] = Math.max(aMax[a], p[a]); } }
const aSize = aMax.map((v, a) => v - aMin[a]);
const aCenter = aMax.map((v, a) => (v + aMin[a]) / 2);
const uniform = rSize[1] / (aSize[1] || 1); // height-matched, applied to all 3 axes
const scale = margins.map((m) => uniform * m);

const alignedPos = new Float32Array(aN * 3);
for (let i = 0; i < aN; i++) {
  const p = aPos.getElement(i, []);
  for (let a = 0; a < 3; a++) alignedPos[i * 3 + a] = (p[a] - aCenter[a]) * scale[a] + rCenter[a];
}
console.log(`${slot} align: scale ${scale.map((v) => v.toFixed(3))}`);

// Weight transfer: nearest hero SURFACE vertex, but the candidate pool is
// pre-filtered to hero vertices dominantly weighted to CANDIDATE_BONES only.
// Two things went wrong before landing here: (1) an unrestricted nearest-
// vertex search happily matched a chest-plate hem to the nearest THIGH skin
// vertex (they're geometrically close once the piece is scaled/positioned —
// nothing stops a search across the WHOLE body from finding an anatomically
// unrelated bone) — the plate then tore on any pose where legs and torso
// move independently. (2) collapsing each candidate bone to a single
// centroid point avoided that, but lost the actual shape of each bone's
// region — a broad bone like Waist has a centroid sitting near the middle
// of a wide spread, so it "wins" nearest-point for a big share of nearby
// vertices even where a neighbouring bone (Spine02) is the visually correct
// one for that specific point. Restricting the CANDIDATE VERTICES (not
// bones) to the relevant chain keeps the real per-point surface shape while
// still ruling out cross-contamination from anatomically unrelated bones.
const candidateIdx = new Set(CANDIDATE_BONES[slot].map((n) => jointNames.indexOf(n)));
const candidateVerts = []; // { pos:[x,y,z], joints:[4], weights:[4] }
for (let i = 0; i < heroN; i++) {
  const js = heroJoints.getElement(i, []), ws = heroWeights.getElement(i, []);
  let best = -1, bestW = 0;
  for (let k = 0; k < 4; k++) if (ws[k] > bestW) { bestW = ws[k]; best = js[k]; }
  if (!candidateIdx.has(best)) continue;
  candidateVerts.push({ pos: heroPos.getElement(i, []), joints: js, weights: ws });
}
console.log(`${slot} candidate verts: ${candidateVerts.length} (of ${heroN} hero verts)`);

const outJoints = new Uint8Array(aN * 4);
const outWeights = new Float32Array(aN * 4);
for (let i = 0; i < aN; i++) {
  const px = alignedPos[i * 3], py = alignedPos[i * 3 + 1], pz = alignedPos[i * 3 + 2];
  const best = []; // [d, vert]
  for (const v of candidateVerts) {
    const dx = px - v.pos[0], dy = py - v.pos[1], dz = pz - v.pos[2];
    const d = dx * dx + dy * dy + dz * dz;
    if (best.length < K) { best.push([d, v]); best.sort((a, b) => a[0] - b[0]); }
    else if (d < best[K - 1][0]) { best[K - 1] = [d, v]; best.sort((a, b) => a[0] - b[0]); }
  }
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

// texture: copy the armour's own material/texture into hero's document
const armorMat = armorPrim.getMaterial();
const armorTex = armorMat.getBaseColorTexture();
const newTex = heroDoc.createTexture().setImage(armorTex.getImage()).setMimeType(armorTex.getMimeType());
const newMat = heroDoc.createMaterial(`${slot}_armour`).setBaseColorTexture(newTex).setRoughnessFactor(armorMat.getRoughnessFactor()).setMetallicFactor(armorMat.getMetallicFactor());

const newMesh = heroDoc.createMesh(`${slot}_armour`);
const newPrim = heroDoc.createPrimitive()
  .setAttribute('POSITION', heroDoc.createAccessor().setType('VEC3').setArray(alignedPos))
  .setAttribute('JOINTS_0', heroDoc.createAccessor().setType('VEC4').setArray(outJoints))
  .setAttribute('WEIGHTS_0', heroDoc.createAccessor().setType('VEC4').setArray(outWeights))
  .setMaterial(newMat);
if (aNorm) {
  const norm = new Float32Array(aN * 3);
  for (let i = 0; i < aN; i++) { const v = aNorm.getElement(i, []); norm.set(v, i * 3); }
  newPrim.setAttribute('NORMAL', heroDoc.createAccessor().setType('VEC3').setArray(norm));
}
if (aUV) {
  const uv = new Float32Array(aN * 2);
  for (let i = 0; i < aN; i++) { const v = aUV.getElement(i, []); uv.set(v, i * 2); }
  newPrim.setAttribute('TEXCOORD_0', heroDoc.createAccessor().setType('VEC2').setArray(uv));
}
newPrim.setIndices(heroDoc.createAccessor().setType('SCALAR').setArray(aIdx.getArray()));
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
console.log(`${outFile}: ${aN} verts, ${aIdx.getCount() / 3} tris, shares hero's ${jointNames.length}-joint skeleton`);
console.log(`next: node scripts/process-3d-model.mjs ${outFile} <final.glb> --ratio 1.0 --tex 512`);
