import GameIcon from './GameIcon.jsx'

// Horizontal, scrollable, single-select filter chips. Reusable across screens
// for switching a view between mutually exclusive options.
//   options: [{ id, label, icon?, iconKey?, item? }]
//   value:   id of the active option
//   onChange(id)
// An `item` renders its tier-tinted game-icons glyph (keeps the item's own
// colour); an `iconKey` renders a tinted glyph inheriting the chip text colour;
// `icon` is a plain emoji fallback.
export default function FilterToggleBar({ options, value, onChange, className = '' }) {
  return (
    <div class={`flex gap-[6px] overflow-x-auto pb-1 ${className}`}>
      {options.map(opt => {
        const isActive = opt.id === value
        return (
          <button
            key={opt.id}
            onClick={() => onChange(opt.id)}
            class={`fm-toggle fm-toggle--sm flex-shrink-0 whitespace-nowrap${isActive ? ' is-on' : ''}`}
          >
            {opt.item
              ? <GameIcon item={opt.item} size={16} class="flex-shrink-0" />
              : opt.iconKey
                ? <GameIcon iconKey={opt.iconKey} size={16} class="flex-shrink-0" />
                : opt.icon ? <span class="flex-shrink-0">{opt.icon}</span> : null}
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
