#!/usr/bin/env node
// Derive a draft blend-shell humanoid spec for src/data/hero3d.json from the
// Tripo hero GLB (public/3d-samples/hero.glb), so the procedural hero keeps
// the proportions players already know. Measures each body segment from the
// skinned mesh (dominant-joint vertex clouds → axis radii) in the authoring
// frame (facing +z, feet at y=0), poses the T-pose arms down at the sides,
// and prints a spec draft + a measurement table. The draft is a starting
// point for hand-tuning via scripts/render-proc.mjs, not a finished creature.
//
// Run: node scripts/derive-hero-spec.mjs [path/to/hero.glb]
import path from 'path'
import { fileURLToPath } from 'url'

const require = (await import('module')).createRequire(import.meta.url)
const { NodeIO } = require('@gltf-transform/core')
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions')
const { MeshoptDecoder } = require('meshoptimizer')

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const glbPath = process.argv[2] || path.join(ROOT, 'public/3d-samples/hero.glb')

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
const doc = await io.read(glbPath)
const root = doc.getRoot()
const skin = root.listSkins()[0]
if (!skin) { console.error('no skin in ' + glbPath); process.exit(1) }
const joints = skin.listJoints()
const jointName = joints.map((j) => j.getName())

// Joint bind positions must come from the inverse bind matrices, in MESH
// space: quantized GLBs bake the dequantization transform into the IBMs, so
// node world matrices live in a differently-scaled frame than the vertices.
const ibmAcc = skin.getInverseBindMatrices()
const jointPos = joints.map((_, k) => {
  const m = []
  ibmAcc.getElement(k, m)
  // full affine inverse (IBMs carry scale): p = -A⁻¹·t
  const a = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]] // row-major 3x3
  const det = a[0] * (a[4] * a[8] - a[5] * a[7]) - a[1] * (a[3] * a[8] - a[5] * a[6]) + a[2] * (a[3] * a[7] - a[4] * a[6])
  const inv = [
    (a[4] * a[8] - a[5] * a[7]) / det, (a[2] * a[7] - a[1] * a[8]) / det, (a[1] * a[5] - a[2] * a[4]) / det,
    (a[5] * a[6] - a[3] * a[8]) / det, (a[0] * a[8] - a[2] * a[6]) / det, (a[2] * a[3] - a[0] * a[5]) / det,
    (a[3] * a[7] - a[4] * a[6]) / det, (a[1] * a[6] - a[0] * a[7]) / det, (a[0] * a[4] - a[1] * a[3]) / det,
  ]
  const t = [m[12], m[13], m[14]]
  return [
    -(inv[0] * t[0] + inv[1] * t[1] + inv[2] * t[2]),
    -(inv[3] * t[0] + inv[4] * t[1] + inv[5] * t[2]),
    -(inv[6] * t[0] + inv[7] * t[1] + inv[8] * t[2]),
  ]
})

// getElement (not getArray): POSITION/WEIGHTS may be KHR_mesh_quantization
// normalized ints, and getElement is what dequantizes them.
const prim = root.listMeshes()[0].listPrimitives()[0]
const posAcc = prim.getAttribute('POSITION')
const jidxAcc = prim.getAttribute('JOINTS_0')
const jwtAcc = prim.getAttribute('WEIGHTS_0')
const vertCount = posAcc.getCount()

// Twist/helper bones fold into their anatomical parent so clouds are coherent.
const CANON = (name) => name
  .replace(/(Thigh|Calf|Upperarm|Forearm|Neck)Twist\d+/, '$1')
  .replace(/NeckTwist\d+/, 'Neck')
const nameOf = (k) => CANON(jointName[k] || '')

// Mesh space axes are arbitrary (this GLB has the arms spanning z). Find the
// facing direction from a toe joint minus its ankle, then rotate everything
// into the authoring frame: facing +z, y up.
const jp = {}
for (let k = 0; k < joints.length; k++) jp[jointName[k]] = jointPos[k]
const toeDir = sub2(jp.L_ToeBase, jp.L_Foot)
toeDir[1] = 0
const toAuthoring = (() => {
  // pick the dominant horizontal axis of the toe direction → +z
  if (Math.abs(toeDir[0]) > Math.abs(toeDir[2])) {
    const s = Math.sign(toeDir[0]) || 1
    return (p) => [-s * p[2], p[1], s * p[0]] // rotate ±90° about y
  }
  const s = Math.sign(toeDir[2]) || 1
  return (p) => [s * p[0], p[1], s * p[2]] // identity or 180°
})()
function sub2(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }

