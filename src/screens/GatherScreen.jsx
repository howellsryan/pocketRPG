import { useState, useEffect, useRef } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import ProgressBar from '../components/ProgressBar.jsx'
import Card from '../components/Card.jsx'
import Panel from '../components/Panel.jsx'
import Modal from '../components/Modal.jsx'
import SectionHeader from '../components/SectionHeader.jsx'
import { getActionProgress } from '../hooks/useActionTick.js'
import { addItem, countItem, freeSlots } from '../engine/inventory.js'
import { onTick } from '../engine/tick.js'
import { formatNumber } from '../utils/helpers.js'
import { SCREENS } from '../utils/constants.js'
import minigamesData from '../data/minigames.json'
import cluesData from '../data/clues.json'
import { rollClueRewards } from '../engine/clueScrolls.js'

/**
 * Gathering tasks — no skill level required, just time-based resource collection.
 * Inspired by activities like picking flax, collecting sand, etc.
 *
 * Also hosts long-running Minigame grinds (Barbarian Assault, Warriors Guild,
 * Castle Wars) which award a single untradeable reward after hours of idling.
 */

const GATHER_TASKS = [
  {
    id: 'pick_flax',
    name: 'Pick Flax',
    icon: '🌿',
    description: 'Pick flax from the fields. Used in Crafting to spin bowstrings.',
    ticks: 3,
    product: 'flax',
    qty: 1,
    stackable: false,
    category: 'fields',
  },
  {
    id: 'collect_sand',
    name: 'Collect Bucket of Sand',
    icon: '🏖️',
    description: 'Fill a bucket with sand from the beach. Used with seaweed to make glass.',
    ticks: 3,
    product: 'bucket_of_sand',
    qty: 1,
    stackable: false,
    requiresItem: 'bucket',
    reusableRequirement: true,
    category: 'beach',
  },
  {
    id: 'collect_seaweed',
    name: 'Collect Seaweed',
    icon: '🌊',
    description: 'Gather seaweed from the shore. Burnt with a bucket of sand to make glass.',
    ticks: 4,
    product: 'giant_seaweed',
    qty: 1,
    stackable: false,
    category: 'beach',
  },
  {
    id: 'burn_seaweed',
    name: 'Burn Seaweed → Soda Ash',
    icon: '🔆',
    description: 'Burn seaweed to produce soda ash. Used with bucket of sand to make glass.',
    ticks: 3,
    product: 'soda_ash',
    qty: 1,
    stackable: false,
    materials: { giant_seaweed: 1 },
    category: 'beach',
  },
  {
    id: 'catch_newts',
    name: 'Catch Eye of Newt',
    icon: '👁️',
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
    description: 'Crush an empty bird\'s nest into powder. Used in saradomin brew.',
    ticks: 2,
    product: 'crushed_birds_nest',
    qty: 1,
    stackable: true,
    materials: { empty_birds_nest: 1 },
    category: 'fields',
  },
  {
    id: 'collect_wine_of_zamorak',
    name: 'Collect Wine of Zamorak',
    icon: '🍷',
    description: 'Collect bottles of Wine of Zamorak. Used in herblore to make ranging potions.',
    ticks: 5,
    product: 'wine_of_zamorak',
    qty: 1,
    stackable: true,
    category: 'fields',
  },
  {
    id: 'pick_limpwurt_root',
    name: 'Pick Limpwurt Root',
    icon: '🌿',
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
    description: 'Convert logs into planks at the sawmill. Costs 25gp per action.',
    ticks: 1,
    product: 'planks',
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
    description: 'Convert mahogany logs into mahogany planks at the sawmill. Costs 100gp per action.',
    ticks: 1,
    product: 'mahogany_plank',
    qty: 1,
    stackable: true,
    materials: { mahogany_logs: 1 },
    gpCost: 100,
    category: 'fields',
  },
  {
    id: 'complete_medium_clue',
    name: 'Complete Medium Clue',
    icon: '📜',
    description: 'Solve a medium clue scroll for treasure rewards.',
    ticks: 500,
    requiresItem: 'clue_scroll_medium',
    isClue: true,
    clueLevel: 'medium',
    category: 'clues',
  },
  {
    id: 'complete_hard_clue',
    name: 'Complete Hard Clue',
    icon: '📜',
    description: 'Solve a hard clue scroll for treasure rewards.',
    ticks: 1500,
    requiresItem: 'clue_scroll_hard',
    isClue: true,
    clueLevel: 'hard',
    category: 'clues',
  },
  {
    id: 'complete_elite_clue',
    name: 'Complete Elite Clue',
    icon: '📜',
    description: 'Solve an elite clue scroll for treasure rewards.',
    ticks: 3000,
    requiresItem: 'clue_scroll_elite',
    isClue: true,
    clueLevel: 'elite',
    category: 'clues',
  },
  {
    id: 'complete_master_clue',
    name: 'Complete Master Clue',
    icon: '📜',
    description: 'Solve a master clue scroll for treasure rewards.',
    ticks: 6000,
    requiresItem: 'clue_scroll_master',
    isClue: true,
    clueLevel: 'master',
    category: 'clues',
  },
]

