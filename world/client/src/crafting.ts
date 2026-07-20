// Station recipe panel: opens on arrival at a furnace/anvil/range
// ({e:'station', open:true}), lists that station's skills.json recipes with
// live have/need material counts, and sends {t:'craft'} with the chosen
// quantity. The server re-validates everything — this UI only expresses intent.
import type { InvSlot, StationType } from '../../shared/protocol'
import { STATIONS, type Recipe } from '../../shared/recipes'
import { iconMarkup, itemName } from './itemIcon'
import { registerEscapeHandler, SCROLL_CLASS } from './ui'

export type CraftHandler = (station: StationType, recipeId: string, qty: number) => void
export type SkillLevels = Record<string, { xp: number; level: number }>

const ALL_QTY = 28

const CRAFT_CSS = `
#craft-modal {
  position: fixed; inset: 0; z-index: 25; display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.45); font-family: sans-serif;
}
#craft-panel {
  width: min(440px, 94vw); max-height: 86vh; display: flex; flex-direction: column;
  background: rgba(24, 19, 12, 0.97); border: 1px solid #6a5636; border-radius: 10px; overflow: hidden;
}
#craft-panel .craft-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; color: #ffe066; font-weight: bold; font-size: 15px;
  background: rgba(70, 58, 36, 0.6); border-bottom: 1px solid #4a3d26;
}
#craft-panel .craft-close {
  min-width: 44px; min-height: 32px; border: none; border-radius: 6px; cursor: pointer;
  background: rgba(140, 40, 40, 0.9); color: #fff; font-size: 15px;
}
#craft-list { overflow-y: auto; padding: 6px 8px 10px; }
.craft-row {
  display: flex; align-items: center; gap: 8px; min-height: 48px; padding: 4px 6px;
  border-radius: 6px; user-select: none;
}
.craft-row + .craft-row { margin-top: 2px; }
.craft-row.locked { opacity: 0.45; }
.craft-row .icon { flex: 0 0 34px; display: flex; align-items: center; justify-content: center; }
.craft-row .body { flex: 1 1 auto; min-width: 0; }
.craft-row .name { color: #f4e9c8; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.craft-row .mats { color: #c9b892; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.craft-row .mats .short { color: #e06c5a; }
.craft-row .lvl { flex: 0 0 auto; font-size: 11px; color: #9bd06a; padding-right: 2px; }
.craft-row.locked .lvl { color: #e06c5a; }
.craft-row .make { display: flex; gap: 4px; flex: 0 0 auto; }
.craft-row .make button {
  min-width: 34px; min-height: 34px; border: none; border-radius: 6px; cursor: pointer;
  background: #46618a; color: #fff; font-size: 12px;
}
.craft-row .make button:disabled { background: rgba(70, 70, 70, 0.6); color: #9a9a9a; cursor: default; }
`

let cssReady = false
let state: { station: StationType; inventory: InvSlot[]; stats: SkillLevels; onCraft: CraftHandler } | null = null

function ensureCss(): void {
  if (cssReady) return
  cssReady = true
  const style = document.createElement('style')
  style.textContent = CRAFT_CSS
  document.head.appendChild(style)
}

export function isCraftOpen(): boolean {
  return state !== null
}

function packCount(inventory: InvSlot[], itemId: string): number {
  let total = 0
  for (const slot of inventory) if (slot?.itemId === itemId) total += slot.quantity
  return total
}

function craftableCount(inventory: InvSlot[], recipe: Recipe): number {
  let max = Infinity
  for (const [itemId, qty] of Object.entries(recipe.materials)) {
    max = Math.min(max, Math.floor(packCount(inventory, itemId) / qty))
  }
  return Number.isFinite(max) ? max : 0
}

function makeRow(recipe: Recipe, level: number): HTMLElement {
  const current = state!
  const row = document.createElement('div')
  row.className = 'craft-row'
  const locked = level < recipe.level
  const craftable = craftableCount(current.inventory, recipe)
  if (locked) row.classList.add('locked')

  const icon = document.createElement('div')
  icon.className = 'icon'
  icon.innerHTML = iconMarkup(recipe.product, 30)

  const body = document.createElement('div')
  body.className = 'body'
  const name = document.createElement('div')
  name.className = 'name'
  name.textContent = recipe.name
  const mats = document.createElement('div')
  mats.className = 'mats'
  Object.entries(recipe.materials).forEach(([itemId, qty], i) => {
    const chip = document.createElement('span')
    const have = packCount(current.inventory, itemId)
    chip.textContent = `${i > 0 ? ' · ' : ''}${itemName(itemId)} ${have}/${qty}`
    if (have < qty) chip.className = 'short'
    mats.appendChild(chip)
  })
  body.appendChild(name)
  body.appendChild(mats)

  const lvl = document.createElement('span')
  lvl.className = 'lvl'
  lvl.textContent = `Lv ${recipe.level}`

  const make = document.createElement('div')
  make.className = 'make'
  for (const [label, qty] of [['1', 1], ['5', 5], ['All', ALL_QTY]] as const) {
    const btn = document.createElement('button')
    btn.textContent = label
    btn.disabled = locked || craftable < 1
    btn.addEventListener('click', () => current.onCraft(current.station, recipe.id, qty))
    make.appendChild(btn)
  }

  row.appendChild(icon)
  row.appendChild(body)
  row.appendChild(lvl)
  row.appendChild(make)
  return row
}

function render(): void {
  if (!state) return
  const list = document.getElementById('craft-list')
  if (!list) return
  const station = STATIONS[state.station]
  const level = state.stats[station.skill]?.level ?? 1
  list.textContent = ''
  for (const recipe of station.recipes) list.appendChild(makeRow(recipe, level))
}

export function openCraftUI(station: StationType, inventory: InvSlot[], stats: SkillLevels, onCraft: CraftHandler): void {
  ensureCss()
  closeCraftUI()
  state = { station, inventory, stats, onCraft }

  const modal = document.createElement('div')
  modal.id = 'craft-modal'
  const panel = document.createElement('div')
  panel.id = 'craft-panel'

  const head = document.createElement('div')
  head.className = 'craft-head'
  const title = document.createElement('span')
  title.textContent = STATIONS[station].label
  const close = document.createElement('button')
  close.className = 'craft-close'
  close.textContent = '✕'
  close.addEventListener('click', () => closeCraftUI())
  head.appendChild(title)
  head.appendChild(close)

  const list = document.createElement('div')
  list.id = 'craft-list'
  list.className = SCROLL_CLASS

  panel.appendChild(head)
  panel.appendChild(list)
  modal.appendChild(panel)
  modal.addEventListener('pointerdown', (e) => {
    if (e.target === modal) closeCraftUI()
  })
  document.body.appendChild(modal)
  render()
}

/** Pack changed while the panel is open — refresh have/need counts. */
export function updateCraftInventory(inventory: InvSlot[]): void {
  if (!state) return
  state.inventory = inventory
  render()
}

/** Skill levels changed (an in-session level-up) — refresh gates. */
export function updateCraftStats(stats: SkillLevels): void {
  if (!state) return
  state.stats = stats
  render()
}

export function closeCraftUI(): void {
  state = null
  document.getElementById('craft-modal')?.remove()
}

// Priority 3: same tier as the bank/world-map modals — they're mutually
// exclusive in practice, so ordering between them doesn't matter.
registerEscapeHandler(3, () => {
  if (!isCraftOpen()) return false
  closeCraftUI()
  return true
})
