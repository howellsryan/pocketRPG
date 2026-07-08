import { useState, useEffect, useRef } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import Modal from '../components/Modal.jsx'
import GameIcon from '../components/GameIcon.jsx'
import SkillIcon from '../components/SkillIcon.jsx'
import SkillScreenHeader from '../components/SkillScreenHeader.jsx'
import SkillInfoBanner from '../components/SkillInfoBanner.jsx'
import SkillActionRow from '../components/SkillActionRow.jsx'
import SkillActivePanel from '../components/SkillActivePanel.jsx'
import { getAgilityBankDelayMs, formatBankDelay } from '../engine/agility.js'
import { emptySession, ratePerHour } from '../engine/activitySession.js'
import { getActionProgress } from '../hooks/useActionTick.js'
import { STUB_SKILLS, GATHERING_SKILLS, PRODUCTION_SKILLS, UTILITY_SKILLS, SCREENS, formatDropChance, GATHER_AUTOBANK_CONSTRUCTION_LEVEL } from '../utils/constants.js'
import { getLevelFromXP } from '../engine/experience.js'
import { createSkillingState, processSkillingTick, getAvailableActions, checkBurn, getEffectiveToolActionTicks, hasToolForSkill, getEquippedSkillXpMultiplier, rollGatherBonusDrops, TOOL_SKILLS } from '../engine/skilling.js'
import { addItem, removeItem, countItem, canFit } from '../engine/inventory.js'
import { hasRequiredRunes, getRunesToConsume } from '../engine/runes.js'
import { onTick } from '../engine/tick.js'
import { markScreenTick } from '../engine/activityRunner.js'
import { formatNumber } from '../utils/helpers.js'
import { getHighAlchValue } from '../utils/itemValue.js'
import { formatActionDuration } from '../utils/formatters.js'
import { calculateDungeoneeringTokensForAction, getDungeoneeringRewardCost, canAffordDungeoneeringReward } from '../engine/dungeoneeringTokens.js'
import { api, getToken, getCharacterId } from '../cloud/api.js'
import { applyCloudSave } from '../cloud/sync.js'
import skillsData from '../data/skills.json'
import itemsData from '../data/items.json'
import AgilityScreen from './AgilityScreen.jsx'
import SlayerScreen from './SlayerScreen.jsx'
import ThievingScreen from './ThievingScreen.jsx'
import HunterScreen from './HunterScreen.jsx'
import FarmingScreen from './FarmingScreen.jsx'
import ConstructionScreen from './ConstructionScreen.jsx'
import MagicScreen from './MagicScreen.jsx'
import { recordCollectionLogDrop } from '../cloud/collectionLog.js'

// Farming, Agility, Prayer, Thieving, Hunter, Slayer, Construction, and Dungeoneering are special
// skills shown here in the Skills tab.
const SPECIAL_SKILLS = ['farming', 'agility', 'prayer', 'thieving', 'hunter', 'slayer', 'construction', 'dungeoneering', 'magic']
// Skills this screen delegates to a dedicated sub-screen — those screens own
// their own resume-from-background logic, so the generic resume path skips them.
const DELEGATED_SKILLS = new Set(['agility', 'slayer', 'thieving', 'hunter', 'farming', 'construction', 'magic'])
const trainableSkills = [...GATHERING_SKILLS, ...PRODUCTION_SKILLS].filter(s => !STUB_SKILLS.has(s) && skillsData[s]?.actions?.length > 0)
const allSkillsInTab = [...trainableSkills, ...SPECIAL_SKILLS]

// Calculate remaining actions based on available materials
function calculateRemainingActions(action, inventory, bank) {
  if (!action.materials) return null
  let minAvailable = Infinity
  for (const [matId, qtyNeeded] of Object.entries(action.materials)) {
    const invCount = countItem(inventory, matId)
    const bankCount = bank[matId]?.quantity || 0
    const available = Math.floor((invCount + bankCount) / qtyNeeded)
    minAvailable = Math.min(minAvailable, available)
  }
  return minAvailable === Infinity ? null : minAvailable
}

