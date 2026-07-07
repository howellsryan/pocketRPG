#!/usr/bin/env node
// Retarget skeletal animations from a source GLB (e.g. Quaternius Universal
// Animation Library, UE-style bone names) onto a differently-rigged target GLB
// (e.g. a Tripo auto-rigged hero) using three.js SkeletonUtils.retargetClip.
// Runs three.js inside headless Chromium via Playwright because GLTFLoader/
// GLTFExporter need browser APIs (images, FileReader).
//
// Usage:
//   node scripts/retarget-animations.mjs --target hero.glb --source ual.glb --out hero.animated.glb
//     [--clips Idle_Loop,Sword_Attack] [--map bonemap.json] [--preview out-frames-dir]
//
// Prereqs: `npm i -D playwright` and (locally) `npx playwright install chromium`.
// The default bone map covers the Tripo rig -> UAL/UE "Manny" skeleton; pass
// --map with {"TargetBone": "sourceBone", ...} for other rig pairs. Unmapped
// bones (twist/finger bones) keep their rest pose and ride their parents.

import http from 'http';
import fs from 'fs';
import path from 'path';

const DEFAULT_MAP = {
  Hip: 'pelvis',
  Waist: 'spine_01', Spine01: 'spine_02', Spine02: 'spine_03',
  NeckTwist01: 'neck_01', Head: 'Head',
  L_Clavicle: 'clavicle_l', L_Upperarm: 'upperarm_l', L_Forearm: 'lowerarm_l', L_Hand: 'hand_l',
  R_Clavicle: 'clavicle_r', R_Upperarm: 'upperarm_r', R_Forearm: 'lowerarm_r', R_Hand: 'hand_r',
  L_Thigh: 'thigh_l', L_Calf: 'calf_l', L_Foot: 'foot_l', L_ToeBase: 'ball_l',
  R_Thigh: 'thigh_r', R_Calf: 'calf_r', R_Foot: 'foot_r', R_ToeBase: 'ball_r',
};

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i === -1 ? fallback : process.argv[i + 1];
}

