import { useState, useRef, useEffect } from 'preact/hooks'
import ItemSlot from './ItemSlot.jsx'

// Shared 28-slot inventory grid with drag-to-reorder. Used by the Inventory
// screen and the in-combat inventory panel so both share one drag/persistence
// path. Inventory is a positional array in the save blob, so a move is a plain
// swap of two slots — `onReorder(fromIndex, toIndex)` lets the caller apply it
// (and persist via the normal save path). Dropping onto an empty slot relocates
// the item; onto a filled slot swaps the two.
//
// `onSlotClick(slot, item, index)` fires on a tap (drag never triggers it — the
// grip has its own pointer capture); callers wire it to their own action (open
// the item modal, eat/drink/equip in combat).

const EDGE_ZONE = 56
const MAX_SCROLL_SPEED = 14

function getScrollParent(el) {
  let node = el?.parentElement
  while (node) {
    const style = window.getComputedStyle(node)
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) return node
    node = node.parentElement
  }
  return null
}

export default function InventoryGrid({
  inventory,
  onReorder,
  onSlotClick,
  gridClass = 'grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-7 gap-2 md:gap-3 justify-items-center',
  size = 'inventory',
  showName = true,
}) {
  const [draggingIndex, setDraggingIndex] = useState(null)
  const [overIndex, setOverIndex] = useState(null)
  const dragRef = useRef(null)
  const overRef = useRef(null)
  const autoScrollRef = useRef(null)

  const stopAutoScroll = () => {
    if (autoScrollRef.current != null) {
      cancelAnimationFrame(autoScrollRef.current)
      autoScrollRef.current = null
    }
  }

  const updateAutoScroll = (clientY) => {
    const el = dragRef.current?.scrollEl
    if (!el) return
    const rect = el.getBoundingClientRect()
    let velocity = 0
    if (clientY < rect.top + EDGE_ZONE) {
      velocity = -MAX_SCROLL_SPEED * Math.min(1, (rect.top + EDGE_ZONE - clientY) / EDGE_ZONE)
    } else if (clientY > rect.bottom - EDGE_ZONE) {
      velocity = MAX_SCROLL_SPEED * Math.min(1, (clientY - (rect.bottom - EDGE_ZONE)) / EDGE_ZONE)
    }
    if (velocity === 0) { stopAutoScroll(); return }
    if (autoScrollRef.current == null) {
      const step = () => {
        const d = dragRef.current
        if (!d || !d.isDragging || !d.scrollEl) { autoScrollRef.current = null; return }
        d.scrollEl.scrollTop += d.scrollVelocity || 0
        autoScrollRef.current = requestAnimationFrame(step)
      }
      autoScrollRef.current = requestAnimationFrame(step)
    }
    if (dragRef.current) dragRef.current.scrollVelocity = velocity
  }

  const handleDragStart = (e, index) => {
    e.preventDefault()
    e.stopPropagation()
    const itemEl = e.currentTarget.parentElement
    const rect = itemEl.getBoundingClientRect()
    dragRef.current = {
      index,
      itemEl,
      scrollEl: getScrollParent(itemEl),
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      isDragging: false,
      ghostEl: null,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    setDraggingIndex(index)
  }

  const handleDragMove = (e, index) => {
    const d = dragRef.current
    if (!d || d.index !== index) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (!d.isDragging && Math.sqrt(dx * dx + dy * dy) > 6) {
      d.isDragging = true
      const ghost = d.itemEl.cloneNode(true)
      ghost.removeAttribute('style')
      ghost.style.cssText = [
        'position:fixed',
        `width:${d.itemEl.offsetWidth}px`,
        `height:${d.itemEl.offsetHeight}px`,
        'pointer-events:none',
        'z-index:9999',
        'opacity:0.85',
        'border:2px solid var(--color-gold)',
        'border-radius:8px',
        'transform:scale(1.06)',
        'box-shadow:0 8px 20px rgba(0,0,0,0.6)',
        'overflow:hidden',
      ].join(';')
      document.body.appendChild(ghost)
      d.ghostEl = ghost
    }
    if (d.isDragging && d.ghostEl) {
      d.ghostEl.style.left = (e.clientX - d.offsetX) + 'px'
      d.ghostEl.style.top = (e.clientY - d.offsetY) + 'px'
      d.ghostEl.style.display = 'none'
      const topEl = document.elementFromPoint(e.clientX, e.clientY)
      d.ghostEl.style.display = ''
      let target = topEl
      while (target && target.dataset?.invSlotIndex == null) target = target.parentElement
      const raw = target?.dataset.invSlotIndex
      const newOver = raw != null && Number(raw) !== index ? Number(raw) : null
      overRef.current = newOver
      if (newOver !== overIndex) setOverIndex(newOver)
      updateAutoScroll(e.clientY)
    }
  }

  const finishDrag = (index, commit) => {
    const d = dragRef.current
    if (!d || d.index !== index) return
    stopAutoScroll()
    if (d.ghostEl) d.ghostEl.remove()
    if (commit && d.isDragging && overRef.current != null && overRef.current !== index) {
      onReorder?.(index, overRef.current)
    }
    setDraggingIndex(null)
    setOverIndex(null)
    overRef.current = null
    dragRef.current = null
  }

  useEffect(() => () => {
    if (dragRef.current?.ghostEl) dragRef.current.ghostEl.remove()
    if (autoScrollRef.current != null) cancelAnimationFrame(autoScrollRef.current)
  }, [])

  return (
    <div class={gridClass}>
      {inventory.map((slot, i) => {
        const isDragging = draggingIndex === i
        const isOver = overIndex === i && draggingIndex != null
        return (
          <div key={i} data-inv-slot-index={i} class={`relative ${isDragging ? 'opacity-30' : ''}`}>
            <ItemSlot
              slot={slot}
              onClick={onSlotClick ? (s, item) => onSlotClick(s, item, i) : undefined}
              size={size}
              showName={showName}
              highlight={isOver}
            />
            {slot && (
              <span
                class="absolute bottom-0.5 right-0.5 text-[10px] text-[var(--color-parchment)] opacity-25 leading-none select-none z-10 px-0.5 cursor-grab"
                style={{ touchAction: 'none' }}
                onPointerDown={(e) => handleDragStart(e, i)}
                onPointerMove={(e) => handleDragMove(e, i)}
                onPointerUp={(e) => finishDrag(i, true)}
                onPointerCancel={(e) => finishDrag(i, false)}
              >
                ⠿
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
