import type { ZoneDef } from '../../../shared/zone'
import { groundKind, groundKindGrid } from '../../../shared/groundKinds'

// 2D top-down canvas view of a zone: the collision grid painted with the zone's
// ground palette (matching the 3D client's ground checker) plus markers for
// spawn, objects, npcs, props and exits. Pan (drag with space/middle button or
// the pan tool) and zoom (wheel). Emits tile-level pointer events; the editor
// wires those to whichever tool is active.

const DEFAULT_PALETTE = { walkableA: '#4a7c3a', walkableB: '#568c44', blockedA: '#3a3428', blockedB: '#443d30' }

export type TilePointer = { x: number; z: number; phase: 'down' | 'move' | 'up'; buttons: number; inside: boolean }

type Marker = { x: number; z: number; glyph: string; color: string }

export class GridView {
  private ctx: CanvasRenderingContext2D
  private def: ZoneDef
  private tile = 22
  private originX = 0
  private originZ = 0
  private hover: { x: number; z: number } | null = null
  private selection: { x: number; z: number } | null = null
  private dragPreview: { x0: number; z0: number; x1: number; z1: number } | null = null
  private panning = false
  private panStart = { x: 0, y: 0, ox: 0, oz: 0 }
  private spacePan = false
  handler: ((p: TilePointer) => void) | null = null

  constructor(private canvas: HTMLCanvasElement, def: ZoneDef) {
    this.ctx = canvas.getContext('2d')!
    this.def = def
    this.attach()
    this.fit()
  }

  setDef(def: ZoneDef): void {
    this.def = def
    this.render()
  }

  setDragPreview(p: { x0: number; z0: number; x1: number; z1: number } | null): void {
    this.dragPreview = p
    this.render()
  }

  setSelection(sel: { x: number; z: number } | null): void {
    this.selection = sel
    this.render()
  }

  /** Public tile lookup for external drop handlers (HTML5 drag-and-drop). */
  tileAt(clientX: number, clientY: number): { x: number; z: number } {
    return this.screenToTile(clientX, clientY)
  }

  /** Centres the grid and picks a zoom that fits it in the viewport. */
  fit(): void {
    const rect = this.canvas.getBoundingClientRect()
    this.resizeBacking(rect)
    const tx = Math.floor((rect.width - 24) / this.def.width)
    const tz = Math.floor((rect.height - 24) / this.def.height)
    this.tile = Math.max(6, Math.min(40, Math.min(tx, tz)))
    this.originX = (rect.width - this.def.width * this.tile) / 2
    this.originZ = (rect.height - this.def.height * this.tile) / 2
    this.render()
  }

