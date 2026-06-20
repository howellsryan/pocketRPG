import { useState, useEffect, useRef } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import { getLevelFromXP } from '../engine/experience.js'
import { createAgilityState, processAgilityTick, getAgilityBankDelayMs, formatBankDelay } from '../engine/agility.js'
import { onTick } from '../engine/tick.js'
import { markScreenTick } from '../engine/activityRunner.js'
import { formatNumber } from '../utils/helpers.js'
import GameIcon from '../components/GameIcon.jsx'
import SkillIcon from '../components/SkillIcon.jsx'
import SkillScreenHeader from '../components/SkillScreenHeader.jsx'
import SkillInfoBanner from '../components/SkillInfoBanner.jsx'
import SkillActionRow from '../components/SkillActionRow.jsx'
import SkillActivePanel from '../components/SkillActivePanel.jsx'
import skillsData from '../data/skills.json'

const agilityData = skillsData.agility

export default function AgilityScreen({ initialActionId, idleResult, onBack }) {
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

  // When a skip completes while actively running agility, add the skipped laps,
  // XP, and coins to the running session totals.
  useEffect(() => {
    if (!agility?.active) return
    if (!idleResult) return
    if (idleResult.task?.type !== 'agility') return
    const laps = idleResult.laps || 0
    const xpGained = idleResult.xpGained?.agility || 0
    const coinsGained = idleResult.coinsGained || 0
    const elapsedMs = idleResult.elapsedMs || 0
    if (laps === 0 && xpGained === 0) return
    setAgility((prev) => {
      if (!prev?.active) return prev
      const next = {
        ...prev,
        totalLaps: (prev.totalLaps || 0) + laps,
        totalXP: (prev.totalXP || 0) + xpGained,
        totalCoins: (prev.totalCoins || 0) + coinsGained,
        startedAt: (prev.startedAt || Date.now()) - elapsedMs,
      }
      agilityRef.current = next
      return next
    })
  }, [idleResult])

  // Tick listener
  useEffect(() => {
    if (!agility || !agility.active) return
    agilityRef.current = agility
    markScreenTick() // claim the task before the App-level runner's next tick

    const unsub = onTick(() => {
      const state = agilityRef.current
      if (!state || !state.active) return
      markScreenTick()

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
        <SkillScreenHeader
          skill="agility"
          title="Agility Courses"
          xp={agilityXP}
          level={agilityLevel}
          onBack={onBack}
          backLabel="Skills"
        />

        <SkillInfoBanner
          tone="neutral"
          icon={<SkillIcon skill="agility" size={19} color="var(--color-gold)" />}
          className="mb-4"
        >
          Current bank speed: <span class="text-[var(--color-gold)] font-bold opacity-100">{formatBankDelay(bankDelay)}</span> delay per full inventory
        </SkillInfoBanner>

        <div class="flex flex-col gap-2.5">
          {agilityData.actions.map(action => {
            const available = agilityLevel >= action.level
            return (
              <SkillActionRow
                key={action.id}
                icon={<SkillIcon skill="agility" size={26} color="var(--color-gold)" />}
                title={action.name}
                meta={<><span class="text-[var(--color-gold)] font-bold opacity-100">Lv {action.level}</span> · {action.xp} XP · {(action.ticks * 0.6).toFixed(1)}s lap</>}
                chip={<><GameIcon iconKey="coins" size={16} color="var(--color-gold)" /> {action.coinReward.toLocaleString()} / lap</>}
                locked={!available}
                lockBadge={`LV ${action.level}`}
                lockHint={`Unlocks at Agility ${action.level}`}
                onClick={() => startCourse(action)}
              />
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

  const coinIcon = <GameIcon iconKey="coins" size={14} color="var(--color-gold-light)" />
  return (
    <SkillActivePanel
      skill="agility"
      title={agility.action.name}
      subtitle={agility.action.description}
      progress={progress}
      producing={<>
        {coinIcon}
        <span class="text-[12px] font-semibold text-[var(--color-parchment)] opacity-60">Earning</span>
        <span class="text-[13px] font-semibold text-[var(--color-gold-light)]">{agility.action.coinReward.toLocaleString()} / lap</span>
      </>}
      stats={[
        { label: 'Laps completed', value: agility.totalLaps },
        { label: 'Laps / hr', value: lapsPerHr ? lapsPerHr.toLocaleString() : '—', accent: !!lapsPerHr },
        { label: 'XP gained', value: formatNumber(agility.totalXP) },
        { label: 'XP / hr', value: xpPerHr ? formatNumber(xpPerHr) : '—', accent: !!xpPerHr },
        { label: 'Coins earned', value: <>{coinIcon} {agility.totalCoins.toLocaleString()}</> },
        { label: 'Coins / hr', value: xpPerHr ? <>{coinIcon} {Math.round(agility.totalCoins / (elapsed / 3_600_000)).toLocaleString()}</> : '—', accent: !!xpPerHr },
      ]}
      footer={{
        icon: <span class="text-[14px]">🏦</span>,
        label: 'Bank speed',
        value: `${formatBankDelay(bankDelay)} delay`,
      }}
      onStop={stopCourse}
    />
  )
}
