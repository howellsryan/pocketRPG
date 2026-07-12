import type { ZoneDef } from '../../../shared/zone'

// Editor document state: the working zone def, an undo/redo history of whole-def
// snapshots (defs are small — JSON snapshots are simpler and safer than diffs),
// a dirty flag, and a localStorage draft so an accidental reload never loses
// unsaved work. UI subscribes via onChange and re-renders from getDef().

const DRAFT_KEY = 'world_editor_draft'
const MAX_HISTORY = 60

export function blankZone(id: string, width = 24, height = 24): ZoneDef {
  const row = '.'.repeat(width)
  return {
    id,
    name: id,
    width,
    height,
    spawn: { x: Math.floor(width / 2), z: Math.floor(height / 2) },
    collision: Array.from({ length: height }, () => row),
    objects: [],
    npcs: [],
  }
}

function clone(def: ZoneDef): ZoneDef {
  return JSON.parse(JSON.stringify(def)) as ZoneDef
}

export class EditorState {
  private def: ZoneDef
  private undoStack: ZoneDef[] = []
  private redoStack: ZoneDef[] = []
  private dirty = false
  /** Last revision loaded/saved from the server; null for an unsaved new zone. */
  savedRevision: number | null = null
  private listeners = new Set<() => void>()

  constructor(def: ZoneDef) {
    this.def = def
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(): void {
    for (const fn of this.listeners) fn()
  }

  getDef(): ZoneDef {
    return this.def
  }

  isDirty(): boolean {
    return this.dirty
  }

  canUndo(): boolean {
    return this.undoStack.length > 0
  }

  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  /** Replaces the document wholesale (load from server / new zone), clearing
   * history. `dirty` false marks it as matching the server. */
  load(def: ZoneDef, revision: number | null): void {
    this.def = clone(def)
    this.undoStack = []
    this.redoStack = []
    this.dirty = false
    this.savedRevision = revision
    this.saveDraft()
    this.emit()
  }

  /** Applies a mutation with an undo checkpoint taken from the pre-mutation
   * state. Returns without emitting if the mutation left the def unchanged. */
  mutate(fn: (def: ZoneDef) => void): void {
    const before = clone(this.def)
    fn(this.def)
    if (JSON.stringify(before) === JSON.stringify(this.def)) return
    this.undoStack.push(before)
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift()
    this.redoStack = []
    this.dirty = true
    this.saveDraft()
    this.emit()
  }

  // Stroke API: a drag that paints many tiles is ONE undo entry. beginStroke
  // snapshots the pre-drag def, applyStroke edits live (re-rendering) without an
  // undo push, endStroke commits the whole stroke as a single history step.
  private strokeBefore: ZoneDef | null = null

  beginStroke(): void {
    this.strokeBefore = clone(this.def)
  }

  applyStroke(fn: (def: ZoneDef) => void): void {
    fn(this.def)
    this.emit()
  }

  endStroke(): void {
    const before = this.strokeBefore
    this.strokeBefore = null
    if (!before) return
    if (JSON.stringify(before) === JSON.stringify(this.def)) return
    this.undoStack.push(before)
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift()
    this.redoStack = []
    this.dirty = true
    this.saveDraft()
    this.emit()
  }

  undo(): void {
    const prev = this.undoStack.pop()
    if (!prev) return
    this.redoStack.push(clone(this.def))
    this.def = prev
    this.dirty = true
    this.saveDraft()
    this.emit()
  }

  redo(): void {
    const next = this.redoStack.pop()
    if (!next) return
    this.undoStack.push(clone(this.def))
    this.def = next
    this.dirty = true
    this.saveDraft()
    this.emit()
  }

  markSaved(revision: number): void {
    this.dirty = false
    this.savedRevision = revision
    this.saveDraft()
    this.emit()
  }

  private saveDraft(): void {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ def: this.def, dirty: this.dirty, savedRevision: this.savedRevision }))
    } catch {
      /* quota / private mode — draft is best-effort */
    }
  }

  static loadDraft(): { def: ZoneDef; dirty: boolean; savedRevision: number | null } | null {
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw) as { def: ZoneDef; dirty?: boolean; savedRevision?: number | null }
      if (!parsed?.def?.id) return null
      return { def: parsed.def, dirty: Boolean(parsed.dirty), savedRevision: parsed.savedRevision ?? null }
    } catch {
      return null
    }
  }

  static clearDraft(): void {
    try {
      localStorage.removeItem(DRAFT_KEY)
    } catch {
      /* ignore */
    }
  }
}

// ---- terrain helpers (pure; mutate a def in place) --------------------------

function setRowChar(row: string, x: number, ch: string): string {
  return row.slice(0, x) + ch + row.slice(x + 1)
}

export function paintTile(def: ZoneDef, x: number, z: number, blocked: boolean): void {
  if (x < 0 || z < 0 || x >= def.width || z >= def.height) return
  def.collision[z] = setRowChar(def.collision[z], x, blocked ? '#' : '.')
}

export function paintRect(def: ZoneDef, x0: number, z0: number, x1: number, z1: number, blocked: boolean): void {
  const [xa, xb] = x0 <= x1 ? [x0, x1] : [x1, x0]
  const [za, zb] = z0 <= z1 ? [z0, z1] : [z1, z0]
  for (let z = za; z <= zb; z++) for (let x = xa; x <= xb; x++) paintTile(def, x, z, blocked)
}

/** Flood-fills the connected region of same-walkability tiles starting at (x,z)
 * to the opposite walkability (4-connected). */
export function floodFill(def: ZoneDef, x: number, z: number, blocked: boolean): void {
  const start = def.collision[z]?.[x]
  if (start == null) return
  const target = blocked ? '#' : '.'
  if (start === target) return
  const stack: [number, number][] = [[x, z]]
  const seen = new Set<string>()
  while (stack.length) {
    const [cx, cz] = stack.pop()!
    if (cx < 0 || cz < 0 || cx >= def.width || cz >= def.height) continue
    const key = `${cx},${cz}`
    if (seen.has(key)) continue
    seen.add(key)
    if (def.collision[cz][cx] !== start) continue
    paintTile(def, cx, cz, blocked)
    stack.push([cx + 1, cz], [cx - 1, cz], [cx, cz + 1], [cx, cz - 1])
  }
}

/** Resizes the collision grid, preserving overlapping tiles and filling new
 * area as walkable. Spawn is clamped into bounds; callers should re-validate
 * (objects/npcs/exits may now be out of range — the validation panel flags it). */
export function resizeZone(def: ZoneDef, width: number, height: number): void {
  const rows: string[] = []
  for (let z = 0; z < height; z++) {
    const old = def.collision[z] ?? ''
    let row = ''
    for (let x = 0; x < width; x++) row += old[x] === '#' ? '#' : '.'
    rows.push(row)
  }
  def.width = width
  def.height = height
  def.collision = rows
  def.spawn = { x: Math.min(def.spawn.x, width - 1), z: Math.min(def.spawn.z, height - 1) }
}
