import { useState, useEffect, useRef } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import ProgressBar from '../components/ProgressBar.jsx'
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

    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '16px' }}>
        {/* Back button */}
        <button onClick={stopTask}
          style={{ fontSize: '12px', color: '#c4af7a', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', cursor: 'pointer' }}>
          ← Back
        </button>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: '48px', marginBottom: '8px' }}>{task.icon}</span>
          <h2 style={{ fontFamily: 'Cinzel, serif', fontSize: '18px', fontWeight: 'bold', color: '#d4af37', marginBottom: '4px', textAlign: 'center' }}>
            {task.name}
          </h2>
          <p style={{ fontSize: '11px', color: '#e8d5b0', opacity: 0.5, marginBottom: '16px', textAlign: 'center' }}>{task.description}</p>

          <div style={{ width: '100%', maxWidth: '280px', marginBottom: '16px' }}>
            <ProgressBar value={progress} max={1} height="h-4" color="var(--color-gold)" showText />
          </div>

          <div style={{ background: '#111', borderRadius: '12px', padding: '12px', width: '100%', maxWidth: '280px', marginBottom: '12px' }}>
            {(() => {
              const elapsedHrs = activeTask.startedAt ? (Date.now() - activeTask.startedAt) / 3600000 : 0
              const perHour = elapsedHrs > 0 ? Math.round(activeTask.totalItems / elapsedHrs) : 0
              return (<>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '13px', color: '#e8d5b0', opacity: 0.6 }}>Items banked</span>
                  <span style={{ fontFamily: 'monospace', color: '#d4af37', fontWeight: 'bold' }}>{activeTask.totalItems}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '13px', color: '#e8d5b0', opacity: 0.6 }}>Items banked/hr</span>
                  <span style={{ fontFamily: 'monospace', color: '#d4af37', fontWeight: 'bold' }}>{elapsedHrs > 0 ? perHour.toLocaleString() : '—'}</span>
                </div>
              </>)
            })()}
          </div>

          {/* Banking delay note */}
          <div style={{ fontSize: '11px', color: '#e8d5b0', opacity: 0.5, textAlign: 'center', maxWidth: '280px' }}>
            ⏳ Items go directly to your bank. Banking delay scales with Agility level.
          </div>
        </div>

      </div>
    )
  }

  // Task picker
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '16px 16px 8px', flexShrink: 0 }}>
        <h2 style={{ fontFamily: 'Cinzel, serif', fontSize: '13px', fontWeight: 'bold', color: '#e8d5b0', opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '10px' }}>
          🌿 Gather Resources
        </h2>

        {/* Category tabs */}
        <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px' }}>
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              style={{
                flexShrink: 0,
                padding: '5px 12px',
                borderRadius: '20px',
                fontSize: '11px',
                fontWeight: '600',
                border: category === cat.id ? '1px solid #d4af37' : '1px solid #2a2a2a',
                background: category === cat.id ? 'rgba(212,175,55,0.15)' : '#1a1a1a',
                color: category === cat.id ? '#d4af37' : '#e8d5b0',
                opacity: category === cat.id ? 1 : 0.6,
              }}
            >
              {cat.icon} {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Task list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 16px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {visibleTasks.map(task => {
            const hasMats = !task.materials || Object.entries(task.materials).every(
              ([id, qty]) => (countItem(inventory, id) + (bank[id]?.quantity || 0)) >= qty
            )
            const invFull = freeSlots(inventory) === 0

            return (
              <div key={task.id} style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
                <button
                  onClick={() => hasMats && !invFull && startTask(task)}
                  disabled={!hasMats || invFull}
                  style={{
                    flex: 1,
                    padding: '12px',
                    borderRadius: '12px',
                    border: '1px solid',
                    borderColor: hasMats && !invFull ? '#2a2a2a' : '#1a1a1a',
                    background: hasMats && !invFull ? '#1a1a1a' : '#111',
                    opacity: hasMats && !invFull ? 1 : 0.45,
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                  }}
                >
                  <span style={{ fontSize: '28px', flexShrink: 0 }}>{task.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: '600', color: '#e8d5b0', marginBottom: '4px' }}>{task.name}</div>
                    <div style={{ fontSize: '10px', color: '#c8a96e', opacity: 0.8 }}>
                      ⏱ {(task.ticks * 0.6).toFixed(1)}s/action
                      {task.materials && (
                        <span style={{ color: '#e8d5b0', opacity: 0.5 }}>
                          {' · '}Needs: {Object.entries(task.materials).map(([id, qty]) => `${ITEM_NAMES[id] || id} ×${qty}`).join(', ')}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ flexShrink: 0, textAlign: 'right' }}>
                    <div style={{ fontSize: '18px' }}>→</div>
                    <div style={{ fontSize: '9px', color: '#c8a96e', opacity: 0.7 }}>{ITEM_NAMES[task.product] || task.product}</div>
                    {task.materials && (
                      <div style={{ fontSize: '9px', color: hasMats ? '#4caf50' : '#e57373', marginTop: '2px' }}>
                        {hasMats ? '✓ have mats' : '✗ no mats'}
                      </div>
                    )}
                  </div>
                </button>
                <button
                  onClick={() => handleAddToHome(task)}
                  style={{
                    padding: '0 12px',
                    borderRadius: '12px',
                    background: '#1a1a1a',
                    border: '1px solid #2a2a2a',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '2px',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                  title="Add to Home Screen"
                >
                  <span style={{ fontSize: '16px' }}>🏠</span>
                  <span style={{ fontSize: '8px', color: '#e8d5b0', opacity: 0.5 }}>Add</span>
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
