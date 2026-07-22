// Full-screen world map: a button (top-right column, under the minimap) opens
// a large, zoomable/pannable view of the whole zone with markers for every
// interactive thing — places, banks, skilling nodes, monster spawns, exits.
// Info-only (no "Travel here" — travel is walking or Magic-tab teleports
// only, 2026-07). Pure DOM/canvas, no three.js; mirrors the conventions of
// minimap.ts/bank.ts (module-level style injection, one open/close pair, pure
// helpers pulled out for testability).
import type { ExitMarker, GroundPalette, Landmark, NpcSpawn, StaticObject, ZoneGroundRegion } from '../../shared/protocol'
import { groundKind, groundKindGrid } from '../../shared/groundKinds'
import { clusterByType, type Cluster, type ClusterInput } from '../../shared/mapClusters'
import { CATEGORY_ICON_KEY, STATIC_CATEGORY } from '../../shared/mapCategories'
import { uiIconMarkup } from './itemIcon'
import worldData from '../../../src/data/world.json'
import monstersData from '../../../src/data/monsters.json'
import skillsData from '../../../src/data/skills.json'
import { MONSTER_ART } from '../../../src/utils/combatArt.js'
import { registerEscapeHandler } from './ui'

const BAKE_PX_PER_TILE = 6
const MIN_ZOOM_MULT = 1
const MAX_ZOOM_MULT = 4
const CLUSTER_RADIUS = 3
const DEFAULT_WALKABLE = '#4a7c3a'
const DEFAULT_BLOCKED = '#2c2620'
// Constant on-screen marker size regardless of zoom (§9: 44x44 tap targets) —
// markers live in viewport space and are repositioned on every pan/zoom
// change, rather than living inside the scaled/panned map stage.
const MARKER_PX = 44

type WorldPlace = { id: string; name: string; icon?: string; sub?: string; lore?: string; facilities?: string[] }
const worldPlaces = (worldData as { places: Record<string, WorldPlace> }).places

type MonsterInfo = { name?: string; combatLevel?: number } | undefined
const monsters = monstersData as unknown as Record<string, MonsterInfo>

type SkillAction = { id: string; name: string; level: number }
type SkillsData = { mining: { actions: SkillAction[] }; woodcutting: { actions: SkillAction[] } }
const miningActions: Record<string, SkillAction> = Object.fromEntries(
  (skillsData as unknown as SkillsData).mining.actions.map((a) => [a.id, a])
)
const woodcuttingActions: Record<string, SkillAction> = Object.fromEntries(
  (skillsData as unknown as SkillsData).woodcutting.actions.map((a) => [a.id, a])
)

const FACILITY_LABEL: Record<string, string> = {
  bank: 'Bank', furnace_anvil: 'Furnace & Anvil', sawmill: 'Sawmill', altar: 'Altar', stove: 'Cooking Range',
}

export type WorldMapData = {
  collision: string[]
  width: number
  height: number
  palette?: GroundPalette
  ground?: ZoneGroundRegion[]
  statics: StaticObject[]
  landmarks: Landmark[]
  spawns: NpcSpawn[]
  exits: ExitMarker[]
  self: { x: number; z: number }
}

// STATIC_CATEGORY (statics→category) and CATEGORY_ICON_KEY (category→bespoke
// icon key) now live in shared/mapCategories.ts, reused by minimap.ts. Places
// (world.json's own emoji) and Monsters (combatArt.js's MONSTER_ART) use their
// own per-entry art and aren't part of that shared table.
const PLACE_EMOJI_FALLBACK = '📍'
const MONSTER_ICON_FALLBACK = '👹'
const CATEGORY_LABEL: Record<string, string> = {
  bank: 'Bank', smithing: 'Smithing', cooking: 'Cooking', mining: 'Mining', woodcutting: 'Woodcutting',
  place: 'Place', monster: 'Monster', exit: 'Exit',
}
// Filter chips group the four skilling categories under one "Skilling" toggle.
const FILTER_CHIPS: { label: string; categories: string[] }[] = [
  { label: 'Places', categories: ['place'] },
  { label: 'Banks', categories: ['bank'] },
  { label: 'Skilling', categories: ['smithing', 'cooking', 'mining', 'woodcutting'] },
  { label: 'Monsters', categories: ['monster'] },
]