const CATEGORIES = [
  { id: 'all', label: 'All', icon: '📋' },
  { id: 'clues', label: 'Clues', icon: '📜' },
]

const TICKS_PER_HOUR = 6000 // 3600s / 0.6s per tick

const MINIGAME_TASKS = minigamesData.tasks
const MINIGAMES = minigamesData.minigames
const ITEM_NAMES = {
  flax: 'Flax', bucket_of_sand: 'Bucket of sand', giant_seaweed: 'Seaweed',
  clay: 'Clay', soft_clay: 'Soft clay', wheat: 'Wheat', pot_of_flour: 'Pot of flour',
  leather: 'Leather', hard_leather: 'Hard leather', molten_glass: 'Molten glass',
  soda_ash: 'Soda ash', cowhide: 'Cowhide', bucket: 'Bucket',
  pot: 'Pot', eye_of_newt: 'Eye of newt', white_berries: 'White berries',
  snape_grass: 'Snape grass', red_spiders_eggs: 'Red spiders\' eggs',
  potato_cactus: 'Potato cactus', crushed_birds_nest: 'Crushed bird\'s nest',
  empty_birds_nest: 'Empty bird\'s nest', limpwurt_root: 'Limpwurt root',
  logs: 'Logs', oak_logs: 'Oak logs', teak_logs: 'Teak logs', mahogany_logs: 'Mahogany logs',
  planks: 'Plank', oak_plank: 'Oak plank', teak_plank: 'Teak plank', mahogany_plank: 'Mahogany plank',
  clue_scroll_medium: 'Clue scroll (medium)', clue_scroll_hard: 'Clue scroll (hard)',
  clue_scroll_elite: 'Clue scroll (elite)', clue_scroll_master: 'Clue scroll (master)',
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

function formatHours(hours) {
  if (hours === Math.floor(hours)) return `${hours}h`
  return `${hours.toFixed(1)}h`
}

export default function GatherScreen({ initialTaskId, idleResult }) {
  const { inventory, bank, equipment, updateInventory, updateBankDirect, addToast, setActiveTask, activeTask: globalActiveTask, itemsData } = useGame()
  const [category, setCategory] = useState('all')
  const [activeTask, setLocalTask] = useState(null)
  const [infoTask, setInfoTask] = useState(null)
  const taskRef = useRef(null)
  const hasAutoStarted = useRef(false)

  const visibleTasks = category === 'all'
    ? GATHER_TASKS
    : GATHER_TASKS.filter(t => t.category === category)

  // Tick listener — oneShot minigames are ticked by the App so they run
  // on any screen. Resource gathers stay local.
  useEffect(() => {
    if (!activeTask) return
    if (activeTask.task?.oneShot) return
    taskRef.current = activeTask

    const unsub = onTick(() => {
      const state = taskRef.current
      if (!state || state.stopped) return

      // Handle reset from previous completion tick
      let ticksRemaining = state.ticksRemaining
      let justCompleted = state.justCompleted || false

      if (justCompleted) {
        // For clue tasks, ensure another scroll is available before
        // starting the next cycle — otherwise the player would idle
        // through a full action only to finish empty-handed.
        if (state.task.isClue) {
          const scrollCount = bank?.[state.task.requiresItem]?.quantity || 0
          if (scrollCount <= 0) {
            taskRef.current = { ...state, stopped: true }
            setLocalTask(null)
            setActiveTask(null)
            addToast(`No ${ITEM_NAMES[state.task.requiresItem] || state.task.requiresItem} left.`, 'info')
            return
          }
        }
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

        if (task.requiresItem && !task.isClue && !hasItemAnywhere(task.requiresItem, newInv, bank, equipment)) {
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

        // Update bank and inventory
        if (Object.keys(bankUpdates).length > 0) updateBankDirect(bankUpdates)
        if (inventoryModified) updateInventory(newInv)

        // Handle clue scrolls (roll rewards and consume scroll)
        if (task.isClue) {
          const rewards = rollClueRewards(task.clueLevel)
          const bankUpdates = {}
          for (const reward of rewards) {
            bankUpdates[reward.itemId] = reward.quantity
          }
          bankUpdates[task.requiresItem] = -1
          updateBankDirect(bankUpdates)
          const rewardNames = rewards.map(r => `${ITEM_NAMES[r.itemId] || r.itemId} ×${r.quantity}`).join(', ')
          addToast(`${task.icon} Rewards: ${rewardNames}`, 'success')
        } else {
          // Add product to bank directly
          updateBankDirect({ [task.product]: task.qty || 1 })
        }

        if (task.oneShot) {
          // Minigame grind — award once then stop.
          addToast(`${task.icon} ${ITEM_NAMES[task.product] || task.product} banked!`, 'success')
          taskRef.current = { ...next, stopped: true }
          setLocalTask(null)
          setActiveTask(null)
          return
        }

        const updated = {
          ...next,
          totalDone: next.totalDone + 1,
          totalItems: next.totalItems + task.qty,
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
  }, [activeTask?.task?.id, inventory, bank])

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
    // Gathering always has bankingEnabled = true (auto-bank enabled).
    // OneShot minigames persist progress on the global activeTask so they
    // continue ticking at the App level after the user leaves this screen.
    if (task.oneShot) {
      setActiveTask({
        type: 'gather',
        gatherTask: task,
        bankingEnabled: true,
        totalTicks: task.ticks,
        ticksRemaining: task.ticks,
        startedAt: Date.now(),
      })
    } else {
      setActiveTask({ type: 'gather', gatherTask: task, bankingEnabled: true })
    }
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
      // Don't restart a minigame that's already running in the background.
      if (globalActiveTask?.type === 'gather'
          && globalActiveTask?.gatherTask?.id === initialTaskId
          && globalActiveTask?.gatherTask?.oneShot) {
        return
      }
      const task = GATHER_TASKS.find(t => t.id === initialTaskId)
        || MINIGAME_TASKS.find(t => t.id === initialTaskId)
      if (task) startTask(task, true)
    }
  }, [initialTaskId])



  // Active gathering modal — show if we have a local task OR a global minigame
  // that was started earlier (allows the user to leave and return to the screen
  // without losing progress).
  const isGlobalMinigame = globalActiveTask?.type === 'gather' && globalActiveTask?.gatherTask?.oneShot
  if (activeTask || isGlobalMinigame) {
    const task = activeTask?.task || globalActiveTask.gatherTask
    const isOneShot = !!task.oneShot
    const totalTicks = isOneShot
      ? (globalActiveTask?.totalTicks ?? task.ticks)
      : task.ticks
    const ticksRemaining = isOneShot
      ? (globalActiveTask?.ticksRemaining ?? totalTicks)
      : activeTask.ticksRemaining
    const progress = isOneShot
      ? (totalTicks > 0 ? 1 - ticksRemaining / totalTicks : 0)
      : getActionProgress(true, activeTask.ticksRemaining, task.ticks)
    const elapsedHrs = activeTask?.startedAt ? (Date.now() - activeTask.startedAt) / 3600000 : 0
    const perHour = elapsedHrs > 0 ? Math.round(activeTask.totalItems / elapsedHrs) : 0
    const remainingSeconds = ticksRemaining * 0.6

    return (
      <div class="h-full flex flex-col p-4">
        {/* Back button */}
        <button
          onClick={stopTask}
          class="text-[12px] text-[#c4af7a] mb-3 flex items-center gap-1 bg-transparent border-0 cursor-pointer"
        >
          {isOneShot ? '← Abandon' : '← Back'}
        </button>

        <div class="flex-1 flex flex-col items-center justify-center">
          <span class="text-[48px] mb-2">{task.icon}</span>
          <h2 class="font-[var(--font-display)] text-[18px] font-bold text-[var(--color-gold)] mb-1 text-center">
            {task.name}
          </h2>
          <p class="text-[11px] text-[var(--color-parchment)] opacity-50 mb-4 text-center">{task.description}</p>

          <div class="w-full max-w-[280px] mb-4">
            <ProgressBar value={progress} max={1} height="h-4" color="var(--color-gold)" showText />
          </div>

          {task.isClue ? (
            <Panel padding="p-3" className="w-full max-w-[280px] mb-3 rounded-xl">
              <div class="flex justify-between mb-2">
                <span class="text-[13px] text-[var(--color-parchment)] opacity-60">Clue Required</span>
                <span class="font-[var(--font-mono)] text-[var(--color-gold)] font-bold">{ITEM_NAMES[task.requiresItem] || task.requiresItem}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-[13px] text-[var(--color-parchment)] opacity-60">Time remaining</span>
                <span class="font-[var(--font-mono)] text-[var(--color-gold)] font-bold">
                  {formatRemaining(remainingSeconds)}
                </span>
              </div>
            </Panel>
          ) : task.oneShot ? (
            <Panel padding="p-3" className="w-full max-w-[280px] mb-3 rounded-xl">
              <div class="flex justify-between mb-2">
                <span class="text-[13px] text-[var(--color-parchment)] opacity-60">Reward</span>
                <span class="font-[var(--font-mono)] text-[var(--color-gold)] font-bold">{ITEM_NAMES[task.product] || task.product}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-[13px] text-[var(--color-parchment)] opacity-60">Time remaining</span>
                <span class="font-[var(--font-mono)] text-[var(--color-gold)] font-bold">
                  {formatRemaining(remainingSeconds)}
                </span>
              </div>
            </Panel>
          ) : (
            <Panel padding="p-3" className="w-full max-w-[280px] mb-3 rounded-xl">
              <div class="flex justify-between mb-2">
                <span class="text-[13px] text-[var(--color-parchment)] opacity-60">Items banked</span>
                <span class="font-[var(--font-mono)] text-[var(--color-gold)] font-bold">{activeTask.totalItems}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-[13px] text-[var(--color-parchment)] opacity-60">Items banked/hr</span>
                <span class="font-[var(--font-mono)] text-[var(--color-gold)] font-bold">
                  {elapsedHrs > 0 ? perHour.toLocaleString() : '—'}
                </span>
              </div>
            </Panel>
          )}

          <div class="text-[11px] text-[var(--color-parchment)] opacity-50 text-center max-w-[280px]">
            {task.isClue
              ? '⏳ Solving clue... 1–4 rewards will be banked on completion.'
              : task.oneShot
              ? '⏳ Minigame runs in the background — feel free to switch screens. Reward is banked on completion.'
              : '⏳ Items go directly to your bank.'}
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
                class={`flex-shrink-0 px-3 py-[5px] rounded-[20px] text-[11px] font-semibold border ${pillClass}`}
              >
                {cat.icon} {cat.label}
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
                  <span class="text-[28px] flex-shrink-0">{task.icon}</span>
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
                    <div class="text-[9px] text-[#c8a96e] opacity-70">{task.isClue ? 'Rewards' : ITEM_NAMES[task.product] || task.product}</div>
                    {(task.materials || task.requiresItem) && (
                      <div class={`text-[9px] mt-[2px] ${enabled ? 'text-[#4caf50]' : 'text-[#e57373]'}`}>
                        {enabled ? '✓ ready' : '✗ need item'}
                      </div>
                    )}
                  </div>
                </button>
                {task.isClue && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setInfoTask(task) }}
                    aria-label="Drop rates"
                    class="flex-shrink-0 w-9 h-9 rounded-full border border-[var(--color-void-border)] bg-[var(--color-void-light)] text-[var(--color-gold)] text-[14px] font-bold flex items-center justify-center active:opacity-70"
                  >
                    ⓘ
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {infoTask && (
        <ClueDropRatesModal
          task={infoTask}
          itemsData={itemsData}
          onClose={() => setInfoTask(null)}
        />
      )}
    </div>
  )
}

function formatChance(pct) {
  if (pct >= 1) return `${pct.toFixed(2)}%`
  if (pct >= 0.05) return `${pct.toFixed(3)}%`
  if (pct <= 0) return '—'
  // Per-roll odds < 0.05% — display as "1 in N" for readability
  const oneIn = Math.round(100 / pct)
  return `1 in ${oneIn.toLocaleString()}`
}

function rarityBand(pct) {
  if (pct >= 1) return 'common'
  if (pct >= 0.05) return 'uncommon'
  return 'rare'
}

function ClueDropRatesModal({ task, itemsData, onClose }) {
  const data = cluesData[task.clueLevel]
  if (!data) return null

  const totalWeight = data.rewards.reduce((s, r) => s + r.weight, 0)
  const groups = { common: [], uncommon: [], rare: [] }
  for (const r of data.rewards) {
    const pct = totalWeight > 0 ? (100 * r.weight) / totalWeight : 0
    const item = itemsData?.[r.itemId]
    const name = item?.name || ITEM_NAMES[r.itemId] || r.itemId
    const icon = item?.icon || '•'
    const reqs = item?.requirements
    groups[rarityBand(pct)].push({ itemId: r.itemId, name, icon, pct, reqs })
  }
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name))
  }

  const tierLabel = task.clueLevel.charAt(0).toUpperCase() + task.clueLevel.slice(1)
  const bandLabels = {
    common: { label: 'Common', color: '#86efac' },
    uncommon: { label: 'Uncommon', color: '#fcd34d' },
    rare: { label: 'Rare', color: '#a78bfa' },
  }

  // Helper to format requirements
  const formatReqs = (reqs) => {
    if (!reqs) return null
    return Object.entries(reqs)
      .map(([skill, level]) => `${level} ${skill.charAt(0).toUpperCase() + skill.slice(1)}`)
      .join(', ')
  }

  return (
    <Modal title={`${task.icon} ${tierLabel} Clue — Drop Rates`} onClose={onClose}>
      <p class="text-[11px] text-[var(--color-parchment)] opacity-60 mb-3">
        Each completed clue rolls 1–4 reward slots. Percentages below are the chance per slot.
      </p>
      {Object.entries(groups).map(([band, rows]) => rows.length === 0 ? null : (
        <div key={band} class="mb-4">
          <div
            class="text-[10px] font-bold uppercase tracking-wider mb-1"
            style={{ color: bandLabels[band].color }}
          >
            {bandLabels[band].label} ({rows.length})
          </div>
          <Panel padding="p-2" className="rounded-lg">
            {rows.map(r => (
              <div key={r.itemId} class="flex items-center justify-between py-[3px] text-[12px]">
                <div class="flex items-center gap-2 text-[var(--color-parchment)] truncate flex-1">
                  <span class="text-[14px] flex-shrink-0">{r.icon}</span>
                  <div class="truncate flex-1">
                    <div class="truncate">{r.name}</div>
                    {r.reqs && (
                      <div class="text-[10px] opacity-60 truncate">
                        {formatReqs(r.reqs)}
                      </div>
                    )}
                  </div>
                </div>
                <span class="font-[var(--font-mono)] text-[var(--color-gold)] flex-shrink-0 ml-2">
                  {formatChance(r.pct)}
                </span>
              </div>
            ))}
          </Panel>
        </div>
      ))}
    </Modal>
  )
}

function formatRemaining(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds))
  const hrs = Math.floor(s / 3600)
  const mins = Math.floor((s % 3600) / 60)
  const secs = s % 60
  if (hrs > 0) return `${hrs}h ${mins}m`
  if (mins > 0) return `${mins}m ${secs}s`
  return `${secs}s`
}