const clouds = new Map()
const pEl = [], jEl = [], wEl = []
for (let v = 0; v < vertCount; v++) {
  posAcc.getElement(v, pEl)
  jidxAcc.getElement(v, jEl)
  jwtAcc.getElement(v, wEl)
  let best = 0, bestW = -1
  for (let s = 0; s < 4; s++) if (wEl[s] > bestW) { bestW = wEl[s]; best = jEl[s] }
  const key = nameOf(best)
  if (!clouds.has(key)) clouds.set(key, [])
  clouds.get(key).push(toAuthoring([pEl[0], pEl[1], pEl[2]]))
}
const J = {}
for (let k = 0; k < joints.length; k++) J[jointName[k]] = toAuthoring(jointPos[k])

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const len = (a) => Math.hypot(a[0], a[1], a[2])
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const rnd = (x) => Math.round(x * 1000) / 1000
const r3 = (v) => v.map(rnd)

// p70 radial distance of a cloud from the segment axis a→b.
function axisRadius(cloudNames, a, b) {
  const pts = []
  for (const n of [].concat(cloudNames)) if (clouds.has(n)) pts.push(...clouds.get(n))
  if (!pts.length) return 0
  const ab = sub(b, a)
  const abLen2 = Math.max(1e-9, ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2)
  const ds = pts.map((p) => {
    const ap = sub(p, a)
    const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / abLen2))
    return len(sub(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]))
  }).sort((x, y) => x - y)
  return ds[Math.floor(ds.length * 0.7)]
}
function cloudBounds(name) {
  const pts = clouds.get(name) || []
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (const p of pts) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]) }
  return { lo, hi }
}

// Feet vertices weight mostly to ToeBase in this rig — fold toes into feet.
for (const s of ['L', 'R']) {
  const foot = clouds.get(s + '_Foot') || []
  foot.push(...(clouds.get(s + '_ToeBase') || []))
  clouds.set(s + '_Foot', foot)
}

// Ground the frame: feet on y=0.
const footLo = Math.min(cloudBounds('L_Foot').lo[1], cloudBounds('R_Foot').lo[1])
for (const k of Object.keys(J)) J[k][1] -= footLo
for (const pts of clouds.values()) for (const p of pts) p[1] -= footLo

const headB = cloudBounds('Head')
const measure = {}
measure.head = { center: lerp(J.Head, [J.Head[0], headB.hi[1], J.Head[2]], 0.45), r: axisRadius('Head', J.Head, [J.Head[0], headB.hi[1], J.Head[2]]) }
measure.chest = { a: J.Spine01, b: J.NeckTwist01, r: axisRadius(['Spine01', 'Spine02'], J.Spine01, J.NeckTwist01) }
measure.hips = { a: J.Pelvis, r: axisRadius(['Pelvis', 'Waist', 'Hip'], J.Pelvis, J.Spine01) }
for (const s of ['L', 'R']) {
  measure[s + '_arm'] = {
    shoulder: J[s + '_Upperarm'], elbow: J[s + '_Forearm'], hand: J[s + '_Hand'],
    rUpper: axisRadius(s + '_Upperarm', J[s + '_Upperarm'], J[s + '_Forearm']),
    rFore: axisRadius(s + '_Forearm', J[s + '_Forearm'], J[s + '_Hand']),
    rHand: axisRadius(s + '_Hand', J[s + '_Hand'], J[s + '_Hand']),
  }
  measure[s + '_leg'] = {
    hip: J[s + '_Thigh'], knee: J[s + '_Calf'], foot: J[s + '_Foot'], toe: J[s + '_ToeBase'],
    rThigh: axisRadius(s + '_Thigh', J[s + '_Thigh'], J[s + '_Calf']),
    rCalf: axisRadius(s + '_Calf', J[s + '_Calf'], J[s + '_Foot']),
    rFoot: axisRadius(s + '_Foot', J[s + '_Foot'], J[s + '_ToeBase']),
  }
}

console.error('— measurements (authoring frame: +z facing, feet y=0) —')
for (const [k, v] of Object.entries(measure)) console.error(k, JSON.stringify(v, (kk, vv) => typeof vv === 'number' ? rnd(vv) : vv))
console.error('— cloud sizes —', [...clouds.entries()].map(([k, v]) => `${k}:${v.length}`).join(' '))

