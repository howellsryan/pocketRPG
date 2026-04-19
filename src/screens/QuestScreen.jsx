import { useState, useMemo } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import Card from '../components/Card.jsx'
import Panel from '../components/Panel.jsx'
import Button from '../components/Button.jsx'
import SectionHeader from '../components/SectionHeader.jsx'
import Modal from '../components/Modal.jsx'
import { QUEST_STATUS, getQuestStatus, getObjectiveProgress, getQuestPoints, areRequirementsMet, isPrereqMet } from '../engine/quests.js'
import { getLevelFromXP } from '../engine/experience.js'

const DIFFICULTY_COLOR = {
  Novice:       'text-[#9fd89f]',
  Intermediate: 'text-[#f0c36d]',
  Experienced:  'text-[#f08a6d]',
  Master:       'text-[#d66ff0]'
}

const STATUS_PILL = {
  [QUEST_STATUS.LOCKED]:      { label: '🔒 Locked',      cls: 'bg-[#2a1a1a] text-[#a88]' },
  [QUEST_STATUS.AVAILABLE]:   { label: '⚡ Available',   cls: 'bg-[#1a2a1a] text-[#9fd89f]' },
  [QUEST_STATUS.IN_PROGRESS]: { label: '⏳ In Progress', cls: 'bg-[#2a2416] text-[var(--color-gold)]' },
  [QUEST_STATUS.COMPLETED]:   { label: '✅ Completed',   cls: 'bg-[#162a1e] text-[#4ade80]' }
}

