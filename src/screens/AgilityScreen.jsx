import { useState, useEffect, useRef } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import ProgressBar from '../components/ProgressBar.jsx'
import { getLevelFromXP } from '../engine/experience.js'
import { createAgilityState, processAgilityTick, getAgilityBankDelayMs, formatBankDelay } from '../engine/agility.js'
import { onTick } from '../engine/tick.js'
import { formatNumber } from '../utils/helpers.js'
import skillsData from '../data/skills.json'

const agilityData = skillsData.agility

export default function AgilityScreen({ initialActionId, onBack, onSkipHour, skipHourUnlocked }) {
  const { stats, inventory, updateInventory, bank, updateBankDirect, grantXP, addToast, setActiveTask } = useGame()

  const agilityLevel = getLevelFromXP(stats.agility?.xp || 0)
  const agilityXP = stats.agility?.xp || 0

  const [agility, setAgility] = useState(null)
  const agilityRef = useRef(null)
  const inventoryRef = useRef(inventory)
  const hasAutoStarted = useRef(false)

  // Keep inventoryRef current
  useEffect(() => { inventoryRef.current = inventory }, [inventory])

  // Auto-start from shortcut
  useEffect(() => {
    if (initialActionId && !hasAutoStarted.current && !agility) {
      hasAutoStarted.current = true
      const action = agilityData.actions.find(a => a.id === initialActionId)
      if (action && agilityLevel >= action.level) startCourse(action)
    }
  }, [initialActionId])

  // Tick listener
  useEffect(() => {
    if (!agility || !agility.active) return
    agilityRef.current = agility

    const unsub = onTick(() => {
      const state = agilityRef.current
      if (!state || !state.active) return

      const { agilityState, events } = processAgilityTick(state)
      agilityRef.current = agilityState

      for (const ev of events) {
        if (ev.type === 'courseComplete') {
          grantXP('agility', ev.xp)
          if (ev.coinReward > 0) {
            // Coins go to inventory; fall back to bank if full
            const currentInv = [...(inventoryRef.current)]
            const coinsSlotIdx = currentInv.findIndex(s => s && s.itemId === 'coins')
            if (coinsSlotIdx >= 0) {
              currentInv[coinsSlotIdx] = { ...currentInv[coinsSlotIdx], quantity: currentInv[coinsSlotIdx].quantity + ev.coinReward }
              updateInventory(currentInv)
            } else {
              const emptyIdx = currentInv.findIndex(s => s === null)
              if (emptyIdx >= 0) {
                currentInv[emptyIdx] = { itemId: 'coins', quantity: ev.coinReward }
                updateInventory(currentInv)
              } else {
                updateBankDirect({ coins: ev.coinReward })
              }
            }
          }
          // Update session totals on the state object
          agilityRef.current = {
            ...agilityRef.current,
            totalLaps: (agilityRef.current.totalLaps || 0) + 1,
            totalXP: (agilityRef.current.totalXP || 0) + ev.xp,
            totalCoins: (agilityRef.current.totalCoins || 0) + ev.coinReward
          }
        }
      }

      setAgility({ ...agilityRef.current })
    })

    return unsub
  }, [agility?.active])

  const startCourse = (action) => {
    const state = {
      ...createAgilityState(action),
      totalLaps: 0,
      totalXP: 0,
      totalCoins: 0,
      startedAt: Date.now()
    }
    setAgility(state)
    agilityRef.current = state
    setActiveTask({ type: 'agility', action })
    addToast(`Started: ${action.name}`, 'info')
  }

  const stopCourse = () => {
    setAgility(null)
    agilityRef.current = null
    setActiveTask(null)
    if (onBack) onBack()
  }

  const bankDelay = getAgilityBankDelayMs(agilityLevel)

  // Course picker
  if (!agility) {
    return (
      <div class="h-full overflow-y-auto p-4">
        {onBack && (
          <button onClick={onBack} class="text-xs text-[var(--color-gold-dim)] mb-3 flex items-center gap-1">
            ← Skills
          </button>
        )}
        <div class="flex items-center justify-between mb-1">
          <h2 class="font-[var(--font-display)] text-sm font-bold text-[var(--color-parchment)] opacity-60 uppercase tracking-wider">
            Agility Courses
          </h2>
          <span class="text-xs font-[var(--font-mono)] text-[var(--color-gold)]">Lv {agilityLevel}</span>
        </div>

        {/* Agility bonus info */}
        <div class="mb-3 bg-[#111] rounded-lg px-3 py-2 text-[11px] text-[var(--color-parchment)] opacity-60 flex items-center gap-2">
          <span>🏦</span>
          <span>Current bank speed: <span class="text-[var(--color-gold)] opacity-100">{formatBankDelay(bankDelay)}</span> delay per full inventory</span>
        </div>

        <div class="space-y-2">
          {agilityData.actions.map(action => {
            const available = agilityLevel >= action.level
            return (
              <button
                key={action.id}
                onClick={() => available && startCourse(action)}
                disabled={!available}
                class={`w-full flex items-between justify-between p-3 rounded-xl border transition-colors text-left
                  ${available
                    ? 'bg-[#1a1a1a] border-[#2a2a2a] active:bg-[#222]'
                    : 'bg-[#111] border-[#1a1a1a] opacity-40'}`}
              >
                <div class="flex-1">
                  <div class="text-sm font-semibold text-[var(--color-parchment)]">{action.name}</div>
                  <div class="text-[10px] text-[var(--color-parchment)] opacity-40 mt-0.5">
                    Lv {action.level} · {action.xp} XP · {(action.ticks * 0.6).toFixed(1)}s lap
                  </div>
                  <div class="text-[10px] text-[var(--color-parchment)] opacity-40">{action.description}</div>
                </div>
                <div class="text-right ml-3 flex flex-col justify-center">
                  <div class="text-xs font-[var(--font-mono)] text-[var(--color-gold)]">
                    🪙 {action.coinReward.toLocaleString()}
                  </div>
                  <div class="text-[10px] text-[var(--color-parchment)] opacity-30">per lap</div>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // Active course
  const progress = agility.active
    ? 1 - (agility.ticksRemaining / agility.action.ticks)
    : 0
  const elapsed = agility.startedAt ? Date.now() - agility.startedAt : 0
  const lapsPerHr = elapsed > 5000 && agility.totalLaps > 0
    ? Math.round(agility.totalLaps / (elapsed / 3_600_000))
    : null
  const xpPerHr = elapsed > 5000 && agility.totalXP > 0
    ? Math.round(agility.totalXP / (elapsed / 3_600_000))
    : null

  return (
    <div class="h-full flex flex-col p-4">
      <button onClick={stopCourse}
        class="text-xs text-[var(--color-gold-dim)] mb-3 flex items-center gap-1">
        ← Back
      </button>

      <div class="flex-1 flex flex-col items-center justify-center">
        <span class="text-4xl mb-2">🏃</span>
        <h2 class="font-[var(--font-display)] text-lg font-bold text-[var(--color-gold)] mb-1">
          {agility.action.name}
        </h2>
        <div class="text-xs text-[var(--color-parchment)] opacity-40 mb-4">
          {agility.action.description}
        </div>

        {/* Progress bar */}
        <div class="w-full max-w-xs mb-4">
          <ProgressBar value={progress} max={1} height="h-4" color="var(--color-gold)" showText />
        </div>

        {/* Stats */}
        <div class="bg-[#111] rounded-lg p-3 w-full max-w-xs space-y-1.5">
          <div class="flex justify-between text-sm">
            <span class="text-[var(--color-parchment)] opacity-60">Laps completed</span>
            <span class="font-[var(--font-mono)] text-[var(--color-gold)]">{agility.totalLaps}</span>
          </div>
          <div class="flex justify-between text-sm">
            <span class="text-[var(--color-parchment)] opacity-60">Laps/hr</span>
            <span class="font-[var(--font-mono)] text-[var(--color-gold)]">{lapsPerHr ? lapsPerHr.toLocaleString() : '—'}</span>
          </div>
          <div class="flex justify-between text-sm">
            <span class="text-[var(--color-parchment)] opacity-60">XP gained</span>
            <span class="font-[var(--font-mono)] text-[var(--color-gold)]">{formatNumber(agility.totalXP)}</span>
          </div>
          <div class="flex justify-between text-sm">
            <span class="text-[var(--color-parchment)] opacity-60">XP/hr</span>
            <span class="font-[var(--font-mono)] text-[var(--color-gold)]">{xpPerHr ? formatNumber(xpPerHr) : '—'}</span>
          </div>
          <div class="flex justify-between text-sm">
            <span class="text-[var(--color-parchment)] opacity-60">Coins earned</span>
            <span class="font-[var(--font-mono)] text-[var(--color-gold)]">🪙 {agility.totalCoins.toLocaleString()}</span>
          </div>
          <div class="flex justify-between text-sm">
            <span class="text-[var(--color-parchment)] opacity-60">Coins/hr</span>
            <span class="font-[var(--font-mono)] text-[var(--color-gold)]">
              {xpPerHr ? `🪙 ${Math.round(agility.totalCoins / (elapsed / 3_600_000)).toLocaleString()}` : '—'}
            </span>
          </div>
          <div class="flex justify-between text-sm border-t border-[#222] pt-1.5 mt-1.5">
            <span class="text-[var(--color-parchment)] opacity-60">🏦 Bank speed</span>
            <span class="font-[var(--font-mono)] text-[var(--color-gold)]">{formatBankDelay(bankDelay)} delay</span>
          </div>
        </div>
      </div>

      {/* Skip 1h */}
      {skipHourUnlocked && (
        <button onClick={onSkipHour}
          class="flex-shrink-0 w-full py-2.5 rounded-lg font-semibold text-sm active:opacity-80"
          style="background:linear-gradient(135deg,#1a3a2a,#2a5a3a);border:1px solid rgba(100,200,120,0.35);color:#7de8a0">
          ⏭️ Skip 1h
        </button>
      )}
    </div>
  )
}