const targetPath = arg('target');
const sourcePath = arg('source');
const outPath = arg('out', 'retargeted.glb');
const clipFilter = arg('clips', '');
const previewDir = arg('preview', '');
const mapPath = arg('map', '');
if (!targetPath || !sourcePath) {
  console.error('Usage: node scripts/retarget-animations.mjs --target hero.glb --source anims.glb --out out.glb');
  process.exit(1);
}
const boneMap = mapPath ? JSON.parse(fs.readFileSync(mapPath, 'utf8')) : DEFAULT_MAP;

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('playwright is required: npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}

const repoRoot = path.resolve(import.meta.dirname, '..');

const PAGE = /* html */ `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<script type="importmap">{ "imports": { "three": "/node_modules/three/build/three.module.js" } }</script>
</head><body>
<canvas id="c" width="480" height="480"></canvas>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from '/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from '/node_modules/three/examples/jsm/utils/SkeletonUtils.js';
import { GLTFExporter } from '/node_modules/three/examples/jsm/exporters/GLTFExporter.js';

const CFG = JSON.parse(document.getElementById('cfg').textContent);
const log = (...a) => window.__log(a.join(' '));

const findSkinned = (root) => {
  let m = null;
  root.traverse((o) => { if (o.isSkinnedMesh && !m) m = o; });
  return m;
};

// World-space facing yaw derived from the hand-to-hand axis at rest.
function facingAngle(skinned, lName, rName) {
  const bones = skinned.skeleton.bones;
  const l = bones.find((b) => b.name === lName).getWorldPosition(new THREE.Vector3());
  const r = bones.find((b) => b.name === rName).getWorldPosition(new THREE.Vector3());
  const f = new THREE.Vector3().crossVectors(l.sub(r).normalize(), new THREE.Vector3(0, 1, 0));
  return Math.atan2(f.x, f.z);
}

async function main() {
  const loader = new GLTFLoader();
  const [tgt, src] = await Promise.all([loader.loadAsync('/target.glb'), loader.loadAsync('/source.glb')]);
  const tgtMesh = findSkinned(tgt.scene);
  const srcMesh = findSkinned(src.scene);
  tgtMesh.skeleton.pose();
  srcMesh.skeleton.pose();
  tgt.scene.updateMatrixWorld(true);
  src.scene.updateMatrixWorld(true);

  const map = CFG.boneMap;
  const tgtBones = tgtMesh.skeleton.bones;
  const srcByName = {};
  srcMesh.skeleton.bones.forEach((b) => { srcByName[b.name] = b; });
  const missing = Object.entries(map).filter(([t, s]) =>
    !tgtBones.some((b) => b.name === t) || !srcByName[s]);
  if (missing.length) log('WARNING unmatched map entries:', JSON.stringify(missing));

  // Yaw-align target to source so world-space deltas transfer correctly.
  const [tHandL, tHandR] = CFG.targetHands;
  const [sHandL, sHandR] = CFG.sourceHands;
  tgt.scene.rotation.y = facingAngle(srcMesh, sHandL, sHandR) - facingAngle(tgtMesh, tHandL, tHandR);
  tgt.scene.updateMatrixWorld(true);

  const hipTgtName = Object.keys(map).find((k) => map[k] === CFG.hip);
  const hipScale = tgtBones.find((b) => b.name === hipTgtName).getWorldPosition(new THREE.Vector3()).y
    / srcByName[CFG.hip].getWorldPosition(new THREE.Vector3()).y;
  log('rotY', tgt.scene.rotation.y.toFixed(3), 'hipScale', hipScale.toFixed(4));

  // Per-bone rest-pose rotation offsets: srcRestWorld^-1 * tgtRestWorld.
  const localOffsets = {};
  for (const bone of tgtBones) {
    const srcBone = srcByName[map[bone.name]];
    if (!srcBone) continue;
    const qSrc = srcBone.getWorldQuaternion(new THREE.Quaternion());
    const qTgt = bone.getWorldQuaternion(new THREE.Quaternion());
    localOffsets[bone.name] = new THREE.Matrix4().makeRotationFromQuaternion(qSrc.invert().multiply(qTgt));
  }

  const wanted = CFG.clips.length ? new Set(CFG.clips) : null;
  const clips = [];
  for (const clip of src.animations) {
    if (wanted ? !wanted.has(clip.name) : clip.name === 'A_TPose') continue;
    const ret = SkeletonUtils.retargetClip(tgtMesh, srcMesh, clip, {
      names: { ...map },
      hip: CFG.hip,
      scale: hipScale,
      localOffsets,
      useFirstFramePosition: false,
    });
    for (const track of ret.tracks) track.name = track.name.replace(/^\\.bones\\[(.+?)\\]/, '$1');
    ret.resetDuration();
    clips.push(ret);
    log('retargeted', clip.name, ret.duration.toFixed(2) + 's');
  }

  tgt.scene.rotation.y = 0;
  tgtMesh.skeleton.pose();
  tgt.scene.updateMatrixWorld(true);

  const glb = await new GLTFExporter().parseAsync(tgt.scene, { binary: true, animations: clips });
  let bin = '';
  const bytes = new Uint8Array(glb);
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  await window.__saveFile(btoa(bin));
  log('exported', glb.byteLength, 'bytes,', clips.length, 'clips');

  if (CFG.preview) {
    const canvas = document.getElementById('c');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setClearColor(0x202830);
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.2));
    const d = new THREE.DirectionalLight(0xffffff, 2.2);
    d.position.set(2, 3, 2);
    scene.add(d);
    scene.add(tgt.scene);
    const box = new THREE.Box3().setFromObject(tgt.scene);
    const size = box.getSize(new THREE.Vector3()).length();
    const center = box.getCenter(new THREE.Vector3());
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
    camera.position.set(center.x + size, center.y + size * 0.3, center.z + size * 0.6);
    camera.lookAt(center);
    const mixer = new THREE.AnimationMixer(tgt.scene);
    for (const clip of clips.slice(0, CFG.previewMax)) {
      const action = mixer.clipAction(clip);
      action.play();
      for (const frac of [0.05, 0.5]) {
        mixer.setTime(clip.duration * frac);
        renderer.render(scene, camera);
        await window.__shot(clip.name + '_' + Math.round(frac * 100) + '.png', canvas.toDataURL('image/png'));
      }
      action.stop();
      mixer.uncacheClip(clip);
    }
  }
  window.__done();
}
main().catch((e) => { log('ERROR', e.stack || e.message); window.__done(); });
</script>
</body></html>`;

const cfg = {
  boneMap,
  hip: arg('hip', 'pelvis'),
  targetHands: [arg('target-hand-l', 'L_Hand'), arg('target-hand-r', 'R_Hand')],
  sourceHands: [arg('source-hand-l', 'hand_l'), arg('source-hand-r', 'hand_r')],
  clips: clipFilter ? clipFilter.split(',').map((s) => s.trim()).filter(Boolean) : [],
  preview: Boolean(previewDir),
  previewMax: Number(arg('preview-max', '8')),
};
const html = PAGE.replace('<canvas', `<script type="application/json" id="cfg">${JSON.stringify(cfg)}</script>\n<canvas`);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  try {
    let data;
    if (url === '/retarget.html') data = html;
    else if (url === '/target.glb') data = fs.readFileSync(targetPath);
    else if (url === '/source.glb') data = fs.readFileSync(sourcePath);
    else if (url.startsWith('/node_modules/')) data = fs.readFileSync(path.join(repoRoot, url));
    else throw new Error('nope');
    res.writeHead(200, { 'content-type': MIME[path.extname(url)] || 'text/html' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found: ' + url);
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const executablePath = process.env.CHROMIUM_PATH
  || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({
  executablePath,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
let done;
const finished = new Promise((r) => { done = r; });
await page.exposeFunction('__log', (s) => console.log(s));
await page.exposeFunction('__saveFile', (b64) => {
  fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
  console.log('wrote', outPath);
});
await page.exposeFunction('__shot', (name, dataUrl) => {
  fs.mkdirSync(previewDir, { recursive: true });
  fs.writeFileSync(path.join(previewDir, name), Buffer.from(dataUrl.split(',')[1], 'base64'));
});
await page.exposeFunction('__done', () => done());
await page.goto(`http://127.0.0.1:${port}/retarget.html`);
const timedOut = await Promise.race([
  finished.then(() => false),
  new Promise((r) => setTimeout(() => r(true), 600000)),
]);
await browser.close();
server.close();
if (timedOut) {
  console.error('timed out');
  process.exit(1);
}
