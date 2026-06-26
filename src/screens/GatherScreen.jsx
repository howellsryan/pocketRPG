import { useState, useEffect, useRef } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import SectionHeader from '../components/SectionHeader.jsx'
import GameIcon from '../components/GameIcon.jsx'
import SkillActionRow from '../components/SkillActionRow.jsx'
import SkillActivePanel from '../components/SkillActivePanel.jsx'
import { getActionProgress } from '../hooks/useActionTick.js'
import { countItem, addItem } from '../engine/inventory.js'
import { getLevelFromXP } from '../engine/experience.js'
import { onTick } from '../engine/tick.js'
import { markScreenTick } from '../engine/activityRunner.js'
import { GATHER_AUTOBANK_CONSTRUCTION_LEVEL } from '../utils/constants.js'
import minigamesData from '../data/minigames.json'
import { GATHER_TASKS } from '../engine/gatherTasks.js'

const CATEGORIES = [
  { id: 'all', label: 'All', icon: '📋', iconKey: 'list' },
]

const ITEM_NAMES = {
  bowstring: 'Bowstring', bucket_of_sand: 'Bucket of sand', seaweed: 'Seaweed',
  clay: 'Clay', soft_clay: 'Soft clay', wheat: 'Wheat', pot_of_flour: 'Pot of flour',
  leather: 'Leather', hard_leather: 'Hard leather', molten_glass: 'Molten glass',
  soda_ash: 'Soda ash', cowhide: 'Cowhide', bucket: 'Bucket',
  pot: 'Pot', eye_of_newt: 'Eye of newt', white_berries: 'White berries',
  snape_grass: 'Snape grass', red_spiders_eggs: 'Red spiders\' eggs',
  potato_cactus: 'Potato cactus', crushed_bird_s_nest: 'Crushed bird\'s nest',
  empty_birds_nest: 'Empty bird\'s nest', limpwurt_root: 'Limpwurt root',
  logs: 'Logs', oak_logs: 'Oak logs', teak_logs: 'Teak logs', mahogany_logs: 'Mahogany logs',
  plank: 'Plank', oak_plank: 'Oak plank', teak_plank: 'Teak plank', mahogany_plank: 'Mahogany plank',
  ...minigamesData.itemNames,
}

function hasItemAnywhere(itemId, inventory, bank, equipment) {
  if (countItem(inventory, itemId) > 0) return true
  if (bank?.[itemId]?.quantity > 0) return true
  if (equipment) {
    for (const slot of Object.values(equipment)) {
      if (slot && slot.itemId === itemId) return true
    }
  }
  return false
}

