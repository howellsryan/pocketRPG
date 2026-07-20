// Top-right minimap: a baked top-down view of the current zone's collision grid
// with live dots for the player, npcs, other players and exits. Positioned above
// the inventory panel (feature request 2026-07). Pure DOM/canvas — no three.js.
//
// The merged overworld (348x213 tiles) is far larger than the zones this was
// first built for (32-64 tiles), so the whole-zone bake used to squeeze every
// tile into a 132px square at a fraction of a pixel each — an unreadable smear,
// and a tap could walk the player hundreds of tiles away. Instead the base
// bake stays at BAKE_PX_PER_TILE resolution and each update() blits a
// VIEW_TILES-wide window centred on the player; a zone smaller than the window
// in a given axis (e.g. lumbright, 64x64) is shown in full on that axis,
// exactly like the old whole-zone behaviour, via the same clamp math.
import type { GroundPalette, StaticObject } from '../../shared/protocol'
import { clusterByType, type Cluster } from '../../shared/mapClusters'
import { CATEGORY_ICON_KEY, STATIC_CATEGORY } from '../../shared/mapCategories'
import { uiIconMarkup } from './itemIcon'

const SIZE_PX = 132
const SELF_COLOR = '#ffe066'
const NPC_COLOR = '#e05a5a'
const BOSS_COLOR = '#ff3ad6'
const OTHER_COLOR = '#ffffff'
const EXIT_COLOR = '#61d0d8'
const DEFAULT_WALKABLE = '#4a7c3a'
const DEFAULT_BLOCKED = '#2c2620'
const BAKE_PX_PER_TILE = 4
const VIEW_TILES = 41
// Statics never move, so they're clustered once at zone-load time (same
// technique as the big world map, smaller radius to suit the minimap's tight
// icon size) rather than re-clustered every update().
const STATIC_CLUSTER_RADIUS = 3
const STATIC_ICON_PX = 11

export type MinimapDot = { x: number; z: number; kind: 'npc' | 'other' | 'exit'; boss?: boolean }

export type Minimap = {
  update(self: { x: number; z: number }, dots: MinimapDot[]): void
  destroy(): void
}

export type MinimapView = { x0: number; z0: number; tilesShownX: number; tilesShownZ: number }

/** The tile window the minimap currently shows: up to `viewTiles` tiles per
 * axis, centred on the player and clamped to the zone bounds. A zone smaller
 * than `viewTiles` on an axis shows that whole axis (tilesShown = the zone's
 * own dimension), which is what makes small zones render whole exactly as
 * they did before viewport windowing existed. Pure — no canvas, testable. */
export function minimapView(selfX: number, selfZ: number, width: number, height: number, viewTiles: number): MinimapView {
  const tilesShownX = Math.min(viewTiles, width)
  const tilesShownZ = Math.min(viewTiles, height)
  const x0 = Math.max(0, Math.min(width - tilesShownX, selfX - tilesShownX / 2))
  const z0 = Math.max(0, Math.min(height - tilesShownZ, selfZ - tilesShownZ / 2))
  return { x0, z0, tilesShownX, tilesShownZ }
}

/** True when a tile position falls inside the current view window — used to
 * skip drawing static-icon clusters that have scrolled off the minimap. Pure. */
export function inMinimapView(x: number, z: number, view: MinimapView): boolean {
  return x >= view.x0 && x < view.x0 + view.tilesShownX && z >= view.z0 && z < view.z0 + view.tilesShownZ
}

/** Clusters a zone's statics into one marker per category per nearby group
 * (a mining site's five rocks becomes one "mining" icon), same technique as
 * the big world map. Pure — statics never move, so callers cluster once. */
export function clusterStatics(statics: { id: string; type: string; x: number; z: number }[], radius: number): Cluster[] {
  const inputs = statics
    .filter((s) => STATIC_CATEGORY[s.type])
    .map((s) => ({ id: s.id, type: STATIC_CATEGORY[s.type], x: s.x, z: s.z }))
  return clusterByType(inputs, radius)
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

/** Renders `key`'s bespoke icon (via uiIconMarkup) to an offscreen Image so
 * canvas drawImage() can blit it — uiIconMarkup returns SVG markup, which
 * canvas can't draw directly. Resolves once the image has decoded. */
function rasteriseIcon(key: string): Promise<HTMLImageElement> {
  const svg = uiIconMarkup(key, STATIC_ICON_PX)
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = (err) => {
      URL.revokeObjectURL(url)
      reject(err)
    }
    img.src = url
  })
}

/** Bakes the zone collision to an offscreen canvas once at BAKE_PX_PER_TILE
 * resolution; each update() blits the current view window (see minimapView)
 * from that bake, draws the zone's static-object category icons (banks,
 * skilling nodes — clustered once here, since statics never move) under the
 * live dots, then the dots on top. A click/tap walks the player to the
 * tapped tile via `onClickTile`, mapped through the same window. */
