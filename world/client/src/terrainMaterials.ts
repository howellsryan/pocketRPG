import * as THREE from 'three'

// Terrain material presets (docs/open-world-terrain-plan.md §5). Adapts
// THREE.Terrain's generateBlendedMaterial idea — blend by elevation and slope —
// as a texture-free colour ramp injected into MeshStandardMaterial via
// onBeforeCompile, so it keeps PBR lighting/shadows, needs no external texture
// assets, and costs almost nothing on mobile. Colours mirror src/data/
// biomes3d.json so the world and the idle-game arena share one look.
//
// Elevation bands: low -> mid -> high across [0, relief]. Steep faces blend
// toward `slope`. A little hash noise breaks up the bands.

export type TerrainPreset = {
  low: number
  mid: number
  high: number
  slope: number
  slopeThreshold: number
  roughness: number
}

export const TERRAIN_PRESETS: Record<string, TerrainPreset> = {
  meadow: { low: 0x6f8f45, mid: 0x7d9a4e, high: 0x9aa86b, slope: 0x6b5a3e, slopeThreshold: 0.35, roughness: 0.95 },
  woodland: { low: 0x55743a, mid: 0x4e6d35, high: 0x6b7a45, slope: 0x5a4632, slopeThreshold: 0.32, roughness: 0.95 },
  highland: { low: 0x6e7355, mid: 0x7a7a63, high: 0x9a9585, slope: 0x6a6258, slopeThreshold: 0.28, roughness: 1.0 },
  desert: { low: 0xc9b083, mid: 0xd8c69c, high: 0xe5d7ae, slope: 0xa8865a, slopeThreshold: 0.4, roughness: 0.9 },
  marsh: { low: 0x4a5236, mid: 0x5f6b4a, high: 0x6e755a, slope: 0x3a2c1c, slopeThreshold: 0.35, roughness: 1.0 },
  volcanic: { low: 0x2e2620, mid: 0x3a322c, high: 0x54453a, slope: 0xb0502e, slopeThreshold: 0.3, roughness: 0.85 },
  coastal: { low: 0xcbb98a, mid: 0x7d9a4e, high: 0x9aa86b, slope: 0xa89060, slopeThreshold: 0.4, roughness: 0.9 },
}

export function isTerrainPreset(name: string | undefined): boolean {
  return name != null && name in TERRAIN_PRESETS
}

/** MeshStandardMaterial whose albedo is an elevation/slope blend of the named
 * preset (falls back to meadow). `reliefMax` normalises the elevation bands. */
export function createTerrainMaterial(name: string | undefined, reliefMax: number): THREE.MeshStandardMaterial {
  const p = (name && TERRAIN_PRESETS[name]) || TERRAIN_PRESETS.meadow
  const mat = new THREE.MeshStandardMaterial({ roughness: p.roughness, metalness: 0 })
  const col = (hex: number): THREE.Color => new THREE.Color(hex)
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uLow = { value: col(p.low) }
    shader.uniforms.uMid = { value: col(p.mid) }
    shader.uniforms.uHigh = { value: col(p.high) }
    shader.uniforms.uSlopeCol = { value: col(p.slope) }
    shader.uniforms.uReliefMax = { value: Math.max(1e-4, reliefMax) }
    shader.uniforms.uSlopeThresh = { value: p.slopeThreshold }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vElev;\nvarying float vSlopeT;\nvarying vec2 vTerr;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvElev = position.y;\nvSlopeT = 1.0 - clamp(normal.y, 0.0, 1.0);\nvTerr = position.xz;',
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vElev;
varying float vSlopeT;
varying vec2 vTerr;
uniform vec3 uLow;
uniform vec3 uMid;
uniform vec3 uHigh;
uniform vec3 uSlopeCol;
uniform float uReliefMax;
uniform float uSlopeThresh;
float terrHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`,
      )
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        `float e = clamp(vElev / uReliefMax, 0.0, 1.0);
vec3 terrCol = mix(uLow, uMid, smoothstep(0.0, 0.5, e));
terrCol = mix(terrCol, uHigh, smoothstep(0.5, 1.0, e));
float s = smoothstep(uSlopeThresh, uSlopeThresh + 0.25, vSlopeT);
terrCol = mix(terrCol, uSlopeCol, s);
terrCol *= 0.92 + 0.08 * terrHash(floor(vTerr * 3.0));
vec4 diffuseColor = vec4( terrCol, opacity );`,
      )
  }
  return mat
}
