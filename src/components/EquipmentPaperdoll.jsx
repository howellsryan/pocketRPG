import Card from './Card.jsx'
import GameIcon from './GameIcon.jsx'

const EQ_SLOT_LABELS = {
  head: '🪖', cape: '🧣', neck: '📿', ammo: '🏹',
  weapon: '🗡️', body: '👕', shield: '🛡️',
  legs: '👖', gloves: '🧤', boots: '👢', ring: '💍'
}

const EQ_SLOT_NAMES = {
  head: 'Head', cape: 'Cape', neck: 'Neck', ammo: 'Ammo',
  weapon: 'Weapon', body: 'Body', shield: 'Shield',
  legs: 'Legs', gloves: 'Gloves', boots: 'Boots', ring: 'Ring'
}

const SIZE_PRESETS = {
  sm: { box: 'w-11 h-11', icon: '14px', label: 'text-[6px] max-w-[40px]', emptyIcon: '12px', gap: 'gap-[4px]' },
  md: { box: 'w-14 h-14 lg:w-20 lg:h-20', icon: '18px', label: 'text-[7px] lg:text-[10px] max-w-[52px] lg:max-w-[72px]', emptyIcon: '14px', gap: 'gap-[6px] lg:gap-3' },
  mdFixed: { box: 'w-16 h-16', icon: '18px', label: 'text-[7px] max-w-[52px]', emptyIcon: '14px', gap: 'gap-[6px]' }
}

function EquipSlot({ slotName, equipment, itemsData, onSelect, size = 'md' }) {
  const entry = equipment[slotName]
  const item = entry ? itemsData[entry.itemId] : null
  const isEmpty = !item
  const charges = entry?.charges || 0
  const ammoQuantity = slotName === 'ammo' ? Number(entry?.quantity || 1) : 1
  const preset = SIZE_PRESETS[size] || SIZE_PRESETS.md

  const bgClass = isEmpty ? 'bg-[#111] border-[#222] opacity-40' : 'bg-[var(--color-void-light)] border-[#444]'
  const cursorClass = item ? 'cursor-pointer' : 'cursor-default'

  return (
    <button
      onClick={() => { if (item && onSelect) onSelect(slotName, item) }}
      class={`${preset.box} rounded-[10px] border flex flex-col items-center justify-center relative ${bgClass} ${cursorClass}`}
    >
      {item
        ? <GameIcon item={item} size={parseInt(preset.icon, 10)} />
        : <span style={{ fontSize: preset.emptyIcon }}>{EQ_SLOT_LABELS[slotName]}</span>
      }
      {charges > 0 && (
        <span class="absolute bottom-[2px] right-[2px] text-[8px] text-[#4ade80] font-bold">⚡</span>
      )}
      {ammoQuantity > 1 && (
        <span class="absolute top-[2px] right-[2px] text-[8px] text-[var(--color-gold)] font-bold">{ammoQuantity}</span>
      )}
      <span
        class={`${preset.label} text-center mt-[2px] ${item ? 'text-[var(--color-parchment)] font-semibold' : 'text-[#555]'}`}
      >
        {item ? item.name : EQ_SLOT_NAMES[slotName]}
      </span>
    </button>
  )
}

/**
 * Visual equipment paperdoll. Renders the 5-row slot layout used by the
 * Equipment screen. Click any equipped slot to fire onSelect(slotName, item).
 */
export default function EquipmentPaperdoll({
  equipment,
  itemsData,
  onSelect,
  size = 'md',
  className = '',
  asCard = true
}) {
  const slotProps = { equipment, itemsData, onSelect, size }
  const preset = SIZE_PRESETS[size] || SIZE_PRESETS.md

  const grid = (
    <div class={`flex flex-col items-center ${preset.gap} ${className}`}>
      <div class="flex justify-center">
        <EquipSlot slotName="head" {...slotProps} />
      </div>
      <div class={`flex ${preset.gap} justify-center`}>
        <EquipSlot slotName="cape" {...slotProps} />
        <EquipSlot slotName="neck" {...slotProps} />
        <EquipSlot slotName="ammo" {...slotProps} />
      </div>
      <div class={`flex ${preset.gap} justify-center`}>
        <EquipSlot slotName="weapon" {...slotProps} />
        <EquipSlot slotName="body" {...slotProps} />
        <EquipSlot slotName="shield" {...slotProps} />
      </div>
      <div class="flex justify-center">
        <EquipSlot slotName="legs" {...slotProps} />
      </div>
      <div class={`flex ${preset.gap} justify-center`}>
        <EquipSlot slotName="gloves" {...slotProps} />
        <EquipSlot slotName="boots" {...slotProps} />
        <EquipSlot slotName="ring" {...slotProps} />
      </div>
    </div>
  )

  if (!asCard) return grid

  return (
    <Card
      padding="p-4"
      className="flex flex-col items-center"
      style={{ background: 'linear-gradient(135deg, #141414, #0f0f0f)' }}
    >
      {grid}
    </Card>
  )
}
