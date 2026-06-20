import { useState, useEffect } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import Panel from '../components/Panel.jsx'
import Modal from '../components/Modal.jsx'
import SectionHeader from '../components/SectionHeader.jsx'
import SkillActivePanel from '../components/SkillActivePanel.jsx'
import GameIcon from '../components/GameIcon.jsx'
import { getActionProgress } from '../hooks/useActionTick.js'
import { countItem } from '../engine/inventory.js'
import cluesData from '../data/clues.json'

// Clue solving is driven by the App-level tick (see App.jsx), so it keeps
// progressing on any screen — exactly like skilling, gathering and minigames.
// This screen only starts/stops the task and renders its progress.

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
  const { inventory, bank, equipment, addToast, setActiveTask, activeTask, itemsData } = useGame()
  const [showPanel, setShowPanel] = useState(false)
  const [infoTask, setInfoTask] = useState(null)

  const clueActive = activeTask?.type === 'clue' ? activeTask : null

  // Surface the running clue's panel when arriving on this screen, and drop back
  // to the list automatically if the task ends (out of scrolls / stopped).
  useEffect(() => {
    if (clueActive) setShowPanel(true)
    else setShowPanel(false)
  }, [clueActive?.gatherTask?.id, !!clueActive])

  const startTask = (task) => {
    setActiveTask({
      type: 'clue',
      gatherTask: task,
      bankingEnabled: true,
      totalTicks: task.ticks,
      ticksRemaining: task.ticks,
      justCompleted: false,
      session: { startedAt: Date.now(), actions: 0, xp: 0, coins: 0, items: 0, seeds: 0, tokens: 0 },
    })
    setShowPanel(true)
  }

  // Back: leave the clue running and return to the list.
  const backToList = () => setShowPanel(false)

  // Stop & Back: cancel the running clue entirely.
  const stopTask = () => {
    setActiveTask(null)
    setShowPanel(false)
  }

  if (clueActive && showPanel) {
    const task = clueActive.gatherTask
    const totalTicks = clueActive.totalTicks ?? task.ticks
    const ticksRemaining = clueActive.ticksRemaining ?? totalTicks
    const progress = getActionProgress(true, ticksRemaining, totalTicks)
    const remainingSeconds = ticksRemaining * 0.6
    const completed = clueActive.session?.actions || 0

    return (
      <SkillActivePanel
        icon={<span class="text-[44px]">{task.icon}</span>}
        title={task.name}
        subtitle={task.description}
        progress={progress}
        producing={<>
          <span class="text-[14px]">{task.icon}</span>
          <span class="text-[12px] font-semibold text-[var(--color-parchment)] opacity-60">Solving</span>
          <span class="text-[13px] font-semibold text-[var(--color-gold-light)]">{CLUE_ITEM_NAMES[task.requiresItem] || task.requiresItem}</span>
        </>}
        stats={[
          { label: 'Clues solved', value: completed },
          { label: 'Time remaining', value: formatClueRemaining(remainingSeconds) },
        ]}
        note="🗝️ Each clue banks 1–4 rewards on completion, then automatically starts the next while you have scrolls. Runs in the background."
        onBack={backToList}
        onStop={stopTask}
      />
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
            const isRunning = clueActive?.gatherTask?.id === task.id
            const rowClass = enabled
              ? 'bg-[var(--color-void-light)] border-[#2a2a2a] opacity-100'
              : 'bg-[#111] border-[#1a1a1a] opacity-45'

            return (
              <div
                key={task.id}
                class={`p-3 rounded-xl border flex items-center gap-3 ${rowClass} ${isRunning ? 'ring-1 ring-[var(--color-gold)]' : ''}`}
              >
                <button
                  onClick={() => (isRunning ? setShowPanel(true) : (enabled && startTask(task)))}
                  disabled={!enabled && !isRunning}
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
                    <div class="text-[9px] text-[#c8a96e] opacity-70">{isRunning ? 'Solving' : 'Rewards'}</div>
                    <div class={`text-[9px] mt-[2px] ${isRunning ? 'text-[var(--color-gold)]' : enabled ? 'text-[#4caf50]' : 'text-[#e57373]'}`}>
                      {isRunning ? '● running' : enabled ? '✓ ready' : '✗ need scroll'}
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
    const reqs = item?.requirements
    groups[clueRarityBand(pct)].push({ itemId: r.itemId, name, item, pct, reqs })
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
                  {r.item ? <GameIcon item={r.item} size={14} /> : <span class="text-[14px] flex-shrink-0">•</span>}
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
