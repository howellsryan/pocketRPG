import { useState } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import GameIcon from '../components/GameIcon.jsx'
import SkillScreenHeader from '../components/SkillScreenHeader.jsx'
import SkillActionRow from '../components/SkillActionRow.jsx'
import SkillActivePanel from '../components/SkillActivePanel.jsx'
import SectionHeader from '../components/SectionHeader.jsx'
import { getLevelFromXP } from '../engine/experience.js'
import { grindmanXP } from '../engine/grindman.js'
import { emptySession, ratePerHour } from '../engine/activitySession.js'
import { getActionProgress } from '../hooks/useActionTick.js'
import { formatNumber } from '../utils/helpers.js'
import { formatActionDuration } from '../utils/formatters.js'
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
  const { stats, inventory, bank, activeTask, setActiveTask, requestActivityStart, addToast, isGrindman } = useGame()
  const summoningLevel = getLevelFromXP(stats.summoning?.xp || 0)

  const activeAction = (activeTask?.type === 'skill' && activeTask.skill === 'summoning') ? activeTask.action : null
  // Show the active-action panel while a craft runs (matching every other
  // skill). Back drops to the list but leaves the task running; re-entering the
  // screen resumes straight onto the panel.
  const [showPanel, setShowPanel] = useState(!!activeAction)

  const recipeFor = (kind, creature) =>
    kind === 'pouch' ? getPouchRecipe(creature) : getScrollRecipe(creature)

  const toggle = (kind, creature, recipe) => {
    const action = actionFor(kind, creature, recipe)
    if (activeAction?.id === action.id) { setActiveTask(null); setShowPanel(false); return }
    if (craftableTimes(recipe, inventory, bank) <= 0) { addToast('Not enough materials', 'error'); return }
    if (!requestActivityStart({ type: 'skill', skill: 'summoning', action })) return
    setActiveTask({ type: 'skill', skill: 'summoning', action, bankingEnabled: true, session: emptySession(Date.now()) })
    setShowPanel(true)
  }

  const stop = () => { setActiveTask(null); setShowPanel(false) }

  // Active-action panel — the "action screen" every skill drops into on start.
  if (activeAction && showPanel) {
    const totalTicks = activeTask?.totalTicks || CRAFT_ACTION_TICKS
    const ticksRemaining = activeTask?.ticksRemaining ?? totalTicks
    const progress = getActionProgress(true, ticksRemaining, totalTicks)
    const session = activeTask?.session || emptySession()
    const actionsPerHr = ratePerHour(session.actions, session.startedAt)
    const xpPerHr = ratePerHour(session.xp, session.startedAt)
    const productItem = itemsData[activeAction.product]
    return (
      <SkillActivePanel
        skill="summoning"
        icon={productItem ? <GameIcon item={productItem} size={50} /> : undefined}
        title={activeAction.name}
        progress={progress}
        producing={productItem && <>
          <GameIcon item={productItem} size={32} />
          <span class="text-[12px] font-semibold text-[var(--color-parchment)] opacity-60">Making</span>
          <span class="text-[13px] font-semibold text-[var(--color-gold-dim)]">{productItem.name}</span>
        </>}
        stats={[
          { label: 'Actions completed', value: (session.actions || 0).toLocaleString() },
          { label: 'Actions / hr', value: actionsPerHr !== null ? actionsPerHr.toLocaleString() : '—', accent: actionsPerHr !== null },
          { label: 'XP gained', value: formatNumber(session.xp || 0) },
          { label: 'XP / hr', value: xpPerHr !== null ? formatNumber(xpPerHr) : '—', accent: xpPerHr !== null },
        ]}
        onBack={() => setShowPanel(false)}
        onStop={stop}
      />
    )
  }

  const renderRow = (creature, kind) => {
    const recipe = recipeFor(kind, creature)
    const action = actionFor(kind, creature, recipe)
    const available = summoningLevel >= creature.level
    const levelLocked = !available
    const maxTimes = available ? craftableTimes(recipe, inventory, bank) : 0
    const isActive = activeAction?.id === action.id
    const productItem = itemsData[recipe.product]
    return (
      <SkillActionRow
        key={`${kind}_${creature.id}`}
        icon={<GameIcon item={productItem} size={52} />}
        title={kind === 'pouch' ? `${creature.name} Pouch` : `${creature.name} Scroll (${SCROLLS_PER_POUCH})`}
        active={isActive}
        meta={<>
          <span class="text-[var(--color-gold)] font-bold opacity-100">Lv {creature.level}</span> · {grindmanXP(recipe.xp, isGrindman)} XP · {formatActionDuration(CRAFT_ACTION_TICKS)}
          <span class="text-[var(--color-gold)]"> · {maxTimes.toLocaleString()} actions</span>
          {available && !isActive && maxTimes <= 0 && <span class="block text-[var(--color-blood-ember)] mt-1">Not enough materials</span>}
        </>}
        below={!levelLocked ? <span class="text-[12.5px] font-semibold text-[var(--color-gold)]">{Object.entries(recipe.materials).map(([id, per]) => `${itemName(id)} ×${per}`).join(', ')}</span> : undefined}
        locked={levelLocked}
        lockBadge={`LV ${creature.level}`}
        lockHint={`Unlocks at Summoning ${creature.level}`}
        disabled={available && !isActive && maxTimes <= 0}
        onClick={() => toggle(kind, creature, recipe)}
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
