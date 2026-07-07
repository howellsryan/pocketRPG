import { useState, useEffect, useRef } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import Panel from '../components/Panel.jsx'
import Button from '../components/Button.jsx'
import Modal from '../components/Modal.jsx'
import SectionHeader from '../components/SectionHeader.jsx'
import ProgressBar from '../components/ProgressBar.jsx'
import TwoPaneLayout from '../components/TwoPaneLayout.jsx'
import GildedComplete from '../components/GildedComplete.jsx'
import SkillActionRow from '../components/SkillActionRow.jsx'
import { isQuestComplete } from '../utils/completion.js'
import GameIcon from '../components/GameIcon.jsx'
import { useIsDesktop } from '../hooks/useIsDesktop.js'
import {
  checkQuestEligibility,
  getQuestPointsEarned, formatQuestDuration,
} from '../engine/quests.js'
import { QUEST_QUEUE_MAX, SCREENS } from '../utils/constants.js'
import { planQuestJourney } from '../engine/journeys.js'
import { getPlace } from '../engine/world.js'
import questsData from '../data/quests.json'
import { COMPLEXITY_COLORS, COMPLEXITY_ORDER } from '../utils/complexityColors.js'
import BackLink from '../components/BackLink.jsx'

// `onBack` (from App): returns to where the quest board was opened from — a
// quest post on the world map / a town map, or Settings (its nav link).
export default function QuestsScreen({ onNavigate, onBack } = {}) {
  const {
    stats, completedQuests, activeTask, setActiveTask,
    addToast, itemsData, questQueue, addQuestToQueue, removeFromQuestQueue, updateQuestQueue,
    worldLocation,
  } = useGame()

  const [hideCompleted, setHideCompleted] = useState(false)
  const [selectedQuest, setSelectedQuest] = useState(null)
  const [showQueue, setShowQueue] = useState(false)
  // "Back" collapses the active-quest view to the list without abandoning it —
  // the quest keeps running (App ticks it). A new/changed active quest resets it.
  const [collapsedActive, setCollapsedActive] = useState(false)
  useEffect(() => { setCollapsedActive(false) }, [activeTask?.quest?.id])
  const hasAutoStarted = useRef(false)
  const isDesktop = useIsDesktop()

  // Beginning a quest undertakes it as a journey across the world map — travel
  // to and search 2–4 places; the final search completes the quest through
  // handleQuestCompletion (XP choices, queue cascade and all). This is the only
  // quest flow: the old stand-still timer is retired (a legacy in-flight task
  // from an older save still renders and ticks out below). Starting drops you
  // onto the map to walk the trail — or teleport between its waypoints.
  const startQuestJourney = (quest) => {
    if (activeTask?.type === 'travel') {
      addToast('Finish or turn back your current journey first.', 'info')
      return
    }
    const jt = planQuestJourney(quest, worldLocation)
    if (!jt) {
      addToast('No route can be plotted from here.', 'error')
      return
    }
    setActiveTask(jt)
    if (questQueue.some(q => q.id === quest.id)) removeFromQuestQueue(quest.id)
    setSelectedQuest(null)
    addToast(`🗺️ Journey begun: ${quest.name} — ${jt.journey.steps.length} places to visit`, 'info')
    onNavigate?.(SCREENS.WORLD_MAP)
  }

  const addToQueue = (quest) => {
    if (questQueue.length >= QUEST_QUEUE_MAX) {
      addToast(`Queue is full (max ${QUEST_QUEUE_MAX})`, 'warning')
      return
    }
    addQuestToQueue(quest)
    setSelectedQuest(null)
    addToast(`📜 Queued: ${quest.name}`, 'info')
  }

  // Leave the active-quest view without stopping or abandoning it. Progress is
  // always kept (the quest keeps running in the background).
  const backFromActiveQuest = () => {
    setCollapsedActive(true)
  }

  const removeQuestFromQueue = (questId) => {
    removeFromQuestQueue(questId)
    addToast('Removed from queue', 'info')
  }

  const reorderQueue = (fromIndex, toIndex) => {
    const newQueue = [...questQueue]
    const [removed] = newQueue.splice(fromIndex, 1)
    newQueue.splice(toIndex, 0, removed)
    updateQuestQueue(newQueue)
  }

  // Begin Queue sets out on the first quest's journey; each completion then
  // auto-chains the next queued quest's journey from wherever it ended (App.jsx
  // promoteNextQueuedQuestOrClear) — the queue runs itself in the background.
  const startQueue = () => {
    if (questQueue.length === 0) return
    startQuestJourney(questQueue[0])
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

  // ── Legacy active quest view — only a stand-still `type:'quest'` task saved
  // before the journey flow can reach this (App.jsx still ticks it out) ────────
  if (activeTask?.type === 'quest' && activeTask.quest && !collapsedActive) {
    const { quest, totalTicks } = activeTask
    const ticksRemaining = activeTask.ticksRemaining ?? totalTicks
    const progress = 1 - ticksRemaining / totalTicks
    const remainingSec = Math.ceil(ticksRemaining * 0.6)

    return (
      <div class="forge-shell h-full flex flex-col p-4">
        <BackLink onClick={backFromActiveQuest} className="mb-3" />
        {questQueue.length > 0 && (
          <div class="flex justify-end mb-3">
            <span class="text-[11px] text-[var(--color-gold)] font-[var(--font-mono)]">
              🔗 Queue ({questQueue.length})
            </span>
          </div>
        )}

        <div class="flex-1 flex flex-col items-center justify-center">
          <GameIcon iconKey="quest_scroll_blue" size={48} class="mb-2" />
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
    <div class="forge-shell h-full flex flex-col">
      <div class="px-4 pt-4 pb-2 flex-shrink-0">
        <BackLink onClick={onBack} className="mb-3" />
        <div class="flex justify-between items-baseline mb-2">
          <SectionHeader size="lg"><span class="inline-flex items-center gap-2"><GameIcon iconKey="quest_scroll_blue" size={18} class="flex-shrink-0" /> Quests Board</span></SectionHeader>
          <span class="text-[11px] text-[var(--color-gold)] font-[var(--font-mono)]">
            {completedCount}/{questsData.length} · {totalQp} QP
          </span>
        </div>

        <div class="flex gap-2 justify-between items-center">
          <div class="flex gap-2">
            <button
              onClick={() => setHideCompleted(v => !v)}
              class={`px-3 py-[5px] rounded-[20px] text-[11px] font-semibold border ${
                hideCompleted
                  ? 'border-[var(--color-gold)] bg-[rgba(212,175,55,0.15)] text-[var(--color-gold)]'
                  : 'border-[var(--color-void-border)] bg-[var(--color-void-light)] text-[var(--color-parchment)] opacity-60'
              }`}
            >
              {hideCompleted ? '✓ Hiding completed' : 'Show all'}
            </button>
            {questQueue.length > 0 && (
              <button
                onClick={() => setShowQueue(v => !v)}
                class="px-3 py-[5px] rounded-[20px] text-[11px] font-semibold border border-[var(--color-gold)] bg-[rgba(212,175,55,0.15)] text-[var(--color-gold)]"
              >
                🔗 Queue ({questQueue.length})
              </button>
            )}
          </div>
          {questQueue.length > 0 && (
            <Button
              variant="success"
              size="sm"
              onClick={startQueue}
            >
              ▶️ Begin Queue
            </Button>
          )}
        </div>
      </div>

      <TwoPaneLayout
        showDetailPane={true}
        list={
      <div class="h-full overflow-y-auto px-4 pb-4">
        <div class="flex flex-col gap-2">
            {activeTask?.type === 'travel' && activeTask.journey?.kind === 'quest' && (
              <button
                onClick={() => onNavigate?.(SCREENS.WORLD_MAP)}
                class="mb-2 w-full flex items-center justify-between gap-2 p-3 rounded-xl border border-[var(--color-gold)] bg-[rgba(212,175,55,0.12)] text-left active:opacity-80"
              >
                <span class="flex items-center gap-2 min-w-0">
                  <span class="w-2 h-2 rounded-full bg-[var(--color-xp-bar)] flex-shrink-0" />
                  <span class="text-[13px] font-semibold text-[var(--color-parchment)] truncate">🗺️ {activeTask.journey.name} — journey underway</span>
                </span>
                <span class="text-[12px] font-semibold text-[var(--color-gold)] flex-shrink-0">View map ›</span>
              </button>
            )}
            {collapsedActive && activeTask?.type === 'quest' && activeTask.quest && (
              <button
                onClick={() => setCollapsedActive(false)}
                class="mb-2 w-full flex items-center justify-between gap-2 p-3 rounded-xl border border-[var(--color-gold)] bg-[rgba(212,175,55,0.12)] text-left active:opacity-80"
              >
                <span class="flex items-center gap-2 min-w-0">
                  <span class="w-2 h-2 rounded-full bg-[var(--color-xp-bar)] flex-shrink-0" />
                  <span class="text-[13px] font-semibold text-[var(--color-parchment)] truncate">{activeTask.quest.name} — in progress</span>
                </span>
                <span class="text-[12px] font-semibold text-[var(--color-gold)] flex-shrink-0">View ›</span>
              </button>
            )}
            {showQueue && questQueue.length > 0 && (
              <div class="flex flex-col gap-2 pt-2 mb-4">
                <SectionHeader size="sm">📋 Quest Queue</SectionHeader>
                {questQueue.map((quest, idx) => (
                  <div key={quest.id} class="p-3 rounded-xl bg-[var(--color-void-light)] border border-[var(--color-void-border)] flex items-center justify-between gap-2">
                    <div class="flex-1 min-w-0">
                      <div class="text-[13px] font-semibold text-[var(--color-parchment)]">
                        {idx + 1}. {quest.name}
                      </div>
                      <div class="text-[10px] text-[var(--color-parchment)] opacity-60">
                        {formatQuestDuration(quest.durationSeconds)}
                      </div>
                    </div>
                    <button
                      onClick={() => removeQuestFromQueue(quest.id)}
                      class="text-[12px] text-[#e57373] bg-transparent border-0 cursor-pointer flex-shrink-0"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            {visibleQuests.map(quest => {
              const completed = isQuestComplete(completedQuests, quest.id)
              const elig = checkQuestEligibility(quest, stats, completedQuests, questsData)
              const complexityColor = COMPLEXITY_COLORS[quest.complexity] || '#888'

              return (
                <GildedComplete key={quest.id} complete={completed} className="rounded-2xl">
                  <SkillActionRow
                    icon={completed
                      ? <GameIcon iconKey="check_mark" color="#4ade80" size={32} />
                      : <GameIcon iconKey="quest_scroll_blue" size={52} />}
                    title={quest.name}
                    meta={<span class="flex items-center gap-2">
                      <span style={{ color: complexityColor }}>{quest.complexity}</span>
                      <span class="opacity-50">·</span>
                      <span>{formatQuestDuration(quest.durationSeconds)}</span>
                      {!completed && !elig.eligible && <span class="text-[#e57373]">· 🔒 Locked</span>}
                    </span>}
                    onClick={() => setSelectedQuest(quest)}
                  />
                </GildedComplete>
              )
            })}

            {visibleQuests.length === 0 && (
              <div class="py-10 text-center text-[var(--fm-ink-faint)] text-[12px]">
                No quests to show.
              </div>
            )}
        </div>
      </div>
        }
        detail={
          selectedQuest ? (
            <div class="p-4">
              <QuestDetailsBody
                quest={selectedQuest}
                stats={stats}
                completedQuests={completedQuests}
                itemsData={itemsData}
                worldLocation={worldLocation}
                onClose={() => setSelectedQuest(null)}
                onStartJourney={startQuestJourney}
                onAddToQueue={addToQueue}
                isInQueue={questQueue.some(q => q.id === selectedQuest.id)}
                queueFull={questQueue.length >= QUEST_QUEUE_MAX}
              />
            </div>
          ) : (
            <div class="p-6 text-center text-[12px] text-[var(--color-parchment)] opacity-50">
              Select a quest to see details and start it.
            </div>
          )
        }
      />

      {/* ── Quest details modal — mobile only ── */}
      {!isDesktop && selectedQuest && (
        <QuestDetailsModal
          quest={selectedQuest}
          stats={stats}
          completedQuests={completedQuests}
          itemsData={itemsData}
          worldLocation={worldLocation}
          onClose={() => setSelectedQuest(null)}
          onStartJourney={startQuestJourney}
          onAddToQueue={addToQueue}
          isInQueue={questQueue.some(q => q.id === selectedQuest.id)}
          queueFull={questQueue.length >= QUEST_QUEUE_MAX}
        />
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────

function QuestDetailsModal({ quest, stats, completedQuests, itemsData, worldLocation, onClose, onStartJourney, onAddToQueue, isInQueue, queueFull }) {
  return (
    <Modal title={quest.name} onClose={onClose}>
      <QuestDetailsBody
        quest={quest}
        stats={stats}
        completedQuests={completedQuests}
        itemsData={itemsData}
        worldLocation={worldLocation}
        onClose={onClose}
        onStartJourney={onStartJourney}
        onAddToQueue={onAddToQueue}
        isInQueue={isInQueue}
        queueFull={queueFull}
        showCloseButton
      />
    </Modal>
  )
}

function QuestDetailsBody({ quest, stats, completedQuests, itemsData, worldLocation, onClose, onStartJourney, onAddToQueue, isInQueue, queueFull, showCloseButton = false }) {
  const completed = completedQuests.has(quest.id)
  const elig = checkQuestEligibility(quest, stats, completedQuests, questsData)
  const skillEntries = Object.entries(quest.skillRequirements || {})
  const questPrereqs = quest.questRequirements || []
  const itemUnlockNames = (quest.itemUnlocks || [])
    .map(id => itemsData[id]?.name || id)

  // The journey's trail is generated fresh from wherever the player currently
  // stands (engine/journeys.js) — there's no single fixed "quest giver" place.
  // Preview the first waypoint of that trail so the player knows where the
  // journey leads off to before committing.
  const previewLeg = !completed && elig.eligible ? planQuestJourney(quest, worldLocation) : null
  const startPlaceName = previewLeg ? (getPlace(previewLeg.dest)?.name || previewLeg.dest) : null

  return (
      <div class="flex flex-col gap-3">
        <Panel className="flex items-center gap-3">
          <span class="text-[28px]">{completed ? <GameIcon iconKey="check_mark" color="#4ade80" size={28} /> : <GameIcon iconKey="quest_scroll_blue" size={28} />}</span>
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

        {startPlaceName && (
          <button
            type="button"
            onClick={() => onStartJourney(quest)}
            class="text-left w-full bg-transparent border-0 p-0 cursor-pointer active:opacity-70"
          >
            <Panel className="flex items-center gap-3">
              <span class="text-[20px]">🧭</span>
              <div class="flex-1 min-w-0">
                <SectionHeader size="sm" className="mb-1">Starting Point</SectionHeader>
                <div class="text-[12px] text-[var(--color-parchment)]">
                  Journey begins toward <span class="text-[var(--color-gold)] font-semibold">{startPlaceName}</span>
                </div>
              </div>
              <span class="text-[var(--color-parchment)] opacity-40 text-lg leading-none">›</span>
            </Panel>
          </button>
        )}

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

        <div class="flex flex-col gap-2">
          <div class="flex gap-2">
            {showCloseButton && (
              <Button variant="secondary" size="lg" onClick={onClose} className="flex-1">
                Close
              </Button>
            )}
            {!completed && (
              <Button
                variant="primary"
                size="lg"
                disabled={!elig.eligible}
                onClick={() => onStartJourney(quest)}
                className="flex-1"
              >
                {elig.eligible ? '🗺️ Begin Quest' : 'Locked'}
              </Button>
            )}
          </div>
          {!completed && elig.eligible && (
            <div class="text-[11px] text-[var(--color-parchment)] opacity-50 text-center">
              Quests are journeys: follow the trail on the world map — teleport between waypoints to finish faster.
            </div>
          )}
          {!completed && (
            <Button
              variant={isInQueue ? 'secondary' : 'success'}
              size="lg"
              disabled={!elig.eligible || isInQueue || (queueFull && !isInQueue)}
              onClick={() => onAddToQueue(quest)}
              className="w-full"
            >
              {isInQueue ? '✓ In Queue' : queueFull ? `Queue Full (${QUEST_QUEUE_MAX}/${QUEST_QUEUE_MAX})` : '🔗 Add to Queue'}
            </Button>
          )}
        </div>
      </div>
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
