// SDF blend-shell creature runtime (docs/procedural-3d-plan.md §1).
//
// A creature is a list of rounded-cone primitives (sphere/capsule/cone
// unified). Each primitive gets a low-poly proxy capsule; the merged proxy
// mesh is snapped onto the smooth-min union isosurface in the vertex shader,
// normals come from the SDF gradient and per-primitive colors blend by
// proximity — so overlapping parts render as one seamless skin, and moving a
// primitive's endpoints (the "bones") keeps the skin fused. One draw call for
// the skin plus one for the ink outline (offset isosurface, back faces).
//
// Part flags: `buried` = shapes the field but builds no proxy geometry (fully
// inside the body, neighbours' vertices converge onto the blended surface);
// `colorOnly` = contributes color but no shape at all (paint patches — cow
// spots, muzzle tints — that ride the surface without bulging it).
//
// This module owns geometry, shaders, and uniform upload. Motion lives in
// rigs.js, which drives the pose API here: per-part matrices (`mats`), a
// whole-creature `rootMat`, absolute endpoint overrides for planted feet and
// rope segments (`overrideA/B` — root motion deliberately does NOT move
// these), and per-part `radiusScale`, then calls `commit()`.
//
// three.js is passed in by the caller (lazy-loaded via utils/three3d.js) so
// this module never touches the vendored bundle at eval time.

export const BLEND_SHELL_MAX_PARTS = 24

const BLEND_SHELL_ITERS = 10
const BLEND_SHELL_DEFAULT_BLEND = 0.1

