import { useState } from 'preact/hooks'
import Modal from './Modal.jsx'
import { useGame } from '../state/gameState.jsx'
import { describeActivity, activityGroupLabel, activityLockReason } from '../engine/worldContent.js'
import { checkQuestEligibility, formatQuestDuration } from '../engine/quests.js'
import { COMPLEXITY_COLORS } from '../utils/complexityColors.js'
import questsData from '../data/quests.json'

/**
 * One activity category's actions, e.g. all "Skill" refs at a place — sub-grouped
 * by skill (activityGroupLabel) where that's meaningful, so a 140-action city
 * doesn't render as one flat list. Vellum ledger panel (wm-actmodal-panel),
 * matching the app-wide Forgemark parchment. Shared between the world-map place
 * hub (read-only browse: `readOnly`) and the place map's spot picker (rows
 * clickable, starting via `onActivate(kind, ref)`).
 *
 * Rows the player can't start yet render disabled with the blocking reason
 * (activityLockReason — level/slayer/quest gates), matching the owning screens'
 * locks. Quests are the exception to `readOnly`: their journeys plan from
 * wherever the player is, so quest rows stay clickable even in a browse-only
 * hub; a completed quest renders done rather than locked. Quest rows keep the
 * lock chip short ("Locked", not the full requirement list — that can dwarf the
 * screen) and carry an ⓘ button opening QuestInfoModal with the quest's full
 * requirements and rewards.
 */
