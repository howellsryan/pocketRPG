import { Component } from 'preact'
import { useState, useEffect, useRef } from 'preact/hooks'
import { GameProvider, useGame } from './state/gameState.jsx'
import { PvpProvider, usePvp } from './state/pvpState.jsx'
import GameFrameBar from './components/GameFrameBar.jsx'
import ToastContainer from './components/Toast.jsx'
import XpDropOverlay from './components/XpDropOverlay.jsx'
import SkillIcon from './components/SkillIcon.jsx'
import RewardRevealOverlay from './components/RewardRevealOverlay.jsx'
import LevelUpOverlay from './components/LevelUpOverlay.jsx'
import ChatWidget from './components/ChatWidget.jsx'
import { emitRewardReveal, emitQuestCompletionReveal, emitLevelUpReveal } from './utils/rewardReveal.js'
import BuyCreditsModal from './components/BuyCreditsModal.jsx'
import DailyTasksModal from './components/DailyTasksModal.jsx'
import HomeScreen from './screens/HomeScreen.jsx'
import StatsScreen from './screens/StatsScreen.jsx'
import InventoryScreen from './screens/InventoryScreen.jsx'
import BankScreen from './screens/BankScreen.jsx'
import CombatScreen from './screens/CombatScreen.jsx'
import SkillingScreen from './screens/SkillingScreen.jsx'
import GatherScreen from './screens/GatherScreen.jsx'
import AgilityScreen from './screens/AgilityScreen.jsx'
import TradingPostScreen from './screens/TradingPostScreen.jsx'
import EquipmentScreen from './screens/EquipmentScreen.jsx'
import ArmouryScreen from './screens/ArmouryScreen.jsx'
import QuestsScreen from './screens/QuestsScreen.jsx'
import CluesScreen from './screens/CluesScreen.jsx'
import MinigamesScreen from './screens/MinigamesScreen.jsx'
import CollectionLogScreen from './screens/CollectionLogScreen.jsx'
import LeaderboardScreen from './screens/LeaderboardScreen.jsx'
import HelpScreen from './screens/HelpScreen.jsx'
import CharacterUnlockScreen from './screens/CharacterUnlockScreen.jsx'
import ConnectAiScreen from './screens/ConnectAiScreen.jsx'
import DemoLockedScreen from './screens/DemoLockedScreen.jsx'
import MagicScreen from './screens/MagicScreen.jsx'
import WorldMapScreen from './screens/WorldMapScreen.jsx'
import TravelPrompt from './components/TravelPrompt.jsx'
import { advanceTravel, travelDestName } from './engine/travel.js'
import { advanceJourneyPhase, advanceJourneyOffline, journeyStatus, planClueJourney, planQuestJourney } from './engine/journeys.js'
import AuthScreen from './screens/AuthScreen.jsx'
import OAuthConsentScreen from './screens/OAuthConsentScreen.jsx'
import { SCREENS, isWorldMapEnabled } from './utils/constants.js'
import { hasSave, closeDB } from './db/database.js'
import { initNewGame, saveSetting, getSetting, getAllStats, getInventory, getEquipment, getBank } from './db/stores.js'
import { startTicks, stopTicks, onTick, pauseTicks, resumeTicks } from './engine/tick.js'
import { wipeLocalSave } from './db/saveload.js'
import { api, captureTokenFromHash, getToken, getCharacterId, getCharacterName, setCharacter, clearAuth, getLocalCharacterId, setLocalCharacterId, getIronmanMode, getOneLifeMode, syncAccountModeFlags, isDemoMode, setDemoMode, CREDITS_UPDATED_EVENT } from './cloud/api.js'
import { schedulePushSave, schedulePeriodicSave, pushNow, beaconSaveNow, pullSave, applyCloudSave, checkCloudNewer, isLocalWriteNewerThanCloud, resetSyncState, requestCriticalPushSave, retrySaveNow, isSaveConflict, clearSaveConflict, CLOUD_SAVE_STATUS_EVENT } from './cloud/sync.js'
import { CRITICAL_SAVE_REASONS } from './cloud/criticalSavePolicy.js'
import { fetchIdleState, resetIdleStateSync } from './cloud/idleState.js'
import { isBackground } from './engine/activityRegistry.js'
import { isRunnableBackgroundTask, getActionTicksForTask, getCarriedPendingTicks, simulateTaskWindow, resultActions, isScreenRecentlyDriving } from './engine/activityRunner.js'
import { mergeSession, sessionPatchFromResult } from './engine/activitySession.js'
import { resetActivityProgressSync } from './cloud/activityProgress.js'
import { formatIdleTime, simulateIdleSkilling, simulateIdleGather, simulateIdleCombat, simulateIdleAgility, simulateIdleHPRegen } from './engine/idleEngine.js'
import { triggerOneLifeDeath } from './utils/oneLifeDeath.js'
import { defaultIdleCombatSetup } from './engine/idleSupplies.js'
import prayersData from './data/prayers.json'
import minigamesData from './data/minigames.json'
import raidsData from './data/raids.json'
import { simulateIdleThieving } from './engine/thieving.js'
import { simulateIdleHunting } from './engine/hunter.js'
import { simulateQuestIdleCascade, splitQuestXpRewards } from './engine/questIdleCascade.js'
import { getLevelFromXP, createLevelUpTracker } from './engine/experience.js'
import { pvpApi } from './cloud/pvp.js'
import { SKIP_HOUR_MS, getSkipPreflight, isChargeableSkipOutcome } from './engine/skipPreflight.js'
import { getSlayerTaskReward } from './engine/slayerRewards.js'
import { hasEpicLootDrop, getItemUnitValue } from './utils/itemValue.js'
import LootResultModal, { SummaryCard, SuppliesCard } from './components/LootResultModal.jsx'
import GameIcon from './components/GameIcon.jsx'
import { computeIdleElapsedMs } from './utils/idleElapsed.js'
import { advanceFarmingState } from './engine/farming.ts'
import { recordCollectionLogDrop, fetchCollectionLog, clearCollectionLogCache, onCollectionLogSlotComplete, applyServerCollectionLogEntries } from './cloud/collectionLog.js'
import { fetchKillCounts } from './cloud/killCounts.js'
import { isLoggedDrop, collectIdleCombatLoggedDrops } from './engine/collectionLog.js'
import { rollClueRewards } from './engine/clueScrolls.js'
import dailyTasksData from './data/dailyTasks.json'
import { countItem } from './engine/inventory.js'

// ── Lazy in-game code chunk ──────────────────────────────────────────────────
// The single-file production build (build_single.cjs) splits the heavy in-game
// screens into a separate script that is only fetched once the player actually
// enters the game (cloudPhase === 'ready'). This keeps that ~130 KiB of code
// off the landing/login page, where it would otherwise download and parse but
// never run (Lighthouse "Reduce unused JavaScript"). The build installs a
// `globalThis.__loadGameChunk` injector. In the Vite web/Capacitor builds the
// screens are statically bundled into the main chunk, so there is nothing to
// load and this resolves immediately.
const loadGameChunk = () =>
  (typeof globalThis !== 'undefined' && globalThis.__loadGameChunk)
    ? globalThis.__loadGameChunk()
    : Promise.resolve()

// ── Clock-rollback watermark ────────────────────────────────────────────────
// We persist the highest Date.now() we've ever observed. If the device clock
// later reports a value below the watermark, the user rolled it backwards —
// we cap the elapsed-idle window to zero in that case. This is a best-effort
// offline-only defence; cloud-connected users get stronger protection via the
// server-stamped (serverNow - lastActiveAt) anchor returned by /api/idle.
const CLOCK_WATERMARK_KEY = 'pocketrpg_maxObservedAt'

function readMaxObservedAt() {
  const raw = localStorage.getItem(CLOCK_WATERMARK_KEY)
  const n = raw ? parseInt(raw, 10) : 0
  return Number.isFinite(n) ? n : 0
}

function updateMaxObservedAt(now) {
  const prev = readMaxObservedAt()
  if (now > prev) localStorage.setItem(CLOCK_WATERMARK_KEY, String(now))
}

// If the wall clock currently reads less than the highest value we've seen,
// the user moved their device clock backwards — elapsed calculations that
// depend on Date.now() can't be trusted, so collapse them to zero.
function clampByClockWatermark(elapsedMs) {
  if (elapsedMs <= 0) return 0
  const watermark = readMaxObservedAt()
  if (watermark > 0 && Date.now() < watermark) return 0
  return elapsedMs
}

// Records a oneShot minigame product drop against the minigame's collection
// log section. No-op if the (product, minigame) pair isn't in the log
// (e.g. data drift), so callers can fire safely.

function getMinigameRewardEntries(task) {
  if (!task) return []
  const qty = task.qty || 1
  if (Array.isArray(task.rewardItems) && task.rewardItems.length > 0) {
    return task.rewardItems.map((itemId) => ({ itemId, qty }))
  }
  return task.product ? [{ itemId: task.product, qty }] : []
}
const VALID_SERVER_MINIGAME_IDS = new Set((minigamesData?.tasks || []).map((task) => task?.id).filter(Boolean))

function grantMinigameTaskRewards(task, { updateBankDirect, unlockMinigameItem, recordCollectionLogDropForMinigame }) {
  const rewards = getMinigameRewardEntries(task)
  if (rewards.length === 0) return
  const bankUpdates = {}
  for (const reward of rewards) {
    bankUpdates[reward.itemId] = (bankUpdates[reward.itemId] || 0) + reward.qty
    unlockMinigameItem(reward.itemId)
    recordCollectionLogDropForMinigame({ ...task, product: reward.itemId })
  }
  updateBankDirect(bankUpdates)
}

function markMinigameRewardsUnlocked(task, { unlockMinigameItem }) {
  const rewards = getMinigameRewardEntries(task)
  for (const reward of rewards) unlockMinigameItem(reward.itemId)
}

function clueRevealTitle(clueTask) {
  const level = clueTask?.clueLevel || ''
  return `${level.charAt(0).toUpperCase()}${level.slice(1)} Clue Reward`
}

// Grant one clue-scroll solve. Server-authoritative when signed in (rolls loot,
// records kill-count/collection-log and replay nonce server-side); otherwise
// rolls locally and banks the rewards. Mirrors the path previously inlined in
// CluesScreen so the App-level tick can drive clues on any screen.
function completeClueSolve(clueTask, { updateBankDirect, getSnapshot, addToast, isInPvpMatch }) {
  const title = clueRevealTitle(clueTask)
  if (getToken() && getCharacterId()) {
    return api.completeClue(clueTask.clueLevel, {
      actionNonce: `clue:${clueTask.clueLevel}:${Date.now()}`,
      consumptions: [{ itemId: clueTask.requiresItem, quantity: 1 }],
    }).then(async (res) => {
      // NOTE: deliberately NOT applyCloudSave(res.save.save_data) — that snapshot
      // is whatever the server read at the START of this request, which can
      // predate a later local-only change (e.g. travel) if the round trip is
      // slow, silently reverting it on adoption. Apply just the granted reward
      // (clues always auto-bank, matching the offline branch below);
      // save_revision stays in sync generically via SAVE_REVISION_EVENT (api.js).
      const granted = Array.isArray(res?.granted) ? res.granted : []
      if (granted.length > 0) {
        const bankUpdates = {}
        for (const reward of granted) {
          const itemId = reward?.itemId
          const quantity = Math.floor(Number(reward?.quantity) || 0)
          if (!itemId || quantity < 1) continue
          bankUpdates[itemId] = (bankUpdates[itemId] || 0) + quantity
        }
        updateBankDirect(bankUpdates)
      }
      applyServerCollectionLogEntries(res?.collectionLogEntries || [])
      if (granted.length > 0) emitRewardReveal(title, clueTask.icon || '📜', granted)
    }).catch((err) => {
      addToast(`Clue claim failed: ${err?.message || 'server_error'}`, 'error')
    })
  } else {
    const rewards = rollClueRewards(clueTask.clueLevel)
    const bankUpdates = {}
    for (const reward of rewards) bankUpdates[reward.itemId] = reward.quantity
    bankUpdates[clueTask.requiresItem] = -1
    updateBankDirect(bankUpdates)
    for (const reward of rewards) {
      if (isLoggedDrop(reward.itemId, 'clues', clueTask.clueLevel)) recordCollectionLogDrop({ itemId: reward.itemId, sourceType: 'clues', sourceId: clueTask.clueLevel })
    }
    if (!isInPvpMatch) requestCriticalPushSave(() => getSnapshot(), CRITICAL_SAVE_REASONS.CLUE_REWARD)
    emitRewardReveal(title, clueTask.icon || '📜', rewards)
  }
}
function recordCollectionLogDropForMinigame(task) {
  const itemId = task?.product
  const sourceId = task?.minigame
  if (!itemId || !sourceId) return
  if (!isLoggedDrop(itemId, 'minigames', sourceId)) return
  recordCollectionLogDrop({ itemId, sourceType: 'minigames', sourceId })
}

// Idle combat sim returns drops keyed by itemId across lootGained/lootBanked.
// Fire one record per matching unique against the monster source.
function recordCollectionLogDropsForIdleCombat(monsterId, sim) {
  for (const itemId of collectIdleCombatLoggedDrops(monsterId, sim)) {
    // Idle combat is client-trusted (no /api/actions/** completion), so monster
    // uniques must be recorded via this client path; the live-combat skip for
    // 'monsters' would otherwise drop them silently. Server enforces ownership.
    recordCollectionLogDrop({ itemId, sourceType: 'monsters', sourceId: monsterId }, { fromIdle: true })
  }
}


function recordCollectionLogDropsForIdleClues(savedTask, sim) {
  const clueLevel = savedTask?.gatherTask?.clueLevel
  if (!clueLevel || !sim?.itemsBanked) return
  for (const itemId of Object.keys(sim.itemsBanked)) {
    if (!isLoggedDrop(itemId, 'clues', clueLevel)) continue
    recordCollectionLogDrop({ itemId, sourceType: 'clues', sourceId: clueLevel })
  }
}

// True when an idle session *gained* at least one item stack worth over the
// epic threshold (lost loot doesn't count — no epic fireworks for items you
// dropped on death). A single >1m drop earns purple, not the summed total.
function hasIdleEpicLootDrop(idleResult, items) {
  for (const src of [idleResult?.lootGained, idleResult?.lootBanked, idleResult?.itemsGained]) {
    if (hasEpicLootDrop(src, items)) return true
  }
  return false
}

function IdleResultProgressCard({ type, idleResult, taskName }) {
  const configs = {
    minigame_progress: {
      title: '🎮 Minigame Progress',
      label: 'Time Remaining',
      value: `${idleResult.hoursRemaining}h`,
      current: Math.max(0, (idleResult.task?.totalHours || 0) - (idleResult.hoursRemaining || 0)),
      total: idleResult.task?.totalHours || 1,
    },
    minigame_complete: {
      title: '✅ Minigame Complete!',
      valueOnly: true,
      value: 'Completed',
      current: 1,
      total: 1,
    },
    reward_progress: {
      title: '⏳ Unlock Progress',
      label: 'Time Remaining',
      value: formatIdleTime((idleResult.ticksRemaining || 0) * 600),
      current: Math.max(0, (idleResult.task?.totalTicks || 0) - (idleResult.ticksRemaining || 0)),
      total: idleResult.task?.totalTicks || idleResult.task?.action?.ticks || 1,
    },
    reward_complete: {
      title: '✅ Unlock Complete!',
      valueOnly: true,
      value: 'Completed',
      current: 1,
      total: 1,
    },
  }
  const config = configs[type]
  if (!config) return null
  return (
    <div style={{ marginBottom: '12px', padding: '10px', background: '#1a3a2a', borderRadius: '10px', borderLeft: '3px solid #4ade80' }}>
      <div style={{ fontSize: '12px', color: '#4ade80', fontWeight: 'bold', marginBottom: '6px' }}>{config.title}</div>
      <div style={{ fontSize: '12px', color: '#e8d5b0', marginBottom: '6px' }}>{taskName}</div>
      {!config.valueOnly && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#e8d5b0', marginBottom: '6px' }}>
          <span>{config.label}</span>
          <span style={{ color: '#d4af37', fontFamily: 'monospace', fontWeight: 'bold' }}>{config.value}</span>
        </div>
      )}
      {config.valueOnly && (
        <div style={{ fontSize: '12px', color: '#d4af37', fontFamily: 'monospace', fontWeight: 'bold', marginBottom: '6px' }}>{config.value}</div>
      )}
    </div>
  )
}

// Screens that require a cloud account (server-authoritative economy/social
// systems — see CLAUDE.md §14). In the offline demo these stay visible in the
// nav but are locked behind DemoLockedScreen.
const CLOUD_ONLY_SCREENS = new Set([SCREENS.STORE, SCREENS.LEADERBOARD, SCREENS.CONNECT_AI])
const DEMO_LOCKED_MESSAGE = '🔒 Sign in to use this — not available in the demo.'