const WORLD_MAP_CSS = `
#worldmap-modal {
  position: fixed; inset: 0; z-index: 26; display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.55); font-family: sans-serif;
}
#worldmap-panel {
  width: min(96vw, 900px); max-height: 94vh; display: flex; flex-direction: column;
  background: rgba(24, 19, 12, 0.97); border: 1px solid #6a5636; border-radius: 10px; overflow: hidden;
}
#worldmap-panel .wm-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; color: #ffe066; font-weight: bold; font-size: 15px;
  background: rgba(70, 58, 36, 0.6); border-bottom: 1px solid #4a3d26;
}
#worldmap-panel .wm-close {
  min-width: 44px; min-height: 32px; border: none; border-radius: 6px; cursor: pointer;
  background: rgba(140, 40, 40, 0.9); color: #fff; font-size: 15px;
}
#wm-body { display: flex; flex-direction: column; min-height: 0; }
#wm-filters { display: flex; gap: 6px; padding: 8px 12px 0; flex-wrap: wrap; }
.wm-chip {
  min-height: 36px; padding: 0 12px; border-radius: 18px; cursor: pointer; user-select: none;
  background: rgba(60, 50, 34, 0.55); border: 1px solid #5a4a30; color: #d8c9a2; font-size: 12px;
  display: flex; align-items: center; justify-content: center;
}
.wm-chip.active { background: rgba(70, 58, 36, 0.92); color: #ffe066; border-color: #ffe066; }
#worldmap-viewport {
  position: relative; overflow: hidden; margin: 10px auto; touch-action: none;
  /* Portrait: a square that fits the phone width. Landscape gets a big
     rectangle filling the free horizontal space (see the media query below). */
  width: min(88vw, 62vh); height: min(88vw, 62vh); background: #1a140e; border-radius: 6px;
  cursor: grab;
}
#worldmap-viewport.dragging { cursor: grabbing; }
#worldmap-stage { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
#worldmap-stage canvas { display: block; image-rendering: pixelated; }
.wm-marker {
  position: absolute; width: ${MARKER_PX}px; height: ${MARKER_PX}px; transform: translate(-50%, -50%);
  display: flex; align-items: center; justify-content: center; font-size: 20px; line-height: 1;
  cursor: pointer; user-select: none; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.8));
}
.wm-marker.hidden-category { display: none; }
.wm-marker.wm-svg { background: rgba(20, 16, 10, 0.7); border-radius: 50%; }
.wm-marker.wm-svg svg { display: block; }
.wm-marker .wm-badge {
  position: absolute; right: -2px; bottom: -2px; min-width: 15px; height: 15px; padding: 0 3px;
  border-radius: 8px; background: #46618a; color: #fff; font-size: 10px; font-weight: bold;
  display: flex; align-items: center; justify-content: center; font-family: sans-serif;
}
.wm-self {
  position: absolute; width: 14px; height: 14px; transform: translate(-50%, -50%);
  border-radius: 50%; background: #ffe066; box-shadow: 0 0 0 2px rgba(0,0,0,0.6);
  animation: wm-pulse 1.6s ease-in-out infinite;
}
@keyframes wm-pulse { 0%, 100% { box-shadow: 0 0 0 2px rgba(0,0,0,0.6), 0 0 0 0 rgba(255,224,102,0.6); } 50% { box-shadow: 0 0 0 2px rgba(0,0,0,0.6), 0 0 0 8px rgba(255,224,102,0); } }
#wm-zoom-controls { position: absolute; right: 8px; bottom: 8px; z-index: 5; display: flex; flex-direction: column; gap: 6px; }
.wm-zoom-btn {
  width: 44px; height: 44px; border-radius: 6px; cursor: pointer; user-select: none;
  background: rgba(20, 16, 10, 0.82); border: 1px solid #5a4a30; color: #ffe066;
  font-size: 22px; font-weight: bold; font-family: sans-serif;
  display: flex; align-items: center; justify-content: center;
}
#wm-info {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 32;
  width: min(340px, 90vw); background: rgba(24, 19, 12, 0.97); border: 1px solid #6a5636;
  border-radius: 10px; padding: 12px; font-family: sans-serif;
}
#wm-info .wm-info-title { font-size: 15px; font-weight: bold; color: #ffe066; margin-bottom: 4px; }
#wm-info .wm-info-body { font-size: 13px; color: #d8c9a2; line-height: 1.4; }

/* Landscape: short on height, long on width. Header stays on top; the filters
   become a slim left sidebar and the map fills all the remaining space as one
   big rectangle (the openWorldMap JS fits/centres it using both axes). */
@media (orientation: landscape) {
  #worldmap-panel { width: min(96vw, 1040px); height: 92vh; max-height: 92vh; }
  #wm-body { flex-direction: row; flex: 1; min-height: 0; }
  #wm-filters {
    flex-direction: column; flex-wrap: nowrap; flex: 0 0 132px; box-sizing: border-box;
    padding: 10px; gap: 8px; overflow: hidden;
  }
  .wm-chip { width: 100%; box-sizing: border-box; padding: 0 8px; }
  #worldmap-viewport { width: auto; height: auto; flex: 1; min-width: 0; margin: 8px 8px 8px 0; }
}
`