export function buildBlendShellShaders(n) {
  const common = `
#define N ${n}
uniform vec4 uA[N];      // a.xyz, r1
uniform vec4 uB[N];      // b.xyz, r2
uniform vec3 uCol[N];
uniform float uK[N];
uniform float uShape[N]; // 0 = colorOnly (paint patch), 1 = shapes the field
uniform float uGlow[N];  // 1 = part pulses bright (boss accents)

float sdRoundCone(vec3 p, vec3 a, vec3 b, float r1, float r2){
  vec3 ba = b - a; float l2 = dot(ba,ba);
  float rr = r1 - r2; float a2 = l2 - rr*rr; float il2 = 1.0/l2;
  vec3 pa = p - a;
  float y = dot(pa,ba); float z = y - l2;
  vec3 xv = pa*l2 - ba*y; float x2 = dot(xv,xv);
  float y2 = y*y*l2; float z2 = z*z*l2;
  float k = sign(rr)*rr*rr*x2;
  if (sign(z)*a2*z2 > k) return sqrt(x2+z2)*il2 - r2;
  if (sign(y)*a2*y2 < k) return sqrt(x2+y2)*il2 - r1;
  return (sqrt(x2*a2*il2)+y*rr)*il2 - r1;
}
float sminP(float d1, float d2, float k){
  float h = clamp(0.5 + 0.5*(d2-d1)/k, 0.0, 1.0);
  return mix(d2, d1, h) - k*h*(1.0-h);
}
float field(vec3 p){
  float d = 1e5;
  for (int i=0;i<N;i++){
    if (uShape[i] < 0.5) continue;
    float di = sdRoundCone(p, uA[i].xyz, uB[i].xyz, uA[i].w, uB[i].w);
    d = sminP(di, d, uK[i]);
  }
  return d;
}
vec3 fieldGrad(vec3 p){
  const float e = 0.005;
  vec3 g = vec3(
    field(p+vec3(e,0.,0.)) - field(p-vec3(e,0.,0.)),
    field(p+vec3(0.,e,0.)) - field(p-vec3(0.,e,0.)),
    field(p+vec3(0.,0.,e)) - field(p-vec3(0.,0.,e)));
  float l = length(g);
  return l > 1e-6 ? g/l : vec3(0.,1.,0.);
}
vec3 fieldColor(vec3 p){
  vec3 acc = vec3(0.0); float wsum = 0.0;
  for (int i=0;i<N;i++){
    float di = sdRoundCone(p, uA[i].xyz, uB[i].xyz, uA[i].w, uB[i].w);
    float w = exp(-max(di,0.0)*42.0);
    // paint patches tint harder so they read as markings, not haze
    if (uShape[i] < 0.5) w *= 3.0;
    acc += uCol[i]*w; wsum += w;
  }
  return acc/max(wsum,1e-4);
}`

  const vertexShader = common + `
attribute float primIndex;
uniform mat4 uXf[N];
uniform float uOffset;   // 0 = skin, >0 = outline shell
varying vec3 vN; varying vec3 vW;
void main(){
  int pi = int(primIndex + 0.5);
  vec3 q = (uXf[pi] * vec4(position,1.0)).xyz;
  // Newton-style projection with oscillation damping: at concave creases the
  // gradient flips side-to-side; halving the step on a sign flip settles the
  // vertex onto the crease instead of streaking across it.
  float s = 0.7; float dPrev = 0.0;
  for (int it=0; it<${BLEND_SHELL_ITERS}; it++){
    float d = field(q) - uOffset;
    if (it > 0 && d * dPrev < 0.0) s *= 0.5;
    q -= fieldGrad(q) * clamp(d, -0.5, 0.5) * s;
    dPrev = d;
  }
  vN = fieldGrad(q);
  // Buried tuck: when this vertex's own primitive is buried beneath another
  // part here, sink it under the skin so its sliver triangles never poke
  // through or leave pixel gaps at deep folds.
  float dSelf = sdRoundCone(q, uA[pi].xyz, uB[pi].xyz, uA[pi].w, uB[pi].w);
  q -= vN * smoothstep(0.02, 0.06, dSelf - uOffset) * 0.015;
  vW = q;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(q,1.0);
}`

  const fragmentShader = `
precision highp float;
` + common + `
uniform float uToon; uniform float uOutlinePass;
uniform vec3 uFlashCol; uniform float uFlashAmt;
uniform float uTime; uniform float uDissolve;
varying vec3 vN; varying vec3 vW;

float dsHash(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float dsNoise(vec3 p){
  vec3 i = floor(p); vec3 f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(
    mix(mix(dsHash(i), dsHash(i+vec3(1.,0.,0.)), f.x), mix(dsHash(i+vec3(0.,1.,0.)), dsHash(i+vec3(1.,1.,0.)), f.x), f.y),
    mix(mix(dsHash(i+vec3(0.,0.,1.)), dsHash(i+vec3(1.,0.,1.)), f.x), mix(dsHash(i+vec3(0.,1.,1.)), dsHash(i+vec3(1.,1.,1.)), f.x), f.y),
    f.z);
}
float glowWeight(vec3 p){
  float acc = 0.0; float wsum = 0.0;
  for (int i=0;i<N;i++){
    float di = sdRoundCone(p, uA[i].xyz, uB[i].xyz, uA[i].w, uB[i].w);
    float w = exp(-max(di,0.0)*42.0);
    acc += uGlow[i]*w; wsum += w;
  }
  return acc/max(wsum,1e-4);
}

void main(){
  // Dissolve death: noise-thresholded discard with a hot ember edge; cuts
  // the outline pass too so no ghost shell survives the body.
  float dn = 0.0;
  if (uDissolve > 0.0){
    dn = dsNoise(vW * 9.0) * 0.75 + dsNoise(vW * 27.0) * 0.25;
    if (dn < uDissolve) discard;
  }
  if (uOutlinePass > 0.5){ gl_FragColor = vec4(0.20,0.14,0.09,1.0); return; }
  vec3 n = normalize(vN);
  // Quality bar (plan §1): bright high-key fill, ONE soft shade ramp, clean
  // matte color — no grain, no rim, no second light. Shape reads from the
  // ink outline and the gentle top-lit ramp, exactly like the reference.
  float d = dot(n, normalize(vec3(0.45, 0.8, 0.45)));
  float ramp = smoothstep(-0.35, 0.7, d);
  if (uToon > 0.5) ramp = floor(ramp * 3.0 + 0.5) / 3.0;
  float shade = mix(0.66, 1.04, ramp) * (0.94 + 0.06 * n.y);
  // per-pixel: per-vertex color dissolves markings smaller than the proxy
  // tessellation (cow patches fall between body vertices)
  vec3 col = fieldColor(vW) * shade;
  float gw = glowWeight(vW);
  if (gw > 0.001) col *= 1.0 + gw * (0.5 + 0.3 * sin(uTime * 2.6));
  if (uDissolve > 0.0) col = mix(vec3(0.95, 0.55, 0.22), col, smoothstep(uDissolve, uDissolve + 0.09, dn));
  col += uFlashCol * uFlashAmt * 0.8;
  gl_FragColor = vec4(col, 1.0);
}`

  return { vertexShader, fragmentShader }
}