  private resizeBacking(rect: DOMRect): void {
    const dpr = Math.min(window.devicePixelRatio, 2)
    this.canvas.width = Math.floor(rect.width * dpr)
    this.canvas.height = Math.floor(rect.height * dpr)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  private screenToTile(clientX: number, clientY: number): { x: number; z: number } {
    const rect = this.canvas.getBoundingClientRect()
    const x = Math.floor((clientX - rect.left - this.originX) / this.tile)
    const z = Math.floor((clientY - rect.top - this.originZ) / this.tile)
    return { x, z }
  }

  private inside(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < this.def.width && z < this.def.height
  }

  private attach(): void {
    this.canvas.addEventListener('pointerdown', (e) => {
      this.canvas.setPointerCapture(e.pointerId)
      if (e.button === 1 || this.spacePan) {
        this.panning = true
        this.panStart = { x: e.clientX, y: e.clientY, ox: this.originX, oz: this.originZ }
        return
      }
      const { x, z } = this.screenToTile(e.clientX, e.clientY)
      this.emit(x, z, 'down', e.buttons)
    })
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.panning) {
        this.originX = this.panStart.ox + (e.clientX - this.panStart.x)
        this.originZ = this.panStart.oz + (e.clientY - this.panStart.y)
        this.render()
        return
      }
      const { x, z } = this.screenToTile(e.clientX, e.clientY)
      this.hover = this.inside(x, z) ? { x, z } : null
      this.emit(x, z, 'move', e.buttons)
      this.render()
    })
    const end = (e: PointerEvent) => {
      if (this.panning) {
        this.panning = false
        return
      }
      const { x, z } = this.screenToTile(e.clientX, e.clientY)
      this.emit(x, z, 'up', e.buttons)
    }
    this.canvas.addEventListener('pointerup', end)
    this.canvas.addEventListener('pointerleave', () => {
      this.hover = null
      this.render()
    })
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault()
      const rect = this.canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const worldX = (mx - this.originX) / this.tile
      const worldZ = (my - this.originZ) / this.tile
      const next = Math.max(6, Math.min(40, this.tile * (e.deltaY < 0 ? 1.1 : 0.9)))
      this.tile = next
      this.originX = mx - worldX * this.tile
      this.originZ = my - worldZ * this.tile
      this.render()
    }, { passive: false })
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') this.spacePan = true
    })
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.spacePan = false
    })
    window.addEventListener('resize', () => this.fit())
  }

  private emit(x: number, z: number, phase: TilePointer['phase'], buttons: number): void {
    this.handler?.({ x, z, phase, buttons, inside: this.inside(x, z) })
  }

  private markers(): Marker[] {
    const out: Marker[] = []
    for (const o of this.def.objects) {
      if (o.type === 'rock') out.push({ x: o.x, z: o.z, glyph: '⛏', color: '#c9d3dd' })
      else if (o.type === 'tree') out.push({ x: o.x, z: o.z, glyph: '🌲', color: '#8fd694' })
      else if (o.type === 'fishing_spot') out.push({ x: o.x, z: o.z, glyph: '🎣', color: '#8dcad7' })
      else if (o.type === 'gather_site') out.push({ x: o.x, z: o.z, glyph: '🧵', color: '#d7c498' })
      else if (o.type === 'bank_chest') out.push({ x: o.x, z: o.z, glyph: '🏦', color: '#e6c56b' })
      else if (o.type === 'furnace') out.push({ x: o.x, z: o.z, glyph: '🔥', color: '#ff9a5a' })
      else if (o.type === 'anvil') out.push({ x: o.x, z: o.z, glyph: '🔨', color: '#c9d3dd' })
      else if (o.type === 'range') out.push({ x: o.x, z: o.z, glyph: '🍳', color: '#ffcf7a' })
    }
    for (const n of this.def.npcs) out.push({ x: n.x, z: n.z, glyph: '☠', color: '#ff8a7a' })
    for (const e of this.def.exits ?? []) out.push({ x: e.x, z: e.z, glyph: '🚪', color: '#8ab4ff' })
    for (const p of this.def.props ?? []) out.push({ x: p.x, z: p.z, glyph: '•', color: '#b6a98f' })
    return out
  }

  render(): void {
    const ctx = this.ctx
    const rect = this.canvas.getBoundingClientRect()
    ctx.clearRect(0, 0, rect.width, rect.height)
    ctx.fillStyle = '#0d0f0c'
    ctx.fillRect(0, 0, rect.width, rect.height)

    const pal = this.def.palette ?? DEFAULT_PALETTE
    const t = this.tile
    for (let z = 0; z < this.def.height; z++) {
      for (let x = 0; x < this.def.width; x++) {
        const blocked = this.def.collision[z]?.[x] === '#'
        const even = (x + z) % 2 === 0
        ctx.fillStyle = blocked ? (even ? pal.blockedA : pal.blockedB) : (even ? pal.walkableA : pal.walkableB)
        ctx.fillRect(this.originX + x * t, this.originZ + z * t, t, t)
      }
    }

    // Painted ground kinds over the base tiles (matches the 3D ground-paint layer).
    const gk = groundKindGrid(this.def.width, this.def.height, this.def.ground)
    for (let z = 0; z < this.def.height; z++) {
      for (let x = 0; x < this.def.width; x++) {
        const kind = groundKind(gk[z * this.def.width + x])
        if (!kind) continue
        ctx.fillStyle = kind.color
        ctx.fillRect(this.originX + x * t, this.originZ + z * t, t, t)
      }
    }

    // Grid lines fade out when tiles are small.
    if (t >= 10) {
      ctx.strokeStyle = 'rgba(0,0,0,0.22)'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let x = 0; x <= this.def.width; x++) {
        ctx.moveTo(this.originX + x * t, this.originZ)
        ctx.lineTo(this.originX + x * t, this.originZ + this.def.height * t)
      }
      for (let z = 0; z <= this.def.height; z++) {
        ctx.moveTo(this.originX, this.originZ + z * t)
        ctx.lineTo(this.originX + this.def.width * t, this.originZ + z * t)
      }
      ctx.stroke()
    }

    // Spawn.
    this.drawGlyph(this.def.spawn.x, this.def.spawn.z, '◎', '#ffe27a')

    // Content markers.
    for (const m of this.markers()) this.drawGlyph(m.x, m.z, m.glyph, m.color)

    // Drag-rectangle preview.
    if (this.dragPreview) {
      const { x0, z0, x1, z1 } = this.dragPreview
      const xa = Math.min(x0, x1)
      const za = Math.min(z0, z1)
      const w = Math.abs(x1 - x0) + 1
      const h = Math.abs(z1 - z0) + 1
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.strokeRect(this.originX + xa * t, this.originZ + za * t, w * t, h * t)
    }

    // Selected item cell.
    if (this.selection) {
      ctx.strokeStyle = '#ffd24a'
      ctx.lineWidth = 2.5
      ctx.strokeRect(this.originX + this.selection.x * t + 1, this.originZ + this.selection.z * t + 1, t - 2, t - 2)
    }

    // Hover cell.
    if (this.hover) {
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'
      ctx.lineWidth = 2
      ctx.strokeRect(this.originX + this.hover.x * t + 1, this.originZ + this.hover.z * t + 1, t - 2, t - 2)
    }
  }

  private drawGlyph(x: number, z: number, glyph: string, color: string): void {
    const ctx = this.ctx
    const t = this.tile
    const cx = this.originX + x * t + t / 2
    const cz = this.originZ + z * t + t / 2
    ctx.fillStyle = color
    ctx.font = `${Math.max(8, Math.floor(t * 0.7))}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(glyph, cx, cz)
  }
}
