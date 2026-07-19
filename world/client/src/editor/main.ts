import { validateZone, type ZoneDef, type ZonePalette, type ZoneAmbience } from '../../../shared/zone'
import { buildCatalog, type CatalogEntry, type CatalogGroup } from '../../../shared/catalog'
import { EditorApi, type ZoneListEntry } from './api'
import { EditorState, blankZone, paintTile, paintRect, floodFill, resizeZone, groundGrid, applyGroundGrid, paintGroundTile } from './state'
import { GROUND_KINDS } from '../../../shared/groundKinds'
import { GridView, type TilePointer } from './grid'
import { AMBIENCE_PRESETS, DEFAULT_AMBIENCE, DEFAULT_PALETTE, PALETTE_PRESETS, matchAmbience, matchPalette } from './presets'
import { PROP_MODELS } from './propManifest'
import { coordsOf, deleteItem, findItemAt, moveItem, placeEntry, placeExit, type Selection } from './placement'
import { openArrivalPicker } from './picker'
import { extractRegion, loadPrefabs, savePrefab, stampPrefab, type Prefab } from './stamps'

const TOKEN_KEY = 'world_editor_token'
const PROD_KEY = 'world_editor_prod'
type Tool = 'paintWalkable' | 'paintBlocked' | 'rect' | 'fill' | 'spawn' | 'select' | 'portal' | 'scatter' | 'stamp' | 'pan' | 'paintGround'

const $ = <T = HTMLElement>(id: string) => document.getElementById(id) as T

let api: EditorApi
let state: EditorState
let grid: GridView
let activeTool: Tool = 'paintWalkable'
let zoneList: ZoneListEntry[] = []
let catalog: CatalogGroup[] = []
let placementEntry: CatalogEntry | null = null
let draggedEntry: CatalogEntry | null = null
let selection: Selection | null = null
let clipboard: Prefab | null = null
let env: 'preview' | 'production' = 'preview'

// ---- toast ------------------------------------------------------------------
let toastTimer: ReturnType<typeof setTimeout> | null = null
function toast(msg: string, kind: 'ok' | 'err' | '' = ''): void {
  const el = $('toast')
  el.textContent = msg
  el.className = `show ${kind}`
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (el.className = ''), 3200)
}

// ---- token gate -------------------------------------------------------------
async function unlock(token: string): Promise<boolean> {
  const trial = new EditorApi('', token)
  try {
    await trial.listZones()
    localStorage.setItem(TOKEN_KEY, token)
    api = trial
    return true
  } catch (e) {
    return false
  }
}

function initTokenGate(): void {
  const gate = $('tokenGate')
  const input = $<HTMLInputElement>('tokenInput')
  const err = $('tokenErr')
  const attempt = async () => {
    err.textContent = ''
    const ok = await unlock(input.value.trim())
    if (ok) {
      gate.style.display = 'none'
      void boot()
    } else {
      err.textContent = 'Rejected — check the token and that the editor is enabled on this server.'
    }
  }
  $('tokenBtn').addEventListener('click', attempt)
  input.addEventListener('keydown', (e) => e.key === 'Enter' && attempt())

  const stored = localStorage.getItem(TOKEN_KEY)
  if (stored) {
    void unlock(stored).then((ok) => {
      if (ok) {
        gate.style.display = 'none'
        void boot()
      } else {
        input.focus()
      }
    })
  } else {
    input.focus()
  }
}

// ---- boot -------------------------------------------------------------------
async function boot(): Promise<void> {
  const draft = EditorState.loadDraft()
  const initial = draft?.def ?? blankZone('new_zone')
  state = new EditorState(initial)
  if (draft) state.savedRevision = draft.savedRevision

  const canvas = $<HTMLCanvasElement>('grid')
  grid = new GridView(canvas, state.getDef())
  grid.handler = onTile
  canvas.addEventListener('contextmenu', (e) => e.preventDefault())

  state.onChange(scheduleRefresh)
  catalog = buildCatalog(PROP_MODELS)
  wireTopbar()
  wireTools()
  wireGroundKinds()
  wireMeta()
  wirePresets()
  wirePlaytest()
  wireLibrary()
  wireCanvasDrop()
  wireEnv()
  wireHistoryAnd3D()
  wireStampSave()
  wireKeyboard()
  window.addEventListener('beforeunload', (e) => {
    if (state.isDirty()) {
      e.preventDefault()
      e.returnValue = ''
    }
  })

  await refreshZoneList()
  if (draft) toast(`Restored unsaved draft: ${initial.name}`, '')
  refreshAll()
}

