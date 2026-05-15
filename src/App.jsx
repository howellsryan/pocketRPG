import { useState, useEffect, useRef } from 'preact/hooks'
import { GameProvider, useGame } from './state/gameState.jsx'
import { PvpProvider, usePvp } from './state/pvpState.jsx'
import BurgerMenu from './components/BurgerMenu.jsx'
import SideNav from './components/SideNav.jsx'
import Header from './components/Header.jsx'
import ToastContainer from './components/Toast.jsx'
import BuyCreditsModal from './components/BuyCreditsModal.jsx'
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
import QuestsScreen from './screens/QuestsScreen.jsx'
import CluesScreen from './screens/CluesScreen.jsx'
import MinigamesScreen from './screens/MinigamesScreen.jsx'
import CollectionLogScreen from './screens/CollectionLogScreen.jsx'
import LeaderboardScreen from './screens/LeaderboardScreen.jsx'
import HelpScreen from './screens/HelpScreen.jsx'
import AuthScreen from './screens/AuthScreen.jsx'
import { SCREENS } from './utils/constants.js'
import { hasSave, closeDB } from './db/database.js'
import { initNewGame, saveSetting, getSetting, getAllStats, getInventory, getEquipment, getBank } from './db/stores.js'
import { startTicks, stopTicks, onTick, pauseTicks } from './engine/tick.js'
import { wipeLocalSave } from './db/saveload.js'
import { api, captureTokenFromHash, getToken, getCharacterId, getCharacterName, setCharacter, clearAuth, getLocalCharacterId, setLocalCharacterId, getIronmanMode, getOneLifeMode } from './cloud/api.js'
import { schedulePushSave, pushNow, pullSave, applyCloudSave, checkCloudNewer, resetSyncState, requestCriticalPushSave } from './cloud/sync.js'
import { fetchIdleState, heartbeatIdleState, beaconIdleState, resetIdleStateSync } from './cloud/idleState.js'
import { formatIdleTime, simulateIdleSkilling, simulateIdleGather, simulateIdleCombat, simulateIdleAgility, simulateIdleHPRegen } from './engine/idleEngine.js'
import { defaultIdleCombatSetup } from './engine/idleSupplies.js'
import prayersData from './data/prayers.json'
import minigamesData from './data/minigames.json'
import { simulateIdleThieving } from './engine/thieving.js'
import { simulateIdleHunting } from './engine/hunter.js'
import { createQuestState } from './engine/quests.js'
import { simulateQuestIdleCascade, splitQuestXpRewards } from './engine/questIdleCascade.js'
import { getLevelFromXP } from './engine/experience.js'
import { pvpApi } from './cloud/pvp.js'
import { SKIP_HOUR_MS, getSkipPreflight, isChargeableSkipOutcome } from './engine/skipPreflight.js'
import { getSlayerTaskReward } from './engine/slayerRewards.js'
import { isHighValueDrop } from './utils/itemValue.js'
import { computeIdleElapsedMs } from './utils/idleElapsed.js'
import { advanceFarmingState } from './engine/farming.ts'
import { recordCollectionLogDrop, fetchCollectionLog, clearCollectionLogCache, onCollectionLogSlotComplete } from './cloud/collectionLog.js'
import { isLoggedDrop, collectIdleCombatLoggedDrops } from './engine/collectionLog.js'

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
    recordCollectionLogDrop({ itemId, sourceType: 'monsters', sourceId: monsterId })
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

