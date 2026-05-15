import { useState, useEffect, useRef } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import ProgressBar from '../components/ProgressBar.jsx'
import Panel from '../components/Panel.jsx'
import Modal from '../components/Modal.jsx'
import SectionHeader from '../components/SectionHeader.jsx'
import { getActionProgress } from '../hooks/useActionTick.js'
import { countItem } from '../engine/inventory.js'
import { onTick } from '../engine/tick.js'
import cluesData from '../data/clues.json'
import { rollClueRewards } from '../engine/clueScrolls.js'
import { api, getToken, getCharacterId } from '../cloud/api.js'
import { applyCloudSave, requestCriticalPushSave } from '../cloud/sync.js'
import { CRITICAL_SAVE_REASONS } from '../cloud/criticalSavePolicy.js'
import { recordCollectionLogDrop, applyServerCollectionLogEntries } from '../cloud/collectionLog.js'
import { isLoggedDrop } from '../engine/collectionLog.js'

const CLUE_TASKS = [
  {
    id: 'complete_medium_clue',
    name: 'Complete Medium Clue',
    icon: '📜',
    description: 'Solve a medium clue scroll for treasure rewards.',
    ticks: 500,
    requiresItem: 'clue_scroll_medium',
    isClue: true,
    clueLevel: 'medium',
  },
  {
    id: 'complete_hard_clue',
    name: 'Complete Hard Clue',
    icon: '📜',
    description: 'Solve a hard clue scroll for treasure rewards.',
    ticks: 1500,
    requiresItem: 'clue_scroll_hard',
    isClue: true,
    clueLevel: 'hard',
  },
  {
    id: 'complete_elite_clue',
    name: 'Complete Elite Clue',
    icon: '📜',
    description: 'Solve an elite clue scroll for treasure rewards.',
    ticks: 3000,
    requiresItem: 'clue_scroll_elite',
    isClue: true,
    clueLevel: 'elite',
  },
  {
    id: 'complete_master_clue',
    name: 'Complete Master Clue',
    icon: '📜',
    description: 'Solve a master clue scroll for treasure rewards.',
    ticks: 6000,
    requiresItem: 'clue_scroll_master',
    isClue: true,
    clueLevel: 'master',
  },
]

const CLUE_ITEM_NAMES = {
  clue_scroll_medium: 'Clue scroll (medium)',
  clue_scroll_hard: 'Clue scroll (hard)',
  clue_scroll_elite: 'Clue scroll (elite)',
  clue_scroll_master: 'Clue scroll (master)',
}

function hasClueScroll(itemId, inventory, bank, equipment) {
  if (countItem(inventory, itemId) > 0) return true
  if (bank?.[itemId]?.quantity > 0) return true
  if (equipment) {
    for (const slot of Object.values(equipment)) {
      if (slot && slot.itemId === itemId) return true
    }
  }
  return false
}

function formatClueRemaining(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds))
  const hrs = Math.floor(s / 3600)
  const mins = Math.floor((s % 3600) / 60)
  const secs = s % 60
  if (hrs > 0) return `${hrs}h ${mins}m`
  if (mins > 0) return `${mins}m ${secs}s`
  return `${secs}s`
}

