import { useState } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import Panel from '../components/Panel.jsx'
import Button from '../components/Button.jsx'
import Modal from '../components/Modal.jsx'
import SectionHeader from '../components/SectionHeader.jsx'
import ProgressBar from '../components/ProgressBar.jsx'
import {
  createQuestState, checkQuestEligibility,
  getQuestPointsEarned, formatQuestDuration,
} from '../engine/quests.js'
import questsData from '../data/quests.json'

const COMPLEXITY_COLORS = {
  Novice:        '#7fbf7f',
  Intermediate:  '#7bb3f0',
  Experienced:   '#d4af37',
  Master:        '#e57373',
  Grandmaster:   '#b265e0',
  Special:       '#f06292',
}

const COMPLEXITY_ORDER = {
  Novice: 1, Intermediate: 2, Experienced: 3, Master: 4, Grandmaster: 5, Special: 6,
}

export default function QuestsScreen() {
  const {
    stats, completedQuests, activeTask, setActiveTask,
    addToast, itemsData,
  } = useGame()

  const [hideCompleted, setHideCompleted] = useState(false)
  const [selectedQuest, setSelectedQuest] = useState(null)

  const startQuest = (quest) => {
    const state = createQuestState(quest)
    setActiveTask({
      type: 'quest',
      quest,
      totalTicks: state.totalTicks,
      ticksRemaining: state.ticksRemaining,
      startedAt: state.startedAt,
    })
    setSelectedQuest(null)
    addToast(`📜 Started: ${quest.name}`, 'info')
  }

  const abandonQuest = () => {
    setActiveTask(null)
    addToast('Quest abandoned', 'info')
  }

  const sortedQuests = [...questsData].sort((a, b) => {
    const ca = COMPLEXITY_ORDER[a.complexity] || 99
    const cb = COMPLEXITY_ORDER[b.complexity] || 99
    if (ca !== cb) return ca - cb
    return a.name.localeCompare(b.name)
  })

  const visibleQuests = hideCompleted
    ? sortedQuests.filter(q => !completedQuests.has(q.id))
    : sortedQuests

  const totalQp = getQuestPointsEarned(completedQuests, questsData)
  const completedCount = completedQuests.size

  // ── Active quest view (App.jsx ticks the quest; we just render state) ──────
  if (activeTask?.type === 'quest' && activeTask.quest) {
    const { quest, totalTicks } = activeTask
    const ticksRemaining = activeTask.ticksRemaining ?? totalTicks
    const progress = 1 - ticksRemaining / totalTicks
    const remainingSec = Math.ceil(ticksRemaining * 0.6)

    return (
      <div class="h-full flex flex-col p-4">
        <button
          onClick={abandonQuest}
          class="text-[12px] text-[#c4af7a] mb-3 flex items-center gap-1 bg-transparent border-0 cursor-pointer self-start"
        >
          ← Abandon Quest
        </button>

        <div class="flex-1 flex flex-col items-center justify-center">
          <span class="text-[48px] mb-2">📜</span>
          <h2 class="font-[var(--font-display)] text-[18px] font-bold text-[var(--color-gold)] mb-1 text-center">
            {quest.name}
          </h2>
          <div class="text-[11px] text-[var(--color-parchment)] opacity-50 mb-4">
            {quest.complexity} · {quest.length}
          </div>

          <div class="w-full max-w-[280px] mb-4">
            <ProgressBar
              value={progress}
              max={1}
              height="h-4"
              color="var(--color-gold)"
              showText
            />
          </div>

          <Panel padding="p-3" className="w-full max-w-[280px] mb-3 rounded-xl">
            <div class="flex justify-between mb-2">
              <span class="text-[13px] text-[var(--color-parchment)] opacity-60">Time remaining</span>
              <span class="font-[var(--font-mono)] text-[var(--color-gold)] font-bold">
                {formatQuestDuration(remainingSec)}
              </span>
            </div>
            <div class="flex justify-between">
              <span class="text-[13px] text-[var(--color-parchment)] opacity-60">Reward on completion</span>
              <span class="font-[var(--font-mono)] text-[var(--color-gold)] font-bold">
                🪙 {quest.coinReward.toLocaleString()}
              </span>
            </div>
          </Panel>

          <div class="text-[11px] text-[var(--color-parchment)] opacity-50 text-center max-w-[280px]">
            ⏳ Quests run in the background — feel free to switch screens.
          </div>
        </div>
      </div>
    )
  }

  // ── Quest list ──────────────────────────────────────────────────────────────
  return (
    <div class="h-full flex flex-col">
      <div class="px-4 pt-4 pb-2 flex-shrink-0">
        <div class="flex justify-between items-baseline mb-2">
          <SectionHeader size="lg">📜 Quests</SectionHeader>
          <span class="text-[11px] text-[var(--color-gold)] font-[var(--font-mono)]">
            {completedCount}/{questsData.length} · {totalQp} QP
          </span>
        </div>

        <button
          onClick={() => setHideCompleted(v => !v)}
          class={`px-3 py-[5px] rounded-[20px] text-[11px] font-semibold border ${
            hideCompleted
              ? 'border-[var(--color-gold)] bg-[rgba(212,175,55,0.15)] text-[var(--color-gold)]'
              : 'border-[#2a2a2a] bg-[var(--color-void-light)] text-[var(--color-parchment)] opacity-60'
          }`}
        >
          {hideCompleted ? '✓ Hiding completed' : 'Show all'}
        </button>
      </div>

      <div class="flex-1 overflow-y-auto px-4 pb-4">
        <div class="flex flex-col gap-2 pt-2">
          {visibleQuests.map(quest => {
            const completed = completedQuests.has(quest.id)
            const elig = checkQuestEligibility(quest, stats, completedQuests, questsData)
            const complexityColor = COMPLEXITY_COLORS[quest.complexity] || '#888'

            return (
              <button
                key={quest.id}
                onClick={() => setSelectedQuest(quest)}
                class={`p-3 rounded-xl border text-left flex items-center gap-3 ${
                  completed
                    ? 'bg-[rgba(74,222,128,0.06)] border-[rgba(74,222,128,0.2)]'
                    : elig.eligible
                      ? 'bg-[var(--color-void-light)] border-[#2a2a2a]'
                      : 'bg-[#111] border-[#1a1a1a] opacity-70'
                }`}
              >
                <span class="text-[24px] flex-shrink-0">
                  {completed ? '✅' : '📜'}
                </span>
                <div class="flex-1 min-w-0">
                  <div
                    class={`text-[13px] font-semibold ${
                      completed ? 'text-[#4ade80]' : 'text-[var(--color-parchment)]'
                    }`}
                  >
                    {quest.name}
                  </div>
                  <div class="text-[10px] flex items-center gap-2 mt-[2px]">
                    <span style={{ color: complexityColor }}>{quest.complexity}</span>
                    <span class="text-[var(--color-parchment)] opacity-50">·</span>
                    <span class="text-[var(--color-parchment)] opacity-60">
                      {formatQuestDuration(quest.durationSeconds)}
                    </span>
                  </div>
                </div>
                <div class="flex-shrink-0 text-[18px] text-[var(--color-parchment)] opacity-40">
                  →
                </div>
              </button>
            )
          })}
          {visibleQuests.length === 0 && (
            <div class="py-10 text-center text-[#888] text-[12px]">
              No quests to show.
            </div>
          )}
        </div>
      </div>

      {/* ── Quest details modal ── */}
      {selectedQuest && (
        <QuestDetailsModal
          quest={selectedQuest}
          stats={stats}
          completedQuests={completedQuests}
          itemsData={itemsData}
          onClose={() => setSelectedQuest(null)}
          onStart={startQuest}
        />
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────

function QuestDetailsModal({ quest, stats, completedQuests, itemsData, onClose, onStart }) {
  const completed = completedQuests.has(quest.id)
  const elig = checkQuestEligibility(quest, stats, completedQuests, questsData)
  const skillEntries = Object.entries(quest.skillRequirements || {})
  const questPrereqs = quest.questRequirements || []
  const itemUnlockNames = (quest.itemUnlocks || [])
    .map(id => itemsData[id]?.name || id)

  return (
    <Modal title={quest.name} onClose={onClose}>
      <div class="flex flex-col gap-3">
        <Panel className="flex items-center gap-3">
          <span class="text-[28px]">{completed ? '✅' : '📜'}</span>
          <div class="flex-1">
            <div class="text-[13px] font-semibold text-[var(--color-parchment)]">
              {quest.complexity} · {quest.length}
            </div>
            <div class="text-[11px] text-[var(--color-parchment)] opacity-60">
              Duration: {formatQuestDuration(quest.durationSeconds)}
            </div>
          </div>
        </Panel>

        <Panel>
          <SectionHeader size="sm" className="mb-2">Rewards</SectionHeader>
          <div class="text-[12px] text-[var(--color-parchment)] flex flex-col gap-1">
            <div>
              🪙 <span class="font-[var(--font-mono)] text-[var(--color-gold)]">
                {quest.coinReward.toLocaleString()}
              </span> coins
            </div>
            {Object.entries(quest.xpReward || {}).map(([skill, xp]) => (
              <div key={skill}>
                ⭐ <span class="font-[var(--font-mono)] text-[var(--color-gold)]">
                  {xp.toLocaleString()}
                </span> {skill} XP
              </div>
            ))}
            {itemUnlockNames.length > 0 && (
              <div>
                🎁 Unlocks: <span class="text-[var(--color-gold)]">
                  {itemUnlockNames.join(', ')}
                </span>
              </div>
            )}
          </div>
        </Panel>

        {(skillEntries.length > 0 || questPrereqs.length > 0 || quest.questPointRequirement > 0 || quest.combatLevelRequirement > 0) && (
          <Panel>
            <SectionHeader size="sm" className="mb-2">Requirements</SectionHeader>
            <div class="text-[12px] flex flex-col gap-1">
              {quest.questPointRequirement > 0 && (
                <RequirementRow
                  label={`${quest.questPointRequirement} Quest points`}
                  ok={!elig.reasons.some(r => r.includes('Quest points'))}
                />
              )}
              {quest.combatLevelRequirement > 0 && (
                <RequirementRow
                  label={`Combat level ${quest.combatLevelRequirement}`}
                  ok={!elig.reasons.some(r => r.startsWith('Combat level'))}
                />
              )}
              {skillEntries.map(([skill, lvl]) => (
                <RequirementRow
                  key={skill}
                  label={`${skill.charAt(0).toUpperCase() + skill.slice(1)} ${lvl}`}
                  ok={!elig.reasons.some(r => r.toLowerCase().startsWith(skill.toLowerCase()))}
                />
              ))}
              {questPrereqs.map(pid => {
                const prereq = questsData.find(q => q.id === pid)
                const ok = completedQuests.has(pid)
                return (
                  <RequirementRow key={pid} label={`Quest: ${prereq ? prereq.name : pid}`} ok={ok} />
                )
              })}
            </div>
          </Panel>
        )}

        <div class="flex gap-2">
          <Button variant="secondary" size="lg" onClick={onClose} className="flex-1">
            Close
          </Button>
          {!completed && (
            <Button
              variant="primary"
              size="lg"
              disabled={!elig.eligible}
              onClick={() => onStart(quest)}
              className="flex-1"
            >
              {elig.eligible ? 'Begin Quest' : 'Locked'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}

function RequirementRow({ label, ok }) {
  return (
    <div class={`flex items-center gap-2 ${ok ? 'text-[#4ade80]' : 'text-[#e57373]'}`}>
      <span>{ok ? '✓' : '✗'}</span>
      <span>{label}</span>
    </div>
  )
}