let cssReady = false
function ensureCss(): void {
  if (cssReady) return
  cssReady = true
  const style = document.createElement('style')
  style.textContent = WORLD_MAP_CSS
  document.head.appendChild(style)
}

function bakeCanvas(data: WorldMapData): HTMLCanvasElement {
  const { collision, width, height, palette, ground } = data
  const walkable = palette?.walkableA ?? DEFAULT_WALKABLE
  const blocked = palette?.blockedA ?? DEFAULT_BLOCKED
  const kindGrid = groundKindGrid(width, height, ground)
  const canvas = document.createElement('canvas')
  canvas.width = width * BAKE_PX_PER_TILE
  canvas.height = height * BAKE_PX_PER_TILE
  const ctx = canvas.getContext('2d')!
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const blockedTile = collision[z]?.[x] === '#'
      const kind = kindGrid[z * width + x] ? groundKind(kindGrid[z * width + x]) : undefined
      ctx.fillStyle = blockedTile ? blocked : (kind?.color ?? walkable)
      ctx.fillRect(x * BAKE_PX_PER_TILE, z * BAKE_PX_PER_TILE, BAKE_PX_PER_TILE, BAKE_PX_PER_TILE)
    }
  }
  return canvas
}

function describeSkillNode(staticObj: StaticObject | undefined, category: string): string {
  if (category === 'mining' && staticObj?.rock) {
    const action = miningActions[staticObj.rock]
    return action ? `${action.name} (Mining Lv ${action.level})` : 'A mineable rock.'
  }
  if (category === 'woodcutting' && staticObj?.tree) {
    const action = woodcuttingActions[staticObj.tree]
    return action ? `${action.name} (Woodcutting Lv ${action.level})` : 'A choppable tree.'
  }
  if (category === 'smithing') return 'Smelt bars at the furnace, smith gear at the anvil.'
  if (category === 'cooking') return 'Cook raw food at the range.'
  return ''
}

type Marker = { el: HTMLElement; x: number; z: number }

function reposition(stage: HTMLElement, markers: Marker[], selfEl: HTMLElement | null, self: { x: number; z: number }, transform: { panX: number; panY: number; zoom: number }): void {
  stage.style.transform = `translate(${transform.panX}px, ${transform.panY}px) scale(${transform.zoom})`
  for (const m of markers) {
    m.el.style.left = `${transform.panX + m.x * BAKE_PX_PER_TILE * transform.zoom}px`
    m.el.style.top = `${transform.panY + m.z * BAKE_PX_PER_TILE * transform.zoom}px`
  }
  if (selfEl) {
    selfEl.style.left = `${transform.panX + self.x * BAKE_PX_PER_TILE * transform.zoom}px`
    selfEl.style.top = `${transform.panY + self.z * BAKE_PX_PER_TILE * transform.zoom}px`
  }
}

export type MapTransform = { panX: number; panY: number; zoom: number }
export type ZoomLimits = { min: number; max: number }

function clampPan(transform: MapTransform, bakedW: number, bakedH: number, viewportW: number, viewportH: number): void {
  const scaledW = bakedW * transform.zoom
  const scaledH = bakedH * transform.zoom
  const minX = Math.min(0, viewportW - scaledW)
  const maxX = Math.max(0, viewportW - scaledW)
  const minY = Math.min(0, viewportH - scaledH)
  const maxY = Math.max(0, viewportH - scaledH)
  transform.panX = Math.min(maxX, Math.max(minX, transform.panX))
  transform.panY = Math.min(maxY, Math.max(minY, transform.panY))
}

