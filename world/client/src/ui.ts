import type { InvSlot } from '../../shared/protocol'
import type { MenuRow } from './picking'
import { iconMarkup, itemName } from './itemIcon'

export type MenuDispatch = (row: MenuRow) => void

const INVENTORY_COLS = 4
const INVENTORY_ROWS = 7
const XP_DROP_MS = 1200
const MAX_MESSAGES = 3

const HUD_CSS = `
#inv-panel {
  position: fixed; right: 8px; top: 50%; transform: translateY(-50%);
  display: grid; grid-template-columns: repeat(${INVENTORY_COLS}, 40px);
  grid-auto-rows: 40px; gap: 3px; padding: 6px;
  background: rgba(20, 16, 10, 0.82); border: 1px solid #5a4a30; border-radius: 8px;
  font-family: sans-serif; z-index: 10;
}
.inv-slot {
  background: rgba(60, 50, 34, 0.55); border-radius: 4px; position: relative;
  display: flex; align-items: center; justify-content: center; font-size: 22px;
  user-select: none; touch-action: none;
}
.inv-slot.drag-over { outline: 2px solid #ffe066; }
.inv-slot .qty {
  position: absolute; top: 0; right: 2px; font-size: 10px; color: #ffe066;
  text-shadow: 0 1px 2px #000;
}
#msg-strip {
  position: fixed; left: 8px; bottom: 40px; z-index: 10; font-family: sans-serif;
  font-size: 13px; color: #f4e9c8; text-shadow: 0 1px 2px #000; pointer-events: none;
}
#msg-strip div { margin-top: 2px; }
#chat-input {
  position: fixed; left: 8px; bottom: 8px; z-index: 10; width: min(280px, 60vw);
  padding: 5px 8px; font-family: sans-serif; font-size: 13px;
  background: rgba(20, 16, 10, 0.82); color: #f4e9c8;
  border: 1px solid #5a4a30; border-radius: 6px; outline: none;
  -webkit-user-select: text; user-select: text; touch-action: auto;
}
#chat-input::placeholder { color: #8a7a5a; }
.nameplate {
  position: absolute; transform: translate(-50%, -100%); pointer-events: none;
  font-family: sans-serif; font-size: 12px; color: #ffffff; text-shadow: 0 1px 2px #000;
  white-space: nowrap;
}
.overhead-chat {
  position: absolute; transform: translate(-50%, -100%); pointer-events: none;
  font-family: sans-serif; font-size: 13px; color: #ffe850; text-shadow: 0 1px 2px #000;
  white-space: nowrap; max-width: 60vw; overflow: hidden; text-overflow: ellipsis;
}
#xp-drops {
  position: fixed; left: 50%; top: 38%; z-index: 10; pointer-events: none;
  font-family: sans-serif; font-weight: bold; color: #ffe066; text-shadow: 0 1px 3px #000;
}
.xp-drop { position: absolute; white-space: nowrap; transform: translateX(-50%); animation: xp-rise ${XP_DROP_MS}ms ease-out forwards; }
@keyframes xp-rise { from { opacity: 1; top: 0; } to { opacity: 0; top: -70px; } }
#hover-line {
  position: fixed; left: 8px; top: 6px; z-index: 10; pointer-events: none;
  font-family: sans-serif; font-size: 15px; color: #ffe066; text-shadow: 0 1px 2px #000;
}
#hp-pill {
  position: fixed; right: 8px; top: 8px; z-index: 10; padding: 4px 10px;
  background: rgba(20, 16, 10, 0.82); border: 1px solid #5a4a30; border-radius: 12px;
  font-family: sans-serif; font-size: 13px; font-weight: bold; color: #5fd35f;
  text-shadow: 0 1px 2px #000; pointer-events: none;
}
#hp-pill.low { color: #e05a5a; }
#ctx-menu {
  position: fixed; z-index: 30; min-width: 120px; padding: 0 0 2px;
  background: rgba(20, 16, 10, 0.95); border: 1px solid #6a5636; border-radius: 4px;
  font-family: sans-serif; font-size: 14px; user-select: none;
}
#ctx-menu .ctx-head {
  padding: 4px 8px; color: #c9b892; border-bottom: 1px solid #4a3d26; background: rgba(70, 58, 36, 0.6);
}
#ctx-menu .ctx-row {
  min-height: 32px; display: flex; align-items: center; padding: 0 8px; color: #ffffff; cursor: pointer;
  white-space: pre;
}
#ctx-menu .ctx-row:hover { background: #46618a; }
#fx-layer { position: fixed; inset: 0; z-index: 20; pointer-events: none; font-family: sans-serif; }
.hitsplat {
  position: absolute; min-width: 22px; height: 22px; padding: 0 3px; border-radius: 4px;
  display: flex; align-items: center; justify-content: center; color: #fff; font-size: 13px; font-weight: bold;
  transform: translate(-50%, -50%); animation: splat 900ms ease-out forwards;
}
.hitsplat.hit { background: #c81e1e; }
.hitsplat.block { background: #2b6cc8; }
@keyframes splat { 0% { opacity: 1; } 70% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -160%); } }
.hpbar {
  position: absolute; width: 46px; height: 6px; transform: translate(-50%, -50%);
  background: #c81e1e; border: 1px solid #000; border-radius: 2px; overflow: hidden;
}
.hpbar > span { display: block; height: 100%; background: #4fae3f; }
`

