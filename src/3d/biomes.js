// Procedural arena set dressing (Phase 4 of docs/procedural-3d-plan.md).
//
// A biome spec (src/data/biomes3d.json) describes everything around the
// combatants: a noise-shaded ground disc, a sky-gradient backdrop, a horizon
// haze band, hemisphere/key light tints, and a handful of static props built
// from the same blend-shell primitive vocabulary as the creatures — so the
// whole diorama shares one visual language. Biomes are keyed to world.json
// places; unmapped places fall back to the default biome, and a null biome
// keeps the arena's classic dark-disc look.
//
// This module never imports the JSON (the dev harness drives it with fetched
// data, same contract as heroCompose.js); app callers resolve a placeId to a
// spec through src/3d/biomeRegistry.js. Mounting takes THREE from the caller
// like every other src/3d module.

import { createBlendShellCreature } from './blendShell.js'

const BIOME_HEX = /^#[0-9a-fA-F]{6}$/

// Validation mirrors validateCreatureSpec: an array of error strings, empty
// when valid. Tests run every authored biome through this.
export function validateBiomeSpec(spec) {
  const errors = []
  if (!spec || typeof spec !== 'object') return ['spec is not an object']
  const hex = (tag, v) => { if (typeof v !== 'string' || !BIOME_HEX.test(v)) errors.push(`${tag}: ${JSON.stringify(v)} is not a #rrggbb string`) }
  if (!spec.sky || typeof spec.sky !== 'object') errors.push('sky must be an object')
  else { hex('sky.top', spec.sky.top); hex('sky.bottom', spec.sky.bottom) }
  if (spec.haze !== undefined) {
    if (!spec.haze || typeof spec.haze !== 'object') errors.push('haze must be an object')
    else {
      hex('haze.color', spec.haze.color)
      if (!(Number.isFinite(spec.haze.amount) && spec.haze.amount >= 0 && spec.haze.amount <= 1)) errors.push('haze.amount must be 0..1')
    }
  }
  if (spec.light !== undefined) {
    if (!spec.light || typeof spec.light !== 'object') errors.push('light must be an object')
    else {
      for (const k of ['sky', 'ground', 'key']) if (spec.light[k] !== undefined) hex(`light.${k}`, spec.light[k])
      for (const k of ['keyIntensity', 'hemiIntensity']) {
        if (spec.light[k] !== undefined && !(Number.isFinite(spec.light[k]) && spec.light[k] > 0)) errors.push(`light.${k} must be a positive number`)
      }
    }
  }
  if (!spec.ground || !Array.isArray(spec.ground.colors) || spec.ground.colors.length !== 3) {
    errors.push('ground.colors must be an array of 3 colors')
  } else {
    for (const c of spec.ground.colors) hex('ground.colors', c)
    if (spec.ground.scale !== undefined && !(Number.isFinite(spec.ground.scale) && spec.ground.scale > 0)) errors.push('ground.scale must be a positive number')
  }
  const palette = spec.palette
  if (!Array.isArray(palette) || !palette.length) errors.push('palette must be a non-empty array')
  else for (const c of palette) hex('palette', c)
  const shapes = spec.shapes || {}
  if (typeof shapes !== 'object') errors.push('shapes must be an object')
  for (const [name, parts] of Object.entries(shapes)) {
    if (!Array.isArray(parts) || !parts.length) { errors.push(`shape ${name}: must be a non-empty parts array`); continue }
    const ids = new Set()
    let visible = 0
    for (const p of parts) {
      const tag = `shape ${name}.${(p && p.id) || '<no id>'}`
      if (!p || typeof p.id !== 'string' || !p.id) { errors.push(`${tag}: missing string id`); continue }
      if (ids.has(p.id)) errors.push(`${tag}: duplicate id`)
      ids.add(p.id)
      for (const k of ['a', 'b']) {
        if (!Array.isArray(p[k]) || p[k].length !== 3 || !p[k].every(Number.isFinite)) errors.push(`${tag}: ${k} must be [x,y,z]`)
      }
      for (const r of ['r1', 'r2']) if (!(Number.isFinite(p[r]) && p[r] > 0)) errors.push(`${tag}: ${r} must be a positive number`)
      if (!Number.isInteger(p.color) || p.color < 0 || p.color >= (Array.isArray(palette) ? palette.length : 0)) errors.push(`${tag}: color must index into palette`)
      if (!p.buried && !p.colorOnly) visible++
    }
    if (!visible) errors.push(`shape ${name}: every part is buried/colorOnly`)
  }
  if (!Array.isArray(spec.placements)) errors.push('placements must be an array')
  else for (const [i, pl] of spec.placements.entries()) {
    const tag = `placements[${i}]`
    if (!pl || !shapes[pl.shape]) errors.push(`${tag}: shape must name an authored shape`)
    if (!Array.isArray(pl.at) || pl.at.length !== 2 || !pl.at.every(Number.isFinite)) errors.push(`${tag}: at must be [x,z]`)
    if (pl.scale !== undefined && !(Number.isFinite(pl.scale) && pl.scale > 0)) errors.push(`${tag}: scale must be a positive number`)
    if (pl.rotY !== undefined && !Number.isFinite(pl.rotY)) errors.push(`${tag}: rotY must be a number`)
  }
  return errors
}

