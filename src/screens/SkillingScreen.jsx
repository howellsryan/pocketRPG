import { useState, useEffect, useRef } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import Modal from '../components/Modal.jsx'
import ProgressBar from '../components/ProgressBar.jsx'
import { SKILL_ICONS, STUB_SKILLS, GATHERING_SKILLS, PRODUCTION_SKILLS, UTILITY_SKILLS, SCREENS } from '../utils/constants.js'
import { getLevelFromXP } from '../engine/experience.js'
import { createSkillingState, processSkillingTick, getAvailableActions, checkBurn, getToolSpeedMultiplier, hasToolForSkill } from '../engine/skilling.js'
import { addItem, removeItem, countItem } from '../engine/inventory.js'
import { hasRequiredRunes, getRunesToConsume } from '../engine/runes.js'
import { onTick } from '../engine/tick.js'
import { formatNumber } from '../utils/helpers.js'
import skillsData from '../data/skills.json'
import itemsData from '../data/items.json'
import AgilityScreen from './AgilityScreen.jsx'
import SlayerScreen from './SlayerScreen.jsx'

// Agility, Prayer, and Slayer are special skills shown here in the Skills tab
const SPECIAL_SKILLS = ['agility', 'prayer', 'slayer']
const trainableSkills = [...GATHERING_SKILLS, ...PRODUCTION_SKILLS].filter(s => !STUB_SKILLS.has(s) && skillsData[s]?.actions?.length > 0)
const allSkillsInTab = [...trainableSkills, ...SPECIAL_SKILLS]

