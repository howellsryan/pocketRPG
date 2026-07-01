import itemsData from '../data/items.json'
import { formatQuantity } from '../utils/helpers'
import GameIcon from './GameIcon.jsx'

const TYPE_COLORS = {
  weapon: 'border-[var(--color-blood)]/40',
  armour: 'border-[var(--color-mana)]/40',
  food: 'border-[var(--color-emerald)]/40',
  resource: 'border-[var(--color-gold-dim)]/40',
  ammo: 'border-[var(--color-parchment)]/20',
  currency: 'border-[var(--color-gold)]/40',
  default: 'border-[var(--color-void-border)]'
}

export default function ItemSlot({ slot, onClick, size = 'normal', showName = false, highlight = false }) {
  const sizeClass = size === 'small'
    ? 'w-10 h-10'
    : size === 'inventory'
      ? 'w-14 h-14 md:w-20 md:h-20 lg:w-24 lg:h-24'
      : 'w-14 h-14'

  const iconSize = size === 'small'
    ? 16
    : size === 'inventory'
      ? 32
      : 20

  const nameSizeClass = size === 'inventory'
    ? 'text-[7px] md:text-[10px]'
    : 'text-[7px]'

  if (!slot) {
    return (
      <div class={`${sizeClass} rounded-lg bg-[var(--color-void-light)] border border-[var(--color-void-border)] flex items-center justify-center`}>
        <span class="text-[var(--color-void-border)] text-xs">—</span>
      </div>
    )
  }

  const item = itemsData[slot.itemId]
  if (!item) return null

  const borderClass = TYPE_COLORS[item.type] || TYPE_COLORS.default

  return (
    <button
      onClick={() => onClick?.(slot, item)}
      class={`${sizeClass} rounded-lg bg-[var(--color-void-light)] border ${borderClass}
        flex flex-col items-center justify-center relative
        active:bg-[var(--color-void-lighter)] transition-colors
        ${highlight ? 'ring-1 ring-[var(--color-gold)]' : ''}`}
    >
      <GameIcon item={item} size={iconSize} />
      {slot.noted && (
        <span class="absolute top-0 left-0.5 text-[8px]">📜</span>
      )}
      {slot.charges && slot.charges > 0 && (
        <span class="absolute bottom-0 left-0.5 text-[7px] font-bold text-[var(--color-emerald)]">⚡</span>
      )}
      {slot.quantity > 1 && (() => {
        const { text, isM } = formatQuantity(slot.quantity)
        return (
          <span class={`absolute top-0 right-0.5 text-[8px] font-[var(--font-mono)] font-bold ${isM ? 'text-[var(--color-emerald)]' : 'text-[var(--color-gold)]'}`}>
            {text}
          </span>
        )
      })()}
      {showName && (
        <span class={`${nameSizeClass} text-[var(--color-parchment)] opacity-60 truncate w-full text-center mt-0.5 px-0.5`}>
          {item.name}
        </span>
      )}
    </button>
  )
}