// One low-poly tapered capsule per solid part, merged into a single geometry
// with a per-vertex primIndex. Buried and colorOnly parts build no proxy.
function buildBlendShellProxy(THREE, parts) {
  const pos = []
  const idx = []
  const Y = new THREE.Vector3(0, 1, 0)
  const dir = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const m = new THREE.Matrix4()
  parts.forEach((p, i) => {
    if (p.buried || p.colorOnly) return
    const a = new THREE.Vector3(...p.a)
    const b = new THREE.Vector3(...p.b)
    dir.subVectors(b, a)
    const len = dir.length()
    if (len > 1e-6) dir.divideScalar(len)
    else dir.copy(Y)
    const big = Math.max(p.r1, p.r2)
    const segs = big > 0.2 ? [9, 26] : [5, 14]
    const g = new THREE.CapsuleGeometry(1, len, segs[0], segs[1]).toNonIndexed()
    // Taper the unit-radius capsule to the rounded cone's radii so every
    // vertex starts near the true surface (a = -Y end, b = +Y end).
    const pa = g.attributes.position
    for (let j = 0; j < pa.count; j++) {
      const y = pa.getY(j)
      const t = THREE.MathUtils.clamp((y + len / 2) / len, 0, 1)
      const r = p.r1 + (p.r2 - p.r1) * t
      pa.setXYZ(j, pa.getX(j) * r, y, pa.getZ(j) * r)
      if (y > len / 2) pa.setY(j, len / 2 + (y - len / 2) * p.r2)
      else if (y < -len / 2) pa.setY(j, -len / 2 + (y + len / 2) * p.r1)
    }
    quat.setFromUnitVectors(Y, dir)
    m.compose(a.clone().add(b).multiplyScalar(0.5), quat, new THREE.Vector3(1, 1, 1))
    g.applyMatrix4(m)
    const arr = g.attributes.position.array
    for (let j = 0; j < arr.length; j += 3) {
      pos.push(arr[j], arr[j + 1], arr[j + 2])
      idx.push(i)
    }
    g.dispose()
  })
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('primIndex', new THREE.Float32BufferAttribute(idx, 1))
  return geo
}

