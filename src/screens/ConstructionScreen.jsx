import { useState, useEffect, useRef } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import ProgressBar from '../components/ProgressBar.jsx'
import { getLevelFromXP } from '../engine/experience.js'
import { createSkillingState, processSkillingTick } from '../engine/skilling.js'
import { countItem, removeItem } from '../engine/inventory.js'
import { onTick } from '../engine/tick.js'
import { formatNumber } from '../utils/helpers.js'
import itemsData from '../data/items.json'

const BUILDING_ACTIONS = [
  { id: 'build_plank', name: 'Build with Plank', level: 1, ticks: 2, xp: 29, material: 'planks' },
  { id: 'build_oak_plank', name: 'Build with Oak Plank', level: 15, ticks: 2, xp: 60, material: 'oak_plank' },
  { id: 'build_teak_plank', name: 'Build with Teak Plank', level: 35, ticks: 2, xp: 90, material: 'teak_plank' },
  { id: 'build_mahogany_plank', name: 'Build with Mahogany Plank', level: 70, ticks: 2, xp: 140, material: 'mahogany_plank' },
]

const UNLOCKABLES = [
  {
    id: 'money_purse',
    name: 'Create Money Purse',
    level: 70,
    description: 'Spend coins directly from your bank when shopping, without withdrawing them first.',
    icon: '👛'
  },
  {
    id: 'master_rejuvenation',
    name: 'Create Master Rejuvenation',
    level: 90,
    description: 'Passively refills your special attack bar to 100% whenever it empties during a fight.',
    icon: '⚡'
  },
]

