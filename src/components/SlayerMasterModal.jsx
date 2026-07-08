import { useState } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import { api, getToken, getCharacterId, CREDITS_UPDATED_EVENT } from '../cloud/api.js'
import { requestCriticalPushSave } from '../cloud/sync.js'
import { CRITICAL_SAVE_REASONS } from '../cloud/criticalSavePolicy.js'
import { SLAYER_TASK_SKIP_POINT_COST } from '../engine/slayerTasks.js'
import { SLAYER_MASTERS, resolveTaskMonsterIds, pickSlayerMonster, buildSlayerTask } from '../engine/slayerMasters.js'
import { getLevelFromXP } from '../engine/experience.js'
import monstersData from '../data/monsters.json'
import GameIcon from './GameIcon.jsx'
import Modal from './Modal.jsx'

// A place hosts exactly one slayer master; tapping it opens this hub instead of
// assigning straight away. Options: get a new task (blocked while one is active,
// mirroring the skill-requirement gating), or cancel the current task for 1
// credit or SLAYER_TASK_SKIP_POINT_COST slayer points. `onGetTask` runs the
// world-map assign/travel flow; the cancel handlers own the point/credit debit.
export default function SlayerMasterModal({ masterId, onClose, onGetTask, onSlay }) {
  const master = SLAYER_MASTERS.find(m => m.id === masterId)
  const {
    stats, slayerTask, setSlayerTask, slayerPoints, updateSlayerPoints, addToast, getSnapshot,
    slayerPerks, completedQuests,
  } = useGame()
  const [busy, setBusy] = useState(false)
  if (!master) return null

  const hasTask = !!slayerTask
  const canAffordPoints = slayerPoints >= SLAYER_TASK_SKIP_POINT_COST

  // Assign a task inline so we stay in this modal on the world map. onGetTask is
  // the world-map travel gate: true → we're at the master (assign now); false →
  // a travel prompt was raised, so close and let arrival auto-assign.
  const getTask = () => {
    if (hasTask) return
    if (onGetTask?.() === false) { onClose?.(); return }
    const slayerLevel = getLevelFromXP(stats.slayer?.xp || 0)
    const pick = pickSlayerMonster(master, slayerLevel, { completedQuests })
    if (!pick) {
      addToast('No tasks available — raise your slayer level (or finish required quests) for this master.', 'error')
      return
    }
    const quantityMultiplier = slayerPerks?.doubleQuantity ? 2 : 1
    const task = buildSlayerTask(master, pick.monsterId, pick.isBoss, { quantityMultiplier })
    setSlayerTask(task)
    requestCriticalPushSave(() => getSnapshot(), CRITICAL_SAVE_REASONS.SLAYER_TASK_CHANGE)
    addToast(`💀 Task: Kill ${task.totalCount} ${task.monsterName}`, 'info')
  }

  // Route to the task monster's combat (travelling there first, with the
  // standard travel confirmation, when it lives at another place).
  const slay = () => {
    if (!hasTask) return
    const ids = resolveTaskMonsterIds(slayerTask.monsterId)
    const targetId = ids.find(id => monstersData[id]) || ids[0]
    if (!targetId || !monstersData[targetId]) {
      addToast('Could not find target monster', 'error')
      return
    }
    onSlay?.(targetId)
  }

  const cancelWithPoints = () => {
    if (!hasTask) return
    if (!canAffordPoints) {
      addToast(`Need ${SLAYER_TASK_SKIP_POINT_COST} slayer points to cancel a task.`, 'error')
      return
    }
    setSlayerTask(null)
    updateSlayerPoints(slayerPoints - SLAYER_TASK_SKIP_POINT_COST)
    requestCriticalPushSave(() => getSnapshot(), CRITICAL_SAVE_REASONS.SLAYER_TASK_CHANGE)
    addToast(`Task cancelled for ${SLAYER_TASK_SKIP_POINT_COST} slayer points.`, 'info')
  }

  const cancelWithCredit = async () => {
    if (!hasTask || busy) return
    if (!getToken() || !getCharacterId()) {
      addToast('Credit cancel requires a cloud account.', 'error')
      return
    }
    setBusy(true)
    try {
      const res = await api.slayerSkip()
      const remaining = Number(res?.credits_remaining)
      if (Number.isFinite(remaining)) {
        window.dispatchEvent(new CustomEvent(CREDITS_UPDATED_EVENT, { detail: { credits_remaining: remaining } }))
      }
      setSlayerTask(null)
      requestCriticalPushSave(() => getSnapshot(), CRITICAL_SAVE_REASONS.SLAYER_TASK_CHANGE)
      addToast('Task cancelled for 1 credit.', 'info')
    } catch (err) {
      if (err?.status === 402) addToast('Not enough credits to cancel.', 'error')
      else addToast(err?.message || 'Failed to cancel task.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const rowClass = 'flex items-center justify-between gap-3 min-h-[52px] px-4 rounded-xl border text-left transition active:opacity-80 disabled:opacity-40 disabled:pointer-events-none'

  return (
    <Modal
      title={master.name}
      titleRight={<span class="text-[11px] font-semibold text-[var(--color-parchment)] opacity-50">Slayer Master</span>}
      onClose={onClose}
    >
      <div class="flex flex-col gap-3">
        {hasTask ? (
          <div class="rounded-xl border border-[rgba(212,160,23,0.42)] bg-[rgba(212,160,23,0.06)] p-3">
            <div class="text-[9.5px] uppercase tracking-[0.14em] font-bold text-[var(--color-gold)] mb-1">Current Task</div>
            <div class="text-sm font-semibold text-[var(--color-parchment)]">
              {slayerTask.monstersRemaining} / {slayerTask.totalCount} {slayerTask.monsterName}
            </div>
          </div>
        ) : (
          <p class="text-xs text-[var(--color-parchment)] opacity-55">
            You have no active task. Get one to begin slaying.
          </p>
        )}

        {hasTask && (
          <button
            onClick={slay}
            class="flex items-center justify-center gap-1.5 min-h-[52px] px-4 rounded-xl bg-[var(--color-gold)] text-black font-bold text-sm uppercase tracking-wider active:opacity-80"
          >
            ⚔️ Slay
          </button>
        )}

        <button
          onClick={getTask}
          disabled={hasTask}
          class={`flex items-center justify-center min-h-[52px] px-4 rounded-xl font-bold text-sm uppercase tracking-wider active:opacity-80 disabled:opacity-40 disabled:pointer-events-none ${hasTask ? 'border border-[var(--color-void-border)] bg-[var(--color-void)] text-[var(--color-parchment)]' : 'bg-[var(--color-gold)] text-black'}`}
        >
          Get New Task
        </button>
        {hasTask && (
          <div class="-mt-1.5 text-[11px] text-center text-[var(--color-parchment)] opacity-45">
            Complete or cancel your current task first.
          </div>
        )}

        <div class="text-[9.5px] uppercase tracking-[0.14em] font-bold text-[var(--color-parchment)] opacity-40 mt-1">Cancel Task</div>

        <button
          onClick={cancelWithCredit}
          disabled={!hasTask || busy}
          class={`${rowClass} border-[var(--color-void-border)] bg-[var(--color-void)]`}
        >
          <span class="flex items-center gap-2 text-sm font-semibold text-[var(--color-parchment)]">
            <GameIcon iconKey="cancel" size={16} color="var(--color-gold)" /> Cancel Task
          </span>
          <span class="text-[12px] font-bold text-[var(--color-gold)]">1 Credit</span>
        </button>

        <button
          onClick={cancelWithPoints}
          disabled={!hasTask}
          class={`${rowClass} border-[var(--color-void-border)] bg-[var(--color-void)]`}
        >
          <span class="flex items-center gap-2 text-sm font-semibold text-[var(--color-parchment)]">
            <GameIcon iconKey="cancel" size={16} color="var(--color-gold)" /> Cancel Task
          </span>
          <span class={`text-[12px] font-bold ${hasTask && !canAffordPoints ? 'text-[var(--color-blood-light)]' : 'text-[var(--color-gold)]'}`}>
            {SLAYER_TASK_SKIP_POINT_COST} Slayer Points
          </span>
        </button>
      </div>
    </Modal>
  )
}