let hudReady = false

// Filled state per slot, kept by renderInventory so the drag layer knows which
// cells can start a drag without owning a copy of the inventory itself.
const slotFilled: boolean[] = new Array(INVENTORY_COLS * INVENTORY_ROWS).fill(false)

const DRAG_THRESHOLD_PX = 6
const LONG_PRESS_MS = 500

export type InvHandlers = {
  onMoveInv: (from: number, to: number) => void
  /** Tap on a filled slot → the item's primary action (Wield/Eat/Bury/…). */
  onSlotTap: (index: number) => void
  /** Long-press / right-click on a filled slot → the item menu. */
  onSlotMenu: (index: number, x: number, y: number) => void
}

/** Pointer-based pack-grid input (desktop and touch share the path):
 * press-and-move past a small threshold drags to reorder (ghost + highlight,
 * mirroring the main game's InventoryGrid), a plain tap fires the item's
 * primary action, a stationary long-press or right-click opens the item menu. */
function setupInvDrag(panel: HTMLElement, handlers: InvHandlers): void {
  const onMove = handlers.onMoveInv
  let drag: { from: number; startX: number; startY: number; ghost: HTMLElement | null; over: number | null; menuFired: boolean; timer: ReturnType<typeof setTimeout> | null } | null = null

  const indexOfCell = (el: Element | null): number | null => {
    // Element, not HTMLElement — the press usually lands on the icon's inline
    // SVG (an SVGElement), and closest() must still walk up to the slot.
    const cell = el instanceof Element ? el.closest('.inv-slot') : null
    if (!cell || cell.parentElement !== panel) return null
    return Array.prototype.indexOf.call(panel.children, cell)
  }

  const cellUnderPointer = (x: number, y: number): number | null => {
    if (drag?.ghost) drag.ghost.style.display = 'none'
    const el = document.elementFromPoint(x, y)
    if (drag?.ghost) drag.ghost.style.display = ''
    return indexOfCell(el)
  }

  const finish = (commit: boolean): void => {
    if (!drag) return
    if (drag.timer) clearTimeout(drag.timer)
    drag.ghost?.remove()
    if (drag.over != null) panel.children[drag.over]?.classList.remove('drag-over')
    if (commit && drag.ghost && drag.over != null && drag.over !== drag.from) onMove(drag.from, drag.over)
    else if (commit && !drag.ghost && !drag.menuFired) handlers.onSlotTap(drag.from)
    drag = null
  }

  panel.addEventListener('pointerdown', (e) => {
    if (e.button === 2) return // right-click goes through contextmenu below
    const index = indexOfCell(e.target as Element)
    if (index == null || !slotFilled[index]) return
    const timer = setTimeout(() => {
      // Stationary long-press: open the menu instead of tapping or dragging.
      if (!drag || drag.ghost) return
      drag.menuFired = true
      handlers.onSlotMenu(drag.from, drag.startX, drag.startY)
    }, LONG_PRESS_MS)
    drag = { from: index, startX: e.clientX, startY: e.clientY, ghost: null, over: null, menuFired: false, timer }
    ;(panel.children[index] as HTMLElement).setPointerCapture(e.pointerId)
  })
  panel.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    const index = indexOfCell(e.target as Element)
    if (index == null || !slotFilled[index]) return
    if (drag?.timer) clearTimeout(drag.timer)
    drag = null
    handlers.onSlotMenu(index, e.clientX, e.clientY)
  })
  panel.addEventListener('pointermove', (e) => {
    if (!drag || drag.menuFired) return
    if (!drag.ghost) {
      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY
      if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return
      if (drag.timer) clearTimeout(drag.timer)
      const ghost = (panel.children[drag.from] as HTMLElement).cloneNode(true) as HTMLElement
      ghost.style.cssText =
        'position:fixed;width:40px;height:40px;pointer-events:none;z-index:40;opacity:0.85;' +
        'display:flex;align-items:center;justify-content:center;' +
        'border:2px solid #ffe066;border-radius:6px;background:rgba(20,16,10,0.9);'
      document.body.appendChild(ghost)
      drag.ghost = ghost
    }
    drag.ghost.style.left = `${e.clientX - 20}px`
    drag.ghost.style.top = `${e.clientY - 20}px`
    const over = cellUnderPointer(e.clientX, e.clientY)
    const target = over === drag.from ? null : over
    if (target !== drag.over) {
      if (drag.over != null) panel.children[drag.over]?.classList.remove('drag-over')
      if (target != null) panel.children[target]?.classList.add('drag-over')
      drag.over = target
    }
  })
  panel.addEventListener('pointerup', () => finish(true))
  panel.addEventListener('pointercancel', () => finish(false))
}

