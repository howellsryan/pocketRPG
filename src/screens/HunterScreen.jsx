import { useState, useEffect, useRef } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import ProgressBar from '../components/ProgressBar.jsx'
import Modal from '../components/Modal.jsx'
import { getActionProgress } from '../hooks/useActionTick.js'
import { getLevelFromXP } from '../engine/experience.js'
import { createHunterState, processHunterTick } from '../engine/hunter.js'
import { onTick } from '../engine/tick.js'
import { formatNumber } from '../utils/helpers.js'
import skillsData from '../data/skills.json'

const hunterData = skillsData.hunter

export default function HunterScreen({ initialActionId, onBack }) {
  const { stats, inventory, updateInventory, bank, updateBankDirect, grantXP, addToast, setActiveTask, items } = useGame()

  const hunterLevel = getLevelFromXP(stats.hunter?.xp || 0)
  const hunterXP = stats.hunter?.xp || 0

  const [hunter, setHunter] = useState(null)
  const [selectedActionInfo, setSelectedActionInfo] = useState(null)
  const hunterRef = useRef(null)
  const inventoryRef = useRef(inventory)
  const hasAutoStarted = useRef(false)

  useEffect(() => { inventoryRef.current = inventory }, [inventory])

  useEffect(() => {
    if (initialActionId && !hasAutoStarted.current && !hunter) {
      hasAutoStarted.current = true
      const action = hunterData.actions.find(a => a.id === initialActionId)
      if (action && hunterLevel >= action.level) startHunting(action)
    }
  }, [initialActionId])

  useEffect(() => {
    if (!hunter || !hunter.active) return
    hunterRef.current = hunter

    const unsub = onTick(() => {
      const state = hunterRef.current
      if (!state || !state.active) return

      const { hunterState, events } = processHunterTick(state)
      hunterRef.current = hunterState

      for (const ev of events) {
        if (ev.type === 'hunterSuccess') {
          grantXP('hunter', ev.xp)

          for (const reward of ev.rewards) {
            updateBankDirect({ [reward.itemId]: reward.quantity })
          }

          hunterRef.current = {
            ...hunterRef.current,
            totalActions: (hunterRef.current.totalActions || 0) + 1,
            totalXP: (hunterRef.current.totalXP || 0) + ev.xp
          }
        }
      }

      setHunter({ ...hunterRef.current })
    })

    return unsub
  }, [hunter?.active])

  const startHunting = (action) => {
    const state = {
      ...createHunterState(action),
      totalActions: 0,
      totalXP: 0,
      startedAt: Date.now()
    }
    setHunter(state)
    hunterRef.current = state
    setActiveTask({ type: 'hunter', action })
    addToast(`Started ${action.name}`, 'info')
  }

  const stopHunting = () => {
    setHunter(null)
    hunterRef.current = null
    setActiveTask(null)
  }

  if (!hunter) {
    return (
      <>
      <div class="h-full overflow-y-auto p-4">
        {onBack && (
          <button onClick={onBack} class="text-xs text-[var(--color-gold-dim)] mb-3 flex items-center gap-1">
            ← Skills
          </button>
        )}
        <div class="flex items-center justify-between mb-1">
          <h2 class="font-[var(--font-display)] text-sm font-bold text-[var(--color-parchment)] opacity-60 uppercase tracking-wider">
            Hunting Actions
          </h2>
          <span class="text-xs font-[var(--font-mono)] text-[var(--color-gold)]">Lv {hunterLevel}</span>
        </div>

        <div class="mb-3 bg-[#111] rounded-lg px-3 py-2 text-[11px] text-[var(--color-parchment)] opacity-60 flex items-center gap-2">
          <span>🎯</span>
          <span>Hunt creatures and NPCs to earn items and experience</span>
        </div>

        <div class="space-y-2">
          {hunterData.actions.map(action => {
            const available = hunterLevel >= action.level
            return (
              <div key={action.id} class="flex gap-2 items-center">
                <button
                  onClick={() => available && startHunting(action)}
                  disabled={!available}
                  class={`flex-1 flex items-between justify-between p-3 rounded-xl border transition-colors text-left
                    ${available
                      ? 'bg-[#1a1a1a] border-[#2a2a2a] active:bg-[#222]'
                      : 'bg-[#111] border-[#1a1a1a] opacity-40'}`}
                >
                  <div class="flex-1">
                    <div class="text-sm font-semibold text-[var(--color-parchment)]">{action.name}</div>
                    <div class="text-[10px] text-[var(--color-parchment)] opacity-40 mt-0.5">
                      Lv {action.level} · {action.xp} XP
                    </div>
                    <div class="text-[10px] text-[var(--color-parchment)] opacity-40">{action.description}</div>
                  </div>
                </button>
                <button
                  onClick={() => setSelectedActionInfo(action)}
                  aria-label="Action info"
                  class="flex-shrink-0 w-9 h-9 rounded-full border border-[var(--color-void-border)] bg-[var(--color-void-light)] text-[var(--color-gold)] text-[14px] font-bold flex items-center justify-center active:opacity-70"
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
              class="w-6 h-6 flex items-center justify-center rounded-lg bg-[#222] text-[var(--color-parchment)] hover:bg-[#333] active:bg-[#444] transition-colors"
              title="Close"
            >
              ✕
            </button>
          </div>
          <div class="space-y-4 max-h-96 overflow-y-auto">
            <div>
              <h4 class="text-xs font-semibold text-[var(--color-gold-dim)] uppercase tracking-wider mb-2 opacity-70">Action Info</h4>
              <div class="bg-[#111] rounded-lg p-3 space-y-1">
                <div class="flex justify-between text-[11px] text-[var(--color-parchment)]"><span>Level Required</span><span class="font-[var(--font-mono)] text-[var(--color-gold)]">{selectedActionInfo.level}</span></div>
                <div class="flex justify-between text-[11px] text-[var(--color-parchment)]"><span>XP Granted</span><span class="font-[var(--font-mono)] text-[var(--color-gold)]">{selectedActionInfo.xp}</span></div>
                <div class="flex justify-between text-[11px] text-[var(--color-parchment)]"><span>Time per Action</span><span class="font-[var(--font-mono)] text-[var(--color-gold)]">{(selectedActionInfo.ticks * 0.6).toFixed(1)}s</span></div>
              </div>
            </div>

            {selectedActionInfo.rewardTables && selectedActionInfo.rewardTables.length > 0 && (
              <div>
                <h4 class="text-xs font-semibold text-[var(--color-gold-dim)] uppercase tracking-wider mb-2 opacity-70">Reward Table {selectedActionInfo.rewardTables.length > 1 ? `(Main)` : ''}</h4>
                <div class="bg-[#111] rounded-lg p-3 space-y-1.5">
                  {selectedActionInfo.rewardTables[0].rewards.map((reward, idx) => {
                    const itemData = items?.[reward.itemId]
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
                <div class="bg-[#111] rounded-lg p-3 space-y-1.5">
                  {selectedActionInfo.rewardTables[1].rewards.map((reward, idx) => {
                    const itemData = items?.[reward.itemId]
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
                <div class="bg-[#111] rounded-lg p-3 space-y-1.5">
                  {selectedActionInfo.rewardTables[2].rewards.map((reward, idx) => {
                    const itemData = items?.[reward.itemId]
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

  return (
    <>
    <div class="h-full flex flex-col p-4">
      <div class="flex-1 flex flex-col items-center justify-center">
        <span class="text-4xl mb-2">🎯</span>
        <h2 class="font-[var(--font-display)] text-lg font-bold text-[var(--color-gold)] mb-1">
          {hunter.action.name}
        </h2>
        <div class="text-xs text-[var(--color-parchment)] opacity-40 mb-4">
          {hunter.action.description}
        </div>

        <div class="w-full max-w-xs mb-4">
          <ProgressBar value={progress} max={1} height="h-4" color="var(--color-gold)" showText />
        </div>

        <div class="bg-[#111] rounded-lg p-3 w-full max-w-xs space-y-1.5">
          <div class="flex justify-between text-sm">
            <span class="text-[var(--color-parchment)] opacity-60">Actions completed</span>
            <span class="font-[var(--font-mono)] text-[var(--color-gold)]">{hunter.totalActions}</span>
          </div>
          <div class="flex justify-between text-sm">
            <span class="text-[var(--color-parchment)] opacity-60">Actions/hr</span>
            <span class="font-[var(--font-mono)] text-[var(--color-gold)]">{actionsPerHr ? actionsPerHr.toLocaleString() : '—'}</span>
          </div>
          <div class="flex justify-between text-sm">
            <span class="text-[var(--color-parchment)] opacity-60">XP gained</span>
            <span class="font-[var(--font-mono)] text-[var(--color-gold)]">{formatNumber(hunter.totalXP)}</span>
          </div>
          <div class="flex justify-between text-sm">
            <span class="text-[var(--color-parchment)] opacity-60">XP/hr</span>
            <span class="font-[var(--font-mono)] text-[var(--color-gold)]">{xpPerHr ? formatNumber(xpPerHr) : '—'}</span>
          </div>
        </div>
      </div>

      <div class="flex-shrink-0 flex gap-2 mt-3">
        <button onClick={stopHunting}
          class="flex-1 py-2.5 rounded-lg bg-[#222] text-[var(--color-parchment)] font-semibold text-sm active:opacity-80">
          ← Stop &amp; Back
        </button>
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
            class="w-6 h-6 flex items-center justify-center rounded-lg bg-[#222] text-[var(--color-parchment)] hover:bg-[#333] active:bg-[#444] transition-colors"
            title="Close"
          >
            ✕
          </button>
        </div>
        <div class="space-y-4 max-h-96 overflow-y-auto">
          <div>
            <h4 class="text-xs font-semibold text-[var(--color-gold-dim)] uppercase tracking-wider mb-2 opacity-70">Action Info</h4>
            <div class="bg-[#111] rounded-lg p-3 space-y-1">
              <div class="flex justify-between text-[11px] text-[var(--color-parchment)]"><span>Level Required</span><span class="font-[var(--font-mono)] text-[var(--color-gold)]">{selectedActionInfo.level}</span></div>
              <div class="flex justify-between text-[11px] text-[var(--color-parchment)]"><span>XP Granted</span><span class="font-[var(--font-mono)] text-[var(--color-gold)]">{selectedActionInfo.xp}</span></div>
              <div class="flex justify-between text-[11px] text-[var(--color-parchment)]"><span>Time per Action</span><span class="font-[var(--font-mono)] text-[var(--color-gold)]">{(selectedActionInfo.ticks * 0.6).toFixed(1)}s</span></div>
            </div>
          </div>

          {selectedActionInfo.rewardTables && selectedActionInfo.rewardTables.length > 0 && (
            <div>
              <h4 class="text-xs font-semibold text-[var(--color-gold-dim)] uppercase tracking-wider mb-2 opacity-70">Reward Table {selectedActionInfo.rewardTables.length > 1 ? `(Main)` : ''}</h4>
              <div class="bg-[#111] rounded-lg p-3 space-y-1.5">
                {selectedActionInfo.rewardTables[0].rewards.map((reward, idx) => {
                  const itemData = items?.[reward.itemId]
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
              <div class="bg-[#111] rounded-lg p-3 space-y-1.5">
                {selectedActionInfo.rewardTables[1].rewards.map((reward, idx) => {
                  const itemData = items?.[reward.itemId]
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
              <div class="bg-[#111] rounded-lg p-3 space-y-1.5">
                {selectedActionInfo.rewardTables[2].rewards.map((reward, idx) => {
                  const itemData = items?.[reward.itemId]
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
