// Bank modal: opens on arrival at a chest ({e:'bank', open:true}), shows the
// character's bank beside the pack, and sends {t:'bank'} ops. Tap = move 1;
// right-click / long-press = 1, 5, 10, X (typed amount), All — mirroring the
// main game's banking. The server clamps every quantity, so the UI only ever
// expresses intent.
import type { BankSlot, InvSlot } from '../../shared/protocol'
import { iconMarkup, itemName } from './itemIcon'
import { showContextMenu } from './ui'
import type { MenuRow } from './picking'

export type BankOp = (op: 'deposit' | 'withdraw', itemId: string, qty: number) => void

const QTY_CHOICES = [1, 5, 10] as const
const ALL_QTY = 1_000_000_000
// Cells no longer set touch-action:none (native scroll needs it), so a
// scroll-drag that ends on a cell must not read as a tap-to-deposit/withdraw.
const TAP_MOVE_THRESHOLD_PX = 10

/** True when a pointerup at (upX,upY) should count as a tap rather than the
 * end of a scroll-drag that started at (downX,downY). */
export function isTapNotDrag(downX: number, downY: number, upX: number, upY: number): boolean {
  return Math.hypot(upX - downX, upY - downY) <= TAP_MOVE_THRESHOLD_PX
}

const BANK_CSS = `
#bank-modal {
  position: fixed; inset: 0; z-index: 25; display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.45); font-family: sans-serif;
}
#bank-panel {
  width: min(560px, 94vw); max-height: 86vh; display: flex; flex-direction: column;
  background: rgba(24, 19, 12, 0.97); border: 1px solid #6a5636; border-radius: 10px; overflow: hidden;
}
#bank-panel .bank-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; color: #ffe066; font-weight: bold; font-size: 15px;
  background: rgba(70, 58, 36, 0.6); border-bottom: 1px solid #4a3d26;
}
#bank-panel .bank-close {
  min-width: 44px; min-height: 32px; border: none; border-radius: 6px; cursor: pointer;
  background: rgba(140, 40, 40, 0.9); color: #fff; font-size: 15px;
}
#bank-panel .bank-sub {
  padding: 5px 12px 3px; color: #c9b892; font-size: 12px;
}
#bank-search {
  margin: 6px 12px 0; padding: 8px 10px; font-size: 13px;
  background: rgba(60, 50, 34, 0.55); color: #f4e9c8;
  border: 1px solid #5a4a30; border-radius: 6px; outline: none; min-height: 36px;
  -webkit-user-select: text; user-select: text;
}
#bank-search::placeholder { color: #8a7a5a; }
.bank-grid .bank-empty {
  grid-column: 1 / -1; color: #8a7a5a; font-size: 13px; padding: 8px 0;
}
#bank-panel .bank-grid {
  display: grid; grid-template-columns: repeat(auto-fill, 44px); gap: 3px;
  padding: 4px 12px 10px; overflow-y: auto; min-height: 96px; max-height: 34vh;
}
.bank-cell {
  width: 44px; height: 44px; position: relative; border-radius: 4px; cursor: pointer;
  background: rgba(60, 50, 34, 0.55); display: flex; align-items: center; justify-content: center;
  user-select: none;
}
.bank-cell .qty {
  position: absolute; top: 0; right: 2px; font-size: 10px; color: #ffe066; text-shadow: 0 1px 2px #000;
}
.bank-cell.empty { cursor: default; background: rgba(60, 50, 34, 0.25); }
#bank-qty-prompt {
  position: fixed; z-index: 35; left: 50%; top: 42%; transform: translate(-50%, -50%);
  background: rgba(24, 19, 12, 0.97); border: 1px solid #6a5636; border-radius: 8px; padding: 12px;
  display: flex; gap: 8px; align-items: center; font-family: sans-serif;
}
#bank-qty-prompt input {
  width: 90px; padding: 6px 8px; font-size: 14px; background: rgba(60, 50, 34, 0.55);
  color: #f4e9c8; border: 1px solid #5a4a30; border-radius: 6px; outline: none;
}
#bank-qty-prompt button {
  min-width: 44px; min-height: 36px; border: none; border-radius: 6px; cursor: pointer;
  background: #46618a; color: #fff; font-size: 14px;
}
`

let cssReady = false
let state: { bank: BankSlot[]; inventory: InvSlot[]; onOp: BankOp; query: string } | null = null

