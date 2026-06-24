import GameIcon from './GameIcon.jsx'

// Horizontal, scrollable, single-select filter chips. Reusable across screens
// for switching a view between mutually exclusive options.
//   options: [{ id, label, icon?, iconKey? }]
//   value:   id of the active option
//   onChange(id)
// An `iconKey` renders a tinted game-icons glyph (inherits the chip text colour);
// `icon` is a plain emoji fallback.
export default function FilterToggleBar({ options, value, onChange, className = '' }) {
  return (
    <div class={`flex gap-[6px] overflow-x-auto pb-1 ${className}`}>
      {options.map(opt => {
        const isActive = opt.id === value
        const pillClass = isActive
          ? 'border-[var(--color-gold)] bg-[rgba(212,175,55,0.15)] text-[var(--color-gold)] opacity-100'
          : 'border-[#2a2a2a] bg-[var(--color-void-light)] text-[var(--color-parchment)] opacity-60'
        return (
          <button
            key={opt.id}
            onClick={() => onChange(opt.id)}
            class={`flex-shrink-0 inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-[20px] text-[11px] font-semibold border whitespace-nowrap ${pillClass}`}
          >
            {opt.iconKey
              ? <GameIcon iconKey={opt.iconKey} size={16} class="flex-shrink-0" />
              : opt.icon ? <span class="flex-shrink-0">{opt.icon}</span> : null}
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
