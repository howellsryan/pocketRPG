// Full-screen world map: a button (top-right column, under the minimap) opens
// a large, zoomable/pannable view of the whole zone with markers for every
// interactive thing — places, banks, skilling nodes, monster spawns, exits.
// Named journeys stay in the shared overworld; instances have explicit entrances. Pure DOM/canvas, no three.js; mirrors the conventions of
// minimap.ts/bank.ts (module-level style injection, one open/close pair, pure
// helpers pulled out for testability).
import type { ExitMarker, GroundPalette, Landmark, NpcSpawn, StaticObject, ZoneGroundRegion } from '../../shared/protocol'
import { groundKind, groundKindGrid } from '../../shared/groundKinds'
import { clusterByType, type Cluster, type ClusterInput } from '../../shared/mapClusters'
import { CATEGORY_ICON_KEY, STATIC_CATEGORY } from '../../shared/mapCategories'
import { uiIconMarkup } from './itemIcon'
import worldData from '../../../src/data/world.json'
import monstersData from '../../../src/data/monsters.json'
import { resourceAction, resourceNodeFor } from '../../shared/resources'
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
  onJourney?: (place: Landmark) => void
  onQuickTravel?: (place: Landmark) => void
}

// STATIC_CATEGORY (statics→category) and CATEGORY_ICON_KEY (category→bespoke
// icon key) now live in shared/mapCategories.ts, reused by minimap.ts. Places
// (world.json's own emoji) and Monsters (combatArt.js's MONSTER_ART) use their
// own per-entry art and aren't part of that shared table.
const PLACE_EMOJI_FALLBACK = '📍'
const MONSTER_ICON_FALLBACK = '👹'
const CATEGORY_LABEL: Record<string, string> = {
  bank: 'Bank', smithing: 'Smithing', cooking: 'Cooking', mining: 'Mining', woodcutting: 'Woodcutting', fishing: 'Fishing', gather: 'Fieldwork',
  place: 'Place', monster: 'Monster', exit: 'Exit',
}
// Filter chips group the four skilling categories under one "Skilling" toggle.
const FILTER_CHIPS: { label: string; categories: string[] }[] = [
  { label: 'Places', categories: ['place'] },
  { label: 'Banks', categories: ['bank'] },
  { label: 'Skilling', categories: ['smithing', 'cooking', 'mining', 'woodcutting', 'fishing', 'gather'] },
  { label: 'Monsters', categories: ['monster'] },
  { label: 'Entrances', categories: ['exit'] },
]

const WORLD_MAP_CSS = `
#worldmap-modal {
  /* Height is the VISIBLE viewport (dvh), not vh — on iOS Safari vh counts the
     area behind the toolbars, which pushed the panel's header/close button
     off-screen in landscape. Safe-area padding keeps the panel clear of the
     notch/home indicator, and the flex centring then fits it every time. */
  position: fixed; left: 0; right: 0; top: 0; height: 100vh; height: 100dvh;
  z-index: 26; display: flex; align-items: center; justify-content: center; box-sizing: border-box;
  padding: 10px;
  padding-top: max(10px, env(safe-area-inset-top)); padding-bottom: max(10px, env(safe-area-inset-bottom));
  padding-left: max(10px, env(safe-area-inset-left)); padding-right: max(10px, env(safe-area-inset-right));
  background: rgba(0, 0, 0, 0.55); font-family: sans-serif;
}
#worldmap-panel {
  width: min(96vw, 900px); max-height: 100%; display: flex; flex-direction: column;
  background: rgba(24, 19, 12, 0.97); border: 1px solid #6a5636; border-radius: 10px; overflow: hidden;
}
#worldmap-panel .wm-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; color: #ffe066; font-weight: bold; font-size: 15px;
  background: rgba(70, 58, 36, 0.6); border-bottom: 1px solid #4a3d26;
}
#worldmap-panel .wm-close {
  min-width: 44px; min-height: 44px; border: none; border-radius: 6px; cursor: pointer;
  background: rgba(140, 40, 40, 0.9); color: #fff; font-size: 15px;
}
#wm-body { display: flex; flex-direction: column; min-height: 0; }
#wm-filters { display: flex; gap: 6px; padding: 8px 12px 0; flex-wrap: wrap; }
.wm-chip {
  min-height: 44px; padding: 0 12px; border-radius: 18px; cursor: pointer; user-select: none;
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
  #worldmap-panel { width: min(96vw, 1040px); height: 100%; }
  #wm-body { flex-direction: row; flex: 1; min-height: 0; }
  #wm-filters {
    flex-direction: column; flex-wrap: nowrap; flex: 0 0 132px; box-sizing: border-box;
    padding: 10px; gap: 8px; overflow: hidden;
  }
  .wm-chip { width: 100%; box-sizing: border-box; padding: 0 8px; }
  #worldmap-viewport { width: auto; height: auto; flex: 1; min-width: 0; margin: 8px 8px 8px 0; }
}
`