/** Case-insensitive substring filter over a list of {itemId} entries, matched
 * against each item's display name. Empty query passes everything through. */
export function filterBankSlots<T extends { itemId: string }>(slots: T[], query: string, nameOf: (itemId: string) => string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return slots
  return slots.filter((s) => nameOf(s.itemId).toLowerCase().includes(q))
}

function ensureCss(): void {
  if (cssReady) return
  cssReady = true
  const style = document.createElement('style')
  style.textContent = BANK_CSS
  document.head.appendChild(style)
}

export function isBankOpen(): boolean {
  return state !== null
}

function packCount(inventory: InvSlot[], itemId: string): number {
  let total = 0
  for (const slot of inventory) if (slot?.itemId === itemId) total += slot.quantity
  return total
}

/** Small "how many?" input for the X option. */
function promptQty(onSubmit: (qty: number) => void): void {
  document.getElementById('bank-qty-prompt')?.remove()
  const box = document.createElement('div')
  box.id = 'bank-qty-prompt'
  const input = document.createElement('input')
  input.type = 'number'
  input.min = '1'
  input.placeholder = 'Amount'
  const ok = document.createElement('button')
  ok.textContent = 'OK'
  const submit = (): void => {
    const qty = Math.floor(Number(input.value))
    box.remove()
    if (Number.isFinite(qty) && qty >= 1) onSubmit(Math.min(qty, ALL_QTY))
  }
  ok.addEventListener('click', submit)
  input.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Enter') submit()
    if (e.key === 'Escape') box.remove()
  })
  box.appendChild(input)
  box.appendChild(ok)
  document.body.appendChild(box)
  input.focus()
}

function qtyMenu(verb: 'Deposit' | 'Withdraw', itemId: string, x: number, y: number, run: (qty: number) => void): void {
  const name = itemName(itemId)
  const rows: MenuRow[] = [
    ...QTY_CHOICES.map((n) => ({ text: `${verb} ${n} ${name}`, targetName: name })),
    { text: `${verb} X ${name}`, targetName: name },
    { text: `${verb} All ${name}`, targetName: name },
    { text: 'Cancel', local: 'cancel' as const },
  ]
  showContextMenu(rows, x, y, (row) => {
    const index = rows.indexOf(row)
    if (index < 0 || index >= rows.length - 1) return
    if (index < QTY_CHOICES.length) run(QTY_CHOICES[index])
    else if (index === QTY_CHOICES.length) promptQty(run)
    else run(ALL_QTY)
  })
}

/** One 44px item cell with tap → move 1, right-click/long-press → qty menu. */
function makeCell(itemId: string, quantity: number, verb: 'Deposit' | 'Withdraw', onOp: BankOp): HTMLElement {
  const cell = document.createElement('div')
  cell.className = 'bank-cell'
  cell.innerHTML = iconMarkup(itemId, 34)
  cell.title = itemName(itemId)
  if (quantity > 1) {
    const qty = document.createElement('span')
    qty.className = 'qty'
    qty.textContent = quantity > 99999 ? `${Math.floor(quantity / 1000)}k` : String(quantity)
    cell.appendChild(qty)
  }
  const op = verb === 'Deposit' ? 'deposit' : 'withdraw'
  let pressTimer: ReturnType<typeof setTimeout> | null = null
  let menuFired = false
  let downPos: { x: number; y: number } | null = null
  cell.addEventListener('pointerdown', (e) => {
    if (e.button === 2) return
    menuFired = false
    downPos = { x: e.clientX, y: e.clientY }
    pressTimer = setTimeout(() => {
      menuFired = true
      qtyMenu(verb, itemId, e.clientX, e.clientY, (qty) => onOp(op, itemId, qty))
    }, 500)
  })
  const cancelPress = (): void => {
    if (pressTimer) clearTimeout(pressTimer)
    pressTimer = null
  }
  cell.addEventListener('pointermove', (e) => {
    // Native scroll is enabled now (no touch-action:none) — only a real drag
    // should cancel the long-press timer, not finger jitter under a tap.
    if (downPos && !isTapNotDrag(downPos.x, downPos.y, e.clientX, e.clientY)) cancelPress()
  })
  cell.addEventListener('pointercancel', cancelPress)
  cell.addEventListener('pointerup', (e) => {
    cancelPress()
    const wasTap = downPos != null && isTapNotDrag(downPos.x, downPos.y, e.clientX, e.clientY)
    downPos = null
    if (!menuFired && wasTap) onOp(op, itemId, 1)
  })
  cell.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    cancelPress()
    qtyMenu(verb, itemId, e.clientX, e.clientY, (qty) => onOp(op, itemId, qty))
  })
  return cell
}