/** Zooms `transform` to `newZoom` while keeping the viewport-space point
 * (cx, cy) fixed on screen (the wheel/pinch/zoom-button anchor), then clamps
 * zoom to `limits` and pan to the baked canvas bounds. Returns a fresh
 * transform — callers merge it back in (Object.assign) rather than mutating
 * their own copy directly, so this stays a pure, testable helper. */
export function zoomAt(
  transform: MapTransform, cx: number, cy: number, newZoom: number, limits: ZoomLimits,
  bakedW: number, bakedH: number, viewportW: number, viewportH: number,
): MapTransform {
  const zoom = Math.min(limits.max, Math.max(limits.min, newZoom))
  const worldX = (cx - transform.panX) / transform.zoom
  const worldY = (cy - transform.panY) / transform.zoom
  const next: MapTransform = { zoom, panX: cx - worldX * zoom, panY: cy - worldY * zoom }
  clampPan(next, bakedW, bakedH, viewportW, viewportH)
  return next
}

function showInfoCard(title: string, body: string): void {
  document.getElementById('wm-info')?.remove()
  const card = document.createElement('div')
  card.id = 'wm-info'
  const titleEl = document.createElement('div')
  titleEl.className = 'wm-info-title'
  titleEl.textContent = title
  const bodyEl = document.createElement('div')
  bodyEl.className = 'wm-info-body'
  bodyEl.textContent = body
  card.appendChild(titleEl)
  card.appendChild(bodyEl)
  document.body.appendChild(card)
}

export function closeWorldMap(): void {
  document.getElementById('worldmap-modal')?.remove()
  document.getElementById('wm-info')?.remove()
}

// Priority 3: same tier as the bank/craft modals — mutually exclusive in
// practice, so ordering between them doesn't matter.
registerEscapeHandler(3, () => {
  if (!document.getElementById('worldmap-modal')) return false
  closeWorldMap()
  return true
})

/** Opens the full-screen world map: bakes the zone terrain once, places one
 * marker per place/bank/skilling-cluster/monster-spawn/exit, and lets the
 * player pan/zoom (wheel + drag) and tap a marker for an info card. */
