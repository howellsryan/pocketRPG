import type { ZoneDef } from '../../../shared/zone'
import { genId } from './placement'

// Stamps: capture a rectangular region of placed items as a reusable prefab
// (coords relative to the region's top-left) and stamp copies elsewhere with
// fresh ids. Prefabs persist in localStorage so set-pieces (a camp, a grove, a
// mine) can be reused across zones. Pure helpers; the editor wires the UI.

type RelObject = { type: 'rock' | 'bank_chest' | 'tree'; rock?: string; tree?: string; dx: number; dz: number }
type RelNpc = { monsterId: string; dx: number; dz: number; wander: { x: number; z: number; w: number; h: number } }
type RelExit = { dx: number; dz: number; toZone: string; toX: number; toZ: number; label: string }
type RelProp = { model: string; dx: number; dz: number; rot?: number; scale?: number }

export type Prefab = {
  name: string
  w: number
  h: number
  objects: RelObject[]
  npcs: RelNpc[]
  exits: RelExit[]
  props: RelProp[]
}

const STORE_KEY = 'world_editor_prefabs'

function within(x: number, z: number, x0: number, z0: number, x1: number, z1: number): boolean {
  return x >= Math.min(x0, x1) && x <= Math.max(x0, x1) && z >= Math.min(z0, z1) && z <= Math.max(z0, z1)
}

/** Captures every placed item inside the rectangle as a prefab with relative
 * coords. Returns null if the region is empty. */
export function extractRegion(def: ZoneDef, x0: number, z0: number, x1: number, z1: number, name = 'stamp'): Prefab | null {
  const minX = Math.min(x0, x1)
  const minZ = Math.min(z0, z1)
  const prefab: Prefab = { name, w: Math.abs(x1 - x0) + 1, h: Math.abs(z1 - z0) + 1, objects: [], npcs: [], exits: [], props: [] }
  for (const o of def.objects) {
    if (within(o.x, o.z, x0, z0, x1, z1)) prefab.objects.push({ type: o.type, rock: o.rock, tree: o.tree, dx: o.x - minX, dz: o.z - minZ })
  }
  for (const n of def.npcs) {
    if (within(n.x, n.z, x0, z0, x1, z1)) prefab.npcs.push({ monsterId: n.monsterId, dx: n.x - minX, dz: n.z - minZ, wander: { ...n.wander } })
  }
  for (const e of def.exits ?? []) {
    if (within(e.x, e.z, x0, z0, x1, z1)) prefab.exits.push({ dx: e.x - minX, dz: e.z - minZ, toZone: e.toZone, toX: e.toX, toZ: e.toZ, label: e.label })
  }
  for (const p of def.props ?? []) {
    if (within(p.x, p.z, x0, z0, x1, z1)) prefab.props.push({ model: p.model, dx: p.x - minX, dz: p.z - minZ, rot: p.rot, scale: p.scale })
  }
  const count = prefab.objects.length + prefab.npcs.length + prefab.exits.length + prefab.props.length
  return count > 0 ? prefab : null
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** Stamps a prefab with its top-left at (x,z), clamped into bounds, minting
 * fresh ids for everything (wander rects keep their shape, re-anchored). */
export function stampPrefab(def: ZoneDef, prefab: Prefab, x: number, z: number): void {
  for (const o of prefab.objects) {
    const prefix = o.type === 'tree' ? 'tree' : o.type === 'rock' ? 'rock' : 'chest'
    def.objects.push({ id: genId(def, prefix), type: o.type, rock: o.rock, tree: o.tree, x: clamp(x + o.dx, 0, def.width - 1), z: clamp(z + o.dz, 0, def.height - 1) })
  }
  for (const n of prefab.npcs) {
    const nx = clamp(x + n.dx, 0, def.width - 1)
    const nz = clamp(z + n.dz, 0, def.height - 1)
    const w = Math.min(n.wander.w, def.width)
    const h = Math.min(n.wander.h, def.height)
    def.npcs.push({ id: genId(def, 'npc'), monsterId: n.monsterId, x: nx, z: nz, wander: { x: clamp(nx - Math.floor(w / 2), 0, def.width - w), z: clamp(nz - Math.floor(h / 2), 0, def.height - h), w, h } })
  }
  for (const e of prefab.exits) {
    def.exits ??= []
    def.exits.push({ id: genId(def, 'exit'), x: clamp(x + e.dx, 0, def.width - 1), z: clamp(z + e.dz, 0, def.height - 1), toZone: e.toZone, toX: e.toX, toZ: e.toZ, label: e.label })
  }
  for (const p of prefab.props) {
    def.props ??= []
    def.props.push({ model: p.model, x: clamp(x + p.dx, 0, def.width - 1), z: clamp(z + p.dz, 0, def.height - 1), rot: p.rot, scale: p.scale })
  }
}

export function loadPrefabs(): Record<string, Prefab> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Record<string, Prefab>
  } catch {
    return {}
  }
}

export function savePrefab(prefab: Prefab): void {
  const all = loadPrefabs()
  all[prefab.name] = prefab
  localStorage.setItem(STORE_KEY, JSON.stringify(all))
}
