import { useState, useEffect, useRef } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import ProgressBar from '../components/ProgressBar.jsx'
import Panel from '../components/Panel.jsx'
import SectionHeader from '../components/SectionHeader.jsx'
import GameIcon from '../components/GameIcon.jsx'
import { getActionProgress } from '../hooks/useActionTick.js'
import { countItem, addItem } from '../engine/inventory.js'
import { getLevelFromXP } from '../engine/experience.js'
import { onTick } from '../engine/tick.js'
import { markScreenTick } from '../engine/activityRunner.js'
import { GATHER_AUTOBANK_CONSTRUCTION_LEVEL } from '../utils/constants.js'
import minigamesData from '../data/minigames.json'

/**
 * Gathering tasks — no skill level required, just time-based resource collection.
 * Inspired by activities like collecting bowstrings, gathering sand, etc.
 */

const GATHER_TASKS = [
  {
    id: 'gather_bowstring',
    name: 'Gather Bowstring',
    icon: '🌿',
    iconKey: 'thread',
    description: 'Gather loose bowstrings from fieldwork caches. Directly used for fletching bows.',
    ticks: 6,
    product: 'bowstring',
    qty: 1,
    stackable: false,
    category: 'fields',
  },
  {
    id: 'collect_sand',
    name: 'Collect Bucket of Sand',
    icon: '🏖️',
    iconKey: 'bucket',
    description: 'Collect sand from the beach. Used with seaweed to make glass.',
    ticks: 3,
    product: 'bucket_of_sand',
    qty: 1,
    stackable: false,
    category: 'beach',
  },
  {
    id: 'collect_seaweed',
    name: 'Collect Seaweed',
    icon: '🌊',
    iconKey: 'seaweed',
    description: 'Gather seaweed from the shore. Burnt with a bucket of sand to make glass.',
    ticks: 4,
    product: 'seaweed',
    qty: 1,
    stackable: false,
    category: 'beach',
  },
  {
    id: 'burn_seaweed',
    name: 'Burn Seaweed → Soda Ash',
    icon: '🔆',
    iconKey: 'flame',
    description: 'Burn seaweed to produce soda ash. Used with bucket of sand to make glass.',
    ticks: 3,
    product: 'soda_ash',
    qty: 1,
    stackable: false,
    materials: { seaweed: 1 },
    category: 'beach',
  },
  {
    id: 'catch_newts',
    name: 'Catch Eye of Newt',
    icon: '👁️',
    iconKey: 'eye',
    description: 'Catch newts from the pond and harvest their eyes. Used in many potions.',
    ticks: 4,
    product: 'eye_of_newt',
    qty: 1,
    stackable: true,
    category: 'fields',
  },
  {
    id: 'pick_white_berries',
    name: 'Pick White Berries',
    icon: '🫐',
    iconKey: 'berries',
    description: 'Pick white berries from the bushes. Used in defence and super restore potions.',
    ticks: 3,
    product: 'white_berries',
    qty: 1,
    stackable: true,
    category: 'fields',
  },
  {
    id: 'gather_snape_grass',
    name: 'Gather Snape Grass',
    icon: '🌾',
    iconKey: 'grass',
    description: 'Cut snape grass from the swamp. Used in prayer potions.',
    ticks: 3,
    product: 'snape_grass',
    qty: 1,
    stackable: true,
    category: 'fields',
  },
  {
    id: 'collect_spiders_eggs',
    name: 'Collect Red Spiders\' Eggs',
    icon: '🥚',
    iconKey: 'eggs',
    description: 'Collect eggs from red spiders. Used in super restore potions.',
    ticks: 4,
    product: 'red_spiders_eggs',
    qty: 1,
    stackable: true,
    category: 'fields',
  },
  {
    id: 'harvest_potato_cactus',
    name: 'Harvest Potato Cactus',
    icon: '🌵',
    iconKey: 'cactus',
    description: 'Harvest potato cactus from the desert. Used in magic and potion combinations.',
    ticks: 4,
    product: 'potato_cactus',
    qty: 1,
    stackable: true,
    category: 'beach',
  },
  {
    id: 'crush_birds_nest',
    name: 'Crush Bird\'s Nest → Dust',
    icon: '🪹',
    iconKey: 'nest',
    description: 'Crush an empty bird\'s nest into powder. Used in saradomin brew.',
    ticks: 5,
    product: 'crushed_bird_s_nest',
    qty: 1,
    stackable: true,
    materials: { empty_birds_nest: 1 },
    category: 'fields',
  },
  {
    id: 'collect_wine_of_zamorak',
    name: 'Collect Wine of Zamorak',
    icon: '🍷',
    iconKey: 'wine',
    description: 'Collect bottles of Wine of Zamorak. Used in herblore to make ranging potions.',
    ticks: 5,
    product: 'wine_of_krylth',
    qty: 1,
    stackable: true,
    category: 'fields',
  },
  {
    id: 'pick_limpwurt_root',
    name: 'Pick Limpwurt Root',
    icon: '🌿',
    iconKey: 'herb',
    description: 'Harvest limpwurt roots from the swamp. Used in herblore to make super strength potions.',
    ticks: 3,
    product: 'limpwurt_root',
    qty: 1,
    stackable: true,
    category: 'fields',
  },
  {
    id: 'convert_log_to_plank',
    name: 'Convert Logs → Planks',
    icon: '🪵',
    iconKey: 'planks',
    description: 'Convert logs into planks at the sawmill. Costs 25gp per action.',
    ticks: 1,
    product: 'plank',
    qty: 1,
    stackable: true,
    materials: { logs: 1 },
    gpCost: 25,
    category: 'fields',
  },
  {
    id: 'convert_oak_log_to_plank',
    name: 'Convert Oak Logs → Oak Planks',
    icon: '🪵',
    iconKey: 'planks',
    description: 'Convert oak logs into oak planks at the sawmill. Costs 50gp per action.',
    ticks: 1,
    product: 'oak_plank',
    qty: 1,
    stackable: true,
    materials: { oak_logs: 1 },
    gpCost: 50,
    category: 'fields',
  },
  {
    id: 'convert_teak_log_to_plank',
    name: 'Convert Teak Logs → Teak Planks',
    icon: '🪵',
    iconKey: 'planks',
    description: 'Convert teak logs into teak planks at the sawmill. Costs 75gp per action.',
    ticks: 1,
    product: 'teak_plank',
    qty: 1,
    stackable: true,
    materials: { teak_logs: 1 },
    gpCost: 75,
    category: 'fields',
  },
  {
    id: 'convert_mahogany_log_to_plank',
    name: 'Convert Mahogany Logs → Mahogany Planks',
    icon: '🪵',
    iconKey: 'planks',
    description: 'Convert mahogany logs into mahogany planks at the sawmill. Costs 100gp per action.',
    ticks: 1,
    product: 'mahogany_plank',
    qty: 1,
    stackable: true,
    materials: { mahogany_logs: 1 },
    gpCost: 100,
    category: 'fields',
  },
]

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
  const { inventory, bank, equipment, stats, updateInventory, updateBankDirect, addToast, setActiveTask, activeTask: globalActiveTask, itemsData } = useGame()
  const [category, setCategory] = useState('all')
  const [activeTask, setLocalTask] = useState(null)
  const taskRef = useRef(null)
  const hasAutoStarted = useRef(false)

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
          addToast(`Need ${ITEM_NAMES[task.requiresItem] || task.requiresItem}.`, 'error')
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
          // Remove materials — consume from inventory first, then bank
          for (const [id, qty] of Object.entries(task.materials)) {
            const invCount = countItem(newInv, id)
            const fromInv = Math.min(invCount, qty)
            const fromBank = qty - fromInv
            if (fromInv > 0) {
              let rem = fromInv
              for (let i = 0; i < newInv.length && rem > 0; i++) {
                if (newInv[i] && newInv[i].itemId === id) {
                  const take = Math.min(newInv[i].quantity, rem)
                  newInv[i] = { ...newInv[i], quantity: newInv[i].quantity - take }
                  rem -= take
                  if (newInv[i].quantity <= 0) newInv[i] = null
                  inventoryModified = true
                }
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

        const updated = {
          ...next,
          totalDone: next.totalDone + 1,
          totalItems: next.totalItems + qty,
          justCompleted: true,
        }
        taskRef.current = updated
        setLocalTask(updated)
      } else {
        taskRef.current = next
        setLocalTask(next)
      }
    })

    return unsub
  }, [activeTask?.task?.id, inventory, bank, stats])

  const startTask = (task, seedFromIdle = false) => {
    const idleActions = seedFromIdle && idleResult?.actions ? idleResult.actions : 0
    const idleItems = seedFromIdle && idleResult?.itemsGained
      ? Object.values(idleResult.itemsGained).reduce((s, v) => s + v, 0)
      : 0
    const newState = {
      task,
      ticksRemaining: task.ticks,
      totalDone: idleActions,
      totalItems: idleItems,
      startedAt: Date.now(),
      stopped: false,
      justCompleted: false,
    }
    taskRef.current = newState
    setLocalTask(newState)
    setActiveTask({ type: 'gather', gatherTask: task })
  }

  const stopTask = () => {
    if (taskRef.current) taskRef.current = { ...taskRef.current, stopped: true }
    setLocalTask(null)
    setActiveTask(null)
  }

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
      <div class="h-full flex flex-col p-4">
        <button
          onClick={stopTask}
          class="text-[12px] text-[#c4af7a] mb-3 flex items-center gap-1 bg-transparent border-0 cursor-pointer"
        >
          ← Back
        </button>

        <div class="flex-1 flex flex-col items-center justify-center">
          <GameIcon iconKey={task.iconKey} item={{ icon: task.icon }} size={48} color="var(--color-gold)" class="mb-2" />

          <h2 class="font-[var(--font-display)] text-[18px] font-bold text-[var(--color-gold)] mb-1 text-center">
            {task.name}
          </h2>
          <p class="text-[11px] text-[var(--color-parchment)] opacity-50 mb-4 text-center">{task.description}</p>

          <div class="w-full max-w-[280px] mb-4">
            <ProgressBar value={progress} max={1} height="h-4" color="var(--color-gold)" showText />
          </div>

          <Panel padding="p-3" className="w-full max-w-[280px] mb-3 rounded-xl">
            <div class="flex justify-between mb-2">
              <span class="text-[13px] text-[var(--color-parchment)] opacity-60">Items gathered</span>
              <span class="font-[var(--font-mono)] text-[var(--color-gold)] font-bold">{activeTask.totalItems}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-[13px] text-[var(--color-parchment)] opacity-60">Items/hr</span>
              <span class="font-[var(--font-mono)] text-[var(--color-gold)] font-bold">
                {elapsedHrs > 0 ? perHour.toLocaleString() : '—'}
              </span>
            </div>
          </Panel>

          <div class="text-[11px] text-[var(--color-parchment)] opacity-50 text-center max-w-[280px]">
            {getLevelFromXP(stats.construction?.xp || 0) >= GATHER_AUTOBANK_CONSTRUCTION_LEVEL
              ? '🏦 Items fill your inventory, then auto-bank when full.'
              : '🎒 Items go to your inventory. Gathering stops when it\'s full.'}
          </div>
        </div>
      </div>
    )
  }

  // Task picker
  return (
    <div class="h-full flex flex-col">
      {/* Header */}
      <div class="px-4 pt-4 pb-2 flex-shrink-0">
        <SectionHeader size="lg" className="mb-[10px]">🌿 Gather</SectionHeader>


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
        <div class="flex flex-col gap-2">
          {visibleTasks.map(task => {
            const hasMats = !task.materials || Object.entries(task.materials).every(
              ([id, qty]) => (countItem(inventory, id) + (bank[id]?.quantity || 0)) >= qty
            )
            const hasRequiredItem = !task.requiresItem || hasItemAnywhere(task.requiresItem, inventory, bank, equipment)
            const enabled = hasMats && hasRequiredItem
            const rowClass = enabled
              ? 'bg-[var(--color-void-light)] border-[#2a2a2a] opacity-100'
              : 'bg-[#111] border-[#1a1a1a] opacity-45'

            return (
              <div
                key={task.id}
                class={`p-3 rounded-xl border flex items-center gap-3 ${rowClass}`}
              >
                <button
                  onClick={() => enabled && startTask(task)}
                  disabled={!enabled}
                  class="flex-1 min-w-0 flex items-center gap-3 text-left bg-transparent border-0 p-0 disabled:cursor-not-allowed"
                >
                  <GameIcon iconKey={task.iconKey} item={{ icon: task.icon }} size={28} color="var(--color-gold)" class="flex-shrink-0" />

                  <div class="flex-1 min-w-0">
                    <div class="text-[13px] font-semibold text-[var(--color-parchment)] mb-1">{task.name}</div>
                    <div class="text-[10px] text-[#c8a96e] opacity-80">
                      ⏱ {(task.ticks * 0.6).toFixed(1)}s/action
                      {task.requiresItem && !task.isClue && (
                      <span class="text-[var(--color-parchment)] opacity-50">
                        {' · '}Requires: {ITEM_NAMES[task.requiresItem] || task.requiresItem}
                      </span>
                    )}
                    {task.materials && (
                        <span class="text-[var(--color-parchment)] opacity-50">
                          {' · '}Needs: {Object.entries(task.materials).map(([id, qty]) => `${ITEM_NAMES[id] || id} ×${qty}`).join(', ')}
                        </span>
                      )}
                    </div>
                  </div>
                  <div class="flex-shrink-0 text-right">
                    <div class="text-[18px]">→</div>
                    <div class="text-[9px] text-[#c8a96e] opacity-70">{ITEM_NAMES[task.product] || task.product}</div>
                    {(task.materials || task.requiresItem) && (
                      <div class={`text-[9px] mt-[2px] ${enabled ? 'text-[#4caf50]' : 'text-[#e57373]'}`}>
                        {enabled ? '✓ ready' : '✗ need item'}
                      </div>
                    )}
                  </div>
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

