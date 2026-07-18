import farmingData from '../data/farming.json'
import SkillIcon from '../components/SkillIcon.jsx'
import SkillScreenHeader from '../components/SkillScreenHeader.jsx'
import SkillInfoBanner from '../components/SkillInfoBanner.jsx'
import SkillActionRow from '../components/SkillActionRow.jsx'
import { getReadyPatchSummaryForLocation } from '../engine/farming.ts'

const patchTypeLabels = {
  herb: 'Herb Patch',
  tree: 'Tree Patch',
  fruitTree: 'Fruit Tree Patch',
  vegetable: 'Vegetable Patch'
}

const readyTypeLabels = {
  herb: 'Herb',
  tree: 'Tree',
  fruitTree: 'Fruit tree',
  vegetable: 'Vegetable'
}

export default function FarmLocationPicker({ farmingLevel, farmingXp = 0, farming, onSelectLocation, onBack, onHarvestAll, onPlantAll }) {
  return (
    <div class="forge-shell h-full overflow-y-auto p-4">
      <SkillScreenHeader
        skill="farming"
        title="Farming"
        xp={farmingXp}
        level={farmingLevel}
        onBack={onBack}
      />

      <div class="flex gap-2 mb-4">
        <button onClick={onHarvestAll} class="min-h-[44px] flex-1 px-3 rounded-xl border border-[rgba(212,160,23,0.42)] bg-[rgba(212,160,23,0.08)] text-[13px] font-semibold text-[var(--color-gold)] active:opacity-80">Harvest All</button>
        <button onClick={onPlantAll} class="min-h-[44px] flex-1 px-3 rounded-xl border border-[var(--color-void-border)] bg-[var(--color-void-light)] text-[13px] font-semibold text-[var(--color-parchment)] active:opacity-80">Plant All</button>
      </div>

      <SkillInfoBanner
        icon={<SkillIcon skill="farming" size={19} />}
        className="mb-4"
      >
        Plant seeds at farms and harvest crops over time.
      </SkillInfoBanner>

      <div class="flex flex-col gap-2.5">
        {farmingData.locations.map(location => {
          const readySummary = getReadyPatchSummaryForLocation(farming, location.id)
          const hasReady = readySummary.length > 0
          return (
            <SkillActionRow
              key={location.id}
              icon={<SkillIcon skill="farming" size={26} />}
              title={location.name}
              meta={<>
                {location.patches.map(p => `${p.count}× ${patchTypeLabels[p.type]}`).join(' · ')}
                {hasReady && <span class="block text-[var(--color-gold)] font-semibold mt-1">Ready: {readySummary.map(({ type, count }) => `${readyTypeLabels[type]} ×${count}`).join(' · ')}</span>}
              </>}
              chip={hasReady ? <>🌾 Ready</> : null}
              active={hasReady}
              onClick={() => onSelectLocation(location.id)}
            />
          )
        })}
      </div>
    </div>
  )
}
