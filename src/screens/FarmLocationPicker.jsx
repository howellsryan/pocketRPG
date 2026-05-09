import farmingData from '../data/farming.json'
import { getReadyPatchSummaryForLocation } from '../engine/farming.ts'

const patchTypeLabels = {
  herb: 'Herb Patch',
  tree: 'Tree Patch',
  fruitTree: 'Fruit Tree Patch'
}

const readyTypeLabels = {
  herb: 'Herb',
  tree: 'Tree',
  fruitTree: 'Fruit tree'
}

export default function FarmLocationPicker({ farmingLevel, farming, onSelectLocation, onBack, onHarvestAll, onPlantAll }) {
  return (
    <div class="h-full overflow-y-auto p-4">
      {onBack && (
        <button onClick={onBack} class="text-xs text-[var(--color-gold-dim)] mb-3 flex items-center gap-1">
          ← Skills
        </button>
      )}
      <div class="flex items-start justify-between mb-1">
        <h2 class="font-[var(--font-display)] text-sm font-bold text-[var(--color-parchment)] opacity-60 uppercase tracking-wider">
          Farming Locations
        </h2>
        <div class="flex flex-col items-end gap-1">
          <span class="text-xs font-[var(--font-mono)] text-[var(--color-gold)]">Lv {farmingLevel}</span>
          <button onClick={onHarvestAll} class="min-h-[44px] px-3 rounded-lg border border-[var(--color-gold)] bg-[#201a08] text-xs font-semibold text-[var(--color-gold)]">Harvest All</button>
          <button onClick={onPlantAll} class="min-h-[44px] px-3 rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] text-xs font-semibold text-[var(--color-parchment)]">Plant All</button>
        </div>
      </div>

      <div class="mb-3 bg-[#111] rounded-lg px-3 py-2 text-[11px] text-[var(--color-parchment)] opacity-60 flex items-center gap-2">
        <span>🌾</span>
        <span>Plant seeds at farms and harvest crops over time</span>
      </div>

      <div class="space-y-2">
        {farmingData.locations.map(location => {
          const readySummary = getReadyPatchSummaryForLocation(farming, location.id)
          const hasReady = readySummary.length > 0
          return (
            <button
              key={location.id}
              onClick={() => onSelectLocation(location.id)}
              class={`w-full flex items-center justify-between p-3 rounded-xl border transition-colors text-left active:bg-[#222] ${
                hasReady ? 'bg-[#201a08] border-[var(--color-gold)]' : 'bg-[#1a1a1a] border-[#2a2a2a]'
              }`}
            >
              <div class="flex-1">
                <div class="text-sm font-semibold text-[var(--color-parchment)]">{location.name}</div>
                <div class="text-[10px] text-[var(--color-parchment)] opacity-40 mt-0.5">
                  {location.patches.map(p => `${p.count}× ${patchTypeLabels[p.type]}`).join(' · ')}
                </div>
                {hasReady && (
                  <div class="text-[10px] text-[var(--color-gold)] mt-1 font-semibold">
                    Ready: {readySummary.map(({ type, count }) => `${readyTypeLabels[type]} ×${count}`).join(' · ')}
                  </div>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