// T-pose arms point along ±x; pose them down at the sides by rotating each
// arm chain ~68° about the shoulder's z-axis (elbows slightly bent forward).
function poseArm(side) {
  const m = measure[side + '_arm']
  const sgn = m.shoulder[0] < 0 ? -1 : 1
  const drop = (p, deg) => {
    const d = sub(p, m.shoulder)
    const th = (deg * Math.PI / 180) * sgn
    const c = Math.cos(th), s = Math.sin(th)
    // rotate about z: x' = x·c + y·s·sgn-adjusted, lower the arm toward -y
    return [m.shoulder[0] + d[0] * c + d[1] * s * sgn, m.shoulder[1] + (-d[0] * s * sgn + d[1] * c), m.shoulder[2] + d[2]]
  }
  const elbow = drop(m.elbow, 68)
  const handT = drop(m.hand, 68)
  // bend the forearm a touch forward so hands don't glue to the thighs
  const hand = [handT[0], handT[1] + 0.01, handT[2] + 0.05]
  return { shoulder: m.shoulder, elbow, hand, rUpper: m.rUpper, rFore: m.rFore, rHand: m.rHand }
}
const armL = poseArm('L'), armR = poseArm('R')

const P = (id, a, b, r1, r2, color, extra = {}) =>
  ({ id, a: r3(a), b: r3(b), r1: rnd(r1), r2: rnd(r2), color, ...extra })

const spec = {
  height: 1.8,
  archetype: 'humanoid',
  palette: ['#c8996c', '#5a3d28', '#7a5a3a', '#4a3828', '#2e2620'],
  parts: [
    P('hips', [0, measure.hips.a[1], measure.hips.a[2]], [0, measure.chest.a[1], measure.chest.a[2]], measure.hips.r, measure.chest.r * 0.92, 2, { blend: 0.06 }),
    P('chest', measure.chest.a, measure.chest.b, measure.chest.r, measure.chest.r * 0.78, 2, { blend: 0.06 }),
    P('head', lerp(J.NeckTwist01, measure.head.center, 0.35), measure.head.center, measure.head.r * 0.55, measure.head.r, 0, { blend: 0.045 }),
    P('hair', [measure.head.center[0], measure.head.center[1] + measure.head.r * 0.45, measure.head.center[2] - measure.head.r * 0.35], [measure.head.center[0], measure.head.center[1] + measure.head.r * 0.62, measure.head.center[2] + measure.head.r * 0.15], measure.head.r * 0.72, measure.head.r * 0.82, 1, { blend: 0.03 }),
    P('armL', armL.shoulder, armL.elbow, armL.rUpper, armL.rUpper * 0.8, 0, { blend: 0.05 }),
    P('foreL', armL.elbow, armL.hand, armL.rFore, armL.rHand, 0, { blend: 0.04 }),
    P('armR', armR.shoulder, armR.elbow, armR.rUpper, armR.rUpper * 0.8, 0, { blend: 0.05 }),
    P('foreR', armR.elbow, armR.hand, armR.rFore, armR.rHand, 0, { blend: 0.04 }),
    P('legL', measure.L_leg.hip, [measure.L_leg.foot[0], Math.max(0.04, measure.L_leg.foot[1]), measure.L_leg.foot[2]], measure.L_leg.rThigh, measure.L_leg.rCalf * 0.85, 3, { blend: 0.05 }),
    P('legR', measure.R_leg.hip, [measure.R_leg.foot[0], Math.max(0.04, measure.R_leg.foot[1]), measure.R_leg.foot[2]], measure.R_leg.rThigh, measure.R_leg.rCalf * 0.85, 3, { blend: 0.05 }),
    P('footL', [measure.L_leg.foot[0], measure.L_leg.rFoot * 0.9, measure.L_leg.foot[2] - 0.02], [measure.L_leg.toe[0], measure.L_leg.rFoot * 0.7, measure.L_leg.toe[2] + 0.06], measure.L_leg.rFoot, measure.L_leg.rFoot * 0.75, 4, { blend: 0.03 }),
    P('footR', [measure.R_leg.foot[0], measure.R_leg.rFoot * 0.9, measure.R_leg.foot[2] - 0.02], [measure.R_leg.toe[0], measure.R_leg.rFoot * 0.7, measure.R_leg.toe[2] + 0.06], measure.R_leg.rFoot, measure.R_leg.rFoot * 0.75, 4, { blend: 0.03 }),
  ],
  breathe: { parts: ['chest'], amp: 0.03, rate: 2.2 },
  head: { parts: ['head', 'hair'], anchor: r3(J.NeckTwist01), amp: 0.08 },
  legs: [
    { part: 'legL', foot: 'footL' },
    { part: 'legR', foot: 'footR' },
  ],
  arms: {
    left: { upper: ['armL'], lower: ['foreL'], anchor: r3(armL.shoulder), elbow: r3(armL.elbow) },
    // `grip` is authoring metadata: where weapon parts should place their hilt.
    right: { upper: ['armR'], lower: ['foreR'], anchor: r3(armR.shoulder), elbow: r3(armR.elbow), grip: r3(armR.hand) },
  },
}

console.log(JSON.stringify(spec, null, 2))
