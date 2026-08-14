import { createContext } from 'preact'
import { useState, useContext, useCallback, useEffect, useRef } from 'preact/hooks'
import { getAllStats, getInventory, getEquipment, getBank, getPlayer, saveAllStats, saveInventory, saveEquipment, saveBank, savePlayer, getSetting, saveSetting } from '../db/stores.js'
import { getLevelFromXP, clampXP } from '../engine/experience.js'
import { simulateIdleSkilling, simulateIdleGather, simulateIdleCombat, simulateIdleAgility, simulateIdleHPRegen } from '../engine/idleEngine.js'
import { simulateIdleCombatChain } from '../engine/idleSlayerLoop.js'
import { simulateIdleThieving } from '../engine/thieving.js'
import { simulateIdleHunting } from '../engine/hunter.js'
import { simulateQuestIdleCascade, splitQuestXpRewards } from '../engine/questIdleCascade.js'
import { simulateKingdom, normaliseKingdomState, DEFAULT_KINGDOM, mergeLoot, applyKingdomWindow } from '../engine/kingdomEngine.js'
import { ALL_SKILLS, MAX_XP, AUTO_SAVE_DEBOUNCE, QUEST_QUEUE_MAX } from '../utils/constants.js'
import { debounce } from '../utils/helpers.js'
import { applyTheme, normalizeThemePreference, readStoredThemePreference, storeThemePreference, watchSystemTheme, DEFAULT_THEME_PREFERENCE } from '../utils/theme.js'
import { mergeKillCounts } from '../utils/killCountMerge.js'
import { fetchIdleState, pushIdleState } from '../cloud/idleState.js'
import { api, getToken, getCharacterId, getIronmanMode, getOneLifeMode, getGrindmanMode, syncAccountModeFlags, CREDITS_UPDATED_EVENT } from '../cloud/api.js'
import { resetOneLifeWithRetry } from '../utils/oneLifeDeath.js'
import { matchTaskProgress, taskById, idleCatchupDailyEvents } from '../engine/dailyTasks.js'
import { requestCriticalPushSave, schedulePeriodicSave, pushNow, suspendSaves, resumeSaves, isSaveConflict } from '../cloud/sync.js'
import { CRITICAL_SAVE_REASONS, detectCountIncreases, detectLevelUps, detectSetGrowth, didNumberIncrease, extractSkillLevels } from '../cloud/criticalSavePolicy.js'
import itemsData from '../data/items.json'
import prayersData from '../data/prayers.json'
import { normaliseDungeoneeringTokens, isDungeoneeringRewardAction } from '../engine/dungeoneeringTokens.js'
import { applyTaskResult } from '../engine/applyTaskResult.js'
import { preserveBankCharges } from '../engine/bankCharges.js'
import { grindmanXP } from '../engine/grindman.js'
import { applyBankDeltas, bankUnitsRemoved } from '../engine/bankMutations.js'
import { recordItemLossEntries, recordItemLosses } from '../engine/lossLedger.js'
import { createDirtyFlags, claimDirtyFlags, restoreDirtyFlags, hasDirtyFlags } from '../db/dirtyFlags.js'
import { isBackground, getActivityKey } from '../engine/activityRegistry.js'
import {
  saveActivityProgress, getActivityProgress, hydrateActivityLedger,
  fetchAndHydrateActivityProgress, clearActivityProgress, resetActivityProgressSync,
} from '../cloud/activityProgress.js'
import { getSlayerTaskReward, resolveSlayerLoopRewards } from '../engine/slayerRewards.js'
import { hardModeDeathLoss, idleTaskDiedHard } from '../engine/hardMode.js'
import { defaultIdleCombatSetup, normaliseIdleCombatSetup } from '../engine/idleSupplies.js'
import { migrateLegacyItemIds } from '../engine/itemMigrations.js'
import { WORLD_START_PLACE, normaliseLocation } from '../engine/world.js'
import { advanceTravel, createTravelTask } from '../engine/travel.js'
import { advanceJourneyOffline } from '../engine/journeys.js'
import { resolveTaskStart, activityRef, autoStartFromTask } from '../engine/worldContent.js'
import { isWorldMapEnabled } from '../utils/constants.js'

const normalisePointCurrency = (value) => {
  const n = Math.floor(Number(value) || 0)
  return n > 0 ? n : 0
}
const CLOUD_ACTIVITY_HEARTBEAT_MS = 120_000
// 'combat' is included so an auto-fight grind persists on the 120s heartbeat
// instead of forcing a cloud save on every monster kill (the old per-kill
// critical save was the main /api/save write-amplifier for idle sessions).
const HEARTBEAT_ACTIVE_TASK_TYPES = new Set(['skill', 'gather', 'clue', 'agility', 'thieving', 'hunter', 'minigame', 'quest', 'combat'])

const GameContext = createContext(null)