function render(): void {
  if (!state) return
  const bankGrid = document.getElementById('bank-grid')
  const packGrid = document.getElementById('bank-pack-grid')
  if (!bankGrid || !packGrid) return

  const filteredBank = filterBankSlots(state.bank, state.query, itemName)

  bankGrid.textContent = ''
  for (const entry of filteredBank) {
    bankGrid.appendChild(makeCell(entry.itemId, entry.quantity, 'Withdraw', state.onOp))
  }
  if (filteredBank.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'bank-empty'
    empty.textContent = state.bank.length === 0 ? 'Your bank is empty.' : 'No items match your search.'
    bankGrid.appendChild(empty)
  }

  packGrid.textContent = ''
  // One cell per distinct pack item (a deposit drains across slots server-side).
  const seen = new Set<string>()
  const packItems: { itemId: string }[] = []
  for (const slot of state.inventory) {
    if (!slot || seen.has(slot.itemId)) continue
    seen.add(slot.itemId)
    packItems.push({ itemId: slot.itemId })
  }
  const filteredPack = filterBankSlots(packItems, state.query, itemName)
  for (const { itemId } of filteredPack) {
    packGrid.appendChild(makeCell(itemId, packCount(state.inventory, itemId), 'Deposit', state.onOp))
  }
  if (filteredPack.length === 0 && packItems.length > 0) {
    const empty = document.createElement('div')
    empty.className = 'bank-empty'
    empty.textContent = 'No items match your search.'
    packGrid.appendChild(empty)
  }
}

export function openBankUI(bank: BankSlot[], inventory: InvSlot[], onOp: BankOp): void {
  ensureCss()
  closeBankUI()
  state = { bank, inventory, onOp, query: '' }

  const modal = document.createElement('div')
  modal.id = 'bank-modal'
  const panel = document.createElement('div')
  panel.id = 'bank-panel'

  const head = document.createElement('div')
  head.className = 'bank-head'
  const title = document.createElement('span')
  title.textContent = 'Bank of PocketRPG'
  const close = document.createElement('button')
  close.className = 'bank-close'
  close.textContent = '✕'
  close.addEventListener('click', () => closeBankUI())
  head.appendChild(title)
  head.appendChild(close)

  const search = document.createElement('input')
  search.id = 'bank-search'
  search.type = 'text'
  search.placeholder = 'Search items…'
  search.autocomplete = 'off'
  search.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key !== 'Escape') return
    search.value = ''
    if (state) state.query = ''
    render()
    search.blur()
  })
  search.addEventListener('input', () => {
    if (state) state.query = search.value
    render()
  })

  const bankSub = document.createElement('div')
  bankSub.className = 'bank-sub'
  bankSub.textContent = 'Bank — tap to withdraw 1, hold for more'
  const bankGrid = document.createElement('div')
  bankGrid.id = 'bank-grid'
  bankGrid.className = 'bank-grid bank-side'

  const packSub = document.createElement('div')
  packSub.className = 'bank-sub'
  packSub.textContent = 'Your pack — tap to deposit 1, hold for more'
  const packGrid = document.createElement('div')
  packGrid.id = 'bank-pack-grid'
  packGrid.className = 'bank-grid'

  panel.appendChild(head)
  panel.appendChild(search)
  panel.appendChild(bankSub)
  panel.appendChild(bankGrid)
  panel.appendChild(packSub)
  panel.appendChild(packGrid)
  modal.appendChild(panel)
  // A press on the dimmed backdrop (not the panel) closes, like every modal.
  modal.addEventListener('pointerdown', (e) => {
    if (e.target === modal) closeBankUI()
  })
  document.body.appendChild(modal)
  render()
}

export function updateBankUI(bank: BankSlot[]): void {
  if (!state) return
  state.bank = bank
  render()
}

export function updateBankInventory(inventory: InvSlot[]): void {
  if (!state) return
  state.inventory = inventory
  render()
}

export function closeBankUI(): void {
  state = null
  document.getElementById('bank-modal')?.remove()
  document.getElementById('bank-qty-prompt')?.remove()
}
