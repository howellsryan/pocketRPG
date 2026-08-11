import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { ScatterLayer } from '../../shared/protocol'
import { modelUrl } from './assetBase'

// Decorative flora scatter (docs/open-world-terrain-plan.md §7). Adapts
// THREE.Terrain's ScatterMeshes: seeded, mask-aware, slope-aware placement,
// rendered as one InstancedMesh per layer (a thousand tufts = one draw call).
//
// Placement is CLIENT-RENDER-ONLY decoration: seeded per zone so it's identical
// on every client, and it never lands on a blocked or occupied tile — interactive
// nodes stay server-authored `objects[]`. The placement half (scatterPositions)
// is pure and unit-tested; the renderer is runtime-only.

export type ScatterInstance = { x: number; z: number; rot: number; scale: number }

// Base per-model scale against the 1-unit tile grid (mirrors props.ts).
const SCATTER_BASE: Record<string, number> = {
  pine_a: 1.7,
  pine_b: 1.6,
  bush: 1.4,
  mushrooms: 1.1,
  flowers: 1.1,
  boulder: 1.3,
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function localSlope(heightAt: (x: number, z: number) => number, x: number, z: number): number {
  const c = heightAt(x + 0.5, z + 0.5)
  let m = 0
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    m = Math.max(m, Math.abs(heightAt(x + 0.5 + dx, z + 0.5 + dz) - c))
  }
  return m
}

/** Deterministic scatter instances for a layer. `occupied` holds "x,z" tile keys
 * to avoid (object/exit tiles); blocked tiles are skipped via `collision`. */
export function scatterPositions(
  width: number,
  height: number,
  collision: string[],
  occupied: Set<string>,
  layer: ScatterLayer,
  seed: number,
  heightAt?: (x: number, z: number) => number,
): ScatterInstance[] {
  const rng = mulberry32(seed)
  const useSlope = (layer.minSlope != null || layer.maxSlope != null) && heightAt != null
  const candidates: { x: number; z: number }[] = []
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      if (collision[z]?.[x] !== '.') continue
      if (occupied.has(`${x},${z}`)) continue
      if (useSlope) {
        const s = localSlope(heightAt!, x, z)
        if (layer.minSlope != null && s < layer.minSlope) continue
        if (layer.maxSlope != null && s > layer.maxSlope) continue
      }
      candidates.push({ x, z })
    }
  }
  // Seeded Fisher-Yates, then take the first N — deterministic subset.
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = candidates[i]
    candidates[i] = candidates[j]
    candidates[j] = tmp
  }
  const count = Math.min(candidates.length, Math.round((layer.density / 100) * candidates.length))
  const jitter = layer.jitter ?? 0.35
  const [smin, smax] = layer.scaleRange ?? [0.8, 1.2]
  const out: ScatterInstance[] = []
  for (let i = 0; i < count; i++) {
    const { x, z } = candidates[i]
    out.push({
      x: x + 0.5 + (rng() - 0.5) * jitter,
      z: z + 0.5 + (rng() - 0.5) * jitter,
      rot: rng() * Math.PI * 2,
      scale: smin + rng() * (smax - smin),
    })
  }
  return out
}

type MeshPart = { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[] }

// Every mesh in the GLB, with its transform relative to the root baked into a
// cloned geometry. Multi-mesh props (e.g. flowers = stems + petals) need all
// parts — instancing only the first renders partial ("red crescent") props.
function collectMeshParts(root: THREE.Object3D): MeshPart[] {
  root.updateMatrixWorld(true)
  const parts: MeshPart[] = []
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      const geometry = o.geometry.clone()
      geometry.applyMatrix4(o.matrixWorld)
      parts.push({ geometry, material: o.material })
    }
  })
  return parts
}

/** Loads each layer's model and adds one InstancedMesh per layer, snapped to the
 * terrain surface. A failed load skips that layer — decoration never blocks play. */
export async function createScatterLayers(
  scene: THREE.Scene,
  layers: ScatterLayer[],
  width: number,
  height: number,
  collision: string[],
  occupied: Set<string>,
  seedBase: number,
  heightAt: (x: number, z: number) => number,
): Promise<void> {
  await Promise.all(
    layers.map(async (layer, li) => {
      const instances = scatterPositions(width, height, collision, occupied, layer, seedBase + li * 7919, heightAt)
      if (!instances.length) return
      let gltf
      try {
        gltf = await new GLTFLoader().loadAsync(modelUrl(`/models/props/${layer.model}.glb`))
      } catch {
        return
      }
      const parts = collectMeshParts(gltf.scene)
      if (!parts.length) return
      const base = SCATTER_BASE[layer.model] ?? 1
      // One shared transform per instance; every mesh part of the prop reuses it
      // so a multi-mesh GLB renders whole (one InstancedMesh — one draw call —
      // per part).
      const up = new THREE.Vector3(0, 1, 0)
      const q = new THREE.Quaternion()
      const pos = new THREE.Vector3()
      const scl = new THREE.Vector3()
      const matrices = instances.map((it) => {
        q.setFromAxisAngle(up, it.rot)
        pos.set(it.x, heightAt(it.x, it.z), it.z)
        scl.setScalar(it.scale * base)
        return new THREE.Matrix4().compose(pos, q, scl)
      })
      for (const part of parts) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, instances.length)
        matrices.forEach((mat, idx) => mesh.setMatrixAt(idx, mat))
        mesh.instanceMatrix.needsUpdate = true
        mesh.frustumCulled = false
        scene.add(mesh)
      }
    }),
  )
}
