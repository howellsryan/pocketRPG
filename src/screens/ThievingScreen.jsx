import { useState, useEffect, useRef } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import SkillIcon from '../components/SkillIcon.jsx'
import { getActionProgress } from '../hooks/useActionTick.js'
import { getLevelFromXP } from '../engine/experience.js'
import { createThievingState, processThievingTick } from '../engine/thieving.js'
import { skillingActionBlockedByFullInventory } from '../engine/skilling.js'
import { emptySession } from '../engine/activitySession.js'
import itemsData from '../data/items.json'
import { rollMasterFarmerSeed } from '../engine/seedDrops.js'
import { onTick } from '../engine/tick.js'
import { markScreenTick } from '../engine/activityRunner.js'
import { formatNumber } from '../utils/helpers.js'
import GameIcon from '../components/GameIcon.jsx'
import SkillScreenHeader from '../components/SkillScreenHeader.jsx'
import SkillInfoBanner from '../components/SkillInfoBanner.jsx'
import SkillActionRow from '../components/SkillActionRow.jsx'
import SkillActivePanel from '../components/SkillActivePanel.jsx'
import skillsData from '../data/skills.json'

const thievingData = skillsData.thieving

export default function ThievingScreen({ initialNpcId, idleResult, onBack, onStopBack }) {
  const { stats, inventory, updateInventory, bank, updateBankDirect, grantXP, addToast, setActiveTask, requestActivityStart, activeTask, signalInventoryFull, resolveInventoryFull } = useGame()

  // Pickpocket output that lands in the inventory: coins (stackable) for most
  // targets, a random seed (needs a free slot) for the Master Farmer.
  const rewardFitCheck = (npc) => npc?.seedReward ? { dropTable: true } : { product: 'coins' }

  const thievingLevel = getLevelFromXP(stats.thieving?.xp || 0)
  const thievingXP = stats.thieving?.xp || 0

  const [thieving, setThieving] = useState(null)
  const thievingRef = useRef(null)
  const inventoryRef = useRef(inventory)
  const hasAutoStarted = useRef(false)
  // True once the player has seen the NPC list. Auto-starting from a place map
  // (initialNpcId) starts false so the active panel's Back returns there.
  const seenList = useRef(!initialNpcId)

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

  // When a skip completes while actively thieving, add the skipped XP, coins
  // and seeds (Master Farmer) to the running session totals.
  useEffect(() => {
    if (!thieving?.active) return
    if (!idleResult) return
    if (idleResult.task?.type !== 'thieving') return
    const xpGained = idleResult.xpGained?.thieving || 0
    const coinsGained = idleResult.coinsGained || 0
    const actions = idleResult.actions || 0
    const elapsedMs = idleResult.elapsedMs || 0
    const seedsGained = idleResult.itemsGained
      ? Object.values(idleResult.itemsGained).reduce((sum, q) => sum + (Number(q) || 0), 0)
      : 0
    if (xpGained === 0 && coinsGained === 0 && seedsGained === 0) return
    setThieving((prev) => {
      if (!prev?.active) return prev
      const next = {
        ...prev,
        totalPickpockets: (prev.totalPickpockets || 0) + actions,
        totalXP: (prev.totalXP || 0) + xpGained,
        totalCoins: (prev.totalCoins || 0) + coinsGained,
        totalSeeds: (prev.totalSeeds || 0) + seedsGained,
        startedAt: (prev.startedAt || Date.now()) - elapsedMs,
      }
      thievingRef.current = next
      return next
    })
  }, [idleResult])

  // Tick listener
  useEffect(() => {
    if (!thieving || !thieving.active) return
    thievingRef.current = thieving
    markScreenTick() // claim the task before the App-level runner's next tick

    const unsub = onTick(() => {
      const state = thievingRef.current
      if (!state || !state.active) return
      markScreenTick()

      // A full inventory pauses the pickpocket and raises the global prompt;
      // the check re-runs each tick so it resumes once a slot frees.
      if (skillingActionBlockedByFullInventory(rewardFitCheck(state.npc), inventoryRef.current, itemsData)) {
        signalInventoryFull()
        return
      }
      resolveInventoryFull()

      const { thievingState, events } = processThievingTick(state)
      thievingRef.current = thievingState

      for (const ev of events) {
        if (ev.type === 'pickpocketSuccess') {
          grantXP('thieving', ev.xp)

          // Master Farmer rewards a single seed / sapling per pickpocket
          // (stackable, inventory-first, falling back to the bank).
          let seedGained = 0
          if (state.npc.seedReward) {
            const seedId = rollMasterFarmerSeed()
            const currentInv = [...(inventoryRef.current)]
            const seedSlotIdx = currentInv.findIndex(s => s && s.itemId === seedId)
            if (seedSlotIdx >= 0) {
              currentInv[seedSlotIdx] = { ...currentInv[seedSlotIdx], quantity: currentInv[seedSlotIdx].quantity + 1 }
              updateInventory(currentInv)
            } else {
              const emptyIdx = currentInv.findIndex(s => s === null)
              if (emptyIdx >= 0) {
                currentInv[emptyIdx] = { itemId: seedId, quantity: 1 }
                updateInventory(currentInv)
              } else {
                updateBankDirect({ [seedId]: 1 })
              }
            }
            seedGained = 1
          }

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
            totalCoins: (thievingRef.current.totalCoins || 0) + ev.coins,
            totalSeeds: (thievingRef.current.totalSeeds || 0) + seedGained
          }
        }
      }

      setThieving({ ...thievingRef.current })
      if (thievingRef.current?.active) mirrorActiveTask(thievingRef.current)
    })

    return unsub
  }, [thieving?.active])

  const mirrorActiveTask = (state) => {
    if (!state) return
    const ticks = state.npc.pickpocketTicks || 4
    setActiveTask({
      type: 'thieving',
      npc: state.npc,
      totalTicks: ticks,
      ticksRemaining: state.ticksRemaining,
      session: { startedAt: state.startedAt, actions: state.totalPickpockets || 0, xp: state.totalXP || 0, coins: state.totalCoins || 0, items: 0, seeds: state.totalSeeds || 0, tokens: 0 },
    }, { skipCloudSync: true })
  }

  const buildResumedState = (task) => {
    const npc = thievingData.npcs.find(n => n.id === task.npc?.id)
    if (!npc) return null
    const state = { ...createThievingState(npc), totalPickpockets: task.session?.actions || 0, totalXP: task.session?.xp || 0, totalCoins: task.session?.coins || 0, totalSeeds: task.session?.seeds || 0, startedAt: task.session?.startedAt || Date.now() }
    const ticks = npc.pickpocketTicks || 4
    if (typeof task.ticksRemaining === 'number' && task.ticksRemaining > 0 && task.ticksRemaining <= ticks) state.ticksRemaining = task.ticksRemaining
    return state
  }

  // Resume a pickpocket target already running in the background.
  useEffect(() => {
    if (thieving || hasAutoStarted.current) return
    if (activeTask?.type !== 'thieving') return
    const resumed = buildResumedState(activeTask)
    if (!resumed) return
    hasAutoStarted.current = true
    setThieving(resumed)
    thievingRef.current = resumed
  }, [])

  const startThieving = (npc) => {
    if (activeTask?.type === 'thieving' && activeTask.npc?.id === npc.id) {
      const resumed = buildResumedState(activeTask)
      if (resumed) { setThieving(resumed); thievingRef.current = resumed; return }
    }
    // Map-driven gating (Phase 3): must be at a place that offers this target.
    if (!requestActivityStart({ type: 'thieving', npc })) return
    const startedAt = Date.now()
    const state = {
      ...createThievingState(npc),
      totalPickpockets: 0,
      totalXP: 0,
      totalCoins: 0,
      totalSeeds: 0,
      startedAt
    }
    setThieving(state)
    thievingRef.current = state
    setActiveTask({ type: 'thieving', npc, session: emptySession(startedAt) })
    addToast(`Started pickpocketing ${npc.name}`, 'info')
  }

  const backToList = () => {
    seenList.current = true
    if (thievingRef.current) mirrorActiveTask(thievingRef.current)
    setThieving(null)
    thievingRef.current = null
  }

  // Active-panel Back leaves the task running; when auto-started from a place
  // map (list never seen) it returns to that origin, not the NPC list.
  const backFromActive = () => {
    const toOrigin = !seenList.current
    backToList()
    if (toOrigin && onBack) onBack()
  }

  const stopThieving = () => {
    setThieving(null)
    thievingRef.current = null
    setActiveTask(null)
    const back = onStopBack || onBack
    if (back) back()
  }

  // NPC picker
  if (!thieving) {
    return (
      <div class="forge-shell h-full overflow-y-auto p-4">
        <SkillScreenHeader
          skill="thieving"
          title="Thieving"
          xp={thievingXP}
          level={thievingLevel}
          onBack={onBack}
        />

        <SkillInfoBanner
          icon={<SkillIcon skill="thieving" size={19} />}
          className="mb-4"
        >
          Pickpocket targets to earn coins and experience.
        </SkillInfoBanner>

        <div class="flex flex-col gap-2.5">
          {thievingData.npcs.map(npc => {
            const available = thievingLevel >= npc.level
            return (
              <SkillActionRow
                key={npc.id}
                icon={<SkillIcon skill="thieving" size={26} />}
                title={npc.name}
                meta={<><span class="text-[var(--color-gold)] font-bold opacity-100">Lv {npc.level}</span> · {npc.xp} XP · {npc.description}</>}
                chip={npc.seedReward
                  ? <><span>🌱</span> seeds</>
                  : <><GameIcon iconKey="coins" size={16} color="var(--color-gold)" /> {npc.coins.toLocaleString()} / pocket</>}
                active={activeTask?.type === 'thieving' && activeTask.npc?.id === npc.id}
                locked={!available}
                lockBadge={`LV ${npc.level}`}
                lockHint={`Unlocks at Thieving ${npc.level}`}
                onClick={() => startThieving(npc)}
              />
            )
          })}
        </div>
      </div>
    )
  }

  // Active pickpocketing
  const progress = getActionProgress(thieving.active, thieving.ticksRemaining, thieving.npc.pickpocketTicks || 4)
  const elapsed = thieving.startedAt ? Date.now() - thieving.startedAt : 0
  const pickpocketsPerHr = elapsed > 5000 && thieving.totalPickpockets > 0
    ? Math.round(thieving.totalPickpockets / (elapsed / 3_600_000))
    : null
  const xpPerHr = elapsed > 5000 && thieving.totalXP > 0
    ? Math.round(thieving.totalXP / (elapsed / 3_600_000))
    : null

  const coinIcon = <GameIcon iconKey="coins" size={14} color="var(--color-gold-light)" />
  const rewardStats = thieving.npc.seedReward
    ? [{ label: 'Seeds collected', value: <><span>🌱</span> {(thieving.totalSeeds || 0).toLocaleString()}</> }]
    : [
        { label: 'Coins earned', value: <>{coinIcon} {thieving.totalCoins.toLocaleString()}</> },
        { label: 'Coins / hr', value: xpPerHr ? <>{coinIcon} {Math.round(thieving.totalCoins / (elapsed / 3_600_000)).toLocaleString()}</> : '—', accent: !!xpPerHr },
      ]
  const inventoryBlocked = skillingActionBlockedByFullInventory(rewardFitCheck(thieving.npc), inventory, itemsData)
  return (
    <SkillActivePanel
      skill="thieving"
      title={thieving.npc.name}
      subtitle={inventoryBlocked ? 'Inventory full — paused' : thieving.npc.description}
      progress={progress}
      stats={[
        { label: 'Pickpockets', value: thieving.totalPickpockets },
        { label: 'Pickpockets / hr', value: pickpocketsPerHr ? pickpocketsPerHr.toLocaleString() : '—', accent: !!pickpocketsPerHr },
        { label: 'XP gained', value: formatNumber(thieving.totalXP) },
        { label: 'XP / hr', value: xpPerHr ? formatNumber(xpPerHr) : '—', accent: !!xpPerHr },
        ...rewardStats,
      ]}
      onBack={backFromActive}
      onStop={stopThieving}
    />
  )
}