// Spec (validated by validateCreatureSpec in creatures.js) → posable shell.
// The group is authored facing +z with feet near y=0; the caller places,
// rotates, and height-normalises it like any other actor. Motion comes from
// a rig (rigs.js) writing the pose fields and calling commit().
export function createBlendShellCreature(THREE, spec) {
  const parts = spec.parts
  const n = parts.length
  // Authored hex goes to the shader verbatim — default color management
  // would linearize it and the raw-GLSL lighting would render everything
  // darker and muddier than the palette says.
  const palette = (spec.palette || []).map((hex) =>
    new THREE.Color().setHex(parseInt(hex.slice(1), 16), THREE.NoColorSpace))

  const baseA = parts.map((p) => new THREE.Vector3(...p.a))
  const baseB = parts.map((p) => new THREE.Vector3(...p.b))
  const uA = parts.map((p, i) => new THREE.Vector4(baseA[i].x, baseA[i].y, baseA[i].z, p.r1))
  const uB = parts.map((p, i) => new THREE.Vector4(baseB[i].x, baseB[i].y, baseB[i].z, p.r2))
  const uXf = parts.map(() => new THREE.Matrix4())
  // Thin parts (horns, ears, antennae) cap their blend radius so they join
  // the body without dissolving into it. The cap must only bite genuinely
  // thin parts — clamping medium parts sharpens their joints into creases.
  const uK = parts.map((p) => {
    const k = typeof p.blend === 'number' ? p.blend : BLEND_SHELL_DEFAULT_BLEND
    return Math.min(k, Math.max(0.02, Math.min(p.r1, p.r2) * 1.4))
  })
  const uniforms = {
    uA: { value: uA },
    uB: { value: uB },
    uCol: { value: parts.map((p) => palette[p.color] || new THREE.Color(0xffffff)) },
    uK: { value: uK },
    uShape: { value: parts.map((p) => (p.colorOnly ? 0 : 1)) },
    uGlow: { value: parts.map((p) => (p.glow ? 1 : 0)) },
    uXf: { value: uXf },
    uOffset: { value: 0 },
    uToon: { value: spec.toon ? 1 : 0 },
    uOutlinePass: { value: 0 },
    uFlashCol: { value: new THREE.Vector3(0.8, 0.05, 0.02) },
    uFlashAmt: { value: 0 },
    uTime: { value: 0 },
    uDissolve: { value: 0 },
  }

  const { vertexShader, fragmentShader } = buildBlendShellShaders(n)
  const geo = buildBlendShellProxy(THREE, parts)
  // Vertices displace in the vertex shader, so cull by a generous hand-set
  // sphere instead of the proxy positions.
  const bounds = new THREE.Box3().setFromBufferAttribute(geo.attributes.position)
  const center = bounds.getCenter(new THREE.Vector3())
  geo.boundingSphere = new THREE.Sphere(center, Math.max(1, bounds.getSize(new THREE.Vector3()).length()))

  const skinMat = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader })
  const skin = new THREE.Mesh(geo, skinMat)
  skin.frustumCulled = false
  const outlineMat = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uOffset: { value: 0.02 }, uOutlinePass: { value: 1 } },
    vertexShader,
    fragmentShader,
    side: THREE.BackSide,
    polygonOffset: true,
    polygonOffsetFactor: 4,
    polygonOffsetUnits: 4,
  })
  const outline = new THREE.Mesh(geo, outlineMat)
  outline.frustumCulled = false

  const group = new THREE.Group()
  group.add(skin)
  group.add(outline)

  const byId = Object.fromEntries(parts.map((p, i) => [p.id, i]))
  const mats = parts.map(() => new THREE.Matrix4())
  const rootMat = new THREE.Matrix4()
  const overrideA = parts.map(() => null)
  const overrideB = parts.map(() => null)
  const radiusScale = parts.map(() => 1)

  const tmpM = new THREE.Matrix4()
  const tmpV = new THREE.Vector3()
  const tmpV2 = new THREE.Vector3()
  const tmpQ = new THREE.Quaternion()
  const tmpMid = new THREE.Vector3()

  const commit = () => {
    for (let i = 0; i < n; i++) {
      const r1 = parts[i].r1 * radiusScale[i]
      const r2 = parts[i].r2 * radiusScale[i]
      if (overrideA[i]) {
        const oa = overrideA[i]
        const ob = overrideB[i] || overrideA[i]
        uA[i].set(oa.x, oa.y, oa.z, r1)
        uB[i].set(ob.x, ob.y, ob.z, r2)
        // Rigid transform aligning the base segment onto the override —
        // approximate is fine: it only seeds the proxy verts, projection
        // converges them onto the surface.
        tmpV.subVectors(baseB[i], baseA[i]).normalize()
        tmpV2.subVectors(ob, oa)
        const len = tmpV2.length()
        if (len > 1e-6) tmpV2.divideScalar(len)
        else tmpV2.copy(tmpV)
        tmpQ.setFromUnitVectors(tmpV, tmpV2)
        tmpMid.addVectors(baseA[i], baseB[i]).multiplyScalar(0.5).applyQuaternion(tmpQ)
        uXf[i].makeRotationFromQuaternion(tmpQ)
        uXf[i].setPosition(
          (oa.x + ob.x) / 2 - tmpMid.x,
          (oa.y + ob.y) / 2 - tmpMid.y,
          (oa.z + ob.z) / 2 - tmpMid.z,
        )
      } else {
        tmpM.multiplyMatrices(rootMat, mats[i])
        uXf[i].copy(tmpM)
        tmpV.copy(baseA[i]).applyMatrix4(tmpM)
        uA[i].set(tmpV.x, tmpV.y, tmpV.z, r1)
        tmpV.copy(baseB[i]).applyMatrix4(tmpM)
        uB[i].set(tmpV.x, tmpV.y, tmpV.z, r2)
      }
    }
  }
  commit()

  return {
    group,
    parts,
    byId,
    baseA,
    baseB,
    mats,
    rootMat,
    overrideA,
    overrideB,
    radiusScale,
    commit,
    setFlash: (r, g, b, amount) => {
      uniforms.uFlashCol.value.set(r, g, b)
      uniforms.uFlashAmt.value = amount
    },
    setEffects: (time, dissolve) => {
      uniforms.uTime.value = time
      uniforms.uDissolve.value = dissolve
    },
    dispose: () => {
      geo.dispose()
      skinMat.dispose()
      outlineMat.dispose()
    },
  }
}
