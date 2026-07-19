import * as THREE from 'three'
import { createGround, setHeightSampler } from './scene'
import { createTerrainMaterial, isTerrainPreset } from './terrainMaterials'
import { createGroundPaint, createWater } from './groundPaint'
import type { GroundPalette, ZoneTerrain, ZoneGroundRegion } from '../../shared/protocol'

// Client-render-only terrain height (docs/open-world-terrain-plan.md §3). The
// server never learns the ground has height; this only lifts render Y so meshes
// ride the surface. A HeightField owns a bilinear sampler over a grid of corner
// heights — (width+1)×(height+1) samples, one per tile corner — and registers
// it as the active sampler that scene.tileToWorld consults.
//
// Phase T0: production callers pass `corners = null` (flat, y=0 everywhere) so
// the game is pixel-identical to before the seam. Phase T1 fills `corners` from
// an authored heightmap or procedural noise; nothing else has to change.

export type HeightField = {
  heightAt(worldX: number, worldZ: number): number
  dispose(): void
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** Builds a HeightField and registers it as the active sampler. `corners`, when
 * present, must have (width+1)*(height+1) entries in row-major (x fastest)
 * order; corner (i,j) is the ground height at world (i,j). */
export function createHeightField(width: number, height: number, corners: Float32Array | null): HeightField {
  const stride = width + 1

  const heightAt = (worldX: number, worldZ: number): number => {
    if (!corners) return 0
    const wx = clamp(worldX, 0, width)
    const wz = clamp(worldZ, 0, height)
    const i0 = Math.min(Math.floor(wx), width - 1)
    const j0 = Math.min(Math.floor(wz), height - 1)
    const fx = wx - i0
    const fz = wz - j0
    const h00 = corners[j0 * stride + i0]
    const h10 = corners[j0 * stride + i0 + 1]
    const h01 = corners[(j0 + 1) * stride + i0]
    const h11 = corners[(j0 + 1) * stride + i0 + 1]
    const top = h00 + (h10 - h00) * fx
    const bot = h01 + (h11 - h01) * fx
    return top + (bot - top) * fz
  }

  setHeightSampler(heightAt)
  return { heightAt, dispose: () => setHeightSampler(null) }
}

// ── Procedural corner source (deterministic, client-agnostic) ──────────────
// Seeded value-noise fBm. Pure function of (seed, frequency, tile) so every
// client renders the same terrain — required for remote players/NPCs to share
// ground. Authored heightmap PNGs (the primary source in the plan) land with
// the editor in Phase T4; procedural is the always-available fallback.

const RELIEF_CAP = 1.5 // tiles — height is scenery, never gameplay geometry

function hash2(ix: number, iz: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 2147483647)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t)
}

function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x)
  const iz = Math.floor(z)
  const u = smoothstep(x - ix)
  const v = smoothstep(z - iz)
  const a = hash2(ix, iz, seed)
  const b = hash2(ix + 1, iz, seed)
  const c = hash2(ix, iz + 1, seed)
  const d = hash2(ix + 1, iz + 1, seed)
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v
}

function fbm(x: number, z: number, seed: number): number {
  let sum = 0
  let amp = 0.5
  let freq = 1
  let norm = 0
  for (let o = 0; o < 4; o++) {
    sum += amp * valueNoise(x * freq, z * freq, seed + o * 101)
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return sum / norm // [0,1]
}

/** (width+1)×(height+1) corner heights in tiles, in [0, relief]. */
export function proceduralCorners(width: number, height: number, seed: number, frequency: number, relief: number): Float32Array {
  const cap = Math.min(relief, RELIEF_CAP)
  const stride = width + 1
  const corners = new Float32Array(stride * (height + 1))
  for (let j = 0; j <= height; j++) {
    for (let i = 0; i <= width; i++) {
      corners[j * stride + i] = fbm(i * frequency, j * frequency, seed) * cap
    }
  }
  return corners
}

function cornersFor(width: number, height: number, terrain: ZoneTerrain | undefined): Float32Array | null {
  if (!terrain || !terrain.relief) return null
  if (terrain.procedural) {
    return proceduralCorners(width, height, terrain.procedural.seed, terrain.procedural.frequency, terrain.relief)
  }
  // heightmap PNG source is added with the editor (Phase T4); until then a zone
  // with a `terrain` block but no procedural source renders flat.
  return null
}

/** Builds the zone's ground: computes corner heights, registers the height
 * sampler (so tileToWorld lifts every placed mesh), and adds the displaced,
 * lit ground mesh. Returns the mesh (picking raycasts it) and the field. */
export function createTerrain(
  scene: THREE.Scene,
  collision: string[],
  width: number,
  height: number,
  palette: GroundPalette | undefined,
  terrain: ZoneTerrain | undefined,
  ground?: ZoneGroundRegion[],
): { heightField: HeightField; mesh: THREE.Mesh } {
  const corners = cornersFor(width, height, terrain)
  const heightField = createHeightField(width, height, corners)
  // Blended natural material when a preset is named and the ground is displaced;
  // otherwise the classic checker (also the flat/no-terrain fallback).
  const material =
    corners && terrain && isTerrainPreset(terrain.material)
      ? createTerrainMaterial(terrain.material, Math.min(terrain.relief, 1.5))
      : undefined
  const mesh = createGround(scene, collision, width, height, palette, corners, material)
  createGroundPaint(scene, width, height, ground, corners)
  createWater(scene, ground, heightField.heightAt)
  return { heightField, mesh }
}
