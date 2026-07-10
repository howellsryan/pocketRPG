import itemsData from '../../../src/data/items.json'
import type { InvSlot } from '../../shared/protocol'
import type { MenuRow } from './picking'

export type MenuDispatch = (row: MenuRow) => void

type ItemsData = Record<string, { name?: string; icon?: string } | undefined>
const items = itemsData as unknown as ItemsData

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
  user-select: none;
}
.inv-slot .qty {
  position: absolute; top: 0; right: 2px; font-size: 10px; color: #ffe066;
  text-shadow: 0 1px 2px #000;
}
#msg-strip {
  position: fixed; left: 8px; bottom: 8px; z-index: 10; font-family: sans-serif;
  font-size: 13px; color: #f4e9c8; text-shadow: 0 1px 2px #000; pointer-events: none;
}
#msg-strip div { margin-top: 2px; }
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

/** Creates the in-game HUD (inventory grid, message strip, xp-drop layer).
 * Call once after the welcome message. */
export function initHud(): void {
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
}

export function npcExamine(monsterId: string): string {
  return NPC_EXAMINE[monsterId] ?? 'A creature of the pasture, minding its own business.'
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
    const verb = row.text.slice(0, row.text.length - row.targetName.length)
    if (verb) el.appendChild(span(verb))
    const nameColor = row.targetKind === 'npc' || row.targetKind === 'object' ? NAME_CYAN : undefined
    el.appendChild(span(row.targetName, nameColor))
    if (row.monsterLevel != null) {
      el.appendChild(span(` (level-${row.monsterLevel})`, row.levelFavourable ? LEVEL_GREEN : LEVEL_RED))
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
    cell.textContent = ''
    cell.title = ''
    if (!slot) continue
    const item = items[slot.itemId]
    cell.textContent = item?.icon ?? '❔'
    cell.title = item?.name ?? slot.itemId
    if (slot.quantity > 1) {
      const qty = document.createElement('span')
      qty.className = 'qty'
      qty.textContent = String(slot.quantity)
      cell.appendChild(qty)
    }
  }
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
