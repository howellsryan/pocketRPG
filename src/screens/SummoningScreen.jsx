import { useGame } from '../state/gameState.jsx'
import GameIcon from '../components/GameIcon.jsx'
import SkillScreenHeader from '../components/SkillScreenHeader.jsx'
import SkillActionRow from '../components/SkillActionRow.jsx'
import SectionHeader from '../components/SectionHeader.jsx'
import { getLevelFromXP } from '../engine/experience.js'
import { emptySession } from '../engine/activitySession.js'
import { SUMMONING_CREATURES, getPouchRecipe, getScrollRecipe, SCROLLS_PER_POUCH, CRAFT_ACTION_TICKS, craftableTimes } from '../engine/summoning.js'
import itemsData from '../data/items.json'

function itemName(id) {
  return itemsData[id]?.name || id
}

// A summoning recipe → a standard skill-action object. The background runner
// (App onTick), idle catch-up, and skip-hour all drive it through the generic
// `type:'skill'` path (simulateIdleSkilling), so crafting idles and skips like
// any other production skill.
function actionFor(kind, creature, recipe) {
  return {
    id: `summon_${kind}_${creature.id}`,
    name: kind === 'pouch' ? `${creature.name} Pouch` : `${creature.name} Scroll`,
    skill: 'summoning',
    ticks: CRAFT_ACTION_TICKS,
    xp: recipe.xp,
    materials: recipe.materials,
    product: recipe.product,
    productQty: recipe.productQty,
  }
}

export default function SummoningScreen({ onBack }) {
  const { stats, inventory, bank, activeTask, setActiveTask, requestActivityStart, addToast } = useGame()
  const summoningLevel = getLevelFromXP(stats.summoning?.xp || 0)

  const activeAction = (activeTask?.type === 'skill' && activeTask.skill === 'summoning') ? activeTask.action : null

  const recipeFor = (kind, creature) =>
    kind === 'pouch' ? getPouchRecipe(creature) : getScrollRecipe(creature)

  const toggle = (kind, creature, recipe) => {
    const action = actionFor(kind, creature, recipe)
    if (activeAction?.id === action.id) { setActiveTask(null); return }
    if (craftableTimes(recipe, inventory, bank) <= 0) { addToast('Not enough materials', 'error'); return }
    if (!requestActivityStart({ type: 'skill', skill: 'summoning', action })) return
    setActiveTask({ type: 'skill', skill: 'summoning', action, bankingEnabled: true, session: emptySession(Date.now()) })
  }

  const renderRow = (creature, kind) => {
    const recipe = recipeFor(kind, creature)
    const action = actionFor(kind, creature, recipe)
    const available = summoningLevel >= creature.level
    const maxTimes = available ? craftableTimes(recipe, inventory, bank) : 0
    const isActive = activeAction?.id === action.id
    const total = (isActive && activeTask.totalTicks) || CRAFT_ACTION_TICKS
    const remaining = isActive && typeof activeTask.ticksRemaining === 'number' ? activeTask.ticksRemaining : total
    const progress = isActive ? Math.max(0, Math.min(1, 1 - remaining / total)) : 0
    const matLine = Object.entries(recipe.materials)
      .map(([id, per]) => `${per}× ${itemName(id)}`)
      .join(' + ')
    return (
      <SkillActionRow
        key={`${kind}_${creature.id}`}
        icon={<GameIcon iconKey={creature.pouch} size={26} />}
        title={kind === 'pouch' ? `${creature.name} Pouch` : `${creature.name} Scroll (${SCROLLS_PER_POUCH})`}
        active={isActive}
        meta={<>
          <span class="text-[var(--color-gold)] font-bold opacity-100">Lv {creature.level}</span> · {matLine} · {recipe.xp} xp
          {available && !isActive && maxTimes <= 0 && <span class="block text-[var(--color-blood-ember)] mt-1">Not enough materials</span>}
        </>}
        chip={isActive ? <>Making…</> : <>{maxTimes.toLocaleString()} makeable</>}
        locked={!available}
        lockBadge={`LV ${creature.level}`}
        lockHint={`Unlocks at Summoning ${creature.level}`}
        disabled={available && !isActive && maxTimes <= 0}
        onClick={() => toggle(kind, creature, recipe)}
        below={isActive && (
          <div class="mt-1 h-1.5 rounded-full bg-[var(--color-void)] overflow-hidden">
            <div class="h-full bg-[var(--color-gold)] transition-[width] duration-150" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
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

      <SectionHeader className="mb-2.5">Make Pouches</SectionHeader>
      <p class="text-[10px] text-[var(--color-parchment)] opacity-40 mb-2.5">Infuse a charm, a secondary, and an empty pouch into a creature pouch — one every {CRAFT_ACTION_TICKS} ticks. Pouches summon a creature in combat, or infuse into scrolls below. Materials are drawn from your inventory and bank.</p>
      <div class="flex flex-col gap-2.5 mb-6">
        {SUMMONING_CREATURES.map(c => renderRow(c, 'pouch'))}
      </div>

      <SectionHeader className="mb-2.5">Infuse Scrolls</SectionHeader>
      <p class="text-[10px] text-[var(--color-parchment)] opacity-40 mb-2.5">Infuse one pouch into {SCROLLS_PER_POUCH} scrolls — one batch every {CRAFT_ACTION_TICKS} ticks. A summoned creature spends one scroll per attack.</p>
      <div class="flex flex-col gap-2.5 mb-6">
        {SUMMONING_CREATURES.map(c => renderRow(c, 'scroll'))}
      </div>

      <p class="text-[10px] text-[var(--color-parchment)] opacity-40 text-center mt-2">
        Making pouches and infusing scrolls both grant Summoning XP, and keep running while you're away — idle catch-up and Skip 1h settle them like any skill. Tap a running action again to stop it.
      </p>
    </div>
  )
}