// ---- zone list / open / new / duplicate ------------------------------------
async function refreshZoneList(): Promise<void> {
  try {
    zoneList = (await api.listZones()).zones
  } catch {
    zoneList = []
  }
  const sel = $<HTMLSelectElement>('zoneSelect')
  const current = state.getDef().id
  sel.innerHTML = ''
  const known = new Set(zoneList.map((z) => z.id))
  if (!known.has(current)) {
    const opt = document.createElement('option')
    opt.value = current
    opt.textContent = `${current} (new)`
    sel.appendChild(opt)
  }
  for (const z of zoneList) {
    const opt = document.createElement('option')
    opt.value = z.id
    const tag = z.source === 'bundled' ? 'bundled' : z.source === 'overridden' ? 'edited' : 'stored'
    opt.textContent = `${z.name} · ${z.id} [${tag}]`
    sel.appendChild(opt)
  }
  sel.value = current
}

async function openZone(id: string): Promise<void> {
  if (state.isDirty() && !confirm('Discard unsaved changes and open another zone?')) {
    $<HTMLSelectElement>('zoneSelect').value = state.getDef().id
    return
  }
  try {
    const { def, source } = await api.getZone(id)
    state.load(def, source === 'bundled' ? null : zoneList.find((z) => z.id === id)?.revision ?? null)
    grid.setDef(state.getDef())
    grid.fit()
    await refreshZoneList()
    refreshAll()
  } catch (e) {
    toast(`Open failed: ${(e as Error).message}`, 'err')
  }
}

function newZone(): void {
  if (state.isDirty() && !confirm('Discard unsaved changes and start a new zone?')) return
  const id = promptZoneId('New zone id (lowercase, a-z0-9_):')
  if (!id) return
  state.load(blankZone(id), null)
  grid.setDef(state.getDef())
  grid.fit()
  void refreshZoneList()
  refreshAll()
}

function duplicateZone(): void {
  const id = promptZoneId('Duplicate as new id:')
  if (!id) return
  const copy: ZoneDef = JSON.parse(JSON.stringify(state.getDef()))
  copy.id = id
  copy.name = `${copy.name} copy`
  state.load(copy, null)
  // Mark dirty so the duplicate is clearly unsaved until the user saves it.
  state.mutate((d) => (d.name = copy.name))
  grid.setDef(state.getDef())
  grid.fit()
  void refreshZoneList()
  refreshAll()
}

function promptZoneId(label: string): string | null {
  const raw = prompt(label)
  if (raw == null) return null
  const id = raw.trim().toLowerCase()
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(id)) {
    toast('Invalid id — use lowercase letters, digits and underscores.', 'err')
    return null
  }
  return id
}

// ---- save -------------------------------------------------------------------
async function save(): Promise<void> {
  const def = state.getDef()
  const local = validateZone(def)
  if (!local.valid) {
    toast('Fix validation errors before saving.', 'err')
    return
  }
  try {
    const res = await api.saveZone(def)
    state.markSaved(res.revision)
    await refreshZoneList()
    toast(`Saved ${def.id} (revision ${res.revision}).`, 'ok')
    refreshValidation()
  } catch (e) {
    const err = e as Error & { errors?: string[] }
    toast(`Save rejected: ${err.message}`, 'err')
    if (err.errors) renderValidation(err.errors)
  }
}

// ---- tile tool routing ------------------------------------------------------
let paintValue: boolean | null = null
let rectStart: { x: number; z: number } | null = null
let rectBlocked = false

let selectedGroundKind = GROUND_KINDS[0].id
let groundStrokeGrid: string[] | null = null

let movingSelection = false

