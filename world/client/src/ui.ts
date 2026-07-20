import type { CombatStance, EquipmentMap, InvSlot } from '../../shared/protocol'
import type { MenuRow } from './picking'
import { iconMarkup, itemName, uiIconMarkup } from './itemIcon'
import { spellIconSvg } from './spellIcon'
import { categorisePrayers, type PrayerView } from '../../shared/prayer'

// Skill crest + accent for each skill a prayer can map to (mirrors SKILL_ART in
// src/utils/skillArt.js; kept local so the HUD's icon lookup stays lazy instead
// of statically pulling gameIcons.json into the core bundle).
const PRAYER_SKILL_ICON: Record<string, { icon: string; accent: string }> = {
  attack: { icon: 'combat_level', accent: '#cdd6e0' },
  strength: { icon: 'muscle_up', accent: '#d9904a' },
  defence: { icon: 'shield', accent: '#8fa6c0' },
  ranged: { icon: 'high_shot', accent: '#b3873f' },
  magic: { icon: 'pointy_hat', accent: '#9b6cff' },
}

export type MenuDispatch = (row: MenuRow) => void

const INVENTORY_COLS = 4
const INVENTORY_ROWS = 7
const INV_CELL_PX = 40
const INV_GAP_PX = 3
const INV_CONTENT_W = INVENTORY_COLS * INV_CELL_PX + (INVENTORY_COLS - 1) * INV_GAP_PX
const INV_CONTENT_H = INVENTORY_ROWS * INV_CELL_PX + (INVENTORY_ROWS - 1) * INV_GAP_PX
// The tallest pane (inventory, 7 rows) sets one fixed body height for every
// tab — otherwise switching tabs (e.g. combat, much shorter) resizes the
// panel and shoves the tab rail below it up/down each time.
const HUD_BODY_H = INV_CONTENT_H + 2 * 6 // + .hud-body's own top/bottom padding
// The panel used to be a flat 232px regardless of content, leaving a wide
// empty gutter to the right of every inventory row (narrower than the tab
// rail above it). Size the panel to the inventory grid's own content width
// (plus hud-body's padding/border) instead, clamped up only as far as the
// top tab rail's 44px-min-tap-target floor (§9) requires.
const HUD_PANEL_WIDTH = Math.max(INV_CONTENT_W + 14, 4 * 44 + 3 * 3)
const XP_DROP_MS = 1200
const MAX_MESSAGES = 3

// Shared PocketRPG-styled scrollbar (parchment/gold/void palette per
// DESIGN.md — hard-coded here since the world client doesn't load the main
// app's src/index.css tokens). Apply the class to any scrollable container
// that should match the game's chrome instead of the browser default;
// defined once here and reused by bank.ts/crafting.ts via SCROLL_CLASS/
// SCROLL_CSS so the colours live in one place.
export const SCROLL_CLASS = 'pr-scroll'
export const SCROLL_CSS = `
.${SCROLL_CLASS} { scrollbar-width: thin; scrollbar-color: #b08842 rgba(20, 16, 10, 0.4); }
.${SCROLL_CLASS}::-webkit-scrollbar { width: 8px; height: 8px; }
.${SCROLL_CLASS}::-webkit-scrollbar-track { background: rgba(20, 16, 10, 0.4); border-radius: 6px; }
.${SCROLL_CLASS}::-webkit-scrollbar-thumb { background: #b08842; border-radius: 6px; border: 1px solid #6e521f; }
.${SCROLL_CLASS}::-webkit-scrollbar-thumb:hover { background: #e6c878; }
`

