import { useState } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import GameIcon from '../components/GameIcon.jsx'
import SkillScreenHeader from '../components/SkillScreenHeader.jsx'
import SkillActionRow from '../components/SkillActionRow.jsx'
import SectionHeader from '../components/SectionHeader.jsx'
import { getLevelFromXP } from '../engine/experience.js'
import { countItem, addItem, removeItem } from '../engine/inventory.js'
import { SUMMONING_CREATURES, getPouchRecipe, getScrollRecipe, SCROLLS_PER_POUCH } from '../engine/summoning.js'
import itemsData from '../data/items.json'

const QTY_OPTIONS = [
  { id: '1', label: '1' },
  { id: '10', label: '10' },
  { id: 'all', label: 'All' },
]

function itemName(id) {
  return itemsData[id]?.name || id
}

// Max times a recipe can run given only what's in the inventory.
function maxCraftTimes(recipe, inventory) {
  let max = Infinity
  for (const [id, qty] of Object.entries(recipe.materials)) {
    max = Math.min(max, Math.floor(countItem(inventory, id) / qty))
  }
  return max === Infinity ? 0 : max
}

export default function SummoningScreen({ onBack }) {
  const { stats, inventory, updateInventory, addToast } = useGame()
  const summoningLevel = getLevelFromXP(stats.summoning?.xp || 0)
  const [qty, setQty] = useState('1')

  const craft = (recipe) => {
    const maxTimes = maxCraftTimes(recipe, inventory)
    const times = qty === 'all' ? maxTimes : Math.min(Number(qty), maxTimes)
    if (times <= 0) {
      addToast('Not enough materials', 'error')
      return
    }
    const inv = [...inventory]
    for (const [id, per] of Object.entries(recipe.materials)) removeItem(inv, id, per * times)
    const added = addItem(inv, recipe.product, recipe.productQty * times, !!itemsData[recipe.product]?.stackable)
    if (!added) {
      addToast('Inventory full', 'error')
      return
    }
    updateInventory(inv)
    addToast(`Made ${(recipe.productQty * times).toLocaleString()} ${itemName(recipe.product)}`, 'success')
  }

  const renderRow = (creature, recipe, kind) => {
    const available = summoningLevel >= creature.level
    const maxTimes = available ? maxCraftTimes(recipe, inventory) : 0
    const matLine = Object.entries(recipe.materials)
      .map(([id, per]) => `${per}× ${itemName(id)}`)
      .join(' + ')
    return (
      <SkillActionRow
        key={`${kind}_${creature.id}`}
        icon={<GameIcon iconKey="summoning" size={26} />}
        title={kind === 'pouch' ? `${creature.name} Pouch` : `${creature.name} Scroll (${SCROLLS_PER_POUCH})`}
        meta={<>
          <span class="text-[var(--color-gold)] font-bold opacity-100">Lv {creature.level}</span> · {matLine}
          {available && maxTimes <= 0 && <span class="block text-[var(--color-blood-ember)] mt-1">Not enough materials in inventory</span>}
        </>}
        chip={<>{maxTimes.toLocaleString()} makeable</>}
        locked={!available}
        lockBadge={`LV ${creature.level}`}
        lockHint={`Unlocks at Summoning ${creature.level}`}
        disabled={available && maxTimes <= 0}
        onClick={() => craft(recipe)}
      />
    )
  }

  return (
    <div class="forge-shell h-full overflow-y-auto p-4">
      <SkillScreenHeader
        skill="summoning"
        title="Summoning"
        xp={stats.summoning?.xp || 0}
        level={summoningLevel}
        onBack={onBack}
      />

      <div class="flex items-center gap-2 mb-4">
        <span class="text-[10px] text-[var(--color-parchment)] opacity-60 uppercase tracking-wider">Make</span>
        <div class="flex gap-1.5">
          {QTY_OPTIONS.map(opt => (
            <button
              key={opt.id}
              class={`min-w-[44px] min-h-[32px] px-3 rounded-[8px] text-[12px] font-bold border ${qty === opt.id ? 'bg-[var(--color-gold)] text-[var(--color-void)] border-[var(--color-gold)]' : 'text-[var(--color-parchment)] border-[var(--color-parchment)] opacity-70'}`}
              onClick={() => setQty(opt.id)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <SectionHeader className="mb-2.5">Make Pouches</SectionHeader>
      <p class="text-[10px] text-[var(--color-parchment)] opacity-40 mb-2.5">Infuse a charm and a secondary into a creature pouch. Pouches summon a creature in combat, or infuse into scrolls below.</p>
      <div class="flex flex-col gap-2.5 mb-6">
        {SUMMONING_CREATURES.map(c => renderRow(c, getPouchRecipe(c), 'pouch'))}
      </div>

      <SectionHeader className="mb-2.5">Infuse Scrolls</SectionHeader>
      <p class="text-[10px] text-[var(--color-parchment)] opacity-40 mb-2.5">Infuse one pouch into {SCROLLS_PER_POUCH} scrolls. A summoned creature spends one scroll per attack.</p>
      <div class="flex flex-col gap-2.5 mb-6">
        {SUMMONING_CREATURES.map(c => renderRow(c, getScrollRecipe(c), 'scroll'))}
      </div>

      <p class="text-[10px] text-[var(--color-parchment)] opacity-40 text-center mt-2">
        Summoning XP is earned only by summoning a creature during a live fight.
      </p>
    </div>
  )
}