export default function SkillingScreen({ initialSkillId, initialActionId, idleResult, onNavigate }) {
  const { stats, inventory, bank, equipment, isIronman, updateInventory, updateBankDirect, grantXP, addToast, setActiveTask, activeTask, dungeoneeringTokens, awardDungeoneeringTokens, trySpendDungeoneeringTokens, loadGame, recordGameEvent } = useGame()
  const [selectedSkill, setSelectedSkill] = useState(initialSkillId || null)
  const [selectedAction, setSelectedAction] = useState(null)
  const [skilling, setSkilling] = useState(null)
  const [selectedAlchemyItem, setSelectedAlchemyItem] = useState(null) // Track selected item for High Alchemy
  const [showAlchemyPicker, setShowAlchemyPicker] = useState(false) // Show item picker for alchemy
  const skillingRef = useRef(null)
  const hasAutoStarted = useRef(false)
  const inventoryRef = useRef(inventory)
  const bankRef = useRef(bank)

  // Keep refs in sync with React state
  useEffect(() => { inventoryRef.current = inventory }, [inventory])
  useEffect(() => { bankRef.current = bank }, [bank])

  // If agility is selected, delegate to AgilityScreen (special screen for agility only)
  if (selectedSkill === 'agility') {
    return (
      <AgilityScreen
        initialActionId={initialActionId}
        idleResult={idleResult}
        onBack={() => setSelectedSkill(null)}
      />
    )
  }

  // If slayer is selected, delegate to SlayerScreen
  if (selectedSkill === 'slayer') {
    return (
      <SlayerScreen
        onBack={() => setSelectedSkill(null)}
        onNavigate={onNavigate}
      />
    )
  }

  // If thieving is selected, delegate to ThievingScreen
  if (selectedSkill === 'thieving') {
    return (
      <ThievingScreen
        initialNpcId={initialActionId}
        idleResult={idleResult}
        onBack={() => setSelectedSkill(null)}
      />
    )
  }

  // If hunter is selected, delegate to HunterScreen
  if (selectedSkill === 'hunter') {
    return (
      <HunterScreen
        initialActionId={initialActionId}
        idleResult={idleResult}
        onBack={() => setSelectedSkill(null)}
      />
    )
  }

  // If farming is selected, delegate to FarmingScreen
  if (selectedSkill === 'farming') {
    return (
      <FarmingScreen
        onBack={() => setSelectedSkill(null)}
      />
    )
  }

  // If construction is selected, delegate to ConstructionScreen
  if (selectedSkill === 'construction') {
    return (
      <ConstructionScreen
        onBack={() => setSelectedSkill(null)}
      />
    )
  }

  // If magic is selected, delegate to MagicScreen
  if (selectedSkill === 'magic') {
    return (
      <MagicScreen
        onBack={() => setSelectedSkill(null)}
      />
    )
  }

  // Tick listener
  useEffect(() => {
    if (!skilling || !skilling.active) return
    skillingRef.current = skilling
    markScreenTick() // claim the task before the App-level runner's next tick

    const unsub = onTick(() => {
      const state = skillingRef.current
      if (!state || !state.active || state.stopped) return
      markScreenTick()

      const { skillingState, events } = processSkillingTick(state)
      skillingRef.current = skillingState

      for (const ev of events) {
        if (ev.type === 'actionComplete') {
          // Check materials and runes
          const action = ev.action
          const newInv = [...inventoryRef.current]

          // Gathering skills (mining/woodcutting/fishing) deposit into the
          // inventory. When full, stop unless the Construction unlock enables
          // bank trips. Returns false when gathering stopped (caller must bail).
          const isGatheringSkill = GATHERING_SKILLS.includes(state.skill)
          const bankWhenFull = getLevelFromXP(stats.construction?.xp || 0) >= GATHER_AUTOBANK_CONSTRUCTION_LEVEL
          const depositGathered = (inv, drops) => {
            if (!canFit(inv, drops, itemsData)) {
              if (bankWhenFull) {
                const bankUpdates = {}
                for (let i = 0; i < inv.length; i++) {
                  if (!inv[i]) continue
                  bankUpdates[inv[i].itemId] = (bankUpdates[inv[i].itemId] || 0) + inv[i].quantity
                  inv[i] = null
                }
                if (Object.keys(bankUpdates).length > 0) updateBankDirect(bankUpdates)
              } else {
                updateInventory(inv)
                skillingRef.current = { ...skillingState, active: false, stopped: true }
                setSkilling(null)
                setSelectedAction(null)
                setSelectedAlchemyItem(null)
                setActiveTask(null)
                addToast('Inventory full!', 'error')
                return false
              }
            }
            for (const [itemId, qty] of Object.entries(drops)) {
              addItem(inv, itemId, qty, itemsData[itemId]?.stackable || false)
            }
            return true
          }

          // Check and consume runes (for magic spells)
          if (action.runeReq) {
            if (!hasRequiredRunes(action.runeReq, newInv, bankRef.current, equipment, itemsData)) {
              skillingRef.current = { ...skillingState, active: false, stopped: true }
              setSkilling(null)
              setSelectedAction(null)
              setSelectedAlchemyItem(null)
              setActiveTask(null)
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

          let stopAfterCompletion = false
          if (action.materials) {
            let hasMats = true
            for (const [matId, qty] of Object.entries(action.materials)) {
              const invCount = countItem(newInv, matId)
              const bankCount = bankRef.current[matId]?.quantity || 0
              if (invCount + bankCount < qty) { hasMats = false; break }
            }
            if (!hasMats) {
              skillingRef.current = { ...skillingState, active: false, stopped: true }
              setSkilling(null)
              setSelectedAction(null)
              setSelectedAlchemyItem(null)
              setActiveTask(null)
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

            // After consuming, check if we can do ANOTHER action. Use the
            // post-consumption inventory/bank directly — newInv already
            // reflects this action's consumption, and bankUpdates holds this
            // tick's pending bank deltas, so there's no need to (and must
            // not) also subtract the cumulative consumedMaterials total on
            // top of that, which double-counts past consumption and stops
            // the action at roughly half the true available materials.
            let canContinue = true
            for (const [matId, qtyNeeded] of Object.entries(action.materials)) {
              const invCount = countItem(newInv, matId)
              const bankCount = (bankRef.current[matId]?.quantity || 0) + (bankUpdates[matId] || 0)
              if (invCount + bankCount < qtyNeeded) {
                canContinue = false
                break
              }
            }
            if (!canContinue) stopAfterCompletion = true
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
              const alchemyItemIdx = newInv.findIndex(slot =>
                slot?.itemId === selectedAlchemyItem.itemId &&
                !!slot?.noted === !!selectedAlchemyItem.noted &&
                (slot?.quantity || 0) > 0
              )
              if (alchemyItemIdx === -1) {
                skillingRef.current = { ...skillingState, active: false, stopped: true }
                setSkilling(null)
                setSelectedAction(null)
                setSelectedAlchemyItem(null)
                setActiveTask(null)
                addToast('Out of items to alchemize!', 'error')
                return
              }

              const alchValue = getHighAlchValue(alchItem, { isIronman })

              // Remove the alchemized item from inventory
              if (newInv[alchemyItemIdx].quantity > 1) {
                newInv[alchemyItemIdx] = { ...newInv[alchemyItemIdx], quantity: newInv[alchemyItemIdx].quantity - 1 }
              } else {
                newInv[alchemyItemIdx] = null
              }

              // Add coins to bank
              updateBankDirect({ coins: alchValue })
              updateInventory(newInv)
              addToast(`Alchemized ${alchItem.name} for ${alchValue.toLocaleString()} coins`, 'success')
            }
          } else if (action.product) {
            const qty = action.productQty || 1
            if (isGatheringSkill) {
              // Gathered resources fill the inventory; stop or bank-trip on full.
              const drops = { [action.product]: qty }
              const bonus = rollGatherBonusDrops(state.skill)
              for (const [itemId, bonusQty] of Object.entries(bonus)) {
                drops[itemId] = (drops[itemId] || 0) + bonusQty
              }
              if (!depositGathered(newInv, drops)) return
              updateInventory(newInv)
              recordGameEvent?.({ kind: 'skill_gather', skill: state.skill, itemId: action.product, count: qty })
            } else {
              // Production output goes to the bank directly.
              updateBankDirect({ [action.product]: qty })
              if (action.materials) updateInventory(newInv)
              recordGameEvent?.({ kind: 'skill_produce', skill: state.skill, itemId: action.product, count: qty })
            }
          } else if (action.dropTable) {
            // Roll drops from drop table
            const drops = {}
            for (const drop of action.dropTable) {
              if (Math.random() < drop.chance) {
                const qty = Array.isArray(drop.quantity)
                  ? Math.floor(Math.random() * (drop.quantity[1] - drop.quantity[0] + 1)) + drop.quantity[0]
                  : drop.quantity
                drops[drop.itemId] = (drops[drop.itemId] || 0) + qty
              }
            }
            if (isGatheringSkill) {
              if (Object.keys(drops).length > 0) {
                if (!depositGathered(newInv, drops)) return
              }
              updateInventory(newInv)
            } else {
              if (Object.keys(drops).length > 0) updateBankDirect(drops)
              if (action.materials) updateInventory(newInv)
            }
          } else if (action.materials) {
            // Still update inventory if materials were consumed
            updateInventory(newInv)
          }

          // Grant XP
          const xpMultiplier = getEquippedSkillXpMultiplier(state.skill, equipment, itemsData)
          const multipliedXP = Math.floor(ev.xp * xpMultiplier)
          grantXP(state.skill, multipliedXP)
          // Keep totalXP display in sync — processSkillingTick added base ev.xp; correct to multiplied value
          if (xpMultiplier !== 1) {
            skillingRef.current = { ...skillingRef.current, totalXP: skillingRef.current.totalXP - ev.xp + multipliedXP }
          }
          if (state.skill === 'dungeoneering' && action.category !== 'reward') {
            const tokenReward = calculateDungeoneeringTokensForAction(action)
            if (tokenReward > 0) {
              awardDungeoneeringTokens(tokenReward)
              skillingState.totalDungeoneeringTokens = (skillingState.totalDungeoneeringTokens || 0) + tokenReward
            }
          }

          if (stopAfterCompletion) {
            skillingRef.current = { ...skillingRef.current, active: false, stopped: true }
            setSkilling(null)
            setSelectedAction(null)
            setSelectedAlchemyItem(null)
            setActiveTask(null)
            addToast('Out of materials!', 'error')
            return
          }
        }
      }

      setSkilling({ ...skillingRef.current })
      if (skillingRef.current?.active) mirrorActiveTask(skillingRef.current)
    })

    return unsub
  }, [skilling?.active, stats, inventory, bank])

  // Keep long-form reward progress in sync with global task progress so idle
  // simulation and skip-hour updates immediately reflect in this progress bar.
  useEffect(() => {
    if (!skilling?.active || skilling.action?.category !== 'reward') return
    if (activeTask?.type !== 'skill' || activeTask.skill !== selectedSkill) return
    if (activeTask.action?.id !== skilling.action?.id) return
    if (typeof activeTask.ticksRemaining !== 'number') return
    if (activeTask.ticksRemaining === skilling.ticksRemaining) return

    setSkilling((prev) => {
      if (!prev?.active || prev.action?.id !== skilling.action?.id) return prev
      const next = { ...prev, ticksRemaining: activeTask.ticksRemaining }
      skillingRef.current = next
      return next
    })
  }, [activeTask, selectedSkill, skilling])

  const startSkilling = async (action) => {
    // Re-opening the action that's already running in the background: resume the
    // live panel from the persisted session rather than restarting it.
    if (resumeActiveAction(action)) return
    if (selectedSkill === 'dungeoneering' && action.category === 'reward') {
      const currentLevel = getLevelFromXP(stats.dungeoneering?.xp || 0)
      if (currentLevel < (action.level || 1)) return addToast(`Requires Dungeoneering level ${action.level}.`, 'error')
      const cost = getDungeoneeringRewardCost(action)
      if (cost <= 0) return addToast('Invalid token cost for this reward.', 'error')
      const productItem = itemsData[action.product]
      if (!productItem) return addToast('This reward item is unavailable.', 'error')
      if (getToken() && getCharacterId()) {
        try {
          const res = await api.completeDungeoneering('dungeoneering', { actionNonce: `dng:${action.id}:${Date.now()}`, rewards: [{ itemId: action.product, quantity: action.productQty || 1 }], dungeoneeringTokens: -cost })
          if (res?.save?.save_data) {
            const cloudSave = JSON.parse(res.save.save_data)
            await applyCloudSave(cloudSave, res.save.updatedAt, res.save.save_revision)
            await loadGame()

            // Keep token display in sync immediately after purchase.
            const serverTokens = Number(cloudSave?.settings?.dungeoneeringTokens ?? cloudSave?.dungeoneeringTokens)
            if (Number.isFinite(serverTokens)) {
              const delta = Math.floor(serverTokens) - (Number(dungeoneeringTokens) || 0)
              if (delta > 0) awardDungeoneeringTokens(delta)
              else if (delta < 0) trySpendDungeoneeringTokens(Math.abs(delta))
            }

            // Keep inventory UI in sync immediately after server grant.
            if (Array.isArray(cloudSave?.inventory)) {
              const compact = cloudSave.inventory
                .map((slot) => {
                  if (!slot || typeof slot !== 'object') return null
                  const itemId = slot.itemId || slot.id
                  const quantity = Math.floor(Number(slot.quantity) || 0)
                  if (!itemId || quantity < 1) return null
                  return { ...slot, itemId, quantity }
                })
                .filter(Boolean)
              const nextInv = Array(28).fill(null)
              for (let i = 0; i < compact.length && i < 28; i++) nextInv[i] = compact[i]
              updateInventory(nextInv)
            }
          }
          recordCollectionLogDrop({ itemId: action.product, sourceType: 'skilling', sourceId: 'dungeoneering' })
          addToast(`Purchased ${productItem.name} for ${formatNumber(cost)} tokens.`, 'success')
          return
        } catch (e) {
          addToast(`Reward claim failed: ${e?.message || 'server_error'}`, 'error')
          return
        }
      }
      if (!trySpendDungeoneeringTokens(cost)) return addToast(`Need ${formatNumber(cost)} Dungeoneering tokens.`, 'error')
      updateBankDirect({ [action.product]: action.productQty || 1 })
      recordCollectionLogDrop({ itemId: action.product, sourceType: 'skilling', sourceId: 'dungeoneering' })
      addToast(`Purchased ${productItem.name} for ${formatNumber(cost)} tokens.`, 'success')
      return
    }
    // For High Alchemy, show item picker first
    if (action.type === 'alchemy') {
      setSelectedAction(action)
      setShowAlchemyPicker(true)
      return
    }

    const effectiveTicks = getEffectiveToolActionTicks(selectedSkill, action.ticks, equipment, itemsData, stats, inventory)
    const adjustedAction = effectiveTicks !== action.ticks
      ? { ...action, ticks: effectiveTicks }
      : action

    // Resume long-form reward actions where a previous session left off so the
    // in-screen progress bar reflects partial idle/skip progress.
    const isResumableReward = action.category === 'reward'
      && activeTask?.type === 'skill'
      && activeTask.skill === selectedSkill
      && activeTask.action?.id === action.id
      && typeof activeTask.ticksRemaining === 'number'
      && activeTask.ticksRemaining > 0
      && activeTask.ticksRemaining < action.ticks
    const state = { ...createSkillingState(selectedSkill, adjustedAction), startedAt: Date.now() }
    if (isResumableReward) state.ticksRemaining = activeTask.ticksRemaining
    setSelectedAction(action)
    setSkilling(state)
    // Store original action in task — idle engine will apply tool multiplier separately
    const newTask = { type: 'skill', skill: selectedSkill, action, bankingEnabled: true, session: emptySession(state.startedAt) }
    if (action.category === 'reward') {
      newTask.ticksRemaining = isResumableReward ? activeTask.ticksRemaining : action.ticks
    }
    setActiveTask(newTask)
  }

  // Rebuild the live skilling panel from a running background task (same skill +
  // action), seeding session totals and the current action's remaining ticks so
  // progress continues exactly where the background runner left it.
  const buildResumedState = (task, action, skill = selectedSkill) => {
    const effectiveTicks = getEffectiveToolActionTicks(skill, action.ticks, equipment, itemsData, stats, inventory)
    const adjustedAction = effectiveTicks !== action.ticks ? { ...action, ticks: effectiveTicks } : action
    const state = { ...createSkillingState(skill, adjustedAction), startedAt: task.session?.startedAt || Date.now() }
    state.totalActions = task.session?.actions || 0
    state.totalXP = task.session?.xp || 0
    state.totalDungeoneeringTokens = task.session?.tokens || 0
    if (typeof task.ticksRemaining === 'number' && task.ticksRemaining > 0 && task.ticksRemaining <= adjustedAction.ticks) {
      state.ticksRemaining = task.ticksRemaining
    }
    return state
  }

  const resumeActiveAction = (action) => {
    const t = activeTask
    if (!t || t.type !== 'skill' || t.skill !== selectedSkill) return false
    if (t.action?.id !== action.id || t.action?.category === 'reward') return false
    setSelectedAction(action)
    setSkilling(buildResumedState(t, action))
    return true
  }

  const startAlchemy = (item) => {
    if (!selectedAction) return
    setShowAlchemyPicker(false)
    setSelectedAlchemyItem(item)

    const effectiveTicks = getEffectiveToolActionTicks(selectedSkill, selectedAction.ticks, equipment, itemsData, stats, inventory)
    const adjustedAction = effectiveTicks !== selectedAction.ticks
      ? { ...selectedAction, ticks: effectiveTicks }
      : selectedAction
    const state = { ...createSkillingState(selectedSkill, adjustedAction), startedAt: Date.now() }
    setSkilling(state)
    // Store original action in task — idle engine will apply tool multiplier separately
    setActiveTask({ type: 'skill', skill: selectedSkill, action: selectedAction, bankingEnabled: true, selectedAlchemyItem: item })
  }


  // When a skip completes while actively skilling, add the skipped XP and
  // actions to the running session totals so the progress display stays accurate.
  useEffect(() => {
    if (!skilling?.active) return
    if (!idleResult) return
    if (idleResult.task?.type !== 'skill') return
    if (idleResult.task?.skill !== selectedSkill) return
    if (idleResult.rewardCompleted) return
    const xpGained = idleResult.xpGained?.[selectedSkill] || 0
    const actionsGained = idleResult.actions || 0
    const tokensGained = idleResult.dungeoneeringTokensGained || 0
    const elapsedMs = idleResult.elapsedMs || 0
    if (xpGained === 0 && actionsGained === 0 && tokensGained === 0) return
    setSkilling((prev) => {
      if (!prev?.active) return prev
      const next = {
        ...prev,
        totalXP: (prev.totalXP || 0) + xpGained,
        totalActions: (prev.totalActions || 0) + actionsGained,
        totalDungeoneeringTokens: (prev.totalDungeoneeringTokens || 0) + tokensGained,
        startedAt: (prev.startedAt || Date.now()) - elapsedMs,
      }
      skillingRef.current = next
      return next
    })
  }, [idleResult, selectedSkill])

  // If an idle/skip simulation completed a long-form unlock while this screen
  // was open, close the active skilling modal so the player returns to the
  // dungeoneering action list instead of staying on a stale ~90% bar.
  useEffect(() => {
    if (!idleResult?.rewardCompleted) return
    if (idleResult.task?.type !== 'skill') return
    if (!selectedSkill || idleResult.task.skill !== selectedSkill) return

    setSkilling((prev) => {
      if (!prev?.active) return prev
      if (prev.action?.category !== 'reward') return prev
      const finishedActionId = idleResult.task?.action?.id
      if (finishedActionId && prev.action?.id !== finishedActionId) return prev
      skillingRef.current = null
      return null
    })
    setSelectedAction(null)
    setSelectedAlchemyItem(null)
  }, [idleResult, selectedSkill])

  const stopSkilling = () => {
    if (skillingRef.current) {
      skillingRef.current = { ...skillingRef.current, active: false, stopped: true }
    }
    setSkilling(null)
    setSelectedAction(null)
    setSelectedAlchemyItem(null)
    setActiveTask(null)
  }

  // Mirror the live per-action progress + session tally onto the global task so
  // the top-nav indicator stays in sync and the session survives navigation.
  // The ORIGINAL action is stored (the idle engine reapplies the tool multiplier).
  const mirrorActiveTask = (state) => {
    if (!state || !selectedAction) return
    setActiveTask({
      type: 'skill',
      skill: selectedSkill,
      action: selectedAction,
      bankingEnabled: true,
      ...(selectedAlchemyItem ? { selectedAlchemyItem } : {}),
      totalTicks: state.action.ticks,
      ticksRemaining: state.ticksRemaining,
      session: {
        startedAt: state.startedAt,
        actions: state.totalActions || 0,
        xp: state.totalXP || 0,
        coins: 0, items: 0, seeds: 0,
        tokens: state.totalDungeoneeringTokens || 0,
      },
    }, { skipCloudSync: true })
  }

  // Back (does NOT stop): flush progress and return to the action list while the
  // task keeps running in the background. "Stop & Back" still cancels the task.
  const backToList = () => {
    if (skillingRef.current) mirrorActiveTask(skillingRef.current)
    skillingRef.current = null
    setSkilling(null)
    setSelectedAction(null)
    setSelectedAlchemyItem(null)
  }

  // Auto-start from home shortcut, or resume an in-progress background task when
  // the player navigates back into the Skills section.
  useEffect(() => {
    if (hasAutoStarted.current) return

    if (initialSkillId && initialActionId) {
      hasAutoStarted.current = true
      const skill = skillsData[initialSkillId]
      if (skill) {
        const action = skill.actions.find(a => a.id === initialActionId)
        if (action) {
          setSelectedSkill(initialSkillId)
          const effectiveTicks = getEffectiveToolActionTicks(initialSkillId, action.ticks, equipment, itemsData, stats, inventory)
          const adjustedAction = effectiveTicks !== action.ticks
            ? { ...action, ticks: effectiveTicks }
            : action
          const state = { ...createSkillingState(initialSkillId, adjustedAction), startedAt: Date.now() }
          // Seed totals from idle result so the modal reflects what was gained while away
          if (idleResult?.task?.type === 'skill' && idleResult.task.skill === initialSkillId) {
            state.totalActions = idleResult.actions || 0
            state.totalXP = (idleResult.xpGained?.[initialSkillId] || 0)
            if (initialSkillId === 'dungeoneering') state.totalDungeoneeringTokens = idleResult.dungeoneeringTokensGained || 0
          }
          setSelectedAction(action)
          setSkilling(state)
          // Store original action in task — idle engine will apply tool multiplier separately
          setActiveTask({ type: 'skill', skill: initialSkillId, action, session: emptySession(state.startedAt) })
        }
      }
      return
    }

    // Resume: a runnable skill task is already running (navigated away & back).
    // Delegated skills (agility/thieving/hunter/…) resume in their own screens,
    // so only rebuild the live panel for skills this screen drives directly.
    const t = activeTask
    if (selectedSkill || !t || t.type !== 'skill' || t.action?.category === 'reward') return
    if (DELEGATED_SKILLS.has(t.skill)) return
    const sdata = skillsData[t.skill]
    const action = sdata?.actions?.find(a => a.id === t.action?.id)
    if (!action) return
    hasAutoStarted.current = true
    setSelectedSkill(t.skill)
    setSelectedAction(action)
    // selectedSkill state isn't committed yet; build against the task's skill so
    // tool multipliers resolve correctly.
    setSkilling(buildResumedState(t, action, t.skill))
  }, [initialSkillId, initialActionId])


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
            return (
              <button
                key={skill}
                onClick={() => setSelectedSkill(skill)}
                class="flex items-center gap-2.5 p-3 rounded-xl border transition-colors bg-[#1a1a1a] border-[#2a2a2a] active:bg-[#222]"
              >
                <SkillIcon skill={skill} size={24} />
                <div class="text-left">
                  <div class="text-sm font-semibold text-[var(--color-parchment)] capitalize">{skill}</div>
                  <div class="text-[10px] font-[var(--font-mono)] text-[var(--color-gold)]">Lv {level}</div>
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
  const constructionLevel = getLevelFromXP(stats.construction?.xp || 0)
  const actions = skillData ? getAvailableActions(skillData.actions, skillXP) : []
  const allActions = [...(skillData?.actions || [])].sort((a, b) => a.level - b.level)

  if (!skilling) {
    return (
      <div class="h-full overflow-y-auto p-4">
        <SkillScreenHeader
          skill={selectedSkill}
          xp={skillXP}
          level={skillLevel}
          onBack={() => setSelectedSkill(null)}
          right={selectedSkill === 'dungeoneering' && (
            <div class="inline-flex rounded-full border border-[var(--color-void-border)] bg-[var(--color-void-light)] px-2.5 py-1 text-[11px] font-[var(--font-mono)] text-[var(--color-gold)]">
              {formatNumber(dungeoneeringTokens)} tokens
            </div>
          )}
        />

        {/* Banking toggle for skilling */}
        {(() => {
          const needsTool = TOOL_SKILLS.includes(selectedSkill)
          const hasTool = !needsTool || hasToolForSkill(selectedSkill, equipment, inventory, itemsData, stats)
          const toolHint = needsTool && !hasTool ? (
            <SkillInfoBanner
              className="mb-4"
              icon={<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M12 3l9 16H3l9-16z" fill="none" stroke="var(--color-gold)" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 10v4" stroke="var(--color-gold)" stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="16.4" r="1" fill="var(--color-gold)"/></svg>}
            >
              {selectedSkill === 'mining'
                ? 'No pickaxe — mining bare-handed is slower. Equip or carry a pickaxe to mine faster.'
                : selectedSkill === 'woodcutting'
                  ? 'No axe — chopping bare-handed is slower. Equip or carry an axe to chop faster.'
                  : 'No fishing tool — fishing bare-handed is slower. Equip or carry a net, rod, or cage to fish faster.'}
            </SkillInfoBanner>
          ) : null
          const renderActionRow = (action) => {
            const requiresGildedAltarConstruction = selectedSkill === 'prayer' && action.id?.startsWith('altar_')
            const meetsGildedAltarConstruction = !requiresGildedAltarConstruction || constructionLevel >= 75
            const available = action.level <= skillLevel && meetsGildedAltarConstruction
            const hasMats = !action.materials || Object.entries(action.materials).every(
              ([id, qty]) => (countItem(inventory, id) + (bank[id]?.quantity || 0)) >= qty
            )
            const hasRunes = hasRequiredRunes(action.runeReq, inventory, bank, equipment, itemsData)
            const hasItems = !action.itemReq || action.itemReq.some(
              id => (countItem(inventory, id) + (bank[id]?.quantity || 0)) > 0
            )
            const canStart = available && hasMats && hasRunes && hasItems
            const isDungeoneeringReward = selectedSkill === 'dungeoneering' && action.category === 'reward'
            const rewardCost = isDungeoneeringReward ? getDungeoneeringRewardCost(action) : 0
            const rowEnabled = isDungeoneeringReward
              ? canAffordDungeoneeringReward(action, dungeoneeringTokens, skillLevel) && !!itemsData[action.product]
              : canStart
            const effectiveTicks = getEffectiveToolActionTicks(
              selectedSkill,
              action.ticks,
              equipment,
              itemsData,
              stats,
              inventory,
            )
            const xpMultiplier = getEquippedSkillXpMultiplier(selectedSkill, equipment, itemsData)
            const displayXP = xpMultiplier !== 1 ? Math.floor(action.xp * xpMultiplier) : action.xp
            const productItem = action.product ? itemsData[action.product] : null
            // Locked = the level/construction gate isn't met. Disabled = gated by
            // missing materials/runes/items/tokens (the row still explains why).
            const levelLocked = action.level > skillLevel
            const remaining = calculateRemainingActions(action, inventory, bank)
            const meta = isDungeoneeringReward
              ? <><span class="text-[var(--color-gold)] font-bold opacity-100">Lv {action.level}</span> · Cost: {formatNumber(rewardCost)} tokens
                  {rowEnabled === false && skillLevel >= action.level && <span class="block text-[var(--color-blood-ember)] mt-1">Need {formatNumber(rewardCost)} tokens</span>}
                </>
              : <>
                  <span class="text-[var(--color-gold)] font-bold opacity-100">Lv {action.level}</span> · {displayXP} XP{xpMultiplier !== 1 && <span class="text-[var(--color-gold)] opacity-100"> (+{Math.round((xpMultiplier - 1) * 100)}%)</span>} · {effectiveTicks < action.ticks
                    ? <><span class="line-through">{formatActionDuration(action.ticks)}</span> <span class="text-[var(--color-gold)] opacity-100">{formatActionDuration(effectiveTicks)}</span></>
                    : effectiveTicks > action.ticks
                    ? <span class="text-[var(--color-blood-ember)]">{formatActionDuration(effectiveTicks)}</span>
                    : formatActionDuration(action.ticks)}
                  {remaining !== null && <span class="text-[var(--color-gold)]"> · {remaining.toLocaleString()} actions</span>}
                  {action.runeReq && <span> · Runes: {Object.entries(action.runeReq).map(([id, qty]) => `${itemsData[id]?.name || id} ×${qty}`).join(', ')}</span>}
                  {action.itemReq && !hasItems && <span class="block text-[var(--color-blood-ember)] mt-1">✨ Needs: {action.itemReq.map(id => itemsData[id]?.name || id).join(' or ')}</span>}
                  {action.runeReq && !hasRunes && <span class="block text-[var(--color-blood-ember)] mt-1">🔮 Missing runes (or equip staff)</span>}
                  {requiresGildedAltarConstruction && !meetsGildedAltarConstruction && <span class="block text-[var(--color-blood-ember)] mt-1">🏠 Requires Construction level 75</span>}
                </>
            const dropRight = action.dropTable && (
              <div class="text-right flex flex-col gap-0.5 flex-shrink-0">
                {action.dropTable.map(drop => (
                  <div key={drop.itemId} class="text-[9px] text-[var(--color-gold-dim)]">
                    {formatDropChance(drop.chance)} {itemsData[drop.itemId]?.name || drop.itemId}
                  </div>
                ))}
              </div>
            )
            const isRunning = activeTask?.type === 'skill'
              && activeTask.skill === selectedSkill
              && activeTask.action?.id === action.id
              && activeTask.action?.category !== 'reward'
            return (
              <SkillActionRow
                key={action.id}
                icon={productItem ? <GameIcon item={productItem} size={52} /> : <SkillIcon skill={selectedSkill} size={52} />}
                title={action.name}
                meta={meta}
                right={dropRight || undefined}
                below={!levelLocked && action.materials ? <span class="text-[12.5px] font-semibold text-[var(--color-gold)]">{Object.entries(action.materials).map(([id, qty]) => `${itemsData[id]?.name || id} ×${qty}`).join(', ')}</span> : undefined}
                active={isRunning}
                locked={levelLocked}
                lockBadge={`LV ${action.level}`}
                lockHint={`Unlocks at ${selectedSkill.charAt(0).toUpperCase() + selectedSkill.slice(1)} ${action.level}`}
                disabled={!levelLocked && !rowEnabled}
                onClick={() => startSkilling(action)}
              />
            )
          }

          if (selectedSkill === 'dungeoneering') {
            const trainingActions = allActions.filter(a => a.category !== 'reward')
            const rewardActions = allActions.filter(a => a.category === 'reward')
            return (
              <>
                <div class="flex flex-col gap-2.5">
                  {trainingActions.map(renderActionRow)}
                </div>
                {rewardActions.length > 0 && (
                  <>
                    <h3 class="font-[var(--font-display)] text-xs font-bold text-[var(--color-gold)] uppercase tracking-wider mt-5 mb-2">
                      Equipment Unlocks
                    </h3>
                    <div class="flex flex-col gap-2.5">
                      {rewardActions.map(renderActionRow)}
                    </div>
                  </>
                )}
              </>
            )
          }

          return (
            <>
              {toolHint}
              <div class="flex flex-col gap-2.5">
                {allActions.map(renderActionRow)}
              </div>
            </>
          )
        })()}

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
Shop value: ×1.1
            </div>

            <div class="space-y-2 max-h-96 overflow-y-auto">
              {inventory.map((slot, idx) => {
                if (!slot) return null
                const item = itemsData[slot.itemId]
                if (!item || (item.stackable === false && slot.quantity > 1 && !slot.noted)) {
                  // Skip if not stackable but quantity > 1 (only show first instance)
                  return null
                }
                const alchValue = getHighAlchValue(item, { isIronman })
                return (
                  <button
                    key={`${idx}-${slot.itemId}`}
                    onClick={() => startAlchemy(slot)}
                    class="w-full p-3 rounded-lg border bg-[#1a1a1a] border-[#2a4a2a] active:bg-[#2a3a2a] transition-colors text-left"
                  >
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-2 flex-1">
                        <GameIcon item={item} size={40} />
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
  const progress = getActionProgress(skilling.active, skilling.ticksRemaining, skilling.action.ticks)

  const actionsPerHr = ratePerHour(skilling.totalActions, skilling.startedAt)
  const xpPerHr = ratePerHour(skilling.totalXP, skilling.startedAt)
  const isGathering = GATHERING_SKILLS.includes(selectedSkill)
  const producedItem = skilling.action.product ? itemsData[skilling.action.product] : null

  const sessionStats = [
    { label: 'Actions completed', value: skilling.totalActions },
    { label: 'Actions / hr', value: actionsPerHr !== null ? actionsPerHr.toLocaleString() : '—', accent: actionsPerHr !== null },
    { label: 'XP gained', value: formatNumber(skilling.totalXP) },
    { label: 'XP / hr', value: xpPerHr !== null ? formatNumber(xpPerHr) : '—', accent: xpPerHr !== null },
  ]
  if (selectedSkill === 'dungeoneering') {
    sessionStats.push({ label: 'Tokens gained', value: formatNumber(skilling.totalDungeoneeringTokens || 0) })
  }

  return (
    <SkillActivePanel
      skill={selectedSkill}
      title={skilling.action.name}
      progress={progress}
      producing={producedItem && <>
        <GameIcon item={producedItem} size={32} />
        <span class="text-[12px] font-semibold text-[var(--color-parchment)] opacity-60">Producing</span>
        <span class="text-[13px] font-semibold text-[var(--color-gold-light)]">{producedItem.name}</span>
      </>}
      stats={sessionStats}
      footer={isGathering ? {
        icon: <span class="text-[14px]">🏦</span>,
        label: 'Bank speed',
        value: `${formatBankDelay(getAgilityBankDelayMs(getLevelFromXP(stats.agility?.xp || 0)))} delay`,
      } : null}
      onBack={backToList}
      onStop={stopSkilling}
    />
  )
}
