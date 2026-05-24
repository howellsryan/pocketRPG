import { useGame } from '../state/gameState.jsx'
import Panel from '../components/Panel.jsx'
import ProgressBar from '../components/ProgressBar.jsx'
import SectionHeader from '../components/SectionHeader.jsx'
import { countItem } from '../engine/inventory.js'
import minigamesData from '../data/minigames.json'

function formatMinigameHours(hours) {
  if (hours === Math.floor(hours)) return `${hours}h`
  return `${hours.toFixed(1)}h`
}

export default function MinigamesScreen() {
  const {
    inventory, bank, equipment, activeTask, setActiveTask, unlockedMinigameItems,
  } = useGame()

  const startMinigame = (task) => {
    setActiveTask({
      type: 'minigame',
      minigameTask: task,
      bankingEnabled: true,
      totalTicks: task.ticks,
      ticksRemaining: task.ticks,
      startedAt: Date.now(),
    })
  }

  const stopMinigame = () => {
    setActiveTask(null)
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
      <div class="h-full flex flex-col p-4">
        <button
          onClick={stopMinigame}
          class="text-[12px] text-[#c4af7a] mb-3 flex items-center gap-1 bg-transparent border-0 cursor-pointer"
        >
          ← Abandon
        </button>

        <div class="flex-1 flex flex-col items-center justify-center">
          <span class="text-[48px] mb-2">{task.icon}</span>
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
    <div class="h-full flex flex-col">
      <div class="px-4 pt-4 pb-2 flex-shrink-0">
        <SectionHeader size="lg">🎮 Minigames</SectionHeader>
      </div>

      <div class="flex-1 overflow-y-auto px-4 pb-4">
        <div class="flex flex-col gap-4">
          {minigamesData.minigames.map(mg => {
            const tasks = minigamesData.tasks.filter(t => t.minigame === mg.id)
            if (tasks.length === 0) return null
            return (
              <div key={mg.id} class="flex flex-col gap-2">
                <SectionHeader size="sm">{mg.icon} {mg.label}</SectionHeader>
                {tasks.map(task => {
                  const missingReq = task.requiresItem && !hasItemAnywhere(task.requiresItem)
                  const alreadyUnlocked = unlockedMinigameItems.has(task.product)
                  const enabled = !missingReq
                  const rowClass = enabled
                    ? 'bg-[var(--color-void-light)] border-[#2a2a2a] opacity-100'
                    : 'bg-[#111] border-[#1a1a1a] opacity-45'

                  return (
                    <button
                      key={task.id}
                      onClick={() => enabled && startMinigame(task)}
                      disabled={!enabled}
                      class={`p-3 rounded-xl border text-left flex items-center gap-3 ${rowClass}`}
                    >
                      <span class="text-[28px] flex-shrink-0">{task.icon}</span>
                      <div class="flex-1 min-w-0">
                        <div class="text-[13px] font-semibold text-[var(--color-parchment)] mb-1">{task.name}</div>
                        <div class="text-[10px] text-[#c8a96e] opacity-80">
                          {alreadyUnlocked && <span class="text-[#7a7]">✓</span>}
                          {alreadyUnlocked && task.requiresItem && ' · '}

                          ⏱ {formatMinigameHours(task.hours)} total
                          {task.requiresItem && (
                            <span class={`${missingReq ? 'text-[#e57373]' : 'text-[var(--color-parchment)] opacity-50'}`}>
                              {' · '}Needs: {minigamesData.itemNames[task.requiresItem] || task.requiresItem}
                            </span>
                          )}
                        </div>
                      </div>
                      <div class="flex-shrink-0 text-right">
                        <div class="text-[18px]">→</div>
                        <div class="text-[9px] text-[#c8a96e] opacity-70">{minigamesData.itemNames[task.product] || task.product}</div>
                      </div>
                    </button>
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