export default function ActivityPickerModal({ kind, refs, label, onClose, onActivate, readOnly = false }) {
  const { stats, completedQuests, bossKillCounts } = useGame()
  const [infoQuestId, setInfoQuestId] = useState(null)
  const lockCtx = { stats, completedQuests, bossKillCounts }
  const rowsReadOnly = readOnly && kind !== 'quest'

  // Ascending by level (unmapped/no-level entries sort last, stable otherwise) so
  // low-level skilling actions and weak monsters lead the list.
  const sortedRefs = refs
    .map((ref) => ({ ref, level: describeActivity(kind, ref).level }))
    .sort((a, b) => {
      if (a.level == null && b.level == null) return 0
      if (a.level == null) return 1
      if (b.level == null) return -1
      return a.level - b.level
    })
    .map((x) => x.ref)

  const groups = []
  const byLabel = new Map()
  for (const ref of sortedRefs) {
    const groupLabel = activityGroupLabel(kind, ref)
    if (groupLabel == null) { groups.push({ label: null, refs: [ref] }); continue }
    let g = byLabel.get(groupLabel)
    if (!g) { g = { label: groupLabel, refs: [] }; byLabel.set(groupLabel, g); groups.push(g) }
    g.refs.push(ref)
  }

  return (
    <>
    <Modal title={label} titleRight={<span class="wm-actmodal-count">{refs.length}</span>} onClose={onClose} className="wm-actmodal-panel" contentClassName="wm-actmodal-content">
      {rowsReadOnly && <div class="wm-actmodal-note">Offered here — start activities from the town map when you visit.</div>}
      {groups.map((g, gi) => (
        <div class="wm-actmodal-group" key={g.label || gi}>
          {g.label && (
            <div class="wm-actmodal-grouphead" style={kind === 'quest' ? { color: COMPLEXITY_COLORS[g.label] } : undefined}>{g.label}</div>
          )}
          <div class="fm-ledger">
            {g.refs.map((ref, i) => {
              const d = describeActivity(kind, ref)
              const lock = activityLockReason(kind, ref, lockCtx)
              // Quest rows keep the chip short — full requirements live in the ⓘ modal.
              const lockChip = lock
                ? (lock.completed ? 'Complete' : kind === 'quest' ? '🔒 Locked' : `🔒 ${lock.reason}`)
                : null
              const inner = (
                <>
                  <span class="wm-actmodal-row__icon">{lock?.completed ? '✅' : d.icon}</span>
                  <span class="wm-actmodal-row__name">{d.name}</span>
                  {lockChip
                    ? <span class="wm-actmodal-row__lock">{lockChip}</span>
                    : kind !== 'quest' && d.level != null && <span class="wm-actmodal-row__lvl">{d.level}</span>}
                </>
              )
              const row = rowsReadOnly
                ? <div class="wm-actmodal-row wm-actmodal-row--static">{inner}</div>
                : lock
                  ? <div class={`wm-actmodal-row wm-actmodal-row--static${lock.completed ? '' : ' wm-actmodal-row--locked'}`} aria-disabled="true" title={lock.reason}>{inner}</div>
                  : <button class="wm-actmodal-row" onClick={() => onActivate(kind, ref)}>{inner}</button>
              if (kind !== 'quest') return <div key={i}>{row}</div>
              return (
                <div class="flex items-center gap-1.5" key={i}>
                  <div class="flex-1 min-w-0">{row}</div>
                  <button
                    onClick={() => setInfoQuestId(ref)}
                    aria-label={`${d.name} requirements and rewards`}
                    title="Requirements & rewards"
                    class="flex-shrink-0 w-11 h-11 rounded-full border border-[var(--color-void-border)] bg-[var(--color-void-light)] text-[var(--color-gold)] text-[15px] font-bold flex items-center justify-center active:opacity-70"
                  >
                    ⓘ
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </Modal>
    {infoQuestId && <QuestInfoModal questId={infoQuestId} onClose={() => setInfoQuestId(null)} />}
    </>
  )
}

/**
 * Quest requirements & rewards modal — opened from a quest row's ⓘ button so
 * long requirement lists never take over the picker itself. Requirements render
 * ✓/✗ against the live character (checkQuestEligibility), rewards mirror the
 * quest board's detail view.
 */
function QuestInfoModal({ questId, onClose }) {
  const { stats, completedQuests, itemsData } = useGame()
  const quest = questsData.find((q) => q.id === questId)
  if (!quest) return null

  const elig = checkQuestEligibility(quest, stats, completedQuests, questsData)
  const skillEntries = Object.entries(quest.skillRequirements || {})
  const questPrereqs = quest.questRequirements || []
  const hasRequirements = skillEntries.length > 0 || questPrereqs.length > 0 || quest.questPointRequirement > 0 || quest.combatLevelRequirement > 0
  const itemUnlockNames = (quest.itemUnlocks || []).map((id) => itemsData?.[id]?.name || id)

  const reqRow = (label, ok, key) => (
    <div key={key} class={`flex items-center gap-2 ${ok ? 'text-[#4ade80]' : 'text-[#e57373]'}`}>
      <span>{ok ? '✓' : '✗'}</span>
      <span>{label}</span>
    </div>
  )

  return (
    <Modal title={quest.name} onClose={onClose} className="wm-actmodal-panel" contentClassName="wm-actmodal-content">
      <div class="flex flex-col gap-3 text-[var(--color-parchment)]">
        <div class="text-[12px]">
          <span style={{ color: COMPLEXITY_COLORS[quest.complexity] }}>{quest.complexity}</span>
          <span class="opacity-50"> · {quest.length} · {formatQuestDuration(quest.durationSeconds)}</span>
        </div>

        <div>
          <div class="text-[11px] uppercase font-bold tracking-[0.12em] text-[var(--color-gold)] mb-1.5">Rewards</div>
          <div class="text-[12px] flex flex-col gap-1">
            <div>🪙 <span class="font-[var(--font-mono)] text-[var(--color-gold)]">{quest.coinReward.toLocaleString()}</span> coins</div>
            {Object.entries(quest.xpReward || {}).map(([skill, xp]) => (
              <div key={skill}>⭐ <span class="font-[var(--font-mono)] text-[var(--color-gold)]">{xp.toLocaleString()}</span> {skill} XP</div>
            ))}
            {itemUnlockNames.length > 0 && (
              <div>🎁 Unlocks: <span class="text-[var(--color-gold)]">{itemUnlockNames.join(', ')}</span></div>
            )}
          </div>
        </div>

        {hasRequirements && (
          <div>
            <div class="text-[11px] uppercase font-bold tracking-[0.12em] text-[var(--color-gold)] mb-1.5">Requirements</div>
            <div class="text-[12px] flex flex-col gap-1">
              {quest.questPointRequirement > 0 && reqRow(
                `${quest.questPointRequirement} Quest points`,
                !elig.reasons.some((r) => r.includes('Quest points')), 'qp')}
              {quest.combatLevelRequirement > 0 && reqRow(
                `Combat level ${quest.combatLevelRequirement}`,
                !elig.reasons.some((r) => r.startsWith('Combat level')), 'cb')}
              {skillEntries.map(([skill, lvl]) => reqRow(
                `${skill.charAt(0).toUpperCase() + skill.slice(1)} ${lvl}`,
                !elig.reasons.some((r) => r.toLowerCase().startsWith(skill.toLowerCase())), skill))}
              {questPrereqs.map((pid) => {
                const prereq = questsData.find((q) => q.id === pid)
                return reqRow(`Quest: ${prereq ? prereq.name : pid}`, completedQuests.has(pid), pid)
              })}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
