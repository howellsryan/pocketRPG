import type { CombatStance, EquipmentMap, InvSlot } from '../../shared/protocol'
import type { MenuRow } from './picking'
import { iconMarkup, itemName, uiIconMarkup } from './itemIcon'
import { spellIconSvg } from './spellIcon'
import { categorisePrayers, type PrayerView } from '../../shared/prayer'
import {
  hudScaleValue, isTabletViewport, loadSettings, resolveMinimapMode, saveSettings,
  sheetHeightFor, sheetSnap, type MinimapMode, type UxSettings,
} from './uxSettings'

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

// Prayer/spell/equip panes keep a fixed 40px cell grid; inventory reflows its
// columns responsively (7 wide in the portrait sheet, 4 in the landscape
// slide-out) via CSS keyed off the orientation attribute, so it needs no fixed
// width. INVENTORY_ROWS only sizes the 28-slot build loop now.
const INVENTORY_COLS = 4
const INVENTORY_ROWS = 7
const INV_CELL_PX = 40
const INV_GAP_PX = 3
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

// Layout is driven by attributes on <html> (set by applyLayout): data-hud-orient
// (portrait|landscape), data-hud-dock (left|right), data-hud-hidden ("1" when the
// eye is toggling everything off), data-minimap (full|compass|off), data-hud-sheet
// (open|closed). This keeps the reflow in CSS — one attribute flip repositions
// every element instantly, with no per-element JS branching.
const HUD_CSS = `
${SCROLL_CSS}
:root { --hud-pop: 0.92; }
#world-hud, #world-hud * { box-sizing: border-box; }
/* Everything the eye hides, in one bucket. The eye button, overlays (settings,
   world map, context menu) and the top-centre band (boss frame, banners) sit
   outside it and survive HUD-hide. */
:root[data-hud-hidden="1"] .hud-hideable { display: none !important; }

/* ---- vitals orbs ---- */
#hud-vitals {
  position: fixed; z-index: 11; display: flex; gap: 7px; align-items: flex-start;
  font-family: sans-serif;
}
.hud-orb { position: relative; cursor: pointer; flex: none; }
.hud-orb svg { display: block; transform: rotate(-90deg); }
.hud-orb .orb-in {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; line-height: 1; pointer-events: none;
}
.hud-orb .orb-v { font-weight: 800; text-shadow: 0 1px 2px #000; font-variant-numeric: tabular-nums; }
.hud-orb .orb-l { font-size: 7px; font-weight: 800; letter-spacing: 0.1em; color: #c9b892; margin-top: 1px; }
.hud-orb.low { filter: drop-shadow(0 0 6px rgba(226, 59, 59, 0.7)); }

/* ---- eye (HUD hide/show) + compass ---- */
#hud-eye, #hud-compass {
  position: fixed; z-index: 13; cursor: pointer; flex: none;
  display: flex; align-items: center; justify-content: center;
  background: rgba(20, 16, 10, 0.82); border: 1.5px solid #6a5636; color: #c9b892;
}
#hud-eye { width: 44px; height: 44px; border-radius: 12px; }
:root[data-hud-hidden="1"] #hud-eye { color: #ffe066; background: rgba(20, 16, 10, 0.6); }
#hud-compass { border-radius: 999px; color: #ffe066; }
#hud-eye svg, #hud-compass svg { display: block; }
:root:not([data-minimap="compass"]) #hud-compass { display: none; }

/* ---- tab rails (portrait bottom / landscape edge) ---- */
.hud-tab {
  min-height: 44px; min-width: 44px; flex: none;
  background: rgba(20, 16, 10, 0.82); border: 1px solid #5a4a30; border-radius: 8px;
  color: #c9b892; cursor: pointer;
  display: flex; align-items: center; justify-content: center; user-select: none;
}
.hud-tab svg, #hud-eye svg { display: block; }
.hud-tab.active { background: rgba(70, 58, 36, 0.92); color: #ffe066; border-color: #6a5636; }
#hud-rail-p, #hud-rail-l { position: fixed; z-index: 12; display: flex; }
/* portrait: thumb rail across the bottom */
#hud-rail-p {
  left: 0; right: 0; bottom: 0; gap: 6px; align-items: center;
  padding: 8px 10px calc(8px + env(safe-area-inset-bottom, 0px));
  overflow-x: auto; background: rgba(20, 16, 10, 0.72); backdrop-filter: blur(5px);
  border-top: 1px solid #4a3d26;
}
#hud-rail-p .rail-spacer { flex: 1; }
#hud-rail-p .rail-div { width: 1px; height: 28px; background: #4a3d26; flex: none; margin: 0 2px; }
/* landscape: slim edge rail on the dock side */
#hud-rail-l {
  top: 0; bottom: 0; width: 58px; flex-direction: column; align-items: center; gap: 7px;
  padding: 60px 0 calc(12px + env(safe-area-inset-bottom, 0px));
  background: rgba(16, 13, 8, 0.6); backdrop-filter: blur(5px);
}
#hud-rail-l .rail-spacer { flex: 1; }

/* ---- placement + orientation gating (only the matching rail shows; vitals,
   eye and compass anchor to the corner opposite the landscape dock) ---- */
:root[data-hud-orient="portrait"] #hud-rail-l,
:root[data-hud-orient="landscape"] #hud-rail-p { display: none; }
:root[data-hud-orient="landscape"][data-hud-dock="right"] #hud-rail-l { right: 0; }
:root[data-hud-orient="landscape"][data-hud-dock="left"] #hud-rail-l { left: 0; }

:root[data-hud-orient="portrait"] #hud-vitals { top: 44px; left: 8px; }
:root[data-hud-orient="landscape"] #hud-vitals { top: 12px; }
:root[data-hud-orient="landscape"][data-hud-dock="right"] #hud-vitals { left: 12px; }
:root[data-hud-orient="landscape"][data-hud-dock="left"] #hud-vitals { right: 12px; }

:root[data-hud-orient="portrait"] #hud-eye { top: 44px; right: 8px; }
:root[data-hud-orient="landscape"] #hud-eye { top: 10px; }
:root[data-hud-orient="landscape"][data-hud-dock="right"] #hud-eye { right: 7px; }
:root[data-hud-orient="landscape"][data-hud-dock="left"] #hud-eye { left: 7px; }

:root[data-hud-orient="portrait"] #hud-compass { top: 96px; right: 8px; }
:root[data-hud-orient="landscape"][data-hud-dock="right"] #hud-compass { top: 74px; left: 12px; }
:root[data-hud-orient="landscape"][data-hud-dock="left"] #hud-compass { top: 74px; right: 12px; }

/* ---- panel body: portrait bottom sheet / landscape slide-out ---- */
#hud-body {
  position: fixed; z-index: 11; font-family: sans-serif;
  background: rgba(26, 21, 13, var(--hud-pop)); backdrop-filter: blur(6px);
  border: 1px solid #5a4a30; overflow-y: auto;
}
:root[data-hud-sheet="closed"] #hud-body { display: none; }
.hud-sheet-handle { display: none; }
.hud-pane { display: none; }
.hud-pane.active { display: block; }

/* portrait: sheet docks above the bottom rail, drag handle at the top */
:root[data-hud-orient="portrait"] #hud-body {
  left: 0; right: 0; bottom: 64px; border-radius: 16px 16px 0 0;
  border-left: none; border-right: none; border-bottom: none;
  padding: 0 12px 10px; box-shadow: 0 -6px 22px rgba(0, 0, 0, 0.35);
}
:root[data-hud-orient="portrait"] .hud-sheet-handle {
  display: flex; justify-content: center; padding: 9px 0 6px; cursor: grab;
  touch-action: none; position: sticky; top: 0;
  background: rgba(26, 21, 13, var(--hud-pop));
}
:root[data-hud-orient="portrait"] .hud-sheet-handle span {
  width: 44px; height: 5px; border-radius: 999px; background: #6a5a3a;
}
/* landscape: slide-out beside the rail, full height, no handle */
:root[data-hud-orient="landscape"] #hud-body {
  top: 0; bottom: 0; width: 300px; padding: 12px 12px 14px;
}
:root[data-hud-orient="landscape"][data-hud-dock="right"] #hud-body { right: 58px; border-right: none; }
:root[data-hud-orient="landscape"][data-hud-dock="left"] #hud-body { left: 58px; border-left: none; }
.hud-pane-head { display: none; }
:root[data-hud-orient="landscape"] .hud-pane-head {
  display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;
}
.hud-pane-head b { color: #ffe066; font-weight: 800; font-size: 14px; text-transform: capitalize; }
.hud-pane-head button { background: none; border: none; color: #a5a284; cursor: pointer; padding: 4px; }
.hud-pane-head button svg { display: block; }

/* ---- minimap positioning (minimap.ts owns #minimap; these override its
   default top-right anchor so it sits opposite the landscape rail and clears
   the portrait eye). Higher specificity than minimap.ts's #minimap rule. ---- */
:root[data-hud-orient="portrait"] #minimap { top: 96px; right: 8px; left: auto; }
:root[data-hud-orient="landscape"][data-hud-dock="right"] #minimap { top: 74px; left: 12px; right: auto; }
:root[data-hud-orient="landscape"][data-hud-dock="left"] #minimap { top: 74px; right: 12px; left: auto; }
:root:not([data-minimap="full"]) #minimap { display: none; }
:root[data-hud-hidden="1"] #minimap { display: none !important; }

#inv-panel {
  display: grid; gap: ${INV_GAP_PX}px; padding-top: 4px;
}
:root[data-hud-orient="portrait"] #inv-panel { grid-template-columns: repeat(7, 1fr); }
:root[data-hud-orient="landscape"] #inv-panel { grid-template-columns: repeat(4, 1fr); }
#inv-panel .inv-slot { aspect-ratio: 1; }
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
/* Chat log + input sit bottom-left, lifted clear of the portrait bottom rail
   (and its safe-area inset). Landscape has no bottom rail, so they drop back
   near the corner. The log fades to its last line after a quiet spell. */
#msg-strip {
  position: fixed; left: 8px; z-index: 10; font-family: sans-serif;
  font-size: 13px; color: #f4e9c8; text-shadow: 0 1px 2px #000; pointer-events: auto;
  cursor: pointer; max-width: 72vw; transition: opacity 0.5s;
}
#msg-strip.faded { opacity: 0.4; }
#msg-strip.faded div:not(:last-child) { display: none; }
#msg-strip div { margin-top: 2px; }
:root[data-hud-orient="portrait"] #msg-strip { bottom: calc(108px + env(safe-area-inset-bottom, 0px)); }
:root[data-hud-orient="landscape"] #msg-strip { bottom: calc(46px + env(safe-area-inset-bottom, 0px)); max-width: 40vw; }
:root[data-hud-orient="landscape"][data-hud-dock="left"] #msg-strip { left: 68px; }
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
  position: fixed; left: 8px; z-index: 10; width: min(280px, 60vw);
  padding: 7px 10px; font-family: sans-serif; font-size: 13px;
  background: rgba(20, 16, 10, 0.82); color: #f4e9c8;
  border: 1px solid #5a4a30; border-radius: 8px; outline: none;
  -webkit-user-select: text; user-select: text; touch-action: auto;
}
#chat-input::placeholder { color: #8a7a5a; }
:root[data-hud-orient="portrait"] #chat-input { bottom: calc(72px + env(safe-area-inset-bottom, 0px)); }
:root[data-hud-orient="landscape"] #chat-input { bottom: calc(10px + env(safe-area-inset-bottom, 0px)); }
:root[data-hud-orient="landscape"][data-hud-dock="left"] #chat-input { left: 68px; }
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
/* ---- settings sheet ---- */
#hud-settings-scrim {
  position: fixed; inset: 0; z-index: 80; background: rgba(0, 0, 0, 0.5);
  display: flex; font-family: sans-serif;
}
:root[data-hud-orient="portrait"] #hud-settings-scrim { align-items: flex-end; justify-content: center; }
:root[data-hud-orient="landscape"] #hud-settings-scrim { align-items: center; justify-content: center; padding: 20px; }
#hud-settings {
  background: #221c11; border: 1px solid #6a5636; overflow-y: auto;
  box-shadow: 0 -8px 40px rgba(0, 0, 0, 0.5);
}
:root[data-hud-orient="portrait"] #hud-settings { width: 100%; max-height: 86%; border-radius: 20px 20px 0 0; }
:root[data-hud-orient="landscape"] #hud-settings { width: min(440px, 96%); max-height: 92%; border-radius: 18px; }
.set-head {
  position: sticky; top: 0; z-index: 1; background: #221c11;
  padding: 15px 18px 11px; display: flex; align-items: center; justify-content: space-between;
  border-bottom: 1px solid #4a3d26;
}
.set-head b { color: #ffe066; font-weight: 800; font-size: 17px; display: flex; align-items: center; gap: 9px; }
.set-head b svg, .set-head button svg { display: block; }
.set-head button { background: none; border: none; color: #c9b892; cursor: pointer; padding: 4px; }
.set-body { padding: 4px 18px 18px; }
.set-label {
  font-size: 11px; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase;
  color: #b08842; margin: 16px 0 2px;
}
.set-row { display: flex; align-items: center; gap: 12px; padding: 12px 0; }
.set-row.stack { flex-direction: column; align-items: stretch; gap: 9px; }
.set-row + .set-row { border-top: 1px solid rgba(90, 74, 48, 0.35); }
.set-row .set-txt { flex: 1; min-width: 0; }
.set-row .set-txt b { display: block; font-size: 14px; color: #f4e9c8; font-weight: 700; }
.set-row .set-txt span { font-size: 12px; color: #8a7553; }
.set-seg { display: flex; gap: 3px; background: #191510; border: 1px solid #3d3322; border-radius: 9px; padding: 3px; }
.set-seg button {
  flex: 1; border: none; border-radius: 6px; padding: 8px 10px; min-height: 34px;
  font-size: 12px; font-weight: 700; cursor: pointer; background: transparent; color: #c9b892;
  white-space: nowrap; font-family: sans-serif;
}
.set-seg button.on { background: #b08842; color: #14110d; }
.set-tgl {
  width: 46px; height: 28px; border-radius: 999px; flex: none; cursor: pointer; position: relative;
  border: 1px solid #3d3322; background: #443c26; transition: background 0.15s;
}
.set-tgl.on { background: #ffe066; border-color: #b08842; }
.set-tgl i { position: absolute; top: 2px; left: 2px; width: 22px; height: 22px; border-radius: 999px; background: #cfc7ac; transition: left 0.15s; }
.set-tgl.on i { left: 20px; background: #14110d; }
.set-slider { width: 100%; accent-color: #ffe066; }
.set-logout {
  width: 100%; margin-top: 14px; min-height: 46px; border-radius: 10px; cursor: pointer;
  border: 1.5px solid #7a4020; background: transparent; color: #e0a05a; font-weight: 800; font-size: 14px;
  display: flex; align-items: center; justify-content: center; gap: 8px; font-family: sans-serif;
}
.set-logout.armed { background: #c2410c; border-color: #8a3a10; color: #fff7ea; }
.set-logout svg { display: block; }
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
// Equipment sits on the main rail now (the old fixed panel kept it in a cramped
// bottom row); pane switching goes through selectTab, which queries
// .hud-tab[data-tab] globally, so both rails' buttons toggle together.
const TABS: { id: string; iconKey: string; title: string }[] = [
  { id: 'inventory', iconKey: 'backpack', title: 'Inventory' },
  { id: 'equipment', iconKey: 'paperdoll', title: 'Equipment' },
  { id: 'combat', iconKey: 'combat_level', title: 'Combat' },
  { id: 'prayer', iconKey: 'prayer', title: 'Prayer' },
  { id: 'magic', iconKey: 'magic_staff', title: 'Magic' },
]
const HUD_TAB_ICON_PX = 24

const TAB_LABEL: Record<string, string> = {
  inventory: 'Inventory', equipment: 'Equipment', combat: 'Combat', prayer: 'Prayer', magic: 'Magic',
}

// ---- live HUD/layout state (single source, mirrored into <html> data-attrs by
// applyLayout so the CSS above does the reflow). ----
let settings: UxSettings = { minimapMode: null, hudScale: 'normal', dock: 'right', panelOpacity: 0.92, chatAutoFade: true, haptics: true }
let hudVisible = true
let orientation: 'portrait' | 'landscape' = 'portrait'
let tablet = false
let sheetHeightPx = 0
// Cached vitals so an orb can be repainted on a scale/orientation change
// without waiting for the next server event.
const vitalsState = { hp: 0, maxHp: 1, run: 100, running: false, prayer: 0, maxPrayer: 1 }

function haptic(): void {
  if (settings.haptics && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(8)
}

function isSheetOpen(): boolean {
  return document.documentElement.getAttribute('data-hud-sheet') === 'open'
}

function setSheetOpen(open: boolean): void {
  document.documentElement.setAttribute('data-hud-sheet', open ? 'open' : 'closed')
}

/** Opens the panel body on `id`: marks the tab + pane active and titles the
 * landscape pane header. Shared by tab taps, the prayer-orb shortcut, and the
 * F1–F5 keys. */
function selectTab(id: string): void {
  setSheetOpen(true)
  for (const tab of document.querySelectorAll('.hud-tab[data-tab]')) {
    tab.classList.toggle('active', tab.getAttribute('data-tab') === id)
  }
  for (const pane of document.querySelectorAll('.hud-pane')) {
    pane.classList.toggle('active', pane.getAttribute('data-pane') === id)
  }
  const head = document.querySelector<HTMLElement>('#hud-body .hud-pane-head b')
  if (head) head.textContent = TAB_LABEL[id] ?? id
  if (orientation === 'portrait') setSheetHeight(sheetHeightPx || sheetHeightFor('peek', window.innerHeight || 800))
}

/** Tapping the active tab again dismisses the sheet/pane (frees the screen);
 * any other tap opens/switches. The tab rails always stay visible. */
function tabClicked(id: string): void {
  haptic()
  const active = document.querySelector('.hud-tab[data-tab].active')
  if (isSheetOpen() && active?.getAttribute('data-tab') === id) {
    setSheetOpen(false)
    return
  }
  selectTab(id)
}

function setSheetHeight(px: number): void {
  sheetHeightPx = px
  document.documentElement.style.setProperty('--sheet-h', `${px}px`)
}

/** Recomputes orientation + tablet from the viewport and re-stamps every layout
 * attribute on <html>; also repaints the orbs (JS-sized per HUD scale) and the
 * panel-opacity variable. The single place layout is applied. */
function applyLayout(): void {
  const w = window.innerWidth || 0
  const h = window.innerHeight || 0
  orientation = w >= h ? 'landscape' : 'portrait'
  tablet = isTabletViewport(Math.min(w, h))
  const root = document.documentElement
  root.setAttribute('data-hud-orient', orientation)
  root.setAttribute('data-hud-dock', settings.dock)
  root.setAttribute('data-hud-scale', settings.hudScale)
  root.setAttribute('data-minimap', resolveMinimapMode(settings, tablet))
  if (hudVisible) root.removeAttribute('data-hud-hidden')
  else root.setAttribute('data-hud-hidden', '1')
  root.style.setProperty('--hud-pop', String(settings.panelOpacity))
  if (orientation === 'portrait' && (!sheetHeightPx || sheetHeightPx <= 0)) {
    setSheetHeight(sheetHeightFor('peek', h || 800))
  }
  paintOrbs()
}

const ORBS: { key: 'hp' | 'prayer' | 'run'; label: string }[] = [
  { key: 'hp', label: 'HP' },
  { key: 'prayer', label: 'PRAY' },
  { key: 'run', label: 'RUN' },
]

function orbColor(key: 'hp' | 'prayer' | 'run', low: boolean): string {
  if (key === 'hp') return low ? '#e05a5a' : '#5fd35f'
  if (key === 'prayer') return '#c9a13a'
  return vitalsState.running ? '#ffe066' : '#b8a86a'
}

function paintOneOrb(key: 'hp' | 'prayer' | 'run', label: string): void {
  const el = document.querySelector<HTMLElement>(`.hud-orb[data-orb="${key}"]`)
  if (!el) return
  const value = key === 'hp' ? vitalsState.hp : key === 'prayer' ? Math.ceil(vitalsState.prayer) : Math.round(vitalsState.run)
  const max = key === 'hp' ? vitalsState.maxHp : key === 'prayer' ? vitalsState.maxPrayer : 100
  const scale = hudScaleValue(settings.hudScale)
  const d = Math.round(52 * scale)
  const r = d / 2 - 3.5
  const circ = 2 * Math.PI * r
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0
  const low = key === 'hp' && pct <= 0.25 && pct > 0
  const col = orbColor(key, low)
  el.classList.toggle('low', low)
  el.style.width = `${d}px`
  el.style.height = `${d}px`
  el.title = `${label} ${value}/${max}`
  el.innerHTML =
    `<svg width="${d}" height="${d}">` +
    `<circle cx="${d / 2}" cy="${d / 2}" r="${r}" fill="rgba(16,13,8,0.86)" stroke="#3d3322" stroke-width="2"></circle>` +
    `<circle cx="${d / 2}" cy="${d / 2}" r="${r}" fill="none" stroke="${col}" stroke-width="4" stroke-linecap="round" ` +
    `stroke-dasharray="${circ.toFixed(2)}" stroke-dashoffset="${(circ * (1 - pct)).toFixed(2)}"></circle>` +
    `</svg>` +
    `<div class="orb-in"><span class="orb-v" style="color:${col};font-size:${Math.round(13 * scale)}px">${value}</span>` +
    `<span class="orb-l">${label}</span></div>`
}

function paintOrbs(): void {
  for (const o of ORBS) paintOneOrb(o.key, o.label)
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

// Inline SVGs for the few controls with no bespoke-icon entry (eye/compass/gear/
// chevron) — the map button still uses the bespoke `globe` via data-icon.
const EYE_SVG = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.7"/></svg>'
const EYE_OFF_SVG = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.7"/><path d="M4 3.5l16 17"/></svg>'
const COMPASS_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="transform:rotate(20deg)"><path d="M12 2.8l5.4 15.4L12 13.7l-5.4 4.5z"/></svg>'
const GEAR_SVG = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/></svg>'
const CHEVRON_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 10l6 6 6-6"/></svg>'
const XMARK_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>'
const DOOR_SVG = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 4.5H6.5v15h7"/><path d="M10.5 12H21M18 9l3 3-3 3"/></svg>'

function railTabButton(tab: { id: string; iconKey: string; title: string }): HTMLElement {
  const btn = document.createElement('div')
  btn.className = 'hud-tab' + (tab.id === 'inventory' ? ' active' : '')
  btn.setAttribute('data-tab', tab.id)
  btn.setAttribute('data-icon', tab.iconKey)
  btn.setAttribute('data-icon-size', String(HUD_TAB_ICON_PX))
  btn.title = tab.title
  btn.addEventListener('click', () => tabClicked(tab.id))
  return btn
}

function railActionButton(html: string, title: string, onClick: () => void): HTMLElement {
  const btn = document.createElement('div')
  btn.className = 'hud-tab'
  btn.title = title
  btn.setAttribute('aria-label', title)
  btn.innerHTML = html
  btn.addEventListener('click', onClick)
  return btn
}

/** One tab rail (both orientations build the same controls; CSS shows whichever
 * matches the current orientation). Tabs, then a spacer, then World Map +
 * Settings pushed to the far end (right in portrait, bottom in landscape). */
function buildRail(id: string, handlers: HudHandlers | undefined, openSettings: () => void): HTMLElement {
  const rail = document.createElement('div')
  rail.id = id
  rail.className = 'hud-hideable'
  for (const tab of TABS) rail.appendChild(railTabButton(tab))
  const spacer = document.createElement('div')
  spacer.className = 'rail-spacer'
  rail.appendChild(spacer)
  rail.appendChild(railActionButton(`<span data-icon="globe" data-icon-size="${HUD_TAB_ICON_PX}"></span>`, 'World Map', () => handlers?.onWorldMap()))
  rail.appendChild(railActionButton(GEAR_SVG, 'Settings', openSettings))
  return rail
}

/** Builds the HUD: vitals orbs, the tabbed panel body (portrait bottom sheet /
 * landscape slide-out), both tab rails, the eye (hide-HUD) button, compass,
 * message log, xp-drop layer, fx layer and boss frame. Call once after welcome. */
export function initHud(handlers?: HudHandlers): void {
  if (hudReady) return
  hudReady = true
  settings = loadSettings()
  const style = document.createElement('style')
  style.textContent = HUD_CSS
  document.head.appendChild(style)

  // ---- vitals orbs (hp / prayer / run) ----
  const vitals = document.createElement('div')
  vitals.id = 'hud-vitals'
  vitals.className = 'hud-hideable'
  for (const o of ORBS) {
    const orb = document.createElement('div')
    orb.className = 'hud-orb'
    orb.setAttribute('data-orb', o.key)
    orb.setAttribute('role', 'button')
    orb.setAttribute('tabindex', '0')
    if (o.key === 'run') orb.addEventListener('click', () => { haptic(); handlers?.onRunToggle() })
    else if (o.key === 'prayer') orb.addEventListener('click', () => selectTab('prayer'))
    vitals.appendChild(orb)
  }
  document.body.appendChild(vitals)

  // ---- panel body (one instance, positioned as sheet or slide-out by CSS) ----
  const body = document.createElement('div')
  body.id = 'hud-body'
  body.className = 'hud-hideable ' + SCROLL_CLASS

  const handle = document.createElement('div')
  handle.className = 'hud-sheet-handle'
  handle.appendChild(document.createElement('span'))
  body.appendChild(handle)

  const paneHead = document.createElement('div')
  paneHead.className = 'hud-pane-head'
  const paneTitle = document.createElement('b')
  paneTitle.textContent = TAB_LABEL.inventory
  const paneClose = document.createElement('button')
  paneClose.setAttribute('aria-label', 'Close panel')
  paneClose.innerHTML = CHEVRON_SVG
  paneClose.addEventListener('click', () => setSheetOpen(false))
  paneHead.appendChild(paneTitle)
  paneHead.appendChild(paneClose)
  body.appendChild(paneHead)

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

  document.body.appendChild(body)
  if (handlers) setupInvDrag(inv, handlers)

  // ---- eye (hide/show all HUD) — outside .hud-hideable so it always survives ----
  const eye = document.createElement('button')
  eye.id = 'hud-eye'
  eye.title = 'Hide HUD'
  eye.setAttribute('aria-label', 'Hide HUD')
  eye.innerHTML = EYE_SVG
  eye.addEventListener('click', () => {
    hudVisible = !hudVisible
    eye.innerHTML = hudVisible ? EYE_SVG : EYE_OFF_SVG
    eye.title = hudVisible ? 'Hide HUD' : 'Show HUD'
    if (hudVisible) unfadeChat()
    applyLayout()
  })
  document.body.appendChild(eye)

  // ---- compass (phone default; opens the world map) ----
  const compass = document.createElement('button')
  compass.id = 'hud-compass'
  compass.className = 'hud-hideable'
  compass.title = 'Open world map'
  compass.setAttribute('aria-label', 'Open world map')
  compass.innerHTML = COMPASS_SVG
  compass.addEventListener('click', () => handlers?.onWorldMap())
  document.body.appendChild(compass)

  // ---- tab rails (portrait bottom + landscape edge) + settings ----
  const openSettings = (): void => showSettingsSheet(handlers)
  document.body.appendChild(buildRail('hud-rail-p', handlers, openSettings))
  document.body.appendChild(buildRail('hud-rail-l', handlers, openSettings))

  const msgs = document.createElement('div')
  msgs.id = 'msg-strip'
  msgs.className = 'hud-hideable'
  msgs.addEventListener('click', unfadeChat)
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

  setupSheetDrag(handle)
  window.addEventListener('keydown', onGlobalKeyDown)
  window.addEventListener('resize', applyLayout)
  window.addEventListener('orientationchange', applyLayout)
  applyLayout()
  selectTab('inventory')
}

// The portrait sheet's drag-to-resize handle: press-drag adjusts the sheet
// height live, release snaps to peek/full or dismisses (sheetSnap). Landscape
// ignores it (the handle is CSS-hidden and the body is full-height).
function setupSheetDrag(handle: HTMLElement): void {
  let start: { y: number; h: number } | null = null
  const onMove = (e: PointerEvent): void => {
    if (!start) return
    const h = Math.max(0, Math.min(window.innerHeight * 0.9, start.h - (e.clientY - start.y)))
    setSheetHeight(h)
  }
  const onUp = (): void => {
    if (!start) return
    start = null
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    const snap = sheetSnap(sheetHeightPx, window.innerHeight || 800)
    if (snap === 'dismiss') setSheetOpen(false)
    else setSheetHeight(sheetHeightFor(snap, window.innerHeight || 800))
  }
  handle.addEventListener('pointerdown', (e) => {
    if (orientation !== 'portrait') return
    start = { y: e.clientY, h: sheetHeightPx || sheetHeightFor('peek', window.innerHeight || 800) }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    e.preventDefault()
  })
}

// ---- chat auto-fade: the message log dims to its last line after a quiet
// spell, waking on tap (or any HUD-reveal). Respects the chatAutoFade setting. ----
let chatFadeTimer: ReturnType<typeof setTimeout> | null = null

function unfadeChat(): void {
  document.getElementById('msg-strip')?.classList.remove('faded')
  armChatFade()
}

function armChatFade(): void {
  if (chatFadeTimer) clearTimeout(chatFadeTimer)
  if (!settings.chatAutoFade) return
  chatFadeTimer = setTimeout(() => {
    document.getElementById('msg-strip')?.classList.add('faded')
  }, 5000)
}

// ---- settings sheet ----
function showSettingsSheet(handlers?: HudHandlers): void {
  if (document.getElementById('hud-settings-scrim')) return
  let logoutArmed = false

  const scrim = document.createElement('div')
  scrim.id = 'hud-settings-scrim'
  const close = (): void => { scrim.remove() }
  scrim.addEventListener('click', (e) => { if (e.target === scrim) close() })

  const sheet = document.createElement('div')
  sheet.id = 'hud-settings'
  sheet.className = SCROLL_CLASS

  const head = document.createElement('div')
  head.className = 'set-head'
  const headTitle = document.createElement('b')
  headTitle.innerHTML = `${GEAR_SVG}<span>Settings</span>`
  const headClose = document.createElement('button')
  headClose.setAttribute('aria-label', 'Close settings')
  headClose.innerHTML = XMARK_SVG
  headClose.addEventListener('click', close)
  head.appendChild(headTitle)
  head.appendChild(headClose)
  sheet.appendChild(head)

  const bodyEl = document.createElement('div')
  bodyEl.className = 'set-body'

  const label = (text: string): void => {
    const l = document.createElement('div')
    l.className = 'set-label'
    l.textContent = text
    bodyEl.appendChild(l)
  }
  const row = (title: string, sub: string | null, control: HTMLElement, stack = false): void => {
    const r = document.createElement('div')
    r.className = 'set-row' + (stack ? ' stack' : '')
    const txt = document.createElement('div')
    txt.className = 'set-txt'
    const b = document.createElement('b')
    b.textContent = title
    txt.appendChild(b)
    if (sub) {
      const s = document.createElement('span')
      s.textContent = sub
      txt.appendChild(s)
    }
    r.appendChild(txt)
    r.appendChild(control)
    bodyEl.appendChild(r)
  }
  const segmented = <T extends string>(current: T, options: { value: T; label: string }[], onPick: (v: T) => void, width?: number): HTMLElement => {
    const seg = document.createElement('div')
    seg.className = 'set-seg'
    if (width) seg.style.width = `${width}px`
    for (const o of options) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.textContent = o.label
      btn.className = o.value === current ? 'on' : ''
      btn.addEventListener('click', () => {
        for (const sib of seg.children) sib.classList.toggle('on', sib === btn)
        onPick(o.value)
      })
      seg.appendChild(btn)
    }
    return seg
  }
  const toggle = (on: boolean, onChange: (v: boolean) => void): HTMLElement => {
    const t = document.createElement('button')
    t.type = 'button'
    t.className = 'set-tgl' + (on ? ' on' : '')
    t.setAttribute('role', 'switch')
    t.setAttribute('aria-checked', String(on))
    t.innerHTML = '<i></i>'
    t.addEventListener('click', () => {
      const next = !t.classList.contains('on')
      t.classList.toggle('on', next)
      t.setAttribute('aria-checked', String(next))
      onChange(next)
    })
    return t
  }
  const commit = (patch: Partial<UxSettings>): void => {
    settings = { ...settings, ...patch }
    saveSettings(settings)
    applyLayout()
  }

  label('Map')
  row('Minimap', 'Compass is a small button that opens the full map',
    segmented<MinimapMode>(resolveMinimapMode(settings, tablet),
      [{ value: 'full', label: 'Full' }, { value: 'compass', label: 'Compass' }, { value: 'off', label: 'Off' }],
      (v) => commit({ minimapMode: v })), undefined)

  label('Layout')
  row('HUD size', null,
    segmented(settings.hudScale,
      [{ value: 'compact', label: 'S' }, { value: 'normal', label: 'M' }, { value: 'large', label: 'L' }],
      (v) => commit({ hudScale: v }), 160))
  row('Panel side', 'Landscape — dock it under your thumb',
    segmented(settings.dock,
      [{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }],
      (v) => commit({ dock: v }), 150))
  const slider = document.createElement('input')
  slider.type = 'range'
  slider.min = '60'
  slider.max = '100'
  slider.value = String(Math.round(settings.panelOpacity * 100))
  slider.className = 'set-slider'
  slider.addEventListener('input', () => commit({ panelOpacity: Number(slider.value) / 100 }))
  row('Panel opacity', 'See the world behind open panels', slider, true)

  label('Chat & feedback')
  row('Chat auto-fade', 'Dim the log after a few quiet seconds',
    toggle(settings.chatAutoFade, (v) => { commit({ chatAutoFade: v }); if (!v) unfadeChat(); else armChatFade() }))
  row('Haptics', 'Light tick on taps', toggle(settings.haptics, (v) => commit({ haptics: v })))

  label('System')
  const logout = document.createElement('button')
  logout.className = 'set-logout'
  logout.innerHTML = `${DOOR_SVG}<span>Log out of the world</span>`
  logout.addEventListener('click', () => {
    if (logoutArmed) { close(); handlers?.onLogout(); return }
    logoutArmed = true
    logout.classList.add('armed')
    logout.querySelector('span')!.textContent = 'Tap again to log out'
  })
  bodyEl.appendChild(logout)

  sheet.appendChild(bodyEl)
  scrim.appendChild(sheet)
  document.body.appendChild(scrim)
  paintHudIcons()
}

// Priority 3 (same as the world-map/bank/craft modals): Escape closes the
// settings sheet if it's open.
registerEscapeHandler(3, () => {
  const scrim = document.getElementById('hud-settings-scrim')
  if (!scrim) return false
  scrim.remove()
  return true
})

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
  vitalsState.run = energy
  vitalsState.running = running
  paintOneOrb('run', 'RUN')
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

/** Updates the prayer pool orb + the in-pane pool bar + which toggle buttons
 * read as active. */
export function setPrayerState(points: number, max: number, protection: string | null, combat: string | null): void {
  vitalsState.prayer = points
  vitalsState.maxPrayer = max
  paintOneOrb('prayer', 'PRAY')
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

/** Feeds the HP orb (named for the pill it replaced — main.ts still calls it on
 * every {e:'hp'} and welcome). */
export function updateHpPill(hp: number, maxHp: number): void {
  vitalsState.hp = hp
  vitalsState.maxHp = maxHp
  paintOneOrb('hp', 'HP')
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
  unfadeChat()
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
