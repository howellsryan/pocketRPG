import { createContext } from 'preact'
import { useState, useContext, useCallback, useEffect, useRef } from 'preact/hooks'
import { getAllStats, getInventory, getEquipment, getBank, getPlayer, saveAllStats, saveInventory, saveEquipment, saveBank, savePlayer, getSetting, saveSetting } from '../db/stores.js'
import { getLevelFromXP, clampXP } from '../engine/experience.js'
import { simulateIdleSkilling, simulateIdleGather, simulateIdleCombat, simulateIdleAgility, simulateIdleHPRegen } from '../engine/idleEngine.js'
import { simulateIdleThieving } from '../engine/thieving.js'
import { simulateIdleHunting } from '../engine/hunter.js'
import { simulateQuestIdleCascade, splitQuestXpRewards } from '../engine/questIdleCascade.js'
import { ALL_SKILLS, MAX_XP, AUTO_SAVE_DEBOUNCE, QUEST_QUEUE_MAX } from '../utils/constants.js'
import { debounce } from '../utils/helpers.js'
import { mergeKillCounts } from '../utils/killCountMerge.js'
import { fetchIdleState, pushIdleState } from '../cloud/idleState.js'
import { getToken, getCharacterId } from '../cloud/api.js'
import { requestCriticalPushSave, pushNow, suspendSaves, resumeSaves, isSaveConflict } from '../cloud/sync.js'
import { CRITICAL_SAVE_REASONS, detectCountIncreases, detectLevelUps, detectSetGrowth, didNumberIncrease, extractSkillLevels } from '../cloud/criticalSavePolicy.js'
import itemsData from '../data/items.json'
import prayersData from '../data/prayers.json'
import { normaliseDungeoneeringTokens, isDungeoneeringRewardAction } from '../engine/dungeoneeringTokens.js'
import { applyTaskResult } from '../engine/applyTaskResult.js'
import { isBackground, getActivityKey } from '../engine/activityRegistry.js'
import {
  saveActivityProgress, getActivityProgress, hydrateActivityLedger,
  fetchAndHydrateActivityProgress, clearActivityProgress, resetActivityProgressSync,
} from '../cloud/activityProgress.js'
import { getSlayerTaskReward } from '../engine/slayerRewards.js'
import { defaultIdleCombatSetup, normaliseIdleCombatSetup } from '../engine/idleSupplies.js'
import { migrateLegacyItemIds } from '../engine/itemMigrations.js'

const normalisePointCurrency = (value) => {
  const n = Math.floor(Number(value) || 0)
  return n > 0 ? n : 0
}
const CLOUD_ACTIVITY_HEARTBEAT_MS = 30_000
const HEARTBEAT_ACTIVE_TASK_TYPES = new Set(['skill', 'gather', 'clue', 'agility', 'thieving', 'hunter', 'minigame', 'quest'])

const GameContext = createContext(null)