function onTile(p: TilePointer): void {
  // Placement mode (a library asset is armed) takes priority over the tool —
  // except the scatter tool, which sprinkles the armed prop across a drag.
  if (placementEntry && activeTool !== 'scatter' && p.phase === 'down' && p.inside) {
    const entry = placementEntry
    state.mutate((d) => (selection = placeEntry(d, entry, p.x, p.z)))
    refreshInspector()
    return
  }

  if (activeTool === 'pan') return
  const rightHeld = (p.buttons & 2) !== 0

  if (activeTool === 'select') {
    if (p.phase === 'down') {
      selection = p.inside ? findItemAt(state.getDef(), p.x, p.z) : null
      movingSelection = selection !== null
      if (movingSelection) state.beginStroke()
      refreshInspector()
      refreshSelectionHighlight()
    } else if (p.phase === 'move' && movingSelection && selection && (p.buttons & 1)) {
      const sel = selection
      state.applyStroke((d) => moveItem(d, sel, p.x, p.z))
      refreshSelectionHighlight()
    } else if (p.phase === 'up' && movingSelection) {
      movingSelection = false
      state.endStroke()
      refreshInspector()
    }
    return
  }

  if (activeTool === 'portal') {
    if (p.phase === 'down' && p.inside) {
      state.mutate((d) => (selection = placeExit(d, p.x, p.z)))
      refreshInspector()
      refreshSelectionHighlight()
      // Pick a destination in the inspector, then the arrival tile — placeExit
      // defaults to a valid self-target so the zone is never left invalid.
    }
    return
  }

  if (activeTool === 'scatter') {
    handleScatter(p)
    return
  }

  if (activeTool === 'stamp') {
    handleStamp(p, rightHeld)
    return
  }

  if (activeTool === 'spawn') {
    if (p.phase === 'down' && p.inside) state.mutate((d) => (d.spawn = { x: p.x, z: p.z }))
    return
  }

  if (activeTool === 'fill') {
    if (p.phase === 'down' && p.inside) state.mutate((d) => floodFill(d, p.x, p.z, rightHeld))
    return
  }

  if (activeTool === 'paintGround') {
    const def = state.getDef()
    const kind = rightHeld ? '' : selectedGroundKind // right-drag erases
    if (p.phase === 'down') {
      state.beginStroke()
      groundStrokeGrid = groundGrid(def)
      if (p.inside) paintGroundTile(groundStrokeGrid, def.width, def.height, p.x, p.z, kind)
      state.applyStroke((d) => applyGroundGrid(d, groundStrokeGrid!))
    } else if (p.phase === 'move' && groundStrokeGrid && (p.buttons & 3)) {
      if (p.inside) paintGroundTile(groundStrokeGrid, def.width, def.height, p.x, p.z, kind)
      state.applyStroke((d) => applyGroundGrid(d, groundStrokeGrid!))
    } else if (p.phase === 'up' && groundStrokeGrid) {
      state.endStroke()
      groundStrokeGrid = null
    }
    return
  }

  if (activeTool === 'rect') {
    if (p.phase === 'down') {
      rectStart = { x: p.x, z: p.z }
      rectBlocked = rightHeld
      grid.setDragPreview({ x0: p.x, z0: p.z, x1: p.x, z1: p.z })
    } else if (p.phase === 'move' && rectStart) {
      grid.setDragPreview({ x0: rectStart.x, z0: rectStart.z, x1: p.x, z1: p.z })
    } else if (p.phase === 'up' && rectStart) {
      const s = rectStart
      state.mutate((d) => paintRect(d, s.x, s.z, p.x, p.z, rectBlocked))
      rectStart = null
      grid.setDragPreview(null)
    }
    return
  }

  // Brush: paintWalkable / paintBlocked.
  const val = activeTool === 'paintBlocked'
  if (p.phase === 'down') {
    state.beginStroke()
    paintValue = val
    state.applyStroke((d) => paintTile(d, p.x, p.z, val))
  } else if (p.phase === 'move' && paintValue !== null && (p.buttons & 1)) {
    state.applyStroke((d) => paintTile(d, p.x, p.z, val))
  } else if (p.phase === 'up' && paintValue !== null) {
    state.endStroke()
    paintValue = null
  }
}

// ---- wiring -----------------------------------------------------------------
function wireTopbar(): void {
  $('zoneSelect').addEventListener('change', (e) => void openZone((e.target as HTMLSelectElement).value))
  $('newBtn').addEventListener('click', newZone)
  $('dupBtn').addEventListener('click', duplicateZone)
  $('saveBtn').addEventListener('click', () => void save())
  $('undoBtn').addEventListener('click', () => state.undo())
  $('redoBtn').addEventListener('click', () => state.redo())
}

function wireTools(): void {
  for (const btn of document.querySelectorAll<HTMLButtonElement>('#toolGroup [data-tool]')) {
    btn.addEventListener('click', () => {
      setTool(btn.dataset.tool as Tool)
    })
  }
  document.querySelector<HTMLButtonElement>('[data-tool="paintWalkable"]')!.classList.add('active')
}

function setTool(tool: Tool): void {
  activeTool = tool
  clearPlacement()
  if (tool !== 'select') {
    selection = null
    refreshInspector()
    refreshSelectionHighlight()
  }
  for (const b of document.querySelectorAll('#toolGroup [data-tool]')) {
    b.classList.toggle('active', (b as HTMLElement).dataset.tool === tool)
  }
  $('scatterControls').style.display = tool === 'scatter' ? 'flex' : 'none'
  $('stampControls').style.display = tool === 'stamp' ? 'block' : 'none'
  $('groundControls').style.display = tool === 'paintGround' ? 'block' : 'none'
}

/** Builds the ground-kind swatch picker once; clicking one selects the kind the
 * paint-ground brush lays down. */
function wireGroundKinds(): void {
  const host = $('groundKinds')
  host.innerHTML = ''
  for (const k of GROUND_KINDS) {
    const btn = document.createElement('button')
    btn.className = 'toolbtn'
    btn.dataset.kind = k.id
    btn.title = k.label
    btn.innerHTML = `<span style="display:inline-block;width:12px;height:12px;border-radius:2px;vertical-align:-1px;margin-right:6px;background:${k.color}"></span>${k.label}`
    btn.classList.toggle('active', k.id === selectedGroundKind)
    btn.addEventListener('click', () => {
      selectedGroundKind = k.id
      for (const b of host.querySelectorAll('[data-kind]')) b.classList.toggle('active', (b as HTMLElement).dataset.kind === k.id)
    })
    host.appendChild(btn)
  }
}

function clearPlacement(): void {
  placementEntry = null
  for (const el of document.querySelectorAll('.libitem.active')) el.classList.remove('active')
}