/** Creates the in-game HUD (inventory grid, message strip, xp-drop layer, HP
 * pill). Call once after the welcome message. */
export function initHud(handlers?: InvHandlers): void {
  if (hudReady) return
  hudReady = true
  const style = document.createElement('style')
  style.textContent = HUD_CSS
  document.head.appendChild(style)

  const inv = document.createElement('div')
  inv.id = 'inv-panel'
  for (let i = 0; i < INVENTORY_COLS * INVENTORY_ROWS; i++) {
    const slot = document.createElement('div')
    slot.className = 'inv-slot'
    inv.appendChild(slot)
  }
  document.body.appendChild(inv)
  if (handlers) setupInvDrag(inv, handlers)

  const hpPill = document.createElement('div')
  hpPill.id = 'hp-pill'
  document.body.appendChild(hpPill)

  const msgs = document.createElement('div')
  msgs.id = 'msg-strip'
  document.body.appendChild(msgs)

  const drops = document.createElement('div')
  drops.id = 'xp-drops'
  document.body.appendChild(drops)

  const hover = document.createElement('div')
  hover.id = 'hover-line'
  document.body.appendChild(hover)

  const fx = document.createElement('div')
  fx.id = 'fx-layer'
  document.body.appendChild(fx)
}

const NPC_EXAMINE: Record<string, string> = {
  pasture_bull: 'A hefty highland bull. Prime cowhide on the hoof.',
  field_chicken: 'A plump forest fowl. Braver than it looks, which is not very.',
  cave_goblin: 'A wiry little menace, a long way from any cave.',
  arcane_adept: 'A robed student of the arcane, practising where the trees can’t complain.',
}

export function npcExamine(monsterId: string): string {
  return NPC_EXAMINE[monsterId] ?? 'A creature of the wilds, minding its own business.'
}

export function lootExamine(itemName: string): string {
  return `A dropped ${itemName}. Best pick it up before it fades.`
}

/** A red (or blue, for a 0/block) damage number at a screen position. */
export function showHitsplat(screenX: number, screenY: number, dmg: number): void {
  const layer = document.getElementById('fx-layer')
  if (!layer) return
  const el = document.createElement('div')
  el.className = `hitsplat ${dmg > 0 ? 'hit' : 'block'}`
  el.textContent = String(dmg)
  el.style.left = `${screenX}px`
  el.style.top = `${screenY}px`
  layer.appendChild(el)
  setTimeout(() => el.remove(), 900)
}

const hpBars = new Map<string, HTMLElement>()

