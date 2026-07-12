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
// three.js is passed in by the caller (lazy-loaded via utils/three3d.js) so
// this module never touches the vendored bundle at eval time.

export const BLEND_SHELL_MAX_PARTS = 24

const BLEND_SHELL_ITERS = 8
const BLEND_SHELL_DEFAULT_BLEND = 0.1

export function buildBlendShellShaders(n) {
  const common = `
#define N ${n}
uniform vec4 uA[N];      // a.xyz, r1
uniform vec4 uB[N];      // b.xyz, r2
uniform vec3 uCol[N];
uniform float uK[N];

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
    float w = exp(-max(di,0.0)*18.0);
    acc += uCol[i]*w; wsum += w;
  }
  return acc/max(wsum,1e-4);
}`

  const vertexShader = common + `
attribute float primIndex;
uniform mat4 uXf[N];
uniform float uOffset;   // 0 = skin, >0 = outline shell
varying vec3 vN; varying vec3 vC; varying vec3 vW;
void main(){
  int pi = int(primIndex + 0.5);
  vec3 q = (uXf[pi] * vec4(position,1.0)).xyz;
  for (int it=0; it<${BLEND_SHELL_ITERS}; it++){
    float d = field(q) - uOffset;
    q -= fieldGrad(q) * clamp(d, -0.5, 0.5) * 0.75;
  }
  vN = fieldGrad(q);
  vC = fieldColor(q);
  vW = q;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(q,1.0);
}`

  const fragmentShader = `
precision highp float;
uniform float uToon; uniform float uOutlinePass;
uniform vec3 uFlashCol; uniform float uFlashAmt;
varying vec3 vN; varying vec3 vC; varying vec3 vW;
void main(){
  if (uOutlinePass > 0.5){ gl_FragColor = vec4(0.20,0.14,0.09,1.0); return; }
  vec3 n = normalize(vN);
  vec3 l1 = normalize(vec3(0.6,0.9,0.5));
  vec3 l2 = normalize(vec3(-0.5,0.3,-0.6));
  float d1 = max(dot(n,l1),0.0), d2 = max(dot(n,l2),0.0);
  if (uToon > 0.5){ d1 = floor(d1*3.0+0.5)/3.0; d2 = floor(d2*2.0+0.5)/2.0; }
  float hemi = 0.5 + 0.5*n.y;
  vec3 col = vC * (0.28 + 0.30*hemi + 0.55*d1 + 0.18*d2);
  vec3 v = normalize(cameraPosition - vW);
  float rim = pow(1.0 - max(dot(v,n),0.0), 3.0);
  col += vec3(0.9,0.75,0.5) * rim * 0.18;
  col += uFlashCol * uFlashAmt * 0.8;
  gl_FragColor = vec4(col, 1.0);
}`

  return { vertexShader, fragmentShader }
}

