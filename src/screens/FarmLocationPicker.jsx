import farmingData from '../data/farming.json'

export default function FarmLocationPicker({ farmingLevel, onSelectLocation, onBack }) {
  return (
    <div class="h-full overflow-y-auto p-4">
      {onBack && (
        <button onClick={onBack} class="text-xs text-[var(--color-gold-dim)] mb-3 flex items-center gap-1">
          ← Skills
        </button>
      )}
      <div class="flex items-center justify-between mb-1">
        <h2 class="font-[var(--font-display)] text-sm font-bold text-[var(--color-parchment)] opacity-60 uppercase tracking-wider">
          Farming Locations
        </h2>
        <span class="text-xs font-[var(--font-mono)] text-[var(--color-gold)]">Lv {farmingLevel}</span>
      </div>

      <div class="mb-3 bg-[#111] rounded-lg px-3 py-2 text-[11px] text-[var(--color-parchment)] opacity-60 flex items-center gap-2">
        <span>🌾</span>
        <span>Plant seeds at farms and harvest crops over time</span>
      </div>

      <div class="space-y-2">
        {farmingData.locations.map(location => (
          <button
            key={location.id}
            onClick={() => onSelectLocation(location.id)}
            class="w-full flex items-center justify-between p-3 rounded-xl border transition-colors text-left bg-[#1a1a1a] border-[#2a2a2a] active:bg-[#222]"
          >
            <div class="flex-1">
              <div class="text-sm font-semibold text-[var(--color-parchment)]">{location.name}</div>
              <div class="text-[10px] text-[var(--color-parchment)] opacity-40 mt-0.5">
                {location.patches.map(p => `${p.count}× ${p.type}`).join(' · ')}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
