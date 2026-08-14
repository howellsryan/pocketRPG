import { useState, useEffect, useRef } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import { grindmanXP } from '../engine/grindman.js'
import Modal from '../components/Modal.jsx'
import SkillIcon from '../components/SkillIcon.jsx'
import SkillScreenHeader from '../components/SkillScreenHeader.jsx'
import SkillInfoBanner from '../components/SkillInfoBanner.jsx'
import SkillActionRow from '../components/SkillActionRow.jsx'
import SkillActivePanel from '../components/SkillActivePanel.jsx'
import { getActionProgress } from '../hooks/useActionTick.js'
import { getLevelFromXP } from '../engine/experience.js'
import { createHunterState, processHunterTick } from '../engine/hunter.js'
import { skillingActionBlockedByFullInventory } from '../engine/skilling.js'
import { addItem } from '../engine/inventory.js'
import { emptySession } from '../engine/activitySession.js'
import { onTick } from '../engine/tick.js'
import { markScreenTick } from '../engine/activityRunner.js'
import { formatNumber } from '../utils/helpers.js'
import skillsData from '../data/skills.json'
import itemsData from '../data/items.json'

const hunterData = skillsData.hunter

export default function HunterScreen({ initialActionId, idleResult, onBack, onStopBack }) {
  const { stats, inventory, updateInventory, bank, updateBankDirect, grantXP, addToast, setActiveTask, requestActivityStart, activeTask, recordGameEvent, signalInventoryFull, resolveInventoryFull, isGrindman } = useGame()

  // Hunter catches land in the inventory (each needs a free slot).
  const HUNTER_FIT_CHECK = { dropTable: true }

  const hunterLevel = getLevelFromXP(stats.hunter?.xp || 0)
  const hunterXP = stats.hunter?.xp || 0

  const [hunter, setHunter] = useState(null)
  const [selectedActionInfo, setSelectedActionInfo] = useState(null)
  const hunterRef = useRef(null)
  const inventoryRef = useRef(inventory)
  const hasAutoStarted = useRef(false)
  // True once the player has actually seen the action list. Dropping in straight
  // from a place-map spot (initialActionId auto-start) starts false, so the
  // active panel's Back returns to that origin instead of the list.
  const seenList = useRef(!initialActionId)

  useEffect(() => { inventoryRef.current = inventory }, [inventory])

  useEffect(() => {
    if (initialActionId && !hasAutoStarted.current && !hunter) {
      hasAutoStarted.current = true
      const action = hunterData.actions.find(a => a.id === initialActionId)
      if (action && hunterLevel >= action.level) startHunting(action)
    }
  }, [initialActionId])

  // When a skip completes while actively hunting, add the skipped actions and
  // XP to the running session totals.
  useEffect(() => {
    if (!hunter?.active) return
    if (!idleResult) return
    if (idleResult.task?.type !== 'hunter') return
    const actions = idleResult.actions || 0
    const xpGained = idleResult.xpGained?.hunter || 0
    const elapsedMs = idleResult.elapsedMs || 0
    if (actions === 0 && xpGained === 0) return
    setHunter((prev) => {
      if (!prev?.active) return prev
      const next = {
        ...prev,
        totalActions: (prev.totalActions || 0) + actions,
        totalXP: (prev.totalXP || 0) + xpGained,
        startedAt: (prev.startedAt || Date.now()) - elapsedMs,
      }
      hunterRef.current = next
      return next
    })
  }, [idleResult])

  useEffect(() => {
    if (!hunter || !hunter.active) return
    hunterRef.current = hunter
    markScreenTick() // claim the task before the App-level runner's next tick

    const unsub = onTick(() => {
      const state = hunterRef.current
      if (!state || !state.active) return
      markScreenTick()

      // A full inventory pauses the hunt and raises the global prompt; the
      // check re-runs each tick so it resumes once a slot frees.
      if (skillingActionBlockedByFullInventory(HUNTER_FIT_CHECK, inventoryRef.current, itemsData)) {
        signalInventoryFull()
        return
      }
      resolveInventoryFull()

      const { hunterState, events } = processHunterTick(state)
      hunterRef.current = hunterState

      for (const ev of events) {
        if (ev.type === 'hunterSuccess') {
          // Banked, per catch — see AgilityScreen.
          const bankedXp = grantXP('hunter', ev.xp)

          // Catches fill the inventory (banked as a fallback if a rare multi-item
          // drop overflows the slot the tick-top guard reserved).
          const newInv = [...inventoryRef.current]
          for (const reward of ev.rewards) {
            const stackable = itemsData[reward.itemId]?.stackable || false
            if (!addItem(newInv, reward.itemId, reward.quantity, stackable)) {
              updateBankDirect({ [reward.itemId]: reward.quantity })
            }
          }
          updateInventory(newInv)

          hunterRef.current = {
            ...hunterRef.current,
            totalActions: (hunterRef.current.totalActions || 0) + 1,
            totalXP: (hunterRef.current.totalXP || 0) + bankedXp
          }
          if (ev.actionId) recordGameEvent?.({ kind: 'hunter_hunt', actionId: ev.actionId, count: 1 })
        }
      }

      setHunter({ ...hunterRef.current })
      if (hunterRef.current?.active) mirrorActiveTask(hunterRef.current)
    })

    return unsub
  }, [hunter?.active])

  const mirrorActiveTask = (state) => {
    if (!state) return
    setActiveTask({
      type: 'hunter',
      action: state.action,
      totalTicks: state.action.ticks,
      ticksRemaining: state.ticksRemaining,
      session: { startedAt: state.startedAt, actions: state.totalActions || 0, xp: state.totalXP || 0, coins: 0, items: 0, seeds: 0, tokens: 0 },
    }, { skipCloudSync: true })
  }

  const buildResumedState = (task) => {
    const action = hunterData.actions.find(a => a.id === task.action?.id)
    if (!action) return null
    const state = { ...createHunterState(action), totalActions: task.session?.actions || 0, totalXP: task.session?.xp || 0, startedAt: task.session?.startedAt || Date.now() }
    if (typeof task.ticksRemaining === 'number' && task.ticksRemaining > 0 && task.ticksRemaining <= action.ticks) state.ticksRemaining = task.ticksRemaining
    return state
  }

  // Resume a hunting action already running in the background.
  useEffect(() => {
    if (hunter || hasAutoStarted.current) return
    if (activeTask?.type !== 'hunter') return
    const resumed = buildResumedState(activeTask)
    if (!resumed) return
    hasAutoStarted.current = true
    setHunter(resumed)
    hunterRef.current = resumed
  }, [])

  const startHunting = (action) => {
    if (activeTask?.type === 'hunter' && activeTask.action?.id === action.id) {
      const resumed = buildResumedState(activeTask)
      if (resumed) { setHunter(resumed); hunterRef.current = resumed; return }
    }
    // Map-driven gating (Phase 3): must be at a place that offers this hunt.
    if (!requestActivityStart({ type: 'hunter', action })) return
    const startedAt = Date.now()
    const state = {
      ...createHunterState(action),
      totalActions: 0,
      totalXP: 0,
      startedAt
    }
    setHunter(state)
    hunterRef.current = state
    setActiveTask({ type: 'hunter', action, session: emptySession(startedAt) })
    addToast(`Started ${action.name}`, 'info')
  }

  const backToList = () => {
    seenList.current = true
    if (hunterRef.current) mirrorActiveTask(hunterRef.current)
    setHunter(null)
    hunterRef.current = null
  }

  // Active-panel Back: leave the task running. If we auto-started here from a
  // place map (never saw the list), return to that origin rather than the
  // skill's own list — a dead end under world-map navigation.
  const backFromActive = () => {
    const toOrigin = !seenList.current
    backToList()
    if (toOrigin && onBack) onBack()
  }

  const stopHunting = () => {
    setHunter(null)
    hunterRef.current = null
    setActiveTask(null)
    // Stop & Back returns to where the player came from — the place-map origin
    // (onStopBack/onBack from a returnTo) or the previous screen.
    const back = onStopBack || onBack
    if (back) back()
  }

  if (!hunter) {
    return (
      <>
      <div class="forge-shell h-full overflow-y-auto p-4">
        <SkillScreenHeader
          skill="hunter"
          title="Hunter"
          xp={hunterXP}
          level={hunterLevel}
          onBack={onBack}
        />

        <SkillInfoBanner
          icon={<SkillIcon skill="hunter" size={19} />}
          className="mb-4"
        >
          Hunt creatures and NPCs to earn items and experience.
        </SkillInfoBanner>

        <div class="flex flex-col gap-2.5">
          {hunterData.actions.map(action => {
            const available = hunterLevel >= action.level
            return (
              <div key={action.id} class="flex gap-2 items-center">
                <div class="flex-1 min-w-0">
                  <SkillActionRow
                    icon={<SkillIcon skill="hunter" size={26} />}
                    title={action.name}
                    meta={<><span class="text-[var(--color-gold)] font-bold opacity-100">Lv {action.level}</span> · {grindmanXP(action.xp, isGrindman)} XP · {action.description}</>}
                    active={activeTask?.type === 'hunter' && activeTask.action?.id === action.id}
                    locked={!available}
                    lockBadge={`LV ${action.level}`}
                    lockHint={`Unlocks at Hunter ${action.level}`}
                    onClick={() => startHunting(action)}
                  />
                </div>
                <button
                  onClick={() => setSelectedActionInfo(action)}
                  aria-label="Action info"
                  class="flex-shrink-0 w-11 h-11 rounded-full border border-[var(--color-void-border)] bg-[var(--color-void-light)] text-[var(--color-gold)] text-[15px] font-bold flex items-center justify-center active:opacity-70"
                  title="View Action Info"
                >
                  ⓘ
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {selectedActionInfo && (
        <Modal onClose={() => setSelectedActionInfo(null)}>
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-[var(--font-display)] text-base font-bold text-[var(--color-gold)]">
              🎯 {selectedActionInfo.name}
            </h3>
            <button
              onClick={() => setSelectedActionInfo(null)}
              class="w-6 h-6 flex items-center justify-center rounded-lg bg-[var(--color-void-light)] text-[var(--color-parchment)] hover:bg-[var(--color-void-lighter)] active:bg-[var(--color-void-lighter)] transition-colors"
              title="Close"
            >
              ✕
            </button>
          </div>
          <div class="space-y-4 max-h-96 overflow-y-auto">
            <div>
              <h4 class="text-xs font-semibold text-[var(--color-gold-dim)] uppercase tracking-wider mb-2 opacity-70">Action Info</h4>
              <div class="bg-[var(--color-void)] rounded-lg p-3 space-y-1">
                <div class="flex justify-between text-[11px] text-[var(--color-parchment)]"><span>Level Required</span><span class="font-[var(--font-mono)] text-[var(--color-gold)]">{selectedActionInfo.level}</span></div>
                <div class="flex justify-between text-[11px] text-[var(--color-parchment)]"><span>XP Granted</span><span class="font-[var(--font-mono)] text-[var(--color-gold)]">{grindmanXP(selectedActionInfo.xp, isGrindman)}</span></div>
                <div class="flex justify-between text-[11px] text-[var(--color-parchment)]"><span>Time per Action</span><span class="font-[var(--font-mono)] text-[var(--color-gold)]">{(selectedActionInfo.ticks * 0.6).toFixed(1)}s</span></div>
              </div>
            </div>

            {selectedActionInfo.rewardTables && selectedActionInfo.rewardTables.length > 0 && (
              <div>
                <h4 class="text-xs font-semibold text-[var(--color-gold-dim)] uppercase tracking-wider mb-2 opacity-70">Reward Table {selectedActionInfo.rewardTables.length > 1 ? `(Main)` : ''}</h4>
                <div class="bg-[var(--color-void)] rounded-lg p-3 space-y-1.5">
                  {selectedActionInfo.rewardTables[0].rewards.map((reward, idx) => {
                    const itemData = itemsData[reward.itemId]
                    const chance = (reward.chance * 100).toFixed(2)
                    const quantityStr = typeof reward.quantity === 'object'
                      ? `${reward.quantity[0]}–${reward.quantity[1]}`
                      : reward.quantity
                    return (
                      <div key={idx} class="flex justify-between text-[11px] text-[var(--color-parchment)]">
                        <span>{itemData?.name || reward.itemId}</span>
                        <span class="font-[var(--font-mono)] text-[var(--color-gold)]">{chance}% ({quantityStr})</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {selectedActionInfo.rewardTables && selectedActionInfo.rewardTables.length > 1 && (
              <div>
                <h4 class="text-xs font-semibold text-[var(--color-gold-dim)] uppercase tracking-wider mb-2 opacity-70">Rare Reward Table (1/{selectedActionInfo.rewardTables[1].rarity || 'Unknown'})</h4>
                <div class="bg-[var(--color-void)] rounded-lg p-3 space-y-1.5">
                  {selectedActionInfo.rewardTables[1].rewards.map((reward, idx) => {
                    const itemData = itemsData[reward.itemId]
                    const chance = (reward.chance * 100).toFixed(2)
                    const quantityStr = typeof reward.quantity === 'object'
                      ? `${reward.quantity[0]}–${reward.quantity[1]}`
                      : reward.quantity
                    return (
                      <div key={idx} class="flex justify-between text-[11px] text-[var(--color-parchment)]">
                        <span>{itemData?.name || reward.itemId}</span>
                        <span class="font-[var(--font-mono)] text-[var(--color-gold)]">{chance}% ({quantityStr})</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {selectedActionInfo.rewardTables && selectedActionInfo.rewardTables.length > 2 && (
              <div>
                <h4 class="text-xs font-semibold text-[var(--color-gold-dim)] uppercase tracking-wider mb-2 opacity-70">Very Rare Reward Table (1/{selectedActionInfo.rewardTables[2].rarity || 'Unknown'})</h4>
                <div class="bg-[var(--color-void)] rounded-lg p-3 space-y-1.5">
                  {selectedActionInfo.rewardTables[2].rewards.map((reward, idx) => {
                    const itemData = itemsData[reward.itemId]
                    const chance = (reward.chance * 100).toFixed(2)
                    const quantityStr = typeof reward.quantity === 'object'
                      ? `${reward.quantity[0]}–${reward.quantity[1]}`
                      : reward.quantity
                    return (
                      <div key={idx} class="flex justify-between text-[11px] text-[var(--color-parchment)]">
                        <span>{itemData?.name || reward.itemId}</span>
                        <span class="font-[var(--font-mono)] text-[var(--color-gold)]">{chance}% ({quantityStr})</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
      </>
    )
  }

  const progress = getActionProgress(hunter.active, hunter.ticksRemaining, hunter.action.ticks)
  const elapsed = hunter.startedAt ? Date.now() - hunter.startedAt : 0
  const actionsPerHr = elapsed > 5000 && hunter.totalActions > 0
    ? Math.round(hunter.totalActions / (elapsed / 3_600_000))
    : null
  const xpPerHr = elapsed > 5000 && hunter.totalXP > 0
    ? Math.round(hunter.totalXP / (elapsed / 3_600_000))
    : null

  const inventoryBlocked = skillingActionBlockedByFullInventory(HUNTER_FIT_CHECK, inventory, itemsData)
  return (
    <>
    <SkillActivePanel
      skill="hunter"
      title={hunter.action.name}
      subtitle={inventoryBlocked ? 'Inventory full — paused' : hunter.action.description}
      progress={progress}
      stats={[
        { label: 'Actions completed', value: hunter.totalActions },
        { label: 'Actions / hr', value: actionsPerHr ? actionsPerHr.toLocaleString() : '—', accent: !!actionsPerHr },
        { label: 'XP gained', value: formatNumber(hunter.totalXP) },
        { label: 'XP / hr', value: xpPerHr ? formatNumber(xpPerHr) : '—', accent: !!xpPerHr },
      ]}
      onBack={backFromActive}
      onStop={stopHunting}
    />

    {selectedActionInfo && (
      <Modal onClose={() => setSelectedActionInfo(null)}>
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-[var(--font-display)] text-base font-bold text-[var(--color-gold)]">
            🎯 {selectedActionInfo.name}
          </h3>
          <button
            onClick={() => setSelectedActionInfo(null)}
            class="w-6 h-6 flex items-center justify-center rounded-lg bg-[var(--color-void-light)] text-[var(--color-parchment)] hover:bg-[var(--color-void-lighter)] active:bg-[var(--color-void-lighter)] transition-colors"
            title="Close"
          >
            ✕
          </button>
        </div>
        <div class="space-y-4 max-h-96 overflow-y-auto">
          <div>
            <h4 class="text-xs font-semibold text-[var(--color-gold-dim)] uppercase tracking-wider mb-2 opacity-70">Action Info</h4>
            <div class="bg-[var(--color-void)] rounded-lg p-3 space-y-1">
              <div class="flex justify-between text-[11px] text-[var(--color-parchment)]"><span>Level Required</span><span class="font-[var(--font-mono)] text-[var(--color-gold)]">{selectedActionInfo.level}</span></div>
              <div class="flex justify-between text-[11px] text-[var(--color-parchment)]"><span>XP Granted</span><span class="font-[var(--font-mono)] text-[var(--color-gold)]">{grindmanXP(selectedActionInfo.xp, isGrindman)}</span></div>
              <div class="flex justify-between text-[11px] text-[var(--color-parchment)]"><span>Time per Action</span><span class="font-[var(--font-mono)] text-[var(--color-gold)]">{(selectedActionInfo.ticks * 0.6).toFixed(1)}s</span></div>
            </div>
          </div>

          {selectedActionInfo.rewardTables && selectedActionInfo.rewardTables.length > 0 && (
            <div>
              <h4 class="text-xs font-semibold text-[var(--color-gold-dim)] uppercase tracking-wider mb-2 opacity-70">Reward Table {selectedActionInfo.rewardTables.length > 1 ? `(Main)` : ''}</h4>
              <div class="bg-[var(--color-void)] rounded-lg p-3 space-y-1.5">
                {selectedActionInfo.rewardTables[0].rewards.map((reward, idx) => {
                  const itemData = itemsData[reward.itemId]
                  const chance = (reward.chance * 100).toFixed(2)
                  const quantityStr = typeof reward.quantity === 'object'
                    ? `${reward.quantity[0]}–${reward.quantity[1]}`
                    : reward.quantity
                  return (
                    <div key={idx} class="flex justify-between text-[11px] text-[var(--color-parchment)]">
                      <span>{itemData?.name || reward.itemId}</span>
                      <span class="font-[var(--font-mono)] text-[var(--color-gold)]">{chance}% ({quantityStr})</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {selectedActionInfo.rewardTables && selectedActionInfo.rewardTables.length > 1 && (
            <div>
              <h4 class="text-xs font-semibold text-[var(--color-gold-dim)] uppercase tracking-wider mb-2 opacity-70">Rare Reward Table (1/{selectedActionInfo.rewardTables[1].rarity || 'Unknown'})</h4>
              <div class="bg-[var(--color-void)] rounded-lg p-3 space-y-1.5">
                {selectedActionInfo.rewardTables[1].rewards.map((reward, idx) => {
                  const itemData = itemsData[reward.itemId]
                  const chance = (reward.chance * 100).toFixed(2)
                  const quantityStr = typeof reward.quantity === 'object'
                    ? `${reward.quantity[0]}–${reward.quantity[1]}`
                    : reward.quantity
                  return (
                    <div key={idx} class="flex justify-between text-[11px] text-[var(--color-parchment)]">
                      <span>{itemData?.name || reward.itemId}</span>
                      <span class="font-[var(--font-mono)] text-[var(--color-gold)]">{chance}% ({quantityStr})</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {selectedActionInfo.rewardTables && selectedActionInfo.rewardTables.length > 2 && (
            <div>
              <h4 class="text-xs font-semibold text-[var(--color-gold-dim)] uppercase tracking-wider mb-2 opacity-70">Very Rare Reward Table (1/{selectedActionInfo.rewardTables[2].rarity || 'Unknown'})</h4>
              <div class="bg-[var(--color-void)] rounded-lg p-3 space-y-1.5">
                {selectedActionInfo.rewardTables[2].rewards.map((reward, idx) => {
                  const itemData = itemsData[reward.itemId]
                  const chance = (reward.chance * 100).toFixed(2)
                  const quantityStr = typeof reward.quantity === 'object'
                    ? `${reward.quantity[0]}–${reward.quantity[1]}`
                    : reward.quantity
                  return (
                    <div key={idx} class="flex justify-between text-[11px] text-[var(--color-parchment)]">
                      <span>{itemData?.name || reward.itemId}</span>
                      <span class="font-[var(--font-mono)] text-[var(--color-gold)]">{chance}% ({quantityStr})</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </Modal>
    )}
    </>
  )
}