const NAVIGATION_CSS=`
.wm-destinations{min-height:44px;max-width:48%;background:#211a12;color:#ecd8b2;border:1px solid #8e6d35;border-radius:4px;padding:6px;font:inherit}
.wm-info-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.wm-info-actions button{min-height:44px;flex:1}
.wm-marker{padding:0;border:0;background:none;color:inherit;font-family:inherit}.wm-info-body{white-space:pre-line}#wm-info{box-sizing:border-box;max-height:65vh;overflow:auto}
#world-wayfinding{position:fixed;left:12px;top:126px;z-index:18;box-sizing:border-box;max-width:300px;background:rgba(30,23,15,.94);border:1px solid #9d7940;color:#ead8b4;box-shadow:0 2px 6px #0008;border-radius:5px;padding:8px 12px;font:14px/1.4 Georgia,serif;pointer-events:none}
:root[data-hud-orient="portrait"]:not([data-hud-sheet="closed"]) #world-wayfinding{display:none}
#world-wayfinding strong{display:block;font-size:16px;color:#f2dfa9}
#world-wayfinding button{pointer-events:auto;min-height:44px;background:#352819;color:#efdbb6;border:1px solid #967240;border-radius:3px;margin-top:8px;width:100%;font:inherit}
@media(max-width:600px){#world-wayfinding{left:8px;top:112px;max-width:calc(100vw - 68px);font-size:12px;padding:6px 8px}#world-wayfinding strong{font-size:14px}.wm-info-actions button{width:auto}}
`

