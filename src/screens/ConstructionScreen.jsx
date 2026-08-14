import { useState, useEffect, useRef } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import { grindmanXP } from '../engine/grindman.js'
import SkillIcon from '../components/SkillIcon.jsx'
import SkillScreenHeader from '../components/SkillScreenHeader.jsx'
import SkillActionRow from '../components/SkillActionRow.jsx'
import SkillActivePanel from '../components/SkillActivePanel.jsx'
import SectionHeader from '../components/SectionHeader.jsx'
import { getLevelFromXP } from '../engine/experience.js'
import { createSkillingState, processSkillingTick } from '../engine/skilling.js'
import { emptySession } from '../engine/activitySession.js'
import { countItem, removeItemUnnotedFirst } from '../engine/inventory.js'
import { onTick } from '../engine/tick.js'
import { formatNumber } from '../utils/helpers.js'
import itemsData from '../data/items.json'
import { BUILDING_ACTIONS } from '../engine/construction.js'

export default function ConstructionScreen({ onBack, onStopBack }) {
  const {
    stats, inventory, bank,
    grantXP, updateInventory, updateBankDirect, addToast,
    setActiveTask, requestActivityStart, activeTask, isGrindman
  } = useGame()

  const constructionLevel = getLevelFromXP(stats.construction?.xp || 0)

  const [skilling, setSkilling] = useState(null)
  const skillingRef = useRef(null)
  const hasResumed = useRef(false)
  const inventoryRef = useRef(inventory)
  const bankRef = useRef(bank)

  useEffect(() => { inventoryRef.current = inventory }, [inventory])
  useEffect(() => { bankRef.current = bank }, [bank])

  const mirrorActiveTask = (state) => {
    if (!state) return
    setActiveTask({
      type: 'skill', skill: 'construction', action: state.action, bankingEnabled: false,
      totalTicks: state.action.ticks, ticksRemaining: state.ticksRemaining,
      session: { startedAt: state.startedAt, actions: state.totalActions || 0, xp: state.totalXP || 0, coins: 0, items: 0, seeds: 0, tokens: 0 },
    }, { skipCloudSync: true })
  }

  const buildResumedState = (task) => {
    const action = BUILDING_ACTIONS.find(a => a.id === task.action?.id)
    if (!action) return null
    const state = { ...createSkillingState('construction', action), startedAt: task.session?.startedAt || Date.now() }
    state.totalActions = task.session?.actions || 0
    state.totalXP = task.session?.xp || 0
    if (typeof task.ticksRemaining === 'number' && task.ticksRemaining > 0 && task.ticksRemaining <= action.ticks) state.ticksRemaining = task.ticksRemaining
    return state
  }

  // Resume a build already running in the background (navigated away & back).
  useEffect(() => {
    if (skilling || hasResumed.current) return
    if (activeTask?.type !== 'skill' || activeTask.skill !== 'construction') return
    const resumed = buildResumedState(activeTask)
    if (!resumed) return
    hasResumed.current = true
    setSkilling(resumed)
    skillingRef.current = resumed
  }, [])

  const startBuilding = (action) => {
    if (activeTask?.type === 'skill' && activeTask.skill === 'construction' && activeTask.action?.id === action.id) {
      const resumed = buildResumedState(activeTask)
      if (resumed) { setSkilling(resumed); skillingRef.current = resumed; return }
    }
    // Map-driven gating (Phase 3): must be at a place that offers this build.
    if (!requestActivityStart({ type: 'skill', skill: 'construction', action })) return
    const startedAt = Date.now()
    const state = { ...createSkillingState('construction', action), startedAt }
    setSkilling(state)
    skillingRef.current = state
    setActiveTask({ type: 'skill', skill: 'construction', action, bankingEnabled: false, session: emptySession(startedAt) })
  }

  const backToList = () => {
    if (skillingRef.current) mirrorActiveTask(skillingRef.current)
    setSkilling(null)
    skillingRef.current = null
  }

  const stopBuilding = () => {
    if (skillingRef.current) {
      skillingRef.current = { ...skillingRef.current, active: false, stopped: true }
    }
    setSkilling(null)
    setActiveTask(null)
    // Stop & Back returns to where the player came from — the place-map origin
    // (onStopBack/onBack from a returnTo) or the previous screen.
    const back = onStopBack || onBack
    if (back) back()
  }

  useEffect(() => {
    if (!skilling || !skilling.active) return
    skillingRef.current = skilling

    const unsub = onTick(() => {
      const state = skillingRef.current
      if (!state || !state.active || state.stopped) return

      const { skillingState, events } = processSkillingTick(state)
      skillingRef.current = skillingState

      for (const ev of events) {
        if (ev.type === 'actionComplete') {
          const materialsObj = ev.action.materials
          const matId = Object.keys(materialsObj)[0]
          const qtyNeeded = materialsObj[matId]
          const curInv = [...inventoryRef.current]
          const invCount = countItem(curInv, matId)
          const bankCount = bankRef.current[matId]?.quantity || 0

          if (invCount + bankCount < qtyNeeded) {
            skillingRef.current = { ...skillingState, active: false, stopped: true }
            setSkilling({ ...skillingState, active: false, stopped: true })
            addToast(`Out of ${itemsData[matId]?.name || matId}!`, 'error')
            return
          }

          if (invCount >= qtyNeeded) {
            removeItemUnnotedFirst(curInv, matId, qtyNeeded)
            updateInventory(curInv)
          } else {
            const fromInv = invCount > 0 ? invCount : 0
            const fromBank = qtyNeeded - fromInv
            if (fromInv > 0) {
              removeItemUnnotedFirst(curInv, matId, fromInv)
              updateInventory(curInv)
            }
            if (fromBank > 0) {
              updateBankDirect({ [matId]: -fromBank })
            }
          }

          // Tally corrected to the banked figure — see MagicScreen.
          const bankedXp = grantXP('construction', ev.xp)
          skillingRef.current = { ...skillingRef.current, totalXP: (skillingRef.current.totalXP || 0) - ev.xp + bankedXp }
        }
      }

      setSkilling({ ...skillingRef.current })
      if (skillingRef.current?.active) mirrorActiveTask(skillingRef.current)
    })

    return unsub
  }, [skilling?.active])

  if (skilling && skilling.active) {
    const progress = 1 - (skilling.ticksRemaining / skilling.action.ticks)
    const xpPerHr = skilling.startedAt && (Date.now() - skilling.startedAt) > 5000
      ? formatNumber(Math.round(skilling.totalXP / ((Date.now() - skilling.startedAt) / 3600000)))
      : '—'
    return (
      <SkillActivePanel
        skill="construction"
        title={skilling.action.name}
        progress={progress}
        stats={[
          { label: 'Actions completed', value: skilling.totalActions },
          { label: 'XP gained', value: formatNumber(skilling.totalXP) },
          { label: 'XP / hr', value: xpPerHr, accent: xpPerHr !== '—' },
        ]}
        onBack={backToList}
        onStop={stopBuilding}
      />
    )
  }

  return (
    <div class="forge-shell h-full overflow-y-auto p-4">
      <SkillScreenHeader
        skill="construction"
        title="Construction"
        xp={stats.construction?.xp || 0}
        level={constructionLevel}
        onBack={onBack}
      />

      <SectionHeader className="mb-2.5">Building</SectionHeader>
      <div class="flex flex-col gap-2.5 mb-6">
        {BUILDING_ACTIONS.map(action => {
          const available = action.level <= constructionLevel
          const materialsObj = action.materials
          const matId = Object.keys(materialsObj)[0]
          const qtyPerAction = materialsObj[matId]
          const matName = itemsData[matId]?.name || matId
          const totalMats = countItem(inventory, matId) + (bank[matId]?.quantity || 0)
          const hasMats = totalMats >= qtyPerAction
          const canStart = available && hasMats

          return (
            <SkillActionRow
              key={action.id}
              icon={<SkillIcon skill="construction" size={26} />}
              title={action.name}
              meta={<>
                <span class="text-[var(--color-gold)] font-bold opacity-100">Lv {action.level}</span> · {grindmanXP(action.xp, isGrindman)} XP · {(action.ticks * 0.6).toFixed(1)}s · Needs: {matName}
                {available && !hasMats && <span class="block text-[var(--color-blood-ember)] mt-1">No {matName} in inventory or bank</span>}
              </>}
              chip={<>{totalMats.toLocaleString()} avail</>}
              active={activeTask?.type === 'skill' && activeTask.skill === 'construction' && activeTask.action?.id === action.id}
              locked={!available}
              lockBadge={`LV ${action.level}`}
              lockHint={`Unlocks at Construction ${action.level}`}
              disabled={available && !hasMats}
              onClick={() => startBuilding(action)}
            />
          )
        })}
      </div>

      <p class="text-[10px] text-[var(--color-parchment)] opacity-40 text-center mt-2">
        Construction unlockables and passive perks have moved to Character Unlocks.
      </p>
    </div>
  )
}
