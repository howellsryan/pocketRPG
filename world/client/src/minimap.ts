// Top-right minimap: a baked top-down view of the current zone's collision grid
// with live dots for the player, npcs, other players and exits. Positioned above
// the inventory panel (feature request 2026-07). Pure DOM/canvas — no three.js.
import type { GroundPalette } from '../../shared/protocol'

const SIZE_PX = 132
const SELF_COLOR = '#ffe066'
const NPC_COLOR = '#e05a5a'
const OTHER_COLOR = '#ffffff'
const EXIT_COLOR = '#61d0d8'
const DEFAULT_WALKABLE = '#4a7c3a'
const DEFAULT_BLOCKED = '#2c2620'

export type MinimapDot = { x: number; z: number; kind: 'npc' | 'other' | 'exit' }

export type Minimap = {
  update(self: { x: number; z: number }, dots: MinimapDot[]): void
  destroy(): void
}

const MINIMAP_CSS = `
#minimap {
  position: fixed; right: 8px; top: 8px; z-index: 10;
  width: ${SIZE_PX}px; height: ${SIZE_PX}px;
  background: rgba(20, 16, 10, 0.82); border: 1px solid #5a4a30; border-radius: 8px;
  overflow: hidden;
}
#minimap canvas { display: block; width: 100%; height: 100%; image-rendering: pixelated; }
`

function ensureStyle(): void {
  if (document.getElementById('minimap-style')) return
  const style = document.createElement('style')
  style.id = 'minimap-style'
  style.textContent = MINIMAP_CSS
  document.head.appendChild(style)
}

/** Bakes the zone collision to an offscreen canvas once; each update() blits it
 * and draws the live dots on top. The whole zone is scaled to fit the square.
 * A click/tap walks the player to the tapped tile via `onClickTile`. */
export function createMinimap(collision: string[], width: number, height: number, palette?: GroundPalette, onClickTile?: (tile: { x: number; z: number }) => void): Minimap {
  ensureStyle()
  const container = document.createElement('div')
  container.id = 'minimap'
  const canvas = document.createElement('canvas')
  canvas.width = SIZE_PX
  canvas.height = SIZE_PX
  container.appendChild(canvas)
  document.body.appendChild(container)
  const ctx = canvas.getContext('2d')!

  const cell = SIZE_PX / Math.max(width, height)
  const offsetX = (SIZE_PX - width * cell) / 2
  const offsetZ = (SIZE_PX - height * cell) / 2

  if (onClickTile) {
    canvas.addEventListener('pointerdown', (e) => {
      const rect = canvas.getBoundingClientRect()
      // The canvas is styled to 100% of the container — map through its CSS size.
      const px = ((e.clientX - rect.left) / rect.width) * SIZE_PX
      const pz = ((e.clientY - rect.top) / rect.height) * SIZE_PX
      const x = Math.floor((px - offsetX) / cell)
      const z = Math.floor((pz - offsetZ) / cell)
      if (x < 0 || z < 0 || x >= width || z >= height) return
      if (collision[z]?.[x] === '#') return
      onClickTile({ x, z })
    })
  }
  const walkable = palette?.walkableA ?? DEFAULT_WALKABLE
  const blocked = palette?.blockedA ?? DEFAULT_BLOCKED

  const base = document.createElement('canvas')
  base.width = SIZE_PX
  base.height = SIZE_PX
  const baseCtx = base.getContext('2d')!
  baseCtx.fillStyle = blocked
  baseCtx.fillRect(0, 0, SIZE_PX, SIZE_PX)
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      baseCtx.fillStyle = collision[z]?.[x] === '#' ? blocked : walkable
      baseCtx.fillRect(offsetX + x * cell, offsetZ + z * cell, Math.ceil(cell), Math.ceil(cell))
    }
  }

  const dotAt = (x: number, z: number, color: string, r: number): void => {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(offsetX + (x + 0.5) * cell, offsetZ + (z + 0.5) * cell, r, 0, Math.PI * 2)
    ctx.fill()
  }

  return {
    update(self, dots) {
      ctx.clearRect(0, 0, SIZE_PX, SIZE_PX)
      ctx.drawImage(base, 0, 0)
      for (const dot of dots) {
        if (dot.kind === 'exit') dotAt(dot.x, dot.z, EXIT_COLOR, 2.5)
      }
      for (const dot of dots) {
        if (dot.kind === 'npc') dotAt(dot.x, dot.z, NPC_COLOR, 2.5)
        else if (dot.kind === 'other') dotAt(dot.x, dot.z, OTHER_COLOR, 2.5)
      }
      dotAt(self.x, self.z, SELF_COLOR, 3.2)
    },
    destroy() {
      container.remove()
    },
  }
}
