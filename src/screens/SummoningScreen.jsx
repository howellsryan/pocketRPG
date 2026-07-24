import { useState, useEffect, useRef } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import GameIcon from '../components/GameIcon.jsx'
import SkillScreenHeader from '../components/SkillScreenHeader.jsx'
import SkillActionRow from '../components/SkillActionRow.jsx'
import SectionHeader from '../components/SectionHeader.jsx'
import { getLevelFromXP } from '../engine/experience.js'
import { SUMMONING_CREATURES, getPouchRecipe, getScrollRecipe, SCROLLS_PER_POUCH, CRAFT_ACTION_TICKS, craftableTimes, craftOnce } from '../engine/summoning.js'
import itemsData from '../data/items.json'

function itemName(id) {
  return itemsData[id]?.name || id
}

export default function SummoningScreen({ onBack }) {
  const TICK_MS = 600
  const { stats, inventory, bank, updateInventory, updateBankDirect, grantXP, addToast } = useGame()
  const summoningLevel = getLevelFromXP(stats.summoning?.xp || 0)

  // The running action: { kind, creatureId } or null. Its tick counter lives in
  // a ref so the interval reads the latest without re-subscribing each tick.
  const [running, setRunning] = useState(null)
  const [tickInAction, setTickInAction] = useState(0)
  const inventoryRef = useRef(inventory)
  const bankRef = useRef(bank)
  const counterRef = useRef(0)
  useEffect(() => { inventoryRef.current = inventory }, [inventory])
  useEffect(() => { bankRef.current = bank }, [bank])

  const recipeFor = (kind, creature) =>
    kind === 'pouch' ? getPouchRecipe(creature) : getScrollRecipe(creature)

  const stop = () => { counterRef.current = 0; setTickInAction(0); setRunning(null) }

  useEffect(() => {
    if (!running) return
    const creature = SUMMONING_CREATURES.find((c) => c.id === running.creatureId)
    const recipe = recipeFor(running.kind, creature)
    if (!recipe) { stop(); return }
    const interval = setInterval(() => {
      counterRef.current += 1
      if (counterRef.current < CRAFT_ACTION_TICKS) { setTickInAction(counterRef.current); return }
      counterRef.current = 0
      setTickInAction(0)
      const result = craftOnce(recipe, inventoryRef.current, bankRef.current, itemsData)
      if (!result.ok) {
        addToast(result.reason === 'full' ? 'Inventory full' : 'Out of materials', 'error')
        stop()
        return
      }
      updateInventory(result.newInventory)
      if (Object.keys(result.bankUpdates).length > 0) updateBankDirect(result.bankUpdates)
      if (result.xp > 0) grantXP('summoning', result.xp)
    }, TICK_MS)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running])

  const toggle = (kind, creature, recipe) => {
    if (running && running.kind === kind && running.creatureId === creature.id) { stop(); return }
    if (craftableTimes(recipe, inventory, bank) <= 0) { addToast('Not enough materials', 'error'); return }
    counterRef.current = 0
    setTickInAction(0)
    setRunning({ kind, creatureId: creature.id })
  }

  const renderRow = (creature, kind) => {
    const recipe = recipeFor(kind, creature)
    const available = summoningLevel >= creature.level
    const maxTimes = available ? craftableTimes(recipe, inventory, bank) : 0
    const isActive = !!running && running.kind === kind && running.creatureId === creature.id
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
          {available && !isActive && maxTimes <= 0 && <span class="block text-[var(--color-blood-ember)] mt-1">Not enough materials (bank included)</span>}
        </>}
        chip={isActive ? <>Making…</> : <>{maxTimes.toLocaleString()} makeable</>}
        locked={!available}
        lockBadge={`LV ${creature.level}`}
        lockHint={`Unlocks at Summoning ${creature.level}`}
        disabled={available && !isActive && maxTimes <= 0}
        onClick={() => toggle(kind, creature, recipe)}
        below={isActive && (
          <div class="mt-1 h-1.5 rounded-full bg-[var(--color-void)] overflow-hidden">
            <div class="h-full bg-[var(--color-gold)] transition-[width] duration-150" style={{ width: `${Math.round((tickInAction / CRAFT_ACTION_TICKS) * 100)}%` }} />
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
        Making pouches and infusing scrolls both grant Summoning XP. Tap a running action again to stop it.
      </p>
    </div>
  )
}