let cssReady = false
function ensureCss(): void {
  if (cssReady) return
  cssReady = true
  const style = document.createElement('style')
  style.textContent = WORLD_MAP_CSS+NAVIGATION_CSS
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
  if ((category === 'fishing' || category === 'gather') && staticObj) {
    const node = resourceNodeFor(staticObj)
    const action = node && resourceAction(node)
    if (action) return action.description ?? `${action.name} (Fishing Lv ${action.level})`
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

function showInfoCard(title: string, body: string, actions: {label:string;run:()=>void}[] = []): void {
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
  const controls=document.createElement('div')
  controls.className='wm-info-actions'
  for(const action of [...actions,{label:'Close details',run:()=>card.remove()}]) {
    const button=document.createElement('button')
    button.className='wm-chip active'
    button.textContent=action.label
    button.addEventListener('click',action.run)
    controls.appendChild(button)
  }
  card.appendChild(controls)
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

  const destinations=document.createElement('select')
  destinations.setAttribute('aria-label','Choose a destination')
  destinations.className='wm-destinations'
  const placeholder=document.createElement('option')
  placeholder.textContent='Choose a destination…'; placeholder.value=''
  destinations.appendChild(placeholder)
  for(const place of [...data.landmarks].sort((a,b)=>a.label.localeCompare(b.label))) {
    const option=document.createElement('option')
    option.value=place.id; option.textContent=worldPlaces[place.id]?.name??place.label
    destinations.appendChild(option)
  }
  destinations.addEventListener('change',()=>{
    const place=data.landmarks.find(p=>p.id===destinations.value)
    if(place) showPlace(place)
  })
  head.insertBefore(destinations,close)
  const hiddenCategories = new Set<string>(['bank','smithing','cooking','mining','woodcutting','fishing','gather','monster'])
  const filters = document.createElement('div')
  filters.id = 'wm-filters'
  for (const chip of FILTER_CHIPS) {
    const btn = document.createElement('button')
    btn.className = 'wm-chip'+(chip.categories.some(category=>hiddenCategories.has(category))?'':' active')
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

  function addMarker(x: number, z: number, category: string, content: string, isSvg: boolean, count: number, onTap: () => void, label?:string): void {
    const el = document.createElement('button')
    el.type='button'
    el.setAttribute('aria-label',label??category+' marker at '+x+', '+z)
    el.title=label??CATEGORY_LABEL[category]??category
    el.className = isSvg ? 'wm-marker wm-svg' : 'wm-marker'
    el.dataset.category = category
    el.classList.toggle('hidden-category',hiddenCategories.has(category))
    if (isSvg) el.innerHTML = content
    else el.textContent = content
    if (count > 1) {
      const badge = document.createElement('span')
      badge.className = 'wm-badge'
      badge.textContent = String(count)
      el.appendChild(badge)
    }
    el.addEventListener('pointerdown', (e) => e.stopPropagation())
    el.addEventListener('click',onTap)
    viewport.appendChild(el)
    markers.push({ el, x, z })
  }

  function showPlace(lm: Landmark): void {
    const place=worldPlaces[lm.id], facilities=(place?.facilities??[]).map(f=>FACILITY_LABEL[f]??f).join(', ')
    const guidance=describeDestination(data.self,lm)
    const body=[place?.lore,facilities ? 'Facilities: '+facilities : '',
      guidance.arrived ? 'You are here.' : guidance.direction+' · '+guidance.distance+' tiles away. Walking remains in the shared world.'].filter(Boolean).join('\n\n')
    const actions:{label:string;run:()=>void}[]=[]
    if(data.onJourney && !guidance.arrived) actions.push({label:'Walk to '+(place?.name??lm.label),run:()=>{data.onJourney!(lm);closeWorldMap()}})
    if(data.onQuickTravel) actions.push({label:'Preview quick travel',run:()=>{
      showInfoCard('Preview quick travel','Move to '+(place?.name??lm.label)+' for testing. Available in this preview; leave combat first.',[
        {label:'Travel to '+(place?.name??lm.label),run:()=>{data.onQuickTravel!(lm);closeWorldMap()}},
        {label:'Back',run:()=>showPlace(lm)},
      ])
    }})
    showInfoCard(place?.name??lm.label,body||'A place in Eldermoor.',actions)
  }

  // Places (landmarks) — one pin per overworld district, sourced from
  // src/data/world.json for name/icon/lore/facilities.
  for (const lm of data.landmarks) {
    const place = worldPlaces[lm.id]
    const emoji = place?.icon ?? PLACE_EMOJI_FALLBACK
    addMarker(lm.x, lm.z, 'place', emoji, false, 1, () => {
      showPlace(lm)
    },place?.name??lm.label)
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

  // Named entrances and returns use the shared icon set and authored descriptions.
  for (const exit of data.exits) {
    const markup=uiIconMarkup('door',26,'#ecd8b2')
    addMarker(exit.x,exit.z,'exit',markup||'↪',!!markup,1,()=>{
      showInfoCard(exit.label,exit.description??'Approach this entrance in the world and select its doorway.')
    },exit.label)
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

/** Compass bearing and remaining tile distance; the world uses south-positive z. */
export function describeDestination(from: {x:number;z:number}, to: {x:number;z:number}): {direction:string;distance:number;arrived:boolean} {
  const dx=to.x-from.x, dz=to.z-from.z, distance=Math.max(Math.abs(dx),Math.abs(dz))
  if(distance<=2) return {direction:'here',distance,arrived:true}
  const angle=Math.atan2(dx,-dz), octant=(Math.round(angle/(Math.PI/4))+8)%8
  return {direction:['north','northeast','east','southeast','south','southwest','west','northwest'][octant],distance,arrived:false}
}

/** Prefer a nearby named doorway before comparing distant city centres. */
export function describeLocation(
  self: {x:number;z:number},
  landmarks: Pick<Landmark,'x'|'z'|'label'>[],
  entrances: Pick<ExitMarker,'x'|'z'|'label'>[] = [],
): string {
  let entrance: typeof entrances[number] | undefined, entranceDistance = Infinity
  for (const candidate of entrances) {
    const distance = describeDestination(self,candidate).distance
    if (candidate.label.trim() && distance <= 4 && distance < entranceDistance) {
      entrance = candidate; entranceDistance = distance
    }
  }
  if (entrance) return 'Entrance: '+entrance.label
  let nearest: typeof landmarks[number] | undefined, nearestDistance = Infinity
  for (const candidate of landmarks) {
    const distance = describeDestination(self,candidate).distance
    if (distance < nearestDistance) { nearest = candidate; nearestDistance = distance }
  }
  return nearest ? (nearestDistance <= 2 ? '' : 'Near ')+nearest.label : 'Exploring Eldermoor'
}

let disposeWayfindingLayout: (()=>void)|null=null

/** Reposition only when the HUD layout changes; walking does not trigger layout work. */
function positionWayfinding(panel: HTMLElement): ()=>void {
  const root=document.documentElement
  const visibleRect=(id:string):DOMRect|null=>{
    const el=document.getElementById(id)
    return el&&getComputedStyle(el).display!=='none'&&el.getBoundingClientRect().width>0 ? el.getBoundingClientRect() : null
  }
  const place=():void=>{
    const portrait=root.dataset.hudOrient==='portrait', rightDock=root.dataset.hudDock!=='left'
    const vitals=visibleRect('hud-vitals'), eye=visibleRect('hud-eye'), compass=visibleRect('hud-compass'), map=visibleRect('minimap')
    let inset=portrait?8:12, top=portrait?Math.max(112,(vitals?.bottom??104)+8):Math.max(126,...[vitals,eye,compass].map(r=>(r?.bottom??0)+8))
    let width=portrait?innerWidth-inset-(map?148:60):innerWidth-2*inset-58
    if(!portrait) {
      const dock=visibleRect('hud-body'), rail=visibleRect('hud-rail-l')
      const boundary=rightDock?(dock?.left??rail?.left??innerWidth):(dock?.right??rail?.right??0)
      if(map) {
        const beside=rightDock?map.right+8:innerWidth-map.left+8
        const room=rightDock?boundary-beside-8:innerWidth-beside-boundary-8
        if(room>=180){inset=beside;width=room}
        else {top=Math.max(top,map.bottom+8);width=rightDock?boundary-inset-8:innerWidth-inset-boundary-8}
      } else width=rightDock?boundary-inset-8:innerWidth-inset-boundary-8
    }
    panel.style.left=portrait||rightDock?inset+'px':'auto'
    panel.style.right=!portrait&&!rightDock?inset+'px':'auto'
    panel.style.top=portrait?'auto':top+'px'
    const rail=visibleRect('hud-rail-p')
    panel.style.bottom=portrait?Math.max(72,innerHeight-(rail?.top??innerHeight-64)+8)+'px':'auto'
    panel.style.maxWidth=Math.min(300,Math.max(140,width))+'px'
  }
  place()
  const mutation=new MutationObserver(place)
  mutation.observe(root,{attributes:true,attributeFilter:['data-hud-orient','data-hud-dock','data-hud-hidden','data-minimap','data-hud-sheet','data-hud-scale']})
  const resize=new ResizeObserver(place)
  for(const id of ['hud-vitals','hud-eye','hud-compass','minimap','hud-body']){const el=document.getElementById(id);if(el)resize.observe(el)}
  window.addEventListener('resize',place)
  return ()=>{mutation.disconnect();resize.disconnect();window.removeEventListener('resize',place)}
}

/** Location and selected destination remain visible after closing the map. */
export function createWayfinding(landmarks: Landmark[], cancel:()=>void, entrances: ExitMarker[] = []): {
  guide:(place:Landmark|null)=>void; update:(self:{x:number;z:number})=>void
} {
  ensureCss()
  disposeWayfindingLayout?.()
  document.getElementById('world-wayfinding')?.remove()
  const panel=document.createElement('div'); panel.id='world-wayfinding'; panel.className='hud-hideable'
  const title=document.createElement('strong'),detail=document.createElement('span'),stop=document.createElement('button')
  stop.textContent='Stop journey'; stop.hidden=true
  let destination:Landmark|null=null, last=''
  stop.addEventListener('click',()=>{destination=null;stop.hidden=true;last='';cancel()})
  panel.appendChild(title);panel.appendChild(detail);panel.appendChild(stop);document.body.appendChild(panel)
  disposeWayfindingLayout=positionWayfinding(panel)
  return {
    guide:(place)=>{destination=place;stop.hidden=!place;last=''},
    update:(self)=>{
      const here=describeLocation(self,landmarks,entrances)
      const guidance=destination && describeDestination(self,destination)
      const heading=destination ? (guidance!.arrived?'Arrived at ':'To ')+destination.label : here
      const line=destination ? (guidance!.arrived?'Choose another destination on the map.':guidance!.direction+' · '+guidance!.distance+' tiles · '+here) : 'Open the map to choose a destination.'
      if(last!==heading+'|'+line){title.textContent=heading;detail.textContent=line;last=heading+'|'+line}
      if(guidance?.arrived){stop.hidden=true;destination=null}
    },
  }
}
