import { setHeightSampler } from './scene'

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