// One low-poly tapered capsule per non-buried part, merged into a single
// geometry with a per-vertex primIndex. Buried parts (fully inside the body)
// contribute to the SDF field but need no proxy — the neighbours' vertices
// converge onto the blended surface anyway.
function buildBlendShellProxy(THREE, parts) {
  const pos = []
  const idx = []
  const Y = new THREE.Vector3(0, 1, 0)
  const dir = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const m = new THREE.Matrix4()
  parts.forEach((p, i) => {
    if (p.buried) return
    const a = new THREE.Vector3(...p.a)
    const b = new THREE.Vector3(...p.b)
    dir.subVectors(b, a)
    const len = dir.length()
    if (len > 1e-6) dir.divideScalar(len)
    else dir.copy(Y)
    const big = Math.max(p.r1, p.r2)
    const segs = big > 0.2 ? [6, 18] : [4, 12]
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

// Spec (validated by validateCreatureSpec in creatures.js) → living creature:
// { group, update(dt), setFlash(r,g,b,amount), dispose() }.
// The group is authored facing +z with feet near y=0; the caller places,
// rotates, and height-normalises it like any other actor.
export function createBlendShellCreature(THREE, spec) {
  const parts = spec.parts
  const n = parts.length
  const palette = (spec.palette || []).map((hex) => new THREE.Color(hex))

  const baseA = parts.map((p) => new THREE.Vector3(...p.a))
  const baseB = parts.map((p) => new THREE.Vector3(...p.b))
  const uA = parts.map((p, i) => new THREE.Vector4(baseA[i].x, baseA[i].y, baseA[i].z, p.r1))
  const uB = parts.map((p, i) => new THREE.Vector4(baseB[i].x, baseB[i].y, baseB[i].z, p.r2))
  const uXf = parts.map(() => new THREE.Matrix4())
  const uniforms = {
    uA: { value: uA },
    uB: { value: uB },
    uCol: { value: parts.map((p) => palette[p.color] || new THREE.Color(0xffffff)) },
    uK: { value: parts.map((p) => (typeof p.blend === 'number' ? p.blend : BLEND_SHELL_DEFAULT_BLEND)) },
    uXf: { value: uXf },
    uOffset: { value: 0 },
    uToon: { value: spec.toon ? 1 : 0 },
    uOutlinePass: { value: 0 },
    uFlashCol: { value: new THREE.Vector3(0.8, 0.05, 0.02) },
    uFlashAmt: { value: 0 },
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
    uniforms: { ...uniforms, uOffset: { value: 0.012 }, uOutlinePass: { value: 1 } },
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
  const r1s = new Array(n)
  const r2s = new Array(n)
  const tmpM = new THREE.Matrix4()
  const tmpR = new THREE.Matrix4()
  const tmpT1 = new THREE.Matrix4()
  const tmpT2 = new THREE.Matrix4()
  const tmpV = new THREE.Vector3()
  const tmpE = new THREE.Euler()
  const chainPrev = new THREE.Matrix4()
  const rotAbout = (out, ax, ay, az, ex, ey, ez) => {
    tmpT1.makeTranslation(-ax, -ay, -az)
    tmpR.makeRotationFromEuler(tmpE.set(ex, ey, ez))
    tmpT2.makeTranslation(ax, ay, az)
    return out.copy(tmpT2).multiply(tmpR).multiply(tmpT1)
  }

  let t = 0
  const behaviors = spec.idle || []

  const update = (dt) => {
    t += dt
    for (let i = 0; i < n; i++) {
      mats[i].identity()
      r1s[i] = parts[i].r1
      r2s[i] = parts[i].r2
    }
    for (const bh of behaviors) {
      if (bh.kind === 'breathe') {
        const s = 1 + (bh.amp ?? 0.03) * Math.sin(t * (bh.rate ?? 2))
        for (const id of bh.parts) { r1s[byId[id]] *= s; r2s[byId[id]] *= s }
      } else if (bh.kind === 'sway') {
        const rate = bh.rate ?? 1
        rotAbout(tmpM, bh.anchor[0], bh.anchor[1], bh.anchor[2],
          (bh.pitch ?? 0) * Math.sin(t * rate * 2.33), (bh.yaw ?? 0) * Math.sin(t * rate), 0)
        for (const id of bh.parts) mats[byId[id]].premultiply(tmpM)
      } else if (bh.kind === 'twitch') {
        const w = Math.max(0, Math.sin(t * (bh.rate ?? 7))) ** 8 * (bh.amp ?? 0.5)
        if (w > 0.01) {
          for (const id of bh.parts) {
            const i = byId[id]
            rotAbout(tmpM, baseA[i].x, baseA[i].y, baseA[i].z, 0, 0, w)
            mats[i].premultiply(tmpM)
          }
        }
      } else if (bh.kind === 'chain') {
        // Sequential segments (tails, tentacles) wag with a phase lag; each
        // link rotates about its anchor as moved by the links before it.
        chainPrev.identity()
        bh.parts.forEach((id, k) => {
          const i = byId[id]
          tmpV.copy(baseA[i]).applyMatrix4(chainPrev)
          const angle = (bh.yaw ?? 0.5) * Math.sin(t * (bh.rate ?? 3) - k * (bh.lag ?? 0.7))
          rotAbout(tmpM, tmpV.x, tmpV.y, tmpV.z, 0, angle, 0)
          chainPrev.premultiply(tmpM)
          mats[i].premultiply(chainPrev)
        })
      }
    }
    for (let i = 0; i < n; i++) {
      uXf[i].copy(mats[i])
      tmpV.copy(baseA[i]).applyMatrix4(mats[i])
      uA[i].set(tmpV.x, tmpV.y, tmpV.z, r1s[i])
      tmpV.copy(baseB[i]).applyMatrix4(mats[i])
      uB[i].set(tmpV.x, tmpV.y, tmpV.z, r2s[i])
    }
  }
  update(0)

  return {
    group,
    update,
    setFlash: (r, g, b, amount) => {
      uniforms.uFlashCol.value.set(r, g, b)
      uniforms.uFlashAmt.value = amount
    },
    dispose: () => {
      geo.dispose()
      skinMat.dispose()
      outlineMat.dispose()
    },
  }
}