export function createMinimap(collision: string[], width: number, height: number, palette: GroundPalette | undefined, statics: StaticObject[], onClickTile?: (tile: { x: number; z: number }) => void): Minimap {
  ensureStyle()
  const container = document.createElement('div')
  container.id = 'minimap'
  const canvas = document.createElement('canvas')
  canvas.width = SIZE_PX
  canvas.height = SIZE_PX
  container.appendChild(canvas)
  document.body.appendChild(container)
  const ctx = canvas.getContext('2d')!

  const walkable = palette?.walkableA ?? DEFAULT_WALKABLE
  const blocked = palette?.blockedA ?? DEFAULT_BLOCKED

  const base = document.createElement('canvas')
  base.width = width * BAKE_PX_PER_TILE
  base.height = height * BAKE_PX_PER_TILE
  const baseCtx = base.getContext('2d')!
  baseCtx.fillStyle = blocked
  baseCtx.fillRect(0, 0, base.width, base.height)
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      baseCtx.fillStyle = collision[z]?.[x] === '#' ? blocked : walkable
      baseCtx.fillRect(x * BAKE_PX_PER_TILE, z * BAKE_PX_PER_TILE, BAKE_PX_PER_TILE, BAKE_PX_PER_TILE)
    }
  }

  // The most recently drawn view window + its screen transform — click
  // handling reads these so a tap maps through whatever's currently visible.
  let view: MinimapView = minimapView(0, 0, width, height, VIEW_TILES)
  let cell = SIZE_PX / Math.max(view.tilesShownX, view.tilesShownZ)
  let offsetX = (SIZE_PX - view.tilesShownX * cell) / 2
  let offsetZ = (SIZE_PX - view.tilesShownZ * cell) / 2

  // Statics never move — cluster once and rasterise each needed category
  // icon once. update() just skips a cluster if its icon hasn't finished
  // decoding yet (a few ms on first draw); no re-clustering per frame.
  const staticClusters = clusterStatics(statics, STATIC_CLUSTER_RADIUS)
  const staticIcons = new Map<string, HTMLImageElement>()
  for (const type of new Set(staticClusters.map((c) => c.type))) {
    const iconKey = CATEGORY_ICON_KEY[type]
    if (!iconKey) continue
    rasteriseIcon(iconKey)
      .then((img) => staticIcons.set(type, img))
      .catch(() => {})
  }

  if (onClickTile) {
    canvas.addEventListener('pointerdown', (e) => {
      const rect = canvas.getBoundingClientRect()
      // The canvas is styled to 100% of the container — map through its CSS size.
      const px = ((e.clientX - rect.left) / rect.width) * SIZE_PX
      const pz = ((e.clientY - rect.top) / rect.height) * SIZE_PX
      const x = Math.floor(view.x0 + (px - offsetX) / cell)
      const z = Math.floor(view.z0 + (pz - offsetZ) / cell)
      if (x < 0 || z < 0 || x >= width || z >= height) return
      if (collision[z]?.[x] === '#') return
      onClickTile({ x, z })
    })
  }

  const dotAt = (x: number, z: number, color: string, r: number): void => {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(offsetX + (x - view.x0 + 0.5) * cell, offsetZ + (z - view.z0 + 0.5) * cell, r, 0, Math.PI * 2)
    ctx.fill()
  }

  return {
    update(self, dots) {
      view = minimapView(self.x, self.z, width, height, VIEW_TILES)
      cell = SIZE_PX / Math.max(view.tilesShownX, view.tilesShownZ)
      offsetX = (SIZE_PX - view.tilesShownX * cell) / 2
      offsetZ = (SIZE_PX - view.tilesShownZ * cell) / 2
      ctx.clearRect(0, 0, SIZE_PX, SIZE_PX)
      ctx.drawImage(
        base,
        view.x0 * BAKE_PX_PER_TILE, view.z0 * BAKE_PX_PER_TILE,
        view.tilesShownX * BAKE_PX_PER_TILE, view.tilesShownZ * BAKE_PX_PER_TILE,
        offsetX, offsetZ, view.tilesShownX * cell, view.tilesShownZ * cell
      )
      for (const cluster of staticClusters) {
        if (!inMinimapView(cluster.x, cluster.z, view)) continue
        const icon = staticIcons.get(cluster.type)
        if (!icon) continue
        const px = offsetX + (cluster.x - view.x0 + 0.5) * cell
        const pz = offsetZ + (cluster.z - view.z0 + 0.5) * cell
        ctx.drawImage(icon, px - STATIC_ICON_PX / 2, pz - STATIC_ICON_PX / 2, STATIC_ICON_PX, STATIC_ICON_PX)
      }
      for (const dot of dots) {
        if (dot.kind === 'exit') dotAt(dot.x, dot.z, EXIT_COLOR, 2.5)
      }
      for (const dot of dots) {
        if (dot.kind === 'npc') dotAt(dot.x, dot.z, dot.boss ? BOSS_COLOR : NPC_COLOR, dot.boss ? 3.6 : 2.5)
        else if (dot.kind === 'other') dotAt(dot.x, dot.z, OTHER_COLOR, 2.5)
      }
      dotAt(self.x, self.z, SELF_COLOR, 3.2)
    },
    destroy() {
      container.remove()
    },
  }
}
