import * as THREE from 'three'
import creatures3dData from '../../../src/data/creatures3d.json'

// Bridge to the idle game's procedural blend-shell monster renderer
// (src/3d/rigs.js + blendShell.js): monsters that have a creatures3d spec but no
// GLB (e.g. the dungeon boss Warlord Grondar) render as their procedural creature
// in the world too, so the two games share one look. THREE is dependency-injected
// into those modules, and they're lazy-imported so the shader runtime only ships
// when a procedural monster is actually shown.

export type ProcCreature = {
  group: THREE.Object3D
  update: (dt: number) => void
  setLocomotion?: (rate: number) => void
  trigger: (name: 'attack' | 'hit' | 'death' | 'respawn') => void
  dispose: () => void
}

type Spec = {
  archetype?: string
  height?: number
  parts: { a: number[]; b: number[]; r1?: number; r2?: number }[]
  forms?: Record<string, Spec>
  initialForm?: string
}

export function creatureSpecFor(monsterId: string): Spec | null {
  const m = (creatures3dData as unknown as { monsters?: Record<string, Spec> }).monsters?.[monsterId]
  if (!m) return null
  if (m.forms) return m.forms[m.initialForm ?? ''] ?? Object.values(m.forms)[0]
  return m
}

/** Tallest authored point (unnormalised): the runtime doesn't height-normalise
 * the group the way the arena does, so we scale it to a target tile height. */
function rawTop(spec: Spec): number {
  let top = 0
  for (const p of spec.parts) {
    const r = Math.max(p.r1 ?? 0, p.r2 ?? 0)
    top = Math.max(top, p.a[1] + r, p.b[1] + r)
  }
  return top || 1
}

export async function buildProcCreature(monsterId: string, targetHeight: number): Promise<ProcCreature | null> {
  const spec = creatureSpecFor(monsterId)
  if (!spec) return null
  // Untyped cross-package JS module; THREE injected at runtime.
  const rigs = await import('../../../src/3d/rigs.js')
  const proc = (rigs as { createProcCreature: (t: typeof THREE, s: Spec) => ProcCreature }).createProcCreature(THREE, spec)
  proc.group.scale.setScalar(targetHeight / rawTop(spec))
  proc.group.traverse((o: THREE.Object3D) => { o.frustumCulled = false })
  return proc
}