const BIOME_GROUND_RADIUS = 3.4

function biomeGroundMaterial(THREE, ground) {
  const [c0, c1, c2] = ground.colors.map((hex) =>
    new THREE.Color().setHex(parseInt(hex.slice(1), 16), THREE.NoColorSpace))
  return new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uC0: { value: c0 },
      uC1: { value: c1 },
      uC2: { value: c2 },
      uScale: { value: ground.scale || 1.6 },
      uRadius: { value: BIOME_GROUND_RADIUS },
    },
    vertexShader: `
varying vec2 vP;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vP = w.xz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`,
    fragmentShader: `
precision highp float;
uniform vec3 uC0; uniform vec3 uC1; uniform vec3 uC2;
uniform float uScale; uniform float uRadius;
varying vec2 vP;
float bHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float bNoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(bHash(i), bHash(i+vec2(1.,0.)), f.x), mix(bHash(i+vec2(0.,1.)), bHash(i+vec2(1.,1.)), f.x), f.y);
}
void main(){
  float n = bNoise(vP * uScale) * 0.65 + bNoise(vP * uScale * 2.7) * 0.35;
  vec3 col = mix(uC0, uC1, smoothstep(0.35, 0.75, n));
  float sp = smoothstep(0.78, 0.92, bNoise(vP * uScale * 5.1 + 7.3));
  col = mix(col, uC2, sp * 0.85);
  float r = length(vP) / uRadius;
  col *= mix(1.0, 0.8, smoothstep(0.5, 1.0, r));
  float alpha = 1.0 - smoothstep(0.86, 1.0, r);
  gl_FragColor = vec4(col, alpha);
}`,
  })
}

