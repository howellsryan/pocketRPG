import * as THREE from 'three'
import { createGroundChunk, type GroundPalette } from './scene'

// Chunk-streamed ground (docs/single-world-map-investigation.md M2). A big
// overworld map's ground is built as a grid of independent chunk meshes rather
// than one map-sized plane + one map-sized canvas — so the client only ever
// holds the chunks near a centre, and map SIZE stops bounding client cost.
//
// The scheduling half (which chunks are active, what enters/leaves as the centre
// moves) is pure and unit-tested — it mirrors the AOI enter/leave diff on the
// server. The mesh half streams: build a chunk on enter, dispose it (geometry +
// its own texture) on leave. Live per-zone maps stay on the single-mesh
// createGround path; only maps past the threshold in terrain.ts chunk.

export const CHUNK_TILES = 32

export type ChunkKey = string
export function chunkKey(cx: number, cz: number): ChunkKey {
  return `${cx},${cz}`
}

/** Chunk-grid dimensions for a width×height tile map. The last chunk in each
 * axis is partial when the map isn't a whole number of chunks. */
export function chunkGridDims(width: number, height: number, chunkTiles: number = CHUNK_TILES): { cols: number; rows: number } {
  return { cols: Math.max(1, Math.ceil(width / chunkTiles)), rows: Math.max(1, Math.ceil(height / chunkTiles)) }
}

/** Tile bounds of chunk (cx,cz): [x0, x0+cw) × [z0, z0+ch), clamped so edge
 * chunks don't overrun the map. */
export function chunkTileBounds(cx: number, cz: number, width: number, height: number, chunkTiles: number = CHUNK_TILES): { x0: number; z0: number; cw: number; ch: number } {
  const x0 = cx * chunkTiles
  const z0 = cz * chunkTiles
  return { x0, z0, cw: Math.min(chunkTiles, width - x0), ch: Math.min(chunkTiles, height - z0) }
}

/** Chunk keys whose chunk is within `radiusChunks` (Chebyshev) of the chunk
 * holding world tile (centreX,centreZ), clamped to the grid. radius large enough
 * to span the grid returns every chunk (the full-map render case). */
export function activeChunks(
  centreX: number,
  centreZ: number,
  width: number,
  height: number,
  radiusChunks: number,
  chunkTiles: number = CHUNK_TILES,
): ChunkKey[] {
  const { cols, rows } = chunkGridDims(width, height, chunkTiles)
  const ccx = Math.min(cols - 1, Math.max(0, Math.floor(centreX / chunkTiles)))
  const ccz = Math.min(rows - 1, Math.max(0, Math.floor(centreZ / chunkTiles)))
  const out: ChunkKey[] = []
  for (let cz = Math.max(0, ccz - radiusChunks); cz <= Math.min(rows - 1, ccz + radiusChunks); cz++) {
    for (let cx = Math.max(0, ccx - radiusChunks); cx <= Math.min(cols - 1, ccx + radiusChunks); cx++) {
      out.push(chunkKey(cx, cz))
    }
  }
  return out
}

/** Streaming diff: which chunks to build (in next, not prev) and which to
 * dispose (in prev, not next). */
export function diffChunks(prev: Set<ChunkKey>, next: Set<ChunkKey>): { add: ChunkKey[]; remove: ChunkKey[] } {
  const add: ChunkKey[] = []
  const remove: ChunkKey[] = []
  for (const k of next) if (!prev.has(k)) add.push(k)
  for (const k of prev) if (!next.has(k)) remove.push(k)
  return { add, remove }
}

export type ChunkedTerrain = {
  group: THREE.Group
  /** Ground meshes currently live — the picking raycast targets. */
  pickTargets: () => THREE.Object3D[]
  /** Stream chunks so only those within `radiusChunks` of (x,z) are live. */
  setCentre: (x: number, z: number, radiusChunks: number) => void
  dispose: () => void
}

function disposeChunk(mesh: THREE.Mesh, sharedMaterial: THREE.Material | undefined): void {
  mesh.parent?.remove(mesh)
  mesh.geometry.dispose()
  // A per-chunk checker material owns its canvas texture; a shared preset
  // material is disposed once at teardown, not per chunk.
  if (!sharedMaterial) {
    const mat = mesh.material as THREE.MeshStandardMaterial
    mat.map?.dispose()
    mat.dispose()
  }
}

/** Builds the chunk manager for a corner-lifted map. `sharedMaterial` (a terrain
 * preset) is reused across every chunk; without it each chunk builds its own
 * checker texture. Nothing renders until the first setCentre. */
export function createChunkedTerrain(
  scene: THREE.Scene,
  collision: string[],
  width: number,
  height: number,
  palette: GroundPalette | undefined,
  corners: Float32Array,
  sharedMaterial: THREE.Material | undefined,
  chunkTiles: number = CHUNK_TILES,
): ChunkedTerrain {
  const group = new THREE.Group()
  scene.add(group)
  const live = new Map<ChunkKey, THREE.Mesh>()

  const setCentre = (x: number, z: number, radiusChunks: number): void => {
    const next = new Set(activeChunks(x, z, width, height, radiusChunks, chunkTiles))
    const { add, remove } = diffChunks(new Set(live.keys()), next)
    for (const key of remove) {
      const mesh = live.get(key)
      if (mesh) disposeChunk(mesh, sharedMaterial)
      live.delete(key)
    }
    for (const key of add) {
      const [cx, cz] = key.split(',').map(Number)
      const { x0, z0, cw, ch } = chunkTileBounds(cx, cz, width, height, chunkTiles)
      if (cw <= 0 || ch <= 0) continue
      const mesh = createGroundChunk(group, collision, width, height, x0, z0, cw, ch, palette, corners, sharedMaterial)
      live.set(key, mesh)
    }
  }

  return {
    group,
    pickTargets: () => [...live.values()],
    setCentre,
    dispose: () => {
      for (const mesh of live.values()) disposeChunk(mesh, sharedMaterial)
      live.clear()
      sharedMaterial?.dispose()
      group.parent?.remove(group)
    },
  }
}