const HUD_CSS = `
${SCROLL_CSS}
#hud-panel {
  position: fixed; right: 8px; top: 200px;
  z-index: 10; font-family: sans-serif; display: flex; flex-direction: column; gap: 4px;
  width: ${HUD_PANEL_WIDTH}px;
}
/* Full 28-slot inventory (7 rows) is taller than the 4-row panel this was
   tuned for; on short viewports pull the panel up (never past the minimap,
   which ends at 140px) so the bottom tab rail stays on-screen. */
@media (max-height: 640px) {
  #hud-panel { top: 148px; }
}
.hud-tabs { display: flex; gap: 3px; }
.hud-tabs.bottom { margin-top: 1px; }
.hud-tabs.bottom .hud-tab:not(.logout) { flex: 0 0 44px; }
.hud-tabs.bottom .hud-tab.logout { flex: 1; }
.hud-tab {
  flex: 1; min-height: 44px; min-width: 44px;
  background: rgba(20, 16, 10, 0.82); border: 1px solid #5a4a30; border-radius: 6px;
  color: #c9b892; font-size: 20px; cursor: pointer;
  display: flex; align-items: center; justify-content: center; user-select: none;
}
.hud-tab.active { background: rgba(70, 58, 36, 0.92); color: #ffe066; border-color: #6a5636; }
.hud-tab.logout { color: #e0a05a; gap: 6px; font-size: 13px; font-family: sans-serif; font-weight: bold; }
.hud-tab svg, #run-orb svg { display: block; }
#run-orb .run-ico { display: flex; align-items: center; }
.hud-body {
  background: rgba(20, 16, 10, 0.82); border: 1px solid #5a4a30; border-radius: 8px; padding: 6px;
  height: ${HUD_BODY_H}px; box-sizing: border-box; overflow: hidden;
}
.hud-pane { display: none; height: 100%; overflow-y: auto; }
.hud-pane.active { display: block; }
/* visibility (not display:none) keeps .hud-body's fixed height reserved, so
   collapsing doesn't pull the bottom tab row up under the top one. */
.hud-body.collapsed { visibility: hidden; }
#inv-panel {
  display: grid; grid-template-columns: repeat(${INVENTORY_COLS}, ${INV_CELL_PX}px);
  grid-auto-rows: ${INV_CELL_PX}px; gap: ${INV_GAP_PX}px;
}
#equip-panel {
  display: grid; grid-template-columns: repeat(3, 40px); grid-auto-rows: 40px; gap: 3px;
  justify-content: center;
}
.equip-slot {
  background: rgba(60, 50, 34, 0.55); border-radius: 4px; position: relative;
  display: flex; align-items: center; justify-content: center; font-size: 9px; color: #7a6a4a;
  user-select: none; touch-action: none; text-align: center; cursor: pointer;
}
.equip-slot.filled { cursor: pointer; }
.equip-slot.empty-cell { background: transparent; cursor: default; }
#combat-panel { display: flex; flex-direction: column; gap: 6px; }
#prayer-panel { display: flex; flex-direction: column; gap: 6px; width: 100%; }
.stance-row { display: flex; gap: 3px; }
.stance-btn {
  flex: 1; min-height: 44px; border-radius: 6px; cursor: pointer; user-select: none;
  background: rgba(60, 50, 34, 0.55); border: 1px solid #5a4a30; color: #d8c9a2;
  font-size: 11px; display: flex; align-items: center; justify-content: center; text-align: center;
}
.stance-btn.active { background: rgba(70, 58, 36, 0.92); color: #ffe066; border-color: #ffe066; }
#spec-bar {
  position: relative; height: 22px; border-radius: 6px; overflow: hidden;
  background: rgba(60, 50, 34, 0.55); border: 1px solid #5a4a30;
}
#spec-bar > .fill { position: absolute; inset: 0 auto 0 0; background: #3f7fae; transition: width 0.2s; }
#spec-bar > .label {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: bold; color: #fff; text-shadow: 0 1px 2px #000;
}
#spec-btn {
  min-height: 44px; border-radius: 6px; cursor: pointer; user-select: none;
  background: rgba(70, 58, 36, 0.9); border: 1px solid #6a5636; color: #ffe066;
  font-size: 13px; font-weight: bold; display: flex; align-items: center; justify-content: center;
}
#spell-btn {
  min-height: 44px; border-radius: 6px; cursor: pointer; user-select: none;
  background: rgba(46, 52, 74, 0.9); border: 1px solid #4a5a8a; color: #9fc0ff;
  font-size: 13px; font-weight: bold; display: flex; align-items: center; justify-content: center;
}
#prayer-bar {
  position: relative; height: 22px; border-radius: 6px; overflow: hidden;
  background: rgba(60, 50, 34, 0.55); border: 1px solid #5a4a30;
}
#prayer-bar > .fill { position: absolute; inset: 0 auto 0 0; background: #c9a13a; transition: width 0.2s; }
#prayer-bar > .label {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: bold; color: #fff; text-shadow: 0 1px 2px #000;
}
#prayer-grid { display: flex; flex-direction: column; gap: 5px; max-height: 220px; overflow-y: auto; }
#prayer-grid:empty { display: none; }
/* Same fixed 4-column layout as #inv-panel, one grid per category row. */
.prayer-row { display: grid; grid-template-columns: repeat(${INVENTORY_COLS}, ${INV_CELL_PX}px); gap: ${INV_GAP_PX}px; }
.hud-sec {
  font-size: 10px; font-weight: bold; letter-spacing: 0.06em; text-transform: uppercase;
  color: #c9a13a; opacity: 0.85; padding: 2px 1px 0;
}
.prayer-btn {
  position: relative; width: 40px; height: 40px; border-radius: 6px; cursor: pointer; user-select: none;
  background: rgba(60, 50, 34, 0.55); border: 1px solid #5a4a30;
  display: flex; align-items: center; justify-content: center; font-size: 19px; line-height: 1;
}
.prayer-btn.active { background: rgba(70, 58, 36, 0.92); border-color: #ffe066; box-shadow: 0 0 0 1px #ffe066 inset; }
.prayer-btn__icon { display: flex; align-items: center; justify-content: center; }
.prayer-btn__icon svg { display: block; }
.prayer-lv {
  position: absolute; right: 2px; bottom: 1px; font-size: 9px; font-weight: bold; line-height: 1;
  color: #f4e9c8; text-shadow: 0 1px 2px #000, 0 0 2px #000; font-family: sans-serif; pointer-events: none;
}
#magic-panel { max-height: 340px; overflow-y: auto; display: flex; flex-direction: column; gap: 5px; }
.tp-list { display: grid; grid-template-columns: 1fr 1fr; gap: 3px; }
.tp-row {
  min-height: 40px; padding: 8px 12px; border: 1px solid #5a4a30; border-radius: 6px; cursor: pointer;
  text-align: left; background: rgba(60, 50, 34, 0.55); color: #f4e9c8; font-size: 13px; font-family: sans-serif;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.tp-row:hover { background: rgba(80, 66, 42, 0.75); }
.spell-grid { display: flex; flex-wrap: wrap; gap: 4px; }
.spell-ico {
  width: 40px; height: 40px; padding: 0; border-radius: 6px; cursor: pointer; user-select: none;
  background: rgba(60, 50, 34, 0.55); border: 1px solid #5a4a30;
  display: flex; align-items: center; justify-content: center; font-size: 20px; line-height: 1;
}
.spell-ico.active { background: rgba(70, 58, 36, 0.92); border-color: #ffe066; box-shadow: 0 0 0 1px #ffe066 inset; }
.spell-ico.locked { opacity: 0.32; cursor: default; }
.spell-ico svg { display: block; }
#run-orb {
  position: fixed; right: 148px; top: 52px; z-index: 10; min-width: 44px; min-height: 44px;
  padding: 4px 8px; background: rgba(20, 16, 10, 0.82); border: 1px solid #5a4a30; border-radius: 22px;
  font-family: sans-serif; font-size: 12px; font-weight: bold; color: #c9b892; cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 3px; user-select: none;
}
#run-orb.running { color: #ffe066; border-color: #ffe066; background: rgba(70, 58, 36, 0.92); }
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
#boss-frame {
  position: fixed; left: 50%; top: 12px; transform: translateX(-50%); z-index: 10;
  width: min(360px, 70vw); font-family: sans-serif; pointer-events: none;
  background: rgba(20, 16, 10, 0.82); border: 1px solid #6a3030; border-radius: 8px;
  padding: 6px 10px; display: none;
}
#boss-frame.visible { display: block; }
#boss-frame .name { font-size: 13px; font-weight: bold; color: #ffd7d7; text-shadow: 0 1px 2px #000; margin-bottom: 3px; }
#boss-frame .bar { position: relative; height: 14px; border-radius: 4px; overflow: hidden; background: rgba(60, 20, 20, 0.6); }
#boss-frame .bar > .fill { position: absolute; inset: 0 auto 0 0; background: #c94a4a; transition: width 0.2s; }
#boss-frame .threat { margin-top: 5px; display: flex; flex-direction: column; gap: 2px; }
#boss-frame .threat-row { display: flex; justify-content: space-between; font-size: 10px; color: #d8c9a2; }
#boss-frame .threat-row.self { color: #ffe066; font-weight: bold; }
#unique-banner {
  position: fixed; left: 50%; top: 90px; transform: translateX(-50%); z-index: 12;
  font-family: sans-serif; font-size: 14px; font-weight: bold; color: #ffe066;
  background: rgba(40, 30, 10, 0.9); border: 1px solid #ffe066; border-radius: 8px;
  padding: 8px 14px; text-shadow: 0 1px 2px #000; pointer-events: none; text-align: center;
  opacity: 0; transition: opacity 0.3s;
}
#unique-banner.visible { opacity: 1; }
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
  position: fixed; right: 148px; top: 8px; z-index: 10; padding: 4px 10px;
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

export type HudHandlers = InvHandlers & {
  onRunToggle: () => void
  onStance: (stance: CombatStance) => void
  /** Tap on the spell button (magic weapons) — opens the spell picker at (x,y). */
  onSpellMenu: (x: number, y: number) => void
  onSpecial: () => void
  onUnequip: (slot: string) => void
  onWorldMap: () => void
  onLogout: () => void
}

export type SpellbookEntry = { id: string; name: string; level: number }
export type TeleportEntry = { id: string; label: string }

export type SpellbookRender = {
  teleports: TeleportEntry[]
  combat: SpellbookEntry[]
  skill: SpellbookEntry[]
  magicLevel: number
  selectedSpellId: string | null
  onTeleport: (placeId: string) => void
  onCombat: (id: string) => void
  onSkill: (id: string) => void
}

// Paperdoll layout for the Equipment tab (3 columns). null = spacer cell.
const EQUIP_LAYOUT: (string | null)[] = [
  null, 'head', null,
  'cape', 'neck', 'ammo',
  'weapon', 'body', 'shield',
  null, 'legs', null,
  'hands', 'feet', 'ring',
]
const EQUIP_SLOT_LABEL: Record<string, string> = {
  head: 'Head', cape: 'Cape', neck: 'Neck', ammo: 'Ammo', weapon: 'Weapon',
  body: 'Body', shield: 'Shield', legs: 'Legs', hands: 'Hands', feet: 'Feet', ring: 'Ring',
}
const STANCES: { stance: CombatStance; label: string }[] = [
  { stance: 'accurate', label: 'Accurate' },
  { stance: 'aggressive', label: 'Aggressive' },
  { stance: 'defensive', label: 'Defensive' },
]

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

// PocketRPG's own bespoke nav icons (src/data/bespokeIcons.json), matching the
// main game's tab bar; painted by paintHudIcons() once the icon data loads.
// Equipment lives in the bottom row (see bottomTabs in initHud) to free up
// space in this rail — its pane switching still goes through selectTab, which
// queries .hud-tab[data-tab] globally, not by container.
const TABS: { id: string; iconKey: string; title: string }[] = [
  { id: 'inventory', iconKey: 'backpack', title: 'Inventory' },
  { id: 'combat', iconKey: 'combat_level', title: 'Combat' },
  { id: 'prayer', iconKey: 'prayer', title: 'Prayer' },
  { id: 'magic', iconKey: 'magic_staff', title: 'Magic' },
]
const LOGOUT_COLOR = '#e0a05a'
const HUD_TAB_ICON_PX = 26
const RUN_ICON_PX = 20

function selectTab(id: string): void {
  document.querySelector('.hud-body')?.classList.remove('collapsed')
  for (const tab of document.querySelectorAll('.hud-tab[data-tab]')) {
    tab.classList.toggle('active', tab.getAttribute('data-tab') === id)
  }
  for (const pane of document.querySelectorAll('.hud-pane')) {
    pane.classList.toggle('active', pane.getAttribute('data-pane') === id)
  }
}

/** Tapping the already-active tab collapses the HUD body (saves screen space);
 * tapping it again — or picking a different tab — reopens it. The tab rail
 * itself always stays visible so the panel can be reopened. */
function tabClicked(id: string): void {
  const activeTab = document.querySelector('.hud-tab[data-tab].active')
  const body = document.querySelector('.hud-body')
  if (activeTab?.getAttribute('data-tab') === id && !body?.classList.contains('collapsed')) {
    body?.classList.add('collapsed')
    return
  }
  selectTab(id)
}

const F_KEY_TAB: Record<string, string> = {
  F1: 'inventory', F2: 'equipment', F3: 'prayer', F4: 'magic', F5: 'combat',
}

/** Pure: which HUD tab (if any) an F1–F5 keydown selects. Exported for tests. */
export function keyToHudTab(key: string): string | null {
  return F_KEY_TAB[key] ?? null
}

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

/** Closer registered by a modal/menu owner (bank, crafting, world map, the
 * context menu…). Returns true if it closed something (consumes the Escape),
 * false if it had nothing open (falls through to the next priority). Lower
 * `priority` runs first — see each registerEscapeHandler call site for the
 * ordering (1 = bank qty prompt, 2 = context menu, 3 = bank/craft/world-map). */
export type EscapeHandler = () => boolean
type PriorityHandler = { priority: number; handler: EscapeHandler }
const escapeHandlers: PriorityHandler[] = []

/** Lets modal owners outside ui.ts (bank/crafting/world-map, which ui.ts
 * can't import without a circular dependency) plug into the single global
 * Escape key. Each Escape press runs handlers in priority order and stops at
 * the first one that reports it closed something. */
export function registerEscapeHandler(priority: number, handler: EscapeHandler): void {
  escapeHandlers.push({ priority, handler })
}

/** Pure priority-routing core: runs `handlers` lowest-priority-first,
 * stopping at the first that reports it closed something. Exported (and
 * kept separate from the live singleton registry above) so the routing
 * itself is directly testable without touching real DOM-backed handlers. */
export function runEscapeHandlers(handlers: PriorityHandler[]): boolean {
  for (const { handler } of [...handlers].sort((a, b) => a.priority - b.priority)) {
    if (handler()) return true
  }
  return false
}

function dispatchEscape(): boolean {
  return runEscapeHandlers(escapeHandlers)
}

function onGlobalKeyDown(e: KeyboardEvent): void {
  if (isEditableTarget(e.target)) return
  if (e.key === 'Escape') {
    if (dispatchEscape()) e.preventDefault()
    return
  }
  const tab = keyToHudTab(e.key)
  if (tab) {
    e.preventDefault()
    selectTab(tab)
  }
}

/** Builds the tabbed HUD panel (Inventory / Equipment / Combat + Logout), the run
 * orb, message strip, xp-drop layer and HP pill. Call once after welcome. */
export function initHud(handlers?: HudHandlers): void {
  if (hudReady) return
  hudReady = true
  const style = document.createElement('style')
  style.textContent = HUD_CSS
  document.head.appendChild(style)

  const panel = document.createElement('div')
  panel.id = 'hud-panel'

  const tabs = document.createElement('div')
  tabs.className = 'hud-tabs'
  for (const tab of TABS) {
    const btn = document.createElement('div')
    btn.className = 'hud-tab' + (tab.id === 'inventory' ? ' active' : '')
    btn.setAttribute('data-tab', tab.id)
    btn.setAttribute('data-icon', tab.iconKey)
    btn.setAttribute('data-icon-size', String(HUD_TAB_ICON_PX))
    btn.title = tab.title
    btn.addEventListener('click', () => tabClicked(tab.id))
    tabs.appendChild(btn)
  }
  panel.appendChild(tabs)

  const body = document.createElement('div')
  body.className = 'hud-body'

  const invPane = document.createElement('div')
  invPane.className = 'hud-pane active'
  invPane.setAttribute('data-pane', 'inventory')
  const inv = document.createElement('div')
  inv.id = 'inv-panel'
  for (let i = 0; i < INVENTORY_COLS * INVENTORY_ROWS; i++) {
    const slot = document.createElement('div')
    slot.className = 'inv-slot'
    inv.appendChild(slot)
  }
  invPane.appendChild(inv)
  body.appendChild(invPane)

  const equipPane = document.createElement('div')
  equipPane.className = 'hud-pane'
  equipPane.setAttribute('data-pane', 'equipment')
  const equip = document.createElement('div')
  equip.id = 'equip-panel'
  for (const slotId of EQUIP_LAYOUT) {
    const cell = document.createElement('div')
    if (slotId === null) {
      cell.className = 'equip-slot empty-cell'
    } else {
      cell.className = 'equip-slot'
      cell.setAttribute('data-slot', slotId)
      cell.textContent = EQUIP_SLOT_LABEL[slotId] ?? slotId
      cell.addEventListener('click', () => {
        if (cell.classList.contains('filled')) handlers?.onUnequip(slotId)
      })
    }
    equip.appendChild(cell)
  }
  equipPane.appendChild(equip)
  body.appendChild(equipPane)

  const combatPane = document.createElement('div')
  combatPane.className = 'hud-pane'
  combatPane.setAttribute('data-pane', 'combat')
  const combat = document.createElement('div')
  combat.id = 'combat-panel'
  const stanceRow = document.createElement('div')
  stanceRow.className = 'stance-row'
  for (const s of STANCES) {
    const btn = document.createElement('div')
    btn.className = 'stance-btn' + (s.stance === 'accurate' ? ' active' : '')
    btn.setAttribute('data-stance', s.stance)
    btn.textContent = s.label
    btn.addEventListener('click', () => handlers?.onStance(s.stance))
    stanceRow.appendChild(btn)
  }
  combat.appendChild(stanceRow)
  // Spell selector — hidden unless a magic weapon (staff/wand) is equipped;
  // main.ts toggles it via setSpellButton().
  const spellBtn = document.createElement('div')
  spellBtn.id = 'spell-btn'
  spellBtn.textContent = 'Spell: none'
  spellBtn.style.display = 'none'
  spellBtn.addEventListener('click', (e) => handlers?.onSpellMenu(e.clientX, e.clientY))
  combat.appendChild(spellBtn)
  const specBar = document.createElement('div')
  specBar.id = 'spec-bar'
  const specFill = document.createElement('div')
  specFill.className = 'fill'
  specFill.style.width = '100%'
  const specLabel = document.createElement('div')
  specLabel.className = 'label'
  specLabel.textContent = 'Special 100%'
  specBar.appendChild(specFill)
  specBar.appendChild(specLabel)
  combat.appendChild(specBar)
  const specBtn = document.createElement('div')
  specBtn.id = 'spec-btn'
  specBtn.textContent = '⚡ Special Attack'
  specBtn.addEventListener('click', () => handlers?.onSpecial())
  combat.appendChild(specBtn)
  combatPane.appendChild(combat)
  body.appendChild(combatPane)

  // Prayer has its own tab (moved off the Combat tab, 2026-07): the pool bar
  // + Protection/Combat toggle grid, built by renderPrayerPanel/setPrayerState.
  const prayerPane = document.createElement('div')
  prayerPane.className = 'hud-pane'
  prayerPane.setAttribute('data-pane', 'prayer')
  const prayer = document.createElement('div')
  prayer.id = 'prayer-panel'
  const prayerBar = document.createElement('div')
  prayerBar.id = 'prayer-bar'
  const prayerFill = document.createElement('div')
  prayerFill.className = 'fill'
  prayerFill.style.width = '100%'
  const prayerLabel = document.createElement('div')
  prayerLabel.className = 'label'
  prayerLabel.textContent = ''
  prayerBar.appendChild(prayerFill)
  prayerBar.appendChild(prayerLabel)
  prayer.appendChild(prayerBar)
  const prayerGrid = document.createElement('div')
  prayerGrid.id = 'prayer-grid'
  prayerGrid.className = SCROLL_CLASS
  prayer.appendChild(prayerGrid)
  prayerPane.appendChild(prayer)
  body.appendChild(prayerPane)

  const magicPane = document.createElement('div')
  magicPane.className = 'hud-pane'
  magicPane.setAttribute('data-pane', 'magic')
  const magic = document.createElement('div')
  magic.id = 'magic-panel'
  magic.className = SCROLL_CLASS
  magicPane.appendChild(magic)
  body.appendChild(magicPane)

  panel.appendChild(body)

  // Bottom row: Equipment (moved off the top rail to free it up) + World Map
  // (an action, not a pane — no data-tab, so selectTab never touches it) +
  // Logout, which flex-fills the remaining width.
  const bottomTabs = document.createElement('div')
  bottomTabs.className = 'hud-tabs bottom'

  const equipTab = document.createElement('div')
  equipTab.className = 'hud-tab'
  equipTab.setAttribute('data-tab', 'equipment')
  equipTab.setAttribute('data-icon', 'paperdoll')
  equipTab.setAttribute('data-icon-size', String(HUD_TAB_ICON_PX))
  equipTab.title = 'Equipment'
  equipTab.addEventListener('click', () => tabClicked('equipment'))
  bottomTabs.appendChild(equipTab)

  const worldMapTab = document.createElement('div')
  worldMapTab.className = 'hud-tab'
  worldMapTab.setAttribute('data-icon', 'globe')
  worldMapTab.setAttribute('data-icon-size', String(HUD_TAB_ICON_PX))
  worldMapTab.title = 'World Map'
  worldMapTab.addEventListener('click', () => handlers?.onWorldMap())
  bottomTabs.appendChild(worldMapTab)

  const logout = document.createElement('div')
  logout.className = 'hud-tab logout'
  logout.title = 'Logout'
  const logoutIco = document.createElement('span')
  logoutIco.setAttribute('data-icon', 'door')
  logoutIco.setAttribute('data-icon-size', String(HUD_TAB_ICON_PX))
  logoutIco.setAttribute('data-icon-color', LOGOUT_COLOR)
  const logoutLabel = document.createElement('span')
  logoutLabel.textContent = 'Logout'
  logout.appendChild(logoutIco)
  logout.appendChild(logoutLabel)
  logout.addEventListener('click', () => handlers?.onLogout())
  bottomTabs.appendChild(logout)
  panel.appendChild(bottomTabs)

  document.body.appendChild(panel)
  if (handlers) setupInvDrag(inv, handlers)

  const runOrb = document.createElement('div')
  runOrb.id = 'run-orb'
  runOrb.title = 'Toggle run'
  const runIco = document.createElement('span')
  runIco.className = 'run-ico'
  runIco.setAttribute('data-icon', 'sprint')
  runIco.setAttribute('data-icon-size', String(RUN_ICON_PX))
  const runPct = document.createElement('span')
  runPct.className = 'run-pct'
  runPct.textContent = '100%'
  runOrb.appendChild(runIco)
  runOrb.appendChild(runPct)
  runOrb.addEventListener('click', () => handlers?.onRunToggle())
  document.body.appendChild(runOrb)

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

  const bossFrame = document.createElement('div')
  bossFrame.id = 'boss-frame'
  const bossName = document.createElement('div')
  bossName.className = 'name'
  const bossBar = document.createElement('div')
  bossBar.className = 'bar'
  const bossBarFill = document.createElement('div')
  bossBarFill.className = 'fill'
  bossBarFill.style.width = '100%'
  bossBar.appendChild(bossBarFill)
  const bossThreat = document.createElement('div')
  bossThreat.className = 'threat'
  bossFrame.appendChild(bossName)
  bossFrame.appendChild(bossBar)
  bossFrame.appendChild(bossThreat)
  document.body.appendChild(bossFrame)

  const uniqueBanner = document.createElement('div')
  uniqueBanner.id = 'unique-banner'
  document.body.appendChild(uniqueBanner)

  window.addEventListener('keydown', onGlobalKeyDown)
}

/** Renders worn equipment into the Equipment tab; empty slots show their label. */
export function renderEquipment(equipment: EquipmentMap): void {
  const panel = document.getElementById('equip-panel')
  if (!panel) return
  for (const cell of panel.querySelectorAll<HTMLElement>('.equip-slot[data-slot]')) {
    const slotId = cell.getAttribute('data-slot')!
    const itemId = equipment[slotId]
    cell.innerHTML = ''
    if (itemId) {
      cell.classList.add('filled')
      cell.innerHTML = iconMarkup(itemId, 32)
      cell.title = `Remove ${itemName(itemId)}`
    } else {
      cell.classList.remove('filled')
      cell.textContent = EQUIP_SLOT_LABEL[slotId] ?? slotId
      cell.title = ''
    }
  }
}

/** Swaps the Combat tab between melee stances and the spell selector: a magic
 * weapon REPLACES Accurate/Aggressive/Defensive with the spell button (developer
 * decision 2026-07-12); anything else shows the stances and hides the button. */
export function setSpellButton(visible: boolean, spellName: string | null): void {
  const btn = document.getElementById('spell-btn')
  const stanceRow = document.querySelector<HTMLElement>('.stance-row')
  if (!btn) return
  btn.style.display = visible ? 'flex' : 'none'
  if (stanceRow) stanceRow.style.display = visible ? 'none' : 'flex'
  btn.textContent = `Spell: ${spellName ?? 'none'}`
}

/** Fills the Magic tab with two sections: Teleport (the overworld's place
 * centres — tapping one teleports there) and Combat (the autocast spellbook as
 * an icon grid, each icon's colour = element and silhouette = tier; tap to
 * select as the autocast spell, then tap a monster). Combat icons above the
 * player's Magic level render locked. The Teleport section is omitted when the
 * zone ships no landmarks (per-zone maps). Skill spells stay hidden for now
 * (`data.skill` unused). Called on welcome and whenever selection, Magic level,
 * or landmarks change. */
export function renderSpellbook(data: SpellbookRender): void {
  const panel = document.getElementById('magic-panel')
  if (!panel) return
  panel.innerHTML = ''

  if (data.teleports.length) {
    const label = document.createElement('div')
    label.className = 'hud-sec'
    label.textContent = 'Teleport'
    panel.appendChild(label)
    const tpList = document.createElement('div')
    tpList.className = 'tp-list'
    for (const tp of [...data.teleports].sort((a, b) => a.label.localeCompare(b.label))) {
      const row = document.createElement('button')
      row.type = 'button'
      row.className = 'tp-row'
      row.textContent = tp.label
      row.title = `Teleport to ${tp.label}`
      row.addEventListener('click', () => data.onTeleport(tp.id))
      tpList.appendChild(row)
    }
    panel.appendChild(tpList)
  }

  const combatLabel = document.createElement('div')
  combatLabel.className = 'hud-sec'
  combatLabel.textContent = 'Combat'
  panel.appendChild(combatLabel)
  const grid = document.createElement('div')
  grid.className = 'spell-grid'
  for (const entry of data.combat) {
    const locked = entry.level > data.magicLevel
    const selected = entry.id === data.selectedSpellId
    const cell = document.createElement('button')
    cell.type = 'button'
    cell.className = 'spell-ico' + (selected ? ' active' : '') + (locked ? ' locked' : '')
    cell.title = `${entry.name} (Lv ${entry.level})`
    cell.innerHTML = spellIconSvg(entry.id, 30) || '🔮'
    if (!locked) cell.addEventListener('click', () => data.onCombat(entry.id))
    grid.appendChild(cell)
  }
  panel.appendChild(grid)
}

export function setStanceActive(stance: CombatStance): void {
  for (const btn of document.querySelectorAll('.stance-btn')) {
    btn.classList.toggle('active', btn.getAttribute('data-stance') === stance)
  }
}

export function setRunState(energy: number, running: boolean): void {
  const orb = document.getElementById('run-orb')
  if (!orb) return
  const pct = orb.querySelector('.run-pct')
  if (pct) pct.textContent = `${Math.round(energy)}%`
  orb.classList.toggle('running', running)
}

/** Paints the bespoke SVG art into every HUD icon slot (tabs, logout, run orb).
 * Call once the icon data has loaded (loadItemIcons) — the elements carry their
 * key/size/colour in data-attributes so this can run after they're built. */
export function paintHudIcons(): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-icon]')) {
    const key = el.getAttribute('data-icon')!
    const size = Number(el.getAttribute('data-icon-size')) || 24
    const color = el.getAttribute('data-icon-color') ?? 'currentColor'
    const markup = uiIconMarkup(key, size, color)
    if (markup) el.innerHTML = markup
  }
}

export function setSpecialEnergy(energy: number): void {
  const bar = document.getElementById('spec-bar')
  if (!bar) return
  const pct = Math.max(0, Math.min(100, Math.round(energy)))
  ;(bar.querySelector('.fill') as HTMLElement | null)?.style.setProperty('width', `${pct}%`)
  const label = bar.querySelector('.label') as HTMLElement | null
  if (label) label.textContent = `Special ${pct}%`
}

/** Builds the Combat-tab prayer toggles, split into Protection and Combat
 * sections and each drawn with its correct icon (damage type blocked / stat
 * boosted). Only prayers the player's Prayer level unlocks appear; an empty
 * section drops its header. Idempotent — rebuilds on each welcome/resync. */
export function renderPrayerPanel(prayerLevel: number, onPray: (prayerId: string) => void): void {
  const grid = document.getElementById('prayer-grid')
  if (!grid) return
  grid.innerHTML = ''
  const { protection, combat } = categorisePrayers(prayerLevel)
  const section = (heading: string, prayers: PrayerView[]): void => {
    if (!prayers.length) return
    const label = document.createElement('div')
    label.className = 'hud-sec'
    label.textContent = heading
    grid.appendChild(label)
    const row = document.createElement('div')
    row.className = 'prayer-row'
    for (const p of prayers) {
      const btn = document.createElement('div')
      btn.className = 'prayer-btn'
      btn.setAttribute('data-prayer', p.id)
      const art = p.skill ? PRAYER_SKILL_ICON[p.skill] : undefined
      const icon = document.createElement('span')
      icon.className = 'prayer-btn__icon'
      icon.innerHTML = (art && uiIconMarkup(art.icon, 24, art.accent)) || '🙏'
      const lv = document.createElement('span')
      lv.className = 'prayer-lv'
      lv.textContent = String(p.level)
      btn.appendChild(icon)
      btn.appendChild(lv)
      btn.title = `${p.name} (Lv ${p.level})`
      btn.addEventListener('click', () => onPray(p.id))
      row.appendChild(btn)
    }
    grid.appendChild(row)
  }
  section('Protection', protection)
  section('Combat', combat)
}

/** Updates the prayer pool bar + which toggle buttons read as active. */
export function setPrayerState(points: number, max: number, protection: string | null, combat: string | null): void {
  const bar = document.getElementById('prayer-bar')
  if (bar) {
    const pct = max > 0 ? Math.max(0, Math.min(100, (points / max) * 100)) : 0
    ;(bar.querySelector('.fill') as HTMLElement | null)?.style.setProperty('width', `${pct}%`)
    const label = bar.querySelector('.label') as HTMLElement | null
    if (label) label.textContent = `${Math.ceil(points)}/${max}`
  }
  for (const btn of document.querySelectorAll<HTMLElement>('.prayer-btn')) {
    const id = btn.getAttribute('data-prayer')
    btn.classList.toggle('active', id === protection || id === combat)
  }
}

const NPC_EXAMINE: Record<string, string> = {
  pasture_bull: 'A hefty highland bull. Prime cowhide on the hoof.',
  field_chicken: 'A plump forest fowl. Braver than it looks, which is not very.',
  cave_goblin: 'A wiry little menace, a long way from any cave.',
  arcane_adept: 'A robed student of the arcane, practising where the trees can’t complain.',
  bogling_sprite: 'A wobbling dollop of bog-magic. Mostly harmless, entirely gelatinous.',
  frostbite_imp: 'A small blue troublemaker radiating a distinctly unfriendly chill.',
  marshfen_toad: 'A toad the size of a dog. The marsh smell arrives before it does.',
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
    const nameColor = row.targetKind === 'npc' || row.targetKind === 'object' || row.targetKind === 'player' ? NAME_CYAN : undefined
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

// Priority 2: the right-click/long-press context menu, above the bank/craft/
// world-map modals (priority 3) but below the bank qty prompt (priority 1).
registerEscapeHandler(2, () => {
  if (!document.getElementById('ctx-menu')) return false
  hideContextMenu()
  return true
})

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

const UNIQUE_BANNER_MS = 5000

/** Zone-wide kill feed line (item 11) — reuses the message strip. */
export function pushKillFeed(monster: string, killer: string): void {
  pushMessage(`⚔ ${killer} has defeated ${monster}!`)
}

/** Prominent zone-wide banner for a boss unique drop (item 11). */
export function showUniqueBanner(monster: string, player: string, item: string): void {
  const el = document.getElementById('unique-banner')
  if (!el) return
  el.textContent = `✨ ${player} received ${item} from ${monster}!`
  el.classList.add('visible')
  window.clearTimeout(Number(el.dataset.timer) || undefined)
  const timer = window.setTimeout(() => el.classList.remove('visible'), UNIQUE_BANNER_MS)
  el.dataset.timer = String(timer)
}

/** Boss HP frame (item 11): a dedicated top-of-screen readout for the player's
 * current boss target, distinct from the small overhead HP bar. */
export function showBossFrame(name: string, hp: number, maxHp: number): void {
  const el = document.getElementById('boss-frame')
  if (!el) return
  el.classList.add('visible')
  const nameEl = el.querySelector<HTMLElement>('.name')
  if (nameEl) nameEl.textContent = `${name} — ${Math.max(0, hp)}/${maxHp}`
  const pct = maxHp > 0 ? Math.max(0, Math.min(100, (hp / maxHp) * 100)) : 0
  ;(el.querySelector('.bar > .fill') as HTMLElement | null)?.style.setProperty('width', `${pct}%`)
}

export function hideBossFrame(): void {
  document.getElementById('boss-frame')?.classList.remove('visible')
}

/** Damage-contribution rows under the boss frame — makes the top-damage loot
 * rule legible mid-fight (item 11). Empty list clears the panel (fight just
 * started, no damage recorded yet). */
export function setThreatPanel(contributors: { charId: string; name: string; dmg: number }[], selfCharId: string): void {
  const el = document.querySelector<HTMLElement>('#boss-frame .threat')
  if (!el) return
  el.innerHTML = ''
  const total = contributors.reduce((sum, c) => sum + c.dmg, 0)
  for (const c of contributors) {
    const row = document.createElement('div')
    row.className = 'threat-row' + (c.charId === selfCharId ? ' self' : '')
    const pct = total > 0 ? Math.round((c.dmg / total) * 100) : 0
    row.innerHTML = `<span>${c.name}</span><span>${pct}%</span>`
    el.appendChild(row)
  }
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