function biomeGradientMaterial(THREE, topHex, bottomHex, topAlpha, bottomAlpha) {
  const top = new THREE.Color().setHex(parseInt(topHex.slice(1), 16), THREE.NoColorSpace)
  const bottom = new THREE.Color().setHex(parseInt(bottomHex.slice(1), 16), THREE.NoColorSpace)
  return new THREE.ShaderMaterial({
    transparent: topAlpha < 1 || bottomAlpha < 1,
    depthWrite: false,
    uniforms: {
      uTop: { value: top }, uBottom: { value: bottom },
      uTopA: { value: topAlpha }, uBottomA: { value: bottomAlpha },
    },
    vertexShader: `
varying float vT;
void main(){
  vT = uv.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
    fragmentShader: `
precision highp float;
uniform vec3 uTop; uniform vec3 uBottom; uniform float uTopA; uniform float uBottomA;
varying float vT;
void main(){ gl_FragColor = vec4(mix(uBottom, uTop, vT), mix(uBottomA, uTopA, vT)); }`,
  })
}

// Soft contact-shadow decal (blend-shell creatures cast no real shadows).
function biomeShadowMaterial(THREE) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexShader: `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
precision highp float;
varying vec2 vUv;
void main(){
  float d = length(vUv - 0.5) * 2.0;
  gl_FragColor = vec4(0.16, 0.11, 0.06, 0.5 * (1.0 - smoothstep(0.35, 1.0, d)));
}`,
  })
}

// Mount a biome into the arena scene: lights + ground + backdrop + haze +
// props. Returns { addShadowBlob(x, z, r), dispose } — the caller adds blobs
// once actor positions are known. When spec is null nothing mounts.
export function mountArenaBiome(THREE, scene, spec) {
  const group = new THREE.Group()
  const disposables = []
  const light = spec.light || {}
  const colorOf = (hex, fallback) => new THREE.Color(typeof hex === 'string' ? parseInt(hex.slice(1), 16) : fallback)

  group.add(new THREE.HemisphereLight(
    colorOf(light.sky, 0xfff2e0), colorOf(light.ground, 0x2a1c10), light.hemiIntensity ?? 1.9))
  const key = new THREE.DirectionalLight(colorOf(light.key, 0xfff2e0), light.keyIntensity ?? 2.2)
  key.position.set(3, 5, 4)
  group.add(key)
  const rim = new THREE.DirectionalLight(0x88bbff, 0.9)
  rim.position.set(-4, 2, -3)
  group.add(rim)

  const groundMat = biomeGroundMaterial(THREE, spec.ground)
  const groundGeo = new THREE.CircleGeometry(BIOME_GROUND_RADIUS, 48)
  const groundMesh = new THREE.Mesh(groundGeo, groundMat)
  groundMesh.rotation.x = -Math.PI / 2
  group.add(groundMesh)
  disposables.push(groundGeo, groundMat)

  const skyMat = biomeGradientMaterial(THREE, spec.sky.top, spec.sky.bottom, 1, 1)
  const skyGeo = new THREE.PlaneGeometry(64, 24)
  const sky = new THREE.Mesh(skyGeo, skyMat)
  sky.position.set(0, 4, -7)
  sky.renderOrder = -3
  group.add(sky)
  disposables.push(skyGeo, skyMat)

  if (spec.haze && spec.haze.amount > 0) {
    const hazeMat = biomeGradientMaterial(THREE, spec.haze.color, spec.haze.color, 0, spec.haze.amount)
    // extends well below the horizon so its bottom edge never shows past the
    // ground disc's alpha rim
    const hazeGeo = new THREE.PlaneGeometry(56, 5.5)
    const haze = new THREE.Mesh(hazeGeo, hazeMat)
    haze.position.set(0, 0.9, -3.1)
    haze.renderOrder = -2
    group.add(haze)
    disposables.push(hazeGeo, hazeMat)
  }

  for (const pl of spec.placements || []) {
    const parts = (spec.shapes || {})[pl.shape]
    if (!parts) continue
    const prop = createBlendShellCreature(THREE, { palette: spec.palette, parts })
    prop.group.position.set(pl.at[0], 0, pl.at[1])
    prop.group.rotation.y = THREE.MathUtils.degToRad(pl.rotY || 0)
    if (pl.scale) prop.group.scale.setScalar(pl.scale)
    group.add(prop.group)
    disposables.push({ dispose: prop.dispose })
  }

  const shadowMat = biomeShadowMaterial(THREE)
  disposables.push(shadowMat)
  const shadowGeo = new THREE.PlaneGeometry(1, 1)
  disposables.push(shadowGeo)

  scene.add(group)
  return {
    addShadowBlob: (x, z, r) => {
      const blob = new THREE.Mesh(shadowGeo, shadowMat)
      blob.rotation.x = -Math.PI / 2
      blob.scale.setScalar(r * 2)
      blob.position.set(x, 0.012, z)
      blob.renderOrder = -1
      group.add(blob)
    },
    dispose: () => {
      scene.remove(group)
      for (const d of disposables) d.dispose()
    },
  }
}