export default function SkillingScreen({ initialSkillId, initialActionId, idleResult, onSkipHour, skipHourUnlocked }) {
  const { stats, inventory, bank, equipment, updateInventory, updateBankDirect, grantXP, addToast, homeShortcuts, updateHomeShortcuts, setActiveTask, activeTask } = useGame()
  const [selectedSkill, setSelectedSkill] = useState(initialSkillId || null)
  const [selectedAction, setSelectedAction] = useState(null)
  const [skilling, setSkilling] = useState(null)
  const [skillingBankingEnabled, setSkillingBankingEnabled] = useState(false) // Banking toggle for skilling
  const [selectedAlchemyItem, setSelectedAlchemyItem] = useState(null) // Track selected item for High Alchemy
  const [showAlchemyPicker, setShowAlchemyPicker] = useState(false) // Show item picker for alchemy
  const skillingRef = useRef(null)
  const hasAutoStarted = useRef(false)

  // If agility is selected, delegate to AgilityScreen (special screen for agility only)
  if (selectedSkill === 'agility') {
    return (
      <AgilityScreen
        initialActionId={initialActionId}
        onBack={() => setSelectedSkill(null)}
        onSkipHour={onSkipHour}
        skipHourUnlocked={skipHourUnlocked}
      />
    )
  }

  // If slayer is selected, delegate to SlayerScreen
  if (selectedSkill === 'slayer') {
    return (
      <SlayerScreen
        onBack={() => setSelectedSkill(null)}
      />
    )
  }

  // Tick listener
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
          // Check materials and runes
          const action = ev.action
          const newInv = [...inventory]

          // Check and consume runes (for magic spells)
          if (action.runeReq) {
            if (!hasRequiredRunes(action.runeReq, newInv, bank, equipment, itemsData)) {
              skillingRef.current = { ...skillingState, active: false, stopped: true }
              setSkilling({ ...skillingState, active: false, stopped: true })
              addToast('Out of runes!', 'error')
              return
            }
            // Remove runes that need to be consumed (excluding those provided by staff)
            const runesToConsume = getRunesToConsume(action.runeReq, equipment, itemsData)
            const bankUpdates = {}
            for (const [runeId, qty] of Object.entries(runesToConsume)) {
              const invCount = countItem(newInv, runeId)
              const fromInv = Math.min(invCount, qty)
              const fromBank = qty - fromInv
              if (fromInv > 0) removeItem(newInv, runeId, fromInv)
              if (fromBank > 0) bankUpdates[runeId] = -fromBank
            }
            if (Object.keys(bankUpdates).length > 0) updateBankDirect(bankUpdates)
          }

          if (action.materials) {
            let hasMats = true
            for (const [matId, qty] of Object.entries(action.materials)) {
              const invCount = countItem(newInv, matId)
              const bankCount = bank[matId]?.quantity || 0
              if (invCount + bankCount < qty) { hasMats = false; break }
            }
            if (!hasMats) {
              skillingRef.current = { ...skillingState, active: false, stopped: true }
              setSkilling({ ...skillingState, active: false, stopped: true })
              addToast('Out of materials!', 'error')
              return
            }
            // Remove materials — consume from inventory first, then bank
            const bankUpdates = {}
            for (const [matId, qty] of Object.entries(action.materials)) {
              const invCount = countItem(newInv, matId)
              const fromInv = Math.min(invCount, qty)
              const fromBank = qty - fromInv
              if (fromInv > 0) removeItem(newInv, matId, fromInv)
              if (fromBank > 0) bankUpdates[matId] = -fromBank
            }
            if (Object.keys(bankUpdates).length > 0) updateBankDirect(bankUpdates)
          }

          // Handle cooking burn
          if (action.burnStopLevel) {
            const cookLevel = getLevelFromXP(stats.cooking?.xp || 0)
            if (checkBurn(cookLevel, { level: action.level, burnStopLevel: action.burnStopLevel })) {
              addItem(newInv, 'burnt_food', 1, false)
              updateInventory(newInv)
              grantXP(state.skill, 1) // Tiny XP for burn
              setSkilling({ ...skillingState })
              return
            }
          }

          // Handle High Alchemy special calculation
          if (action.type === 'alchemy' && selectedAlchemyItem) {
            const alchItem = itemsData[selectedAlchemyItem.itemId]
            if (alchItem && typeof alchItem.shopValue === 'number') {
              // Calculate coins based on shop value: <100k = 1.5x, >=100k = 1.1x
              const alchValue = alchItem.shopValue >= 100000
                ? Math.floor(alchItem.shopValue * 1.1)
                : Math.floor(alchItem.shopValue * 1.5)

              // Remove the alchemized item from inventory
              const alchemyItemIdx = newInv.indexOf(selectedAlchemyItem)
              if (alchemyItemIdx !== -1) {
                if (selectedAlchemyItem.quantity > 1) {
                  newInv[alchemyItemIdx] = { ...selectedAlchemyItem, quantity: selectedAlchemyItem.quantity - 1 }
                } else {
                  newInv[alchemyItemIdx] = null
                }
              }

              // Add coins to bank
              updateBankDirect({ coins: alchValue })
              updateInventory(newInv)
              addToast(`Alchemized ${alchItem.name} for ${alchValue.toLocaleString()} coins`, 'success')
            }
          } else if (action.product) {
            // Add product — goes to bank directly
            const qty = action.productQty || 1
            updateBankDirect({ [action.product]: qty })
          } else if (action.dropTable) {
            // Roll drops from drop table
            const bankUpdates = {}
            for (const drop of action.dropTable) {
              if (Math.random() < drop.chance) {
                const qty = Array.isArray(drop.quantity)
                  ? Math.floor(Math.random() * (drop.quantity[1] - drop.quantity[0] + 1)) + drop.quantity[0]
                  : drop.quantity
                bankUpdates[drop.itemId] = (bankUpdates[drop.itemId] || 0) + qty
              }
            }
            if (Object.keys(bankUpdates).length > 0) updateBankDirect(bankUpdates)
          }

          // Still update inventory if materials were consumed
          if (action.materials) updateInventory(newInv)

          // Grant XP
          grantXP(state.skill, ev.xp)
        }
      }

      setSkilling({ ...skillingRef.current })
    })

    return unsub
  }, [skilling?.active, stats, inventory, bank])

  const startSkilling = (action) => {
    // For High Alchemy, show item picker first
    if (action.type === 'alchemy') {
      setSelectedAction(action)
      setShowAlchemyPicker(true)
      return
    }

    const mult = getToolSpeedMultiplier(selectedSkill, equipment, itemsData, stats, inventory)
    const effectiveTicks = Math.max(1, Math.floor(action.ticks * mult))
    const adjustedAction = mult < 1.0 ? { ...action, ticks: effectiveTicks } : action
    const state = { ...createSkillingState(selectedSkill, adjustedAction), startedAt: Date.now() }
    setSelectedAction(action)
    setSkilling(state)
    // Store original action in task — idle engine will apply tool multiplier separately
    setActiveTask({ type: 'skill', skill: selectedSkill, action, bankingEnabled: skillingBankingEnabled })
  }

  const startAlchemy = (item) => {
    if (!selectedAction) return
    setShowAlchemyPicker(false)
    setSelectedAlchemyItem(item)

    const mult = getToolSpeedMultiplier(selectedSkill, equipment, itemsData, stats, inventory)
    const effectiveTicks = Math.max(1, Math.floor(selectedAction.ticks * mult))
    const adjustedAction = mult < 1.0 ? { ...selectedAction, ticks: effectiveTicks } : selectedAction
    const state = { ...createSkillingState(selectedSkill, adjustedAction), startedAt: Date.now() }
    setSkilling(state)
    // Store original action in task — idle engine will apply tool multiplier separately
    setActiveTask({ type: 'skill', skill: selectedSkill, action: selectedAction, bankingEnabled: skillingBankingEnabled })
  }

  const stopSkilling = () => {
    if (skillingRef.current) {
      skillingRef.current = { ...skillingRef.current, active: false, stopped: true }
    }
    setSkilling(null)
    setSelectedAction(null)
    setActiveTask(null)
  }

  // Auto-start from home shortcut
  useEffect(() => {
    if (initialSkillId && initialActionId && !hasAutoStarted.current) {
      hasAutoStarted.current = true
      const skill = skillsData[initialSkillId]
      if (skill) {
        const action = skill.actions.find(a => a.id === initialActionId)
        if (action) {
          setSelectedSkill(initialSkillId)
          const mult = getToolSpeedMultiplier(initialSkillId, equipment, itemsData, stats, inventory)
          const effectiveTicks = Math.max(1, Math.floor(action.ticks * mult))
          const adjustedAction = mult < 1.0 ? { ...action, ticks: effectiveTicks } : action
          const state = { ...createSkillingState(initialSkillId, adjustedAction), startedAt: Date.now() }
          // Seed totals from idle result so the modal reflects what was gained while away
          if (idleResult?.task?.type === 'skill' && idleResult.task.skill === initialSkillId) {
            state.totalActions = idleResult.actions || 0
            state.totalXP = (idleResult.xpGained?.[initialSkillId] || 0)
          }
          setSelectedAction(adjustedAction)
          setSkilling(state)
          // Store original action in task — idle engine will apply tool multiplier separately
          setActiveTask({ type: 'skill', skill: initialSkillId, action })
        }
      }
    }
  }, [initialSkillId, initialActionId])

  const handleAddToHome = (skill, action) => {
    const shortcut = {
      label: action.name,
      icon: SKILL_ICONS[skill] || '🔨',
      screen: SCREENS.SKILLS,
      skillId: skill,
      actionId: action.id
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
    addToast(`${shortcut.icon} ${action.name} added to Home!`, 'info')
  }

  // Skill picker
  if (!selectedSkill) {
    return (
      <div class="h-full overflow-y-auto p-4">
        <h2 class="font-[var(--font-display)] text-sm font-bold text-[var(--color-parchment)] opacity-60 uppercase tracking-wider mb-3">
          Train a Skill
        </h2>
        <div class="grid grid-cols-2 gap-2">
          {allSkillsInTab.map(skill => {
            const data = stats[skill] || { xp: 0, level: 1 }
            const level = data.level || getLevelFromXP(data.xp)
            const needsTool = ['mining', 'woodcutting', 'fishing'].includes(skill)
            const hasTool = !needsTool || hasToolForSkill(skill, equipment, inventory, itemsData, stats)
            const isClickable = hasTool
            return (
              <button
                key={skill}
                onClick={() => isClickable && setSelectedSkill(skill)}
                disabled={!isClickable}
                class={`flex items-center gap-2.5 p-3 rounded-xl border transition-colors ${
                  isClickable
                    ? 'bg-[#1a1a1a] border-[#2a2a2a] active:bg-[#222]'
                    : 'bg-[#111] border-[#1a1a1a] opacity-40'
                }`}
              >
                <span class="text-xl">{SKILL_ICONS[skill]}</span>
                <div class="text-left">
                  <div class="text-sm font-semibold text-[var(--color-parchment)] capitalize">{skill}</div>
                  <div class="text-[10px] font-[var(--font-mono)] text-[var(--color-gold)]">Lv {level}</div>
                  {needsTool && !hasTool && (
                    <div class="text-[9px] text-[#ff6b6b]">No tool available</div>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // Action picker (no active skilling)
  const skillData = skillsData[selectedSkill]
  const skillXP = stats[selectedSkill]?.xp || 0
  const skillLevel = getLevelFromXP(skillXP)
  const actions = skillData ? getAvailableActions(skillData.actions, skillXP) : []
  const allActions = [...(skillData?.actions || [])].sort((a, b) => a.level - b.level)
  const toolMult = getToolSpeedMultiplier(selectedSkill, equipment, itemsData, stats, inventory)

  if (!skilling) {
    return (
      <div class="h-full overflow-y-auto p-4">
        <button onClick={() => setSelectedSkill(null)}
          class="text-xs text-[var(--color-gold-dim)] mb-3 flex items-center gap-1">
          ← Back
        </button>

        <h2 class="font-[var(--font-display)] text-base font-bold text-[var(--color-gold)] mb-1 capitalize">
          {SKILL_ICONS[selectedSkill]} {selectedSkill}
        </h2>
        <p class="text-xs text-[var(--color-parchment)] opacity-40 mb-3">Level {skillLevel}</p>

        {/* Banking toggle for skilling */}
        <div class="flex items-center gap-2 mb-3 p-2 rounded-lg bg-[#111]">
          <input
            type="checkbox"
            id="skill-banking-picker"
            checked={skillingBankingEnabled}
            onChange={(e) => setSkillingBankingEnabled(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          <label htmlFor="skill-banking-picker" style={{ fontSize: '12px', color: '#e8d5b0', opacity: 0.7, cursor: 'pointer' }}>
            Auto-bank items
          </label>
        </div>

        <div class="space-y-2">
          {allActions.map(action => {
            const available = action.level <= skillLevel
            const hasMats = !action.materials || Object.entries(action.materials).every(
              ([id, qty]) => (countItem(inventory, id) + (bank[id]?.quantity || 0)) >= qty
            )
            const hasRunes = hasRequiredRunes(action.runeReq, inventory, bank, equipment, itemsData)
            const needsTool = ['mining', 'woodcutting', 'fishing'].includes(selectedSkill)
            const hasTool = !needsTool || hasToolForSkill(selectedSkill, equipment, inventory, itemsData, stats)
            const hasItems = !action.itemReq || action.itemReq.some(
              id => (countItem(inventory, id) + (bank[id]?.quantity || 0)) > 0
            )
            const canStart = available && hasMats && hasRunes && hasTool && hasItems
            return (
              <div key={action.id} class="flex gap-2 items-stretch">
                <button
                  onClick={() => canStart && startSkilling(action)}
                  disabled={!canStart}
                  class={`flex-1 flex items-center justify-between p-3 rounded-xl border transition-colors
                    ${canStart
                      ? 'bg-[#1a1a1a] border-[#2a2a2a] active:bg-[#222]'
                      : 'bg-[#111] border-[#1a1a1a] opacity-40'}`}
                >
                  <div class="text-left">
                    <div class="text-sm font-semibold text-[var(--color-parchment)]">{action.name}</div>
                    <div class="text-[10px] text-[var(--color-parchment)] opacity-40">
                      Lv {action.level} · {action.xp} XP · {toolMult < 1.0
                        ? <><span class="line-through">{(action.ticks * 0.6).toFixed(1)}s</span> <span class="text-[var(--color-gold)] opacity-100">{(Math.max(1, Math.floor(action.ticks * toolMult)) * 0.6).toFixed(1)}s</span></>
                        : `${(action.ticks * 0.6).toFixed(1)}s`}
                      {action.materials && (
                        <span> · Needs: {Object.entries(action.materials).map(([id, qty]) => `${itemsData[id]?.name || id} ×${qty}`).join(', ')}</span>
                      )}
                      {action.runeReq && (
                        <span> · Runes: {Object.entries(action.runeReq).map(([id, qty]) => `${itemsData[id]?.name || id} ×${qty}`).join(', ')}</span>
                      )}
                      {needsTool && !hasTool && (
                        <span class="block text-[#ff6b6b] mt-1">
                          {selectedSkill === 'mining' ? '⚒️ No pickaxe' : selectedSkill === 'woodcutting' ? '🪓 No axe' : '🎣 No rod'}
                        </span>
                      )}
                      {action.itemReq && !hasItems && (
                        <span class="block text-[#ff6b6b] mt-1">
                          ✨ Needs: {action.itemReq.map(id => itemsData[id]?.name || id).join(' or ')}
                        </span>
                      )}
                      {action.runeReq && !hasRunes && (
                        <span class="block text-[#ff6b6b] mt-1">
                          🔮 Missing runes (or equip staff)
                        </span>
                      )}
                    </div>
                  </div>
                  {action.product && (
                    <span class="text-[10px] text-[var(--color-gold-dim)]">→ {itemsData[action.product]?.name || action.product}</span>
                  )}
                  {action.dropTable && (
                    <div class="text-right flex flex-col gap-0.5">
                      {action.dropTable.map(drop => (
                        <div key={drop.itemId} class="text-[9px] text-[var(--color-gold-dim)]">
                          {Math.round(drop.chance * 100)}% {itemsData[drop.itemId]?.name || drop.itemId}
                        </div>
                      ))}
                    </div>
                  )}
                </button>
                <button
                  onClick={() => handleAddToHome(selectedSkill, action)}
                  class="px-3 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] active:bg-[#222] transition-colors flex flex-col items-center justify-center gap-0.5"
                  title="Add to Home Screen"
                >
                  <span class="text-base">🏠</span>
                  <span class="text-[8px] text-[var(--color-parchment)] opacity-50">Add</span>
                </button>
              </div>
            )
          })}
        </div>

        {/* High Alchemy item picker modal */}
        {showAlchemyPicker && selectedAction && (
          <Modal onClose={() => { setShowAlchemyPicker(false); setSelectedAction(null); }}>
            <div class="flex items-center justify-between mb-3">
              <h3 class="font-[var(--font-display)] text-base font-bold text-[var(--color-gold)]">Select item to Alchemize</h3>
              <button
                onClick={() => { setShowAlchemyPicker(false); setSelectedAction(null); }}
                class="w-6 h-6 flex items-center justify-center rounded-lg bg-[#222] text-[var(--color-parchment)] hover:bg-[#333] active:bg-[#444] transition-colors"
                title="Close"
              >
                ✕
              </button>
            </div>

            <div class="text-[10px] text-[var(--color-parchment)] opacity-60 mb-3">
              Shop value &lt; 100k: ×1.5 | Shop value ≥ 100k: ×1.1
            </div>

            <div class="space-y-2 max-h-96 overflow-y-auto">
              {inventory.map((slot, idx) => {
                if (!slot) return null
                const item = itemsData[slot.itemId]
                if (!item || item.stackable === false && slot.quantity > 1) {
                  // Skip if not stackable but quantity > 1 (only show first instance)
                  return null
                }
                const alchValue = item.shopValue >= 100000
                  ? Math.floor(item.shopValue * 1.1)
                  : Math.floor(item.shopValue * 1.5)
                return (
                  <button
                    key={`${idx}-${slot.itemId}`}
                    onClick={() => startAlchemy(slot)}
                    class="w-full p-3 rounded-lg border bg-[#1a1a1a] border-[#2a4a2a] active:bg-[#2a3a2a] transition-colors text-left"
                  >
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-2 flex-1">
                        <span class="text-lg">{item.icon}</span>
                        <div>
                          <div class="text-sm font-semibold text-[var(--color-parchment)]">{item.name}</div>
                          <div class="text-[10px] text-[var(--color-parchment)] opacity-60">
                            Shop: {item.shopValue.toLocaleString()}gp
                          </div>
                        </div>
                      </div>
                      <div class="text-right">
                        <div class="text-sm font-semibold text-[var(--color-gold)]">{alchValue.toLocaleString()}</div>
                        <div class="text-[10px] text-[var(--color-parchment)] opacity-60">coins</div>
                      </div>
                    </div>
                  </button>
                )
              })}
              {inventory.every(s => !s) && (
                <div class="text-center py-4 text-[var(--color-parchment)] opacity-50">
                  No items in inventory
                </div>
              )}
            </div>
          </Modal>
        )}
      </div>
    )
  }

  // Active skilling modal
  const activeMult = getToolSpeedMultiplier(selectedSkill, equipment, itemsData, stats, inventory)
  const progress = skilling.active
    ? 1 - (skilling.ticksRemaining / skilling.action.ticks)
    : 0

  return (
    <div class="h-full flex flex-col p-4">
      <div class="flex-1 flex flex-col items-center justify-center">
        <span class="text-4xl mb-2">{SKILL_ICONS[selectedSkill]}</span>
        <h2 class="font-[var(--font-display)] text-lg font-bold text-[var(--color-gold)] mb-1">
          {skilling.action.name}
        </h2>

        {/* Progress bar */}
        <div class="w-full max-w-xs mb-4">
          <ProgressBar value={progress} max={1} height="h-4" color="var(--color-gold)" showText />
        </div>

        {/* Stats */}
        <div class="bg-[#111] rounded-lg p-3 w-full max-w-xs space-y-1.5">
          <div class="flex justify-between text-sm">
            <span class="text-[var(--color-parchment)] opacity-60">Actions completed</span>
            <span class="font-[var(--font-mono)] text-[var(--color-gold)]">{skilling.totalActions}</span>
          </div>
          <div class="flex justify-between text-sm">
            <span class="text-[var(--color-parchment)] opacity-60">Actions/hr</span>
            <span class="font-[var(--font-mono)] text-[var(--color-gold)]">
              {skilling.startedAt && (Date.now() - skilling.startedAt) > 5000
                ? Math.round(skilling.totalActions / ((Date.now() - skilling.startedAt) / 3600000)).toLocaleString()
                : '—'}
            </span>
          </div>
          <div class="flex justify-between text-sm">
            <span class="text-[var(--color-parchment)] opacity-60">XP gained</span>
            <span class="font-[var(--font-mono)] text-[var(--color-gold)]">{formatNumber(skilling.totalXP)}</span>
          </div>
          <div class="flex justify-between text-sm">
            <span class="text-[var(--color-parchment)] opacity-60">XP/hr</span>
            <span class="font-[var(--font-mono)] text-[var(--color-gold)]">
              {skilling.startedAt && (Date.now() - skilling.startedAt) > 5000
                ? formatNumber(Math.round(skilling.totalXP / ((Date.now() - skilling.startedAt) / 3600000)))
                : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Banking toggle & note */}
      <div class="flex-shrink-0 mt-4 space-y-2">
        <div class="flex items-center gap-2">
          <input
            type="checkbox"
            id="skill-banking"
            checked={skillingBankingEnabled}
            onChange={(e) => {
              setSkillingBankingEnabled(e.target.checked)
              if (activeTask) setActiveTask({ ...activeTask, bankingEnabled: e.target.checked })
            }}
            style={{ cursor: 'pointer' }}
          />
          <label htmlFor="skill-banking" style={{ fontSize: '12px', color: '#e8d5b0', opacity: 0.7, cursor: 'pointer' }}>
            Auto-bank items (may reduce XP/hr)
          </label>
        </div>
        {skillingBankingEnabled && (
          <div style={{ fontSize: '11px', color: '#e8d5b0', opacity: 0.5 }}>
            ⏳ Items go to inventory first. Auto-banks when full. Banking delay scales with Agility level.
          </div>
        )}
      </div>

      {/* Stop & Back / Skip 1h */}
      <div class="flex-shrink-0 flex gap-2 mt-3">
        <button onClick={stopSkilling}
          class="flex-1 py-2.5 rounded-lg bg-[#222] text-[var(--color-parchment)] font-semibold text-sm active:opacity-80">
          ← Stop &amp; Back
        </button>
        {skipHourUnlocked && (
          <button onClick={onSkipHour}
            class="flex-1 py-2.5 rounded-lg font-semibold text-sm active:opacity-80"
            style="background:linear-gradient(135deg,#1a3a2a,#2a5a3a);border:1px solid rgba(100,200,120,0.35);color:#7de8a0">
            ⏭️ Skip 1h
          </button>
        )}
      </div>
    </div>
  )
}
