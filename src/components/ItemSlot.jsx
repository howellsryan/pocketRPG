import itemsData from '../data/items.json'
import { formatQuantity } from '../utils/helpers'

const TYPE_COLORS = {
  weapon: 'border-[var(--color-blood)]/40',
  armour: 'border-[var(--color-mana)]/40',
  food: 'border-[var(--color-emerald)]/40',
  resource: 'border-[var(--color-gold-dim)]/40',
  ammo: 'border-[var(--color-parchment)]/20',
  currency: 'border-[var(--color-gold)]/40',
  default: 'border-[#333]'
}

export default function ItemSlot({ slot, onClick, size = 'normal', showName = false, highlight = false }) {
  if (!slot) {
    return (
      <div class={`${size === 'small' ? 'w-10 h-10' : 'w-14 h-14'} rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center`}>
        <span class="text-[#2a2a2a] text-xs">—</span>
      </div>
    )
  }

  const item = itemsData[slot.itemId]
  if (!item) return null

  const borderClass = TYPE_COLORS[item.type] || TYPE_COLORS.default
  const emoji = item.icon || '📦'

  return (
    <button
      onClick={() => onClick?.(slot, item)}
      class={`${size === 'small' ? 'w-10 h-10' : 'w-14 h-14'} rounded-lg bg-[#1a1a1a] border ${borderClass}
        flex flex-col items-center justify-center relative
        active:bg-[#252525] transition-colors
        ${highlight ? 'ring-1 ring-[var(--color-gold)]' : ''}`}
    >
      <span class={size === 'small' ? 'text-sm' : 'text-lg'}>{emoji}</span>
      {slot.noted && (
        <span class="absolute top-0 left-0.5 text-[8px]">📜</span>
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
        <span class="text-[7px] text-[var(--color-parchment)] opacity-60 truncate w-full text-center mt-0.5 px-0.5">
          {item.name}
        </span>
      )}
    </button>
  )
}
