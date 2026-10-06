import type { ZoneDef } from '../../../shared/zone'
import type { CatalogEntry } from '../../../shared/catalog'

// Pure placement/selection helpers over a ZoneDef. The editor wires pointer
// events to these; keeping them pure makes them unit-testable and keeps main.ts
// to orchestration.

export type SelGroup = 'objects' | 'npcs' | 'exits' | 'props'
export type Selection = { group: SelGroup; index: number }

/** A unique id within the zone, `<prefix>_<n>`. Scans objects/npcs/exits. */
export function genId(def: ZoneDef, prefix: string): string {
  const taken = new Set<string>([
    ...def.objects.map((o) => o.id),
    ...def.npcs.map((n) => n.id),
    ...(def.exits ?? []).map((e) => e.id),
  ])
  let n = 1
  while (taken.has(`${prefix}_${n}`)) n++
  return `${prefix}_${n}`
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** Places a catalog entry at (x,z). Exits are placed with a placeholder target
 * (self spawn) the inspector then edits — an exit isn't valid until retargeted. */
export function placeEntry(def: ZoneDef, entry: CatalogEntry, x: number, z: number): Selection {
  if (entry.kind === 'rock') {
    def.objects.push({ id: genId(def, 'rock'), type: 'rock', rock: entry.rock, x, z })
    return { group: 'objects', index: def.objects.length - 1 }
  }
  if (entry.kind === 'tree') {
    def.objects.push({ id: genId(def, 'tree'), type: 'tree', tree: entry.tree, x, z })
    return { group: 'objects', index: def.objects.length - 1 }
  }
  if (entry.kind === 'fishing_spot') {
    def.objects.push({ id: genId(def, 'fishing'), type: 'fishing_spot', fishing: entry.fishing, x, z })
    return { group: 'objects', index: def.objects.length - 1 }
  }
  if (entry.kind === 'gather_site') {
    def.objects.push({ id: genId(def, 'gather'), type: 'gather_site', gather: entry.gather, x, z })
    return { group: 'objects', index: def.objects.length - 1 }
  }
  if (entry.kind === 'object') {
    const prefix = entry.objectType === 'bank_chest' ? 'chest' : entry.objectType
    def.objects.push({ id: genId(def, prefix), type: entry.objectType, x, z })
    return { group: 'objects', index: def.objects.length - 1 }
  }
  if (entry.kind === 'npc') {
    const w = Math.min(8, def.width)
    const h = Math.min(8, def.height)
    def.npcs.push({
      id: genId(def, 'npc'),
      monsterId: entry.monsterId,
      x,
      z,
      wander: { x: clamp(x - Math.floor(w / 2), 0, def.width - w), z: clamp(z - Math.floor(h / 2), 0, def.height - h), w, h },
    })
    return { group: 'npcs', index: def.npcs.length - 1 }
  }
  // prop
  def.props ??= []
  def.props.push({ model: entry.model, x, z })
  return { group: 'props', index: def.props.length - 1 }
}

/** Adds an exit at (x,z) targeting its own spawn as a placeholder; the inspector
 * retargets it. Returns the selection so the UI can open the arrival picker. */
export function placeExit(def: ZoneDef, x: number, z: number): Selection {
  def.exits ??= []
  def.exits.push({ id: genId(def, 'exit'), x, z, toZone: def.id, toX: def.spawn.x, toZ: def.spawn.z, label: 'New exit' })
  return { group: 'exits', index: def.exits.length - 1 }
}

function coordsOf(def: ZoneDef, sel: Selection): { x: number; z: number } | null {
  const arr = arrayFor(def, sel.group)
  const item = arr[sel.index] as { x: number; z: number } | undefined
  return item ? { x: item.x, z: item.z } : null
}

function arrayFor(def: ZoneDef, group: SelGroup): Array<{ x: number; z: number }> {
  if (group === 'objects') return def.objects
  if (group === 'npcs') return def.npcs
  if (group === 'exits') return def.exits ??= []
  return def.props ??= []
}

/** Topmost placed item at a tile, priority exit > npc > object > prop. */
export function findItemAt(def: ZoneDef, x: number, z: number): Selection | null {
  const groups: SelGroup[] = ['exits', 'npcs', 'objects', 'props']
  for (const group of groups) {
    const arr = arrayFor(def, group)
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].x === x && arr[i].z === z) return { group, index: i }
    }
  }
  return null
}

export function moveItem(def: ZoneDef, sel: Selection, x: number, z: number): void {
  const item = arrayFor(def, sel.group)[sel.index]
  if (!item) return
  item.x = clamp(x, 0, def.width - 1)
  item.z = clamp(z, 0, def.height - 1)
}

export function deleteItem(def: ZoneDef, sel: Selection): void {
  arrayFor(def, sel.group).splice(sel.index, 1)
}

export { coordsOf }