export default function ConstructionScreen({ onBack }) {
  const {
    stats, inventory, bank,
    grantXP, updateInventory, updateBankDirect, addToast,
    unlockedFeatures, unlockFeature, setActiveTask
  } = useGame()

  const constructionLevel = getLevelFromXP(stats.construction?.xp || 0)

  const [skilling, setSkilling] = useState(null)
  const skillingRef = useRef(null)
  const inventoryRef = useRef(inventory)
  const bankRef = useRef(bank)

  useEffect(() => { inventoryRef.current = inventory }, [inventory])
  useEffect(() => { bankRef.current = bank }, [bank])

  const startBuilding = (action) => {
    const state = { ...createSkillingState('construction', action), startedAt: Date.now() }
    setSkilling(state)
    skillingRef.current = state
    setActiveTask({ type: 'skill', skill: 'construction', action, bankingEnabled: false })
  }

  const stopBuilding = () => {
    if (skillingRef.current) {
      skillingRef.current = { ...skillingRef.current, active: false, stopped: true }
    }
    setSkilling(null)
    setActiveTask(null)
  }

  useEffect(() => {
    if (!skilling || !skilling.active) return
    skillingRef.current = skilling

    const unsub = onTick(() => {
      const state = skillingRef.current
      if (!state || !state.active || state.stopped) return

      const { skillingState, events } = processSkillingTick(state)
      skillingRef.current = skillingState

      for (const ev of events) {
        if (ev.type === 'actionComplete') {
          const matId = ev.action.material
          const curInv = [...inventoryRef.current]
          const invCount = countItem(curInv, matId)
          const bankCount = bankRef.current[matId]?.quantity || 0

          if (invCount + bankCount < 1) {
            skillingRef.current = { ...skillingState, active: false, stopped: true }
            setSkilling({ ...skillingState, active: false, stopped: true })
            addToast(`Out of ${itemsData[matId]?.name || matId}!`, 'error')
            return
          }

          if (invCount > 0) {
            removeItem(curInv, matId, 1)
            updateInventory(curInv)
          } else {
            updateBankDirect({ [matId]: -1 })
          }

          grantXP('construction', ev.xp)
        }
      }

      setSkilling({ ...skillingRef.current })
    })

    return unsub
  }, [skilling?.active])

  const handleUnlock = (unlockable) => {
    unlockFeature(unlockable.id)
    addToast(`${unlockable.icon} ${unlockable.name} complete!`, 'success')
  }

  if (skilling && skilling.active) {
    const progress = 1 - (skilling.ticksRemaining / skilling.action.ticks)
    return (
      <div class="h-full flex flex-col p-4">
        <div class="flex-1 flex flex-col items-center justify-center">
          <span class="text-4xl mb-2">🏠</span>
          <h2 class="font-[var(--font-display)] text-lg font-bold text-[var(--color-gold)] mb-1">
            {skilling.action.name}
          </h2>
          <div class="w-full max-w-xs mb-4">
            <ProgressBar value={progress} max={1} height="h-4" color="var(--color-gold)" showText />
          </div>
          <div class="bg-[#111] rounded-lg p-3 w-full max-w-xs space-y-1.5">
            <div class="flex justify-between text-sm">
              <span class="text-[var(--color-parchment)] opacity-60">Actions</span>
              <span class="font-[var(--font-mono)] text-[var(--color-gold)]">{skilling.totalActions}</span>
            </div>
            <div class="flex justify-between text-sm">
              <span class="text-[var(--color-parchment)] opacity-60">XP gained</span>
              <span class="font-[var(--font-mono)] text-[var(--color-gold)]">{formatNumber(skilling.totalXP)}</span>
            </div>
            <div class="flex justify-between text-sm">
              <span class="text-[var(--color-parchment)] opacity-60">XP/hr</span>
              <span class="font-[var(--font-mono)] text-[var(--color-gold)]">
                {skilling.startedAt && (Date.now() - skilling.startedAt) > 5000
                  ? formatNumber(Math.round(skilling.totalXP / ((Date.now() - skilling.startedAt) / 3600000)))
                  : '—'}
              </span>
            </div>
          </div>
        </div>
        <div class="flex-shrink-0 mt-3">
          <button onClick={stopBuilding}
            class="w-full py-2.5 rounded-lg bg-[#222] text-[var(--color-parchment)] font-semibold text-sm active:opacity-80">
            ← Stop &amp; Back
          </button>
        </div>
      </div>
    )
  }

  return (
    <div class="h-full overflow-y-auto p-4">
      <button onClick={onBack} class="text-xs text-[var(--color-gold-dim)] mb-3 flex items-center gap-1">
        ← Back
      </button>

      <h2 class="font-[var(--font-display)] text-base font-bold text-[var(--color-gold)] mb-1">
        🏠 Construction
      </h2>
      <p class="text-xs text-[var(--color-parchment)] opacity-40 mb-4">Level {constructionLevel}</p>

      <h3 class="font-[var(--font-display)] text-xs font-bold text-[var(--color-parchment)] opacity-60 uppercase tracking-wider mb-2">
        Building
      </h3>
      <div class="space-y-2 mb-6">
        {BUILDING_ACTIONS.map(action => {
          const available = action.level <= constructionLevel
          const matId = action.material
          const matName = itemsData[matId]?.name || matId
          const totalMats = countItem(inventory, matId) + (bank[matId]?.quantity || 0)
          const hasMats = totalMats >= 1
          const canStart = available && hasMats

          return (
            <button
              key={action.id}
              onClick={() => canStart && startBuilding(action)}
              disabled={!canStart}
              class={`w-full flex items-center justify-between p-3 rounded-xl border transition-colors
                ${canStart
                  ? 'bg-[#1a1a1a] border-[#2a2a2a] active:bg-[#222]'
                  : 'bg-[#111] border-[#1a1a1a] opacity-40'}`}
            >
              <div class="text-left">
                <div class="text-sm font-semibold text-[var(--color-parchment)]">{action.name}</div>
                <div class="text-[10px] text-[var(--color-parchment)] opacity-40">
                  Lv {action.level} · {action.xp} XP · {(action.ticks * 0.6).toFixed(1)}s · Needs: {matName}
                </div>
                {available && !hasMats && (
                  <div class="text-[9px] text-[#ff6b6b] mt-0.5">No {matName} in inventory or bank</div>
                )}
              </div>
              <div class="text-xs font-[var(--font-mono)] text-[var(--color-gold-dim)]">
                {available ? `${totalMats.toLocaleString()} avail` : `Lv ${action.level}`}
              </div>
            </button>
          )
        })}
      </div>

      <h3 class="font-[var(--font-display)] text-xs font-bold text-[var(--color-parchment)] opacity-60 uppercase tracking-wider mb-2">
        Unlockables
      </h3>
      <div class="space-y-2">
        {UNLOCKABLES.map(unlockable => {
          const available = constructionLevel >= unlockable.level
          const alreadyDone = unlockedFeatures.has(unlockable.id)
          return (
            <div
              key={unlockable.id}
              class={`p-3 rounded-xl border ${
                alreadyDone
                  ? 'bg-[#0a1a0a] border-[#1a3a1a]'
                  : available
                    ? 'bg-[#1a1a1a] border-[#2a2a2a]'
                    : 'bg-[#111] border-[#1a1a1a] opacity-40'
              }`}
            >
              <div class="flex items-start justify-between gap-2">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-1.5 mb-0.5">
                    <span class="text-base">{unlockable.icon}</span>
                    <div class="text-sm font-semibold text-[var(--color-parchment)]">{unlockable.name}</div>
                  </div>
                  <div class="text-[10px] text-[var(--color-parchment)] opacity-50">
                    Lv {unlockable.level} required · {unlockable.description}
                  </div>
                </div>
                {alreadyDone ? (
                  <span class="text-xs text-green-400 font-semibold shrink-0 pt-0.5">✓ Unlocked</span>
                ) : (
                  <button
                    onClick={() => available && handleUnlock(unlockable)}
                    disabled={!available}
                    class={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      available
                        ? 'bg-[var(--color-gold)] text-[#0f0f0f] active:opacity-80'
                        : 'bg-[#222] text-[#666] cursor-not-allowed'
                    }`}
                  >
                    {available ? 'Create' : `Lv ${unlockable.level}`}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
