import { useState, useEffect, useRef } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import ProgressBar from '../components/ProgressBar.jsx'
import Card from '../components/Card.jsx'
import Panel from '../components/Panel.jsx'
import SectionHeader from '../components/SectionHeader.jsx'
import { addItem, countItem } from '../engine/inventory.js'
import { onTick } from '../engine/tick.js'
import { formatNumber } from '../utils/helpers.js'
import { SCREENS } from '../utils/constants.js'

/**
 * Gathering tasks — no skill level required, just time-based resource collection.
 * Inspired by activities like picking flax, collecting sand, etc.
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
    materials: { bucket: 1 },
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
    id: 'wet_clay',
    name: 'Soften Clay',
    icon: '💧',
    description: 'Add water to clay to make soft clay. Needed for Crafting moulds.',
    ticks: 2,
    product: 'soft_clay',
    qty: 1,
    stackable: false,
    materials: { clay: 1 },
    category: 'fields',
  },
  {
    id: 'pick_wheat',
    name: 'Pick Wheat',
    icon: '🌾',
    description: 'Harvest wheat from the grain field.',
    ticks: 3,
    product: 'wheat',
    qty: 1,
    stackable: false,
    category: 'fields',
  },
  {
    id: 'grind_flour',
    name: 'Grind Flour',
    icon: '⚙️',
    description: 'Grind wheat into a pot of flour at the windmill.',
    ticks: 5,
    product: 'pot_of_flour',
    qty: 1,
    stackable: false,
    materials: { wheat: 1, pot: 1 },
    category: 'fields',
  },
  {
    id: 'tan_leather',
    name: 'Tan Cowhide → Leather',
    icon: '🐄',
    description: 'Tan a cowhide at the tanner. Makes regular leather for Crafting.',
    ticks: 2,
    product: 'leather',
    qty: 1,
    stackable: false,
    materials: { cowhide: 1 },
    category: 'town',
  },
  {
    id: 'tan_hard_leather',
    name: 'Tan Cowhide → Hard Leather',
    icon: '🛡️',
    description: 'Tan a cowhide into hard leather at the tanner. For Crafting level 28.',
    ticks: 2,
    product: 'hard_leather',
    qty: 1,
    stackable: false,
    materials: { cowhide: 1 },
    category: 'town',
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
]

const CATEGORIES = [
  { id: 'all', label: 'All', icon: '📋' },
  { id: 'fields', label: 'Fields', icon: '🌿' },
  { id: 'beach', label: 'Beach', icon: '🌊' },
  { id: 'town', label: 'Town', icon: '🏘️' },
]

const ITEM_NAMES = {
  flax: 'Flax', bucket_of_sand: 'Bucket of sand', giant_seaweed: 'Seaweed',
  clay: 'Clay', soft_clay: 'Soft clay', wheat: 'Wheat', pot_of_flour: 'Pot of flour',
  leather: 'Leather', hard_leather: 'Hard leather', molten_glass: 'Molten glass',
  soda_ash: 'Soda ash', cowhide: 'Cowhide', bucket: 'Bucket',
  pot: 'Pot', eye_of_newt: 'Eye of newt', white_berries: 'White berries',
  snape_grass: 'Snape grass', red_spiders_eggs: 'Red spiders\' eggs',
  potato_cactus: 'Potato cactus', crushed_birds_nest: 'Crushed bird\'s nest',
  empty_birds_nest: 'Empty bird\'s nest', limpwurt_root: 'Limpwurt root',
}

export default function GatherScreen({ initialTaskId, idleResult }) {
  const { inventory, bank, updateInventory, updateBankDirect, addToast, homeShortcuts, updateHomeShortcuts, setActiveTask } = useGame()
  const [category, setCategory] = useState('all')
  const [activeTask, setLocalTask] = useState(null)
  const taskRef = useRef(null)
  const hasAutoStarted = useRef(false)

  const visibleTasks = category === 'all'
    ? GATHER_TASKS
    : GATHER_TASKS.filter(t => t.category === category)

  // Tick listener
  useEffect(() => {
    if (!activeTask) return
    taskRef.current = activeTask

    const unsub = onTick(() => {
      const state = taskRef.current
      if (!state || state.stopped) return

      const next = { ...state, ticksRemaining: state.ticksRemaining - 1 }

      if (next.ticksRemaining <= 0) {
        // Action complete — check materials
        const task = next.task
        const newInv = [...inventory]

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
          const bankUpdates = {}
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
                }
              }
            }
            if (fromBank > 0) bankUpdates[id] = -fromBank
          }
          if (Object.keys(bankUpdates).length > 0) updateBankDirect(bankUpdates)
        }

        // Add product to bank directly
        updateBankDirect({ [task.product]: task.qty || 1 })
        // Update inventory only if materials were consumed
        if (task.materials) updateInventory(newInv)

        const updated = {
          ...next,
          ticksRemaining: task.ticks,
          totalDone: next.totalDone + 1,
          totalItems: next.totalItems + task.qty,
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
    }
    taskRef.current = newState
    setLocalTask(newState)
    // Gathering always has bankingEnabled = true (auto-bank enabled)
    setActiveTask({ type: 'gather', gatherTask: task, bankingEnabled: true })
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


  const handleAddToHome = (task) => {
    const shortcut = {
      label: task.name,
      icon: task.icon,
      screen: SCREENS.GATHER,
      gatherTaskId: task.id
    }
    const current = homeShortcuts ?? [
      { label: 'Fight Monsters', icon: '⚔️', screen: SCREENS.COMBAT },
      { label: 'Train Skills', icon: '🔨', screen: SCREENS.SKILLS },
      { label: 'Gather Resources', icon: '🌿', screen: SCREENS.GATHER },
      { label: 'Open Bank', icon: '🏦', screen: SCREENS.BANK },
      { label: 'View Stats', icon: '📊', screen: SCREENS.STATS },
      { label: 'Inventory', icon: '🎒', screen: SCREENS.INVENTORY },
    ]
    const alreadyExists = current.some(s => s.label === shortcut.label)
    if (alreadyExists) {
      addToast('Already on home screen!', 'info')
      return
    }
    updateHomeShortcuts([...current, shortcut])
    addToast(`${task.icon} ${task.name} added to Home!`, 'info')
  }

  // Active gathering modal
  if (activeTask) {
    const { task } = activeTask
    const progress = 1 - activeTask.ticksRemaining / task.ticks
    const elapsedHrs = activeTask.startedAt ? (Date.now() - activeTask.startedAt) / 3600000 : 0
    const perHour = elapsedHrs > 0 ? Math.round(activeTask.totalItems / elapsedHrs) : 0

    return (
      <div class="h-full flex flex-col p-4">
        {/* Back button */}
        <button
          onClick={stopTask}
          class="text-[12px] text-[#c4af7a] mb-3 flex items-center gap-1 bg-transparent border-0 cursor-pointer"
        >
          ← Back
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

          <div class="text-[11px] text-[var(--color-parchment)] opacity-50 text-center max-w-[280px]">
            ⏳ Items go directly to your bank.
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
        <SectionHeader size="lg" className="mb-[10px]">🌿 Gather Resources</SectionHeader>

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

      {/* Task list */}
      <div class="flex-1 overflow-y-auto px-4 pb-4">
        <div class="flex flex-col gap-2">
          {visibleTasks.map(task => {
            const hasMats = !task.materials || Object.entries(task.materials).every(
              ([id, qty]) => (countItem(inventory, id) + (bank[id]?.quantity || 0)) >= qty
            )
            const invFull = freeSlots(inventory) === 0
            const enabled = hasMats && !invFull
            const rowClass = enabled
              ? 'bg-[var(--color-void-light)] border-[#2a2a2a] opacity-100'
              : 'bg-[#111] border-[#1a1a1a] opacity-45'

            return (
              <div key={task.id} class="flex gap-2 items-stretch">
                <button
                  onClick={() => enabled && startTask(task)}
                  disabled={!enabled}
                  class={`flex-1 p-3 rounded-xl border text-left flex items-center gap-3 ${rowClass}`}
                >
                  <span class="text-[28px] flex-shrink-0">{task.icon}</span>
                  <div class="flex-1 min-w-0">
                    <div class="text-[13px] font-semibold text-[var(--color-parchment)] mb-1">{task.name}</div>
                    <div class="text-[10px] text-[#c8a96e] opacity-80">
                      ⏱ {(task.ticks * 0.6).toFixed(1)}s/action
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
                    {task.materials && (
                      <div class={`text-[9px] mt-[2px] ${hasMats ? 'text-[#4caf50]' : 'text-[#e57373]'}`}>
                        {hasMats ? '✓ have mats' : '✗ no mats'}
                      </div>
                    )}
                  </div>
                </button>
                <button
                  onClick={() => handleAddToHome(task)}
                  title="Add to Home Screen"
                  class="px-3 rounded-xl bg-[var(--color-void-light)] border border-[#2a2a2a] flex flex-col items-center justify-center gap-[2px] cursor-pointer flex-shrink-0"
                >
                  <span class="text-[16px]">🏠</span>
                  <span class="text-[8px] text-[var(--color-parchment)] opacity-50">Add</span>
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