function prettyItem(itemId) {
  return itemId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function ProgressPill({ done, label, current, required }) {
  return (
    <div class={`flex justify-between items-center text-[12px] ${done ? 'text-[#4ade80]' : 'text-[var(--color-parchment)]'}`}>
      <span>{done ? '✅' : '◻️'} {label}</span>
      <span class="font-mono opacity-80">{current.toLocaleString()}/{required.toLocaleString()}</span>
    </div>
  )
}

export default function QuestScreen() {
  const { stats, bank, inventory, quests, questsData, monsterKillCounts, questKillStartCounts, startQuest, completeQuest } = useGame()
  const [selected, setSelected] = useState(null)
  const [filter, setFilter] = useState('all') // all | available | active | completed

  const allQuests = useMemo(() => Object.values(questsData), [questsData])

  const buildCtx = (questId) => {
    const start = questKillStartCounts[questId] || {}
    const killProgress = {}
    for (const [mId, count] of Object.entries(monsterKillCounts || {})) {
      killProgress[mId] = Math.max(0, count - (start[mId] || 0))
    }
    return { stats, bank, inventory, monsterKillCounts, killProgress }
  }

  const rows = allQuests.map(q => {
    const ctx = buildCtx(q.id)
    const status = getQuestStatus(q, quests, ctx)
    return { quest: q, status, ctx }
  })

  const filtered = rows.filter(({ status }) => {
    if (filter === 'all') return true
    if (filter === 'available') return status === QUEST_STATUS.AVAILABLE || status === QUEST_STATUS.LOCKED
    if (filter === 'active') return status === QUEST_STATUS.IN_PROGRESS
    if (filter === 'completed') return status === QUEST_STATUS.COMPLETED
    return true
  })

  const qp = getQuestPoints(quests, questsData)
  const totalQp = allQuests.reduce((n, q) => n + (q.rewards?.questPoints || 0), 0)
  const completedCount = rows.filter(r => r.status === QUEST_STATUS.COMPLETED).length

  const selectedRow = selected ? rows.find(r => r.quest.id === selected) : null

  return (
    <div class="h-full overflow-y-auto p-4">
      <Card className="mb-4" padding="p-4">
        <div class="flex items-center justify-between">
          <div>
            <h1 class="font-[var(--font-display)] text-[16px] font-bold text-[var(--color-gold)]">📜 Quest Journal</h1>
            <div class="text-[11px] text-[var(--color-parchment)] opacity-60 mt-1">
              {completedCount}/{allQuests.length} completed
            </div>
          </div>
          <Panel padding="px-3 py-2" className="text-right">
            <div class="text-[9px] uppercase tracking-wider text-[var(--color-parchment)] opacity-60">Quest Points</div>
            <div class="font-mono font-bold text-[var(--color-gold)] text-[16px]">{qp} / {totalQp}</div>
          </Panel>
        </div>
      </Card>

      <div class="flex gap-1 mb-3">
        {[
          { id: 'all',       label: 'All' },
          { id: 'available', label: 'Available' },
          { id: 'active',    label: 'Active' },
          { id: 'completed', label: 'Done' },
        ].map(f => (
          <Button
            key={f.id}
            variant={filter === f.id ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setFilter(f.id)}
            className="flex-1"
          >
            {f.label}
          </Button>
        ))}
      </div>

      <div class="space-y-2">
        {filtered.length === 0 && (
          <Card className="text-center py-6 text-[var(--color-parchment)] opacity-60 text-[12px]">
            No quests match this filter.
          </Card>
        )}
        {filtered.map(({ quest, status }) => {
          const pill = STATUS_PILL[status]
          return (
            <Card
              key={quest.id}
              padding="p-3"
              className="cursor-pointer hover:border-[var(--color-gold)] transition-colors"
              onClick={() => setSelected(quest.id)}
            >
              <div class="flex items-start justify-between gap-2">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <h3 class="font-[var(--font-display)] font-bold text-[14px] text-[var(--color-parchment)] truncate">
                      {quest.name}
                    </h3>
                  </div>
                  <div class="flex items-center gap-2 mt-1 text-[10px]">
                    <span class={`font-[var(--font-display)] font-bold uppercase tracking-wider ${DIFFICULTY_COLOR[quest.difficulty] || 'text-[var(--color-parchment)]'}`}>
                      {quest.difficulty}
                    </span>
                    {quest.rewards?.questPoints > 0 && (
                      <span class="text-[var(--color-parchment)] opacity-60">
                        {quest.rewards.questPoints} QP
                      </span>
                    )}
                  </div>
                </div>
                <span class={`text-[10px] font-semibold px-2 py-1 rounded-md whitespace-nowrap ${pill.cls}`}>
                  {pill.label}
                </span>
              </div>
            </Card>
          )
        })}
      </div>

      {selectedRow && (
        <QuestDetailModal
          row={selectedRow}
          questsData={questsData}
          quests={quests}
          onClose={() => setSelected(null)}
          onStart={() => { startQuest(selectedRow.quest.id) }}
          onComplete={() => {
            const res = completeQuest(selectedRow.quest.id)
            if (res?.ok) setSelected(null)
          }}
          stats={stats}
        />
      )}
    </div>
  )
}

function QuestDetailModal({ row, questsData, quests, onClose, onStart, onComplete, stats }) {
  const { quest, status, ctx } = row
  const canStart = status === QUEST_STATUS.AVAILABLE
  const prereqOk = isPrereqMet(quest, quests)
  const reqOk = areRequirementsMet(quest, ctx)
  const objectiveRows = quest.objectives.map(obj => ({ obj, progress: getObjectiveProgress(obj, ctx) }))
  const allDone = objectiveRows.every(r => r.progress.done)
  const canComplete = status === QUEST_STATUS.IN_PROGRESS && reqOk && allDone

  return (
    <Modal onClose={onClose} title={quest.name}>
      <div class="space-y-3">
        <Panel>
          <div class="flex items-center justify-between mb-2">
            <span class={`text-[10px] font-[var(--font-display)] font-bold uppercase tracking-wider ${DIFFICULTY_COLOR[quest.difficulty] || 'text-[var(--color-parchment)]'}`}>
              {quest.difficulty}
            </span>
            <span class={`text-[10px] px-2 py-0.5 rounded-md ${STATUS_PILL[status].cls}`}>
              {STATUS_PILL[status].label}
            </span>
          </div>
          <div class="text-[12px] text-[var(--color-parchment)] opacity-80 leading-relaxed mb-2">
            {quest.description}
          </div>
          {quest.narrative?.map((line, i) => (
            <div key={i} class="text-[11px] text-[var(--color-parchment)] opacity-60 italic leading-relaxed border-l-2 border-[var(--color-gold)] pl-2 mt-2">
              {line}
            </div>
          ))}
        </Panel>

        {quest.prerequisites?.length > 0 && (
          <Panel>
            <SectionHeader size="sm" className="mb-2">Prerequisites</SectionHeader>
            {quest.prerequisites.map(qid => {
              const p = questsData[qid]
              const done = quests[qid] === QUEST_STATUS.COMPLETED
              return (
                <div key={qid} class={`text-[12px] ${done ? 'text-[#4ade80]' : 'text-[#f08a6d]'}`}>
                  {done ? '✅' : '🔒'} {p?.name || qid}
                </div>
              )
            })}
          </Panel>
        )}

        {quest.requirements && (
          <Panel>
            <SectionHeader size="sm" className="mb-2">Requirements</SectionHeader>
            {quest.requirements.skills?.map(({ skill, level }) => {
              const cur = stats?.[skill] ? getLevelFromXP(stats[skill].xp) : 1
              const met = cur >= level
              return (
                <div key={skill} class={`text-[12px] flex justify-between ${met ? 'text-[#4ade80]' : 'text-[#f08a6d]'}`}>
                  <span>{met ? '✅' : '❌'} {skill.charAt(0).toUpperCase() + skill.slice(1)}</span>
                  <span class="font-mono">{cur}/{level}</span>
                </div>
              )
            })}
            {quest.requirements.items?.map(({ itemId, quantity }) => (
              <div key={itemId} class="text-[12px] text-[var(--color-parchment)]">
                • {quantity}× {prettyItem(itemId)} (must be held)
              </div>
            ))}
          </Panel>
        )}

        <Panel>
          <SectionHeader size="sm" className="mb-2">Objectives</SectionHeader>
          {objectiveRows.map(({ obj, progress }, i) => (
            <ProgressPill key={i} done={progress.done} label={obj.label} current={progress.current} required={progress.required} />
          ))}
        </Panel>

        <Panel>
          <SectionHeader size="sm" className="mb-2">Rewards</SectionHeader>
          {quest.rewards?.xp?.map(({ skill, amount }) => (
            <div key={skill} class="text-[12px] text-[var(--color-parchment)]">
              ⭐ {amount.toLocaleString()} {skill.charAt(0).toUpperCase() + skill.slice(1)} XP
            </div>
          ))}
          {quest.rewards?.coins > 0 && (
            <div class="text-[12px] text-[var(--color-gold)]">🪙 {quest.rewards.coins.toLocaleString()} coins</div>
          )}
          {quest.rewards?.items?.map(({ itemId, quantity }) => (
            <div key={itemId} class="text-[12px] text-[var(--color-parchment)]">
              🎁 {quantity}× {prettyItem(itemId)}
            </div>
          ))}
          {quest.rewards?.questPoints > 0 && (
            <div class="text-[12px] text-[var(--color-parchment)]">📜 {quest.rewards.questPoints} Quest Points</div>
          )}
        </Panel>

        <div class="pt-2">
          {status === QUEST_STATUS.COMPLETED && (
            <Button variant="secondary" size="lg" className="w-full" disabled>Quest Complete</Button>
          )}
          {status === QUEST_STATUS.AVAILABLE && (
            <Button variant="primary" size="lg" className="w-full" onClick={onStart}>
              Accept Quest
            </Button>
          )}
          {status === QUEST_STATUS.LOCKED && (
            <Button variant="secondary" size="lg" className="w-full" disabled>
              {!prereqOk ? 'Prerequisites Not Met' : 'Requirements Not Met'}
            </Button>
          )}
          {status === QUEST_STATUS.IN_PROGRESS && (
            <Button variant={canComplete ? 'success' : 'secondary'} size="lg" className="w-full" onClick={onComplete} disabled={!canComplete}>
              {canComplete ? 'Complete Quest' : 'Objectives Not Complete'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