function wireMeta(): void {
  $<HTMLInputElement>('fName').addEventListener('input', (e) => {
    const v = (e.target as HTMLInputElement).value
    state.mutate((d) => (d.name = v))
  })
  $('resizeBtn').addEventListener('click', () => {
    const w = clampInt($<HTMLInputElement>('fWidth').value, 4, 256)
    const h = clampInt($<HTMLInputElement>('fHeight').value, 4, 256)
    state.mutate((d) => resizeZone(d, w, h))
    grid.fit()
  })
}

function paletteFromInputs(): ZonePalette {
  return {
    walkableA: $<HTMLInputElement>('pWA').value,
    walkableB: $<HTMLInputElement>('pWB').value,
    blockedA: $<HTMLInputElement>('pBA').value,
    blockedB: $<HTMLInputElement>('pBB').value,
  }
}

function ambienceFromInputs(): ZoneAmbience {
  return {
    sky: $<HTMLInputElement>('aSky').value,
    hemiIntensity: Number($<HTMLInputElement>('aHemi').value),
    sunIntensity: Number($<HTMLInputElement>('aSun').value),
  }
}

function wirePresets(): void {
  const palSel = $<HTMLSelectElement>('palettePreset')
  palSel.innerHTML = '<option value="">Custom…</option>' + PALETTE_PRESETS.map((p) => `<option>${p.name}</option>`).join('')
  palSel.addEventListener('change', () => {
    const preset = PALETTE_PRESETS.find((p) => p.name === palSel.value)
    if (preset) state.mutate((d) => (d.palette = { ...preset.palette }))
  })
  for (const id of ['pWA', 'pWB', 'pBA', 'pBB']) {
    $(id).addEventListener('input', () => state.mutate((d) => (d.palette = paletteFromInputs())))
  }

  const ambSel = $<HTMLSelectElement>('ambiencePreset')
  ambSel.innerHTML = '<option value="">Custom…</option>' + AMBIENCE_PRESETS.map((a) => `<option>${a.name}</option>`).join('')
  ambSel.addEventListener('change', () => {
    const preset = AMBIENCE_PRESETS.find((a) => a.name === ambSel.value)
    if (preset) state.mutate((d) => (d.ambience = { ...preset.ambience }))
  })
  for (const id of ['aSky', 'aHemi', 'aSun']) {
    $(id).addEventListener('input', () => state.mutate((d) => (d.ambience = ambienceFromInputs())))
  }
}

function wirePlaytest(): void {
  $('teleportBtn').addEventListener('click', async () => {
    const def = state.getDef()
    if (state.isDirty() || !zoneList.some((z) => z.id === def.id)) {
      toast('Save the zone first, then teleport.', 'err')
      return
    }
    const charId = clampInt($<HTMLInputElement>('tpChar').value, 1, 1e9)
    try {
      await api.teleport(charId, def.id, def.spawn.x, def.spawn.z)
      toast(`Teleported character ${charId} to ${def.id} spawn. Open the world to play-test.`, 'ok')
    } catch (e) {
      toast(`Teleport failed: ${(e as Error).message}`, 'err')
    }
  })
}

function wireKeyboard(): void {
  window.addEventListener('keydown', (e) => {
    const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      void save()
      return
    }
    if (typing) return
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) state.redo()
      else state.undo()
      return
    }
    if (e.key === 'Escape') {
      clearPlacement()
      selection = null
      refreshInspector()
      refreshSelectionHighlight()
      return
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
      e.preventDefault()
      deleteSelection()
    }
  })
}