export function GameProvider({ children }) {
  const [loaded, setLoaded] = useState(false)
  const [player, setPlayer] = useState(null)
  const [stats, setStats] = useState({})
  const [inventory, setInventory] = useState(new Array(28).fill(null))
  const [equipment, setEquipment] = useState({})
  const [bank, setBank] = useState({})
  const [toasts, setToasts] = useState([])
  const [currentHP, setCurrentHP] = useState(10)
  const [homeShortcuts, setHomeShortcuts] = useState(null) // null = not loaded yet
  const [combatStance, setCombatStanceState] = useState('accurate')
  const [idleCombatSetup, setIdleCombatSetupState] = useState(() => defaultIdleCombatSetup())
  const [autoBankLoot, setAutoBankLootState] = useState(true)
  const [activeTask, setActiveTaskState] = useState(null)
  const activeTaskInternalRef = useRef(null) // tracks latest active task for flush in setActiveTask
  const [bankConfig, setBankConfig] = useState({ tabs: [], itemTabMap: {} })
  const [unlockedFeatures, setUnlockedFeatures] = useState(new Set())
  const [slayerTask, setSlayerTaskState] = useState(null)
  const [slayerPoints, setSlayerPointsState] = useState(0)
  const [slayerTasksCompleted, setSlayerTasksCompletedState] = useState(0)
  const [dungeoneeringTokens, setDungeoneeringTokensState] = useState(0)
  const [slayerPerks, setSlayerPerksState] = useState({ doubleQuantity: false })
  const [characterUnlocks, setCharacterUnlocksState] = useState({ doubleSlayerXp: false })
  const [activeCombatSpell, setActiveCombatSpellState] = useState(null)
  const [bossKillCounts, setBossKillCountsState] = useState({})
  const [raidKillCounts, setRaidKillCountsState] = useState({})
  // True once the per-character server KC fetch has settled (success or fail).
  // The combat screen gates its first render on this so a cold cache never
  // briefly shows KC 0.
  const [killCountsLoaded, setKillCountsLoaded] = useState(false)
  const [farming, setFarmingState] = useState({ patchesById: {} })
  const [completedQuests, setCompletedQuestsState] = useState(new Set())
  const [unlockedMinigameItems, setUnlockedMinigameItemsState] = useState(new Set())
  const [questQueue, setQuestQueueState] = useState([])
  const [isSaving, setIsSaving] = useState(false)
  // Reference-counted game lock. Raised around any operation that must persist
  // durably before the player continues (manual save, skip-hour/quest, boss
  // skip, raid skip). While the count is > 0 the App renders a full-screen
  // blocking overlay (input frozen) and background autosaves / critical-save
  // milestones are suspended, so the operation's own authoritative write is the
  // ONLY save in flight. This is the root-cause fix for save_revision_conflict:
  // nothing can race the in-flight write.
  const [gameLockCount, setGameLockCount] = useState(0)
  const gameLockCountRef = useRef(0)
  const dirty = useRef({ stats: false, inventory: false, equipment: false, bank: false, player: false })
  // CombatScreen registers a force-kill handler here so handleSkip1h (in App) can invoke it
  const combatSkipHandlerRef = useRef(null)
  // App registers handleSkip1h here so CombatScreen (loot modal) can trigger another skip
  const skipHourHandlerRef = useRef(null)
  // App registers a credit-charge helper here so CombatScreen can charge a
  // server-authoritative skip (e.g. full-raid skip) and keep the credits display in sync
  const chargeSkipRef = useRef(null)
  // CombatScreen registers a full-raid skip handler here so the top-nav Skip can
  // skip an entire raid (mid-raid), reusing the same logic as the loot-modal Skip
  const raidSkipHandlerRef = useRef(null)

  // Refs to hold latest state for the debounced auto-save
  const stateRef = useRef({ stats: {}, inventory: new Array(28).fill(null), equipment: {}, bank: {}, player: null, bankConfig: { tabs: [], itemTabMap: {} } })
  const criticalMilestoneRef = useRef(null)
  const slayerTaskRef = useRef(null)
  const slayerPointsRef = useRef(0)
  const dungeoneeringTokensRef = useRef(0)
  const slayerTasksCompletedRef = useRef(0)
  const slayerPerksRef = useRef({ doubleQuantity: false })
  const characterUnlocksRef = useRef({ doubleSlayerXp: false })
  const completedQuestsRef = useRef(new Set())
  const questQueueRef = useRef([])

  // Keep activeTaskInternalRef in sync with state (handles setActiveTaskState calls that bypass setActiveTask)
  useEffect(() => { activeTaskInternalRef.current = activeTask }, [activeTask])

  // Keep refs in sync with state
  useEffect(() => { stateRef.current.stats = stats }, [stats])
  useEffect(() => { stateRef.current.inventory = inventory }, [inventory])
  useEffect(() => { stateRef.current.equipment = equipment }, [equipment])
  useEffect(() => { stateRef.current.bank = bank }, [bank])
  useEffect(() => { stateRef.current.player = player }, [player])
  useEffect(() => { stateRef.current.bankConfig = bankConfig }, [bankConfig])
  useEffect(() => { slayerTaskRef.current = slayerTask }, [slayerTask])
  useEffect(() => { slayerPointsRef.current = normalisePointCurrency(slayerPoints) }, [slayerPoints])
  useEffect(() => { dungeoneeringTokensRef.current = dungeoneeringTokens }, [dungeoneeringTokens])
  useEffect(() => { slayerTasksCompletedRef.current = Math.max(0, Math.floor(Number(slayerTasksCompleted) || 0)) }, [slayerTasksCompleted])

  // Load all state from IndexedDB — runs idle simulation inline, returns idleResult
  const loadGame = useCallback(async () => {
    let [p, s, inv, eq, b, shortcuts, stance, savedHP, autoBankSetting, savedBankConfig, savedUnlocks, savedSlayerTask, savedSlayerPoints, savedSlayerTasksCompleted, savedDungeoneeringTokens, savedBossKillCounts, savedRaidKillCounts, savedFarming, savedCompletedQuests, savedQuestQueue, savedActiveCombatSpell, savedUnlockedMinigameItems, savedIdleCombatSetup, savedSlayerPerks, savedCharacterUnlocks] = await Promise.all([
      getPlayer(), getAllStats(), getInventory(), getEquipment(), getBank(),
      getSetting('homeShortcuts'), getSetting('combatStance'), getSetting('currentHP'),
      getSetting('autoBankLoot'), getSetting('bankConfig'), getSetting('unlockedFeatures'),
      getSetting('slayerTask'), getSetting('slayerPoints'), getSetting('slayerTasksCompleted'), getSetting('dungeoneeringTokens'), getSetting('bossKillCounts'), getSetting('raidKillCounts'), getSetting('farming'),
      getSetting('completedQuests'), getSetting('questQueue'), getSetting('activeCombatSpell'), getSetting('unlockedMinigameItems'),
      getSetting('idleCombatSetup'), getSetting('slayerPerks'), getSetting('characterUnlocks')
    ])
    const normalisedIdleCombatSetup = normaliseIdleCombatSetup(savedIdleCombatSetup)
    // Rewrite legacy item ids (e.g. void_knight_* → void_king_*) before the
    // idle simulator or set-bonus checks read the equipment/inventory/bank.
    const migration = migrateLegacyItemIds({ equipment: eq, inventory: inv, bank: b })
    eq = migration.equipment
    inv = migration.inventory
    b = migration.bank
    if (migration.changed) {
      await Promise.all([saveEquipment(eq), saveInventory(inv), saveBank(b)])
    }
    savedDungeoneeringTokens = normaliseDungeoneeringTokens(savedDungeoneeringTokens)
    savedSlayerPoints = normalisePointCurrency(savedSlayerPoints)
    savedSlayerTasksCompleted = Math.max(0, Math.floor(Number(savedSlayerTasksCompleted) || 0))
    // Idle-engine inputs: last active timestamp and last active task.
    // D1 is authoritative when signed in + online — localStorage is only used
    // as an offline-mode fallback (and as a backup when the D1 fetch fails).
    let savedLastTick = (() => { const v = localStorage.getItem('pocketrpg_lastTick'); return v ? parseInt(v, 10) : null })()
    let savedTask = (() => { try { return JSON.parse(localStorage.getItem('pocketrpg_activeTask')) } catch { return null } })()
    const isCloudCharacter = !!getToken() && !!getCharacterId()
    try {
      const cloudIdle = await fetchIdleState()
      if (cloudIdle && cloudIdle.lastActiveAt) {
        savedLastTick = cloudIdle.lastActiveAt
        savedTask = cloudIdle.activeTask ?? null
        // Keep localStorage mirrors in sync so offline-mode fallback stays
        // accurate if the user goes offline after this boot.
        localStorage.setItem('pocketrpg_lastTick', String(cloudIdle.lastActiveAt))
        if (savedTask) localStorage.setItem('pocketrpg_activeTask', JSON.stringify(savedTask))
        else           localStorage.removeItem('pocketrpg_activeTask')
      }
    } catch (e) {
      if (isCloudCharacter) {
        savedLastTick = null
        savedTask = null
      } else {
        console.warn('[PocketRPG] fetchIdleState failed, using local fallback:', e?.message || e)
      }
    }
    // Hydrate per-activity progress ledger from server (non-fatal)
    try {
      if (isCloudCharacter) await fetchAndHydrateActivityProgress()
    } catch (e) {
      console.warn('[PocketRPG] fetchAndHydrateActivityProgress failed:', e?.message || e)
    }
    if (savedTask?.type === 'skill' && savedTask?.skill === 'dungeoneering' && isDungeoneeringRewardAction(savedTask?.action)) {
      savedTask = null
      localStorage.removeItem('pocketrpg_activeTask')
      localStorage.removeItem('pocketrpg_lastTick')
    }

    // ── Idle simulation (runs on raw DB data, before state is set) ──
    let idleResult = null
    console.log('[PocketRPG] loadGame — savedTask:', savedTask, 'savedLastTick:', savedLastTick, 'elapsed:', savedLastTick ? Date.now() - savedLastTick : 0)
    if (savedTask && savedLastTick) {
      // Cap at 24h to limit cross-session clock manipulation; legitimate offline play
      // beyond 24h can use the in-game skip button.
      const MAX_OFFLINE_MS = 24 * 60 * 60 * 1000
      const rawElapsedMs = Number(Date.now() - savedLastTick)
      const elapsedMs = Number.isFinite(rawElapsedMs) ? Math.max(0, Math.min(rawElapsedMs, MAX_OFFLINE_MS)) : 0
      if (elapsedMs >= 2000) {
        let sim = null
        try {
          if (savedTask.type === 'skill') {
            sim = simulateIdleSkilling(savedTask, elapsedMs, b, eq, s, itemsData, inv)
          } else if (savedTask.type === 'gather' || savedTask.type === 'clue') {
            sim = simulateIdleGather(savedTask, elapsedMs, inv, s, itemsData, b)
          } else if (savedTask.type === 'combat') {
            const idleHpForLoad = savedHP != null ? savedHP : (s.hitpoints ? getLevelFromXP(s.hitpoints.xp) : 10)
            sim = simulateIdleCombat(savedTask, elapsedMs, s, eq, inv, itemsData, savedSlayerTask, b, {
              currentHP: idleHpForLoad,
              idleFood: normalisedIdleCombatSetup.food,
              idlePotions: normalisedIdleCombatSetup.potions,
              idlePrayers: normalisedIdleCombatSetup.prayers,
              prayersData,
              doubleSlayerXp: !!(savedCharacterUnlocks?.doubleSlayerXp),
            })
          } else if (savedTask.type === 'agility') {
            sim = simulateIdleAgility(savedTask, elapsedMs)
          } else if (savedTask.type === 'thieving') {
            sim = simulateIdleThieving(savedTask, elapsedMs)
          } else if (savedTask.type === 'hunter') {
            sim = simulateIdleHunting(savedTask, elapsedMs)
          } else if (savedTask.type === 'quest') {
            sim = {}
          }
        } catch (simErr) {
          console.error('[PocketRPG] Idle simulation failed — skipping idle rewards:', simErr)
        }

        if (sim) {
          // Apply HP regeneration during idle. For combat with active supplies
          // the simulator's finalHP is authoritative — combat may have stopped
          // partway through the elapsed window, so we don't want full-session
          // regen to mask early termination.
          //
          // If the offline simulation reports a death the player is treated
          // as having died while we were away: rewards earned up to the
          // killing blow are still kept (the engine already excluded the
          // fatal kill), the active combat task is cleared, and HP resets
          // to max. App.jsx inspects `idleResult.died` after load to decide
          // whether to trigger a One-Life wipe or just a normal "you died"
          // toast.
          const hpRegenSim = simulateIdleHPRegen(elapsedMs)
          let diedDuringIdle = false

          // ── Shared apply layer (also used by MCP intents.js via applyTaskResult) ──
          // Build a normalised state object, apply the simulation result in place,
          // then read back the two primitive fields that may have changed.
          const applySettings = { currentHP: savedHP, dungeoneeringTokens: savedDungeoneeringTokens }
          const applyState = { stats: s, inventory: inv, bank: b, equipment: eq, settings: applySettings }
          applyTaskResult(applyState, sim, savedTask.type)
          inv = applyState.inventory  // may be sim.finalInventory (new array ref)

          if (applySettings.dungeoneeringTokens !== savedDungeoneeringTokens) {
            savedDungeoneeringTokens = applySettings.dungeoneeringTokens
            await saveSetting('dungeoneeringTokens', savedDungeoneeringTokens)
          }

          // HP: combat uses the sim result already stored in applySettings by
          // applyTaskResult; non-combat may gain HP regen.
          if (savedTask.type === 'combat' && sim.died === true) {
            savedHP = applySettings.currentHP  // reset to max HP by applyTaskResult
            sim.hpRestored = 0
            // Defer clearing the active task until AFTER the reward-application
            // pass below. That code reads `savedTask.type` repeatedly, so
            // nulling it here threw "Cannot read properties of null (reading
            // 'type')" the moment a player died during offline catch-up —
            // which propagates out of loadGame and locks the account out at
            // login on every boot. Rewards earned up to the killing blow are
            // still kept (see the note above); we only clear the task itself.
            diedDuringIdle = true
            try { localStorage.removeItem('pocketrpg_activeTask') } catch {}
          } else if (savedTask.type === 'combat' && Number.isFinite(Number(sim.finalHP))) {
            savedHP = applySettings.currentHP
            sim.hpRestored = 0
          } else if (hpRegenSim.hpRegen > 0) {
            const maxHP = s.hitpoints ? getLevelFromXP(s.hitpoints.xp) : 10
            savedHP = Math.min((savedHP != null ? savedHP : maxHP) + hpRegenSim.hpRegen, maxHP)
            sim.hpRestored = hpRegenSim.hpRegen
          }

          // Slayer XP from combat simulation (client-authoritative; MCP gains this in WO-2)
          if (savedTask.type === 'combat' && sim.slayerXpGained > 0) {
            if (s.slayer) {
              const newXP = Math.min((s.slayer.xp || 0) + Math.floor(sim.slayerXpGained), 200000000)
              s.slayer = { ...s.slayer, xp: newXP, level: getLevelFromXP(newXP) }
            }
          }

          // Save equipment if ammo or charges changed during combat
          if (savedTask.type === 'combat' && (sim.ammoConsumed || sim.chargesConsumed > 0)) {
            await saveEquipment(eq)
          }

          // Persist updated stats + bank/inventory to DB
          await saveAllStats(s)
          if (savedTask.type === 'combat' || savedTask.type === 'skill' || savedTask.type === 'gather' || savedTask.type === 'clue') {
            await saveInventory(inv)
            const bankedItems = sim.lootBanked || sim.itemsBanked || {}
            if (Object.keys(bankedItems).length > 0) {
              await saveBank(b)
            }
          } else if (savedTask.type === 'agility' || savedTask.type === 'thieving') {
            // Agility/Thieving may add coins to inventory, so save both
            await saveInventory(inv)
            await saveBank(b)
          } else if (savedTask.type === 'hunter') {
            // Hunter puts all rewards in bank
            await saveBank(b)
          } else {
            await saveBank(b)
          }
          // Persist slayer task update if present
          if (savedTask.type === 'combat' && sim.slayerTaskUpdate) {
            if (sim.slayerTaskUpdate.completed) {
              // Task complete — clear it and award points
              await saveSetting('slayerTask', null)
              const reward = getSlayerTaskReward(sim.slayerTaskUpdate.pointsOnComplete, savedSlayerTasksCompleted)
              const newSlayerPoints = normalisePointCurrency(savedSlayerPoints) + reward.pointsEarned
              await saveSetting('slayerPoints', newSlayerPoints)
              await saveSetting('slayerTasksCompleted', reward.totalTasks)
              savedSlayerPoints = newSlayerPoints
              savedSlayerTasksCompleted = reward.totalTasks
            } else {
              // Task in progress — update monstersRemaining
              await saveSetting('slayerTask', sim.slayerTaskUpdate)
            }
          }

          // Quest sim handling: shared cascade helper for boot/load idle
          if (savedTask.type === 'quest') {
            const applyQuestCompletionToRawState = async (quest, pendingChoices) => {
              if (!quest?.id) return

              const merged = new Set(savedCompletedQuests || [])
              if (!merged.has(quest.id)) {
                merged.add(quest.id)
                savedCompletedQuests = [...merged]
                await saveSetting('completedQuests', savedCompletedQuests)
              }

              const { fixed, choices } = splitQuestXpRewards(quest.xpReward || {})

              for (const [skill, xp] of Object.entries(fixed)) {
                if (xp > 0 && s[skill]) {
                  const newXP = Math.min((s[skill].xp || 0) + Math.floor(xp), 200000000)
                  s[skill] = { ...s[skill], xp: newXP, level: getLevelFromXP(newXP) }
                }
              }

              const coins = Number(quest.coinReward || 0) || 0
              if (coins > 0) {
                if (b.coins) b.coins = { ...b.coins, quantity: b.coins.quantity + coins }
                else b.coins = { itemId: 'coins', quantity: coins }
              }

              if (choices.length > 0) {
                pendingChoices.push({ rewards: choices, questId: quest.id, questName: quest.name })
              }
            }

            const cascade = simulateQuestIdleCascade({
              activeTask: savedTask,
              questQueue: savedQuestQueue || [],
              elapsedMs,
              now: Date.now(),
            })

            const completedQuestsList = []
            const aggregatedXp = {}
            const pendingChoices = []
            let totalCoinsGained = 0

            for (const entry of cascade.completed) {
              const quest = entry.quest
              completedQuestsList.push(quest)

              for (const [skill, xp] of Object.entries(quest.xpReward || {})) {
                const amount = Math.floor(Number(xp) || 0)
                if (amount > 0) aggregatedXp[skill] = (aggregatedXp[skill] || 0) + amount
              }

              totalCoinsGained += Number(quest.coinReward || 0) || 0
              await applyQuestCompletionToRawState(quest, pendingChoices)
            }

            savedTask = cascade.finalTask
            savedQuestQueue = cascade.finalQueue

            if (savedTask) {
              localStorage.setItem('pocketrpg_activeTask', JSON.stringify(savedTask))
            } else {
              localStorage.removeItem('pocketrpg_activeTask')
              localStorage.removeItem('pocketrpg_lastTick')
            }

            await saveSetting('questQueue', savedQuestQueue)

            await saveBank(b)
            await saveAllStats(s)

            sim = {
              completed: completedQuestsList.length > 0,
              questCascade: true,
              completedQuests: completedQuestsList,
              aggregatedXpReward: aggregatedXp,
              coinsGained: totalCoinsGained,
              pendingChoices,
              ticksUsed: Math.floor(cascade.elapsedMsUsed / 600),
              ticksRemaining: savedTask?.ticksRemaining ?? 0,
            }
          }
          // Long-form skill reward actions (Dungeoneering equipment unlocks)
          // partially progress like quests — persist the new ticksRemaining or
          // clear the task on completion.
          if (savedTask?.type === 'skill' && savedTask.skill === 'dungeoneering' && isDungeoneeringRewardAction(savedTask.action)) {
            savedTask = null
            localStorage.removeItem('pocketrpg_activeTask')
            localStorage.removeItem('pocketrpg_lastTick')
          }
          // Combat rewards earned up to the killing blow have now been applied;
          // clear the offline-death task so the UI and persisted state show no
          // active task afterwards.
          if (diedDuringIdle) savedTask = null
          idleResult = { elapsedMs, task: savedTask, ...sim }
        }
      }
    }

    // Backfill itemTabMap for bank items that have no ordering entry.
    // Covers: idle-sim deposits, legacy saves, PvP loot applied server-side.
    // Items that are already in itemTabMap (incl. placeholders) are untouched.
    {
      const cfg = savedBankConfig ?? { tabs: [], itemTabMap: {} }
      const tabMap = { ...(cfg.itemTabMap ?? {}) }
      const placeholders = cfg.placeholders ?? {}
      let nextPos = Object.values(tabMap).reduce((max, v) => Math.max(max, v?.position ?? -1), -1) + 1
      let changed = false
      for (const itemId of Object.keys(b)) {
        if (!tabMap[itemId] && !placeholders[itemId]) {
          tabMap[itemId] = { tabIndex: 0, position: nextPos++ }
          changed = true
        }
      }
      if (changed) {
        savedBankConfig = { ...cfg, itemTabMap: tabMap }
        saveSetting('bankConfig', savedBankConfig)
      }
    }

    setPlayer(p)
    setStats({ ...s })
    setInventory([...inv])
    setEquipment(eq)
    setBank({ ...b })
    setHomeShortcuts(shortcuts ?? null)
    const loadedStance = stance === 'controlled' ? 'accurate' : (stance ?? 'accurate')
    setCombatStanceState(loadedStance)
    if (stance === 'controlled') {
      // Migrate the legacy stance forward exactly once so the simulator and UI
      // never see it again.
      saveSetting('combatStance', 'accurate')
    }
    setIdleCombatSetupState(normalisedIdleCombatSetup)
    setAutoBankLootState(autoBankSetting !== false) // default true
    setBankConfig(savedBankConfig ?? { tabs: [], itemTabMap: {} })
    setUnlockedFeatures(new Set(savedUnlocks || []))
    setActiveTaskState(savedTask ?? null)
    // Update slayer task if idle simulation modified it
    const finalSlayerTask = idleResult && idleResult.slayerTaskUpdate
      ? (idleResult.slayerTaskUpdate.completed ? null : idleResult.slayerTaskUpdate)
      : (savedSlayerTask ?? null)
    slayerTaskRef.current = finalSlayerTask
    slayerPointsRef.current = normalisePointCurrency(savedSlayerPoints)
    slayerTasksCompletedRef.current = savedSlayerTasksCompleted
    setSlayerTaskState(finalSlayerTask)
    setSlayerPointsState(slayerPointsRef.current)
    setSlayerTasksCompletedState(slayerTasksCompletedRef.current)
    setDungeoneeringTokensState(savedDungeoneeringTokens)
    setActiveCombatSpellState(savedActiveCombatSpell ?? null)
    setBossKillCountsState(savedBossKillCounts ?? {})
    setRaidKillCountsState(savedRaidKillCounts ?? {})
    setFarmingState(savedFarming ?? { patchesById: {} })
    const initialCompletedQuests = new Set(savedCompletedQuests || [])
    completedQuestsRef.current = initialCompletedQuests
    setCompletedQuestsState(initialCompletedQuests)
    setUnlockedMinigameItemsState(new Set(savedUnlockedMinigameItems || []))
    const initialQuestQueue = savedQuestQueue ?? []
    questQueueRef.current = initialQuestQueue
    setQuestQueueState(initialQuestQueue)
    const loadedSlayerPerks = savedSlayerPerks && typeof savedSlayerPerks === 'object' ? savedSlayerPerks : { doubleQuantity: false }
    slayerPerksRef.current = loadedSlayerPerks
    setSlayerPerksState(loadedSlayerPerks)
    const loadedCharacterUnlocks = savedCharacterUnlocks && typeof savedCharacterUnlocks === 'object' ? savedCharacterUnlocks : { doubleSlayerXp: false }
    characterUnlocksRef.current = loadedCharacterUnlocks
    setCharacterUnlocksState(loadedCharacterUnlocks)
    const hpLevel = s.hitpoints ? getLevelFromXP(s.hitpoints.xp) : 10
    setCurrentHP(savedHP != null ? Math.min(savedHP, hpLevel) : hpLevel)
    setLoaded(true)
    return idleResult
  }, [])

  // Auto-save debounced — reads from refs for latest state
  const autoSave = useCallback(debounce(async () => {
    const d = dirty.current
    const s = stateRef.current
    const promises = []
    if (d.stats) promises.push(saveAllStats(s.stats))
    if (d.inventory) promises.push(saveInventory(s.inventory))
    if (d.equipment) promises.push(saveEquipment(s.equipment))
    if (d.bank) promises.push(saveBank(s.bank))
    if (d.player && s.player) promises.push(savePlayer(s.player))
    if (promises.length === 0) return
    setIsSaving(true)
    try {
      await Promise.all(promises)
      dirty.current = { stats: false, inventory: false, equipment: false, bank: false, player: false }
    } finally {
      setIsSaving(false)
    }
  }, AUTO_SAVE_DEBOUNCE), [])

  // Mark dirty and trigger save
  const markDirty = useCallback((key) => {
    dirty.current[key] = true
    autoSave()
  }, [autoSave])

  // ── Mutations ──

  const grantXP = useCallback((skill, amount) => {
    setStats(prev => {
      const cur = prev[skill] || { skill, xp: 0, level: 1 }
      const newXP = clampXP(cur.xp + Math.floor(amount))
      const newLevel = getLevelFromXP(newXP)
      const oldLevel = cur.level

      if (newLevel > oldLevel) {
        const skillName = skill.charAt(0).toUpperCase() + skill.slice(1)
        const SKILL_ICONS = {
          attack: '⚔️', strength: '💪', defence: '🛡️', hitpoints: '❤️',
          ranged: '🏹', magic: '🔮', prayer: '🙏',
          mining: '⛏️', woodcutting: '🪓', fishing: '🎣', farming: '🌾', hunter: '🪤',
          smithing: '🔨', cooking: '🍳', crafting: '✂️', fletching: '🏹', herblore: '🧪', runecraft: '🔴',
          agility: '🏃', thieving: '🗝️', slayer: '💀', firemaking: '🔥', construction: '🏠', dungeoneering: '🏰'
        }
        const icon = SKILL_ICONS[skill] || '⭐'
        const msg = `Congratulations! Your ${skillName} is now ${newLevel}`
        addToast(msg, 'levelup', icon)
        // If hitpoints levelled, update max HP
        if (skill === 'hitpoints') {
          setCurrentHP(prev => Math.min(prev + (newLevel - oldLevel), newLevel))
        }
      }

      const next = { ...prev, [skill]: { skill, xp: newXP, level: newLevel } }
      dirty.current.stats = true
      autoSave()
      return next
    })
  }, [autoSave])

  const updateInventory = useCallback((newInv) => {
    setInventory([...newInv])
    markDirty('inventory')
  }, [markDirty])

  const updateEquipment = useCallback((newEq) => {
    setEquipment({ ...newEq })
    markDirty('equipment')
  }, [markDirty])

  const updateBank = useCallback((newBank) => {
    setBank({ ...newBank })
    markDirty('bank')
  }, [markDirty])

  const removeFromInventory = useCallback((slotIndex, qty = 1) => {
    setInventory(prev => {
      const next = [...prev]
      if (next[slotIndex]) {
        const newQty = next[slotIndex].quantity - qty
        if (newQty <= 0) {
          next[slotIndex] = null
        } else {
          next[slotIndex] = { ...next[slotIndex], quantity: newQty }
        }
      }
      markDirty('inventory')
      return next
    })
  }, [markDirty])

  const addToBank = useCallback((itemId, qty) => {
    const isNew = !stateRef.current.bank[itemId]
    setBank(prev => {
      const next = { ...prev }
      if (next[itemId]) {
        next[itemId] = { ...next[itemId], quantity: next[itemId].quantity + qty }
      } else {
        next[itemId] = { itemId, quantity: qty }
      }
      markDirty('bank')
      return next
    })
    if (isNew) {
      const cfg = stateRef.current.bankConfig
      if (!cfg.itemTabMap?.[itemId]) {
        const tabMap = { ...(cfg.itemTabMap ?? {}) }
        const nextPos = Object.values(tabMap).reduce((max, v) => Math.max(max, v?.position ?? -1), -1) + 1
        tabMap[itemId] = { tabIndex: 0, position: nextPos }
        const newCfg = { ...cfg, itemTabMap: tabMap }
        setBankConfig(newCfg)
        saveSetting('bankConfig', newCfg)
      }
    }
  }, [markDirty])

  const updateHP = useCallback((hp) => {
    const maxHP = stats.hitpoints ? getLevelFromXP(stats.hitpoints.xp) : 10
    const clamped = Math.max(0, Math.min(hp, maxHP))
    setCurrentHP(clamped)
    saveSetting('currentHP', clamped)
  }, [stats])

  const getMaxHP = useCallback(() => {
    return stats.hitpoints ? getLevelFromXP(stats.hitpoints.xp) : 10
  }, [stats])

  const getSkillLevel = useCallback((skill) => {
    return stats[skill] ? getLevelFromXP(stats[skill].xp) : 1
  }, [stats])

  const updateHomeShortcuts = useCallback((shortcuts) => {
    setHomeShortcuts(shortcuts)
    saveSetting('homeShortcuts', shortcuts)
  }, [])

  const updateCombatStance = useCallback((stance) => {
    // Drop the legacy `controlled` stance — UI no longer offers it. Saving
    // `accurate` keeps older saves usable without surfacing a dead option.
    const next = stance === 'controlled' ? 'accurate' : stance
    setCombatStanceState(next)
    saveSetting('combatStance', next)
  }, [])

  const updateIdleCombatSetup = useCallback((setup) => {
    const next = normaliseIdleCombatSetup(setup)
    setIdleCombatSetupState(next)
    saveSetting('idleCombatSetup', next)
  }, [])

  const updateActiveCombatSpell = useCallback((spell) => {
    setActiveCombatSpellState(spell)
    saveSetting('activeCombatSpell', spell)
  }, [])

  const updateAutoBankLoot = useCallback((enabled) => {
    setAutoBankLootState(enabled)
    saveSetting('autoBankLoot', enabled)
  }, [])

  const updateBankConfig = useCallback((config) => {
    setBankConfig(config)
    saveSetting('bankConfig', config)
  }, [])

  const unlockFeature = useCallback((featureId) => {
    setUnlockedFeatures(prev => {
      const next = new Set(prev)
      next.add(featureId)
      saveSetting('unlockedFeatures', [...next])
      return next
    })
  }, [])

  const setActiveTask = useCallback((task, { skipCloudSync = false } = {}) => {
    const outgoing = activeTaskInternalRef.current

    // Flush outgoing background task's progress to the ledger before replacing it.
    // This preserves partial progress so the player can resume later at the same point.
    if (isBackground(outgoing)) {
      const outKey = getActivityKey(outgoing)
      if (outKey && (!task || getActivityKey(task) !== outKey)) {
        const progressTicks = (outgoing.totalTicks != null && outgoing.ticksRemaining != null)
          ? Math.max(0, outgoing.totalTicks - outgoing.ticksRemaining)
          : 0
        saveActivityProgress(outKey, {
          progressTicks,
          totalTicks: outgoing.totalTicks ?? null,
        })
      }
    }

    activeTaskInternalRef.current = task
    setActiveTaskState(task)
    // Synchronous localStorage write — safe from iOS background freeze
    if (task) {
      localStorage.setItem('pocketrpg_activeTask', JSON.stringify(task))
    } else {
      localStorage.removeItem('pocketrpg_activeTask')
      localStorage.removeItem('pocketrpg_lastTick')
    }
    // Mirror to D1 so the idle engine picks the right task on next return.
    // Skip when only ticksRemaining changed (per-tick countdown) — the 30s heartbeat
    // keeps last_active_at fresh without a D1 write on every 600ms tick.
    if (!skipCloudSync) pushIdleState(task ?? null)
  }, [])

  const setSlayerTask = useCallback((task) => {
    slayerTaskRef.current = task
    setSlayerTaskState(task)
    saveSetting('slayerTask', task)
  }, [])

  const updateSlayerPoints = useCallback((points) => {
    const next = normalisePointCurrency(points)
    slayerPointsRef.current = next
    setSlayerPointsState(next)
    saveSetting('slayerPoints', next)
  }, [])

  const awardSlayerPoints = useCallback((pointsToAdd) => {
    const amount = normalisePointCurrency(pointsToAdd)
    if (amount <= 0) return

    const next = normalisePointCurrency(slayerPointsRef.current) + amount
    slayerPointsRef.current = next
    setSlayerPointsState(next)
    saveSetting('slayerPoints', next)
  }, [])

  const awardDungeoneeringTokens = useCallback((tokensToAdd) => {
    const amount = normaliseDungeoneeringTokens(tokensToAdd)
    if (amount <= 0) return
    const next = normaliseDungeoneeringTokens(dungeoneeringTokensRef.current + amount)
    dungeoneeringTokensRef.current = next
    setDungeoneeringTokensState(next)
    saveSetting('dungeoneeringTokens', next)
  }, [])

  const trySpendDungeoneeringTokens = useCallback((amountToSpend) => {
    const amount = normaliseDungeoneeringTokens(amountToSpend)
    if (amount <= 0) return false
    const current = normaliseDungeoneeringTokens(dungeoneeringTokensRef.current)
    if (current < amount) return false
    const next = current - amount
    dungeoneeringTokensRef.current = next
    setDungeoneeringTokensState(next)
    saveSetting('dungeoneeringTokens', next)
    return true
  }, [])

  const updateSlayerPerk = useCallback((key, value) => {
    const next = { ...slayerPerksRef.current, [key]: value }
    slayerPerksRef.current = next
    setSlayerPerksState(next)
    saveSetting('slayerPerks', next)
  }, [])

  const updateCharacterUnlock = useCallback((key, value) => {
    const next = { ...characterUnlocksRef.current, [key]: value }
    characterUnlocksRef.current = next
    setCharacterUnlocksState(next)
    saveSetting('characterUnlocks', next)
  }, [])

  const updateBossKillCounts = useCallback((counts) => {
    setBossKillCountsState(counts)
    saveSetting('bossKillCounts', counts)
  }, [])

  const updateRaidKillCounts = useCallback((counts) => {
    setRaidKillCountsState(counts)
    saveSetting('raidKillCounts', counts)
  }, [])

  // Merges server-authoritative KC into local state using max(local, server) per
  // id. This prevents a transient empty server response from zeroing local KC.
  const syncServerKillCounts = useCallback((serverBoss, serverRaid) => {
    setBossKillCountsState(prev => {
      const merged = mergeKillCounts(prev, serverBoss)
      saveSetting('bossKillCounts', merged)
      return merged
    })
    setRaidKillCountsState(prev => {
      const merged = mergeKillCounts(prev, serverRaid)
      saveSetting('raidKillCounts', merged)
      return merged
    })
  }, [])

  const markKillCountsLoaded = useCallback((value = true) => {
    setKillCountsLoaded(!!value)
  }, [])

  const updateFarming = useCallback((farmingState) => {
    setFarmingState(farmingState)
    saveSetting('farming', farmingState)
  }, [])

  const unlockMinigameItem = useCallback((itemId) => {
    if (!itemId) return
    setUnlockedMinigameItemsState(prev => {
      if (prev.has(itemId)) return prev
      const next = new Set(prev)
      next.add(itemId)
      saveSetting('unlockedMinigameItems', [...next])
      return next
    })
  }, [])

  const completeQuest = useCallback((questId) => {
    setCompletedQuestsState(prev => {
      if (prev.has(questId)) return prev
      const next = new Set(prev)
      next.add(questId)
      completedQuestsRef.current = next
      saveSetting('completedQuests', [...next])
      return next
    })
  }, [])

  const addQuestToQueue = useCallback((quest) => {
    let added = false
    setQuestQueueState(prev => {
      if (prev.length >= QUEST_QUEUE_MAX) return prev
      added = true
      const next = [...prev, quest]
      questQueueRef.current = next
      saveSetting('questQueue', next)
      return next
    })
    return added
  }, [])

  const removeFromQuestQueue = useCallback((questId) => {
    setQuestQueueState(prev => {
      const next = prev.filter(q => q.id !== questId)
      questQueueRef.current = next
      saveSetting('questQueue', next)
      return next
    })
  }, [])

  const clearQuestQueue = useCallback(() => {
    questQueueRef.current = []
    setQuestQueueState([])
    saveSetting('questQueue', [])
  }, [])

  const updateQuestQueue = useCallback((newQueue) => {
    const nextQueue = newQueue ?? []
    questQueueRef.current = nextQueue
    setQuestQueueState(nextQueue)
    saveSetting('questQueue', nextQueue)
  }, [])

  // Direct bank update without inventory changes (for skill/gather item routing)
  const updateBankDirect = useCallback((itemUpdates) => {
    setBank(prev => {
      const newBank = { ...prev }
      for (const [itemId, qty] of Object.entries(itemUpdates)) {
        if (newBank[itemId]) {
          const newQty = newBank[itemId].quantity + qty
          if (newQty <= 0) {
            delete newBank[itemId]
          } else {
            newBank[itemId] = { ...newBank[itemId], quantity: newQty }
          }
        } else if (qty > 0) {
          newBank[itemId] = { itemId, quantity: qty }
        }
      }
      dirty.current.bank = true
      autoSave()
      return newBank
    })
  }, [autoSave])

  // ── Toasts ──
  const addToast = useCallback((message, type = 'info', icon = null) => {
    const id = Date.now() + Math.random()
    setToasts(prev => [...prev, { id, message, type, icon }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 3000)
  }, [])

  // Returns a fresh snapshot of all live state — always reads from refs, never stale
  const getSnapshot = useCallback(() => ({
    player: stateRef.current.player,
    stats: stateRef.current.stats,
    inventory: stateRef.current.inventory,
    bank: stateRef.current.bank,
    equipment: stateRef.current.equipment,
    settings: {
      currentHP,
      autoBankLoot,
      bankConfig,
      homeShortcuts,
      combatStance,
      idleCombatSetup,
      unlockedFeatures: [...unlockedFeatures],
      activeTask,
      activeCombatSpell,
      slayerTask: slayerTaskRef.current,
      slayerPoints: slayerPointsRef.current,
      slayerTasksCompleted: slayerTasksCompletedRef.current,
      dungeoneeringTokens: dungeoneeringTokensRef.current,
      bossKillCounts,
      raidKillCounts,
      farming,
      completedQuests: [...completedQuestsRef.current],
      unlockedMinigameItems: [...unlockedMinigameItems],
      questQueue: questQueueRef.current,
      slayerPerks: slayerPerksRef.current,
      characterUnlocks: characterUnlocksRef.current,
    },
  }), [currentHP, autoBankLoot, bankConfig, homeShortcuts, combatStance, idleCombatSetup, unlockedFeatures, activeTask, activeCombatSpell, slayerTask, slayerPoints, slayerTasksCompleted, dungeoneeringTokens, bossKillCounts, raidKillCounts, farming, completedQuests, unlockedMinigameItems, questQueue, slayerPerks, characterUnlocks])


  // ---- Shared game lock --------------------------------------------------
  const lockGame = useCallback(() => {
    gameLockCountRef.current += 1
    setGameLockCount(gameLockCountRef.current)
    if (gameLockCountRef.current === 1) suspendSaves()
  }, [])
  const unlockGame = useCallback(() => {
    gameLockCountRef.current = Math.max(0, gameLockCountRef.current - 1)
    setGameLockCount(gameLockCountRef.current)
    if (gameLockCountRef.current === 0) resumeSaves()
  }, [])

  // Deferred that resolves when the next live combat completion round-trip
  // settles (loot modal loaded or errored). A boss-skip arms a kill on a FUTURE
  // engine tick, so the caller awaits this to hold the lock continuously from
  // the credit charge through the server completion — with no unlocked gap in
  // which a competing save could race.
  const combatCompletionResolverRef = useRef(null)
  const awaitCombatCompletion = useCallback((timeoutMs = 12000) => {
    return new Promise((resolve) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        if (combatCompletionResolverRef.current === finish) combatCompletionResolverRef.current = null
        resolve()
      }
      combatCompletionResolverRef.current = finish
      // Backstop: never hang the lock forever if a completion never settles.
      setTimeout(finish, timeoutMs)
    })
  }, [])
  const resolveCombatCompletion = useCallback(() => {
    const fn = combatCompletionResolverRef.current
    if (fn) fn()
  }, [])

  // Run an operation behind the game lock and persist its result durably before
  // unlocking — the lock is held until the save SUCCESSFULLY RESPONDS, not just
  // until the operation completes. Returns true if the save landed. On a
  // save-revision conflict we leave the lock up (the app is rolling back to the
  // authoritative cloud copy via a reload). Used by the manual Save button.
  const runLockedSave = useCallback(async (operation) => {
    lockGame()
    try {
      if (operation) await operation()
      let saved = false
      for (let attempt = 0; attempt < 4 && !saved; attempt++) {
        saved = await pushNow(getSnapshot())
        if (isSaveConflict()) return false
        if (!saved) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
      }
      return saved
    } finally {
      if (!isSaveConflict()) unlockGame()
    }
  }, [lockGame, unlockGame, getSnapshot])

  useEffect(() => {
    if (!loaded) return

    const current = {
      levels: extractSkillLevels(stats),
      bossKillCounts: bossKillCounts || {},
      raidKillCounts: raidKillCounts || {},
      completedQuests: new Set(completedQuests || []),
      unlockedFeatures: new Set(unlockedFeatures || []),
      slayerPoints: Number(slayerPoints) || 0,
    }

    const previous = criticalMilestoneRef.current
    if (!previous) {
      criticalMilestoneRef.current = current
      return
    }

    const reasons = new Set()
    if (detectLevelUps(previous.levels, stats).length > 0) reasons.add(CRITICAL_SAVE_REASONS.LEVEL_UP)
    if (detectCountIncreases(previous.bossKillCounts, current.bossKillCounts).length > 0) reasons.add(CRITICAL_SAVE_REASONS.BOSS_KILL)
    if (detectCountIncreases(previous.raidKillCounts, current.raidKillCounts).length > 0) reasons.add(CRITICAL_SAVE_REASONS.RAID_COMPLETE)
    if (detectSetGrowth(previous.completedQuests, current.completedQuests).length > 0) reasons.add(CRITICAL_SAVE_REASONS.QUEST_COMPLETE)
    if (detectSetGrowth(previous.unlockedFeatures, current.unlockedFeatures).length > 0) reasons.add(CRITICAL_SAVE_REASONS.FEATURE_UNLOCK)
    if (didNumberIncrease(previous.slayerPoints, current.slayerPoints)) reasons.add(CRITICAL_SAVE_REASONS.SLAYER_TASK_COMPLETE)

    criticalMilestoneRef.current = current

    for (const reason of reasons) {
      requestCriticalPushSave(() => getSnapshot(), reason)
    }
  }, [loaded, stats, bossKillCounts, raidKillCounts, completedQuests, unlockedFeatures, slayerPoints, getSnapshot])

  useEffect(() => {
    if (!loaded || !activeTask || !HEARTBEAT_ACTIVE_TASK_TYPES.has(activeTask.type)) return
    const timer = setInterval(() => {
      requestCriticalPushSave(() => getSnapshot(), CRITICAL_SAVE_REASONS.ACTIVITY_HEARTBEAT)
    }, CLOUD_ACTIVITY_HEARTBEAT_MS)
    return () => clearInterval(timer)
  }, [loaded, activeTask, getSnapshot])

  const value = {
    loaded, player, stats, inventory, equipment, bank, currentHP, toasts, isSaving,
    homeShortcuts, combatStance, idleCombatSetup, updateIdleCombatSetup,
    activeTask, autoBankLoot, bankConfig,
    unlockedFeatures, unlockFeature,
    slayerTask, setSlayerTask, slayerPoints, updateSlayerPoints, awardSlayerPoints,
    slayerTasksCompleted,
    setSlayerTasksCompleted: (n) => {
      const v = Math.max(0, Math.floor(Number(n) || 0))
      slayerTasksCompletedRef.current = v
      setSlayerTasksCompletedState(v)
      saveSetting('slayerTasksCompleted', v)
    },
    dungeoneeringTokens, awardDungeoneeringTokens, trySpendDungeoneeringTokens,
    activeCombatSpell, updateActiveCombatSpell,
    bossKillCounts, updateBossKillCounts,
    raidKillCounts, updateRaidKillCounts,
    syncServerKillCounts,
    killCountsLoaded, markKillCountsLoaded,
    farming, updateFarming,
    completedQuests, completeQuest,
    unlockedMinigameItems, unlockMinigameItem,
    questQueue, addQuestToQueue, removeFromQuestQueue, clearQuestQueue, updateQuestQueue,
    combatSkipHandlerRef,
    skipHourHandlerRef,
    chargeSkipRef,
    raidSkipHandlerRef,
    gameLocked: gameLockCount > 0,
    lockGame, unlockGame, runLockedSave,
    awaitCombatCompletion, resolveCombatCompletion,
    loadGame, grantXP, updateInventory, updateEquipment, updateBank,
    removeFromInventory, addToBank,
    updateHP, getMaxHP, getSkillLevel, addToast, setPlayer,
    markDirty, itemsData, updateHomeShortcuts, updateCombatStance,
    setActiveTask, updateBankDirect, getSnapshot, updateAutoBankLoot, updateBankConfig,
    getActivityProgress, clearActivityProgress,
    slayerPerks, updateSlayerPerk,
    characterUnlocks, updateCharacterUnlock,
    isIronman: player?.is_ironman || false,
    isOneLife: player?.is_one_life || false
  }

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>
}

export function useGame() {
  return useContext(GameContext)
}