export function openWorldMap(data: WorldMapData): void {
  ensureCss()
  closeWorldMap()

  const modal = document.createElement('div')
  modal.id = 'worldmap-modal'
  const panel = document.createElement('div')
  panel.id = 'worldmap-panel'

  const head = document.createElement('div')
  head.className = 'wm-head'
  const title = document.createElement('span')
  title.textContent = 'World Map'
  const close = document.createElement('button')
  close.className = 'wm-close'
  close.textContent = '✕'
  close.addEventListener('click', () => closeWorldMap())
  head.appendChild(title)
  head.appendChild(close)
  panel.appendChild(head)

  const hiddenCategories = new Set<string>()
  const filters = document.createElement('div')
  filters.id = 'wm-filters'
  for (const chip of FILTER_CHIPS) {
    const btn = document.createElement('div')
    btn.className = 'wm-chip active'
    btn.textContent = chip.label
    btn.addEventListener('click', () => {
      const nowHidden = btn.classList.toggle('active') === false
      for (const cat of chip.categories) {
        if (nowHidden) hiddenCategories.add(cat)
        else hiddenCategories.delete(cat)
      }
      for (const m of markers) {
        m.el.classList.toggle('hidden-category', hiddenCategories.has(m.el.dataset.category!))
      }
    })
    filters.appendChild(btn)
  }
  const wmBody = document.createElement('div')
  wmBody.id = 'wm-body'
  wmBody.appendChild(filters)

  const viewport = document.createElement('div')
  viewport.id = 'worldmap-viewport'
  const stage = document.createElement('div')
  stage.id = 'worldmap-stage'
  const canvas = bakeCanvas(data)
  stage.appendChild(canvas)
  viewport.appendChild(stage)
  wmBody.appendChild(viewport)
  panel.appendChild(wmBody)
  modal.appendChild(panel)
  modal.addEventListener('pointerdown', (e) => {
    if (e.target === modal) closeWorldMap()
  })
  document.body.appendChild(modal)

  const bakedW = data.width * BAKE_PX_PER_TILE
  const bakedH = data.height * BAKE_PX_PER_TILE
  const viewportRect = viewport.getBoundingClientRect()
  const vw = viewportRect.width || 1
  const vh = viewportRect.height || 1
  // Fit the whole zone using BOTH axes (min ratio so nothing clips), then centre
  // on the player. The viewport is a wide rectangle in landscape and a square in
  // portrait — measuring width and height separately lets the map fill the free
  // horizontal space instead of assuming a square (which rendered it tiny).
  const fitZoom = Math.min(vw / bakedW, vh / bakedH)
  const transform = { panX: 0, panY: 0, zoom: fitZoom * MIN_ZOOM_MULT }
  transform.panX = vw / 2 - data.self.x * BAKE_PX_PER_TILE * transform.zoom
  transform.panY = vh / 2 - data.self.z * BAKE_PX_PER_TILE * transform.zoom
  clampPan(transform, bakedW, bakedH, vw, vh)

  const markers: Marker[] = []
  const staticById = new Map<string, StaticObject>(data.statics.map((s) => [s.id, s]))

  function addMarker(x: number, z: number, category: string, content: string, isSvg: boolean, count: number, onTap: () => void): void {
    const el = document.createElement('div')
    el.className = isSvg ? 'wm-marker wm-svg' : 'wm-marker'
    el.dataset.category = category
    if (isSvg) el.innerHTML = content
    else el.textContent = content
    if (count > 1) {
      const badge = document.createElement('span')
      badge.className = 'wm-badge'
      badge.textContent = String(count)
      el.appendChild(badge)
    }
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
      onTap()
    })
    viewport.appendChild(el)
    markers.push({ el, x, z })
  }

  // Places (landmarks) — one pin per overworld district, sourced from
  // src/data/world.json for name/icon/lore/facilities.
  for (const lm of data.landmarks) {
    const place = worldPlaces[lm.id]
    const emoji = place?.icon ?? PLACE_EMOJI_FALLBACK
    addMarker(lm.x, lm.z, 'place', emoji, false, 1, () => {
      const facilities = (place?.facilities ?? []).map((f) => FACILITY_LABEL[f] ?? f).join(', ')
      const body = [place?.lore, facilities ? `Facilities: ${facilities}` : ''].filter(Boolean).join('\n\n')
      showInfoCard(place?.name ?? lm.label, body || 'A place in Eldermoor.')
    })
  }

  // Banks + skilling nodes, clustered so a mining site or forest is one pin.
  const clusterInputs: ClusterInput[] = data.statics
    .filter((s) => STATIC_CATEGORY[s.type])
    .map((s) => ({ id: s.id, type: STATIC_CATEGORY[s.type], x: s.x, z: s.z }))
  const clusters: Cluster[] = clusterByType(clusterInputs, CLUSTER_RADIUS)
  for (const cluster of clusters) {
    const representative = staticById.get(cluster.ids[0])
    const iconKey = CATEGORY_ICON_KEY[cluster.type]
    const markup = iconKey ? uiIconMarkup(iconKey, 26) : ''
    addMarker(cluster.x, cluster.z, cluster.type, markup || PLACE_EMOJI_FALLBACK, !!markup, cluster.count, () => {
      const label = CATEGORY_LABEL[cluster.type] ?? cluster.type
      const body = cluster.type === 'bank'
        ? 'Deposit and withdraw items.'
        : describeSkillNode(representative, cluster.type)
      showInfoCard(cluster.count > 1 ? `${label} (${cluster.count})` : label, body)
    })
  }

  // Monster spawns — one pin per authored spawn point (not live positions).
  for (const spawn of data.spawns) {
    const monster = monsters[spawn.monsterId]
    const art = (MONSTER_ART as Record<string, { icon: string; accent: string }>)[spawn.monsterId]
    const markup = art ? uiIconMarkup(art.icon, 26, art.accent) : ''
    addMarker(spawn.x, spawn.z, 'monster', markup || MONSTER_ICON_FALLBACK, !!markup, 1, () => {
      const name = monster?.name ?? spawn.monsterId
      const level = monster?.combatLevel != null ? ` (level-${monster.combatLevel})` : ''
      showInfoCard(name, `A monster spawn point${level}.`)
    })
  }

  // Exits (present on per-zone maps; the merged overworld has none).
  for (const exit of data.exits) {
    addMarker(exit.x, exit.z, 'exit', uiIconMarkup('door', 26), true, 1, () => {
      showInfoCard(exit.label, 'A way out of this zone.')
    })
  }

  const selfEl = document.createElement('div')
  selfEl.className = 'wm-self'
  viewport.appendChild(selfEl)

  const zoomLimits: ZoomLimits = { min: fitZoom * MIN_ZOOM_MULT, max: fitZoom * MAX_ZOOM_MULT }
  const applyZoomAt = (cx: number, cy: number, newZoom: number): void => {
    Object.assign(transform, zoomAt(transform, cx, cy, newZoom, zoomLimits, bakedW, bakedH, vw, vh))
    reposition(stage, markers, selfEl, data.self, transform)
  }

  reposition(stage, markers, selfEl, data.self, transform)

  // Zoom buttons — desktop-without-wheel and touch devices that struggle with
  // pinch get an explicit escape hatch. Both zoom about the viewport centre.
  const zoomControls = document.createElement('div')
  zoomControls.id = 'wm-zoom-controls'
  for (const [label, factor] of [['+', 1.4], ['−', 1 / 1.4]] as const) {
    const btn = document.createElement('div')
    btn.className = 'wm-zoom-btn'
    btn.textContent = label
    // Stop the tap from also reaching the viewport's own pointerdown (which
    // would start a pan drag) — mirrors how marker taps stopPropagation.
    btn.addEventListener('pointerdown', (e) => e.stopPropagation())
    btn.addEventListener('click', () => applyZoomAt(vw / 2, vh / 2, transform.zoom * factor))
    zoomControls.appendChild(btn)
  }
  viewport.appendChild(zoomControls)

  viewport.addEventListener('wheel', (e) => {
    e.preventDefault()
    const rect = viewport.getBoundingClientRect()
    applyZoomAt(e.clientX - rect.left, e.clientY - rect.top, transform.zoom * (1 - e.deltaY * 0.001))
  }, { passive: false })

  // Pointer tracking shared by single-finger pan and two-finger pinch-zoom.
  const activePointers = new Map<number, { x: number; y: number }>()
  let dragging = false
  let lastX = 0
  let lastY = 0
  let pinchDist = 0
  viewport.addEventListener('pointerdown', (e) => {
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (activePointers.size === 2) {
      dragging = false
      const [a, b] = [...activePointers.values()]
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y)
    } else if (activePointers.size === 1) {
      dragging = true
      lastX = e.clientX
      lastY = e.clientY
      viewport.classList.add('dragging')
    }
  })
  viewport.addEventListener('pointermove', (e) => {
    if (!activePointers.has(e.pointerId)) return
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (activePointers.size >= 2) {
      const [a, b] = [...activePointers.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      if (pinchDist > 0 && dist > 0) {
        const rect = viewport.getBoundingClientRect()
        const midX = (a.x + b.x) / 2 - rect.left
        const midY = (a.y + b.y) / 2 - rect.top
        applyZoomAt(midX, midY, transform.zoom * (dist / pinchDist))
      }
      pinchDist = dist
      return
    }
    if (!dragging) return
    transform.panX += e.clientX - lastX
    transform.panY += e.clientY - lastY
    lastX = e.clientX
    lastY = e.clientY
    clampPan(transform, bakedW, bakedH, vw, vh)
    reposition(stage, markers, selfEl, data.self, transform)
  })
  const endPointer = (e: PointerEvent): void => {
    activePointers.delete(e.pointerId)
    pinchDist = 0
    if (activePointers.size === 1) {
      // Dropping from two fingers to one: re-anchor the drag to the
      // remaining pointer so pan doesn't jump on the pinch release.
      const [remaining] = activePointers.values()
      dragging = true
      lastX = remaining.x
      lastY = remaining.y
    } else {
      dragging = false
      viewport.classList.remove('dragging')
    }
  }
  viewport.addEventListener('pointerup', endPointer)
  viewport.addEventListener('pointercancel', endPointer)
}