function GameApp() {
  const { loaded, loadGame, player, stats, equipment, inventory, bank, currentHP, updateHP, getMaxHP, updateInventory, updateEquipment, updateBank, updateBankDirect, grantXP, addToast, activeTask, setActiveTask, itemsData, getSnapshot, unlockedFeatures, setSlayerTask, awardSlayerPoints, slayerTasksCompleted, setSlayerTasksCompleted, completeQuest, completedQuests, questQueue, removeFromQuestQueue, updateQuestQueue,
    unlockMinigameItem, awardDungeoneeringTokens, farming, updateFarming, idleCombatSetup } = useGame()
  const pvp = usePvp()
  const [screen, setScreen] = useState(SCREENS.HOME)
  const [menuOpen, setMenuOpen] = useState(false)
  const [gameReady, setGameReady] = useState(false)
  const [activity, setActivity] = useState(null)
  const [idleResult, setIdleResult] = useState(null) // { elapsedMs, task, xpGained, itemsGained, lootLost, monstersKilled }
  const [actionData, setActionData] = useState(null) // { monsterId, gatherTaskId, skillId, actionId }
  const [isInCombat, setIsInCombat] = useState(false) // Track if currently in combat
  const [pendingXpChoices, setPendingXpChoices] = useState([]) // [{ rewards, questId, questName }, ...]
  const completedQuestsRef = useRef(completedQuests)
  const pendingXpChoicesRef = useRef(pendingXpChoices)
  // Cloud auth gate: 'pending' until we resolve, 'auth' if AuthScreen needed, 'ready' to boot game
  const [cloudPhase, setCloudPhase] = useState('pending')
  const [cloudLoadError, setCloudLoadError] = useState(null)
  const [conflict, setConflict] = useState(null) // { cloudPayload, cloudHash, cloudUpdatedAt, localUpdatedAt }
  const [removeAds, setRemoveAds] = useState(false)
  const [identityId, setIdentityId] = useState(null)
  const [stripeLinks, setStripeLinks] = useState({})
  const [credits, setCredits] = useState(0)
  const [showBuyCreditsModal, setShowBuyCreditsModal] = useState(false)
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
  const idleHeartbeatCounter = useRef(49) // 50 ticks = ~30s — first heartbeat ~600ms after load
  const hiddenAtPerfRef = useRef(null) // performance.now() at hide — monotonic, immune to clock changes

  async function syncCompletedMinigameToServer(task) {
    if (!task?.id || !VALID_SERVER_MINIGAME_IDS.has(task.id) || !(getToken() && getCharacterId())) return
    const res = await api.completeMinigame(task.id, {
      actionNonce: `minigame:${task.id}:${Date.now()}`,
    })
    if (res?.save?.save_data) {
      await applyCloudSave(JSON.parse(res.save.save_data), res.save.updatedAt)
      await loadGame()
    }
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

  // Handle quest completion with queue cascading
  function handleQuestCompletion(quest, xpReward, coinReward) {
    // Award rewards
    const { fixed, choices } = splitQuestXpRewards(xpReward)
    for (const [skill, xp] of Object.entries(fixed)) grantXP(skill, xp)
    if (coinReward > 0) updateBankDirect({ coins: coinReward })

    // The completed quest was already removed from the queue when it was
    // started, so the queue holds the next quests to run. Pop the next one
    // off and promote it to the active task.
    promoteNextQueuedQuestOrClear()

    // Finalise the completed quest (show choice modal if needed)
    finaliseQuest(quest.id, quest.name, choices)
  }

  function clearPersistedActiveTask() {
    setActiveTask(null)
    activeTaskRef.current = null
    try { localStorage.removeItem('pocketrpg_activeTask') } catch { /* best-effort */ }
  }

  function promoteNextQueuedQuestOrClear() {
    const currentQueue = questQueueRef.current || []
    if (currentQueue.length === 0) {
      clearPersistedActiveTask()
      return null
    }

    const nextQuest = currentQueue[0]
    updateQuestQueue(currentQueue.slice(1))
    const state = createQuestState(nextQuest)
    const nextTask = {
      type: 'quest',
      quest: nextQuest,
      totalTicks: state.totalTicks,
      ticksRemaining: state.ticksRemaining,
      startedAt: state.startedAt,
    }
    setActiveTask(nextTask)
    activeTaskRef.current = nextTask
    addToast(`📜 Started: ${nextQuest.name}`, 'info')
    return nextTask
  }

  // Finalise a completed quest: show choice modal if needed, else complete immediately
  function finaliseQuest(questId, questName, choices) {
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

    addToast(`📜 Quest complete: ${questName}`, 'levelup', '🏆')
  }

  function handleXpChoiceComplete(chosen) {
    for (const { skill, xp } of chosen) grantXP(skill, xp)

    setPendingXpChoices(prev => {
      const head = prev[0]
      if (head) {
        addToast(`📜 Quest complete: ${head.questName}`, 'levelup', '🏆')
      }
      const next = prev.slice(1)
      pendingXpChoicesRef.current = next
      return next
    })
  }

  useEffect(() => {
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
  const questQueueRef = useRef(questQueue)
  const idleCombatSetupRef = useRef(idleCombatSetup)
  const currentHPRef = useRef(currentHP)
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
        // Flush any pending cloud push before the tab gets suspended.
        if (!isInPvpMatch) {
          try { pushNow(getSnapshot()) } catch (e) { /* non-fatal */ }
        }
        // Beacon the idle state to D1 — server stamps last_active_at on its
        // own clock so elapsed time on return is server-authoritative.
        if (!isInPvpMatch) {
          try { beaconIdleState(activeTaskRef.current) } catch (e) { /* non-fatal */ }
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
              sim = { minigameCompleted: true }
            } else {
              setActiveTask({ ...savedTask, totalTicks, ticksRemaining: newRemaining })
              sim = { minigameTimeReduced: true, hoursRemaining: Math.ceil(newRemaining / 6000) }
            }
          } else if (savedTask.type === 'skill')   sim = simulateIdleSkilling(savedTask, elapsedMs, freshBank, freshEq, freshStats, itemsDataRef.current, freshInv)
          else if (savedTask.type === 'gather')  sim = simulateIdleGather(savedTask, elapsedMs, freshInv, freshStats, itemsDataRef.current, freshBank)
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

            for (const entry of cascade.completed) {
              const quest = entry.quest
              const { fixed, choices } = splitQuestXpRewards(entry.xpReward || quest.xpReward || {})
              for (const [skill, xp] of Object.entries(fixed)) grantXP(skill, xp)
              if ((entry.coinReward || 0) > 0) {
                updateBankDirect({ coins: entry.coinReward })
                coinsGained += entry.coinReward
              }
              finaliseQuest(quest.id, quest.name, choices)
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
              setScreen(SCREENS.QUESTS)
            }

            setIdleResult({
              elapsedMs,
              task: cascade.finalTask,
              questCascade: true,
              completedQuests,
              aggregatedXpReward,
              coinsGained,
              elapsedMsUsed: cascade.elapsedMsUsed,
              elapsedMsRemaining: cascade.elapsedMsRemaining,
            })
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

          // Apply HP changes. For combat with active idle supplies the
          // simulator's finalHP is authoritative — combat may have stopped
          // partway, so we don't overlay full-session HP regen on top.
          if (savedTask.type === 'combat' && Number.isFinite(Number(sim.finalHP))) {
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
          if ((savedTask.type === 'combat' || savedTask.type === 'skill' || savedTask.type === 'gather') && sim.finalInventory) {
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
          if (savedTask.type === 'gather' && savedTask.gatherTask?.isClue) {
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

          setIdleResult({ elapsedMs, task: savedTask, ...sim })
          // Push the post-idle state to the cloud (debounced + hash-skipped).
          if (!isInPvpMatch) schedulePushSave(getSnapshot())
        } catch (err) {
          console.warn('[PocketRPG] Visibility idle error:', err)
          // DB may be stale — force reconnect for next read
          closeDB()
        }
      }
    }

    // beforeunload: safety net for mobile browsers where visibilitychange
    // doesn't fire reliably before a hard close (iOS Safari, Android Chrome)
    const handleBeforeUnload = () => {
      const now = Date.now()
      localStorage.setItem('pocketrpg_hiddenAt', String(now))
      updateMaxObservedAt(now)
      localStorage.setItem('pocketrpg_activeTask', JSON.stringify(activeTaskRef.current))
      if (!isInPvpMatch) {
        try { pushNow(getSnapshot()) } catch { /* non-fatal */ }
      }
      // sendBeacon survives tab-close where a regular fetch would be killed.
      if (!isInPvpMatch) {
        try { beaconIdleState(activeTaskRef.current) } catch { /* non-fatal */ }
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [gameReady, grantXP, updateInventory, updateBankDirect, isInPvpMatch])

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
        // Cloud sync piggy-backs on the local snapshot cadence (debounced, hash-skipped).
        if (!isInPvpMatch) schedulePushSave(getSnapshot())
      }
      // Idle heartbeat: ~30s cadence. Server stamps last_active_at on write,
      // so this keeps the "last seen" timestamp fresh even if the tab dies
      // suddenly (beacon on hide/unload is the other half).
      idleHeartbeatCounter.current++
      if (idleHeartbeatCounter.current >= 50) {
        idleHeartbeatCounter.current = 0
        if (!isInPvpMatch) heartbeatIdleState(activeTaskRef.current)
      }
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
          setActiveTask({ ...task, ticksRemaining: remaining })
        }
      }

      // Minigame (one-shot gather) tick — progresses on any screen
      if (task && task.type === 'gather' && task.gatherTask?.oneShot) {
        const total = task.totalTicks ?? task.gatherTask.ticks
        const remaining = (task.ticksRemaining ?? total) - 1
        if (remaining <= 0) {
          addToast(`${task.gatherTask.icon || '🎮'} ${task.gatherTask.name} complete!`, 'levelup', '🏆')
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
        } else {
          setActiveTask({ ...task, ticksRemaining: remaining, totalTicks: total })
        }
      }

      // QuestsScreen minigame tick — also progresses on any screen
      if (task && task.type === 'minigame' && task.minigameTask) {
        const total = task.totalTicks ?? task.minigameTask.ticks
        const remaining = (task.ticksRemaining ?? total) - 1
        if (remaining <= 0) {
          const mgTask = task.minigameTask
          addToast(`${mgTask.icon || '🎮'} ${mgTask.name} complete!`, 'levelup', '🏆')
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
        } else {
          setActiveTask({ ...task, ticksRemaining: remaining, totalTicks: total })
        }
      }
    })
    return unsub
  }, [gameReady, currentHP, stats, questQueue, isInPvpMatch])

  async function initCloudAndSave() {
    try {
      // Pull token dropped by OAuth redirect (#token=...) into localStorage + clean URL
      captureTokenFromHash()

      const hasToken = !!getToken()
      const hasCharacter = !!getCharacterId()

      if (!hasToken) {
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
          if (meData?.character) setCredits(meData.character.credits ?? 0)
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
          await applyCloudSave(result.payload, result.updatedAt)
        } else {
          await wipeLocalSave()
          await startNewGame(getIronmanMode(), getCharacterName(), getOneLifeMode())
          if (!isInPvpMatch) await pushNow(getSnapshot())
          setCloudPhase('ready')
          return
        }
      }

      setCloudPhase('ready')
      await checkSave()
      // Pull collection log alongside the save. Fire-and-forget — UI shows a
      // loading state until cache populates.
      fetchCollectionLog({ force: true }).catch(() => {})
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

  async function checkSave() {
    const isCloudCharacter = !!getToken() && !!getCharacterId()
    try {
      const exists = await hasSave()
      if (exists) {
        const idleResult = await loadGame()
        setGameReady(true)
        if (idleResult) {
          setIdleResult(idleResult)
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
            setIdleResult(idleResult)
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
  async function handleLogoutToCharacterSelect() {
    if (!isInPvpMatch) {
      try { await pushNow(getSnapshot()) } catch { /* non-fatal */ }
    }
    setActiveTask(null)
    localStorage.removeItem('pocketrpg_activeTask')
    localStorage.removeItem('pocketrpg_hiddenAt')
    setCharacter(null)
    resetSyncState()
    resetIdleStateSync()
    clearCollectionLogCache()
    setGameReady(false)
    setCloudPhase('auth')
  }



  async function handleManualSave() {
    if (isInPvpMatch) return
    try {
      await pushNow(getSnapshot())
      addToast('Game saved.', 'success')
    } catch {
      addToast('Save failed. Try again.', 'error')
    }
  }
  // Navigate with optional action data
  const navigate = (scr, data) => {
    // Navigating away stops any active screen-bound task (skilling, gathering,
    // combat, agility, thieving) and clears the idle-engine keys so it won't
    // re-process a cancelled task. Quests and minigames run in the background — preserve them.
    const isGatherMinigame = activeTask?.type === 'gather' && activeTask?.gatherTask?.oneShot
    const shouldPreserve = activeTask?.type === 'quest' || activeTask?.type === 'minigame' || isGatherMinigame
    if (!shouldPreserve) {
      setActiveTask(null)
    }
    setActionData(data || null)
    setScreen(scr)
  }

  const isSkippingRef = useRef(false)

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
      return
    }

    // Check if currently in boss/raid combat — bosses and raids cannot be skipped
    if (activeTaskRef.current?.type === 'combat' && (activeTaskRef.current?.monster?.boss === true || activeTaskRef.current?.raid === true)) {
      addToast('Cannot skip boss/raid combat!', 'error')
      return
    }

    // Check if there's an active task — prevent wasting credits
    if (!activeTaskRef.current) {
      addToast('Nothing to skip — start a task first!', 'error')
      isSkippingRef.current = false
      return
    }

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
      if (task?.type === 'quest') {
        const cascade = simulateQuestIdleCascade({
          activeTask: task,
          questQueue: questQueueRef.current || [],
          elapsedMs: SKIP_HOUR_MS,
          now: Date.now(),
        })
        const completedQuests = []
        const aggregatedXpReward = {}
        let coinsGained = 0

        for (const entry of cascade.completed) {
          const quest = entry.quest
          const { fixed, choices } = splitQuestXpRewards(entry.xpReward || quest.xpReward || {})
          for (const [skill, xp] of Object.entries(fixed)) grantXP(skill, xp)
          if ((entry.coinReward || 0) > 0) {
            updateBankDirect({ coins: entry.coinReward })
            coinsGained += entry.coinReward
          }
          finaliseQuest(quest.id, quest.name, choices)
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
          setScreen(SCREENS.QUESTS)
        }

        setIdleResult({
          elapsedMs: SKIP_HOUR_MS,
          task: cascade.finalTask,
          questCascade: true,
          completedQuests,
          aggregatedXpReward,
          coinsGained,
          elapsedMsUsed: cascade.elapsedMsUsed,
          elapsedMsRemaining: cascade.elapsedMsRemaining,
        })
        schedulePushSave(getSnapshot())
        addToast('⏭️ Skipped 1 hour', 'info')
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
          if (savedTask.type === 'skill')   sim = simulateIdleSkilling(savedTask, elapsedMs, freshBank, freshEq, freshStats, itemsDataRef.current, freshInv)
          if (savedTask.type === 'gather')  sim = simulateIdleGather(savedTask, elapsedMs, freshInv, freshStats, itemsDataRef.current, freshBank)
          if (savedTask.type === 'combat')  sim = simulateIdleCombat(savedTask, elapsedMs, freshStats, freshEq, freshInv, itemsDataRef.current, freshSlayerTask, freshBank, {
            currentHP: currentHPRef.current ?? getMaxHP(),
            idleFood: idleCombatSetupRef.current?.food || [],
            idlePotions: idleCombatSetupRef.current?.potions || [],
            idlePrayers: idleCombatSetupRef.current?.prayers || {},
            prayersData,
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
          // Apply HP changes. Idle combat with active supplies returns
          // finalHP (clamped to ≥1, no skip death) — that wins over plain
          // idle HP regen so a session that stopped early shows correctly.
          if (savedTask.type === 'combat' && Number.isFinite(Number(sim.finalHP))) {
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
          if ((savedTask.type === 'combat' || savedTask.type === 'skill' || savedTask.type === 'gather') && sim.finalInventory) {
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
          if (savedTask.type === 'gather' && savedTask.gatherTask?.isClue) {
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

      // Show idle result modal with skip summary
      if (idleResultData) setIdleResult(idleResultData)

      // Save the updated game state to cloud
      if (!isInPvpMatch) {
        schedulePushSave(getSnapshot())
        requestCriticalPushSave(() => getSnapshot(), CRITICAL_SAVE_REASONS.SKIP_HOUR)
      }
    } catch (err) {
      console.error('[PocketRPG] Skip 1h error:', err)
      if (err?.status === 402) {
        addToast('You do not have enough credits to skip.', 'error')
        await refreshMe?.()
      } else {
        addToast(err.message || 'Error during skip!', 'error')
      }
    } finally {
      isSkippingRef.current = false
    }
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
            <button onClick={() => { setCloudPhase('pending'); setCloudLoadError(null); initCloudAndSave() }} className="w-full mb-2 rounded-lg px-3 py-2 bg-[var(--color-gold)] text-black font-semibold">Retry</button>
            <button onClick={() => { clearAuth(); clearCollectionLogCache(); setCloudLoadError(null); setCloudPhase('auth') }} className="w-full rounded-lg px-3 py-2 border border-[var(--color-void-border)]">Log out</button>
          </div>
        </div>
      )
    }
    return (
      <AuthScreen
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

  // Loading
  if (!loaded || !gameReady) {
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
    switch (screen) {
      case SCREENS.HOME:      return <HomeScreen onNavigate={navigate} onLogout={handleLogoutToCharacterSelect} onManualSave={handleManualSave} isCloudAccount={!!getToken() && !!getCharacterId()} removeAds={removeAds} identityId={identityId} characterId={getCharacterId()} stripeLinks={stripeLinks} />
      case SCREENS.STATS:     return <StatsScreen />
      case SCREENS.INVENTORY: return <InventoryScreen />
      case SCREENS.EQUIPMENT: return <EquipmentScreen />
      case SCREENS.BANK:      return <BankScreen />
      case SCREENS.COMBAT:    return <CombatScreen onNavigate={navigate} initialMonsterId={actionData?.monsterId} initialRaidId={actionData?.raidId} onCombatStatusChange={setIsInCombat} />
      case SCREENS.SKILLS:    return <SkillingScreen initialSkillId={actionData?.skillId} initialActionId={actionData?.actionId} idleResult={idleResult} />
      case SCREENS.GATHER:    return <GatherScreen initialTaskId={actionData?.gatherTaskId} idleResult={idleResult} />
      case SCREENS.AGILITY:     return <AgilityScreen initialActionId={actionData?.actionId} idleResult={idleResult} />
      case SCREENS.STORE:       return <TradingPostScreen />
      case SCREENS.QUESTS:         return <QuestsScreen />
      case SCREENS.CLUES:          return <CluesScreen />
      case SCREENS.MINIGAMES:      return <MinigamesScreen />
      case SCREENS.COLLECTION_LOG: return <CollectionLogScreen />
      case SCREENS.LEADERBOARD:    return <LeaderboardScreen />
      case SCREENS.HELP:           return <HelpScreen />
      default:                  return <HomeScreen onNavigate={navigate} onLogout={handleLogoutToCharacterSelect} onManualSave={handleManualSave} isCloudAccount={!!getToken() && !!getCharacterId()} />
    }
  }

  const closeIdleResultModal = () => {
    if (idleResult?.rewardCompleted && idleResult?.task?.type === 'skill' && idleResult?.task?.skill === 'dungeoneering') {
      setScreen(SCREENS.SKILLS)
      setActionData({ skillId: 'dungeoneering' })
    }
    setIdleResult(null)
  }

  const isCloudAccount = !!getToken() && !!getCharacterId()

  return (
    <div class="h-full flex flex-col md:flex-row">
      <SideNav
        active={screen}
        onNavigate={(s) => navigate(s)}
        isInCombat={isInCombat}
        onDisabledClick={() => addToast('⚔️ Cannot navigate during combat!', 'warning')}
      />
      <div class="flex-1 flex flex-col min-w-0 min-h-0">
        <Header activity={activity} credits={credits} isCloudAccount={isCloudAccount} onSkip1h={isCloudAccount ? handleSkip1h : null} onBuyCredits={() => setShowBuyCreditsModal(true)} onMenuClick={() => setMenuOpen(true)} />
        <ToastContainer />
        <main class="flex-1 overflow-hidden">
          {renderScreen()}
        </main>
      </div>
      <BurgerMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        active={screen}
        onNavigate={(s) => navigate(s)}
        isInCombat={isInCombat}
        onDisabledClick={() => addToast('⚔️ Cannot navigate during combat!', 'warning')}
      />

      {/* Idle Result Modal */}
      {idleResult && pvp.phase !== 'in_match' && Date.now() >= suppressIdleModalUntil && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <div style={{ width: '100%', maxWidth: '380px', background: '#1a1a1a', borderRadius: '20px', border: '1px solid #333', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ background: 'linear-gradient(135deg, #1d3a2a, #2a1a0a)', padding: '20px 20px 16px', borderBottom: '1px solid #333' }}>
              <div style={{ fontSize: '28px', textAlign: 'center', marginBottom: '6px' }}>💤</div>
              <h2 style={{ fontFamily: 'Cinzel, serif', fontSize: '17px', color: '#d4af37', textAlign: 'center', marginBottom: '4px' }}>Welcome Back!</h2>
              <p style={{ fontSize: '12px', color: '#c8a96e', textAlign: 'center', opacity: 0.8 }}>
                Away for {formatIdleTime(idleResult.elapsedMs)}
              </p>
              {idleResult.task && (
                <p style={{ fontSize: '11px', color: '#e8d5b0', textAlign: 'center', opacity: 0.5, marginTop: '4px' }}>
                  {idleResult.task.type === 'combat' ? `Fighting ${idleResult.task.monster?.name}` :
                   idleResult.task.type === 'skill' ? `Training ${idleResult.task.skill}` :
                   idleResult.task.type === 'gather' ? idleResult.task.gatherTask?.name :
                   idleResult.task.type === 'minigame' ? idleResult.task.minigameTask?.name :
                   idleResult.task.type === 'thieving' ? `Pickpocketing ${idleResult.task.npc?.name}` :
                   idleResult.task.type === 'agility' ? `Training agility` :
                   idleResult.task.type === 'hunter' ? `${idleResult.task.action?.name}` :
                   idleResult.task.type === 'quest' ? `${idleResult.completedQuests?.length > 1 ? `✅ ${idleResult.completedQuests.length} Quests Completed` : (idleResult.completed ? '✅ Completed' : '⏳ On quest')}: ${idleResult.completedQuests?.length > 0 ? idleResult.completedQuests[0].name : idleResult.task.quest?.name}` : ''}
                </p>
              )}
            </div>

            {/* Content */}
            <div style={{ padding: '16px', maxHeight: '55vh', overflowY: 'auto' }}>
              {(() => {
                const hrs = idleResult.elapsedMs / 3600000
                const perHr = (n) => hrs > 0 ? Math.round(n / hrs).toLocaleString() : '—'
                const SKILL_ICONS = {
                  attack: '⚔️', strength: '💪', defence: '🛡️', hitpoints: '❤️',
                  ranged: '🏹', magic: '🔮', prayer: '🙏',
                  mining: '⛏️', woodcutting: '🪓', fishing: '🎣', farming: '🌾', hunter: '🪤',
                  smithing: '🔨', cooking: '🍳', crafting: '✂️', fletching: '🏹', herblore: '🧪', runecraft: '🔴',
                  agility: '🏃', thieving: '🗝️', slayer: '💀', firemaking: '🔥', construction: '🏠', dungeoneering: '🏰'
                }

                return (<>
                  {/* Cloud override notice — another session saved while we were away */}
                  {idleResult.cloudOverride && (
                    <div style={{ marginBottom: '12px', padding: '10px', background: 'rgba(123, 179, 240, 0.12)', borderRadius: '10px', borderLeft: '3px solid #7bb3f0' }}>
                      <div style={{ fontSize: '12px', color: '#7bb3f0', fontWeight: 'bold', marginBottom: '4px' }}>☁️ Cloud Save Loaded</div>
                      <div style={{ fontSize: '11px', color: '#bcd7f5', lineHeight: '1.4' }}>
                        Another session of this character saved while you were away. Idle progress on this device was discarded to keep both sessions in sync.
                      </div>
                    </div>
                  )}

                  {/* Boss/Raid Warning */}
                  {idleResult.task?.type === 'combat' && (idleResult.task?.monster?.boss === true || idleResult.task?.raid === true) && (
                    <div style={{ marginBottom: '12px', padding: '10px', background: 'rgba(220, 53, 69, 0.15)', borderRadius: '10px', borderLeft: '3px solid #dc3545' }}>
                      <div style={{ fontSize: '12px', color: '#ff6b6b', fontWeight: 'bold', marginBottom: '4px' }}>⚠️ Boss/Raid Active</div>
                      <div style={{ fontSize: '11px', color: '#ff8787', lineHeight: '1.4' }}>
                        Boss and raid fights cannot be fought while idle. You must actively fight. Return to the fight to continue!
                      </div>
                    </div>
                  )}

                  {/* Minigame Progress */}
                  {idleResult.minigameTimeReduced && (
                    <IdleResultProgressCard
                      type='minigame_progress'
                      idleResult={idleResult}
                      taskName={idleResult.task?.gatherTask?.name || idleResult.task?.minigameTask?.name}
                    />
                  )}

                  {/* Minigame Completed */}
                  {idleResult.minigameCompleted && (
                    <IdleResultProgressCard
                      type='minigame_complete'
                      idleResult={idleResult}
                      taskName={idleResult.task?.gatherTask?.name || idleResult.task?.minigameTask?.name}
                    />
                  )}

                  {/* Long-form Reward Progress (e.g. unlock actions) */}
                  {idleResult.rewardTimeReduced && (
                    <IdleResultProgressCard
                      type='reward_progress'
                      idleResult={idleResult}
                      taskName={idleResult.task?.action?.name || 'Reward action'}
                    />
                  )}

                  {idleResult.rewardCompleted && (
                    <div>
                      <IdleResultProgressCard
                        type='reward_complete'
                        idleResult={idleResult}
                        taskName={`${idleResult.task?.action?.name || 'Reward action'} completed.`}
                      />
                      {idleResult.itemsGained && Object.entries(idleResult.itemsGained).length > 0 && (
                        <div style={{ marginTop: '-4px', marginBottom: '12px', padding: '0 10px', fontSize: '12px', color: '#d4af37' }}>
                          🎁 Item achieved: {Object.entries(idleResult.itemsGained).map(([itemId, qty]) => `${itemsData[itemId]?.name || itemId} ×${qty}`).join(', ')}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Quests Completed */}
                  {idleResult.completedQuests && idleResult.completedQuests.length > 0 && (
                    <div style={{ marginBottom: '12px', padding: '10px', background: '#1a3a2a', borderRadius: '10px', borderLeft: '3px solid #4ade80' }}>
                      <div style={{ fontSize: '12px', color: '#4ade80', fontWeight: 'bold', marginBottom: '8px' }}>📜 Quests Completed ({idleResult.completedQuests.length})</div>
                      {idleResult.completedQuests.map((quest) => (
                        <div key={quest.id} style={{ marginBottom: '8px', padding: '6px', background: 'rgba(74, 222, 128, 0.1)', borderRadius: '6px' }}>
                          <div style={{ fontSize: '12px', color: '#e8d5b0' }}>{quest.name}</div>
                        </div>
                      ))}
                      {idleResult.aggregatedXpReward && Object.entries(idleResult.aggregatedXpReward).filter(([_, xp]) => xp > 0).length > 0 && (
                        <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(74, 222, 128, 0.2)' }}>
                          <div style={{ fontSize: '11px', color: '#4ade80', fontWeight: 'bold', marginBottom: '4px' }}>Total XP Rewards:</div>
                          {Object.entries(idleResult.aggregatedXpReward).filter(([_, xp]) => xp > 0).map(([skill, xp]) => (
                            <div key={skill} style={{ fontSize: '11px', color: '#d4af37', display: 'flex', justifyContent: 'space-between' }}>
                              <span>{skill.charAt(0).toUpperCase() + skill.slice(1)}</span>
                              <span>+{Math.floor(xp).toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* XP Gained Summary */}
                  {(() => {
                    // Use aggregated XP from completed quests if available, otherwise use xpGained
                    const xpSource = idleResult.aggregatedXpReward || idleResult.xpGained
                    const xpEntries = xpSource ? Object.entries(xpSource).filter(([_, xp]) => xp > 0) : []
                    const hasXp = xpEntries.length > 0
                    const hasMonstersKilled = idleResult.task?.type === 'combat' && idleResult.monstersKilled > 0
                    const hasSlayerXp = idleResult.slayerXpGained > 0
                    const taskCompleted = idleResult.slayerTaskUpdate?.completed

                    return (hasXp || hasMonstersKilled || hasSlayerXp || taskCompleted) ? (
                      <div style={{ marginBottom: '12px', padding: '10px', background: '#111', borderRadius: '10px' }}>
                        <div style={{ fontSize: '11px', color: '#e8d5b0', opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: '700', marginBottom: '6px' }}>📊 Summary</div>
                        {idleResult.slayerTaskUpdate && idleResult.monstersKilledOnTask > 0 && (
                          <div style={{ marginBottom: '8px', padding: '8px', background: 'rgba(212, 175, 55, 0.1)', borderRadius: '6px', borderLeft: '3px solid #d4af37' }}>
                            {taskCompleted ? (
                              <>
                                <div style={{ fontSize: '12px', color: '#d4af37', fontWeight: 'bold' }}>💀 Slayer: {idleResult.monstersKilledOnTask.toLocaleString()} {idleResult.slayerTaskUpdate.monsterName}</div>
                                <div style={{ fontSize: '11px', color: '#d4af37', marginTop: '2px' }}>✅ Task Complete!</div>
                              </>
                            ) : (
                              <div style={{ fontSize: '12px', color: '#d4af37', fontWeight: 'bold' }}>
                                💀 Slayer: {idleResult.monstersKilledOnTask.toLocaleString()} {idleResult.slayerTaskUpdate.monsterName} / {idleResult.slayerTaskUpdate.monstersRemaining.toLocaleString()} remaining
                              </div>
                            )}
                          </div>
                        )}
                        {hasMonstersKilled && (
                          <div style={{ marginBottom: '6px' }}>
                            <div style={{ fontSize: '13px', color: '#e8d5b0' }}>🗡️ Monsters Slain</div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#d4af37', fontFamily: 'monospace', fontWeight: 'bold' }}>
                              <span>{idleResult.monstersKilled.toLocaleString()}</span>
                              <span style={{ fontSize: '11px', color: '#e8d5b0', opacity: 0.45 }}>/hr {perHr(idleResult.monstersKilled)}</span>
                            </div>
                          </div>
                        )}
                        {xpEntries.map(([skill, xp]) => (
                          <div key={skill} style={{ marginBottom: '4px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#e8d5b0' }}>
                              <span>{SKILL_ICONS[skill] || '⭐'} {skill.charAt(0).toUpperCase() + skill.slice(1)}</span>
                              <span style={{ color: '#d4af37', fontFamily: 'monospace', fontWeight: 'bold' }}>+{Math.floor(xp).toLocaleString()}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#e8d5b0', opacity: 0.45 }}>
                              <span>/hr</span>
                              <span style={{ fontFamily: 'monospace' }}>{perHr(xp)}</span>
                            </div>
                          </div>
                        ))}
                        {hasSlayerXp && (
                          <div style={{ marginBottom: '4px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#e8d5b0' }}>
                              <span>{SKILL_ICONS.slayer} Slayer</span>
                              <span style={{ color: '#d4af37', fontFamily: 'monospace', fontWeight: 'bold' }}>+{Math.floor(idleResult.slayerXpGained).toLocaleString()}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#e8d5b0', opacity: 0.45 }}>
                              <span>/hr</span>
                              <span style={{ fontFamily: 'monospace' }}>{perHr(idleResult.slayerXpGained)}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : null
                  })()}

                  {idleResult.dungeoneeringTokensGained > 0 && (
                    <div style={{ marginBottom: '12px', padding: '10px', background: '#111', borderRadius: '10px' }}>
                      <div style={{ fontSize: '11px', color: '#e8d5b0', opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: '700', marginBottom: '6px' }}>🏰 Dungeoneering</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#e8d5b0' }}>
                        <span>Tokens Gained</span>
                        <span style={{ color: '#d4af37', fontFamily: 'monospace', fontWeight: 'bold' }}>+{idleResult.dungeoneeringTokensGained.toLocaleString()}</span>
                      </div>
                    </div>
                  )}

                  {/* Idle combat supply / prayer summary — only shown when an
                      idle combat supply was configured, so non-combat or unsupplied
                      sessions stay compact. */}
                  {idleResult.task?.type === 'combat' && idleResult.idleSupplies && (() => {
                    const supplies = idleResult.idleSupplies
                    const foodEntries = Object.keys(supplies.foodConfigured || {})
                    const potionEntries = Object.keys(supplies.potionsConfigured || {})
                    const consumedFood = idleResult.foodConsumed || {}
                    const consumedPotions = idleResult.potionsConsumed || {}
                    const stoppedReason = idleResult.stoppedReason
                    const effMs = idleResult.effectiveElapsedMs ?? null
                    const showShortened = stoppedReason && stoppedReason !== 'completed_elapsed' && effMs != null && effMs < idleResult.elapsedMs
                    const reasonLabel = {
                      out_of_food: 'Ran out of food',
                      out_of_hp: 'Ran out of HP',
                      out_of_prayer: 'Ran out of prayer',
                      out_of_potion: 'Ran out of potions',
                      resource_limited: 'Out of ammo / runes / charges',
                    }[stoppedReason] || null
                    if (foodEntries.length === 0 && potionEntries.length === 0 && !idleResult.prayerPointsStarted && !showShortened) return null
                    return (
                      <div style={{ marginBottom: '12px', padding: '10px', background: '#111', borderRadius: '10px' }}>
                        <div style={{ fontSize: '11px', color: '#e8d5b0', opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: '700', marginBottom: '6px' }}>🛡️ Idle Supplies</div>

                        {showShortened && (
                          <div style={{ marginBottom: '6px', fontSize: '11px', color: '#ff8787' }}>
                            ⚠ Combat ran for {formatIdleTime(effMs)} of {formatIdleTime(idleResult.elapsedMs)}{reasonLabel ? ` — ${reasonLabel}` : ''}
                          </div>
                        )}

                        {foodEntries.length > 0 && (
                          <div style={{ marginBottom: '4px' }}>
                            <div style={{ fontSize: '11px', color: '#a8d8a8', marginBottom: '2px' }}>🍖 Food</div>
                            {foodEntries.map(itemId => {
                              const cap = Math.min(supplies.foodConfigured[itemId] || 0, supplies.foodAvailable[itemId] || 0)
                              const used = consumedFood[itemId] || 0
                              const name = itemsData[itemId]?.name || itemId
                              return (
                                <div key={itemId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#e8d5b0' }}>
                                  <span>{name}</span>
                                  <span style={{ fontFamily: 'monospace' }}>{used} / {cap}</span>
                                </div>
                              )
                            })}
                          </div>
                        )}

                        {potionEntries.length > 0 && (
                          <div style={{ marginBottom: '4px' }}>
                            <div style={{ fontSize: '11px', color: '#a8d8a8', marginBottom: '2px' }}>🧪 Potions</div>
                            {potionEntries.map(itemId => {
                              const cap = Math.min(supplies.potionsConfigured[itemId] || 0, supplies.potionsAvailable[itemId] || 0)
                              const used = consumedPotions[itemId] || 0
                              const name = itemsData[itemId]?.name || itemId
                              return (
                                <div key={itemId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#e8d5b0' }}>
                                  <span>{name}</span>
                                  <span style={{ fontFamily: 'monospace' }}>{used} / {cap}</span>
                                </div>
                              )
                            })}
                          </div>
                        )}

                        {idleResult.prayerPointsStarted > 0 && (
                          <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px solid #222' }}>
                            <div style={{ fontSize: '11px', color: '#a8d8a8', marginBottom: '2px' }}>🙏 Prayer</div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#e8d5b0' }}>
                              <span>Started / Restored</span>
                              <span style={{ fontFamily: 'monospace' }}>{idleResult.prayerPointsStarted} / +{idleResult.prayerPointsRestored || 0}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#e8d5b0' }}>
                              <span>Used / Remaining</span>
                              <span style={{ fontFamily: 'monospace' }}>{idleResult.prayerPointsUsed || 0} / {idleResult.prayerPointsRemaining || 0}</span>
                            </div>
                            {idleResult.damagePreventedByPrayer > 0 && (
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#a8d8a8' }}>
                                <span>Damage Prevented</span>
                                <span style={{ fontFamily: 'monospace' }}>{idleResult.damagePreventedByPrayer.toLocaleString()}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })()}

                  {/* Coins earned — agility/thieving specific */}
                  {idleResult.coinsGained > 0 && (
                    <div style={{ marginBottom: '12px', padding: '10px', background: '#111', borderRadius: '10px' }}>
                      <div style={{ fontSize: '11px', color: '#e8d5b0', opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: '700', marginBottom: '6px' }}>💰 Coins</div>
                      <div style={{ marginBottom: '4px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#e8d5b0' }}>
                          <span>Coins Earned</span>
                          <span style={{ color: '#d4af37', fontFamily: 'monospace', fontWeight: 'bold' }}>🪙 {idleResult.coinsGained.toLocaleString()}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#e8d5b0', opacity: 0.45 }}>
                          <span>/hr</span>
                          <span style={{ fontFamily: 'monospace' }}>{perHr(idleResult.coinsGained)}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Hunter loot */}
                  {idleResult.task?.type === 'hunter' && idleResult.rewards && idleResult.rewards.length > 0 && (() => {
                    const itemsByName = {}
                    for (const reward of idleResult.rewards) {
                      const itemData = itemsDataRef.current?.[reward.itemId]
                      const name = itemData?.name || reward.itemId
                      if (itemsByName[name]) {
                        itemsByName[name] += reward.quantity
                      } else {
                        itemsByName[name] = reward.quantity
                      }
                    }
                    const rewards = Object.entries(itemsByName)
                    return rewards.length > 0 ? (
                      <div style={{ marginBottom: '12px', padding: '10px', background: '#111', borderRadius: '10px' }}>
                        <div style={{ fontSize: '11px', color: '#e8d5b0', opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: '700', marginBottom: '6px' }}>🎯 Loot</div>
                        {rewards.slice(0, 8).map(([name, qty]) => (
                          <div key={name} style={{ marginBottom: '4px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#e8d5b0' }}>
                              <span>{name}</span>
                              <span style={{ color: '#d4af37', fontFamily: 'monospace', fontWeight: 'bold' }}>× {qty.toLocaleString()}</span>
                            </div>
                          </div>
                        ))}
                        {rewards.length > 8 && (
                          <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px solid rgba(212, 175, 55, 0.2)', fontSize: '11px', color: '#d4af37' }}>
                            +{rewards.length - 8} more items
                          </div>
                        )}
                      </div>
                    ) : null
                  })()}

                  {/* Clue scrolls completed */}
                  {(() => {
                    const clueScrollCount = Object.entries(idleResult.itemsConsumed || {}).reduce((sum, [itemId, qty]) => {
                      if (itemId.includes('clue')) return sum + qty
                      return sum
                    }, 0)
                    return clueScrollCount > 0 ? (
                      <div style={{ marginBottom: '12px', padding: '10px', background: '#111', borderRadius: '10px' }}>
                        <div style={{ fontSize: '11px', color: '#e8d5b0', opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: '700', marginBottom: '6px' }}>📜 Clue Scrolls</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#e8d5b0' }}>
                          <span>Completed</span>
                          <span style={{ color: '#d4af37', fontFamily: 'monospace', fontWeight: 'bold' }}>×{clueScrollCount.toLocaleString()}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#e8d5b0', opacity: 0.45 }}>
                          <span>/hr</span>
                          <span style={{ fontFamily: 'monospace' }}>{perHr(clueScrollCount)}</span>
                        </div>
                      </div>
                    ) : null
                  })()}

                  {/* Loot gained — drop table results only */}
                  {(() => {
                    const merged = {}
                    for (const src of [idleResult.lootGained, idleResult.lootBanked, idleResult.lootLost, idleResult.itemsGained]) {
                      if (!src) continue
                      for (const [itemId, qty] of Object.entries(src)) {
                        if (qty > 0) merged[itemId] = (merged[itemId] || 0) + qty
                      }
                    }
                    const entries = Object.entries(merged)
                    return entries.length > 0 ? (
                      <div style={{ marginBottom: '12px', padding: '10px', background: '#111', borderRadius: '10px' }}>
                        <div style={{ fontSize: '11px', color: '#e8d5b0', opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: '700', marginBottom: '6px' }}>🎒 Loot</div>
                        {entries.map(([itemId, qty]) => (
                          <div key={itemId} style={{ marginBottom: '4px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#e8d5b0' }}>
                              <span style={{ textTransform: 'capitalize', color: isHighValueDrop(itemId, qty, itemsData) ? '#c084fc' : '#e8d5b0', fontWeight: isHighValueDrop(itemId, qty, itemsData) ? '700' : '400' }}>{itemId.replace(/_/g, ' ')}</span>
                              <span style={{ color: '#d4af37', fontFamily: 'monospace', fontWeight: 'bold' }}>×{qty.toLocaleString()}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#e8d5b0', opacity: 0.45 }}>
                              <span>/hr</span>
                              <span style={{ fontFamily: 'monospace' }}>{perHr(qty)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null
                  })()}
                </>)
              })()}
            </div>

            {/* Footer button */}
            <div style={{ padding: '12px 16px', borderTop: '1px solid #222' }}>
              <button
                onClick={closeIdleResultModal}
                style={{ width: '100%', padding: '13px', borderRadius: '12px', background: 'linear-gradient(135deg, #b8940e, #d4af37)', color: '#0f0f0f', fontFamily: 'Cinzel, serif', fontWeight: 'bold', fontSize: '14px', border: 'none', cursor: 'pointer' }}
              >
                Continue Adventure
              </button>
            </div>
          </div>
        </div>
      )}

      {showBuyCreditsModal && isCloudAccount && (
        <BuyCreditsModal
          onClose={() => setShowBuyCreditsModal(false)}
          identityId={identityId}
          characterId={getCharacterId()}
          stripeLinks={stripeLinks}
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
    </div>
  )
}

export default function App() {
  return (
    <GameProvider>
      <PvpProvider>
        <GameApp />
      </PvpProvider>
    </GameProvider>
  )
}
