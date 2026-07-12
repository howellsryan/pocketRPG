import { useEffect, useRef } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import Panel from '../components/Panel.jsx'
import ProgressBar from '../components/ProgressBar.jsx'
import SectionHeader from '../components/SectionHeader.jsx'
import GameIcon from '../components/GameIcon.jsx'
import GildedComplete from '../components/GildedComplete.jsx'
import SkillActionRow from '../components/SkillActionRow.jsx'
import BackLink from '../components/BackLink.jsx'
import { isMinigameItemUnlocked } from '../utils/completion.js'
import { countItem } from '../engine/inventory.js'
import minigamesData from '../data/minigames.json'
import { getActivityKey } from '../engine/activityRegistry.js'

function formatMinigameHours(hours) {
  if (hours === Math.floor(hours)) return `${hours}h`
  return `${hours.toFixed(1)}h`
}

export default function MinigamesScreen({ initialTaskId, onBack, onStopBack } = {}) {
  const {
    inventory, bank, equipment, activeTask, setActiveTask, unlockedMinigameItems,
    getActivityProgress, addToast, requestActivityStart,
  } = useGame()
  const hasAutoStarted = useRef(false)

  const startMinigame = (task, seedFromTravel = false) => {
    // Map-driven gating (Phase 3): fresh starts must be at a place that offers this
    // minigame. Arrivals via travel/home-shortcut skip the check — they're already there.
    if (!seedFromTravel && !requestActivityStart({ type: 'minigame', minigameTask: task })) return
    const key = getActivityKey({ type: 'minigame', minigameTask: task })
    const savedProgress = key ? getActivityProgress(key) : null
    const ticksRemaining = savedProgress?.progressTicks > 0
      ? Math.max(0, task.ticks - savedProgress.progressTicks)
      : task.ticks
    const resuming = savedProgress?.progressTicks > 0 && ticksRemaining > 0
    setActiveTask({
      type: 'minigame',
      minigameTask: task,
      bankingEnabled: true,
      totalTicks: task.ticks,
      ticksRemaining,
      startedAt: Date.now(),
    })
    if (resuming) addToast(`🎮 Resuming: ${task.name}`, 'info')
  }

  // Auto-start on arrival: a travel prompt sent the player here (autoStart), or a home
  // shortcut launched this task directly.
  useEffect(() => {
    if (initialTaskId && !hasAutoStarted.current && activeTask?.type !== 'minigame') {
      hasAutoStarted.current = true
      const task = minigamesData.tasks.find(t => t.id === initialTaskId)
      if (task) startMinigame(task, true)
    }
  }, [initialTaskId])

  const stopMinigame = () => {
    setActiveTask(null)
    const back = onStopBack || onBack
    if (back) back()
  }

  const hasItemAnywhere = (itemId) => {
    if (countItem(inventory, itemId) > 0) return true
    if (bank?.[itemId]?.quantity > 0) return true
    if (equipment) {
      for (const slot of Object.values(equipment)) {
        if (slot && slot.itemId === itemId) return true
      }
    }
    return false
  }

  if (activeTask?.type === 'minigame') {
    const task = activeTask.minigameTask
    const totalTicks = activeTask.totalTicks ?? task.ticks
    const ticksRemaining = activeTask.ticksRemaining ?? totalTicks
    const progress = totalTicks > 0 ? 1 - ticksRemaining / totalTicks : 0
    const remainingSeconds = ticksRemaining * 0.6

    return (
      <div class="forge-shell h-full flex flex-col p-4">
        <button
          onClick={stopMinigame}
          class="text-[12px] text-[var(--fm-ember)] mb-3 flex items-center gap-1 bg-transparent border-0 cursor-pointer"
        >
          ← Abandon
        </button>

        <div class="flex-1 flex flex-col items-center justify-center">
          <GameIcon iconKey={task.rewardItems?.[0] || task.product} item={{ icon: task.icon }} size={96} color="var(--color-gold)" class="mb-2" />

          <h2 class="font-[var(--font-display)] text-[18px] font-bold text-[var(--color-gold)] mb-1 text-center">
            {task.name}
          </h2>
          <p class="text-[11px] text-[var(--color-parchment)] opacity-50 mb-4 text-center">{task.description}</p>

          <div class="w-full max-w-[280px] mb-4">
            <ProgressBar value={progress} max={1} height="h-4" color="var(--color-gold)" showText />
          </div>

          <Panel padding="p-3" className="w-full max-w-[280px] mb-3 rounded-xl">
            <div class="flex justify-between">
              <span class="text-[13px] text-[var(--color-parchment)] opacity-60">Reward</span>
              <span class="font-[var(--font-mono)] text-[var(--color-gold)] font-bold">{minigamesData.itemNames[task.product] || task.product}</span>
            </div>
            <div class="flex justify-between mt-2">
              <span class="text-[13px] text-[var(--color-parchment)] opacity-60">Time remaining</span>
              <span class="font-[var(--font-mono)] text-[var(--color-gold)] font-bold">
                {Math.ceil(remainingSeconds / 60)}m
              </span>
            </div>
          </Panel>

          <div class="text-[11px] text-[var(--color-parchment)] opacity-50 text-center max-w-[280px]">
            ⏳ Minigame runs in the background — feel free to switch screens. Reward is banked on completion.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div class="forge-shell h-full flex flex-col">
      <div class="px-4 pt-4 pb-2 flex-shrink-0">
        <BackLink onClick={onBack} className="mb-3" />
        <SectionHeader size="lg"><span class="inline-flex items-center gap-2"><GameIcon iconKey="minigame_scroll_red" size={18} class="flex-shrink-0" /> Minigames</span></SectionHeader>
      </div>

      <div class="flex-1 overflow-y-auto px-4 pb-4">
        <div class="flex flex-col gap-4">
          {minigamesData.minigames.map(mg => {
            const tasks = minigamesData.tasks.filter(t => t.minigame === mg.id)
            if (tasks.length === 0) return null
            return (
              <div key={mg.id} class="flex flex-col gap-2">
                <SectionHeader size="sm">
                  <span class="inline-flex items-center gap-2">
                    <GameIcon iconKey={mg.iconKey} item={{ icon: mg.icon }} size={18} color="currentColor" />
                    {mg.label}
                  </span>
                </SectionHeader>
                {tasks.map(task => {
                  const missingReq = task.requiresItem && !hasItemAnywhere(task.requiresItem)
                  const alreadyUnlocked = isMinigameItemUnlocked(unlockedMinigameItems, task.product)
                  const enabled = !missingReq

                  return (
                    <GildedComplete key={task.id} complete={alreadyUnlocked} className="rounded-2xl">
                      <SkillActionRow
                        icon={<GameIcon iconKey={task.rewardItems?.[0] || task.product} item={{ icon: task.icon }} size={52} color="var(--color-gold)" />}
                        title={task.name}
                        meta={<>
                          {alreadyUnlocked && <span class="text-[#7a7]">✓ </span>}
                          ⏱ {formatMinigameHours(task.hours)} total
                          {task.requiresItem && (
                            <span class={missingReq ? 'text-[#e57373]' : ''}>
                              {' · '}Needs: {minigamesData.itemNames[task.requiresItem] || task.requiresItem}
                            </span>
                          )}
                        </>}
                        disabled={!enabled}
                        onClick={() => startMinigame(task)}
                      />
                    </GildedComplete>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