function clampInt(raw: string, min: number, max: number): number {
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

// ---- library (drag-and-drop palette) ---------------------------------------
function wireLibrary(): void {
  const search = $<HTMLInputElement>('librarySearch')
  search.addEventListener('input', () => renderLibrary(search.value.trim().toLowerCase()))
  renderLibrary('')
}

function renderLibrary(query: string): void {
  const host = $('library')
  host.innerHTML = ''
  for (const group of catalog) {
    const entries = group.entries.filter((e) => !query || e.label.toLowerCase().includes(query))
    if (entries.length === 0) continue
    const head = document.createElement('div')
    head.className = 'cat'
    head.textContent = group.title
    host.appendChild(head)
    for (const entry of entries) host.appendChild(libItem(entry))
  }
  renderPrefabLibrary(host, query)
}

function renderPrefabLibrary(host: HTMLElement, query: string): void {
  const prefabs = Object.values(loadPrefabs()).filter((p) => !query || p.name.toLowerCase().includes(query))
  if (prefabs.length === 0) return
  const head = document.createElement('div')
  head.className = 'cat'
  head.textContent = 'Prefabs'
  host.appendChild(head)
  for (const prefab of prefabs) {
    const count = prefab.objects.length + prefab.npcs.length + prefab.exits.length + prefab.props.length
    const el = document.createElement('div')
    el.className = 'libitem'
    el.innerHTML = `<span class="ic">▦</span><span class="lbl">${escapeHtml(prefab.name)}</span><span class="meta">${count}</span>`
    el.addEventListener('click', () => {
      clipboard = prefab
      setTool('stamp')
      updateStampInfo()
      toast(`Prefab "${prefab.name}" armed — click the map to stamp it.`, '')
    })
    host.appendChild(el)
  }
}

function libItem(entry: CatalogEntry): HTMLElement {
  const el = document.createElement('div')
  el.className = 'libitem'
  el.draggable = true
  const meta =
    entry.kind === 'rock' || entry.kind === 'tree' ? `lvl ${entry.level}`
    : entry.kind === 'npc' ? `cb ${entry.combatLevel}` : ''
  el.innerHTML = `<span class="ic">${entry.icon}</span><span class="lbl">${escapeHtml(entry.label)}</span>` +
    (meta ? `<span class="meta">${meta}</span>` : '') +
    (entry.kind === 'npc' && !entry.hasModel ? '<span class="nomodel" title="No 3D model — renders as a placeholder box">◻</span>' : '')
  el.addEventListener('click', () => {
    const armed = placementEntry === entry
    clearPlacement()
    if (!armed) {
      placementEntry = entry
      el.classList.add('active')
    }
  })
  el.addEventListener('dragstart', (e) => {
    draggedEntry = entry
    e.dataTransfer?.setData('text/plain', JSON.stringify(entry))
  })
  el.addEventListener('dragend', () => (draggedEntry = null))
  return el
}

function wireCanvasDrop(): void {
  const canvas = $<HTMLCanvasElement>('grid')
  canvas.addEventListener('dragover', (e) => e.preventDefault())
  canvas.addEventListener('drop', (e) => {
    e.preventDefault()
    // Prefer the same-page dragged entry (survives regardless of dataTransfer
    // quirks); fall back to the serialized payload.
    let entry = draggedEntry
    if (!entry) {
      const raw = e.dataTransfer?.getData('text/plain')
      if (!raw) return
      try {
        entry = JSON.parse(raw) as CatalogEntry
      } catch {
        return
      }
    }
    const placed = entry
    const { x, z } = grid.tileAt(e.clientX, e.clientY)
    if (x < 0 || z < 0 || x >= state.getDef().width || z >= state.getDef().height) return
    state.mutate((d) => (selection = placeEntry(d, placed, x, z)))
    refreshInspector()
    refreshSelectionHighlight()
  })
}

// ---- inspector --------------------------------------------------------------
function refreshSelectionHighlight(): void {
  grid.setSelection(selection ? coordsOf(state.getDef(), selection) : null)
}

function refreshInspector(): void {
  const host = $('inspector')
  const def = state.getDef()
  if (!selection) {
    host.innerHTML = '<div class="hint">Select a placed item to edit it.</div>'
    return
  }
  const { group, index } = selection
  host.innerHTML = ''

  if (group === 'objects') {
    const obj = def.objects[index]
    if (!obj) return void (selection = null)
    if (obj.type === 'rock') host.appendChild(dropdownField('Ore', obj.rock ?? '', gatherOptions('rock'), (v) => state.mutate((d) => (d.objects[index] as { rock?: string }).rock = v)))
    else if (obj.type === 'tree') host.appendChild(dropdownField('Tree', obj.tree ?? '', gatherOptions('tree'), (v) => state.mutate((d) => (d.objects[index] as { tree?: string }).tree = v)))
    else host.appendChild(textLine(`Bank chest`))
    host.appendChild(coordLine(obj.x, obj.z))
    host.appendChild(idLine(obj.id))
  } else if (group === 'npcs') {
    const npc = def.npcs[index]
    if (!npc) return void (selection = null)
    host.appendChild(dropdownField('Monster', npc.monsterId, monsterOptions(), (v) => state.mutate((d) => (d.npcs[index].monsterId = v))))
    host.appendChild(coordLine(npc.x, npc.z))
    host.appendChild(wanderFields(index))
    host.appendChild(idLine(npc.id))
  } else if (group === 'exits') {
    const exit = (def.exits ?? [])[index]
    if (!exit) return void (selection = null)
    host.appendChild(inputField('Label', exit.label, (v) => state.mutate((d) => (d.exits![index].label = v))))
    host.appendChild(dropdownField('To zone', exit.toZone, zoneOptions(), (v) => void retargetExit(index, v)))
    const arrival = document.createElement('button')
    arrival.textContent = `Arrival: (${exit.toX}, ${exit.toZ}) — pick…`
    arrival.style.width = '100%'
    arrival.addEventListener('click', openArrivalPickerForSelection)
    host.appendChild(arrival)
    host.appendChild(coordLine(exit.x, exit.z))
    host.appendChild(idLine(exit.id))
  } else {
    const prop = (def.props ?? [])[index]
    if (!prop) return void (selection = null)
    host.appendChild(textLine(`Prop: ${prop.model}`))
    host.appendChild(sliderField('Rotation', prop.rot ?? 0, 0, Math.PI * 2, 0.05, (v) => state.mutate((d) => (d.props![index].rot = v))))
    host.appendChild(sliderField('Scale', prop.scale ?? 1, 0.3, 3, 0.05, (v) => state.mutate((d) => (d.props![index].scale = v))))
    host.appendChild(coordLine(prop.x, prop.z))
  }

  const del = document.createElement('button')
  del.className = 'del'
  del.textContent = 'Delete (Del)'
  del.addEventListener('click', deleteSelection)
  host.appendChild(del)
}

function deleteSelection(): void {
  if (!selection) return
  const sel = selection
  state.mutate((d) => deleteItem(d, sel))
  selection = null
  refreshInspector()
  refreshSelectionHighlight()
}

function gatherOptions(kind: 'rock' | 'tree'): { value: string; label: string }[] {
  const group = catalog.find((g) => g.title === 'Gathering nodes')
  return (group?.entries ?? [])
    .filter((e) => e.kind === kind)
    .map((e) => ({ value: kind === 'rock' ? (e as { rock: string }).rock : (e as { tree: string }).tree, label: e.label }))
}

function monsterOptions(): { value: string; label: string }[] {
  const group = catalog.find((g) => g.title === 'Monsters')
  return (group?.entries ?? []).map((e) => ({ value: (e as { monsterId: string }).monsterId, label: e.label }))
}

function zoneOptions(): { value: string; label: string }[] {
  return zoneList.map((z) => ({ value: z.id, label: `${z.name} (${z.id})` }))
}

function fieldRow(label: string, control: Node): HTMLElement {
  const row = document.createElement('div')
  row.className = 'field'
  const l = document.createElement('label')
  l.textContent = label
  row.appendChild(l)
  row.appendChild(control)
  return row
}

function inputField(label: string, value: string, onChange: (v: string) => void): HTMLElement {
  const input = document.createElement('input')
  input.value = value
  input.addEventListener('input', () => onChange(input.value))
  return fieldRow(label, input)
}

function dropdownField(label: string, value: string, options: { value: string; label: string }[], onChange: (v: string) => void): HTMLElement {
  const sel = document.createElement('select')
  for (const o of options) {
    const opt = document.createElement('option')
    opt.value = o.value
    opt.textContent = o.label
    sel.appendChild(opt)
  }
  sel.value = value
  sel.addEventListener('change', () => onChange(sel.value))
  return fieldRow(label, sel)
}

function sliderField(label: string, value: number, min: number, max: number, step: number, onChange: (v: number) => void): HTMLElement {
  const input = document.createElement('input')
  input.type = 'range'
  input.min = String(min)
  input.max = String(max)
  input.step = String(step)
  input.value = String(value)
  input.addEventListener('input', () => onChange(Number(input.value)))
  return fieldRow(label, input)
}

function wanderFields(index: number): HTMLElement {
  const wrap = document.createElement('div')
  const npc = state.getDef().npcs[index]
  const mk = (key: 'x' | 'z' | 'w' | 'h', label: string) => {
    const input = document.createElement('input')
    input.type = 'number'
    input.value = String(npc.wander[key])
    input.addEventListener('input', () => state.mutate((d) => (d.npcs[index].wander[key] = clampInt(input.value, 0, 256))))
    return fieldRow(`Wander ${label}`, input)
  }
  for (const row of [mk('x', 'x'), mk('z', 'z'), mk('w', 'w'), mk('h', 'h')]) wrap.appendChild(row)
  return wrap
}

function coordLine(x: number, z: number): HTMLElement {
  return textLine(`Tile: (${x}, ${z})`)
}

function idLine(id: string): HTMLElement {
  return textLine(`Id: ${id}`)
}

function textLine(text: string): HTMLElement {
  const el = document.createElement('div')
  el.className = 'hint'
  el.textContent = text
  return el
}

/** Retargets an exit to a new destination zone: sets a valid arrival (the
 * target's spawn) so the def never goes invalid, then opens the picker to refine
 * it. */
async function retargetExit(index: number, toZone: string): Promise<void> {
  let spawn = { x: 0, z: 0 }
  try {
    spawn = (await api.getZone(toZone)).def.spawn
  } catch {
    /* keep 0,0 — picker will correct it */
  }
  state.mutate((d) => {
    const e = d.exits![index]
    e.toZone = toZone
    e.toX = spawn.x
    e.toZ = spawn.z
  })
  refreshInspector()
  openArrivalPickerForSelection()
}

function openArrivalPickerForSelection(): void {
  if (!selection || selection.group !== 'exits') return
  const sel = selection
  const exit = (state.getDef().exits ?? [])[sel.index]
  if (!exit) return
  void openArrivalPicker(api, exit.toZone, (x, z) => {
    state.mutate((d) => {
      const e = d.exits![sel.index]
      e.toX = x
      e.toZ = z
    })
    refreshInspector()
  })
}

// ---- scatter brush ----------------------------------------------------------
function handleScatter(p: TilePointer): void {
  if (!placementEntry || placementEntry.kind !== 'prop') {
    if (p.phase === 'down') toast('Pick a prop in the library, then scatter.', '')
    return
  }
  const entry = placementEntry
  const density = Number($<HTMLInputElement>('scatterDensity').value)
  const sprinkle = () => {
    if (!p.inside) return
    state.applyStroke((d) => {
      d.props ??= []
      d.props.push({ model: entry.model, x: p.x, z: p.z, rot: Math.random() * Math.PI * 2, scale: 0.8 + Math.random() * 0.5 })
    })
  }
  if (p.phase === 'down') {
    state.beginStroke()
    sprinkle()
  } else if (p.phase === 'move' && (p.buttons & 1)) {
    if (Math.random() < density) sprinkle()
  } else if (p.phase === 'up') {
    state.endStroke()
  }
}

// ---- stamps (marquee select / copy-paste prefabs) ---------------------------
let stampStart: { x: number; z: number } | null = null

function handleStamp(p: TilePointer, _right: boolean): void {
  if (p.phase === 'down') {
    stampStart = { x: p.x, z: p.z }
    grid.setDragPreview({ x0: p.x, z0: p.z, x1: p.x, z1: p.z })
  } else if (p.phase === 'move' && stampStart) {
    grid.setDragPreview({ x0: stampStart.x, z0: stampStart.z, x1: p.x, z1: p.z })
  } else if (p.phase === 'up' && stampStart) {
    const s = stampStart
    stampStart = null
    grid.setDragPreview(null)
    if (s.x === p.x && s.z === p.z) {
      if (clipboard) state.mutate((d) => stampPrefab(d, clipboard!, p.x, p.z))
      return
    }
    const prefab = extractRegion(state.getDef(), s.x, s.z, p.x, p.z)
    if (prefab) {
      clipboard = prefab
      updateStampInfo()
    } else {
      toast('No placed items in that box.', '')
    }
  }
}

function updateStampInfo(): void {
  const n = clipboard ? clipboard.objects.length + clipboard.npcs.length + clipboard.exits.length + clipboard.props.length : 0
  $('stampInfo').textContent = clipboard
    ? `${n} items copied — click the map to stamp a copy.`
    : 'Drag a box to select items, then click to stamp copies.'
  $<HTMLButtonElement>('stampSaveBtn').disabled = !clipboard
}

function wireStampSave(): void {
  $('stampSaveBtn').addEventListener('click', () => {
    if (!clipboard) return
    const name = prompt('Prefab name:')?.trim()
    if (!name) return
    savePrefab({ ...clipboard, name })
    toast(`Saved prefab "${name}".`, 'ok')
    renderLibrary($<HTMLInputElement>('librarySearch').value.trim().toLowerCase())
  })
}

// ---- environments + publish -------------------------------------------------
function wireEnv(): void {
  $('envSelect').addEventListener('change', (e) => void switchEnv((e.target as HTMLSelectElement).value as typeof env))
  $('publishBtn').addEventListener('click', () => void publishToProduction())
}

async function envApi(target: 'preview' | 'production'): Promise<EditorApi | null> {
  if (target === 'preview') return new EditorApi('', localStorage.getItem(TOKEN_KEY) ?? '')
  const cfg = await prodConfig()
  return cfg ? new EditorApi(cfg.base, cfg.token) : null
}

type ProdCfg = { base: string; token: string }
async function prodConfig(): Promise<ProdCfg | null> {
  const stored = localStorage.getItem(PROD_KEY)
  if (stored) {
    try {
      return JSON.parse(stored) as ProdCfg
    } catch {
      /* reconfigure */
    }
  }
  const base = prompt('Production world URL (e.g. https://world.pocketrpg.co.uk):')?.trim()
  if (!base) return null
  const token = prompt('Production editor token:')?.trim()
  if (!token) return null
  const cfg = { base: base.replace(/\/$/, ''), token }
  const trial = new EditorApi(cfg.base, cfg.token)
  try {
    await trial.listZones()
  } catch {
    toast('Could not reach production with those details.', 'err')
    return null
  }
  localStorage.setItem(PROD_KEY, JSON.stringify(cfg))
  return cfg
}

async function switchEnv(target: 'preview' | 'production'): Promise<void> {
  const next = await envApi(target)
  if (!next) {
    $<HTMLSelectElement>('envSelect').value = env
    return
  }
  api = next
  env = target
  await refreshZoneList()
  toast(`Editing ${target}.`, target === 'production' ? 'err' : 'ok')
}

async function publishToProduction(): Promise<void> {
  const def = state.getDef()
  if (!validateZone(def).valid) {
    toast('Fix validation errors before publishing.', 'err')
    return
  }
  if (!confirm(`Publish "${def.name}" (${def.id}) to PRODUCTION? This overwrites the production copy.`)) return
  const prod = await envApi('production')
  if (!prod) return
  try {
    const res = await prod.saveZone(def)
    toast(`Published ${def.id} to production (revision ${res.revision}).`, 'ok')
  } catch (e) {
    const err = e as Error & { errors?: string[] }
    toast(`Publish rejected: ${err.message}`, 'err')
    if (err.errors) renderValidation(err.errors)
  }
}

// ---- revision history + 3D preview -----------------------------------------
function wireHistoryAnd3D(): void {
  $('historyBtn').addEventListener('click', () => void openHistory())
  $('historyClose').addEventListener('click', () => ($('historyModal').style.display = 'none'))
  $('preview3dBtn').addEventListener('click', () => void openPreview())
  $('preview3dClose').addEventListener('click', () => void closePreview())
}

async function openHistory(): Promise<void> {
  const id = state.getDef().id
  const list = $('historyList')
  list.innerHTML = '<div class="hint">Loading…</div>'
  $('historyModal').style.display = 'flex'
  let revisions: { revision: number; createdAt: number }[] = []
  try {
    revisions = (await api.listRevisions(id)).revisions
  } catch {
    list.innerHTML = '<div class="hint">No stored history for this zone yet.</div>'
    return
  }
  if (revisions.length === 0) {
    list.innerHTML = '<div class="hint">No stored history for this zone yet (save it first).</div>'
    return
  }
  list.innerHTML = ''
  for (const r of revisions) {
    const row = document.createElement('div')
    row.className = 'rev'
    const when = new Date(r.createdAt).toLocaleString()
    row.innerHTML = `<span>Revision ${r.revision} <span class="when">${when}</span></span>`
    const btn = document.createElement('button')
    btn.textContent = 'Restore'
    btn.addEventListener('click', () => void restoreRevision(id, r.revision))
    row.appendChild(btn)
    list.appendChild(row)
  }
}

async function restoreRevision(id: string, revision: number): Promise<void> {
  if (!confirm(`Restore revision ${revision}? This saves it as a new revision.`)) return
  try {
    await api.restoreRevision(id, revision)
    const { def } = await api.getZone(id)
    state.load(def, null)
    grid.setDef(state.getDef())
    grid.fit()
    await refreshZoneList()
    refreshAll()
    $('historyModal').style.display = 'none'
    toast(`Restored revision ${revision}.`, 'ok')
  } catch (e) {
    toast(`Restore failed: ${(e as Error).message}`, 'err')
  }
}

async function openPreview(): Promise<void> {
  const { openPreview3D } = await import('./preview3d')
  await openPreview3D(state.getDef())
}

async function closePreview(): Promise<void> {
  const { closePreview3D } = await import('./preview3d')
  closePreview3D()
}

// ---- refresh ----------------------------------------------------------------
let refreshQueued = false
function scheduleRefresh(): void {
  if (refreshQueued) return
  refreshQueued = true
  requestAnimationFrame(() => {
    refreshQueued = false
    refreshAll()
  })
}

function refreshAll(): void {
  // A structural change (undo/redo/load) can invalidate the selection index.
  if (selection && !coordsOf(state.getDef(), selection)) selection = null
  grid.setDef(state.getDef())
  refreshMeta()
  refreshValidation()
  refreshStatus()
  refreshInspector()
  refreshSelectionHighlight()
}

function setIfBlurred(id: string, value: string): void {
  const el = $<HTMLInputElement>(id)
  if (document.activeElement !== el) el.value = value
}

function refreshMeta(): void {
  const d = state.getDef()
  setIfBlurred('fId', d.id)
  setIfBlurred('fName', d.name)
  setIfBlurred('fWidth', String(d.width))
  setIfBlurred('fHeight', String(d.height))
  const pal = d.palette ?? DEFAULT_PALETTE
  setIfBlurred('pWA', pal.walkableA)
  setIfBlurred('pWB', pal.walkableB)
  setIfBlurred('pBA', pal.blockedA)
  setIfBlurred('pBB', pal.blockedB)
  $<HTMLSelectElement>('palettePreset').value = matchPalette(d.palette)
  const amb = d.ambience ?? DEFAULT_AMBIENCE
  setIfBlurred('aSky', amb.sky ?? '#87ceeb')
  setIfBlurred('aHemi', String(amb.hemiIntensity ?? 1.1))
  setIfBlurred('aSun', String(amb.sunIntensity ?? 1.4))
  $<HTMLSelectElement>('ambiencePreset').value = matchAmbience(d.ambience)
}

function refreshValidation(): void {
  const result = validateZone(state.getDef())
  renderValidation(result.valid ? [] : result.errors)
}

function renderValidation(errors: string[]): void {
  const el = $('validation')
  if (errors.length === 0) {
    el.innerHTML = '<div class="ok item">✓ Valid</div>'
    return
  }
  el.innerHTML = errors.map((e) => `<div class="item">• ${escapeHtml(e)}</div>`).join('')
}

function refreshStatus(): void {
  $('dirtyDot').classList.toggle('dirty', state.isDirty())
  $<HTMLButtonElement>('undoBtn').disabled = !state.canUndo()
  $<HTMLButtonElement>('redoBtn').disabled = !state.canRedo()
  const d = state.getDef()
  $('status').textContent = `${d.width}×${d.height}${state.isDirty() ? ' • unsaved' : ''}`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
}

initTokenGate()
