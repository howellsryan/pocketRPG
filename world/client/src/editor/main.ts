import { validateZone, type ZoneDef, type ZonePalette, type ZoneAmbience } from '../../../shared/zone'
import { EditorApi, type ZoneListEntry } from './api'
import { EditorState, blankZone, paintTile, paintRect, floodFill, resizeZone } from './state'
import { GridView, type TilePointer } from './grid'
import { AMBIENCE_PRESETS, DEFAULT_AMBIENCE, DEFAULT_PALETTE, PALETTE_PRESETS, matchAmbience, matchPalette } from './presets'

const TOKEN_KEY = 'world_editor_token'
type Tool = 'paintWalkable' | 'paintBlocked' | 'rect' | 'fill' | 'spawn' | 'pan'

const $ = <T = HTMLElement>(id: string) => document.getElementById(id) as T

let api: EditorApi
let state: EditorState
let grid: GridView
let activeTool: Tool = 'paintWalkable'
let zoneList: ZoneListEntry[] = []

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
  wireTopbar()
  wireTools()
  wireMeta()
  wirePresets()
  wirePlaytest()
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

function onTile(p: TilePointer): void {
  if (activeTool === 'pan') return
  const rightHeld = (p.buttons & 2) !== 0

  if (activeTool === 'spawn') {
    if (p.phase === 'down' && p.inside) state.mutate((d) => (d.spawn = { x: p.x, z: p.z }))
    return
  }

  if (activeTool === 'fill') {
    if (p.phase === 'down' && p.inside) state.mutate((d) => floodFill(d, p.x, p.z, rightHeld))
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
      activeTool = btn.dataset.tool as Tool
      for (const b of document.querySelectorAll('#toolGroup [data-tool]')) b.classList.toggle('active', b === btn)
    })
  }
  document.querySelector<HTMLButtonElement>('[data-tool="paintWalkable"]')!.classList.add('active')
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
    }
  })
}

function clampInt(raw: string, min: number, max: number): number {
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
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
  grid.setDef(state.getDef())
  refreshMeta()
  refreshValidation()
  refreshStatus()
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
