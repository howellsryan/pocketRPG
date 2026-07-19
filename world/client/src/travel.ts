// Travel menu: the one-world-map's teleport UI. A persistent 🧭 button opens a
// list of every place (the overworld's landmark district centres); tapping one
// sends {t:'teleport', placeId} and the server snaps the player to that centre.
// Only initialised for zones that ship `landmarks` (the merged overworld) — a
// per-zone map with none never shows the button.
import type { Landmark } from '../../shared/protocol'

export type TravelHandler = (placeId: string) => void

const TRAVEL_CSS = `
#travel-btn {
  position: fixed; left: 8px; top: 52px; z-index: 12;
  min-width: 44px; min-height: 44px; padding: 6px 12px;
  border: 1px solid #6a5636; border-radius: 8px; cursor: pointer;
  background: rgba(24, 19, 12, 0.92); color: #ffe066; font-size: 14px; font-weight: bold;
  font-family: sans-serif; display: flex; align-items: center; gap: 6px;
}
#travel-modal {
  position: fixed; inset: 0; z-index: 26; display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.45); font-family: sans-serif;
}
#travel-panel {
  width: min(360px, 92vw); max-height: 80vh; display: flex; flex-direction: column;
  background: rgba(24, 19, 12, 0.97); border: 1px solid #6a5636; border-radius: 10px; overflow: hidden;
}
#travel-panel .travel-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; color: #ffe066; font-weight: bold; font-size: 15px;
  background: rgba(70, 58, 36, 0.6); border-bottom: 1px solid #4a3d26;
}
#travel-panel .travel-close {
  min-width: 44px; min-height: 32px; border: none; border-radius: 6px; cursor: pointer;
  background: rgba(140, 40, 40, 0.9); color: #fff; font-size: 15px;
}
#travel-panel .travel-list { overflow-y: auto; padding: 6px; display: flex; flex-direction: column; gap: 4px; }
#travel-panel .travel-row {
  min-height: 44px; padding: 8px 12px; border: none; border-radius: 6px; cursor: pointer; text-align: left;
  background: rgba(60, 50, 34, 0.55); color: #f4e9c8; font-size: 14px;
}
#travel-panel .travel-row:hover { background: rgba(80, 66, 42, 0.75); }
`

let cssReady = false
function ensureCss(): void {
  if (cssReady) return
  cssReady = true
  const style = document.createElement('style')
  style.textContent = TRAVEL_CSS
  document.head.appendChild(style)
}

function closeMenu(): void {
  document.getElementById('travel-modal')?.remove()
}

function openMenu(landmarks: Landmark[], onTravel: TravelHandler): void {
  closeMenu()
  const modal = document.createElement('div')
  modal.id = 'travel-modal'
  const panel = document.createElement('div')
  panel.id = 'travel-panel'

  const head = document.createElement('div')
  head.className = 'travel-head'
  const title = document.createElement('span')
  title.textContent = 'Travel to…'
  const close = document.createElement('button')
  close.className = 'travel-close'
  close.textContent = '✕'
  close.addEventListener('click', closeMenu)
  head.appendChild(title)
  head.appendChild(close)

  const list = document.createElement('div')
  list.className = 'travel-list'
  for (const lm of [...landmarks].sort((a, b) => a.label.localeCompare(b.label))) {
    const row = document.createElement('button')
    row.className = 'travel-row'
    row.textContent = lm.label
    row.addEventListener('click', () => {
      onTravel(lm.id)
      closeMenu()
    })
    list.appendChild(row)
  }

  panel.appendChild(head)
  panel.appendChild(list)
  modal.appendChild(panel)
  modal.addEventListener('pointerdown', (e) => {
    if (e.target === modal) closeMenu()
  })
  document.body.appendChild(modal)
}

/** Mounts the Travel button for a zone's landmarks. No-op (and removes any prior
 * button) when the zone has none — per-zone maps get no travel menu. */
export function initTravel(landmarks: Landmark[] | undefined, onTravel: TravelHandler): void {
  document.getElementById('travel-btn')?.remove()
  closeMenu()
  if (!landmarks?.length) return
  ensureCss()
  const btn = document.createElement('button')
  btn.id = 'travel-btn'
  btn.innerHTML = '🧭 <span>Travel</span>'
  btn.addEventListener('click', () => openMenu(landmarks, onTravel))
  document.body.appendChild(btn)
}