export function updateHpBar(id: string, screenX: number, screenY: number, ratio: number): void {
  const layer = document.getElementById('fx-layer')
  if (!layer) return
  let bar = hpBars.get(id)
  if (!bar) {
    bar = document.createElement('div')
    bar.className = 'hpbar'
    const fill = document.createElement('span')
    bar.appendChild(fill)
    layer.appendChild(bar)
    hpBars.set(id, bar)
  }
  bar.style.left = `${screenX}px`
  bar.style.top = `${screenY}px`
  ;(bar.firstChild as HTMLElement).style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`
}

export function removeHpBar(id: string): void {
  hpBars.get(id)?.remove()
  hpBars.delete(id)
}

function trackedLabel(store: Map<string, HTMLElement>, id: string, className: string): HTMLElement | null {
  const layer = document.getElementById('fx-layer')
  if (!layer) return null
  let el = store.get(id)
  if (!el) {
    el = document.createElement('div')
    el.className = className
    layer.appendChild(el)
    store.set(id, el)
  }
  return el
}

function removeTracked(store: Map<string, HTMLElement>, id: string): void {
  store.get(id)?.remove()
  store.delete(id)
}

const nameplates = new Map<string, HTMLElement>()

export function updateNameplate(id: string, screenX: number, screenY: number, name: string): void {
  const el = trackedLabel(nameplates, id, 'nameplate')
  if (!el) return
  el.textContent = name
  el.style.left = `${screenX}px`
  el.style.top = `${screenY}px`
}

export function removeNameplate(id: string): void {
  removeTracked(nameplates, id)
}

const overheadChats = new Map<string, HTMLElement>()

export function updateOverheadChat(id: string, screenX: number, screenY: number, text: string): void {
  const el = trackedLabel(overheadChats, id, 'overhead-chat')
  if (!el) return
  el.textContent = text
  el.style.left = `${screenX}px`
  el.style.top = `${screenY}px`
}

export function removeOverheadChat(id: string): void {
  removeTracked(overheadChats, id)
}

/** Chat input pinned under the message log. Enter sends (and blurs on mobile
 * so the keyboard drops), Escape blurs. Player text only ever goes through
 * textContent on the way back out. */
export function initChatInput(onSend: (text: string) => void): void {
  if (document.getElementById('chat-input')) return
  const input = document.createElement('input')
  input.id = 'chat-input'
  input.type = 'text'
  input.placeholder = 'Say something…'
  input.maxLength = 120
  input.autocomplete = 'off'
  input.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Escape') input.blur()
    if (e.key !== 'Enter') return
    const text = input.value.trim()
    input.value = ''
    if (text) onSend(text)
  })
  document.body.appendChild(input)
}

const NAME_CYAN = '#61d0d8'
const LEVEL_GREEN = '#5fd35f'
const LEVEL_RED = '#e05a5a'

export function setHoverText(text: string): void {
  const el = document.getElementById('hover-line')
  if (el) el.textContent = text
}

function span(text: string, color?: string): HTMLSpanElement {
  const s = document.createElement('span')
  s.textContent = text
  if (color) s.style.color = color
  return s
}

function renderMenuRow(row: MenuRow): HTMLElement {
  const el = document.createElement('div')
  el.className = 'ctx-row'
  if (row.targetName && row.text.endsWith(row.targetName)) {
    // A trailing space inside an inline span collapses against the next span
    // ("TakeCowhide"), so bind verb→name with a non-breaking space.
    const verb = row.text.slice(0, row.text.length - row.targetName.length).trimEnd()
    if (verb) el.appendChild(span(`${verb} `))
    const nameColor = row.targetKind === 'npc' || row.targetKind === 'object' ? NAME_CYAN : undefined
    el.appendChild(span(row.targetName, nameColor))
    if (row.monsterLevel != null) {
      el.appendChild(span(` (level-${row.monsterLevel})`, row.levelFavourable ? LEVEL_GREEN : LEVEL_RED))
    }
  } else {
    el.textContent = row.text
  }
  return el
}

let closeMenuListener: ((e: MouseEvent) => void) | null = null

export function hideContextMenu(): void {
  document.getElementById('ctx-menu')?.remove()
  if (closeMenuListener) {
    window.removeEventListener('pointerdown', closeMenuListener, true)
    closeMenuListener = null
  }
}

/** Opens the right-click / long-press menu at (x,y), clamped on-screen. Rows
 * dispatch through `onPick`; clicking outside or a row closes it. */
export function showContextMenu(rows: MenuRow[], x: number, y: number, onPick: MenuDispatch): void {
  hideContextMenu()
  const menu = document.createElement('div')
  menu.id = 'ctx-menu'
  const head = document.createElement('div')
  head.className = 'ctx-head'
  head.textContent = 'Choose Option'
  menu.appendChild(head)

  for (const row of rows) {
    const el = renderMenuRow(row)
    el.addEventListener('pointerup', (e) => {
      e.stopPropagation()
      hideContextMenu()
      onPick(row)
    })
    menu.appendChild(el)
  }

  menu.style.left = `${Math.min(x, window.innerWidth - 160)}px`
  menu.style.top = `${Math.min(y, window.innerHeight - rows.length * 32 - 30)}px`
  document.body.appendChild(menu)

  closeMenuListener = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) hideContextMenu()
  }
  // Capture-phase so the same press that lands outside closes the menu.
  window.addEventListener('pointerdown', closeMenuListener, true)
}

export function renderInventory(inventory: InvSlot[]): void {
  const panel = document.getElementById('inv-panel')
  if (!panel) return
  const slots = panel.children
  for (let i = 0; i < slots.length; i++) {
    const cell = slots[i] as HTMLElement
    const slot = inventory[i] ?? null
    slotFilled[i] = slot !== null
    cell.innerHTML = ''
    cell.title = ''
    if (!slot) continue
    cell.innerHTML = iconMarkup(slot.itemId, 32)
    cell.title = itemName(slot.itemId)
    if (slot.quantity > 1) {
      const qty = document.createElement('span')
      qty.className = 'qty'
      qty.textContent = String(slot.quantity)
      cell.appendChild(qty)
    }
  }
}

export function updateHpPill(hp: number, maxHp: number): void {
  const el = document.getElementById('hp-pill')
  if (!el) return
  el.textContent = `❤ ${hp}/${maxHp}`
  el.classList.toggle('low', maxHp > 0 && hp / maxHp <= 0.3)
}

export function showXpDrop(skill: string, amount: number): void {
  const layer = document.getElementById('xp-drops')
  if (!layer) return
  const drop = document.createElement('div')
  drop.className = 'xp-drop'
  const skillName = skill.charAt(0).toUpperCase() + skill.slice(1)
  drop.textContent = `+${amount} ${skillName}`
  layer.appendChild(drop)
  setTimeout(() => drop.remove(), XP_DROP_MS)
}

export function pushMessage(text: string): void {
  const strip = document.getElementById('msg-strip')
  if (!strip) return
  const line = document.createElement('div')
  line.textContent = text
  strip.appendChild(line)
  while (strip.children.length > MAX_MESSAGES) strip.firstChild?.remove()
}

function appEl(): HTMLElement | null {
  return document.getElementById('app')
}

function sceneEl(): HTMLElement | null {
  return document.getElementById('scene')
}

function showOverlay(): void {
  const app = appEl()
  const scene = sceneEl()
  if (app) app.style.display = 'flex'
  if (scene) scene.style.display = 'none'
}

export function hideOverlay(): void {
  const app = appEl()
  const scene = sceneEl()
  if (app) app.style.display = 'none'
  if (scene) scene.style.display = 'block'
}

/** Connection banner — standalone (not part of initHud) so it can show before
 * the first welcome or while the HUD isn't built. */
export function showConnBanner(): void {
  let el = document.getElementById('conn-banner')
  if (!el) {
    el = document.createElement('div')
    el.id = 'conn-banner'
    el.textContent = 'Reconnecting…'
    el.style.cssText =
      'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:40;padding:6px 14px;' +
      'background:rgba(140,40,40,0.92);color:#fff;font-family:sans-serif;font-size:13px;border-radius:6px;'
    document.body.appendChild(el)
  }
  el.style.display = 'block'
}

export function hideConnBanner(): void {
  const el = document.getElementById('conn-banner')
  if (el) el.style.display = 'none'
}

/** Full-page cover for the ~1s zone-transition reload. */
export function showTransitionOverlay(text: string): void {
  const el = appEl()
  if (el) el.textContent = text
  showOverlay()
}

export function showLoginRequired(pocketRpgUrl: string): void {
  const el = appEl()
  if (el) {
    el.textContent = ''
    const p = document.createElement('p')
    p.textContent = 'Log in to PocketRPG and enter the world from there.'
    const a = document.createElement('a')
    a.href = pocketRpgUrl
    a.textContent = 'Go to PocketRPG'
    el.appendChild(p)
    el.appendChild(a)
  }
  showOverlay()
}