export default function CluesScreen() {
  const { inventory, bank, equipment, updateBankDirect, addToast, setActiveTask, activeTask: globalActiveTask, itemsData, getSnapshot } = useGame()
  const [activeTask, setLocalTask] = useState(null)
  const [infoTask, setInfoTask] = useState(null)
  const taskRef = useRef(null)

  useEffect(() => {
    if (!activeTask) return
    taskRef.current = activeTask

    const unsub = onTick(() => {
      const state = taskRef.current
      if (!state || state.stopped) return

      let ticksRemaining = state.ticksRemaining
      let justCompleted = state.justCompleted || false

      if (justCompleted) {
        const scrollCount = bank?.[state.task.requiresItem]?.quantity || 0
        if (scrollCount <= 0) {
          taskRef.current = { ...state, stopped: true }
          setLocalTask(null)
          setActiveTask(null)
          addToast(`No ${CLUE_ITEM_NAMES[state.task.requiresItem] || state.task.requiresItem} left.`, 'info')
          return
        }
        ticksRemaining = state.task.ticks
        justCompleted = false
      } else {
        ticksRemaining--
      }

      const next = { ...state, ticksRemaining, justCompleted }

      if (next.ticksRemaining <= 0) {
        const task = next.task
        if (getToken() && getCharacterId()) {
          void api.completeClue(task.clueLevel, {
            actionNonce: `clue:${task.clueLevel}:${Date.now()}`,
            consumptions: [{ itemId: task.requiresItem, quantity: 1 }],
          }).then(async (res) => {
            if (res?.save?.save_data) await applyCloudSave(JSON.parse(res.save.save_data), res.save.updatedAt)
            applyServerCollectionLogEntries(res?.collectionLogEntries || [])
            const granted = Array.isArray(res?.granted) ? res.granted : []
            const rewardNames = granted.map(r => `${itemsData?.[r.itemId]?.name || CLUE_ITEM_NAMES[r.itemId] || r.itemId} ×${r.quantity}`).join(', ')
            addToast(`${task.icon} Rewards: ${rewardNames || 'none'}`, 'success')
          }).catch((err) => {
            addToast(`Clue claim failed: ${err?.message || 'server_error'}`, 'error')
          })
        } else {
          const rewards = rollClueRewards(task.clueLevel)
          const bankUpdates = {}
          for (const reward of rewards) bankUpdates[reward.itemId] = reward.quantity
          bankUpdates[task.requiresItem] = -1
          updateBankDirect(bankUpdates)
          for (const reward of rewards) {
            if (isLoggedDrop(reward.itemId, 'clues', task.clueLevel)) recordCollectionLogDrop({ itemId: reward.itemId, sourceType: 'clues', sourceId: task.clueLevel })
          }
          requestCriticalPushSave(() => getSnapshot(), CRITICAL_SAVE_REASONS.CLUE_REWARD)
          const rewardNames = rewards.map(r => `${itemsData?.[r.itemId]?.name || CLUE_ITEM_NAMES[r.itemId] || r.itemId} ×${r.quantity}`).join(', ')
          addToast(`${task.icon} Rewards: ${rewardNames}`, 'success')
        }

        const updated = {
          ...next,
          totalDone: next.totalDone + 1,
          justCompleted: true,
        }
        taskRef.current = updated
        setLocalTask(updated)
      } else {
        taskRef.current = next
        setLocalTask(next)
      }
    })

    return unsub
  }, [activeTask?.task?.id, inventory, bank])

  const startTask = (task) => {
    const newState = {
      task,
      ticksRemaining: task.ticks,
      totalDone: 0,
      startedAt: Date.now(),
      stopped: false,
      justCompleted: false,
    }
    taskRef.current = newState
    setLocalTask(newState)
    setActiveTask({ type: 'gather', gatherTask: task, bankingEnabled: true })
  }

  const stopTask = () => {
    if (taskRef.current) taskRef.current = { ...taskRef.current, stopped: true }
    setLocalTask(null)
    setActiveTask(null)
  }

  useEffect(() => {
    if (!activeTask) return
    const globalGatherTask = globalActiveTask?.type === 'gather' ? globalActiveTask.gatherTask : null
    if (!globalGatherTask || globalGatherTask.id !== activeTask.task?.id) {
      taskRef.current = null
      setLocalTask(null)
    }
  }, [globalActiveTask, activeTask])

  if (activeTask) {
    const task = activeTask.task
    const ticksRemaining = activeTask.ticksRemaining
    const progress = getActionProgress(true, ticksRemaining, task.ticks)
    const remainingSeconds = ticksRemaining * 0.6

    return (
      <div class="h-full flex flex-col p-4">
        <button
          onClick={stopTask}
          class="text-[12px] text-[#c4af7a] mb-3 flex items-center gap-1 bg-transparent border-0 cursor-pointer"
        >
          ← Back
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
            <div class="flex justify-between mb-2">
              <span class="text-[13px] text-[var(--color-parchment)] opacity-60">Clue Required</span>
              <span class="font-[var(--font-mono)] text-[var(--color-gold)] font-bold">{CLUE_ITEM_NAMES[task.requiresItem] || task.requiresItem}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-[13px] text-[var(--color-parchment)] opacity-60">Time remaining</span>
              <span class="font-[var(--font-mono)] text-[var(--color-gold)] font-bold">
                {formatClueRemaining(remainingSeconds)}
              </span>
            </div>
          </Panel>

          <div class="text-[11px] text-[var(--color-parchment)] opacity-50 text-center max-w-[280px]">
            ⏳ Solving clue... 1–4 rewards will be banked on completion.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div class="h-full flex flex-col">
      <div class="px-4 pt-4 pb-2 flex-shrink-0">
        <SectionHeader size="lg" className="mb-[10px]">🗝️ Clues</SectionHeader>
      </div>

      <div class="flex-1 overflow-y-auto px-4 pb-4">
        <div class="flex flex-col gap-2">
          {CLUE_TASKS.map(task => {
            const hasRequiredItem = hasClueScroll(task.requiresItem, inventory, bank, equipment)
            const enabled = hasRequiredItem
            const rowClass = enabled
              ? 'bg-[var(--color-void-light)] border-[#2a2a2a] opacity-100'
              : 'bg-[#111] border-[#1a1a1a] opacity-45'

            return (
              <div
                key={task.id}
                class={`p-3 rounded-xl border flex items-center gap-3 ${rowClass}`}
              >
                <button
                  onClick={() => enabled && startTask(task)}
                  disabled={!enabled}
                  class="flex-1 min-w-0 flex items-center gap-3 text-left bg-transparent border-0 p-0 disabled:cursor-not-allowed"
                >
                  <span class="text-[28px] flex-shrink-0">{task.icon}</span>
                  <div class="flex-1 min-w-0">
                    <div class="text-[13px] font-semibold text-[var(--color-parchment)] mb-1">{task.name}</div>
                    <div class="text-[10px] text-[#c8a96e] opacity-80">
                      ⏱ {(task.ticks * 0.6).toFixed(1)}s/action
                    </div>
                  </div>
                  <div class="flex-shrink-0 text-right">
                    <div class="text-[18px]">→</div>
                    <div class="text-[9px] text-[#c8a96e] opacity-70">Rewards</div>
                    <div class={`text-[9px] mt-[2px] ${enabled ? 'text-[#4caf50]' : 'text-[#e57373]'}`}>
                      {enabled ? '✓ ready' : '✗ need scroll'}
                    </div>
                  </div>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setInfoTask(task) }}
                  aria-label="Drop rates"
                  class="flex-shrink-0 w-9 h-9 rounded-full border border-[var(--color-void-border)] bg-[var(--color-void-light)] text-[var(--color-gold)] text-[14px] font-bold flex items-center justify-center active:opacity-70"
                >
                  ⓘ
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {infoTask && (
        <ClueDropRatesModal
          task={infoTask}
          itemsData={itemsData}
          onClose={() => setInfoTask(null)}
        />
      )}
    </div>
  )
}

function formatClueChance(pct) {
  if (pct >= 1) return `${pct.toFixed(2)}%`
  if (pct >= 0.05) return `${pct.toFixed(3)}%`
  if (pct <= 0) return '—'
  const oneIn = Math.round(100 / pct)
  return `1 in ${oneIn.toLocaleString()}`
}

function clueRarityBand(pct) {
  if (pct >= 1) return 'common'
  if (pct >= 0.05) return 'uncommon'
  return 'rare'
}

function ClueDropRatesModal({ task, itemsData, onClose }) {
  const data = cluesData[task.clueLevel]
  if (!data) return null

  const totalWeight = data.rewards.reduce((s, r) => s + r.weight, 0)
  const groups = { common: [], uncommon: [], rare: [] }
  for (const r of data.rewards) {
    const pct = totalWeight > 0 ? (100 * r.weight) / totalWeight : 0
    const item = itemsData?.[r.itemId]
    const name = item?.name || CLUE_ITEM_NAMES[r.itemId] || r.itemId
    const icon = item?.icon || '•'
    const reqs = item?.requirements
    groups[clueRarityBand(pct)].push({ itemId: r.itemId, name, icon, pct, reqs })
  }
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name))
  }

  const tierLabel = task.clueLevel.charAt(0).toUpperCase() + task.clueLevel.slice(1)
  const bandLabels = {
    common: { label: 'Common', color: '#86efac' },
    uncommon: { label: 'Uncommon', color: '#fcd34d' },
    rare: { label: 'Rare', color: '#a78bfa' },
  }

  const formatReqs = (reqs) => {
    if (!reqs) return null
    return Object.entries(reqs)
      .map(([skill, level]) => `${level} ${skill.charAt(0).toUpperCase() + skill.slice(1)}`)
      .join(', ')
  }

  return (
    <Modal title={`${task.icon} ${tierLabel} Clue — Drop Rates`} onClose={onClose}>
      <p class="text-[11px] text-[var(--color-parchment)] opacity-60 mb-3">
        Each completed clue rolls 1–4 reward slots. Percentages below are the chance per slot.
      </p>
      {Object.entries(groups).map(([band, rows]) => rows.length === 0 ? null : (
        <div key={band} class="mb-4">
          <div
            class="text-[10px] font-bold uppercase tracking-wider mb-1"
            style={{ color: bandLabels[band].color }}
          >
            {bandLabels[band].label} ({rows.length})
          </div>
          <Panel padding="p-2" className="rounded-lg">
            {rows.map(r => (
              <div key={r.itemId} class="flex items-center justify-between py-[3px] text-[12px]">
                <div class="flex items-center gap-2 text-[var(--color-parchment)] truncate flex-1">
                  <span class="text-[14px] flex-shrink-0">{r.icon}</span>
                  <div class="truncate flex-1">
                    <div class="truncate">{r.name}</div>
                    {r.reqs && (
                      <div class="text-[10px] opacity-60 truncate">
                        {formatReqs(r.reqs)}
                      </div>
                    )}
                  </div>
                </div>
                <span class="font-[var(--font-mono)] text-[var(--color-gold)] flex-shrink-0 ml-2">
                  {formatClueChance(r.pct)}
                </span>
              </div>
            ))}
          </Panel>
        </div>
      ))}
    </Modal>
  )
}