export default function GatherScreen({ initialTaskId, idleResult }) {
  const { inventory, bank, equipment, stats, updateInventory, updateBankDirect, addToast, setActiveTask, activeTask: globalActiveTask, itemsData, recordGameEvent } = useGame()
  const [category, setCategory] = useState('all')
  const [activeTask, setLocalTask] = useState(null)
  const taskRef = useRef(null)
  const hasAutoStarted = useRef(false)

  // Prefer the canonical item name from itemsData; fall back to the curated
  // map and finally the raw id so display never shows a bare item id.
  const nameOf = (id) => itemsData[id]?.name || ITEM_NAMES[id] || id

  const visibleTasks = category === 'all'
    ? GATHER_TASKS
    : GATHER_TASKS.filter(t => t.category === category)

  // Tick listener — oneShot minigames are ticked by the App so they run
  // on any screen. Resource gathers stay local.
  useEffect(() => {
    if (!activeTask) return
    if (activeTask.gatherTask?.oneShot) return
    taskRef.current = activeTask
    markScreenTick() // claim the task before the App-level runner's next tick

    const unsub = onTick(() => {
      const state = taskRef.current
      if (!state || state.stopped) return
      markScreenTick()

      // Handle reset from previous completion tick
      let ticksRemaining = state.ticksRemaining
      let justCompleted = state.justCompleted || false

      if (justCompleted) {
        ticksRemaining = state.task.ticks
        justCompleted = false
      } else {
        ticksRemaining--
      }

      const next = { ...state, ticksRemaining, justCompleted }

      if (next.ticksRemaining <= 0) {
        // Action complete — check materials and GP cost
        const task = next.task
        const newInv = [...inventory]
        const bankUpdates = {}
        let inventoryModified = false

        // Check if there are enough coins for GP cost
        if (task.gpCost) {
          const invCoins = countItem(newInv, 'coins')
          const bankCoins = bank.coins?.quantity || 0
          if (invCoins + bankCoins < task.gpCost) {
            taskRef.current = { ...next, stopped: true }
            setLocalTask(null)
            addToast('Not enough coins!', 'error')
            return
          }
        }

        if (task.requiresItem && !hasItemAnywhere(task.requiresItem, newInv, bank, equipment)) {
          taskRef.current = { ...next, stopped: true }
          setLocalTask(null)
          addToast(`Need ${nameOf(task.requiresItem)}.`, 'error')
          return
        }

        if (task.materials) {
          let hasMats = true
          for (const [id, qty] of Object.entries(task.materials)) {
            const invCount = countItem(newInv, id)
            const bankCount = bank[id]?.quantity || 0
            if (invCount + bankCount < qty) { hasMats = false; break }
          }
          if (!hasMats) {
            taskRef.current = { ...next, stopped: true }
            setLocalTask(null)
            addToast('Out of materials!', 'error')
            return
          }
          // Remove materials — un-noted inventory first, then noted inventory, then bank
          for (const [id, qty] of Object.entries(task.materials)) {
            const invCount = countItem(newInv, id)
            const fromInv = Math.min(invCount, qty)
            const fromBank = qty - fromInv
            if (fromInv > 0) {
              let rem = fromInv
              // Un-noted first
              for (let i = 0; i < newInv.length && rem > 0; i++) {
                const slot = newInv[i]
                if (!slot || slot.itemId !== id || slot.noted) continue
                const take = Math.min(slot.quantity, rem)
                newInv[i] = { ...slot, quantity: slot.quantity - take }
                rem -= take
                if (newInv[i].quantity <= 0) newInv[i] = null
                inventoryModified = true
              }
              // Noted second
              for (let i = 0; i < newInv.length && rem > 0; i++) {
                const slot = newInv[i]
                if (!slot || slot.itemId !== id || !slot.noted) continue
                const take = Math.min(slot.quantity, rem)
                newInv[i] = { ...slot, quantity: slot.quantity - take }
                rem -= take
                if (newInv[i].quantity <= 0) newInv[i] = null
                inventoryModified = true
              }
            }
            if (fromBank > 0) bankUpdates[id] = -fromBank
          }
        }

        // Consume GP cost from inventory first, then bank
        if (task.gpCost) {
          const invCoins = countItem(newInv, 'coins')
          const fromInv = Math.min(invCoins, task.gpCost)
          const fromBank = task.gpCost - fromInv
          if (fromInv > 0) {
            let rem = fromInv
            for (let i = 0; i < newInv.length && rem > 0; i++) {
              if (newInv[i] && newInv[i].itemId === 'coins') {
                const take = Math.min(newInv[i].quantity, rem)
                newInv[i] = { ...newInv[i], quantity: newInv[i].quantity - take }
                rem -= take
                if (newInv[i].quantity <= 0) newInv[i] = null
                inventoryModified = true
              }
            }
          }
          if (fromBank > 0) bankUpdates.coins = (bankUpdates.coins || 0) - fromBank
        }

        // Gathered items go to the inventory by default. When it fills, the
        // Construction unlock turns a full inventory into a bank trip; without
        // it, gathering stops so the player can manage their items.
        const product = task.product
        const qty = task.qty || 1
        const stackable = itemsData[product]?.stackable || false
        const constructionLevel = getLevelFromXP(stats.construction?.xp || 0)
        const bankWhenFull = constructionLevel >= GATHER_AUTOBANK_CONSTRUCTION_LEVEL

        if (!addItem(newInv, product, qty, stackable)) {
          if (bankWhenFull) {
            // Bank trip: empty the inventory to the bank, then deposit.
            for (let i = 0; i < newInv.length; i++) {
              if (!newInv[i]) continue
              bankUpdates[newInv[i].itemId] = (bankUpdates[newInv[i].itemId] || 0) + newInv[i].quantity
              newInv[i] = null
            }
            addItem(newInv, product, qty, stackable)
          } else {
            // Inventory full — flush deductions, stop the action, and notify.
            if (Object.keys(bankUpdates).length > 0) updateBankDirect(bankUpdates)
            if (inventoryModified) updateInventory(newInv)
            taskRef.current = { ...next, stopped: true }
            setLocalTask(null)
            setActiveTask(null)
            addToast('Inventory full!', 'error')
            return
          }
        }

        // Update bank (material/gp deductions + any bank trip) and inventory.
        if (Object.keys(bankUpdates).length > 0) updateBankDirect(bankUpdates)
        updateInventory(newInv)
        recordGameEvent?.({ kind: 'skill_gather', itemId: product, count: qty })

        const updated = {
          ...next,
          totalDone: next.totalDone + 1,
          totalItems: next.totalItems + qty,
          justCompleted: true,
        }
        taskRef.current = updated
        setLocalTask(updated)
        mirrorActiveTask(updated)
      } else {
        taskRef.current = next
        setLocalTask(next)
        mirrorActiveTask(next)
      }
    })

    return unsub
  }, [activeTask?.task?.id, inventory, bank, stats])

  // Mirror live progress + session onto the global task so the top-nav indicator
  // stays in sync and the session survives navigation.
  const mirrorActiveTask = (state) => {
    if (!state || state.stopped) return
    setActiveTask({
      type: 'gather', gatherTask: state.task,
      totalTicks: state.task.ticks, ticksRemaining: state.ticksRemaining,
      session: { startedAt: state.startedAt, actions: state.totalDone || 0, xp: 0, coins: 0, items: state.totalItems || 0, seeds: 0, tokens: 0 },
    }, { skipCloudSync: true })
  }

  const buildResumedState = (task) => {
    const gatherTask = GATHER_TASKS.find(t => t.id === task.gatherTask?.id)
    if (!gatherTask) return null
    const state = {
      task: gatherTask,
      ticksRemaining: gatherTask.ticks,
      totalDone: task.session?.actions || 0,
      totalItems: task.session?.items || 0,
      startedAt: task.session?.startedAt || Date.now(),
      stopped: false,
      justCompleted: false,
    }
    if (typeof task.ticksRemaining === 'number' && task.ticksRemaining > 0 && task.ticksRemaining <= gatherTask.ticks) state.ticksRemaining = task.ticksRemaining
    return state
  }

  const startTask = (task, seedFromIdle = false) => {
    // Re-opening the running gather: resume the live panel from its session.
    if (globalActiveTask?.type === 'gather' && globalActiveTask.gatherTask?.id === task.id && !seedFromIdle) {
      const resumed = buildResumedState(globalActiveTask)
      if (resumed) { taskRef.current = resumed; setLocalTask(resumed); return }
    }
    const idleActions = seedFromIdle && idleResult?.actions ? idleResult.actions : 0
    const idleItems = seedFromIdle && idleResult?.itemsGained
      ? Object.values(idleResult.itemsGained).reduce((s, v) => s + v, 0)
      : 0
    const startedAt = Date.now()
    const newState = {
      task,
      ticksRemaining: task.ticks,
      totalDone: idleActions,
      totalItems: idleItems,
      startedAt,
      stopped: false,
      justCompleted: false,
    }
    taskRef.current = newState
    setLocalTask(newState)
    setActiveTask({ type: 'gather', gatherTask: task, session: { startedAt, actions: idleActions, xp: 0, coins: 0, items: idleItems, seeds: 0, tokens: 0 } })
  }

  // Back (no stop): flush progress and return to the task list; task keeps running.
  const backToList = () => {
    if (taskRef.current) mirrorActiveTask(taskRef.current)
    setLocalTask(null)
  }

  const stopTask = () => {
    if (taskRef.current) taskRef.current = { ...taskRef.current, stopped: true }
    setLocalTask(null)
    setActiveTask(null)
  }

  // Resume a gather already running in the background (navigated away & back).
  useEffect(() => {
    if (activeTask || hasAutoStarted.current || initialTaskId) return
    if (globalActiveTask?.type !== 'gather') return
    const resumed = buildResumedState(globalActiveTask)
    if (!resumed) return
    hasAutoStarted.current = true
    taskRef.current = resumed
    setLocalTask(resumed)
  }, [])

  // Auto-start from home shortcut
  useEffect(() => {
    if (initialTaskId && !hasAutoStarted.current && !activeTask) {
      hasAutoStarted.current = true
      const task = GATHER_TASKS.find(t => t.id === initialTaskId)
      if (task) startTask(task, true)
    }
  }, [initialTaskId])

  // When a skip completes while actively gathering, add the skipped actions and
  // items to the running session totals so the progress display stays accurate.
  useEffect(() => {
    if (!idleResult) return
    if (idleResult.task?.type !== 'gather') return
    const current = taskRef.current
    if (!current?.task || current.stopped) return
    if (idleResult.task?.gatherTask?.id !== current.task.id) return
    const actionsGained = idleResult.actions || 0
    const itemsGained = idleResult.itemsGained
      ? Object.values(idleResult.itemsGained).reduce((s, v) => s + v, 0)
      : 0
    const elapsedMs = idleResult.elapsedMs || 0
    if (actionsGained === 0 && itemsGained === 0) return
    setLocalTask((prev) => {
      if (!prev?.task || prev.stopped) return prev
      const next = {
        ...prev,
        totalDone: (prev.totalDone || 0) + actionsGained,
        totalItems: (prev.totalItems || 0) + itemsGained,
        startedAt: (prev.startedAt || Date.now()) - elapsedMs,
      }
      taskRef.current = next
      return next
    })
  }, [idleResult])

  // If the app-level task is cleared (for example by skip preflight exhaustion),
  // force-close any local gather action view so the user returns to the picker.
  useEffect(() => {
    if (!activeTask) return
    const globalGatherTask = globalActiveTask?.type === 'gather' ? globalActiveTask.gatherTask : null
    if (!globalGatherTask) {
      taskRef.current = null
      setLocalTask(null)
      return
    }
    if (globalGatherTask.id !== activeTask.task?.id) {
      taskRef.current = null
      setLocalTask(null)
    }
  }, [globalActiveTask, activeTask])



  if (activeTask) {
    const task = activeTask.task
    const progress = getActionProgress(true, activeTask.ticksRemaining, task.ticks)
    const elapsedHrs = activeTask?.startedAt ? (Date.now() - activeTask.startedAt) / 3600000 : 0
    const perHour = elapsedHrs > 0 ? Math.round(activeTask.totalItems / elapsedHrs) : 0

    return (
      <SkillActivePanel
        icon={<GameIcon iconKey={task.product} item={{ icon: task.icon }} size={100} color="var(--color-gold-light)" />}
        title={task.name}
        subtitle={task.description}
        progress={progress}
        producing={<>
          <GameIcon iconKey={task.product} item={{ icon: task.icon }} size={32} color="var(--color-gold-light)" />
          <span class="text-[12px] font-semibold text-[var(--color-parchment)] opacity-60">Producing</span>
          <span class="text-[13px] font-semibold text-[var(--color-gold-light)]">{nameOf(task.product)}</span>
        </>}
        stats={[
          { label: 'Items gathered', value: activeTask.totalItems },
          { label: 'Items / hr', value: elapsedHrs > 0 ? perHour.toLocaleString() : '—', accent: elapsedHrs > 0 },
        ]}
        note={getLevelFromXP(stats.construction?.xp || 0) >= GATHER_AUTOBANK_CONSTRUCTION_LEVEL
          ? '🏦 Items fill your inventory, then auto-bank when full.'
          : '🎒 Items go to your inventory. Gathering stops when it\'s full.'}
        onBack={backToList}
        onStop={stopTask}
      />
    )
  }

  // Task picker
  return (
    <div class="h-full flex flex-col">
      {/* Header */}
      <div class="px-4 pt-4 pb-2 flex-shrink-0">
        <SectionHeader size="lg" className="mb-[10px]">
          <span class="inline-flex items-center gap-2">
            <GameIcon iconKey="kingsherb" size={22} />
            Gather
          </span>
        </SectionHeader>


        {/* Category tabs */}
        <div class="flex gap-[6px] overflow-x-auto pb-1">
          {CATEGORIES.map(cat => {
            const isActive = category === cat.id
            const pillClass = isActive
              ? 'border-[var(--color-gold)] bg-[rgba(212,175,55,0.15)] text-[var(--color-gold)] opacity-100'
              : 'border-[#2a2a2a] bg-[var(--color-void-light)] text-[var(--color-parchment)] opacity-60'
            return (
              <button
                key={cat.id}
                onClick={() => setCategory(cat.id)}
                class={`flex-shrink-0 inline-flex items-center gap-1 px-3 py-[5px] rounded-[20px] text-[11px] font-semibold border ${pillClass}`}
              >
                <GameIcon iconKey={cat.iconKey} item={{ icon: cat.icon }} size={13} color="currentColor" />
                {cat.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Body */}
      <div class="flex-1 overflow-y-auto px-4 pb-4">
        <div class="flex flex-col gap-2.5">
          {visibleTasks.map(task => {
            const hasMats = !task.materials || Object.entries(task.materials).every(
              ([id, qty]) => (countItem(inventory, id) + (bank[id]?.quantity || 0)) >= qty
            )
            const hasRequiredItem = !task.requiresItem || hasItemAnywhere(task.requiresItem, inventory, bank, equipment)
            const hasCoins = !task.gpCost || (countItem(inventory, 'coins') + (bank['coins']?.quantity || 0)) >= task.gpCost
            const enabled = hasMats && hasRequiredItem && hasCoins

            return (
              <SkillActionRow
                key={task.id}
                icon={<GameIcon iconKey={task.product} item={{ icon: task.icon }} size={52} color="var(--color-gold)" />}
                title={task.name}
                meta={<>
                  ⏱ {(task.ticks * 0.6).toFixed(1)}s/action
                  {task.requiresItem && !task.isClue && <> · Requires: {nameOf(task.requiresItem)}</>}
                  {(task.materials || task.gpCost) && <> · Needs: {[
                    ...(task.materials ? Object.entries(task.materials).map(([id, qty]) => `${nameOf(id)} ×${qty}`) : []),
                    ...(task.gpCost ? [`${task.gpCost.toLocaleString()} coins`] : []),
                  ].join(', ')}</>}
                </>}
                active={globalActiveTask?.type === 'gather' && globalActiveTask.gatherTask?.id === task.id}
                disabled={!enabled}
                onClick={() => startTask(task)}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

