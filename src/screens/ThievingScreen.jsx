import { useState, useEffect, useRef } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import ProgressBar from '../components/ProgressBar.jsx'
import { getLevelFromXP } from '../engine/experience.js'
import { createThievingState, processThievingTick } from '../engine/thieving.js'
import { onTick } from '../engine/tick.js'
import { formatNumber } from '../utils/helpers.js'
import skillsData from '../data/skills.json'

const thievingData = skillsData.thieving

export default function ThievingScreen({ initialNpcId, onBack }) {
  const { stats, inventory, updateInventory, bank, updateBankDirect, grantXP, addToast, setActiveTask } = useGame()

  const thievingLevel = getLevelFromXP(stats.thieving?.xp || 0)
  const thievingXP = stats.thieving?.xp || 0

  const [thieving, setThieving] = useState(null)
  const thievingRef = useRef(null)
  const inventoryRef = useRef(inventory)
  const hasAutoStarted = useRef(false)

  // Keep inventoryRef current
  useEffect(() => { inventoryRef.current = inventory }, [inventory])

  // Auto-start from shortcut
  useEffect(() => {
    if (initialNpcId && !hasAutoStarted.current && !thieving) {
      hasAutoStarted.current = true
      const npc = thievingData.npcs.find(n => n.id === initialNpcId)
      if (npc && thievingLevel >= npc.level) startThieving(npc)
    }
  }, [initialNpcId])

  // Tick listener
  useEffect(() => {
    if (!thieving || !thieving.active) return
    thievingRef.current = thieving

    const unsub = onTick(() => {
      const state = thievingRef.current
      if (!state || !state.active) return

      const { thievingState, events } = processThievingTick(state)
      thievingRef.current = thievingState

      for (const ev of events) {
        if (ev.type === 'pickpocketSuccess') {
          grantXP('thieving', ev.xp)

          // Add coins to inventory or bank
          if (ev.coins > 0) {
            const currentInv = [...(inventoryRef.current)]
            const coinsSlotIdx = currentInv.findIndex(s => s && s.itemId === 'coins')
            if (coinsSlotIdx >= 0) {
              currentInv[coinsSlotIdx] = { ...currentInv[coinsSlotIdx], quantity: currentInv[coinsSlotIdx].quantity + ev.coins }
              updateInventory(currentInv)
            } else {
              const emptyIdx = currentInv.findIndex(s => s === null)
              if (emptyIdx >= 0) {
                currentInv[emptyIdx] = { itemId: 'coins', quantity: ev.coins }
                updateInventory(currentInv)
              } else {
                updateBankDirect({ coins: ev.coins })
              }
            }
          }

          // Update session totals
          thievingRef.current = {
            ...thievingRef.current,
            totalPickpockets: (thievingRef.current.totalPickpockets || 0) + 1,
            totalXP: (thievingRef.current.totalXP || 0) + ev.xp,
            totalCoins: (thievingRef.current.totalCoins || 0) + ev.coins
          }
        }
      }

      setThieving({ ...thievingRef.current })
    })

    return unsub
  }, [thieving?.active])

  const startThieving = (npc) => {
    const state = {
      ...createThievingState(npc),
      totalPickpockets: 0,
      totalXP: 0,
      totalCoins: 0,
      startedAt: Date.now()
    }
    setThieving(state)
    thievingRef.current = state
    setActiveTask({ type: 'thieving', npc })
    addToast(`Started pickpocketing ${npc.name}`, 'info')
  }

  const stopThieving = () => {
    setThieving(null)
    thievingRef.current = null
    setActiveTask(null)
    if (onBack) onBack()
  }

  // NPC picker
  if (!thieving) {
    return (
      <div class="h-full overflow-y-auto p-4">
        {onBack && (
          <button onClick={onBack} class="text-xs text-[var(--color-gold-dim)] mb-3 flex items-center gap-1">
            ← Skills
          </button>
        )}
        <div class="flex items-center justify-between mb-1">
          <h2 class="font-[var(--font-display)] text-sm font-bold text-[var(--color-parchment)] opacity-60 uppercase tracking-wider">
            Thieving Targets
          </h2>
          <span class="text-xs font-[var(--font-mono)] text-[var(--color-gold)]">Lv {thievingLevel}</span>
        </div>

        <div class="mb-3 bg-[#111] rounded-lg px-3 py-2 text-[11px] text-[var(--color-parchment)] opacity-60 flex items-center gap-2">
          <span>🗝️</span>
          <span>Pickpocket targets to earn coins and experience</span>
        </div>

        <div class="space-y-2">
          {thievingData.npcs.map(npc => {
            const available = thievingLevel >= npc.level
            return (
              <button
                key={npc.id}
                onClick={() => available && startThieving(npc)}
                disabled={!available}
                class={`w-full flex items-between justify-between p-3 rounded-xl border transition-colors text-left
                  ${available
                    ? 'bg-[#1a1a1a] border-[#2a2a2a] active:bg-[#222]'
                    : 'bg-[#111] border-[#1a1a1a] opacity-40'}`}
              >
                <div class="flex-1">
                  <div class="text-sm font-semibold text-[var(--color-parchment)]">{npc.name}</div>
                  <div class="text-[10px] text-[var(--color-parchment)] opacity-40 mt-0.5">
                    Lv {npc.level} · {npc.xp} XP · 🪙 {npc.coins} coins
                  </div>
                  <div class="text-[10px] text-[var(--color-parchment)] opacity-40">{npc.description}</div>
                </div>
                <div class="text-right ml-3 flex flex-col justify-center">
                  <div class="text-xs font-[var(--font-mono)] text-[var(--color-gold)]">
                    🪙 {npc.coins.toLocaleString()}
                  </div>
                  <div class="text-[10px] text-[var(--color-parchment)] opacity-30">per pocket</div>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // Active pickpocketing
  const progress = thieving.active
    ? 1 - (thieving.ticksRemaining / 4)
    : 0
  const elapsed = thieving.startedAt ? Date.now() - thieving.startedAt : 0
  const pickpocketsPerHr = elapsed > 5000 && thieving.totalPickpockets > 0
    ? Math.round(thieving.totalPickpockets / (elapsed / 3_600_000))
    : null
  const xpPerHr = elapsed > 5000 && thieving.totalXP > 0
    ? Math.round(thieving.totalXP / (elapsed / 3_600_000))
    : null

  return (
    <div class="h-full flex flex-col p-4">
      <div class="flex-1 flex flex-col items-center justify-center">
        <span class="text-4xl mb-2">🗝️</span>
        <h2 class="font-[var(--font-display)] text-lg font-bold text-[var(--color-gold)] mb-1">
          {thieving.npc.name}
        </h2>
        <div class="text-xs text-[var(--color-parchment)] opacity-40 mb-4">
          {thieving.npc.description}
        </div>

        {/* Progress bar */}
        <div class="w-full max-w-xs mb-4">
          <ProgressBar value={progress} max={1} height="h-4" color="var(--color-gold)" showText />
        </div>

        {/* Stats */}
        <div class="bg-[#111] rounded-lg p-3 w-full max-w-xs space-y-1.5">
          <div class="flex justify-between text-sm">
            <span class="text-[var(--color-parchment)] opacity-60">Pickpockets completed</span>
            <span class="font-[var(--font-mono)] text-[var(--color-gold)]">{thieving.totalPickpockets}</span>
          </div>
          <div class="flex justify-between text-sm">
            <span class="text-[var(--color-parchment)] opacity-60">Pickpockets/hr</span>
            <span class="font-[var(--font-mono)] text-[var(--color-gold)]">{pickpocketsPerHr ? pickpocketsPerHr.toLocaleString() : '—'}</span>
          </div>
          <div class="flex justify-between text-sm">
            <span class="text-[var(--color-parchment)] opacity-60">XP gained</span>
            <span class="font-[var(--font-mono)] text-[var(--color-gold)]">{formatNumber(thieving.totalXP)}</span>
          </div>
          <div class="flex justify-between text-sm">
            <span class="text-[var(--color-parchment)] opacity-60">XP/hr</span>
            <span class="font-[var(--font-mono)] text-[var(--color-gold)]">{xpPerHr ? formatNumber(xpPerHr) : '—'}</span>
          </div>
          <div class="flex justify-between text-sm">
            <span class="text-[var(--color-parchment)] opacity-60">Coins earned</span>
            <span class="font-[var(--font-mono)] text-[var(--color-gold)]">🪙 {thieving.totalCoins.toLocaleString()}</span>
          </div>
          <div class="flex justify-between text-sm">
            <span class="text-[var(--color-parchment)] opacity-60">Coins/hr</span>
            <span class="font-[var(--font-mono)] text-[var(--color-gold)]">
              {xpPerHr ? `🪙 ${Math.round(thieving.totalCoins / (elapsed / 3_600_000)).toLocaleString()}` : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Stop & Back */}
      <div class="flex-shrink-0 flex gap-2 mt-3">
        <button onClick={stopThieving}
          class="flex-1 py-2.5 rounded-lg bg-[#222] text-[var(--color-parchment)] font-semibold text-sm active:opacity-80">
          ← Stop &amp; Back
        </button>
      </div>
    </div>
  )
}