export function GameProvider({ children }) {
  const [loaded, setLoaded] = useState(false)
  const [player, setPlayer] = useState(null)
  const [stats, setStats] = useState({})
  const [inventory, setInventory] = useState(new Array(28).fill(null))
  const [equipment, setEquipment] = useState({})
  const [bank, setBank] = useState({})
  const [toasts, setToasts] = useState([])
  // Global "inventory full" prompt for active skilling/gathering:
  //   'none'      — inventory has room (or no blocked activity)
  //   'prompt'    — full; show the Bank & continue confirmation
  //   'dismissed' — full but the player dismissed the prompt; keep the action
  //                 paused and silently retrying without re-showing the prompt
  const [inventoryFull, setInventoryFull] = useState('none')
  const [currentHP, setCurrentHP] = useState(10)
  const [homeShortcuts, setHomeShortcuts] = useState(null) // null = not loaded yet
  const [combatStance, setCombatStanceState] = useState('accurate')
  const [worldLocation, setWorldLocationState] = useState(WORLD_START_PLACE) // map-driven overhaul (phase 1)
  const [idleCombatSetup, setIdleCombatSetupState] = useState(() => defaultIdleCombatSetup())
  const [autoBankLoot, setAutoBankLootState] = useState(true)
  const [autoBankExcludedItems, setAutoBankExcludedItemsState] = useState(new Set())
  const [showInfoToasts, setShowInfoToastsState] = useState(false)
  const [backgroundCombat, setBackgroundCombatState] = useState(false)
  const [theme, setThemeState] = useState(() => readStoredThemePreference() || DEFAULT_THEME_PREFERENCE)
  // Live snapshot of the running fight, published by CombatScreen each tick so the
  // desktop combat indicator can render the monster's HP as a progress bar while
  // the fight ticks on another screen. Null when no fight is in progress.
  const [combatStatus, setCombatStatus] = useState(null)
  const [activeTask, setActiveTaskState] = useState(null)
  const activeTaskInternalRef = useRef(null) // tracks latest active task for flush in setActiveTask
  const worldLocationRef = useRef(WORLD_START_PLACE) // latest location for gating in callbacks
  const [travelPrompt, setTravelPrompt] = useState(null) // {task,kind,ref,places} when a start needs travel
  const travelPromptRef = useRef(null) // latest travelPrompt for startTravelTo's auto-start capture
  const [bankConfig, setBankConfig] = useState({ tabs: [], itemTabMap: {} })
  const [equipmentPresets, setEquipmentPresetsState] = useState([])
  const [quickPrayers, setQuickPrayersState] = useState([])
  const [unlockedFeatures, setUnlockedFeatures] = useState(new Set())
  const [slayerTask, setSlayerTaskState] = useState(null)
  const [slayerPoints, setSlayerPointsState] = useState(0)
  const [slayerTasksCompleted, setSlayerTasksCompletedState] = useState(0)
  const [slayerMasterTaskCompletions, setSlayerMasterTaskCompletionsState] = useState({})
  const [dungeoneeringTokens, setDungeoneeringTokensState] = useState(0)
  const [slayerPerks, setSlayerPerksState] = useState({ doubleQuantity: false })
  const [characterUnlocks, setCharacterUnlocksState] = useState({ doubleSlayerXp: false, autoSlayerTask: false, extraEquipmentTabs: 0 })
  const [slayerStoreUnlocks, setSlayerStoreUnlocksState] = useState([])
  const [activeCombatSpell, setActiveCombatSpellState] = useState(null)
  const [bossKillCounts, setBossKillCountsState] = useState({})
  // Hard Mode switches, as `${sourceType}:${sourceId}` keys. A MIRROR of
  // hard_mode_targets — the server decides the doubled drop rates, this only
  // decides what the picker renders and which monster the client scales.
  const [hardModeTargets, setHardModeTargetsState] = useState([])
  const [raidKillCounts, setRaidKillCountsState] = useState({})
  // True once the per-character server KC fetch has settled (success or fail).
  // The combat screen gates its first render on this so a cold cache never
  // briefly shows KC 0.
  const [killCountsLoaded, setKillCountsLoaded] = useState(false)
  const [farming, setFarmingState] = useState({ patchesById: {} })
  const [completedQuests, setCompletedQuestsState] = useState(new Set())
  const [kingdom, setKingdomState] = useState(DEFAULT_KINGDOM)
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
  const [dailyTaskStates, setDailyTaskStates] = useState([])
  const dailyTaskStatesRef = useRef([])
  const dailyTaskDateRef = useRef(null)
  // Daily tasks load asynchronously after the boot idle catch-up runs, so events
  // fired before the first load (notably loadGame's offline catch-up) are queued
  // here and flushed once setDailyTasks lands, instead of being silently dropped.
  const dailyTasksLoadedRef = useRef(false)
  const pendingGameEventsRef = useRef([])
  const recordGameEventRef = useRef(null)
  const showInfoToastsRef = useRef(false)

  const dirty = useRef(createDirtyFlags())
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
  const slayerMasterTaskCompletionsRef = useRef({})
  const slayerPerksRef = useRef({ doubleQuantity: false })
  const characterUnlocksRef = useRef({ doubleSlayerXp: false, autoSlayerTask: false, extraEquipmentTabs: 0 })
  const slayerStoreUnlocksRef = useRef([])
  const completedQuestsRef = useRef(new Set())
  const questQueueRef = useRef([])
  const kingdomRef = useRef(DEFAULT_KINGDOM)

  // Keep activeTaskInternalRef in sync with state (handles setActiveTaskState calls that bypass setActiveTask)
  useEffect(() => { activeTaskInternalRef.current = activeTask }, [activeTask])

  // Keep worldLocationRef in sync (load, travel arrival, updateWorldLocation all set state)
  useEffect(() => { worldLocationRef.current = worldLocation }, [worldLocation])

  // Keep travelPromptRef in sync so startTravelTo can read the prompt's originating task.
  useEffect(() => { travelPromptRef.current = travelPrompt }, [travelPrompt])

  // Keep refs in sync with state
  useEffect(() => { stateRef.current.stats = stats }, [stats])
  useEffect(() => { stateRef.current.inventory = inventory }, [inventory])
  useEffect(() => { stateRef.current.equipment = equipment }, [equipment])
  useEffect(() => { stateRef.current.bank = bank }, [bank])
  useEffect(() => { stateRef.current.player = player }, [player])
  useEffect(() => { stateRef.current.bankConfig = bankConfig }, [bankConfig])
  useEffect(() => { showInfoToastsRef.current = showInfoToasts }, [showInfoToasts])
  // Re-stamp on every change (the <head> stanza only covers first paint), and
  // while the preference is 'system', follow the OS without storing anything.
  useEffect(() => {
    applyTheme(theme)
    if (theme !== 'system') return undefined
    return watchSystemTheme(() => applyTheme('system'))
  }, [theme])
  useEffect(() => { slayerTaskRef.current = slayerTask }, [slayerTask])
  useEffect(() => { slayerPointsRef.current = normalisePointCurrency(slayerPoints) }, [slayerPoints])
  useEffect(() => { dungeoneeringTokensRef.current = dungeoneeringTokens }, [dungeoneeringTokens])
  useEffect(() => { slayerTasksCompletedRef.current = Math.max(0, Math.floor(Number(slayerTasksCompleted) || 0)) }, [slayerTasksCompleted])
  useEffect(() => { slayerMasterTaskCompletionsRef.current = (slayerMasterTaskCompletions && typeof slayerMasterTaskCompletions === 'object') ? slayerMasterTaskCompletions : {} }, [slayerMasterTaskCompletions])

  // Load all state from IndexedDB — runs idle simulation inline, returns idleResult
  const loadGame = useCallback(async () => {
    let [p, s, inv, eq, b, shortcuts, stance, savedHP, autoBankSetting, savedBankConfig, savedEquipmentPresets, savedUnlocks, savedSlayerTask, savedSlayerPoints, savedSlayerTasksCompleted, savedSlayerMasterTaskCompletions, savedDungeoneeringTokens, savedBossKillCounts, savedRaidKillCounts, savedFarming, savedCompletedQuests, savedQuestQueue, savedActiveCombatSpell, savedUnlockedMinigameItems, savedIdleCombatSetup, savedSlayerPerks, savedCharacterUnlocks, savedShowInfoToasts, savedWorldLocation, savedAutoBankExcludedItems, savedBackgroundCombat, savedKingdom, savedSlayerStoreUnlocks, savedQuickPrayers, savedTheme, savedHardModeTargets] = await Promise.all([
      getPlayer(), getAllStats(), getInventory(), getEquipment(), getBank(),
      getSetting('homeShortcuts'), getSetting('combatStance'), getSetting('currentHP'),
      getSetting('autoBankLoot'), getSetting('bankConfig'), getSetting('equipmentPresets'), getSetting('unlockedFeatures'),
      getSetting('slayerTask'), getSetting('slayerPoints'), getSetting('slayerTasksCompleted'), getSetting('slayerMasterTaskCompletions'), getSetting('dungeoneeringTokens'), getSetting('bossKillCounts'), getSetting('raidKillCounts'), getSetting('farming'),
      getSetting('completedQuests'), getSetting('questQueue'), getSetting('activeCombatSpell'), getSetting('unlockedMinigameItems'),
      getSetting('idleCombatSetup'), getSetting('slayerPerks'), getSetting('characterUnlocks'),
      getSetting('showInfoToasts'), getSetting('worldLocation'), getSetting('autoBankExcludedItems'),
      getSetting('backgroundCombat'), getSetting('kingdom'), getSetting('slayerStoreUnlocks'), getSetting('quickPrayers'), getSetting('theme'), getSetting('hardModeTargets')
    ])
    const normalisedIdleCombatSetup = normaliseIdleCombatSetup(savedIdleCombatSetup)
    const autoBankExcludedItemIdsSet = new Set(savedAutoBankExcludedItems || [])
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
    savedSlayerMasterTaskCompletions = (savedSlayerMasterTaskCompletions && typeof savedSlayerMasterTaskCompletions === 'object') ? savedSlayerMasterTaskCompletions : {}
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

    // Reconcile one-life / ironman status BEFORE the idle/offline death sim runs
    // (it decides the One-Life wipe against these). The death wipe is gated on
    // `player.is_one_life` AND the localStorage flag, so they must agree with the
    // authoritative source or a one-life death is mistaken for a normal respawn.
    //   • Cloud: the localStorage flags were just set from the server character
    //     row at boot (App.initCloud → /api/me). They win — correct a stale save
    //     blob so every gate (death wipe, PvP/trade lockout, badges) matches the
    //     server, and persist the fix.
    //   • Offline: the save blob is the only source of truth → mirror it into the
    //     flags so getOneLifeMode() lines up with player.is_one_life.
    if (getToken() && getCharacterId()) {
      const authIronman = getIronmanMode()
      const authOneLife = getOneLifeMode()
      const authGrindman = getGrindmanMode()
      if (p && (!!p.is_ironman !== authIronman || !!p.is_one_life !== authOneLife || !!p.is_grindman !== authGrindman)) {
        p = { ...p, is_ironman: authIronman, is_one_life: authOneLife, is_grindman: authGrindman }
        await savePlayer(p)
      }
    } else {
      syncAccountModeFlags(p)
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
            sim = simulateIdleSkilling(savedTask, elapsedMs, b, eq, s, itemsData, inv, { isIronman: getIronmanMode(), autoBankExcludedItemIds: autoBankExcludedItemIdsSet })
          } else if (savedTask.type === 'gather' || savedTask.type === 'clue') {
            sim = simulateIdleGather(savedTask, elapsedMs, inv, s, itemsData, b, { autoBankExcludedItemIds: autoBankExcludedItemIdsSet })
          } else if (savedTask.type === 'combat') {
            const idleHpForLoad = savedHP != null ? savedHP : (s.hitpoints ? getLevelFromXP(s.hitpoints.xp) : 10)
            sim = simulateIdleCombatChain(savedTask, elapsedMs, s, eq, inv, itemsData, savedSlayerTask, b, {
              currentHP: idleHpForLoad,
              idleFood: normalisedIdleCombatSetup.food,
              idlePotions: normalisedIdleCombatSetup.potions,
              idlePrayers: normalisedIdleCombatSetup.prayers,
              prayersData,
              doubleSlayerXp: !!(savedCharacterUnlocks?.doubleSlayerXp),
              autoSlayer: !!(savedCharacterUnlocks?.autoSlayerTask),
              slayerPerks: savedSlayerPerks && typeof savedSlayerPerks === 'object' ? savedSlayerPerks : null,
              completedQuests: savedCompletedQuests || [],
              autoBankExcludedItemIds: autoBankExcludedItemIdsSet,
              isGrindman: p?.is_grindman === true,
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
          let hardModeDeathApplied = false
          // Snapshot for the daily-task feed below — savedTask is reassigned by
          // the quest cascade and cleared on an offline death before we emit.
          const idleTask = savedTask

          // ── Shared apply layer (also used by MCP intents.js via applyTaskResult) ──
          // Build a normalised state object, apply the simulation result in place,
          // then read back the two primitive fields that may have changed.
          const applySettings = { currentHP: savedHP, dungeoneeringTokens: savedDungeoneeringTokens }
          const applyState = { stats: s, inventory: inv, bank: b, equipment: eq, settings: applySettings }
          const applied = applyTaskResult(applyState, sim, savedTask.type, { isGrindman: p?.is_grindman === true })
          // The catch-up modal and the daily-task feed both read sim.xpGained, so it
          // becomes what was BANKED — a Grindman's cut would otherwise be invisible
          // in the summary and double-counted against daily XP tasks.
          if (savedTask.type !== 'quest' && sim.xpGained) sim.xpGained = applied.xpBanked
          inv = applyState.inventory  // may be sim.finalInventory (new array ref)
          // Offline catch-up burns a whole window's supplies and materials in one
          // write. Declare it, or every return from a long absence reads as an
          // item-loss incident (src/engine/lossLedger.js).
          recordItemLosses(applied.consumed)

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
            // A hard fight that killed the player while the app was closed costs
            // the same pack a live one does. Applied to the post-simulation
            // holdings, so supplies eaten on the way down are already gone and
            // loot banked before the killing blow is kept.
            if (idleTaskDiedHard(savedTask)) {
              const loss = hardModeDeathLoss(inv, eq, itemsData)
              inv = loss.inventory
              eq = loss.equipment
              hardModeDeathApplied = true
              sim.hardModeItemsLost = loss.lost
              recordItemLossEntries(loss.lost)
            }
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

          // Save equipment if ammo or charges changed during combat, or if a
          // hard-mode death stripped what was worn.
          if (savedTask.type === 'combat' && (sim.ammoConsumed || sim.chargesConsumed > 0 || hardModeDeathApplied)) {
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
          if (savedTask.type === 'combat' && Array.isArray(sim.slayerCompletions) && sim.slayerCompletions.length > 0) {
            // Auto-slayer chain: award every task cleared this window (streak
            // milestones fold in), then persist the final in-progress task.
            const loop = resolveSlayerLoopRewards(sim.slayerCompletions, savedSlayerTasksCompleted)
            const newSlayerPoints = normalisePointCurrency(savedSlayerPoints) + loop.pointsEarned
            await saveSetting('slayerPoints', newSlayerPoints)
            await saveSetting('slayerTasksCompleted', loop.totalTasks)
            await saveSetting('slayerTask', sim.slayerTaskUpdate || null)
            savedSlayerPoints = newSlayerPoints
            savedSlayerTasksCompleted = loop.totalTasks
            for (const completion of sim.slayerCompletions) {
              if (completion.masterId) {
                savedSlayerMasterTaskCompletions = { ...savedSlayerMasterTaskCompletions, [completion.masterId]: (savedSlayerMasterTaskCompletions[completion.masterId] || 0) + 1 }
              }
            }
            await saveSetting('slayerMasterTaskCompletions', savedSlayerMasterTaskCompletions)
          } else if (savedTask.type === 'combat' && sim.slayerTaskUpdate) {
            if (sim.slayerTaskUpdate.completed) {
              // Task complete — clear it and award points
              await saveSetting('slayerTask', null)
              const reward = getSlayerTaskReward(sim.slayerTaskUpdate.pointsOnComplete, savedSlayerTasksCompleted)
              const newSlayerPoints = normalisePointCurrency(savedSlayerPoints) + reward.pointsEarned
              await saveSetting('slayerPoints', newSlayerPoints)
              await saveSetting('slayerTasksCompleted', reward.totalTasks)
              savedSlayerPoints = newSlayerPoints
              savedSlayerTasksCompleted = reward.totalTasks
              if (savedSlayerTask?.masterId) {
                savedSlayerMasterTaskCompletions = { ...savedSlayerMasterTaskCompletions, [savedSlayerTask.masterId]: (savedSlayerMasterTaskCompletions[savedSlayerTask.masterId] || 0) + 1 }
                await saveSetting('slayerMasterTaskCompletions', savedSlayerMasterTaskCompletions)
              }
            } else {
              // Task in progress — update monstersRemaining
              await saveSetting('slayerTask', sim.slayerTaskUpdate)
            }
          }
          // Auto-slayer chain switched tasks: point the active combat task at the
          // current slayer monster so live play stays on-task and the next idle
          // window re-engages the chain.
          if (savedTask.type === 'combat' && sim.autoSlayerChained && sim.finalTaskMonster && !diedDuringIdle) {
            savedTask = { ...savedTask, monster: sim.finalTaskMonster }
            try { localStorage.setItem('pocketrpg_activeTask', JSON.stringify(savedTask)) } catch {}
          }

          // Quest sim handling: shared cascade helper for boot/load idle
          if (savedTask.type === 'quest') {
            // Levels gained across the whole cascade, keyed by skill — `from`
            // stays the level before the first grant, `to` follows the running
            // total, so a skill spanning several quests reports one span. Fed
            // into the reward-reveal card / full-screen level-up overlay
            // instead of a toast (this boot path never shows toasts anyway).
            const levelUpsMap = new Map()
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
                  const before = s[skill].xp || 0
                  const from = getLevelFromXP(before)
                  const newXP = Math.min(before + Math.floor(xp), 200000000)
                  const to = getLevelFromXP(newXP)
                  s[skill] = { ...s[skill], xp: newXP, level: to }
                  if (to > from) {
                    const existing = levelUpsMap.get(skill)
                    levelUpsMap.set(skill, { skill, from: existing ? existing.from : from, to })
                  }
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
              levelUps: [...levelUpsMap.values()],
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

          // Feed offline catch-up gains into the daily-task tracker. This path
          // applies XP/items straight to raw state (not via grantXP), so unlike
          // live play and the visibility-return handler it emits nothing on its
          // own — and it's the ONLY catch-up on a cold boot, so inactive
          // agility / AFK combat never counted. recordGameEvent queues these
          // until the daily-tasks fetch lands (see setDailyTasks). Uses the
          // snapshot task since savedTask may have been cleared on an idle death.
          const record = recordGameEventRef.current
          if (record) for (const evt of idleCatchupDailyEvents(idleTask, sim)) record(evt)

          idleResult = { elapsedMs, task: savedTask, ...sim }
        }
        // Travel resolves offline (no rewards, no modal): advance the countdown
        // by elapsed time and either land the player at the destination or keep
        // the reduced in-progress trip for the live tick to finish. A journey
        // (Phase 5) chains its legs/searches through the elapsed time; if it
        // finished while away it is parked on its final search at 0 ticks and
        // the App's first live tick completes the clue/quest (granting rewards
        // needs App-level helpers this load path doesn't have).
        if (savedTask && savedTask.type === 'travel') {
          if (savedTask.journey) {
            const adv = advanceJourneyOffline(savedTask, elapsedMs)
            if (adv.location) {
              savedWorldLocation = normaliseLocation(adv.location)
              await saveSetting('worldLocation', savedWorldLocation)
            }
            savedTask = adv.task
            try { localStorage.setItem('pocketrpg_activeTask', JSON.stringify(savedTask)) } catch {}
          } else {
            const adv = advanceTravel(savedTask, elapsedMs)
            if (adv.arrived) {
              savedWorldLocation = savedTask.dest
              await saveSetting('worldLocation', normaliseLocation(savedTask.dest))
              savedTask = null
              try { localStorage.removeItem('pocketrpg_activeTask'); localStorage.removeItem('pocketrpg_lastTick') } catch {}
            } else {
              savedTask = adv.task
              try { localStorage.setItem('pocketrpg_activeTask', JSON.stringify(savedTask)) } catch {}
            }
          }
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

    // Kingdom of Royals: passive background sim, independent of whatever the
    // active task is. Settles on its own lastTickAt, not the 24h-capped
    // elapsedMs above — output self-limits once the coffer runs dry, so an
    // absence longer than the coffer's ~10-day runtime is cheap to fast-forward.
    // Gathered loot accumulates in pendingLoot — it does NOT auto-bank; the
    // player withdraws it manually from the Kingdom screen.
    const normalisedKingdom = normaliseKingdomState(savedKingdom)
    const kingdomNow = Date.now()
    const kingdomElapsedMs = normalisedKingdom.lastTickAt ? Math.max(0, kingdomNow - normalisedKingdom.lastTickAt) : 0
    const kingdomSim = simulateKingdom(normalisedKingdom, s, kingdomElapsedMs, itemsData)
    const loadedKingdom = {
      ...normalisedKingdom,
      cofferBalance: kingdomSim.cofferBalance,
      lastTickAt: kingdomNow,
      pendingLoot: mergeLoot(normalisedKingdom.pendingLoot, kingdomSim.itemsGained),
    }
    kingdomRef.current = loadedKingdom
    saveSetting('kingdom', loadedKingdom)

    const loadedPlayer = p
    const loadedStats = { ...s }
    const loadedInventory = [...inv]
    const loadedEquipment = eq
    const loadedBank = { ...b }
    setPlayer(loadedPlayer)
    setKingdomState(loadedKingdom)
    setStats(loadedStats)
    setInventory(loadedInventory)
    setEquipment(loadedEquipment)
    setBank(loadedBank)
    // Sync the snapshot ref in lockstep with the freshly loaded character. The
    // per-field effects that normally mirror state into stateRef only run after
    // the next render — too late for a getSnapshot() called synchronously after
    // `await loadGame()`. The new-character seed push (App.initCloudAndSave) does
    // exactly that, so without this it would snapshot the PREVIOUSLY loaded
    // character's stats and write them to the new character's save row, which the
    // server then rejects forever as a total-level regression (e.g. switching
    // accounts in one session: old total 56 written over the new account, whose
    // real saves at total 46 are then refused).
    stateRef.current.player = loadedPlayer
    stateRef.current.stats = loadedStats
    stateRef.current.inventory = loadedInventory
    stateRef.current.equipment = loadedEquipment
    stateRef.current.bank = loadedBank
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
    setAutoBankExcludedItemsState(autoBankExcludedItemIdsSet)
    setShowInfoToastsState(savedShowInfoToasts === true) // default false
    setBackgroundCombatState(savedBackgroundCombat === true) // default false
    // Cross-device convenience only: a locally stored choice always wins, so
    // the save mirror can never override what this device is already showing.
    if (!readStoredThemePreference() && savedTheme) {
      const mirrored = normalizeThemePreference(savedTheme)
      setThemeState(mirrored)
      storeThemePreference(mirrored)
      applyTheme(mirrored)
    }
    const loadedWorldLocation = normaliseLocation(savedWorldLocation) // un-migrated saves → start place
    worldLocationRef.current = loadedWorldLocation
    setWorldLocationState(loadedWorldLocation)
    setBankConfig(savedBankConfig ?? { tabs: [], itemTabMap: {} })
    setEquipmentPresetsState(Array.isArray(savedEquipmentPresets) ? savedEquipmentPresets : [])
    setQuickPrayersState(Array.isArray(savedQuickPrayers) ? savedQuickPrayers : [])
    setUnlockedFeatures(new Set(savedUnlocks || []))
    setActiveTaskState(savedTask ?? null)
    // Update slayer task if idle simulation modified it
    const finalSlayerTask = idleResult && idleResult.slayerTaskUpdate
      ? (idleResult.slayerTaskUpdate.completed ? null : idleResult.slayerTaskUpdate)
      : (savedSlayerTask ?? null)
    slayerTaskRef.current = finalSlayerTask
    slayerPointsRef.current = normalisePointCurrency(savedSlayerPoints)
    slayerTasksCompletedRef.current = savedSlayerTasksCompleted
    slayerMasterTaskCompletionsRef.current = (savedSlayerMasterTaskCompletions && typeof savedSlayerMasterTaskCompletions === 'object') ? savedSlayerMasterTaskCompletions : {}
    setSlayerTaskState(finalSlayerTask)
    setSlayerPointsState(slayerPointsRef.current)
    setSlayerTasksCompletedState(slayerTasksCompletedRef.current)
    setSlayerMasterTaskCompletionsState(slayerMasterTaskCompletionsRef.current)
    setDungeoneeringTokensState(savedDungeoneeringTokens)
    setActiveCombatSpellState(savedActiveCombatSpell ?? null)
    setBossKillCountsState(savedBossKillCounts ?? {})
    setHardModeTargetsState(Array.isArray(savedHardModeTargets) ? savedHardModeTargets : [])
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
    const loadedCharacterUnlocks = savedCharacterUnlocks && typeof savedCharacterUnlocks === 'object' ? savedCharacterUnlocks : { doubleSlayerXp: false, autoSlayerTask: false, extraEquipmentTabs: 0 }
    characterUnlocksRef.current = loadedCharacterUnlocks
    setCharacterUnlocksState(loadedCharacterUnlocks)
    const loadedSlayerStoreUnlocks = Array.isArray(savedSlayerStoreUnlocks) ? savedSlayerStoreUnlocks : []
    slayerStoreUnlocksRef.current = loadedSlayerStoreUnlocks
    setSlayerStoreUnlocksState(loadedSlayerStoreUnlocks)
    const hpLevel = s.hitpoints ? getLevelFromXP(s.hitpoints.xp) : 10
    setCurrentHP(savedHP != null ? Math.min(savedHP, hpLevel) : hpLevel)
    setLoaded(true)
    return idleResult
  }, [])

  // Write every dirty store to IndexedDB now. `autoSave` debounces this; anything
  // that must not be readable in its pre-change form by another code path (a
  // loadout swap, the tab going to background) calls flushLocalSaves directly.
  // The idle catch-up paths re-read these stores from IDB and write their result
  // back, so a store left behind by the debounce is a store that gets reverted.
  const inFlightLocalSaveRef = useRef(null)
  const autoSaveRef = useRef(null)
  const runLocalSave = useCallback(async () => {
    // Join an in-flight flush before deciding there is nothing to do: that flush
    // has already claimed the flags, so returning early here would make `await
    // flushLocalSaves()` resolve while the writes it is meant to guarantee are
    // still open — and the idle catch-up paths await it precisely as a barrier
    // before re-reading these stores.
    const inFlight = inFlightLocalSaveRef.current
    if (inFlight) await inFlight.catch(() => {})
    const claimed = claimDirtyFlags(dirty.current)
    if (!hasDirtyFlags(claimed)) return
    const s = stateRef.current
    const promises = []
    if (claimed.stats) promises.push(saveAllStats(s.stats))
    if (claimed.inventory) promises.push(saveInventory(s.inventory))
    if (claimed.equipment) promises.push(saveEquipment(s.equipment))
    if (claimed.bank) promises.push(saveBank(s.bank))
    if (claimed.player && s.player) promises.push(savePlayer(s.player))
    setIsSaving(true)
    const run = (async () => {
      try {
        await Promise.all(promises)
      } catch (err) {
        // Put the claim back AND re-arm the debounce — a restored flag nothing
        // retries just waits for an unrelated mutation to happen along.
        restoreDirtyFlags(dirty.current, claimed)
        autoSaveRef.current?.()
        throw err
      } finally {
        setIsSaving(false)
        if (inFlightLocalSaveRef.current === run) inFlightLocalSaveRef.current = null
      }
    })()
    inFlightLocalSaveRef.current = run
    await run
  }, [])
  const runLocalSaveRef = useRef(runLocalSave)
  runLocalSaveRef.current = runLocalSave

  const autoSave = useCallback(debounce(() => {
    runLocalSaveRef.current().catch(e => console.warn('[PocketRPG] Local save failed:', e?.message || e))
  }, AUTO_SAVE_DEBOUNCE), [])
  autoSaveRef.current = autoSave

  const flushLocalSaves = useCallback(async () => { await runLocalSaveRef.current() }, [])

  // Mark dirty and trigger save
  const markDirty = useCallback((key) => {
    dirty.current[key] = true
    autoSave()
  }, [autoSave])

  // ── Mutations ──

  // One-life death: revert the character's is_one_life flag (server first,
  // then mirror locally) instead of wiping it. Ironman one-life reverts to
  // plain Ironman; normal one-life reverts to a plain normal account — either
  // way the save, level and progress are untouched, only the flag flips.
  // Offline/local-only play has no cloud character, so the local flag (the
  // save's only source of truth in that mode) is flipped directly.
  const revertOneLifeMode = useCallback(async () => {
    const isIronman = !!stateRef.current.player?.is_ironman
    try {
      if (getToken()) await resetOneLifeWithRetry()
    } catch (err) {
      console.error('One-life revert failed; will retry on the next death:', err)
      return { ok: false, isIronman }
    }
    const nextPlayer = stateRef.current.player ? { ...stateRef.current.player, is_one_life: false } : stateRef.current.player
    stateRef.current.player = nextPlayer
    setPlayer(nextPlayer)
    syncAccountModeFlags({ is_ironman: isIronman, is_one_life: false })
    markDirty('player')
    return { ok: true, isIronman }
  }, [markDirty])

  // `silent` (quest completions — App.jsx): skip the toast, since those flows
  // surface level-ups through the reward-reveal card / full-screen overlay
  // instead. Max HP still updates on a silent Hitpoints level-up.
  const grantXP = useCallback((skill, amount, { silent = false } = {}) => {
    // stateRef is written synchronously here for the same reason the holdings
    // mutators do it: flushLocalSaves reads stateRef and CLEARS the dirty flag,
    // so an unload-time flush that ran before the post-commit effect would
    // persist the pre-XP stats and mark them clean — losing the XP outright.
    // Grindman's half XP is applied HERE and nowhere else on the client: every
    // client XP source — live combat, skilling, quests, idle catch-up — funnels
    // through this callback, so a caller that computes an XP number never has
    // to know the account type. World and co-op XP are granted server-side and
    // take the cut there.
    amount = grindmanXP(amount, stateRef.current.player?.is_grindman === true)
    {
      const prev = stateRef.current.stats
      const cur = prev[skill] || { skill, xp: 0, level: 1 }
      const newXP = clampXP(cur.xp + Math.floor(amount))
      const newLevel = getLevelFromXP(newXP)
      const oldLevel = cur.level

      if (newLevel > oldLevel) {
        if (!silent) {
          const skillName = skill.charAt(0).toUpperCase() + skill.slice(1)
          const SKILL_ICONS = {
            attack: '⚔️', strength: '💪', defence: '🛡️', hitpoints: '❤️',
            ranged: '🏹', magic: '🔮', prayer: '🙏',
            mining: '⛏️', woodcutting: '🪓', fishing: '🎣', farming: '🌾', hunter: '🪤',
            smithing: '🔨', cooking: '🍳', crafting: '✂️', fletching: '🏹', herblore: '🧪', runecraft: '🔴',
            agility: '🏃', thieving: '🗝️', slayer: '💀', firemaking: '🔥', construction: '🏠', dungeoneering: '🏰', summoning: '🐾'
          }
          const icon = SKILL_ICONS[skill] || '⭐'
          const msg = `Congratulations! Your ${skillName} is now ${newLevel}`
          addToast(msg, 'levelup', icon)
        }
        // If hitpoints levelled, update max HP
        if (skill === 'hitpoints') {
          setCurrentHP(prev => Math.min(prev + (newLevel - oldLevel), newLevel))
        }
      }

      const next = { ...prev, [skill]: { skill, xp: newXP, level: newLevel } }
      stateRef.current.stats = next
      setStats(next)
      markDirty('stats')
    }
    // Feed XP gains to the daily-task event bus (live + idle/offline all funnel
    // through grantXP). Floor to keep task progress integer-aligned with displayed XP.
    const gained = Math.floor(amount)
    if (gained > 0) recordGameEventRef.current?.({ kind: 'skill_xp', skill, xp: gained })
    // Returned so a caller that also REPORTS the gain (the idle catch-up modal)
    // can show what was banked rather than what it asked for — the two differ by
    // the Grindman cut, and a summary that over-reports is a bug the player sees.
    return gained
    // addToast is deliberately NOT a dep: it is declared below this callback, so
    // naming it here evaluates in its temporal dead zone and whites out the app.
    // Calling it from the body resolves at call time and is fine.
  }, [markDirty])

  // The three holdings mutators write stateRef SYNCHRONOUSLY as well as setting
  // state. stateRef is what flushLocalSaves / getSnapshot / getHoldings read, and
  // it used to be updated by a post-commit useEffect — so for a frame after any
  // mutation those readers saw the pre-change holdings. A 600ms background
  // activity tick or a tab-hide landing in that window read stale holdings and
  // wrote them back over the change. The effects below still run; they are now
  // belt-and-braces rather than the only sync.
  const updateInventory = useCallback((newInv) => {
    const next = [...newInv]
    stateRef.current.inventory = next
    setInventory(next)
    markDirty('inventory')
  }, [markDirty])

  const updateEquipment = useCallback((newEq) => {
    const next = { ...newEq }
    stateRef.current.equipment = next
    setEquipment(next)
    markDirty('equipment')
  }, [markDirty])

  const updateBank = useCallback((newBank) => {
    // Wholesale bank replacement is the one funnel every screen writes through,
    // so the charge-preservation invariant (src/engine/bankCharges.js) is
    // enforced here rather than trusted to each call site.
    const next = { ...preserveBankCharges(stateRef.current.bank, newBank) }
    stateRef.current.bank = next
    setBank(next)
    markDirty('bank')
  }, [markDirty])

  const removeFromInventory = useCallback((slotIndex, qty = 1) => {
    const next = [...stateRef.current.inventory]
    if (next[slotIndex]) {
      const newQty = next[slotIndex].quantity - qty
      next[slotIndex] = newQty <= 0 ? null : { ...next[slotIndex], quantity: newQty }
    }
    stateRef.current.inventory = next
    setInventory(next)
    markDirty('inventory')
  }, [markDirty])

  const addToBank = useCallback((itemId, qty) => {
    const isNew = !stateRef.current.bank[itemId]
    const next = applyBankDeltas(stateRef.current.bank, { [itemId]: qty })
    stateRef.current.bank = next
    setBank(next)
    markDirty('bank')
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

  // Synchronous read of the holdings as they stand right now — always current,
  // unlike the render props, which are a commit behind any mutation made in the
  // same frame. Callers that compute a whole new container from the old one (the
  // background activity runner, loot deposits) must read through this or they
  // rebuild from state the player has already moved on from.
  // Same synchronous-stateRef rule as the holdings mutators and grantXP: the
  // flush reads stateRef and clears the dirty flag, so a post-commit-only sync
  // can be persisted-then-marked-clean in its pre-change form.
  const setPlayerSynced = useCallback((nextOrFn) => {
    const next = typeof nextOrFn === 'function' ? nextOrFn(stateRef.current.player) : nextOrFn
    stateRef.current.player = next
    setPlayer(next)
    markDirty('player')
  }, [markDirty])

  const getHoldings = useCallback(() => ({
    equipment: stateRef.current.equipment,
    inventory: stateRef.current.inventory,
    bank: stateRef.current.bank,
  }), [])

  // Apply a whole-holdings rearrangement (loadout preset) and make it durable
  // before returning. Ordinary mutations ride the 300ms debounce, but these three
  // containers only balance as a set: if the IDB copy of one lands and another
  // does not, the items that moved between them exist in neither. Awaiting the
  // flush also closes the window in which a background tick or a tab-hide could
  // read the pre-swap holdings back out of IDB.
  const commitHoldings = useCallback(async ({ equipment, inventory, bank }) => {
    if (equipment) updateEquipment(equipment)
    if (inventory) updateInventory(inventory)
    if (bank) updateBank(bank)
    await flushLocalSaves()
    requestCriticalPushSave(() => getSnapshotImplRef.current(), CRITICAL_SAVE_REASONS.HOLDINGS_REARRANGE)
  }, [updateEquipment, updateInventory, updateBank, flushLocalSaves])

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

  const updateWorldLocation = useCallback((placeId) => {
    const next = normaliseLocation(placeId)
    worldLocationRef.current = next
    setWorldLocationState(next)
    saveSetting('worldLocation', next)
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

  const toggleAutoBankExclusion = useCallback((itemId) => {
    setAutoBankExcludedItemsState(prev => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      saveSetting('autoBankExcludedItems', [...next])
      return next
    })
  }, [])

  const updateShowInfoToasts = useCallback((enabled) => {
    showInfoToastsRef.current = enabled
    setShowInfoToastsState(enabled)
    saveSetting('showInfoToasts', enabled)
  }, [])

  const updateBackgroundCombat = useCallback((enabled) => {
    setBackgroundCombatState(enabled)
    saveSetting('backgroundCombat', enabled)
  }, [])

  // localStorage first: the save is locked during PvP/co-op/world sessions, so
  // a theme changed mid-fight must not depend on the save push landing.
  const updateTheme = useCallback((preference) => {
    const next = normalizeThemePreference(preference)
    setThemeState(next)
    storeThemePreference(next)
    applyTheme(next)
    saveSetting('theme', next)
  }, [])

  // CombatScreen publishes its live fight snapshot here (or null on stop/unmount)
  // so the desktop combat indicator and the background-combat host can react
  // without reaching into the screen. Skip redundant identical updates so an
  // unchanged tick doesn't churn every context consumer.
  const combatStatusSigRef = useRef('null')
  const publishCombatStatus = useCallback((status) => {
    const sig = status
      ? `${status.active}|${status.busy}|${status.backgroundable}|${status.monsterId}|${status.monsterHP}|${status.monsterMaxHP}`
      : 'null'
    if (sig === combatStatusSigRef.current) return
    combatStatusSigRef.current = sig
    setCombatStatus(status)
  }, [])

  const updateBankConfig = useCallback((config) => {
    setBankConfig(config)
    saveSetting('bankConfig', config)
  }, [])

  const updateEquipmentPresets = useCallback((presets) => {
    const next = Array.isArray(presets) ? presets : []
    setEquipmentPresetsState(next)
    saveSetting('equipmentPresets', next)
  }, [])

  const updateQuickPrayers = useCallback((prayerIds) => {
    const next = Array.isArray(prayerIds) ? prayerIds : []
    setQuickPrayersState(next)
    saveSetting('quickPrayers', next)
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

  // `value` may be an updater fn — repeatable unlocks (extra equipment tabs)
  // increment off the ref so two purchases in flight can't both read the same
  // stale count from a render.
  const updateCharacterUnlock = useCallback((key, value) => {
    const prev = characterUnlocksRef.current
    const next = { ...prev, [key]: typeof value === 'function' ? value(prev[key]) : value }
    characterUnlocksRef.current = next
    setCharacterUnlocksState(next)
    saveSetting('characterUnlocks', next)
  }, [])

  // Records a slayer unlockable as coin-purchasable in the store — set the first
  // time it's bought with slayer points. Idempotent (deduped set union).
  const addSlayerStoreUnlock = useCallback((itemId) => {
    if (!itemId || slayerStoreUnlocksRef.current.includes(itemId)) return
    const next = [...slayerStoreUnlocksRef.current, itemId]
    slayerStoreUnlocksRef.current = next
    setSlayerStoreUnlocksState(next)
    saveSetting('slayerStoreUnlocks', next)
  }, [])

  // Replaces the mirror wholesale from the server's own list — the server is the
  // only writer, so merging a stale local copy in would resurrect a switch the
  // player turned off on another device.
  const syncHardModeTargets = useCallback((keys) => {
    const next = Array.isArray(keys) ? [...new Set(keys)] : []
    setHardModeTargetsState(next)
    saveSetting('hardModeTargets', next)
  }, [])

  // Local echo of one accepted server write. The caller has already had its POST
  // acknowledged — a failed write must never reach here, or the client fights a
  // doubled boss for normal drop rates.
  const applyHardModeTarget = useCallback((key, enabled) => {
    setHardModeTargetsState((prev) => {
      const set = new Set(prev)
      if (enabled) set.add(key)
      else set.delete(key)
      const next = [...set]
      saveSetting('hardModeTargets', next)
      return next
    })
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

  const updateKingdom = useCallback((next) => {
    kingdomRef.current = next
    setKingdomState(next)
    saveSetting('kingdom', next)
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

  // Direct bank update without inventory changes (for skill/gather item routing).
  // `charges` pools an auto-banked item's charges onto its entry — a bank trip
  // that carried charged gear must not drop them (src/engine/bankCharges.js).
  const updateBankDirect = useCallback((itemUpdates, { charges = null } = {}) => {
    const next = applyBankDeltas(stateRef.current.bank, itemUpdates, charges)
    // A negative delta here is an itemised, deliberate spend — recipe inputs for
    // a live or caught-up production task, idle supplies. Declaring it stops the
    // server's item-loss detector reading routine idling as destruction
    // (src/engine/lossLedger.js). Measured against the bank we actually held, so
    // a delta the bank could not cover declares only what it really took.
    recordItemLosses(bankUnitsRemoved(stateRef.current.bank, next, itemUpdates))
    stateRef.current.bank = next
    setBank(next)
    markDirty('bank')
  }, [markDirty])

  // Settle elapsed kingdom time (coffer drain + banked output) up to `now`.
  // Independent of the active-task idle dispatch — called at boot (inline,
  // see loadGame), on visibility-return, on skip-hour, and on the live 60s
  // tick so the coffer visibly drains while the app is open.
  // Always returns the current, ref-backed kingdom object — settled if
  // enough time had passed to warrant it, unchanged otherwise. Callers
  // should use this return value (not the `kingdom` render prop) when
  // building the next update: `kingdomRef.current` is synchronously fresh,
  // while `kingdom` is only as fresh as the last completed render, so a
  // burst of rapid clicks reading the render prop would each compute their
  // delta off the same stale snapshot and clobber each other.
  const settleKingdom = useCallback((now = Date.now()) => {
    const current = kingdomRef.current
    if (!current.lastTickAt) return current
    const elapsedMs = Math.max(0, now - current.lastTickAt)
    if (elapsedMs < 2000) return current
    const sim = simulateKingdom(current, stateRef.current.stats, elapsedMs, itemsData)
    const next = {
      ...current,
      cofferBalance: sim.cofferBalance,
      lastTickAt: now,
      pendingLoot: mergeLoot(current.pendingLoot, sim.itemsGained),
    }
    updateKingdom(next)
    return next
  }, [updateKingdom])

  // Skip-1h: advance the kingdom by an extra `skipMs` of production on top of
  // any real elapsed time, WITHOUT pushing lastTickAt into the future — so the
  // live 60s tick keeps settling real wall-clock time afterwards. The old
  // future-stamp (settleKingdom(now + skipMs)) froze the coffer and loot for
  // the whole skipped hour and made repeat skips near no-ops.
  const applyKingdomSkip = useCallback((skipMs) => {
    settleKingdom(Date.now())            // fold in real elapsed time first
    const current = kingdomRef.current
    if (!current.lastTickAt) return current
    const next = applyKingdomWindow(current, stateRef.current.stats, skipMs, itemsData)
    updateKingdom(next)
    return next
  }, [settleKingdom, updateKingdom])

  // ── Toasts ──
  const addToast = useCallback((message, type = 'info', icon = null) => {
    if (type === 'info' && !showInfoToastsRef.current) return
    const id = Date.now() + Math.random()
    // Reward-style toasts (level ups, collection-log unlocks) linger a little
    // longer so the player can read the richer card before it auto-clears.
    const ttl = (type === 'levelup' || type === 'reward') ? 6000 : 3500
    setToasts(prev => [...prev, { id, message, type, icon, ttl }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, ttl)
  }, [])

  const dismissToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  // ── Inventory-full prompt (active skilling/gathering) ──
  // Drivers (the activity screens and the App-level background runner) call
  // these each tick. `signal` raises the prompt the first time an action is
  // blocked by a full inventory; once the player dismisses it, it stays paused
  // without re-prompting. `resolve` clears the state the moment a slot frees so
  // a later fill starts a fresh prompt.
  const signalInventoryFull = useCallback(() => {
    setInventoryFull(v => (v === 'none' ? 'prompt' : v))
  }, [])
  const dismissInventoryFullPrompt = useCallback(() => {
    setInventoryFull(v => (v === 'none' ? v : 'dismissed'))
  }, [])
  const resolveInventoryFull = useCallback(() => {
    setInventoryFull(v => (v === 'none' ? v : 'none'))
  }, [])

  // Phase 3 activity gating: a pure gate the activity screens call before starting a
  // fresh action. Returns true if the caller may start now (it keeps its own
  // setActiveTask call), false if the start was blocked (travelling) or deferred to a
  // travel prompt. When the world map is off, always allow (menu-driven fallback).
  // `task` only needs the shape `activityRef` reads (type + the relevant id).
  // Defined after addToast so its dependency closure isn't in the TDZ at render time.
  const requestActivityStart = useCallback((task) => {
    if (!isWorldMapEnabled()) return true
    const travelActive = activeTaskInternalRef.current?.type === 'travel'
    const res = resolveTaskStart(task, { location: worldLocationRef.current, travel: travelActive })
    if (res.status === 'start') return true
    if (res.status === 'blocked-transit') {
      addToast("You can't start that while travelling.", 'info')
      return false
    }
    setTravelPrompt({ task, ...(activityRef(task) || {}), places: res.places })
    return false
  }, [addToast, setActiveTask])

  // Confirm a travel prompt: begin travelling to the chosen place. The action that
  // triggered the prompt is embedded in the travel task as `autoStart` so arrival can
  // resume it automatically (start combat/skilling on reaching the place, even while
  // idling). `returnTo` ({ screen, data }) is the screen the player was on when they
  // confirmed travel — carried the same way so arrival's back/stop buttons return
  // there instead of a hardcoded destination. Manual map travel goes through
  // WorldMapScreen's own createTravelTask call with no autoStart, so it still just
  // lands at the destination.
  const startTravelTo = useCallback((placeId, returnTo) => {
    const autoStart = autoStartFromTask(travelPromptRef.current?.task)
    const task = createTravelTask(worldLocationRef.current, placeId, autoStart, returnTo)
    if (task) setActiveTask(task)
    setTravelPrompt(null)
  }, [setActiveTask])

  const dismissTravelPrompt = useCallback(() => setTravelPrompt(null), [])

  // Returns a fresh snapshot of all live state. Long-lived handlers (the
  // pagehide/beforeunload beacon, the onTick loop) capture getSnapshot once and
  // hold it for the session, so the exported identity must be stable while the
  // values stay current: each render re-points getSnapshotImplRef at a closure
  // over this render's state, and the stable wrapper delegates through the ref.
  // worldLocation additionally reads its ref so a snapshot taken in the same
  // tick as a travel arrival (before the re-render commits) sees the new place.
  const getSnapshotImplRef = useRef(null)
  getSnapshotImplRef.current = () => ({
    player: stateRef.current.player,
    stats: stateRef.current.stats,
    inventory: stateRef.current.inventory,
    bank: stateRef.current.bank,
    equipment: stateRef.current.equipment,
    settings: {
      currentHP,
      autoBankLoot,
      autoBankExcludedItems: [...autoBankExcludedItems],
      bankConfig,
      showInfoToasts,
      backgroundCombat,
      theme,
      equipmentPresets,
      quickPrayers,
      homeShortcuts,
      combatStance,
      worldLocation: worldLocationRef.current,
      idleCombatSetup,
      unlockedFeatures: [...unlockedFeatures],
      activeTask,
      activeCombatSpell,
      slayerTask: slayerTaskRef.current,
      slayerPoints: slayerPointsRef.current,
      slayerTasksCompleted: slayerTasksCompletedRef.current,
      slayerMasterTaskCompletions: slayerMasterTaskCompletionsRef.current,
      dungeoneeringTokens: dungeoneeringTokensRef.current,
      bossKillCounts,
      raidKillCounts,
      farming,
      completedQuests: [...completedQuestsRef.current],
      unlockedMinigameItems: [...unlockedMinigameItems],
      questQueue: questQueueRef.current,
      slayerPerks: slayerPerksRef.current,
      characterUnlocks: characterUnlocksRef.current,
      slayerStoreUnlocks: slayerStoreUnlocksRef.current,
      kingdom: kingdomRef.current,
    },
  })
  const getSnapshot = useCallback(() => getSnapshotImplRef.current(), [])


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
  // save-revision conflict the push loop stops (the app rolls back to the
  // authoritative cloud copy in place, behind its own overlay). Used by the
  // manual Save button.
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
      unlockGame()
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

  // Equipment presets persist to IndexedDB immediately (updateEquipmentPresets),
  // but that alone leaves them only on this device until the 60s autosave reaches
  // the cloud — so a preset saved just before the tab/container closes could be
  // lost. Treat any preset change as a critical save so it's pushed to the cloud
  // promptly. The first post-load run is hydration (loading existing presets),
  // which must not trigger a redundant push.
  const presetsHydratedRef = useRef(false)
  useEffect(() => {
    if (!loaded) return
    if (!presetsHydratedRef.current) { presetsHydratedRef.current = true; return }
    requestCriticalPushSave(() => getSnapshot(), CRITICAL_SAVE_REASONS.EQUIPMENT_PRESET_CHANGE)
  }, [loaded, equipmentPresets, getSnapshot])

  // Bank tab layout and the info-toast suppression toggle ride the save blob
  // (getSnapshot.settings) too, but the 60s autosave can drop a just-made change
  // if the tab/container closes first — the same loss the presets push above
  // guards against. Push each critically so a tab reorg or a toggle reaches the
  // cloud promptly. First post-load run is hydration; skip it.
  const quickPrayersHydratedRef = useRef(false)
  useEffect(() => {
    if (!loaded) return
    if (!quickPrayersHydratedRef.current) { quickPrayersHydratedRef.current = true; return }
    requestCriticalPushSave(() => getSnapshot(), CRITICAL_SAVE_REASONS.QUICK_PRAYERS_CHANGE)
  }, [loaded, quickPrayers, getSnapshot])

  const bankConfigHydratedRef = useRef(false)
  useEffect(() => {
    if (!loaded) return
    if (!bankConfigHydratedRef.current) { bankConfigHydratedRef.current = true; return }
    requestCriticalPushSave(() => getSnapshot(), CRITICAL_SAVE_REASONS.BANK_CONFIG_CHANGE)
  }, [loaded, bankConfig, getSnapshot])

  const infoToastsHydratedRef = useRef(false)
  useEffect(() => {
    if (!loaded) return
    if (!infoToastsHydratedRef.current) { infoToastsHydratedRef.current = true; return }
    requestCriticalPushSave(() => getSnapshot(), CRITICAL_SAVE_REASONS.INFO_TOAST_SETTING_CHANGE)
  }, [loaded, showInfoToasts, getSnapshot])

  const backgroundCombatHydratedRef = useRef(false)
  useEffect(() => {
    if (!loaded) return
    if (!backgroundCombatHydratedRef.current) { backgroundCombatHydratedRef.current = true; return }
    requestCriticalPushSave(() => getSnapshot(), CRITICAL_SAVE_REASONS.BACKGROUND_COMBAT_SETTING_CHANGE)
  }, [loaded, backgroundCombat, getSnapshot])

  // Stable identity for the running activity — only the activity itself (not its
  // per-tick progress/session) should restart the heartbeat interval. Without
  // this the interval would reset every 600ms (the runner and the activity
  // screens both mutate the task object each tick) and the 30s heartbeat would
  // never fire.
  const heartbeatTaskKey = (loaded && activeTask && HEARTBEAT_ACTIVE_TASK_TYPES.has(activeTask.type))
    ? `${activeTask.type}:${activeTask.action?.id || activeTask.npc?.id || activeTask.gatherTask?.id || ''}`
    : null
  useEffect(() => {
    if (!heartbeatTaskKey) return
    const timer = setInterval(() => {
      // Skip the heartbeat while the tab is hidden — the visibilitychange
      // handler already flushes a save on hide, so a background tab doesn't
      // need to keep writing. Cuts idle D1 writes from backgrounded sessions.
      if (typeof document !== 'undefined' && document.hidden) return
      // Engagement-aware backstop: responsive while the player is interacting,
      // throttled to ~hourly once the foreground session is idle/AFK. Genuine
      // milestones (level-up, rare drop, boss/quest/unlock) still fire their own
      // immediate critical saves elsewhere; this heartbeat only backstops slow
      // XP/coin accumulation, which idle catch-up recovers on the next boot.
      schedulePeriodicSave(getSnapshot())
    }, CLOUD_ACTIVITY_HEARTBEAT_MS)
    return () => clearInterval(timer)
  }, [heartbeatTaskKey, getSnapshot])

  useEffect(() => { dailyTaskStatesRef.current = dailyTaskStates }, [dailyTaskStates])

  const setDailyTasks = useCallback((tasks, date) => {
    dailyTaskDateRef.current = date
    dailyTaskStatesRef.current = tasks
    setDailyTaskStates(tasks)
    dailyTasksLoadedRef.current = true
    // Replay events that fired before this first load (boot idle catch-up).
    const pending = pendingGameEventsRef.current
    if (pending.length > 0) {
      pendingGameEventsRef.current = []
      for (const evt of pending) recordGameEventRef.current?.(evt)
    }
  }, [])

  const recordGameEvent = useCallback((evt) => {
    // Before daily tasks have loaded, queue events rather than drop them — the
    // boot offline catch-up (loadGame) fires before the /api/daily-tasks fetch
    // lands. Bounded so a non-cloud session that never loads tasks can't grow it.
    if (!dailyTasksLoadedRef.current) {
      const buf = pendingGameEventsRef.current
      buf.push(evt)
      if (buf.length > 500) buf.shift()
      return
    }
    const tasks = dailyTaskStatesRef.current
    if (!tasks || tasks.length === 0) return
    let changed = false
    const next = tasks.map(task => {
      if (task.completed || task._completing) return task
      const taskDef = taskById(task.taskId)
      const inc = taskDef ? matchTaskProgress(taskDef, evt) : 0
      if (!inc) return task
      changed = true
      const newProgress = Math.min((task.progress ?? 0) + inc, task.target ?? 1)
      const nowComplete = newProgress >= (task.target ?? 1)
      if (nowComplete) {
        const charId = getCharacterId()
        const date = dailyTaskDateRef.current
        if (charId && date) {
          ;(async () => {
            try {
              const res = await api.completeDailyTask({ taskId: task.taskId, slot: task.slot, date })
              if (res?.creditsGranted > 0) {
                window.dispatchEvent(new CustomEvent(CREDITS_UPDATED_EVENT, {
                  detail: { credits_remaining: res.credits },
                }))
              }
            } catch (e) {
              console.error('[DailyTasks] completeDailyTask failed', e)
            }
          })()
        }
        addToast('Daily task complete! +1 💎', 'success')
        return { ...task, progress: newProgress, completed: true, _completing: true }
      }
      return { ...task, progress: newProgress }
    })
    if (changed) {
      dailyTaskStatesRef.current = next
      setDailyTaskStates(next)
    }
  }, [addToast])
  recordGameEventRef.current = recordGameEvent

  const value = {
    loaded, player, stats, inventory, equipment, bank, currentHP, toasts, isSaving,
    homeShortcuts, combatStance, idleCombatSetup, updateIdleCombatSetup,
    worldLocation, updateWorldLocation,
    requestActivityStart, travelPrompt, startTravelTo, dismissTravelPrompt,
    // Synchronous read of the latest task — activeTaskInternalRef updates the
    // instant setActiveTask runs, unlike the `activeTask` state value below
    // which only reflects it after React's next render. Callers that set a
    // task and immediately need to branch on it in the same tick (e.g. a
    // travel confirm that then navigates) should use this, not `activeTask`.
    getActiveTask: () => activeTaskInternalRef.current,
    activeTask, autoBankLoot, autoBankExcludedItems, toggleAutoBankExclusion, bankConfig, showInfoToasts, updateShowInfoToasts, theme, updateTheme,
    backgroundCombat, updateBackgroundCombat, combatStatus, publishCombatStatus,
    equipmentPresets, updateEquipmentPresets,
    quickPrayers, updateQuickPrayers,
    unlockedFeatures, unlockFeature,
    slayerTask, setSlayerTask, slayerPoints, updateSlayerPoints, awardSlayerPoints,
    slayerTasksCompleted,
    setSlayerTasksCompleted: (n) => {
      const v = Math.max(0, Math.floor(Number(n) || 0))
      slayerTasksCompletedRef.current = v
      setSlayerTasksCompletedState(v)
      saveSetting('slayerTasksCompleted', v)
    },
    slayerMasterTaskCompletions,
    // Callers just want "add N completions for master X" — reading/merging the
    // current map themselves would race the ref on rapid-fire calls.
    incrementSlayerMasterTaskCompletions: (masterId, count = 1) => {
      if (!masterId) return
      const n = Math.max(0, Math.floor(Number(count) || 0))
      if (n <= 0) return
      const current = slayerMasterTaskCompletionsRef.current || {}
      const have = Math.max(0, Math.floor(Number(current[masterId]) || 0))
      const next = { ...current, [masterId]: have + n }
      slayerMasterTaskCompletionsRef.current = next
      setSlayerMasterTaskCompletionsState(next)
      saveSetting('slayerMasterTaskCompletions', next)
    },
    setSlayerMasterTaskCompletions: (nextOrFn) => {
      const current = slayerMasterTaskCompletionsRef.current || {}
      const resolved = typeof nextOrFn === 'function' ? nextOrFn(current) : nextOrFn
      const next = (resolved && typeof resolved === 'object') ? resolved : {}
      slayerMasterTaskCompletionsRef.current = next
      setSlayerMasterTaskCompletionsState(next)
      saveSetting('slayerMasterTaskCompletions', next)
    },
    dungeoneeringTokens, awardDungeoneeringTokens, trySpendDungeoneeringTokens,
    activeCombatSpell, updateActiveCombatSpell,
    bossKillCounts, updateBossKillCounts,
    hardModeTargets, syncHardModeTargets, applyHardModeTarget,
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
    getHoldings, commitHoldings, flushLocalSaves,
    removeFromInventory, addToBank,
    updateHP, getMaxHP, getSkillLevel, addToast, dismissToast, setPlayer: setPlayerSynced,
    inventoryFull, signalInventoryFull, dismissInventoryFullPrompt, resolveInventoryFull,
    markDirty, itemsData, updateHomeShortcuts, updateCombatStance,
    setActiveTask, updateBankDirect, getSnapshot, updateAutoBankLoot, updateBankConfig,
    getActivityProgress, clearActivityProgress,
    slayerPerks, updateSlayerPerk,
    characterUnlocks, updateCharacterUnlock,
    slayerStoreUnlocks, addSlayerStoreUnlock,
    kingdom, updateKingdom, settleKingdom, applyKingdomSkip,
    isIronman: player?.is_ironman || false,
    isOneLife: player?.is_one_life || false,
    isGrindman: player?.is_grindman || false,
    revertOneLifeMode,
    dailyTaskStates, setDailyTasks, recordGameEvent,
  }

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>
}

export function useGame() {
  return useContext(GameContext)
}