function GameApp() {
  const { loaded, loadGame, player, stats, equipment, inventory, bank, currentHP, updateHP, getMaxHP, updateInventory, updateEquipment, updateBank, updateBankDirect, grantXP, addToast, activeTask, setActiveTask, getActiveTask, itemsData, getSnapshot, unlockedFeatures, setSlayerTask, awardSlayerPoints, slayerTasksCompleted, setSlayerTasksCompleted, completeQuest, completedQuests, questQueue, removeFromQuestQueue, updateQuestQueue,
    unlockMinigameItem, unlockedMinigameItems, awardDungeoneeringTokens, farming, updateFarming, idleCombatSetup, isOneLife, updateBossKillCounts, updateRaidKillCounts, syncServerKillCounts, markKillCountsLoaded, combatSkipHandlerRef, skipHourHandlerRef, chargeSkipRef, raidSkipHandlerRef,
    gameLocked, lockGame, unlockGame, runLockedSave, awaitCombatCompletion, resolveCombatCompletion,
    characterUnlocks, dailyTaskStates, setDailyTasks, recordGameEvent, updateWorldLocation, worldLocation } = useGame()
  const pvp = usePvp()
  const [screen, setScreen] = useState(SCREENS.HOME)
  const prevScreenRef = useRef(null) // screen before the current one (set by navigate)
  const [gameReady, setGameReady] = useState(false)
  const [idleResult, setIdleResult] = useState(null) // { elapsedMs, task, xpGained, itemsGained, lootLost, monstersKilled }
  const [skipSaving, setSkipSaving] = useState(false) // true while a paid skip is being persisted before reveal
  const [rollingBack, setRollingBack] = useState(false) // true while rolling back to the cloud copy after a save-revision conflict
  const [saveBlocked, setSaveBlocked] = useState(false) // true when cloud saves have failed repeatedly — hard-stop play
  const [saveBlockedError, setSaveBlockedError] = useState(null)
  const [retryingBlockedSave, setRetryingBlockedSave] = useState(false)
  const [actionData, setActionData] = useState(null) // { monsterId, gatherTaskId, skillId, actionId }
  const [isInCombat, setIsInCombat] = useState(false) // Track if currently in combat
  const [pendingXpChoices, setPendingXpChoices] = useState([]) // [{ rewards, questId, questName }, ...]
  const completedQuestsRef = useRef(completedQuests)
  const pendingXpChoicesRef = useRef(pendingXpChoices)
  // Cloud auth gate: 'pending' until we resolve, 'auth' if AuthScreen needed, 'ready' to boot game
  const [cloudPhase, setCloudPhase] = useState('pending')
  // Offline demo session (no cloud account). Mirrors the persisted demo flag so
  // the UI can lock cloud-only features. Set when the player picks "Play Demo".
  const [demoMode, setDemoModeState] = useState(() => isDemoMode())
  // OAuth consent: the signed request token when an MCP client is connecting
  // (arrives as ?oauth=… from /api/oauth/authorize; held across login).
  const [oauthRequest, setOauthRequest] = useState(null)
  // Lazy in-game chunk gate (single-file build only — see loadGameChunk above).
  const [gameChunkReady, setGameChunkReady] = useState(false)
  const [gameChunkAttempt, setGameChunkAttempt] = useState(0)
  const [cloudLoadError, setCloudLoadError] = useState(null)
  const [conflict, setConflict] = useState(null) // { cloudPayload, cloudHash, cloudUpdatedAt, localUpdatedAt }
  const [removeAds, setRemoveAds] = useState(false)
  const [identityId, setIdentityId] = useState(null)
  const [stripeLinks, setStripeLinks] = useState({})
  const [credits, setCredits] = useState(0)
  const [showBuyCreditsModal, setShowBuyCreditsModal] = useState(false)
  const [showDailyTasksModal, setShowDailyTasksModal] = useState(false)
  const [dailyTaskDate, setDailyTaskDate] = useState(null)
  const [dailyTaskResetInMs, setDailyTaskResetInMs] = useState(0)
  // Set on mount if Stripe redirected back with a payment query/path — drives the
  // post-checkout thank-you toast + credits refresh once the game is ready.
  const paymentReturnRef = useRef(false)
  const pvpReconnectBusyRef = useRef(false)
  const prevPvpPhaseRef = useRef(pvp.phase)
  const isInPvpMatch = pvp.phase === 'in_match'
  const [suppressIdleModalUntil, setSuppressIdleModalUntil] = useState(0)

  // Refs for tick-based systems
  const hpRegenCounter = useRef(0)
  const snapshotCounter = useRef(99) // Start at 99 so first snapshot fires after 1 tick
  const hiddenAtPerfRef = useRef(null) // performance.now() at hide — monotonic, immune to clock changes

  async function syncCompletedMinigameToServer(task) {
    if (!task?.id || !VALID_SERVER_MINIGAME_IDS.has(task.id) || !(getToken() && getCharacterId())) return
    const res = await api.completeMinigame(task.id, {
      actionNonce: `minigame:${task.id}:${Date.now()}`,
    })
    // NOTE: deliberately NOT applyCloudSave(res.save.save_data) + loadGame() here
    // — that snapshot is whatever the server read at the START of this request,
    // which can predate a later local-only change (e.g. travel) if the round trip
    // is slow, silently reverting it. The unlock itself is already applied
    // locally and pushed separately via requestCriticalPushSave at every call
    // site above; save_revision stays in sync generically via SAVE_REVISION_EVENT
    // (api.js).
    // Reflect the server-recorded collection-log entries immediately, the same
    // way the combat/clue completion flows do — otherwise the unlocked slot
    // doesn't appear until the next full collection-log refetch.
    applyServerCollectionLogEntries(res?.collectionLogEntries || [])
  }
  function isCloudAuthoritativeMinigame(task) {
    return !!(task?.id && VALID_SERVER_MINIGAME_IDS.has(task.id) && getToken() && getCharacterId())
  }

  function buildMinigameCompletionSnapshot(task) {
    const snap = getSnapshot()
    const rewardIds = getMinigameRewardEntries(task).map(reward => reward.itemId).filter(Boolean)
    const unlocked = new Set([...(snap?.settings?.unlockedMinigameItems || []), ...unlockedMinigameItems, ...rewardIds])
    return {
      ...snap,
      activeTask: null,
      settings: {
        ...(snap?.settings || {}),
        unlockedMinigameItems: [...unlocked],
      },
    }
  }

  // Global PvP route/overlay guard:
  // - if an active match exists server-side, enter PvP from any screen.
  // - when in match, force Combat screen and dismiss idle modal overlays.
  useEffect(() => {
    if (pvp.phase !== 'in_match') return
    setScreen(SCREENS.COMBAT)
    setActionData(null)
    setIdleResult(null)
    pauseTicks()
    try { localStorage.removeItem('pocketrpg_activeTask') } catch { /* ignore */ }
  }, [pvp.phase])

  useEffect(() => {
    const prevPhase = prevPvpPhaseRef.current
    if (prevPhase === 'in_match' && pvp.phase !== 'in_match') {
      setIdleResult(null)
      setSuppressIdleModalUntil(Date.now() + 15000)
      try {
        localStorage.removeItem('pocketrpg_hiddenAt')
        localStorage.removeItem('pocketrpg_activeTask')
      } catch { /* ignore */ }
    }
    prevPvpPhaseRef.current = pvp.phase
  }, [pvp.phase])

  useEffect(() => {
    let cancelled = false
    const reconnectActiveMatch = async () => {
      if (cancelled || pvp.phase === 'in_match' || pvpReconnectBusyRef.current) return
      if (!pvp.canAutoReconnect) return
      if (!getToken() || !getCharacterId()) return
      pvpReconnectBusyRef.current = true
      try {
        const res = await pvpApi.listInvitations()
        const activeMatchId = Number(res?.active_match_id)
        if (cancelled || !Number.isFinite(activeMatchId) || activeMatchId <= 0) return
        pvp.enterMatch(activeMatchId)
      } catch {
        // best-effort reconnect only
      } finally {
        pvpReconnectBusyRef.current = false
      }
    }

    reconnectActiveMatch()
    const onVisible = () => {
      if (!document.hidden) reconnectActiveMatch()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [pvp.phase, pvp.enterMatch, pvp.canAutoReconnect])

  useEffect(() => {
    const onActiveMatchConflict = (event) => {
      const routeToPvp = async () => {
        let matchId = Number(event?.detail?.matchId)
        if (!Number.isFinite(matchId) || matchId <= 0) {
          try {
            const invites = await pvpApi.listInvitations()
            matchId = Number(invites?.active_match_id)
          } catch {
            matchId = null
          }
        }
        if (!Number.isFinite(matchId) || matchId <= 0) return
        addToast('Server reports an active PvP match — entering combat.', 'info')
        pauseTicks()
        setScreen(SCREENS.COMBAT)
        setActionData(null)
        setIdleResult(null)
        pvp.enterMatch(matchId)
      }
      routeToPvp()
    }
    window.addEventListener('pocketrpg:pvp-active-match', onActiveMatchConflict)
    return () => window.removeEventListener('pocketrpg:pvp-active-match', onActiveMatchConflict)
  }, [addToast, pvp.enterMatch])

  // A finished journey grants its content through the exact same paths idling
  // used — completeClueSolve consumes the scroll + rolls/banks rewards
  // (server-authoritative when signed in), and handleQuestCompletion awards
  // XP/coins. Journeys are now the only clue/quest flow, so completion also
  // keeps the background loop rolling: another scroll of the same tier chains
  // straight into a fresh trail from where this one ended, and quests promote
  // the queue (as journeys) the same way.
  // Returns the clue grant's settlement promise (undefined for quests/offline)
  // so paid skips can await the server-side save write before force-pushing.
  // `questSummary` (paid skips) aggregates quest completions for one reveal.
  function completeJourneyContent(journey, endedAt, questSummary = null) {
    if (journey?.kind === 'clue' && journey.payload) {
      const clueTask = journey.payload
      // Count before the solve settles (the signed-in grant debits the scroll
      // asynchronously): ≥2 now means one is still left after this solve.
      const snap = getSnapshot()
      const scrollsNow = (snap.bank?.[clueTask.requiresItem]?.quantity || 0) + countItem(snap.inventory || [], clueTask.requiresItem)
      const settled = completeClueSolve(clueTask, { updateBankDirect, getSnapshot, addToast, isInPvpMatch })
      recordGameEvent?.({ kind: 'clue_complete', tier: clueTask.tier })
      if (scrollsNow >= 2) {
        const nextTask = planClueJourney(clueTask, endedAt)
        if (nextTask) {
          setActiveTask(nextTask)
          activeTaskRef.current = nextTask
        }
      }
      return settled
    } else if (journey?.kind === 'quest' && journey.payload) {
      handleQuestCompletion(journey.payload, journey.payload.xpReward, journey.payload.coinReward, endedAt, questSummary)
    }
  }

  // Handle quest completion with queue cascading. `summary` (paid skips) collects
  // { completedQuests, aggregatedXpReward, coinsGained, levelTracker } for one
  // questCascade reveal instead of per-quest toasts. A live (non-cascading)
  // completion reveals immediately instead. Either way the reward-reveal card
  // (+ full-screen level-up overlay, when a level actually ticked over) is the
  // only completion UI — toasts are silenced (grantXP `silent`, finaliseQuest
  // `quiet`) so nothing else fires alongside it.
  function handleQuestCompletion(quest, xpReward, coinReward, fromPlace, summary = null) {
    // Award rewards
    const { fixed, choices } = splitQuestXpRewards(xpReward)
    const tracker = summary?.levelTracker || createLevelUpTracker(stats)
    for (const [skill, xp] of Object.entries(fixed)) {
      tracker.apply(skill, xp)
      grantXP(skill, xp, { silent: true })
    }
    if (coinReward > 0) updateBankDirect({ coins: coinReward })
    if (summary) {
      summary.completedQuests.push(quest)
      if (coinReward > 0) summary.coinsGained += coinReward
      for (const [skill, xp] of Object.entries(xpReward || {})) {
        const amount = Math.floor(Number(xp) || 0)
        if (amount > 0) summary.aggregatedXpReward[skill] = (summary.aggregatedXpReward[skill] || 0) + amount
      }
    } else {
      emitQuestCompletionReveal([quest], xpReward, coinReward, tracker.result())
    }

    // The completed quest was already removed from the queue when it was
    // started, so the queue holds the next quests to run. Pop the next one
    // off and promote it to the active task.
    promoteNextQueuedQuestOrClear(fromPlace, { quiet: !!summary })

    // Finalise the completed quest (show choice modal if needed)
    finaliseQuest(quest.id, quest.name, choices, { quiet: true })
  }

  function clearPersistedActiveTask() {
    setActiveTask(null)
    activeTaskRef.current = null
    try { localStorage.removeItem('pocketrpg_activeTask') } catch { /* best-effort */ }
  }

  // Auto-chain the quest queue as journeys: the next queued quest sets out from
  // wherever the player is standing (for a finished journey, its last waypoint —
  // passed by the caller since the worldLocation state flush may lag).
  function promoteNextQueuedQuestOrClear(fromPlace, { quiet = false } = {}) {
    const currentQueue = questQueueRef.current || []
    if (currentQueue.length === 0) {
      clearPersistedActiveTask()
      return null
    }

    const nextQuest = currentQueue[0]
    const restQueue = currentQueue.slice(1)
    updateQuestQueue(restQueue)
    // Sync the ref NOW: the state effect only catches up after a render, and the
    // paid-skip loop promotes several quests back-to-back with no render between —
    // a stale ref re-pops (and re-completes) the same quest each iteration.
    questQueueRef.current = restQueue
    const nextTask = planQuestJourney(nextQuest, fromPlace || worldLocationRef.current)
    if (!nextTask) {
      clearPersistedActiveTask()
      addToast(`No route can be plotted for ${nextQuest.name} — start it from the Quests screen.`, 'error')
      return null
    }
    setActiveTask(nextTask)
    activeTaskRef.current = nextTask
    if (!quiet) addToast(`🗺️ Journey begun: ${nextQuest.name} — ${nextTask.journey.steps.length} places to visit`, 'info')
    return nextTask
  }

  // Finalise a completed quest: show choice modal if needed, else complete immediately.
  // `quiet` skips the completion toast (paid skips show one summary reveal instead).
  function finaliseQuest(questId, questName, choices, { quiet = false } = {}) {
    const alreadyCompleted = completedQuestsRef.current?.has?.(questId)
    const alreadyPendingChoice = pendingXpChoicesRef.current?.some?.(p => p.questId === questId)

    if (!alreadyCompleted) {
      completeQuest(questId)
      completedQuestsRef.current = new Set([...(completedQuestsRef.current || []), questId])
    }

    if (choices.length > 0) {
      if (!alreadyPendingChoice) {
        const entry = { rewards: choices, questId, questName }
        pendingXpChoicesRef.current = [...(pendingXpChoicesRef.current || []), entry]
        setPendingXpChoices(prev => prev.some(p => p.questId === questId) ? prev : [...prev, entry])
      }
      return
    }

    if (!quiet) addToast(`📜 Quest complete: ${questName}`, 'levelup', '🏆')
    recordGameEvent?.({ kind: 'quest_complete' })
  }

  // The player's chosen skill for a quest's "any"/"combat" XP reward — a
  // deferred piece of the same quest reward, so it reveals the same way as
  // the rest of the completion (reward card + full-screen level-up overlay),
  // silent toast, instead of the old "Quest complete" toast.
  function handleXpChoiceComplete(chosen) {
    const tracker = createLevelUpTracker(stats)
    for (const { skill, xp } of chosen) {
      tracker.apply(skill, xp)
      grantXP(skill, xp, { silent: true })
    }

    setPendingXpChoices(prev => {
      const head = prev[0]
      if (head) {
        const rewards = chosen.map(({ skill, xp }) => ({ skill, xp: Math.floor(Number(xp) || 0) })).filter(r => r.xp > 0)
        emitRewardReveal(`Quest Complete: ${head.questName}`, '🏆', rewards, tracker.result())
        emitLevelUpReveal(tracker.result())
      }
      const next = prev.slice(1)
      pendingXpChoicesRef.current = next
      return next
    })
  }

  useEffect(() => {
    // Detect an OAuth consent hand-off (?oauth=<request token> from
    // /api/oauth/authorize). Stash it so it survives the login round-trip, then
    // strip it from the URL. OAuthConsentScreen drives the rest.
    try {
      const params = new URLSearchParams(window.location.search)
      const fromUrl = params.get('oauth')
      if (fromUrl) {
        sessionStorage.setItem('pocketrpg_oauth_req', fromUrl)
        setOauthRequest(fromUrl)
        params.delete('oauth')
        const qs = params.toString()
        history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash)
      } else {
        const stashed = sessionStorage.getItem('pocketrpg_oauth_req')
        if (stashed) setOauthRequest(stashed)
      }
    } catch { /* non-fatal */ }

    // Detect Stripe post-checkout redirect (path or query contains "payment")
    // and strip it from the URL before routing decisions run.
    try {
      const url = new URL(window.location.href)
      const pathHit = /\/payment\b/i.test(url.pathname)
      const queryHit = url.searchParams.has('payment') || /(^|[?&])payment(=|&|$)/i.test(url.search)
      if (pathHit || queryHit) {
        paymentReturnRef.current = true
        url.searchParams.delete('payment')
        const cleanPath = url.pathname.replace(/\/payment\/?$/i, '/') || '/'
        history.replaceState(null, '', cleanPath + (url.searchParams.toString() ? `?${url.searchParams}` : '') + url.hash)
      }
    } catch { /* non-fatal */ }
    initCloudAndSave()
  }, [])

  // Boot watchdog: if the boot sequence can't reach a usable state within 5s,
  // surface the existing error screen instead of leaving the user stranded on a
  // "Loading…" screen. This is a backstop for async calls that can hang with no
  // timeout (e.g. pushNow→api.putSave, a wedged IndexedDB open/read). Each phase
  // gets its own 5s budget — the effect re-arms whenever cloudPhase/gameReady
  // changes, and clears itself once we reach a resting state.
  useEffect(() => {
    // 'auth' is a legitimate resting state (login needed, or an error is already
    // shown). 'ready' + gameReady means the game is up. Neither needs a watchdog.
    if (cloudPhase === 'auth') return
    if (cloudPhase === 'ready' && gameReady) return
    const timer = setTimeout(() => {
      console.warn(`[PocketRPG] Boot watchdog fired (cloudPhase=${cloudPhase}, gameReady=${gameReady})`)
      setCloudLoadError('Loading took too long. Please try again, or reset and return to the start screen.')
      setCloudPhase('auth')
    }, 5000)
    return () => clearTimeout(timer)
  }, [cloudPhase, gameReady])

  // Fetch the lazy in-game code chunk as soon as the player is past the
  // landing/login gate (cloudPhase === 'ready'). This is the first point at
  // which an in-game screen can render, so the chunk is always loaded before
  // renderScreen() needs it. No-op (resolves immediately) outside the
  // single-file build. Retries on transient network failure.
  useEffect(() => {
    if (cloudPhase !== 'ready' || gameChunkReady) return
    let cancelled = false
    loadGameChunk()
      .then(() => { if (!cancelled) setGameChunkReady(true) })
      .catch(() => { if (!cancelled) setTimeout(() => setGameChunkAttempt(a => a + 1), 1500) })
    return () => { cancelled = true }
  }, [cloudPhase, gameChunkReady, gameChunkAttempt])

  // Refresh /me — used after a Stripe purchase so the credit balance reflects
  // whatever the webhook has added to the character row.
  async function refreshMe() {
    try {
      const meData = await api.me()
      if (meData?.identity) {
        setRemoveAds(meData.identity.remove_ads === true)
        setIdentityId(meData.identity.id)
      }
      if (meData?.stripe_links) setStripeLinks(meData.stripe_links)
      if (meData?.character) setCredits(meData.character.credits ?? 0)
    } catch { /* non-fatal */ }
  }

  // Once the game is ready and a payment redirect was detected, show the
  // thank-you toast and re-pull credits a couple of times to ride out webhook
  // latency between Stripe and our worker.
  useEffect(() => {
    if (!gameReady || !paymentReturnRef.current) return
    paymentReturnRef.current = false
    addToast('Thank you for your purchase!', 'levelup', '🎉')
    refreshMe()
    const t1 = setTimeout(refreshMe, 3000)
    const t2 = setTimeout(refreshMe, 8000)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [gameReady])

  useEffect(() => {
    return onCollectionLogSlotComplete(({ itemId }) => {
      const name = itemsDataRef.current?.[itemId]?.name || itemId
      addToast(`📖 Collection Log: ${name}`, 'levelup', '📖')
    })
  }, [addToast])

  useEffect(() => {
    const handler = (event) => {
      const remaining = Number(event?.detail?.credits_remaining)
      if (Number.isFinite(remaining) && remaining >= 0) setCredits(remaining)
    }
    window.addEventListener(CREDITS_UPDATED_EVENT, handler)
    return () => window.removeEventListener(CREDITS_UPDATED_EVENT, handler)
  }, [])

  // Cloud-save guard: when the sync layer reports saves have failed enough
  // times to be "blocked", hard-stop play with a modal (Retry / Logout) rather
  // than letting the player keep accruing progress that isn't persisting. Any
  // subsequent successful save ('saved') lifts the block automatically.
  useEffect(() => {
    const handler = (event) => {
      const status = event?.detail?.status
      if (status === 'blocked') {
        setSaveBlocked(true)
        setSaveBlockedError(event?.detail?.error || null)
      } else if (status === 'saved') {
        setSaveBlocked(false)
        setSaveBlockedError(null)
      } else if (status === 'conflict') {
        // Our local progress diverged from the server's authoritative save (a
        // "bad state" — typically progress applied faster than a prior save
        // round-tripped). Roll back to the cloud copy IN PLACE: re-pull and
        // re-apply the server save (the same applyCloudSave + loadGame path a
        // server-side minigame completion uses) instead of hard-reloading —
        // a reload boots back to the Home screen, which reads as a crash
        // mid-session. conflictPending parks every push until the re-pull
        // adopts the server's revision; the reload survives as the fallback
        // when the pull itself fails.
        setRollingBack(true)
        ;(async () => {
          try {
            const pulled = await pullSave()
            if (pulled?.payload) {
              pauseTicks()
              try {
                await applyCloudSave(pulled.payload, pulled.updatedAt)
                await loadGame()
              } finally {
                resumeTicks()
              }
              clearSaveConflict()
              setRollingBack(false)
              addToast('☁️ Progress re-synced from the cloud.', 'success')
              return
            }
          } catch (err) {
            console.error('[PocketRPG] In-place cloud rollback failed, reloading:', err)
          }
          setTimeout(() => { try { window.location.reload() } catch {} }, 50)
        })()
      }
    }
    window.addEventListener(CLOUD_SAVE_STATUS_EVENT, handler)
    return () => window.removeEventListener(CLOUD_SAVE_STATUS_EVENT, handler)
  }, [])

  useEffect(() => {
    if (gameReady) {
      // Immediately stamp lastTick so idle engine has a baseline if user closes tab
      const bootNow = Date.now()
      localStorage.setItem('pocketrpg_lastTick', String(bootNow))
      updateMaxObservedAt(bootNow)
      startTicks()
      return () => stopTicks()
    }
  }, [gameReady])

  // Keep a ref to activeTask so the tick closure always sees the latest value
  const activeTaskRef = useRef(activeTask)
  useEffect(() => { activeTaskRef.current = activeTask }, [activeTask])

  // Keep refs to stats/equipment/inventory for visibility handler (avoids stale closures)
  const statsRef = useRef(stats)
  const equipmentRef = useRef(equipment)
  const inventoryRef = useRef(inventory)
  const itemsDataRef = useRef(itemsData)
  const bankRef = useRef(bank)
  const questQueueRef = useRef(questQueue)
  const worldLocationRef = useRef(worldLocation)
  const idleCombatSetupRef = useRef(idleCombatSetup)
  const currentHPRef = useRef(currentHP)
  useEffect(() => { bankRef.current = bank }, [bank])
  useEffect(() => { worldLocationRef.current = worldLocation }, [worldLocation])
  useEffect(() => { idleCombatSetupRef.current = idleCombatSetup }, [idleCombatSetup])
  useEffect(() => { currentHPRef.current = currentHP }, [currentHP])
  useEffect(() => { completedQuestsRef.current = completedQuests }, [completedQuests])
  useEffect(() => { pendingXpChoicesRef.current = pendingXpChoices }, [pendingXpChoices])
  useEffect(() => { statsRef.current = stats }, [stats])
  useEffect(() => { equipmentRef.current = equipment }, [equipment])
  useEffect(() => { inventoryRef.current = inventory }, [inventory])
  useEffect(() => { questQueueRef.current = questQueue }, [questQueue])

  // visibilitychange: stamp on hide, run idle on return
  useEffect(() => {
    if (!gameReady) return

    const handleVisibility = async () => {
      if (document.hidden) {
        // Page going to background — stamp the hide time separately from tick heartbeat
        const now = Date.now()
        hiddenAtPerfRef.current = performance.now() // monotonic — not affected by clock changes
        localStorage.setItem('pocketrpg_hiddenAt', String(now))
        // Bump the clock-rollback watermark — if the user advances the system
        // clock, hides the tab, then rolls it back, we'll catch the negative
        // delta on return and clamp elapsed to 0.
        updateMaxObservedAt(now)
        localStorage.setItem('pocketrpg_activeTask', JSON.stringify(activeTaskRef.current))
        // Flush progress before the tab is suspended/killed. Use a sendBeacon
        // save (survives teardown) rather than pushNow's fetch, which the browser
        // cancels when the page actually goes away — that cancellation was
        // silently dropping progress since the last debounced push on refresh.
        // /api/save folds the idle heartbeat into the same write (stamps
        // last_active_at + active_task in character_idle_state), so no
        // separate beacon to /api/idle is needed here.
        if (!isInPvpMatch) {
          try { beaconSaveNow(getSnapshot()) } catch (e) { /* non-fatal */ }
        }
      } else {
        if (isInPvpMatch) return
        // Page returning to foreground — prefer performance.now() diff (monotonic) over wall-clock
        // to prevent system-time manipulation from granting fake idle progress.
        try {
          const rawHiddenAt = localStorage.getItem('pocketrpg_hiddenAt')
          const localSavedTask = (() => { try { return JSON.parse(localStorage.getItem('pocketrpg_activeTask')) } catch { return null } })()
          if (!rawHiddenAt) return
          const hiddenAt = parseInt(rawHiddenAt, 10)
          const perfNow = performance.now()
          // Prefer the D1 row for the task when available — it's the
          // authoritative source and survives multi-tab / multi-device
          // edge cases where another session may have changed the task.
          let savedTask = localSavedTask
          let cloudLastActiveAt = null
          let cloudServerNow = null
          try {
            const cloudIdle = await fetchIdleState()
            if (cloudIdle) {
              if (cloudIdle.activeTask !== undefined) savedTask = cloudIdle.activeTask
              cloudLastActiveAt = cloudIdle.lastActiveAt || null
              cloudServerNow = cloudIdle.serverNow || null
            }
          } catch (e) { /* fall back to local */ }
          const elapsedMs = computeIdleElapsedMs({
            now: Date.now(),
            perfNow,
            hiddenAt,
            hiddenAtPerf: hiddenAtPerfRef.current,
            cloudServerNow,
            cloudLastActiveAt,
            clockWatermark: readMaxObservedAt(),
          })
          hiddenAtPerfRef.current = null
          if (elapsedMs < 2000) return

          // Clear the hiddenAt stamp so a second quick return doesn't double-count
          localStorage.removeItem('pocketrpg_hiddenAt')

          // Race-condition guard: another concurrent session may have written
          // to the cloud while this tab was hidden. If so, take the cloud copy
          // instead of overwriting it with stale local idle simulation.
          try {
            const cloudNewer = await checkCloudNewer()
            if (cloudNewer) {
              await applyCloudSave(cloudNewer.payload, cloudNewer.updatedAt)
              await loadGame()
              addToast('☁️ Loaded newer save from another session', 'info')
              setIdleResult({ elapsedMs, task: savedTask, cloudOverride: true })
              return
            }
          } catch (e) {
            console.warn('[PocketRPG] Cloud freshness check failed:', e.message)
          }

          // If no active task, still show "Welcome Back" modal with elapsed time
          if (!savedTask) {
            setIdleResult({ elapsedMs, task: null })
            return
          }

          // Re-read latest stats/equipment/inventory/bank from DB to avoid stale state
          const [freshStats, freshInv, freshEq, freshBank, freshSlayerTask] = await Promise.all([
            getAllStats(),
            getInventory(),
            getEquipment(),
            getBank(),
            getSetting('slayerTask'),
          ])

          let sim = null

          // Travel resolves offline: advance by elapsed time, then either land at
          // the destination (update location, clear task, toast) or keep the
          // reduced trip for the live tick. No reward modal. Journeys chain their
          // legs/searches through the elapsed time; a journey that finished while
          // away is parked on its final search at 0 ticks and the next live tick
          // completes it with the full toast/reward path.
          if (savedTask.type === 'travel') {
            if (savedTask.journey) {
              const adv = advanceJourneyOffline(savedTask, elapsedMs)
              if (adv.location) updateWorldLocation(adv.location)
              setActiveTask(adv.task)
              activeTaskRef.current = adv.task
            } else {
              const adv = advanceTravel(savedTask, elapsedMs)
              if (adv.arrived) {
                updateWorldLocation(savedTask.dest)
                setActiveTask(null)
                activeTaskRef.current = null
                try { localStorage.removeItem('pocketrpg_activeTask') } catch {}
                addToast(`🧭 Arrived at ${travelDestName(savedTask)}`, 'info')
                resumeAutoStart(savedTask.autoStart)
              } else {
                setActiveTask(adv.task)
                activeTaskRef.current = adv.task
              }
            }
            if (!isInPvpMatch) schedulePushSave(getSnapshot())
            return
          }

          // OneShot minigames — reduce remaining time while away; complete if timer reached 0.
          if (savedTask.type === 'gather' && savedTask.gatherTask?.oneShot) {
            const elapsedTicks = Math.floor(elapsedMs / 600)
            const totalTicks = savedTask.totalTicks ?? savedTask.gatherTask.ticks
            const prevRemaining = savedTask.ticksRemaining ?? totalTicks
            const newRemaining = Math.max(0, prevRemaining - elapsedTicks)
            if (newRemaining <= 0) {
              setActiveTask(null)
              activeTaskRef.current = null
              try { localStorage.removeItem('pocketrpg_activeTask') } catch {}
              if (isCloudAuthoritativeMinigame(savedTask.gatherTask)) {
                markMinigameRewardsUnlocked(savedTask.gatherTask, { unlockMinigameItem })
                if (!isInPvpMatch) requestCriticalPushSave(() => buildMinigameCompletionSnapshot(savedTask.gatherTask), 'minigame_complete')
                void syncCompletedMinigameToServer(savedTask.gatherTask).catch((err) => {
                  console.warn('[PocketRPG] minigame sync failed:', err?.message || err)
                })
              } else {
                grantMinigameTaskRewards(savedTask.gatherTask, { updateBankDirect, unlockMinigameItem, recordCollectionLogDropForMinigame })
                if (!isInPvpMatch) requestCriticalPushSave(() => buildMinigameCompletionSnapshot(savedTask.gatherTask), 'minigame_complete')
              }
              recordGameEvent?.({ kind: 'minigame_complete', minigameId: savedTask.gatherTask?.id ?? 'any' })
              sim = { minigameCompleted: true }
            } else {
              setActiveTask({ ...savedTask, totalTicks, ticksRemaining: newRemaining })
              sim = { minigameTimeReduced: true, hoursRemaining: Math.ceil(newRemaining / 6000) }
            }
          } else if (savedTask.type === 'minigame' && savedTask.minigameTask) {
            const elapsedTicks = Math.floor(elapsedMs / 600)
            const totalTicks = savedTask.totalTicks ?? savedTask.minigameTask.ticks
            const prevRemaining = savedTask.ticksRemaining ?? totalTicks
            const newRemaining = Math.max(0, prevRemaining - elapsedTicks)
            if (newRemaining <= 0) {
              setActiveTask(null)
              activeTaskRef.current = null
              try { localStorage.removeItem('pocketrpg_activeTask') } catch {}
              if (isCloudAuthoritativeMinigame(savedTask.minigameTask)) {
                markMinigameRewardsUnlocked(savedTask.minigameTask, { unlockMinigameItem })
                if (!isInPvpMatch) requestCriticalPushSave(() => buildMinigameCompletionSnapshot(savedTask.minigameTask), 'minigame_complete')
                void syncCompletedMinigameToServer(savedTask.minigameTask).catch((err) => {
                  console.warn('[PocketRPG] minigame sync failed:', err?.message || err)
                })
              } else {
                grantMinigameTaskRewards(savedTask.minigameTask, { updateBankDirect, unlockMinigameItem, recordCollectionLogDropForMinigame })
                if (!isInPvpMatch) requestCriticalPushSave(() => buildMinigameCompletionSnapshot(savedTask.minigameTask), 'minigame_complete')
              }
              recordGameEvent?.({ kind: 'minigame_complete', minigameId: savedTask.minigameTask?.id ?? 'any' })
              sim = { minigameCompleted: true }
            } else {
              setActiveTask({ ...savedTask, totalTicks, ticksRemaining: newRemaining })
              sim = { minigameTimeReduced: true, hoursRemaining: Math.ceil(newRemaining / 6000) }
            }
          } else if (savedTask.type === 'skill')   sim = simulateIdleSkilling(savedTask, elapsedMs, freshBank, freshEq, freshStats, itemsDataRef.current, freshInv, { isIronman: getIronmanMode() })
          else if (savedTask.type === 'gather')  sim = simulateIdleGather(savedTask, elapsedMs, freshInv, freshStats, itemsDataRef.current, freshBank)
          else if (savedTask.type === 'clue') {
            sim = simulateIdleGather(savedTask, elapsedMs, freshInv, freshStats, itemsDataRef.current, freshBank)
            // Offline catch-up already settled whole solves over the elapsed
            // window; restart the in-progress solve so the live App-tick loop
            // (which drives clues on every screen) doesn't re-grant a partial.
            const clueTotal = savedTask.totalTicks ?? savedTask.gatherTask?.ticks
            const restarted = { ...savedTask, totalTicks: clueTotal, ticksRemaining: clueTotal, justCompleted: false }
            setActiveTask(restarted)
            activeTaskRef.current = restarted
          }
          else if (savedTask.type === 'combat')  sim = simulateIdleCombat(savedTask, elapsedMs, freshStats, freshEq, freshInv, itemsDataRef.current, freshSlayerTask, freshBank, {
            currentHP: currentHPRef.current ?? getMaxHP(),
            idleFood: idleCombatSetupRef.current?.food || [],
            idlePotions: idleCombatSetupRef.current?.potions || [],
            idlePrayers: idleCombatSetupRef.current?.prayers || {},
            prayersData,
          })
          else if (savedTask.type === 'agility') sim = simulateIdleAgility(savedTask, elapsedMs)
          else if (savedTask.type === 'thieving') sim = simulateIdleThieving(savedTask, elapsedMs)
          else if (savedTask.type === 'hunter') sim = simulateIdleHunting(savedTask, elapsedMs)

          if (savedTask.type === 'quest') {
            const cascade = simulateQuestIdleCascade({
              activeTask: savedTask,
              questQueue: questQueueRef.current || [],
              elapsedMs,
              now: Date.now(),
            })
            const completedQuests = []
            const aggregatedXpReward = {}
            let coinsGained = 0
            const levelTracker = createLevelUpTracker(stats)

            for (const entry of cascade.completed) {
              const quest = entry.quest
              const { fixed, choices } = splitQuestXpRewards(entry.xpReward || quest.xpReward || {})
              for (const [skill, xp] of Object.entries(fixed)) {
                levelTracker.apply(skill, xp)
                grantXP(skill, xp, { silent: true })
              }
              if ((entry.coinReward || 0) > 0) {
                updateBankDirect({ coins: entry.coinReward })
                coinsGained += entry.coinReward
              }
              finaliseQuest(quest.id, quest.name, choices, { quiet: true })
              completedQuests.push(quest)
              for (const [skill, xp] of Object.entries(entry.xpReward || quest.xpReward || {})) {
                const amount = Math.floor(Number(xp) || 0)
                if (amount > 0) aggregatedXpReward[skill] = (aggregatedXpReward[skill] || 0) + amount
              }
            }

            setActiveTask(cascade.finalTask)
            activeTaskRef.current = cascade.finalTask
            updateQuestQueue(cascade.finalQueue)
            questQueueRef.current = cascade.finalQueue

            if (!cascade.finalTask) {
              localStorage.removeItem('pocketrpg_activeTask')
              localStorage.removeItem('pocketrpg_lastTick')
            }

            // Quest completions reveal like clue solves (no idle-result modal).
            emitQuestCompletionReveal(completedQuests, aggregatedXpReward, coinsGained, levelTracker.result())
            if (!isInPvpMatch) schedulePushSave(getSnapshot())
            return
          }

          // Always show the modal — even if sim is null (e.g. <1 action completed)
          if (!sim) {
            if (savedTask.type === 'skill' && (savedTask.action?.type === 'alchemy' || savedTask.action?.materials || savedTask.action?.runeReq)) {
              setActiveTask(null)
            }
            setIdleResult({ elapsedMs, task: savedTask })
            return
          }

          // Idle/skip combat is high-risk: if supplies didn't keep the
          // character alive, the engine reports `died`. For one-life
          // accounts we trigger the wipe + redirect immediately; everyone
          // else respawns at full HP with the active combat task cleared.
          const idleDeath = savedTask.type === 'combat' && sim?.died === true
          if (idleDeath) {
            setActiveTask(null)
            activeTaskRef.current = null
            try { localStorage.removeItem('pocketrpg_activeTask') } catch {}
            const oneLifeMode = isOneLife || getOneLifeMode()
            if (oneLifeMode) {
              void triggerOneLifeDeath(addToast)
              return
            }
            addToast('You died during idle combat!', 'error')
            sim.hpAfterRegen = getMaxHP()
            sim.hpRestored = 0
          } else if (savedTask.type === 'combat' && Number.isFinite(Number(sim.finalHP))) {
            // Apply HP changes. For combat with active idle supplies the
            // simulator's finalHP is authoritative — combat may have stopped
            // partway, so we don't overlay full-session HP regen on top.
            sim.hpAfterRegen = Math.max(1, Math.min(getMaxHP(), Math.floor(Number(sim.finalHP))))
            sim.hpRestored = 0
          } else {
            const hpRegenSim = simulateIdleHPRegen(elapsedMs)
            if (hpRegenSim.hpRegen > 0) {
              const maxHP = getLevelFromXP(freshStats.hitpoints?.xp || 0)
              const restoredHP = Math.min(currentHP + hpRegenSim.hpRegen, maxHP)
              sim.hpRestored = hpRegenSim.hpRegen
              sim.hpAfterRegen = restoredHP
            }
          }

          // Apply XP (skip combat/any — those require player choice via modal)
          if (savedTask.type !== 'quest' && sim.xpGained) {
            for (const [skill, xp] of Object.entries(sim.xpGained)) {
              if (skill !== 'combat' && skill !== 'any' && xp > 0) grantXP(skill, xp)
            }
          }
          // Apply slayer XP from combat simulation
          if (savedTask.type === 'combat' && sim.slayerXpGained > 0) {
            grantXP('slayer', sim.slayerXpGained)
          }
          // Apply items
          if ((savedTask.type === 'combat' || savedTask.type === 'skill' || savedTask.type === 'gather' || savedTask.type === 'clue') && sim.finalInventory) {
            updateInventory(sim.finalInventory)
            const bankedItems = sim.lootBanked || sim.itemsBanked || {}
            if (Object.keys(bankedItems).length > 0) {
              updateBankDirect(bankedItems)
            }
          } else if (sim.itemsGained) {
            updateBankDirect(sim.itemsGained)
          }
          if (savedTask.type === 'combat' && savedTask.monster?.id) {
            recordCollectionLogDropsForIdleCombat(savedTask.monster.id, sim)
          }
          if ((savedTask.type === 'gather' || savedTask.type === 'clue') && savedTask.gatherTask?.isClue) {
            recordCollectionLogDropsForIdleClues(savedTask, sim)
          }
          // Apply agility coin reward directly to bank
          if (savedTask.type === 'agility' && sim.coinsGained > 0) {
            updateBankDirect({ coins: sim.coinsGained })
          }
          // Apply thieving coin reward directly to bank
          if (savedTask.type === 'thieving' && sim.coinsGained > 0) {
            updateBankDirect({ coins: sim.coinsGained })
          }
          // Apply alchemy coin reward directly to bank
          if (savedTask.type === 'skill' && savedTask.action?.type === 'alchemy' && sim.coinsGained > 0) {
            updateBankDirect({ coins: sim.coinsGained })
          }
          // Apply hunter rewards directly to bank
          if (savedTask.type === 'hunter' && sim.rewards && sim.rewards.length > 0) {
            const bankedItems = {}
            for (const reward of sim.rewards) {
              if (bankedItems[reward.itemId]) {
                bankedItems[reward.itemId] += reward.quantity
              } else {
                bankedItems[reward.itemId] = reward.quantity
              }
            }
            updateBankDirect(bankedItems)
          }
          // Deduct consumed materials from bank
          if (sim.itemsConsumed && Object.keys(sim.itemsConsumed).length > 0) {
            const negated = {}
            for (const [itemId, qty] of Object.entries(sim.itemsConsumed)) {
              negated[itemId] = -qty
            }
            updateBankDirect(negated)
          }

          if (savedTask.type === 'combat' && sim.ammoConsumed && freshEq?.ammo && freshEq.ammo.itemId === sim.ammoConsumed.itemId) {
            const remainingAmmo = Math.max(0, (freshEq.ammo.quantity || 0) - sim.ammoConsumed.quantity)
            freshEq.ammo = remainingAmmo > 0 ? { ...freshEq.ammo, quantity: remainingAmmo } : null
            updateEquipment({ ...freshEq })
          }

          if (savedTask.type === 'combat' && sim.chargesConsumed > 0 && freshEq?.weapon) {
            const remainingCharges = Math.max(0, (freshEq.weapon.charges || 0) - sim.chargesConsumed)
            freshEq.weapon = { ...freshEq.weapon, charges: remainingCharges }
            updateEquipment({ ...freshEq })
          }
          // Deduct runes consumed from bank (inventory portion already reflected in finalInventory)
          if (sim.runesConsumed && Object.keys(sim.runesConsumed).length > 0) {
            const negated = {}
            for (const [itemId, qty] of Object.entries(sim.runesConsumed)) {
              negated[itemId] = -qty
            }
            updateBankDirect(negated)
          }
          if (sim.dungeoneeringTokensGained > 0) awardDungeoneeringTokens(sim.dungeoneeringTokensGained)
          // Persist slayer task update if present
          if (savedTask.type === 'combat' && sim.slayerTaskUpdate) {
            if (sim.slayerTaskUpdate.completed) {
              setSlayerTask(null)
              const reward = getSlayerTaskReward(sim.slayerTaskUpdate.pointsOnComplete, slayerTasksCompleted)
              setSlayerTasksCompleted(reward.totalTasks)
              awardSlayerPoints(reward.pointsEarned)
              addToast(`💀 Slayer Task #${reward.totalTasks} Completed - ${reward.pointsEarned.toLocaleString()} points.`, 'levelup')
            } else {
              setSlayerTask(sim.slayerTaskUpdate)
            }
          }

          // Update HP from regen if applicable
          if (sim.hpAfterRegen !== undefined) {
            updateHP(sim.hpAfterRegen)
          }

          // A background skill/gather that exhausted its materials or filled the
          // inventory stops — clear the task and tell the player why.
          if ((savedTask.type === 'skill' || savedTask.type === 'gather') &&
              (sim.stoppedReason === 'inventory_full' || sim.stoppedReason === 'out_of_materials')) {
            setActiveTask(null)
            activeTaskRef.current = null
            try { localStorage.removeItem('pocketrpg_activeTask') } catch {}
            addToast(sim.stoppedReason === 'inventory_full' ? 'Inventory full — gathering stopped.' : 'Out of materials!', 'error')
          }

          setIdleResult({ elapsedMs, task: savedTask, ...sim })

          // Feed idle gains into the daily task tracker
          if (savedTask.type === 'combat' && sim.monstersKilled > 0 && savedTask.monster?.id) {
            const kind = savedTask.monster?.boss === true ? 'boss_kill' : 'monster_kill'
            recordGameEvent?.({ kind, monsterId: savedTask.monster.id, count: sim.monstersKilled })
          }
          if ((savedTask.type === 'skill' || savedTask.type === 'gather') && sim.itemsGained) {
            for (const [itemId, qty] of Object.entries(sim.itemsGained)) {
              if (qty > 0) recordGameEvent?.({ kind: 'skill_gather', itemId, count: qty })
            }
          }
          if (savedTask.type === 'combat' && sim.slayerTaskUpdate?.completed) {
            recordGameEvent?.({ kind: 'slayer_task_complete' })
          }
          if (savedTask.type === 'hunter' && sim.actions > 0 && savedTask.action?.id) {
            recordGameEvent?.({ kind: 'hunter_hunt', actionId: savedTask.action.id, count: sim.actions })
          }

          // Push the post-idle state to the cloud (debounced + hash-skipped).
          if (!isInPvpMatch) schedulePushSave(getSnapshot())
        } catch (err) {
          console.warn('[PocketRPG] Visibility idle error:', err)
          // DB may be stale — force reconnect for next read
          closeDB()
        }
      }
    }

    // pagehide / beforeunload: the actual teardown path on refresh / close /
    // navigation. A normal fetch is cancelled here, so the cloud save goes out
    // via sendBeacon (beaconSaveNow), which the browser guarantees to deliver
    // even as the page dies. pagehide is the reliable modern signal; beforeunload
    // stays as a fallback for browsers where pagehide lags on hard close.
    const handleUnload = () => {
      const now = Date.now()
      localStorage.setItem('pocketrpg_hiddenAt', String(now))
      updateMaxObservedAt(now)
      localStorage.setItem('pocketrpg_activeTask', JSON.stringify(activeTaskRef.current))
      // Folds the idle heartbeat into the same /api/save write — see the
      // visibilitychange handler above.
      if (!isInPvpMatch) {
        try { beaconSaveNow(getSnapshot()) } catch { /* non-fatal */ }
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('pagehide', handleUnload)
    window.addEventListener('beforeunload', handleUnload)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('pagehide', handleUnload)
      window.removeEventListener('beforeunload', handleUnload)
    }
  }, [gameReady, grantXP, updateInventory, updateBankDirect, isInPvpMatch])

  // Day rollover: re-fetch daily tasks when UTC date changes while game is open
  useEffect(() => {
    if (!gameReady || !dailyTaskDate) return
    const id = setInterval(() => {
      const today = new Date().toISOString().slice(0, 10)
      if (today !== dailyTaskDate) {
        api.getDailyTasks().then(dt => {
          if (!dt?.tasks) return
          setDailyTaskDate(dt.date)
          setDailyTaskResetInMs(dt.resetInMs ?? 0)
          setDailyTasks(dt.tasks, dt.date)
        }).catch(() => {})
      }
    }, 60_000)
    return () => clearInterval(id)
  }, [gameReady, dailyTaskDate, setDailyTasks])

  // HP regen tick: once per minute (100 ticks at 600ms = 60s)
  useEffect(() => {
    if (!gameReady) return
    const unsub = onTick(() => {
      // Sync localStorage stamp — completes in same call stack, safe from iOS freeze
      const now = Date.now()
      localStorage.setItem('pocketrpg_lastTick', String(now))
      // Bump the max-observed-wall-clock watermark every tick. On return from a
      // suspended tab we compare Date.now() against this; if it dropped, the
      // device clock rolled backwards and we can't trust idle elapsed math.
      updateMaxObservedAt(now)
      if (activeTaskRef.current) {
        localStorage.setItem('pocketrpg_activeTask', JSON.stringify(activeTaskRef.current))
      }
      // Snapshot full save to localStorage every 100 ticks (~60s) as IDB failover
      // Uses getSnapshot() to read live refs — avoids stale closure values
      // Counter starts at 99 so first snapshot fires after ~0.6s (immediate on load)
      snapshotCounter.current++
      if (snapshotCounter.current >= 100) {
        snapshotCounter.current = 0
        // Cloud sync piggy-backs on the local snapshot cadence (debounced,
        // hash-skipped). schedulePeriodicSave stretches this to ~hourly once the
        // session is idle/AFK so an unattended idle grind stops writing every
        // ~2 min — the local snapshot above still runs every 60s as the IDB
        // failover, and tab-hide/unload + critical milestones still flush.
        if (!isInPvpMatch) schedulePeriodicSave(getSnapshot())
      }
      // No periodic idle heartbeat: /api/save now stamps last_active_at +
      // active_task server-side on every write (including no-op writes) at an
      // equal-or-faster cadence than the old heartbeat. The beacon on
      // hide/unload still covers a tab that dies suddenly.
      hpRegenCounter.current++
      if (hpRegenCounter.current >= 100) {
        hpRegenCounter.current = 0
        const maxHP = getMaxHP()
        if (currentHP < maxHP) {
          updateHP(Math.min(currentHP + 1, maxHP))
        }
      }

      // Quest tick — runs at the App level so quests progress on any screen
      const task = activeTaskRef.current
      if (task && task.type === 'quest' && task.quest) {
        const remaining = (task.ticksRemaining ?? task.totalTicks) - 1
        if (remaining <= 0) {
          handleQuestCompletion(task.quest, task.quest.xpReward, task.quest.coinReward)
        } else {
          setActiveTask({ ...task, ticksRemaining: remaining }, { skipCloudSync: true })
        }
      }

      // Travel tick — counts down the journey on any screen. Arrival updates
      // the player's location and clears the task; offline catch-up is handled
      // separately by advanceTravel on boot / tab-return. A travel task carrying
      // a `journey` (Phase 5 active clue/quest journeys) chains its next phase
      // instead of ending: search the waypoint, walk on, or — after the final
      // search — complete the clue/quest through the same path idling uses.
      if (task && task.type === 'travel') {
        const total = task.totalTicks ?? 0
        const remaining = (task.ticksRemaining ?? total) - 1
        if (remaining <= 0) {
          if (task.journey) {
            const step = advanceJourneyPhase(task)
            if (step?.kind === 'complete') {
              updateWorldLocation(task.dest)
              setActiveTask(null)
              activeTaskRef.current = null
              try { localStorage.removeItem('pocketrpg_activeTask') } catch {}
              completeJourneyContent(task.journey, task.dest)
            } else if (step) {
              // Clue trails advance silently — per-waypoint toasts were noise.
              if (step.kind === 'search') {
                updateWorldLocation(task.dest)
                if (!isInPvpMatch) schedulePushSave(getSnapshot())
                if (task.journey?.kind !== 'clue') {
                  const s = journeyStatus(step.next)
                  addToast(`🔎 Searching ${travelDestName(task)} (${s?.step}/${s?.steps})`, 'info')
                }
              } else if (task.journey?.kind !== 'clue') {
                addToast(`🧭 The trail leads on to ${travelDestName(step.next)}`, 'info')
              }
              setActiveTask(step.next)
              activeTaskRef.current = step.next
            }
          } else {
            updateWorldLocation(task.dest)
            setActiveTask(null)
            activeTaskRef.current = null
            try { localStorage.removeItem('pocketrpg_activeTask') } catch {}
            addToast(`🧭 Arrived at ${travelDestName(task)}`, 'info')
            if (!isInPvpMatch) schedulePushSave(getSnapshot())
            resumeAutoStart(task.autoStart)
          }
        } else {
          setActiveTask({ ...task, ticksRemaining: remaining }, { skipCloudSync: true })
        }
      }

      // Minigame (one-shot gather) tick — progresses on any screen
      if (task && task.type === 'gather' && task.gatherTask?.oneShot) {
        const total = task.totalTicks ?? task.gatherTask.ticks
        const remaining = (task.ticksRemaining ?? total) - 1
        if (remaining <= 0) {
          const mgRewards = getMinigameRewardEntries(task.gatherTask)
          if (mgRewards.length > 0) emitRewardReveal(`${task.gatherTask.name} Complete!`, task.gatherTask.icon || '🎮', mgRewards)
          else addToast(`${task.gatherTask.icon || '🎮'} ${task.gatherTask.name} complete!`, 'levelup', '🏆')
          setActiveTask(null)
          activeTaskRef.current = null
          try { localStorage.removeItem('pocketrpg_activeTask') } catch {}
          if (isCloudAuthoritativeMinigame(task.gatherTask)) {
            markMinigameRewardsUnlocked(task.gatherTask, { unlockMinigameItem })
            if (!isInPvpMatch) requestCriticalPushSave(() => buildMinigameCompletionSnapshot(task.gatherTask), 'minigame_complete')
            void syncCompletedMinigameToServer(task.gatherTask).catch((err) => {
              console.warn('[PocketRPG] minigame sync failed:', err?.message || err)
            })
          } else {
            grantMinigameTaskRewards(task.gatherTask, { updateBankDirect, unlockMinigameItem, recordCollectionLogDropForMinigame })
            if (!isInPvpMatch) requestCriticalPushSave(() => buildMinigameCompletionSnapshot(task.gatherTask), 'minigame_complete')
          }
          recordGameEvent?.({ kind: 'minigame_complete', minigameId: task.gatherTask?.id ?? 'any' })
        } else {
          setActiveTask({ ...task, ticksRemaining: remaining, totalTicks: total }, { skipCloudSync: true })
        }
      }

      // QuestsScreen minigame tick — also progresses on any screen
      if (task && task.type === 'minigame' && task.minigameTask) {
        const total = task.totalTicks ?? task.minigameTask.ticks
        const remaining = (task.ticksRemaining ?? total) - 1
        if (remaining <= 0) {
          const mgTask = task.minigameTask
          const mgRewards = getMinigameRewardEntries(mgTask)
          if (mgRewards.length > 0) emitRewardReveal(`${mgTask.name} Complete!`, mgTask.icon || '🎮', mgRewards)
          else addToast(`${mgTask.icon || '🎮'} ${mgTask.name} complete!`, 'levelup', '🏆')
          setActiveTask(null)
          activeTaskRef.current = null
          try { localStorage.removeItem('pocketrpg_activeTask') } catch {}
          if (isCloudAuthoritativeMinigame(mgTask)) {
            markMinigameRewardsUnlocked(mgTask, { unlockMinigameItem })
            if (!isInPvpMatch) requestCriticalPushSave(() => buildMinigameCompletionSnapshot(mgTask), 'minigame_complete')
            void syncCompletedMinigameToServer(mgTask).catch((err) => {
              console.warn('[PocketRPG] minigame sync failed:', err?.message || err)
            })
          } else {
            grantMinigameTaskRewards(mgTask, { updateBankDirect, unlockMinigameItem, recordCollectionLogDropForMinigame })
            if (!isInPvpMatch) requestCriticalPushSave(() => buildMinigameCompletionSnapshot(mgTask), 'minigame_complete')
          }
          recordGameEvent?.({ kind: 'minigame_complete', minigameId: mgTask?.id ?? 'any' })
        } else {
          setActiveTask({ ...task, ticksRemaining: remaining, totalTicks: total }, { skipCloudSync: true })
        }
      }

      // Clue tick — a repeating "solve a scroll" loop driven here (not in the
      // CluesScreen) so it keeps progressing on any screen, exactly like
      // skills/gather/minigames. Offline catch-up is handled separately by
      // simulateIdleGather. A `justCompleted` flip-flop defers the next-scroll
      // check by one tick so the async server grant can settle the bank first.
      if (task && task.type === 'clue' && task.gatherTask) {
        const clueTask = task.gatherTask
        const total = task.totalTicks ?? clueTask.ticks
        if (task.justCompleted) {
          const snap = getSnapshot()
          const scrolls = (snap.bank?.[clueTask.requiresItem]?.quantity || 0) + countItem(snap.inventory, clueTask.requiresItem)
          if (scrolls <= 0) {
            setActiveTask(null)
            activeTaskRef.current = null
            try { localStorage.removeItem('pocketrpg_activeTask') } catch {}
          } else {
            setActiveTask({ ...task, ticksRemaining: total, totalTicks: total, justCompleted: false }, { skipCloudSync: true })
          }
        } else {
          const remaining = (task.ticksRemaining ?? total) - 1
          if (remaining <= 0) {
            completeClueSolve(clueTask, { updateBankDirect, getSnapshot, addToast, isInPvpMatch })
            recordGameEvent?.({ kind: 'clue_complete', tier: clueTask.tier })
            const session = mergeSession(task.session, { actions: 1 })
            setActiveTask({ ...task, ticksRemaining: 0, totalTicks: total, justCompleted: true, session }, { skipCloudSync: true })
          } else {
            setActiveTask({ ...task, ticksRemaining: remaining, totalTicks: total }, { skipCloudSync: true })
          }
        }
      }
    })
    return unsub
  }, [gameReady, currentHP, stats, questQueue, isInPvpMatch])

  async function initCloudAndSave() {
    try {
      // Pull token dropped by OAuth redirect (#token=...) into localStorage + clean URL
      captureTokenFromHash()

      // Re-arm the combat-screen KC gate — a character switch must wait for
      // the new character's kill counts, not show the previous character's.
      markKillCountsLoaded(false)

      const hasToken = !!getToken()
      const hasCharacter = !!getCharacterId()

      if (!hasToken) {
        // Offline demo: boot a local-only character with no cloud sync. The
        // engine (checkSave → startNewGame/loadGame) runs identically to a
        // logged-out session; only the boot routing differs.
        if (isDemoMode()) {
          setDemoModeState(true)
          setCloudLoadError(null)
          // Never expose a cloud character's leftover local save as the demo.
          // A cloud-owned IDB is stamped with its character id; wipe it so the
          // demo always starts from (or resumes) its own untagged save.
          if (getLocalCharacterId()) {
            await wipeLocalSave()
            setLocalCharacterId(null)
            resetSyncState()
          }
          setCloudPhase('ready')
          markKillCountsLoaded()
          await checkSave()
          return
        }
        setCloudPhase('auth')
        return
      }
      if (hasToken && !hasCharacter) {
        setCloudPhase('auth')
        return
      }

      if (hasToken && hasCharacter) {
        setCloudLoadError(null)
        // Fetch remove-ads status, Stripe payment links, and character credits
        // (non-fatal if unavailable — shop buttons / Credits pill stay hidden).
        try {
          const meData = await api.me()
          if (meData?.identity) {
            setRemoveAds(meData.identity.remove_ads === true)
            setIdentityId(meData.identity.id)
          }
          if (meData?.stripe_links) setStripeLinks(meData.stripe_links)
          if (meData?.character) {
            setCredits(meData.character.credits ?? 0)
            // Re-anchor the one-life / ironman flags to the authoritative server
            // character row. A returning session boots straight into the game
            // (no character picker, so setCharacter never runs), so without this
            // the death wipe would rely solely on a possibly-stale save blob and
            // treat a one-life death as a normal respawn. loadGame reads these
            // flags to correct the save blob before the idle death sim runs.
            syncAccountModeFlags(meData.character)
          }
        } catch { /* hide buttons on error — non-fatal */ }

        // Guard against character-switch leakage: if IDB currently belongs to
        // a different character, wipe it before loading anything. Otherwise a
        // newly-created character with no cloud save yet would fall through
        // to checkSave() and load the previous character's IDB rows.
        const selectedCharId = getCharacterId()
        const localCharId = getLocalCharacterId()
        if (localCharId && localCharId !== selectedCharId) {
          await wipeLocalSave()
          resetSyncState()
        }
        const result = await pullSave()
        if (result && result.payload) {
          // IDB may already hold a change (settings toggle, bank tag edit,
          // world-map move, etc.) made just before this reload that the
          // debounced/critical push hasn't reached the server yet. Adopting
          // the cloud copy unconditionally would silently discard it — keep
          // the newer local state instead and let the normal push cycle
          // reconcile it to the cloud.
          if (!isLocalWriteNewerThanCloud(result.updatedAt)) {
            await applyCloudSave(result.payload, result.updatedAt)
          }
        } else if (result && result.readFailed) {
          // The cloud read timed out or errored — we genuinely do NOT know
          // whether this character has a save. Initialising a fresh game and
          // pushing it here is exactly how a transient blip used to wipe a
          // live account back to level 3. Bail to the "cloud unavailable"
          // screen (Retry / Force Restart) instead of risking an overwrite.
          throw new Error('Could not reach your cloud save. Check your connection and retry.')
        } else {
          // Server authoritatively reported no save row for this character —
          // safe to initialise a new game and push it.
          await wipeLocalSave()
          await startNewGame(getIronmanMode(), getCharacterName(), getOneLifeMode())
          if (!isInPvpMatch) await pushNow(getSnapshot())
          // Brand-new character — there are no kill counts to wait for.
          markKillCountsLoaded()
          setCloudPhase('ready')
          return
        }
      }

      setCloudPhase('ready')
      // Kick off KC + daily-tasks fetch in parallel with checkSave to minimise the
      // window where data is missing from the first render.
      const kcPromise = fetchKillCounts()
      const dailyTasksPromise = api.getDailyTasks().catch(() => null)
      await checkSave()
      // Pull collection log alongside the save. Fire-and-forget — UI shows a
      // loading state until cache populates.
      fetchCollectionLog({ force: true }).catch(() => {})
      kcPromise.then(server => {
        if (!server) return
        syncServerKillCounts(server.bossKillCounts, server.raidKillCounts)
      }).catch(() => {}).finally(() => {
        // Settled (success OR fail) — let the combat screen render. Local
        // IDB KC was already loaded by checkSave, so a failed fetch still
        // shows the warm cache rather than blocking the screen.
        markKillCountsLoaded()
      })
      dailyTasksPromise.then(dt => {
        if (!dt?.tasks) return
        setDailyTaskDate(dt.date)
        setDailyTaskResetInMs(dt.resetInMs ?? 0)
        setDailyTasks(dt.tasks, dt.date)
      })
    } catch (err) {
      console.warn('[PocketRPG] Cloud init failed:', err)
      setCloudLoadError(err?.message || 'Failed to load cloud save')
      setCloudPhase('auth')
    }
  }

  async function resolveConflict(useCloud) {
    if (!conflict) return
    if (useCloud) {
      await applyCloudSave(conflict.cloudPayload, conflict.cloudUpdatedAt)
    }
    setConflict(null)
    setCloudPhase('ready')
    await checkSave()
  }

  // Offline catch-up reported a death during the time we were away.
  // For One-Life accounts the account is wiped immediately; otherwise the
  // player respawns (HP/task already reset by loadGame) and we show the
  // idle-results modal flagged with the death so the cause is visible.
  function handleOfflineIdleDeath(idleResult) {
    const oneLifeMode = isOneLife || getOneLifeMode()
    if (oneLifeMode) {
      void triggerOneLifeDeath(addToast)
      return
    }
    addToast('You died while you were away!', 'error')
    setIdleResult(idleResult)
  }

  // Boot-time offline catch-up result: quest cascades reveal like clue solves
  // (no idle-result modal); everything else keeps the Welcome Back modal.
  function presentBootIdleResult(idleResult) {
    if (idleResult.questCascade) {
      emitQuestCompletionReveal(idleResult.completedQuests, idleResult.aggregatedXpReward, idleResult.coinsGained, idleResult.levelUps)
      return
    }
    setIdleResult(idleResult)
  }

  async function checkSave() {
    const isCloudCharacter = !!getToken() && !!getCharacterId()
    try {
      const exists = await hasSave()
      if (exists) {
        const idleResult = await loadGame()
        setGameReady(true)
        if (idleResult) {
          if (idleResult.died === true) {
            handleOfflineIdleDeath(idleResult)
          } else {
            presentBootIdleResult(idleResult)
          }
          if (idleResult.pendingChoices?.length > 0) {
            setPendingXpChoices(prev => [...prev, ...idleResult.pendingChoices])
          }
        }
      } else {
        if (isCloudCharacter) {
          throw new Error('cloud_save_missing_local_cache')
        }
        await startNewGame()
      }
    } catch (err) {
      // IDB connection broken (iOS Safari kills background tabs) — close and reconnect.
      // The DATA is still there; only the connection handle is dead.
      console.warn('[PocketRPG] checkSave IDB error, retrying after reconnect...', err)
      closeDB()
      await new Promise(r => setTimeout(r, 300))
      // Retry before touching backup — avoids wiping valid IDB data with an older snapshot.
      try {
        const existsRetry = await hasSave()
        if (existsRetry) {
          const idleResult = await loadGame()
          setGameReady(true)
          if (idleResult) {
            if (idleResult.died === true) {
              handleOfflineIdleDeath(idleResult)
            } else {
              presentBootIdleResult(idleResult)
            }
            if (idleResult.pendingChoices?.length > 0) {
              setPendingXpChoices(prev => [...prev, ...idleResult.pendingChoices])
            }
          }
          return
        }
      } catch (retryErr) {
        console.warn('[PocketRPG] IDB retry failed, falling back to backup:', retryErr)
      }
      if (isCloudCharacter) throw err
      await startNewGame()
    }
  }

  async function startNewGame(isIronman = null, playerName = null, isOneLife = null) {
    let name = playerName || getCharacterName()
    // If still no name but we have a cloud character, that's a fallback error.
    // In normal flow, setCharacter() should have already set CHARACTER_NAME_KEY before startNewGame() is called.
    if (!name && !getCharacterId()) {
      name = 'Adventurer'
    }
    // If isIronman not explicitly provided, check if it was stored (cloud character)
    const finalIsIronman = isIronman !== null ? isIronman : getIronmanMode()
    // If isOneLife not explicitly provided, check if it was stored (cloud character)
    const finalIsOneLife = isOneLife !== null ? isOneLife : getOneLifeMode()
    await initNewGame(name, finalIsIronman, finalIsOneLife)
    // Stamp IDB ownership so the next boot knows these rows belong to the
    // selected character (only applies when signed in — offline leaves null).
    const charId = getCharacterId()
    if (charId) setLocalCharacterId(charId)
    await loadGame()
    setGameReady(true)
  }


  // Switch character — flush any pending push, clear character (keep GitHub
   // token) and bounce back to AuthScreen so the user can pick or create
   // another character under the same GitHub login.
  // Shown when a player taps a cloud-only feature while in the offline demo.
  const notifyDemoLocked = () => addToast(DEMO_LOCKED_MESSAGE, 'info')

  // Enter the offline demo from the landing page. Persists the demo flag and
  // re-runs boot, which takes the no-token demo branch in initCloudAndSave.
  async function enterDemoMode() {
    setDemoMode(true)
    setDemoModeState(true)
    setCloudLoadError(null)
    setCloudPhase('pending')
    await initCloudAndSave()
  }

  // Exit the demo back to the landing/login screen. The local demo save is left
  // in place (it resumes if the player taps Play Demo again); only the demo flag
  // is cleared so the next boot shows the landing page.
  function exitDemoMode() {
    setDemoMode(false)
    setDemoModeState(false)
    setActiveTask(null)
    try {
      localStorage.removeItem('pocketrpg_activeTask')
      localStorage.removeItem('pocketrpg_hiddenAt')
    } catch { /* best-effort */ }
    setGameReady(false)
    setCloudPhase('auth')
  }

  async function handleLogoutToCharacterSelect({ skipSave = false } = {}) {
    if (isDemoMode()) {
      exitDemoMode()
      return
    }
    // When leaving from the save-blocked modal the save is already failing, so
    // skip the final push (it would just hang) and drop the doomed retry queue.
    if (!skipSave && !isInPvpMatch) {
      try { await pushNow(getSnapshot()) } catch { /* non-fatal */ }
    }
    setSaveBlocked(false)
    setSaveBlockedError(null)
    // Clear the local session's active task WITHOUT pushing `null` to the
    // server idle row. The character we're leaving keeps its server-side idle
    // task + last_active_at so it continues accruing offline while the player
    // hops to another account on the same device. (Pushing null here would
    // stop that character's idle entirely — the bug this guards against.)
    setActiveTask(null, { skipCloudSync: true })
    localStorage.removeItem('pocketrpg_activeTask')
    localStorage.removeItem('pocketrpg_hiddenAt')
    setCharacter(null)
    resetSyncState()
    resetIdleStateSync()
    resetActivityProgressSync()
    clearCollectionLogCache()
    setGameReady(false)
    setCloudPhase('auth')
  }

  // Save-blocked modal actions. Retry forces an immediate push; a success
  // emits 'saved' which lifts the block via the status listener above.
  async function handleRetryBlockedSave() {
    if (retryingBlockedSave) return
    setRetryingBlockedSave(true)
    try {
      const ok = await retrySaveNow(getSnapshot())
      if (ok) {
        setSaveBlocked(false)
        setSaveBlockedError(null)
      } else {
        addToast('Still unable to reach the server. Check your connection.', 'error')
      }
    } catch {
      addToast('Still unable to reach the server. Check your connection.', 'error')
    } finally {
      setRetryingBlockedSave(false)
    }
  }



  async function handleManualSave() {
    if (isInPvpMatch) return
    // Lock the game until the save SUCCESSFULLY RESPONDS — runLockedSave blocks
    // input behind the overlay and suspends competing autosaves while the single
    // authoritative write is in flight.
    const saved = await runLockedSave()
    if (isSaveConflict()) return // rolling back to the cloud copy
    if (saved) addToast('Game saved.', 'success')
    else addToast('Save failed. Try again.', 'error')
  }
  // Navigate with optional action data
  const navigate = (scr, data) => {
    // Cloud-only destinations are locked in the offline demo.
    if (demoMode && CLOUD_ONLY_SCREENS.has(scr)) {
      notifyDemoLocked()
      return
    }
    // Remember where the player came from (screen id only — carrying the old
    // actionData back could re-fire its auto-start) so back/stop buttons can
    // return there.
    if (scr !== screen) prevScreenRef.current = screen
    // Every activity except combat persists across screens — skills and gathering
    // keep accruing in the background. Only combat stops when the player leaves.
    const currentTask = getActiveTask()
    if (!isBackground(currentTask)) {
      if (currentTask) {
        addToast('You fled combat.', 'info')
      }
      setActiveTask(null)
    }
    setActionData(data || null)
    setScreen(scr)
  }

  // Resume the action a player was travelling to (a gated activity start embedded its
  // descriptor in the travel task's `autoStart`). On arrival we navigate to the owning
  // screen with the same actionData a home shortcut would use, so the screen's existing
  // auto-start effect fires the fight/skilling immediately — even if the player idled
  // away on another screen while travelling.
  // `returnTo` ({ screen, data }) rides the actionData when the start came from
  // somewhere the player will want back to (the place map): the owning screen's
  // back/stop buttons then return there instead of their own hardcoded list.
  const resumeAutoStart = (autoStart, returnTo) => {
    if (!autoStart || !autoStart.kind) return
    // Every activity/skill screen started from the world (a place-map spot, the
    // place hub list, or auto-resumed on arrival after travelling) sends its
    // back/stop buttons back to the place the player is standing at, not the
    // owning skill screen's own list (a dead end when entered directly). An
    // explicit returnTo (e.g. a specific place-map view) still wins; the default
    // only applies when the world map is the navigation model.
    const rt = returnTo || (isWorldMapEnabled() ? { screen: SCREENS.WORLD_MAP, data: { view: 'place' } } : undefined)
    const extra = rt ? { returnTo: rt } : {}
    switch (autoStart.kind) {
      case 'combat':   navigate(SCREENS.COMBAT, { monsterId: autoStart.monsterId, ...extra }); break
      case 'raid':     navigate(SCREENS.COMBAT, { raidId: autoStart.raidId, ...extra }); break
      case 'agility':  navigate(SCREENS.AGILITY, { actionId: autoStart.actionId, ...extra }); break
      case 'gather':   navigate(SCREENS.GATHER, { gatherTaskId: autoStart.gatherTaskId, ...extra }); break
      case 'thieving': navigate(SCREENS.SKILLS, { skillId: 'thieving', actionId: autoStart.npcId, ...extra }); break
      case 'hunter':   navigate(SCREENS.SKILLS, { skillId: 'hunter', actionId: autoStart.actionId, ...extra }); break
      // Farming: open the farm's patch view for the location the player arrived at.
      case 'farming':  navigate(SCREENS.SKILLS, { skillId: 'farming', locationId: autoStart.locationId, ...extra }); break
      case 'minigame': navigate(SCREENS.MINIGAMES, { minigameTaskId: autoStart.taskId, ...extra }); break
      // Slayer master reached: the Slayer screen assigns the master's task on mount.
      case 'slayer':   navigate(SCREENS.SKILLS, { skillId: 'slayer', masterId: autoStart.masterId, ...extra }); break
      case 'skill':
        if (autoStart.skill === 'magic') navigate(SCREENS.MAGIC, rt ? { ...extra } : undefined)
        else navigate(SCREENS.SKILLS, { skillId: autoStart.skill, actionId: autoStart.actionId, ...extra })
        break
      default: break
    }
  }


  const isSkippingRef = useRef(false)
  // Pending boss-skip confirmation: { bossId, monsterName, cost } | null
  const [skipConfirm, setSkipConfirm] = useState(null)

  // Charge + resolve a boss/raid instant-kill skip. Server is authoritative for cost.
  async function executeBossSkip(bossId) {
    const killHandler = combatSkipHandlerRef?.current
    if (!killHandler) {
      addToast('Open the fight to skip a kill.', 'info')
      return
    }
    // Freeze the game for the WHOLE skip: charge → arm the kill → server
    // completion round-trip. The kill fires on a future engine tick and the
    // death pipeline resolves awaitCombatCompletion() once the server
    // completion settles, so the lock (and overlay) is held continuously with
    // no gap in which a competing save could race the write.
    lockGame()
    try {
      const result = await api.skipHour({ bossId })
      setCredits(result?.credits_remaining ?? credits)
      // Arm the completion wait BEFORE the kill so we can't miss the tick.
      const settled = awaitCombatCompletion()
      // The costly-skip confirm path keeps ticks paused during the charge —
      // resume so the armed kill can actually fire.
      resumeTicks()
      const armed = killHandler()
      if (armed === false) resolveCombatCompletion() // nothing will fire — release the wait now
      await settled
    } catch (err) {
      if (err?.status === 402) {
        addToast('You do not have enough credits to skip.', 'error')
      } else {
        addToast(err.message || 'Error during skip!', 'error')
      }
    } finally {
      // Pairs with this handler's lockGame — a conflict rollback re-applies
      // the cloud copy in place under its own overlay.
      unlockGame()
    }
  }

  const confirmBossSkip = async () => {
    const pending = skipConfirm
    setSkipConfirm(null)
    if (!pending) { resumeTicks(); return }
    if (isSkippingRef.current) { resumeTicks(); return }
    isSkippingRef.current = true
    try {
      // Stay paused during the credit charge; executeBossSkip arms the kill
      // (monster HP → 0) so the first tick after resume fires the death.
      await executeBossSkip(pending.bossId)
    } finally {
      isSkippingRef.current = false
      resumeTicks()
    }
  }

  const cancelBossSkip = () => {
    setSkipConfirm(null)
    resumeTicks()
  }

  // Apply one completed action's rewards from a background-runner sim result.
  function applyBackgroundActionResult(task, result) {
    if (result.xpGained) {
      for (const [skill, xp] of Object.entries(result.xpGained)) {
        if (skill !== 'combat' && skill !== 'any' && xp > 0) {
          grantXP(skill, xp)
          // XP-drop overlay reflects BACKGROUND progress only. On the activity's
          // own screen the screen shows its own XP feedback, so we don't emit
          // here when a screen is actively driving (it never reaches this path).
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('pocketrpg:xp-gain', { detail: { skill, amount: xp } }))
          }
        }
      }
    }
    if ((task.type === 'skill' || task.type === 'gather') && result.finalInventory) {
      updateInventory(result.finalInventory)
      const banked = result.itemsBanked || {}
      if (Object.keys(banked).length > 0) updateBankDirect(banked)
      if (result.itemsConsumed && Object.keys(result.itemsConsumed).length > 0) {
        const negated = {}
        for (const [itemId, qty] of Object.entries(result.itemsConsumed)) negated[itemId] = -qty
        updateBankDirect(negated)
      }
    }
    // Coin rewards: alchemy (skill), agility and thieving.
    if (result.coinsGained > 0) updateBankDirect({ coins: result.coinsGained })
    // Thieving seed rewards (Master Farmer) go straight to the bank.
    if (result.itemsGained && Object.keys(result.itemsGained).length > 0) {
      updateBankDirect(result.itemsGained)
    }
    // Hunter loot goes straight to the bank.
    if (task.type === 'hunter' && Array.isArray(result.rewards) && result.rewards.length > 0) {
      const banked = {}
      for (const r of result.rewards) banked[r.itemId] = (banked[r.itemId] || 0) + r.quantity
      updateBankDirect(banked)
    }
    if (task.type === 'hunter' && (result.actions ?? 0) > 0 && task.action?.id) {
      recordGameEvent?.({ kind: 'hunter_hunt', actionId: task.action.id, count: result.actions })
    }
    if (result.dungeoneeringTokensGained > 0) awardDungeoneeringTokens(result.dungeoneeringTokensGained)
  }

  // A background task that can no longer make progress (out of materials /
  // missing input, or inventory full with no auto-bank unlock) is cleared with
  // a reason. A full inventory while auto-bank IS unlocked is NOT a stop — the
  // runner keeps banking, so the sim never reports 'inventory_full' in that case.
  function applyBackgroundStop(task, reason) {
    setActiveTask(null)
    activeTaskRef.current = null
    try { localStorage.removeItem('pocketrpg_activeTask') } catch { /* non-fatal */ }
    if (reason === 'inventory_full') {
      addToast('Inventory full — gathering stopped.', 'error')
    } else if (reason === 'missing_input') {
      addToast('Out of supplies for gathering.', 'error')
    } else {
      addToast('Out of materials!', 'error')
    }
  }

  // App-level background activity runner: progresses the active skill / gather /
  // agility / thieving / hunter task on ANY in-app screen so XP and items apply
  // live, not only while the activity's own screen is open. Gated to the visible
  // tab so it never double-counts with the idle catch-up on hide/return, and it
  // yields to a mounted activity screen that is already driving the same task.
  //
  // Ticks are accumulated (`pendingTicks`) and replayed through the idle sim so
  // variable-cost steps — notably the agility-scaled auto-bank trip on a full
  // inventory — get enough time to complete rather than being starved.
  useEffect(() => {
    if (!gameReady) return
    const unsub = onTick(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      if (isSkippingRef.current) return
      if (isScreenRecentlyDriving()) return
      const task = activeTaskRef.current
      if (!isRunnableBackgroundTask(task)) return

      const ctx = {
        inventory: inventoryRef.current,
        bank: bankRef.current,
        stats: statsRef.current,
        equipment: equipmentRef.current,
        itemsData: itemsDataRef.current,
        isIronman: getIronmanMode(),
      }
      const totalTicks = getActionTicksForTask(task, ctx)
      // Resume the current action where it left off. While an activity screen is
      // driving, it mirrors `ticksRemaining`/`totalTicks` (not `pendingTicks`)
      // onto the task; when the runner takes back over (the player navigated
      // away), infer the elapsed ticks so the action continues, not restarts.
      const pending = getCarriedPendingTicks(task, totalTicks) + 1

      const commit = (pendingTicks, session = task.session) => {
        const next = { ...task, pendingTicks, totalTicks, ticksRemaining: Math.max(0, totalTicks - pendingTicks), session }
        activeTaskRef.current = next
        // Only pendingTicks/ticksRemaining change here — skip D1 write every tick.
        // The 30s heartbeat keeps last_active_at fresh; task identity hasn't changed.
        setActiveTask(next, { skipCloudSync: true })
      }

      // Below one action's worth of time the skilling/gather sims return null
      // (indistinguishable from "out of materials"), so just keep accumulating.
      if (pending < totalTicks) {
        commit(pending)
        return
      }

      const result = simulateTaskWindow(task, pending * 600, ctx)
      const actions = resultActions(result)
      if (result && actions > 0) applyBackgroundActionResult(task, result)
      // Keep the session tally counting while the background runner drives, so
      // the activity screen shows continuous stats when the player returns.
      const nextSession = (result && actions > 0)
        ? mergeSession(task.session, sessionPatchFromResult(task, result))
        : task.session

      if (!result) {
        applyBackgroundStop(task, task.gatherTask?.requiresItem ? 'missing_input' : 'out_of_materials')
        return
      }
      if (result.stoppedReason === 'inventory_full') {
        applyBackgroundStop(task, 'inventory_full')
        return
      }
      if (result.stoppedReason === 'out_of_materials') {
        applyBackgroundStop(task, 'out_of_materials')
        return
      }

      // actions > 0 → reset and refill toward the next action; actions === 0
      // means a bank trip is still pending, so keep the accumulated ticks.
      commit(actions > 0 ? 0 : pending, nextSession)
    })
    return unsub
  }, [gameReady])

  // Wait for React to commit and run the stateRef-syncing effects in
  // gameState before snapshotting. grantXP / updateBankDirect etc. are
  // setState calls, and getSnapshot() reads stateRef.current, which is
  // synced via useEffect — so a snapshot taken synchronously after the
  // mutations would capture the PRE-skip state. Two animation frames
  // guarantee a paint (and thus the passive effects) have run.
  function waitForStateFlush() {
    return new Promise((resolve) => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      } else {
        setTimeout(resolve, 32)
      }
    })
  }

  // Durably persist a paid skip before revealing its rewards. A skip
  // debits a credit server-side up front, so if the client crashed/
  // refreshed before the save landed the player would lose paid
  // progress. We keep the loading overlay up, flush the post-skip state
  // to the server (retrying transient failures), and only then show the
  // idle-result modal. On a hard outage we still reveal the result but
  // warn the player and leave the autosave retrying.
  async function persistSkipThenReveal(idleResultData) {
    if (isInPvpMatch) {
      if (idleResultData) setIdleResult(idleResultData)
      return
    }
    setSkipSaving(true)
    try {
      await waitForStateFlush()
      let saved = false
      for (let attempt = 0; attempt < 4 && !saved; attempt++) {
        saved = await pushNow(getSnapshot())
        // A save-revision conflict is NOT retryable — our state diverged from
        // the server. Stop pushing; the 'conflict' status handler is already
        // rolling us back to the cloud copy.
        if (isSaveConflict()) return
        if (!saved) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
      }
      if (!saved) {
        // Keep the unsynced flag (autosave keeps retrying) and warn the
        // player rather than block forever on a dead connection.
        schedulePushSave(getSnapshot())
        addToast('Skip applied — still syncing to the cloud. Keep the app open.', 'error')
      }
    } finally {
      setSkipSaving(false)
      // A conflict rolls the whole skip back to the cloud copy — the modal
      // would celebrate rewards that no longer exist.
      if (idleResultData && !isSaveConflict()) setIdleResult(idleResultData)
    }
  }

  function clearExhaustedActiveTask(reason) {
    setActiveTask(null)
    activeTaskRef.current = null
    setActionData(null)
    try { localStorage.removeItem('pocketrpg_activeTask') } catch {}
    addToast(reason || 'This action can no longer progress.', 'info')
  }

  // Skip 1 hour handler — preflight first, charge only after meaningful outcome exists
  async function handleSkip1h() {
    if (isSkippingRef.current) return
    isSkippingRef.current = true
    if (!isCloudAccount) {
      addToast('Skip only available for cloud accounts!', 'error')
      isSkippingRef.current = false
      return
    }

    // Raids: skip = skip the ENTIRE raid for its full skipCost. Delegates to the
    // same full-raid skip the loot-modal Skip uses (charge + one reward roll),
    // which serializes itself so rapid clicks can't race the server writes.
    if (activeTaskRef.current?.type === 'combat' && activeTaskRef.current?.raidId) {
      const raidSkip = raidSkipHandlerRef?.current
      if (!raidSkip) {
        addToast('Open the raid to skip it.', 'info')
        isSkippingRef.current = false
        return
      }
      try {
        await raidSkip()
      } finally {
        isSkippingRef.current = false
      }
      return
    }

    // Boss fights: skip = instant kill on the current monster.
    const inBossRaid = activeTaskRef.current?.type === 'combat' && (activeTaskRef.current?.monster?.boss === true || activeTaskRef.current?.raid === true)
    if (inBossRaid) {
      const monster = activeTaskRef.current?.monster
      const killHandler = combatSkipHandlerRef?.current
      if (!killHandler) {
        addToast('Open the fight to skip a kill.', 'info')
        isSkippingRef.current = false
        return
      }
      // Costly skips pause combat and require explicit confirmation before charging.
      const cost = Math.max(1, Math.floor(Number(monster?.skipCost) || 1))
      if (cost > 1) {
        pauseTicks()
        setSkipConfirm({ bossId: monster?.id, monsterName: monster?.name || 'this boss', cost })
        isSkippingRef.current = false
        return
      }
      await executeBossSkip(monster?.id)
      isSkippingRef.current = false
      return
    }

    // Check if there's an active task — prevent wasting credits
    if (!activeTaskRef.current) {
      addToast('Nothing to skip — start a task first!', 'error')
      isSkippingRef.current = false
      return
    }

    let didShowIdleModal = false
    try {
      const task = activeTaskRef.current
      const [freshStats, freshInv, freshEq, freshBank, freshSlayerTask] = await Promise.all([
        getAllStats(), getInventory(), getEquipment(), getBank(), getSetting('slayerTask'),
      ])
      const context = { inventory: freshInv, bank: freshBank, equipment: freshEq, stats: freshStats, itemsData: itemsDataRef.current, slayerTask: freshSlayerTask, questQueue: questQueueRef.current || [], now: Date.now() }
      const preflight = getSkipPreflight(task, context, SKIP_HOUR_MS)
      if (!preflight.canSkip) {
        if (preflight.shouldStopTask) clearExhaustedActiveTask(preflight.reason)
        else addToast(preflight.reason || 'Cannot skip this action right now.', 'info')
        return
      }
      // Commit to the skip: freeze the game until the server confirms. Pausing
      // the engine tick stops tick-driven autosaves / combat / HP-regen writes,
      // and lockGame() raises the blocking overlay AND suspends the autosave
      // cadence + critical-save milestones, so the player cannot keep playing
      // (and producing competing saves) while we simulate and persist. This
      // eliminates the write race behind the intermittent save_revision_conflict.
      // Both are released in finally.
      pauseTicks()
      lockGame()

      // Settle any queued/in-flight autosave and land the pre-skip state
      // BEFORE charging: a push that was already on the wire with an older
      // revision (or another device's newer save) surfaces the conflict here
      // — where no credit has been spent and the rollback loses nothing —
      // instead of 409ing the post-skip push and eating the paid hour.
      await pushNow(getSnapshot())
      if (isSaveConflict()) return

      if (task?.type === 'quest') {
        const skipResult = await api.skipHour()
        setCredits(skipResult?.credits_remaining ?? credits)

        const cascade = simulateQuestIdleCascade({
          activeTask: task,
          questQueue: questQueueRef.current || [],
          elapsedMs: SKIP_HOUR_MS,
          now: Date.now(),
        })
        const completedQuests = []
        const aggregatedXpReward = {}
        let coinsGained = 0
        const levelTracker = createLevelUpTracker(stats)

        for (const entry of cascade.completed) {
          const quest = entry.quest
          const { fixed, choices } = splitQuestXpRewards(entry.xpReward || quest.xpReward || {})
          for (const [skill, xp] of Object.entries(fixed)) {
            levelTracker.apply(skill, xp)
            grantXP(skill, xp, { silent: true })
          }
          if ((entry.coinReward || 0) > 0) {
            updateBankDirect({ coins: entry.coinReward })
            coinsGained += entry.coinReward
          }
          finaliseQuest(quest.id, quest.name, choices, { quiet: true })
          completedQuests.push(quest)
          for (const [skill, xp] of Object.entries(entry.xpReward || quest.xpReward || {})) {
            const amount = Math.floor(Number(xp) || 0)
            if (amount > 0) aggregatedXpReward[skill] = (aggregatedXpReward[skill] || 0) + amount
          }
        }

        setActiveTask(cascade.finalTask)
        activeTaskRef.current = cascade.finalTask
        updateQuestQueue(cascade.finalQueue)
        questQueueRef.current = cascade.finalQueue

        if (!cascade.finalTask) {
          localStorage.removeItem('pocketrpg_activeTask')
          localStorage.removeItem('pocketrpg_lastTick')
        }

        addToast('⏭️ Skipped 1 hour', 'info')
        // Persist first, then reveal like a clue solve — no idle-result modal
        // (a conflict rolls the skip back, so nothing to celebrate).
        await persistSkipThenReveal(null)
        if (!isSaveConflict()) emitQuestCompletionReveal(completedQuests, aggregatedXpReward, coinsGained, levelTracker.result())
        return
      }

      // Travel & journeys: 1 credit = 1 hour of trail time. A plain walk just
      // arrives (roads are seconds long). A journey always finishes its CURRENT
      // clue/quest in full — a master trail longer than the hour still completes,
      // it simply consumes the whole budget — and any time left over chains
      // through the next scroll / queued quest exactly as idling would (a stack
      // of medium scrolls burns several per credit).
      if (task?.type === 'travel') {
        const skipResult = await api.skipHour()
        setCredits(skipResult?.credits_remaining ?? credits)

        // Quest completions aggregate into one questCascade reveal (same summary
        // the legacy quest skip shows) instead of a toast per quest in the chain.
        // levelTracker persists across the whole chain so a skill spanning
        // several chained quests reports one from→to span.
        const questSummary = { completedQuests: [], aggregatedXpReward: {}, coinsGained: 0, levelTracker: createLevelUpTracker(stats) }
        if (!task.journey) {
          updateWorldLocation(task.dest)
          clearPersistedActiveTask()
          addToast(`🧭 Arrived at ${travelDestName(task)}`, 'info')
          resumeAutoStart(task.autoStart)
        } else {
          let budgetMs = SKIP_HOUR_MS
          let cur = task
          let first = true
          for (let guard = 0; cur?.journey && guard < 30; guard++) {
            let adv = advanceJourneyOffline(cur, budgetMs)
            if (!adv.completedPending && first) {
              adv = advanceJourneyOffline(cur, Number.MAX_SAFE_INTEGER)
              budgetMs = 0
            } else {
              budgetMs = adv.completedPending ? Math.max(0, adv.msRemaining ?? 0) : 0
            }
            first = false
            if (!adv.completedPending) {
              // Hour spent mid-journey (only possible on a chained trail):
              // park the advanced task for the live tick to carry on.
              if (adv.location) updateWorldLocation(adv.location)
              setActiveTask(adv.task)
              activeTaskRef.current = adv.task
              break
            }
            const endedAt = adv.location || adv.task.dest
            updateWorldLocation(endedAt)
            clearPersistedActiveTask()
            // Grants the content and, when another scroll / queued quest exists,
            // sets the next journey as the active task — picked up below. The
            // await matters twice over: the signed-in clue grant bumps
            // save_revision server-side (pushing before its applyCloudSave lands
            // is a guaranteed stale-write conflict), and the settled debit keeps
            // the next iteration's scroll count honest.
            await completeJourneyContent(adv.task.journey, endedAt, questSummary)
            cur = activeTaskRef.current
            if (!cur || cur.type !== 'travel' || budgetMs <= 0) break
          }
        }

        addToast('⏭️ Skipped 1 hour', 'info')
        // Persist first, then reveal quest completions like a clue solve — no
        // idle-result modal (a conflict rolls the skip back).
        await persistSkipThenReveal(null)
        if (!isSaveConflict()) emitQuestCompletionReveal(questSummary.completedQuests, questSummary.aggregatedXpReward, questSummary.coinsGained, questSummary.levelTracker.result())
        return
      }

      const result = await api.skipHour()
      setCredits(result?.credits_remaining ?? credits)

      const elapsedMs = SKIP_HOUR_MS
      let idleResultData = { elapsedMs, task: activeTaskRef.current }

      // If there's an active task, simulate it for 1 hour
      if (activeTaskRef.current) {
        const savedTask = activeTaskRef.current
        let sim = null

        // Special handling for oneShot minigames — reduce remaining time
        if (savedTask.type === 'gather' && savedTask.gatherTask?.oneShot) {
          const TICKS_PER_HOUR = 6000
          const ticksInOneHour = TICKS_PER_HOUR
          const totalTicks = savedTask.totalTicks ?? savedTask.gatherTask.ticks
          const prevRemaining = savedTask.ticksRemaining ?? totalTicks
          const ticksRemaining = Math.max(0, prevRemaining - ticksInOneHour)

          if (ticksRemaining <= 0) {
            // Minigame completed — award all reward items and clear task
            setActiveTask(null)
            activeTaskRef.current = null
            try { localStorage.removeItem('pocketrpg_activeTask') } catch {}
            if (isCloudAuthoritativeMinigame(savedTask.gatherTask)) {
              markMinigameRewardsUnlocked(savedTask.gatherTask, { unlockMinigameItem })
              if (!isInPvpMatch) requestCriticalPushSave(() => buildMinigameCompletionSnapshot(savedTask.gatherTask), 'minigame_complete')
              await syncCompletedMinigameToServer(savedTask.gatherTask).catch((err) => {
                console.warn('[PocketRPG] minigame sync failed:', err?.message || err)
              })
            } else {
              grantMinigameTaskRewards(savedTask.gatherTask, { updateBankDirect, unlockMinigameItem, recordCollectionLogDropForMinigame })
              if (!isInPvpMatch) requestCriticalPushSave(() => buildMinigameCompletionSnapshot(savedTask.gatherTask), 'minigame_complete')
            }
            idleResultData = { elapsedMs, task: savedTask, minigameCompleted: true }
            sim = {}
          } else {
            // Minigame still ongoing — update remaining time and show progress
            const updatedTask = { ...savedTask, totalTicks, ticksRemaining }
            setActiveTask(updatedTask)
            idleResultData = {
              elapsedMs,
              task: updatedTask,
              minigameTimeReduced: true,
              hoursRemaining: Math.ceil(ticksRemaining / TICKS_PER_HOUR)
            }
            sim = { minigameTimeReduced: true }
          }
        } else if (savedTask.type === 'minigame' && savedTask.minigameTask) {
          const TICKS_PER_HOUR = 6000
          const totalTicks = savedTask.totalTicks ?? savedTask.minigameTask.ticks
          const prevRemaining = savedTask.ticksRemaining ?? totalTicks
          const ticksRemaining = Math.max(0, prevRemaining - TICKS_PER_HOUR)
          if (ticksRemaining <= 0) {
            setActiveTask(null)
            activeTaskRef.current = null
            try { localStorage.removeItem('pocketrpg_activeTask') } catch {}
            if (isCloudAuthoritativeMinigame(savedTask.minigameTask)) {
              markMinigameRewardsUnlocked(savedTask.minigameTask, { unlockMinigameItem })
              if (!isInPvpMatch) requestCriticalPushSave(() => buildMinigameCompletionSnapshot(savedTask.minigameTask), 'minigame_complete')
              await syncCompletedMinigameToServer(savedTask.minigameTask).catch((err) => {
                console.warn('[PocketRPG] minigame sync failed:', err?.message || err)
              })
            } else {
              grantMinigameTaskRewards(savedTask.minigameTask, { updateBankDirect, unlockMinigameItem, recordCollectionLogDropForMinigame })
              if (!isInPvpMatch) requestCriticalPushSave(() => buildMinigameCompletionSnapshot(savedTask.minigameTask), 'minigame_complete')
            }
            idleResultData = { elapsedMs, task: savedTask, minigameCompleted: true }
            sim = {}
          } else {
            const updatedTask = { ...savedTask, totalTicks, ticksRemaining }
            setActiveTask(updatedTask)
            idleResultData = {
              elapsedMs,
              task: updatedTask,
              minigameTimeReduced: true,
              hoursRemaining: Math.ceil(ticksRemaining / TICKS_PER_HOUR)
            }
            sim = { minigameTimeReduced: true }
          }
        } else {
          if (savedTask.type === 'skill')   sim = simulateIdleSkilling(savedTask, elapsedMs, freshBank, freshEq, freshStats, itemsDataRef.current, freshInv, { isIronman: getIronmanMode() })
          if (savedTask.type === 'gather')  sim = simulateIdleGather(savedTask, elapsedMs, freshInv, freshStats, itemsDataRef.current, freshBank)
          if (savedTask.type === 'clue') {
            sim = simulateIdleGather(savedTask, elapsedMs, freshInv, freshStats, itemsDataRef.current, freshBank)
            // Restart the partial solve so the live App-tick clue loop doesn't
            // re-grant what the skip catch-up already settled.
            const clueTotal = savedTask.totalTicks ?? savedTask.gatherTask?.ticks
            const restarted = { ...savedTask, totalTicks: clueTotal, ticksRemaining: clueTotal, justCompleted: false }
            setActiveTask(restarted)
            activeTaskRef.current = restarted
          }
          if (savedTask.type === 'combat')  sim = simulateIdleCombat(savedTask, elapsedMs, freshStats, freshEq, freshInv, itemsDataRef.current, freshSlayerTask, freshBank, {
            currentHP: currentHPRef.current ?? getMaxHP(),
            idleFood: idleCombatSetupRef.current?.food || [],
            idlePotions: idleCombatSetupRef.current?.potions || [],
            idlePrayers: idleCombatSetupRef.current?.prayers || {},
            prayersData,
            doubleSlayerXp: !!(characterUnlocks?.doubleSlayerXp),
          })
          if (savedTask.type === 'agility') sim = simulateIdleAgility(savedTask, elapsedMs)
          if (savedTask.type === 'thieving') sim = simulateIdleThieving(savedTask, elapsedMs)
          if (savedTask.type === 'hunter') sim = simulateIdleHunting(savedTask, elapsedMs)
        }

        if (!sim) {
          if (savedTask.type === 'skill' && (savedTask.action?.type === 'alchemy' || savedTask.action?.materials || savedTask.action?.runeReq)) {
            setActiveTask(null)
          }
        } else {
          // Skipping is now high-risk: handle death-during-skip before
          // applying anything else. One-life triggers the account wipe;
          // everyone else respawns at full HP and the combat task clears.
          const skipDeath = savedTask.type === 'combat' && sim?.died === true
          if (skipDeath) {
            setActiveTask(null)
            activeTaskRef.current = null
            try { localStorage.removeItem('pocketrpg_activeTask') } catch {}
            const oneLifeMode = isOneLife || getOneLifeMode()
            if (oneLifeMode) {
              void triggerOneLifeDeath(addToast)
              return
            }
            addToast('You died during the skipped hour!', 'error')
            sim.hpAfterRegen = getMaxHP()
            sim.hpRestored = 0
          } else if (savedTask.type === 'combat' && Number.isFinite(Number(sim.finalHP))) {
            // Apply HP changes. Idle combat with active supplies returns
            // finalHP — that wins over plain idle HP regen so a session
            // that stopped early shows correctly.
            sim.hpAfterRegen = Math.max(1, Math.min(getMaxHP(), Math.floor(Number(sim.finalHP))))
            sim.hpRestored = 0
          } else {
            const hpRegenSim = simulateIdleHPRegen(elapsedMs)
            if (hpRegenSim.hpRegen > 0) {
              const maxHP = getLevelFromXP(freshStats.hitpoints?.xp || 0)
              const restoredHP = Math.min(currentHP + hpRegenSim.hpRegen, maxHP)
              sim.hpRestored = hpRegenSim.hpRegen
              sim.hpAfterRegen = restoredHP
            }
          }

          // Apply XP (skip combat/any — those require player choice via modal)
          if (savedTask.type !== 'quest' && sim.xpGained) {
            for (const [skill, xp] of Object.entries(sim.xpGained)) {
              if (skill !== 'combat' && skill !== 'any' && xp > 0) grantXP(skill, xp)
            }
          }
          // Apply slayer XP from combat simulation
          if (savedTask.type === 'combat' && sim.slayerXpGained > 0) {
            grantXP('slayer', sim.slayerXpGained)
          }
          // Apply items
          if ((savedTask.type === 'combat' || savedTask.type === 'skill' || savedTask.type === 'gather' || savedTask.type === 'clue') && sim.finalInventory) {
            updateInventory(sim.finalInventory)
            const bankedItems = sim.lootBanked || sim.itemsBanked || {}
            if (Object.keys(bankedItems).length > 0) {
              updateBankDirect(bankedItems)
            }
          } else if (sim.itemsGained) {
            updateBankDirect(sim.itemsGained)
          }
          if (savedTask.type === 'combat' && savedTask.monster?.id) {
            recordCollectionLogDropsForIdleCombat(savedTask.monster.id, sim)
          }
          if ((savedTask.type === 'gather' || savedTask.type === 'clue') && savedTask.gatherTask?.isClue) {
            recordCollectionLogDropsForIdleClues(savedTask, sim)
          }
          // Apply agility coin reward directly to bank
          if (savedTask.type === 'agility' && sim.coinsGained > 0) {
            updateBankDirect({ coins: sim.coinsGained })
          }
          // Apply thieving coin reward directly to bank
          if (savedTask.type === 'thieving' && sim.coinsGained > 0) {
            updateBankDirect({ coins: sim.coinsGained })
          }
          // Apply alchemy coin reward directly to bank
          if (savedTask.type === 'skill' && savedTask.action?.type === 'alchemy' && sim.coinsGained > 0) {
            updateBankDirect({ coins: sim.coinsGained })
          }
          // Apply hunter rewards directly to bank
          if (savedTask.type === 'hunter' && sim.rewards && sim.rewards.length > 0) {
            const bankedItems = {}
            for (const reward of sim.rewards) {
              if (bankedItems[reward.itemId]) {
                bankedItems[reward.itemId] += reward.quantity
              } else {
                bankedItems[reward.itemId] = reward.quantity
              }
            }
            updateBankDirect(bankedItems)
          }
          if (sim.rewardCompleted) {
            // Long-form skill reward (e.g. Dungeoneering equipment unlock)
            // finished — clear the task so the user can start a new action.
            setActiveTask(null)
          } else if ((savedTask.type === 'skill' || savedTask.type === 'gather') &&
              (sim.stoppedReason === 'inventory_full' || sim.stoppedReason === 'out_of_materials')) {
            // Skill/gather that ran out of materials or filled the inventory stops.
            setActiveTask(null)
            activeTaskRef.current = null
            try { localStorage.removeItem('pocketrpg_activeTask') } catch {}
            addToast(sim.stoppedReason === 'inventory_full' ? 'Inventory full — gathering stopped.' : 'Out of materials!', 'error')
          } else if (sim.ticksRemaining !== undefined) {
            // Non-quest task — update progress if partial
            setActiveTask({
              ...savedTask,
              ticksRemaining: sim.ticksRemaining,
            })
          }

          // Merge simulation data into idle result
          if (sim) {
            idleResultData = { ...idleResultData, ...sim }
          }
          // Deduct consumed materials from bank
          if (sim.itemsConsumed && Object.keys(sim.itemsConsumed).length > 0) {
            const negated = {}
            for (const [itemId, qty] of Object.entries(sim.itemsConsumed)) {
              negated[itemId] = -qty
            }
            updateBankDirect(negated)
          }

          if (savedTask.type === 'combat' && sim.ammoConsumed && freshEq?.ammo && freshEq.ammo.itemId === sim.ammoConsumed.itemId) {
            const remainingAmmo = Math.max(0, (freshEq.ammo.quantity || 0) - sim.ammoConsumed.quantity)
            freshEq.ammo = remainingAmmo > 0 ? { ...freshEq.ammo, quantity: remainingAmmo } : null
            updateEquipment({ ...freshEq })
          }

          if (savedTask.type === 'combat' && sim.chargesConsumed > 0 && freshEq?.weapon) {
            const remainingCharges = Math.max(0, (freshEq.weapon.charges || 0) - sim.chargesConsumed)
            freshEq.weapon = { ...freshEq.weapon, charges: remainingCharges }
            updateEquipment({ ...freshEq })
          }
          // Deduct runes consumed from bank
          if (sim.runesConsumed && Object.keys(sim.runesConsumed).length > 0) {
            const negated = {}
            for (const [itemId, qty] of Object.entries(sim.runesConsumed)) {
              negated[itemId] = -qty
            }
            updateBankDirect(negated)
          }
          if (sim.dungeoneeringTokensGained > 0) awardDungeoneeringTokens(sim.dungeoneeringTokensGained)
          // Persist slayer task update if present
          if (savedTask.type === 'combat' && sim.slayerTaskUpdate) {
            if (sim.slayerTaskUpdate.completed) {
              setSlayerTask(null)
              const reward = getSlayerTaskReward(sim.slayerTaskUpdate.pointsOnComplete, slayerTasksCompleted)
              setSlayerTasksCompleted(reward.totalTasks)
              awardSlayerPoints(reward.pointsEarned)
              addToast(`💀 Slayer Task #${reward.totalTasks} Completed - ${reward.pointsEarned.toLocaleString()} points.`, 'levelup')
            } else {
              setSlayerTask(sim.slayerTaskUpdate)
            }
          }

          // Update HP from regen if applicable
          if (sim.hpAfterRegen !== undefined) {
            updateHP(sim.hpAfterRegen)
          }
        }
      } else {
        // No active task — just apply HP regen
        const hpRegenSim = simulateIdleHPRegen(elapsedMs)
        if (hpRegenSim.hpRegen > 0) {
          const maxHP = getLevelFromXP(freshStats.hitpoints?.xp || 0)
          const restoredHP = Math.min(currentHP + hpRegenSim.hpRegen, maxHP)
          updateHP(restoredHP)
        }
      }

      if (!isChargeableSkipOutcome(task, idleResultData)) {
        clearExhaustedActiveTask(preflight?.reason || 'No remaining actions available for this activity.')
        return
      }

      updateFarming(advanceFarmingState(farming, SKIP_HOUR_MS))

      // Persist the paid skip to the cloud BEFORE revealing the reward.
      // persistSkipThenReveal keeps the saving overlay up until the save
      // lands, then shows the idle-result modal — so a refresh mid-save
      // can't lose progress the player spent a credit on.
      await persistSkipThenReveal(idleResultData)
      didShowIdleModal = !!idleResultData
    } catch (err) {
      console.error('[PocketRPG] Skip 1h error:', err)
      if (err?.status === 402) {
        addToast('You do not have enough credits to skip.', 'error')
        await refreshMe?.()
      } else {
        addToast(err.message || 'Error during skip!', 'error')
      }
    } finally {
      // Release the skip lock (it pairs with THIS handler's lockGame — the
      // in-place conflict rollback holds its own overlay). Ticks stay paused
      // when an idle-result modal is up (closeIdleResultModal resumes) or a
      // conflict rollback is re-applying the cloud copy (it resumes itself).
      unlockGame()
      if (!didShowIdleModal && !isSaveConflict()) resumeTicks()
      isSkippingRef.current = false
    }
  }

  // Expose the skip handler so the combat loot modal can trigger another skip.
  // Reassigned every render to keep the latest closure (state/credits) fresh.
  if (skipHourHandlerRef) skipHourHandlerRef.current = handleSkip1h

  // Charge a server-authoritative skip (e.g. full-raid skip) and keep the
  // header credits display in sync. Throws on failure (e.g. 402) so the caller
  // can surface the error without spending; the loot grant is the caller's job.
  async function chargeSkipCredits(body = {}) {
    const result = await api.skipHour(body)
    setCredits(result?.credits_remaining ?? credits)
    return result
  }
  if (chargeSkipRef) chargeSkipRef.current = chargeSkipCredits

  // OAuth consent — an MCP client (e.g. ChatGPT) is connecting. Takes priority
  // over the normal boot path; OAuthConsentScreen handles login itself.
  if (oauthRequest) {
    return (
      <OAuthConsentScreen
        requestToken={oauthRequest}
        onClose={() => {
          try { sessionStorage.removeItem('pocketrpg_oauth_req') } catch { /* ignore */ }
          setOauthRequest(null)
        }}
      />
    )
  }

  // Cloud conflict modal — shown while cloudPhase is still resolving
  if (conflict) {
    const fmt = (ms) => ms ? new Date(ms).toLocaleString() : '—'
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', background: '#0f0f0f' }}>
        <div style={{ width: '100%', maxWidth: '380px', background: '#1a1a1a', borderRadius: '20px', border: '1px solid #333', overflow: 'hidden' }}>
          <div style={{ padding: '20px', borderBottom: '1px solid #333' }}>
            <h2 style={{ fontFamily: 'Cinzel, serif', fontSize: '17px', color: '#d4af37', textAlign: 'center', marginBottom: '8px' }}>Cloud save is newer</h2>
            <p style={{ fontSize: '12px', color: '#e8d5b0', opacity: 0.7, textAlign: 'center', lineHeight: 1.5 }}>
              Your cloud save was updated more recently than the save on this device. Which copy do you want to keep?
            </p>
          </div>
          <div style={{ padding: '16px' }}>
            <div style={{ fontSize: '11px', color: '#e8d5b0', opacity: 0.5, marginBottom: '4px' }}>☁️ Cloud: {fmt(conflict.cloudUpdatedAt)}</div>
            <div style={{ fontSize: '11px', color: '#e8d5b0', opacity: 0.5, marginBottom: '16px' }}>💾 Local: {fmt(conflict.localUpdatedAt)}</div>
            <button onClick={() => resolveConflict(true)} style={{ width: '100%', padding: '13px', borderRadius: '12px', background: 'linear-gradient(135deg, #b8940e, #d4af37)', color: '#0f0f0f', fontFamily: 'Cinzel, serif', fontWeight: 'bold', fontSize: '14px', border: 'none', cursor: 'pointer', marginBottom: '10px' }}>Use Cloud Save</button>
            <button onClick={() => resolveConflict(false)} style={{ width: '100%', padding: '13px', borderRadius: '12px', background: '#2a2a2a', border: '1px solid #3a3a3a', color: '#e8d5b0', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>Keep Local (overwrites cloud next save)</button>
          </div>
        </div>
      </div>
    )
  }

  // Auth gate — shown before we touch local save
  if (cloudPhase === 'auth') {
    if (cloudLoadError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[var(--color-void)] text-[var(--color-parchment)] p-4">
          <div className="max-w-md w-full rounded-xl border border-[var(--color-void-border)] bg-[var(--color-void-light)] p-4">
            <h2 className="font-[var(--font-display)] text-[var(--color-gold)] mb-2">Cloud save unavailable</h2>
            <p className="text-sm mb-4">{cloudLoadError}</p>
            <button onClick={() => { setGameReady(false); setCloudPhase('pending'); setCloudLoadError(null); initCloudAndSave() }} className="w-full mb-2 rounded-lg px-3 py-2 bg-[var(--color-gold)] text-black font-semibold">Retry</button>
            <button onClick={forceRestart} className="w-full rounded-lg px-3 py-2 border border-[var(--color-void-border)]">Force Restart</button>
          </div>
        </div>
      )
    }
    return (
      <AuthScreen
        onPlayDemo={enterDemoMode}
        onCloudReady={async () => {
          // After character selection, re-run the full cloud+local boot
          setCloudPhase('pending')
          await initCloudAndSave()
        }}
      />
    )
  }

  if (cloudPhase === 'pending') {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f0f0f' }}>
        <div style={{ fontFamily: 'Cinzel, serif', fontSize: '20px', color: '#d4af37' }}>Loading…</div>
      </div>
    )
  }

  // Loading (also waits on the lazy in-game chunk in the single-file build)
  if (!loaded || !gameReady || !gameChunkReady) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f0f0f' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: 'Cinzel, serif', fontSize: '20px', color: '#d4af37', marginBottom: '8px' }}>Loading...</div>
        </div>
      </div>
    )
  }

  // Main game
  const renderScreen = () => {
    // Backstop for the locked nav: if a cloud-only screen is somehow reached in
    // the demo (deep link, home shortcut), show the locked placeholder instead.
    if (demoMode && CLOUD_ONLY_SCREENS.has(screen)) {
      return <DemoLockedScreen screen={screen} onBack={() => navigate(SCREENS.HOME)} />
    }
    // Screens entered with a returnTo (started from the place map) hand their
    // back/stop buttons this callback — back to wherever the player came from.
    const rt = actionData?.returnTo
    const returnNav = rt?.screen ? () => navigate(rt.screen, rt.data) : undefined
    // Fallback for screens without a returnTo: back to the previous screen.
    const prev = prevScreenRef.current
    const backToPrev = prev ? () => navigate(prev) : undefined
    // Stop & Back on the skill screens: place-map origin wins, else last screen.
    const stopBackNav = returnNav || backToPrev
    switch (screen) {
      case SCREENS.HOME:      return <HomeScreen onNavigate={navigate} onLogout={handleLogoutToCharacterSelect} onManualSave={handleManualSave} isCloudAccount={!!getToken() && !!getCharacterId()} removeAds={removeAds} identityId={identityId} characterId={getCharacterId()} stripeLinks={stripeLinks} />
      case SCREENS.STATS:     return <StatsScreen />
      case SCREENS.INVENTORY: return <InventoryScreen />
      case SCREENS.EQUIPMENT: return <EquipmentScreen />
      case SCREENS.ARMOURY:   return <ArmouryScreen onBack={backToPrev} />
      case SCREENS.BANK:      return <BankScreen onBack={returnNav || backToPrev} />
      case SCREENS.COMBAT:    return <CombatScreen onNavigate={navigate} initialMonsterId={actionData?.monsterId} initialRaidId={actionData?.raidId} onCombatStatusChange={setIsInCombat} onBack={returnNav} onStopBack={stopBackNav} />
      case SCREENS.SKILLS:    return <SkillingScreen initialSkillId={actionData?.skillId} initialActionId={actionData?.actionId} initialMasterId={actionData?.masterId} initialLocationId={actionData?.locationId} idleResult={idleResult} onNavigate={navigate} onBack={returnNav} onStopBack={stopBackNav} />
      case SCREENS.GATHER:    return <GatherScreen initialTaskId={actionData?.gatherTaskId} idleResult={idleResult} onBack={returnNav} onStopBack={stopBackNav} />
      case SCREENS.AGILITY:     return <AgilityScreen initialActionId={actionData?.actionId} idleResult={idleResult} onBack={returnNav} onStopBack={stopBackNav} />
      case SCREENS.MAGIC:       return <MagicScreen onNavigate={navigate} onBack={returnNav} onStopBack={stopBackNav} />
      case SCREENS.WORLD_MAP:   return isWorldMapEnabled() ? <WorldMapScreen onNavigate={navigate} onAutoStart={resumeAutoStart} initialView={actionData?.view} /> : <HomeScreen onNavigate={navigate} onLogout={handleLogoutToCharacterSelect} onManualSave={handleManualSave} isCloudAccount={!!getToken() && !!getCharacterId()} removeAds={removeAds} identityId={identityId} characterId={getCharacterId()} stripeLinks={stripeLinks} />
      case SCREENS.STORE:       return <TradingPostScreen onBack={backToPrev} />
      case SCREENS.QUESTS:         return <QuestsScreen onNavigate={navigate} onBack={stopBackNav} />
      case SCREENS.CLUES:          return <CluesScreen onNavigate={navigate} onBack={backToPrev} />
      case SCREENS.MINIGAMES:      return <MinigamesScreen initialTaskId={actionData?.minigameTaskId} />
      case SCREENS.COLLECTION_LOG: return <CollectionLogScreen onBack={backToPrev} />
      case SCREENS.LEADERBOARD:    return <LeaderboardScreen onBack={backToPrev} />
      case SCREENS.HELP:                return <HelpScreen onNavigate={navigate} />
      case SCREENS.CHARACTER_UNLOCKS:   return <CharacterUnlockScreen onBack={backToPrev || (() => navigate(SCREENS.HOME))} />
      case SCREENS.CONNECT_AI:          return <ConnectAiScreen isCloudAccount={!!getToken() && !!getCharacterId()} onBack={backToPrev} />
      default:                  return <HomeScreen onNavigate={navigate} onLogout={handleLogoutToCharacterSelect} onManualSave={handleManualSave} isCloudAccount={!!getToken() && !!getCharacterId()} />
    }
  }

  const closeIdleResultModal = () => {
    if (idleResult?.rewardCompleted && idleResult?.task?.type === 'skill' && idleResult?.task?.skill === 'dungeoneering') {
      setScreen(SCREENS.SKILLS)
      setActionData({ skillId: 'dungeoneering' })
    }
    resumeTicks()
    setIdleResult(null)
  }

  const isCloudAccount = !!getToken() && !!getCharacterId()

  // Skip button mode for the frame bar's skip button.
  const skipMode = activeTask?.type === 'combat' && (activeTask?.monster?.boss === true || activeTask?.raid === true) ? 'kill' : 'hour'
  const raidSkipCost = activeTask?.type === 'combat' && activeTask?.raidId ? (raidsData[activeTask.raidId]?.skipCost ?? 1) : null

  return (
    <div class="h-full flex flex-col">
      {/* gf-shell/gf-main: carved-wood chrome around the frame rails + content
          panel (index.css) — the app chrome at every viewport width. */}
      <div class="gf-shell flex-1 flex flex-col min-w-0 min-h-0">
        {/* OSRS-style frame: icon rails above and below the content panel are
            the whole navigation chrome — screens keep their own desktop layouts. */}
        <GameFrameBar position="top" active={screen} onNavigate={(s) => navigate(s)} isInCombat={isInPvpMatch} onDisabledClick={() => addToast('⚔️ Cannot navigate during PvP combat!', 'warning')} demo={demoMode} lockedScreens={CLOUD_ONLY_SCREENS} onLockedClick={notifyDemoLocked} onLockedFeature={notifyDemoLocked} />
        <ToastContainer />
        <TravelPrompt onNavigate={navigate} />
        <main class="gf-main flex-1 overflow-hidden">
          {renderScreen()}
        </main>
        <GameFrameBar position="bottom" active={screen} onNavigate={(s) => navigate(s)} isInCombat={isInPvpMatch} onDisabledClick={() => addToast('⚔️ Cannot navigate during PvP combat!', 'warning')} demo={demoMode} lockedScreens={CLOUD_ONLY_SCREENS} onLockedClick={notifyDemoLocked} onLockedFeature={notifyDemoLocked} onBuyCredits={() => setShowBuyCreditsModal(true)} credits={credits} isCloudAccount={isCloudAccount} onSkip1h={isCloudAccount ? handleSkip1h : null} skipMode={skipMode} raidSkipCost={raidSkipCost} onDailyTasks={() => setShowDailyTasksModal(true)} dailyTasksCompleted={(dailyTaskStates || []).filter(t => t.completed).length} dailyTasksTotal={5} />
      </div>
      <XpDropOverlay />
      <RewardRevealOverlay />
      <LevelUpOverlay />
      <ChatWidget isCloudAccount={isCloudAccount && !demoMode} />

      {/* Game-lock overlay — shown for the WHOLE of any durable-save operation
          (manual save, skip-hour/quest, boss skip, raid skip), not just the
          final write. The game is frozen (input blocked, autosaves suspended)
          until the server responds, so the player cannot keep playing and
          produce competing writes that race the operation's save. */}
      {(skipSaving || gameLocked) && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 250, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '30px', marginBottom: '10px' }}>⏭️</div>
            <div style={{ fontFamily: 'Cinzel, serif', fontSize: '18px', color: '#d4af37', marginBottom: '6px' }}>Saving your progress…</div>
            <div style={{ fontSize: '12px', color: '#c8a96e', opacity: 0.8 }}>Please don't close the app.</div>
          </div>
        </div>
      )}

      {/* Rollback overlay — shown when a save-revision conflict means our local
          state diverged from the server. We discard the bad local state and
          reload to re-pull the authoritative cloud copy. Sits above everything. */}
      {rollingBack && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '30px', marginBottom: '10px' }}>☁️</div>
            <div style={{ fontFamily: 'Cinzel, serif', fontSize: '18px', color: '#d4af37', marginBottom: '6px' }}>Restoring your saved game…</div>
            <div style={{ fontSize: '12px', color: '#c8a96e', opacity: 0.8 }}>Syncing the latest progress from the cloud.</div>
          </div>
        </div>
      )}

      {/* Save-blocked modal — hard stop when cloud saves keep failing. Sits
          above every other overlay so the player cannot keep playing on top of
          progress that isn't persisting. Only Retry or Logout get them out. */}
      {saveBlocked && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <div style={{ width: '100%', maxWidth: '380px', background: '#1a1a1a', borderRadius: '20px', border: '1px solid #5a2a2a', overflow: 'hidden' }}>
            <div style={{ background: 'linear-gradient(135deg, #3a1414, #2a1a0a)', padding: '20px 20px 16px', borderBottom: '1px solid #5a2a2a' }}>
              <div style={{ fontSize: '28px', textAlign: 'center', marginBottom: '6px' }}>⚠️</div>
              <h2 style={{ fontFamily: 'Cinzel, serif', fontSize: '17px', color: '#ff6b6b', textAlign: 'center', marginBottom: '4px' }}>Save Failed</h2>
              <p style={{ fontSize: '12px', color: '#e8d5b0', textAlign: 'center', opacity: 0.8, lineHeight: 1.5 }}>
                We couldn't save your progress to the cloud. To avoid losing progress, the game is paused until your save goes through.
              </p>
            </div>
            <div style={{ padding: '16px' }}>
              <p style={{ fontSize: '11px', color: '#e8d5b0', textAlign: 'center', opacity: 0.5, marginBottom: '16px', lineHeight: 1.5 }}>
                Check your internet connection, then retry. If you log out now, recent unsaved progress may be lost.
              </p>
              <button
                onClick={handleRetryBlockedSave}
                disabled={retryingBlockedSave}
                style={{ width: '100%', padding: '13px', borderRadius: '12px', background: 'linear-gradient(135deg, #b8940e, #d4af37)', color: '#0f0f0f', fontFamily: 'Cinzel, serif', fontWeight: 'bold', fontSize: '14px', border: 'none', cursor: retryingBlockedSave ? 'wait' : 'pointer', marginBottom: '10px', opacity: retryingBlockedSave ? 0.7 : 1 }}
              >
                {retryingBlockedSave ? 'Retrying…' : 'Retry Save'}
              </button>
              <button
                onClick={() => handleLogoutToCharacterSelect({ skipSave: true })}
                disabled={retryingBlockedSave}
                style={{ width: '100%', padding: '13px', borderRadius: '12px', background: '#2a2a2a', border: '1px solid #3a3a3a', color: '#e8d5b0', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}
              >
                Log Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Idle Result Modal */}
      {idleResult && !skipSaving && !gameLocked && pvp.phase !== 'in_match' && Date.now() >= suppressIdleModalUntil && (() => {
        const hrs = idleResult.elapsedMs / 3600000
        const perHr = (n) => hrs > 0 ? Math.round(n / hrs).toLocaleString() : '—'

        // Quest cascades reveal via the reward card, never this modal — only a
        // cloud-override result can still carry a quest task here.
        // Clues are type 'clue' with the tier on gatherTask.clueLevel.
        const clueTier = idleResult.task?.gatherTask?.clueLevel
        const clueTierLabel = clueTier ? `${clueTier.charAt(0).toUpperCase()}${clueTier.slice(1)} Clue` : 'a Clue'
        const taskLabel = idleResult.died ? 'You died during idle combat'
          : idleResult.task?.type === 'quest' ? 'Completing Quests'
          : (idleResult.task ? (
              idleResult.task.type === 'combat' ? `Fighting ${idleResult.task.monster?.name || ''}` :
              idleResult.task.type === 'skill' ? `Training ${idleResult.task.skill}` :
              idleResult.task.type === 'clue' ? `Completing ${clueTier ? `a ${clueTierLabel}` : clueTierLabel}` :
              idleResult.task.type === 'gather' ? idleResult.task.gatherTask?.name :
              idleResult.task.type === 'minigame' ? idleResult.task.minigameTask?.name :
              idleResult.task.type === 'thieving' ? `Pickpocketing ${idleResult.task.npc?.name}` :
              idleResult.task.type === 'agility' ? 'Training agility' :
              idleResult.task.type === 'hunter' ? idleResult.task.action?.name :
              undefined
            ) : undefined)

        // Build summary rows
        const xpEntries = idleResult.xpGained ? Object.entries(idleResult.xpGained).filter(([_, xp]) => xp > 0) : []
        const hasMonstersKilled = idleResult.task?.type === 'combat' && idleResult.monstersKilled > 0

        const summaryRows = []
        if (hasMonstersKilled) {
          summaryRows.push({ emoji: '🗡️', name: 'Monsters Slain', value: idleResult.monstersKilled.toLocaleString(), rate: perHr(idleResult.monstersKilled), big: true })
        }
        for (const [skill, xp] of xpEntries) {
          summaryRows.push({ emoji: undefined, name: skill.charAt(0).toUpperCase() + skill.slice(1), value: `+${Math.floor(xp).toLocaleString()}`, rate: perHr(xp), xp: true })
        }
        if (idleResult.slayerXpGained > 0) {
          summaryRows.push({ emoji: undefined, name: 'Slayer', value: `+${Math.floor(idleResult.slayerXpGained).toLocaleString()}`, rate: perHr(idleResult.slayerXpGained), xp: true })
        }
        if (idleResult.coinsGained > 0) {
          summaryRows.push({ emoji: <GameIcon iconKey="coins" size={16} color="var(--color-gold)" />, name: 'Coins Earned', value: idleResult.coinsGained.toLocaleString(), rate: perHr(idleResult.coinsGained) })
        }
        if (idleResult.dungeoneeringTokensGained > 0) {
          summaryRows.push({ emoji: <GameIcon iconKey="dungeon_gate" size={16} color="#7f8c95" />, name: 'Dungeoneering Tokens', value: `+${idleResult.dungeoneeringTokensGained.toLocaleString()}`, rate: perHr(idleResult.dungeoneeringTokensGained) })
        }

        // Build supplies rows
        const supplyRows = []
        if (idleResult.task?.type === 'combat' && idleResult.idleSupplies) {
          const supplies = idleResult.idleSupplies
          const consumedFood = idleResult.foodConsumed || {}
          const consumedPotions = idleResult.potionsConsumed || {}
          for (const itemId of Object.keys(supplies.foodConfigured || {})) {
            const cap = Math.min(supplies.foodConfigured[itemId] || 0, supplies.foodAvailable[itemId] || 0)
            const used = consumedFood[itemId] || 0
            const name = itemsData[itemId]?.name || itemId
            supplyRows.push({ emoji: '🍗', name: 'Food', detail: name, val: `${used} / ${cap}`, low: used >= cap })
          }
          for (const itemId of Object.keys(supplies.potionsConfigured || {})) {
            const cap = Math.min(supplies.potionsConfigured[itemId] || 0, supplies.potionsAvailable[itemId] || 0)
            const used = consumedPotions[itemId] || 0
            const name = itemsData[itemId]?.name || itemId
            supplyRows.push({ emoji: '🧪', name: 'Potions', detail: name, val: `${used} / ${cap}` })
          }
        }

        // Build loot rows from merged idle loot
        const merged = {}
        for (const src of [idleResult.lootGained, idleResult.lootBanked, idleResult.lootLost, idleResult.itemsGained]) {
          if (!src) continue
          for (const [itemId, qty] of Object.entries(src)) {
            if (qty > 0) merged[itemId] = (merged[itemId] || 0) + qty
          }
        }
        // Also merge hunter rewards
        if (idleResult.task?.type === 'hunter' && idleResult.rewards) {
          for (const reward of idleResult.rewards) {
            if (reward.itemId && reward.quantity > 0) {
              merged[reward.itemId] = (merged[reward.itemId] || 0) + reward.quantity
            }
          }
        }
        const lootEntries = Object.entries(merged)
        const lootRows = lootEntries.map(([itemId, qty]) => {
          const unitVal = getItemUnitValue(itemId, itemsData) || 0
          return {
            key: itemId,
            item: itemsData[itemId] || null,
            name: itemsData[itemId]?.name || itemId.replace(/_/g, ' '),
            quantity: qty,
            gp: unitVal * qty,
            unitGp: unitVal,
          }
        })
        const lootTotal = lootRows.reduce((s, r) => s + (r.gp || 0), 0)

        // Trophy the session's standout drop in the spotlight (instead of the
        // 💤 emoji), mirroring the boss/loot modal. Picks the highest *unit*
        // shop value (the rare/prestige drop), not the biggest stack — a
        // billion coins shouldn't outrank dragon claws — tie-broken by total
        // gp. Falls back to the emoji when nothing dropped or the player died
        // (the 💀 stays). The hero is de-duped out of the loot list below (it's
        // named under the spotlight); lootTotal still sums the whole session.
        const heroLoot = idleResult.died ? null : lootRows.reduce((best, r) => {
          if (!r.item) return best
          if (!best) return r
          if ((r.unitGp || 0) !== (best.unitGp || 0)) return (r.unitGp || 0) > (best.unitGp || 0) ? r : best
          return (r.gp || 0) > (best.gp || 0) ? r : best
        }, null)
        const restLootRows = heroLoot ? lootRows.filter(r => r !== heroLoot) : lootRows

        // Stopped-early / idle-death detection, hoisted so it can also feed the
        // "did anything happen" gate below (duplicated by the card JSX further down).
        const stoppedReason = idleResult.stoppedReason
        const effMs = idleResult.effectiveElapsedMs ?? null
        const showStoppedEarly = idleResult.task?.type === 'combat' && idleResult.idleSupplies &&
          (!!(stoppedReason && stoppedReason !== 'completed_elapsed' && effMs != null && effMs < idleResult.elapsedMs) || idleResult.died)

        // Clue scrolls consumed, hoisted for the same reason.
        const clueScrollCount = Object.entries(idleResult.itemsConsumed || {}).reduce((sum, [itemId, qty]) => {
          if (itemId.includes('clue')) return sum + qty
          return sum
        }, 0)

        // Nothing to report — no XP/kills/loot/quests/clues and no notable
        // event (death, boss/raid lockout, cloud override, reward/minigame
        // progress). Skip the modal entirely instead of popping up empty.
        const hasProgress = idleResult.died ||
          summaryRows.length > 0 ||
          lootRows.length > 0 ||
          !!idleResult.cloudOverride ||
          (idleResult.task?.type === 'combat' && (idleResult.task?.monster?.boss === true || idleResult.task?.raid === true)) ||
          !!idleResult.minigameTimeReduced ||
          !!idleResult.minigameCompleted ||
          !!idleResult.rewardTimeReduced ||
          !!idleResult.rewardCompleted ||
          (idleResult.slayerTaskUpdate && idleResult.monstersKilledOnTask > 0) ||
          (idleResult.completedQuests && idleResult.completedQuests.length > 0) ||
          showStoppedEarly ||
          clueScrollCount > 0

        if (!hasProgress) return null

        return (
          <LootResultModal
            theme={idleResult.died ? 'blood' : (hasIdleEpicLootDrop(idleResult, itemsData) ? 'purple' : 'gold')}
            kind="progress"
            icon={idleResult.died ? '💀' : '💤'}
            heroItem={heroLoot?.item || null}
            heroName={heroLoot?.name || null}
            heroQuantity={heroLoot?.quantity ?? null}
            heroGp={heroLoot?.gp ?? 0}
            eyebrow={idleResult.died ? undefined : `Away for ${formatIdleTime(idleResult.elapsedMs)}`}
            title={idleResult.died ? 'Defeated' : 'Welcome Back!'}
            sub={taskLabel ? taskLabel.toUpperCase() : undefined}
            skipLabel={!idleResult.died && isCloudAccount && idleResult.task && !(idleResult.task?.type === 'combat' && (idleResult.task?.monster?.boss === true || idleResult.task?.raid === true))
              ? 'Skip' : null}
            onSkip={handleSkip1h}
            summaryRows={summaryRows.length > 0 ? summaryRows : null}
            summaryHeading="Summary"
            summaryIcon="📊"
            suppliesRows={supplyRows.length > 0 ? supplyRows : null}
            suppliesHeading="Idle Supplies"
            suppliesIcon="🛡️"
            loot={restLootRows.length > 0 ? restLootRows : null}
            lootTitle="Loot"
            lootTotal={lootTotal}
            primaryAction={{ label: 'Continue Adventure', onClick: closeIdleResultModal }}
            onClose={closeIdleResultModal}
          >
            {/* Warnings and special cards injected as children */}
            <div class="lm-cards" style={{ position: 'relative', zIndex: 4 }}>
              {/* Cloud override notice */}
              {idleResult.cloudOverride && (
                <div class="lm-card" style={{ borderColor: 'rgba(123, 179, 240, 0.3)', borderLeft: '3px solid #7bb3f0' }}>
                  <div class="lm-card__head" style={{ color: '#7bb3f0' }}>
                    <span class="lm-card__icn">☁️</span>Cloud Save Loaded
                  </div>
                  <div style={{ fontSize: '11px', color: '#bcd7f5', lineHeight: '1.4' }}>
                    Another session saved while you were away. Idle progress was discarded to stay in sync.
                  </div>
                </div>
              )}

              {/* Boss/Raid Warning */}
              {idleResult.task?.type === 'combat' && (idleResult.task?.monster?.boss === true || idleResult.task?.raid === true) && (
                <div class="lm-card" style={{ borderColor: 'rgba(220, 53, 69, 0.3)', borderLeft: '3px solid #dc3545' }}>
                  <div class="lm-card__head" style={{ color: '#ff6b6b' }}>
                    <span class="lm-card__icn">⚠️</span>Boss/Raid Active
                  </div>
                  <div style={{ fontSize: '11px', color: '#ff8787', lineHeight: '1.4' }}>
                    Boss and raid fights cannot be fought while idle. Return to the fight to continue!
                  </div>
                </div>
              )}

              {/* Minigame / Reward Progress */}
              {idleResult.minigameTimeReduced && (
                <IdleResultProgressCard type='minigame_progress' idleResult={idleResult} taskName={idleResult.task?.gatherTask?.name || idleResult.task?.minigameTask?.name} />
              )}
              {idleResult.minigameCompleted && (
                <IdleResultProgressCard type='minigame_complete' idleResult={idleResult} taskName={idleResult.task?.gatherTask?.name || idleResult.task?.minigameTask?.name} />
              )}
              {idleResult.rewardTimeReduced && (
                <IdleResultProgressCard type='reward_progress' idleResult={idleResult} taskName={idleResult.task?.action?.name || 'Reward action'} />
              )}
              {idleResult.rewardCompleted && (
                <IdleResultProgressCard type='reward_complete' idleResult={idleResult} taskName={`${idleResult.task?.action?.name || 'Reward action'} completed.`} />
              )}

              {/* Slayer task update */}
              {idleResult.slayerTaskUpdate && idleResult.monstersKilledOnTask > 0 && (
                <div class="lm-card" style={{ borderColor: 'rgba(212, 175, 55, 0.3)', borderLeft: '3px solid #d4af37' }}>
                  <div class="lm-card__head" style={{ color: '#d4af37' }}>
                    <span class="lm-card__icn">💀</span>Slayer Task
                  </div>
                  <div style={{ fontSize: '12px', color: '#d4af37', fontWeight: 'bold' }}>
                    {idleResult.slayerTaskUpdate.completed
                      ? `${idleResult.monstersKilledOnTask.toLocaleString()} ${idleResult.slayerTaskUpdate.monsterName} — Task Complete!`
                      : `${idleResult.monstersKilledOnTask.toLocaleString()} ${idleResult.slayerTaskUpdate.monsterName} / ${idleResult.slayerTaskUpdate.monstersRemaining.toLocaleString()} remaining`}
                  </div>
                </div>
              )}

              {/* Quests Completed */}
              {idleResult.completedQuests && idleResult.completedQuests.length > 0 && (
                <div class="lm-card" style={{ borderColor: 'rgba(74, 222, 128, 0.3)', borderLeft: '3px solid #4ade80' }}>
                  <div class="lm-card__head" style={{ color: '#4ade80' }}>
                    <span class="lm-card__icn">📜</span>Quests Completed ({idleResult.completedQuests.length})
                  </div>
                  {idleResult.completedQuests.map((quest) => (
                    <div key={quest.id} style={{ padding: '4px 0', fontSize: '12px', color: 'var(--color-parchment)' }}>{quest.name}</div>
                  ))}
                </div>
              )}

              {/* Idle death / stopped early warning */}
              {showStoppedEarly && (() => {
                const reasonLabel = {
                  out_of_food: 'Ran out of food', out_of_hp: 'Ran out of HP',
                  out_of_prayer: 'Ran out of prayer', out_of_potion: 'Ran out of potions',
                  resource_limited: 'Out of ammo / runes / charges', died: 'You died',
                }[stoppedReason] || null
                return (
                  <div class="lm-card" style={{ borderColor: 'rgba(255, 135, 135, 0.3)', borderLeft: '3px solid #ff8787' }}>
                    <div class="lm-card__head" style={{ color: '#ff8787' }}>
                      <span class="lm-card__icn">{idleResult.died ? '☠️' : '⚠️'}</span>
                      {idleResult.died ? 'Combat Halted' : 'Stopped Early'}
                    </div>
                    <div style={{ fontSize: '11px', color: '#ff8787', lineHeight: '1.4' }}>
                      {idleResult.died
                        ? `You died during idle combat! Halted after ${formatIdleTime(effMs ?? 0)}.`
                        : `Combat ran for ${formatIdleTime(effMs)} of ${formatIdleTime(idleResult.elapsedMs)}${reasonLabel ? ` — ${reasonLabel}` : ''}`}
                    </div>
                  </div>
                )
              })()}

              {/* Clue scrolls completed */}
              {clueScrollCount > 0 && (
                <SummaryCard heading="Clue Scrolls" icon="📜" rows={[
                  { name: 'Completed', value: `×${clueScrollCount.toLocaleString()}`, rate: perHr(clueScrollCount) },
                ]} />
              )}
            </div>
          </LootResultModal>
        )
      })()}

      {showBuyCreditsModal && isCloudAccount && (
        <BuyCreditsModal
          onClose={() => setShowBuyCreditsModal(false)}
          identityId={identityId}
          characterId={getCharacterId()}
          stripeLinks={stripeLinks}
        />
      )}

      {showDailyTasksModal && isCloudAccount && (
        <DailyTasksModal
          onClose={() => setShowDailyTasksModal(false)}
          tasks={dailyTaskStates || []}
          resetInMs={dailyTaskResetInMs}
          taskPool={dailyTasksData}
        />
      )}

      {pendingXpChoices.length > 0 && (
        <QuestXpChoiceModal
          key={pendingXpChoices[0].questId}
          rewards={pendingXpChoices[0].rewards}
          questName={pendingXpChoices[0].questName}
          stats={stats}
          onComplete={handleXpChoiceComplete}
        />
      )}

      {skipConfirm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', background: 'rgba(0,0,0,0.8)' }}>
          <div style={{ width: '100%', maxWidth: '360px', background: '#1a1a1a', borderRadius: '20px', border: '1px solid #333', overflow: 'hidden' }}>
            <div style={{ padding: '20px', borderBottom: '1px solid #333' }}>
              <h2 style={{ fontFamily: 'Cinzel, serif', fontSize: '17px', color: '#d4af37', textAlign: 'center', marginBottom: '8px' }}>Skip this kill?</h2>
              <p style={{ fontSize: '13px', color: '#e8d5b0', opacity: 0.8, textAlign: 'center', lineHeight: 1.5 }}>
                Instantly defeating <b style={{ color: '#f0c040' }}>{skipConfirm.monsterName}</b> costs <b style={{ color: '#e879f9' }}>{skipConfirm.cost.toLocaleString()} credits</b>. Combat is paused until you decide.
              </p>
            </div>
            <div style={{ padding: '16px' }}>
              <button onClick={confirmBossSkip} style={{ width: '100%', minHeight: '44px', padding: '13px', borderRadius: '12px', background: 'linear-gradient(135deg, #b8940e, #d4af37)', color: '#0f0f0f', fontFamily: 'Cinzel, serif', fontWeight: 'bold', fontSize: '14px', border: 'none', cursor: 'pointer', marginBottom: '10px' }}>
                Skip for {skipConfirm.cost.toLocaleString()} credits
              </button>
              <button onClick={cancelBossSkip} style={{ width: '100%', minHeight: '44px', padding: '13px', borderRadius: '12px', background: '#2a2a2a', border: '1px solid #3a3a3a', color: '#e8d5b0', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
                Cancel — keep fighting
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Hard reset escape hatch for a stuck/failed boot. The cloud save is
// authoritative (the local IndexedDB save is only a cache), so wiping local
// state and re-pulling on the next login is a safe recovery. Auth is cleared
// first so we always land on the start screen even if the DB wipe wedges, and
// the DB wipe is time-boxed so a corrupt IndexedDB can't hang the reset. A
// full page reload guarantees a clean boot free of any wedged in-memory state.
async function forceRestart() {
  try { clearAuth() } catch (_) {}
  try { clearCollectionLogCache() } catch (_) {}
  try { resetSyncState() } catch (_) {}
  try {
    await Promise.race([
      wipeLocalSave(),
      new Promise(resolve => setTimeout(resolve, 3000)),
    ])
  } catch (_) {}
  try { closeDB() } catch (_) {}
  window.location.reload()
}

// Catches synchronous render/throw failures anywhere in the tree so a crash
// during boot shows a recovery screen instead of a blank/frozen page. Async
// hangs are handled separately by the boot watchdog inside GameApp.
class BootErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  componentDidCatch(error) {
    console.error('[PocketRPG] Uncaught render error:', error)
    this.setState({ error })
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', background: '#0f0f0f' }}>
        <div style={{ width: '100%', maxWidth: '380px', background: '#1a1a1a', borderRadius: '20px', border: '1px solid #333', padding: '20px' }}>
          <h2 style={{ fontFamily: 'Cinzel, serif', fontSize: '17px', color: '#d4af37', textAlign: 'center', marginBottom: '8px' }}>Something went wrong</h2>
          <p style={{ fontSize: '12px', color: '#e8d5b0', opacity: 0.7, textAlign: 'center', lineHeight: 1.5, marginBottom: '16px' }}>
            The game hit an unexpected error. Reload to try again, or force a restart to clear local data and return to the start screen.
          </p>
          <button onClick={() => window.location.reload()} style={{ width: '100%', padding: '13px', borderRadius: '12px', background: 'linear-gradient(135deg, #b8940e, #d4af37)', color: '#0f0f0f', fontFamily: 'Cinzel, serif', fontWeight: 'bold', fontSize: '14px', border: 'none', cursor: 'pointer', marginBottom: '10px' }}>Reload</button>
          <button onClick={forceRestart} style={{ width: '100%', padding: '13px', borderRadius: '12px', background: '#2a2a2a', border: '1px solid #3a3a3a', color: '#e8d5b0', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>Force Restart</button>
        </div>
      </div>
    )
  }
}

export default function App() {
  return (
    <BootErrorBoundary>
      <GameProvider>
        <PvpProvider>
          <GameApp />
        </PvpProvider>
      </GameProvider>
    </BootErrorBoundary>
  )
}
