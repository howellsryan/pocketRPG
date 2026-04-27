import { useState, useEffect, useRef } from 'preact/hooks'
import { GameProvider, useGame } from './state/gameState.jsx'
import { PvpProvider, usePvp } from './state/pvpState.jsx'
import BottomNav from './components/BottomNav.jsx'
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
import GeneralStoreScreen from './screens/GeneralStoreScreen.jsx'
import EquipmentScreen from './screens/EquipmentScreen.jsx'
import QuestsScreen from './screens/QuestsScreen.jsx'
import LeaderboardScreen from './screens/LeaderboardScreen.jsx'
import AuthScreen from './screens/AuthScreen.jsx'
import { SCREENS } from './utils/constants.js'
import { hasSave, closeDB } from './db/database.js'
import { initNewGame, saveSetting, getSetting, getAllStats, getInventory, getEquipment, getBank } from './db/stores.js'
import { startTicks, stopTicks, onTick, pauseTicks } from './engine/tick.js'
import { snapshotToLocalStorage, restoreFromLocalStorage, wipeLocalSave } from './db/saveload.js'
import { api, captureTokenFromHash, getToken, getCharacterId, getCharacterName, setCharacter, clearAuth, getLocalCharacterId, setLocalCharacterId, getIronmanMode, getOneLifeMode } from './cloud/api.js'
import { schedulePushSave, pushNow, pullSave, applyCloudSave, checkCloudNewer, resetSyncState } from './cloud/sync.js'
import { fetchIdleState, heartbeatIdleState, beaconIdleState, resetIdleStateSync } from './cloud/idleState.js'
import { formatIdleTime, simulateIdleSkilling, simulateIdleGather, simulateIdleCombat, simulateIdleAgility, simulateIdleHPRegen } from './engine/idleEngine.js'
import { simulateIdleThieving } from './engine/thieving.js'
import { simulateIdleHunting } from './engine/hunter.js'
import { simulateIdleQuest, createQuestState } from './engine/quests.js'
import { getLevelFromXP } from './engine/experience.js'
import { pvpApi } from './cloud/pvp.js'

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

function GameApp() {
  const { loaded, loadGame, player, stats, equipment, inventory, bank, currentHP, updateHP, getMaxHP, updateInventory, updateBank, updateBankDirect, grantXP, addToast, activeTask, setActiveTask, itemsData, getSnapshot, unlockedFeatures, setSlayerTask, slayerPoints, updateSlayerPoints, completeQuest, questQueue, removeFromQuestQueue, updateQuestQueue } = useGame()
  const pvp = usePvp()
  const [screen, setScreen] = useState(SCREENS.HOME)
  const [gameReady, setGameReady] = useState(false)
  const [activity, setActivity] = useState(null)
  const [idleResult, setIdleResult] = useState(null) // { elapsedMs, task, xpGained, itemsGained, lootLost, monstersKilled }
  const [actionData, setActionData] = useState(null) // { monsterId, gatherTaskId, skillId, actionId }
  const [isInCombat, setIsInCombat] = useState(false) // Track if currently in combat
  const [pendingXpChoices, setPendingXpChoices] = useState([]) // [{ rewards, questId, questName }, ...]
  // Cloud auth gate: 'pending' until we resolve, 'auth' if AuthScreen needed, 'auth_offline' for offline creation, 'ready' to boot game
  const [cloudPhase, setCloudPhase] = useState('pending')
  const [conflict, setConflict] = useState(null) // { cloudPayload, cloudHash, cloudUpdatedAt, localUpdatedAt }
  const [offlineIsIronman, setOfflineIsIronman] = useState(false)
  const [offlineIsOneLife, setOfflineIsOneLife] = useState(false)
  const [offlineCreating, setOfflineCreating] = useState(false)
  const [removeAds, setRemoveAds] = useState(false)
  const [identityId, setIdentityId] = useState(null)
  const [stripeLinks, setStripeLinks] = useState({})
  const [credits, setCredits] = useState(0)
  const [showBuyCreditsModal, setShowBuyCreditsModal] = useState(false)
  // Set on mount if Stripe redirected back with a payment query/path — drives the
  // post-checkout thank-you toast + credits refresh once the game is ready.
  const paymentReturnRef = useRef(false)
  const pvpReconnectBusyRef = useRef(false)
  const isInPvpMatch = pvp.phase === 'in_match'

  // Refs for tick-based systems
  const hpRegenCounter = useRef(0)
  const snapshotCounter = useRef(99) // Start at 99 so first snapshot fires after 1 tick
  const idleHeartbeatCounter = useRef(49) // 50 ticks = ~30s — first heartbeat ~600ms after load
  const hiddenAtPerfRef = useRef(null) // performance.now() at hide — monotonic, immune to clock changes

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
    let cancelled = false
    const reconnectActiveMatch = async () => {
      if (cancelled || pvp.phase === 'in_match' || pvpReconnectBusyRef.current) return
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
  }, [pvp.phase, pvp.enterMatch])

  // Split xpReward into immediate grants and player-choice rewards (combat / any)
  function splitXpRewards(xpReward) {
    const fixed = {}
    const choices = []
    for (const [skill, xp] of Object.entries(xpReward || {})) {
      if (skill === 'combat' || skill === 'any') choices.push({ type: skill, amount: xp })
      else if (xp > 0) fixed[skill] = xp
    }
    return { fixed, choices }
  }

  // Handle quest completion with queue cascading
  function handleQuestCompletion(quest, xpReward, coinReward) {
    // Award rewards
    const { fixed, choices } = splitXpRewards(xpReward)
    for (const [skill, xp] of Object.entries(fixed)) grantXP(skill, xp)
    if (coinReward > 0) updateBankDirect({ coins: coinReward })

    // The completed quest was already removed from the queue when it was
    // started, so the queue holds the next quests to run. Pop the next one
    // off and promote it to the active task.
    const currentQueue = questQueueRef.current || []
    if (currentQueue.length > 0) {
      const nextQuest = currentQueue[0]
      updateQuestQueue(currentQueue.slice(1))
      const state = createQuestState(nextQuest)
      setActiveTask({
        type: 'quest',
        quest: nextQuest,
        totalTicks: state.totalTicks,
        ticksRemaining: state.ticksRemaining,
        startedAt: state.startedAt,
      })
      addToast(`📜 Started: ${nextQuest.name}`, 'info')
    } else {
      setActiveTask(null)
    }

    // Finalise the completed quest (show choice modal if needed)
    finaliseQuest(quest.id, quest.name, choices)
  }

  // Finalise a completed quest: show choice modal if needed, else complete immediately
  function finaliseQuest(questId, questName, choices) {
    if (choices.length > 0) {
      setPendingXpChoices(prev => [...prev, { rewards: choices, questId, questName }])
    } else {
      completeQuest(questId)
      addToast(`📜 Quest complete: ${questName}`, 'levelup', '🏆')
    }
  }

  function handleXpChoiceComplete(chosen) {
    for (const { skill, xp } of chosen) grantXP(skill, xp)
    setPendingXpChoices(prev => {
      const head = prev[0]
      if (head) {
        completeQuest(head.questId)
        addToast(`📜 Quest complete: ${head.questName}`, 'levelup', '🏆')
      }
      return prev.slice(1)
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
    if (gameReady) {
      // Immediately stamp lastTick so idle engine has a baseline if user closes tab
      const bootNow = Date.now()
      localStorage.setItem('pocketrpg_lastTick', String(bootNow))
      updateMaxObservedAt(bootNow)
      // Do an immediate snapshot so localStorage backup exists from the start
      const snap = getSnapshot()
      if (snap.player) {
        snapshotToLocalStorage(snap.player, snap.stats, snap.inventory, snap.bank, snap.equipment, snap.bankConfig, snap.homeShortcuts, snap.bossKillCounts, snap.completedQuests, snap.questQueue)
      }
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
          let elapsedMs
          if (hiddenAtPerfRef.current !== null && perfNow >= hiddenAtPerfRef.current) {
            // Same session: use monotonic clock — immune to system time changes
            elapsedMs = Math.floor(perfNow - hiddenAtPerfRef.current)
          } else if (cloudServerNow && cloudLastActiveAt) {
            // New session + cloud: both endpoints are server-stamped so this
            // elapsed is immune to the user changing their device clock.
            elapsedMs = Math.min(Math.max(0, cloudServerNow - cloudLastActiveAt), 24 * 60 * 60 * 1000)
          } else if (cloudLastActiveAt) {
            // Cloud knows lastActiveAt but didn't return serverNow (older
            // deployment). We still prefer the server-stamped anchor, but the
            // endpoint (Date.now()) is client-controlled — cross-check against
            // the clock-rollback watermark before trusting it.
            elapsedMs = Math.min(Math.max(0, Date.now() - cloudLastActiveAt), 24 * 60 * 60 * 1000)
            elapsedMs = clampByClockWatermark(elapsedMs)
          } else {
            // No cloud state — wall-clock only. Clamp against our max-observed
            // watermark so a player who rolls the device clock backwards can't
            // resurrect old progress, then cap at 24h.
            elapsedMs = Math.min(Math.max(0, Date.now() - hiddenAt), 24 * 60 * 60 * 1000)
            elapsedMs = clampByClockWatermark(elapsedMs)
          }
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
              updateBankDirect({ [savedTask.gatherTask.product]: savedTask.gatherTask.qty || 1 })
              setActiveTask(null)
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
              updateBankDirect({ [savedTask.minigameTask.product]: savedTask.minigameTask.qty || 1 })
              setActiveTask(null)
              sim = { minigameCompleted: true }
            } else {
              setActiveTask({ ...savedTask, totalTicks, ticksRemaining: newRemaining })
              sim = { minigameTimeReduced: true, hoursRemaining: Math.ceil(newRemaining / 6000) }
            }
          } else if (savedTask.type === 'skill')   sim = simulateIdleSkilling(savedTask, elapsedMs, freshBank, freshEq, freshStats, itemsDataRef.current, freshInv)
          else if (savedTask.type === 'gather')  sim = simulateIdleGather(savedTask, elapsedMs, freshInv, freshStats, itemsDataRef.current, freshBank)
          else if (savedTask.type === 'combat')  sim = simulateIdleCombat(savedTask, elapsedMs, freshStats, freshEq, freshInv, itemsDataRef.current, freshSlayerTask, freshBank)
          else if (savedTask.type === 'agility') sim = simulateIdleAgility(savedTask, elapsedMs)
          else if (savedTask.type === 'thieving') sim = simulateIdleThieving(savedTask, elapsedMs)
          else if (savedTask.type === 'hunter') sim = simulateIdleHunting(savedTask, elapsedMs)
          else if (savedTask.type === 'quest') sim = simulateIdleQuest(savedTask, elapsedMs)

          // Always show the modal — even if sim is null (e.g. <1 action completed)
          if (!sim) {
            if (savedTask.type === 'skill' && (savedTask.action?.type === 'alchemy' || savedTask.action?.materials || savedTask.action?.runeReq)) {
              setActiveTask(null)
            }
            setIdleResult({ elapsedMs, task: savedTask })
            return
          }

          // Apply HP regeneration during idle
          const hpRegenSim = simulateIdleHPRegen(elapsedMs)
          if (hpRegenSim.hpRegen > 0) {
            const maxHP = getLevelFromXP(freshStats.hitpoints?.xp || 0)
            const restoredHP = Math.min(currentHP + hpRegenSim.hpRegen, maxHP)
            sim.hpRestored = hpRegenSim.hpRegen
            sim.hpAfterRegen = restoredHP
          }

          // Apply XP (skip combat/any — those require player choice via modal)
          if (sim.xpGained) {
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
          // Quest finalisation — cascade through queue if quests complete
          if (savedTask.type === 'quest') {
            if (sim.coinsGained > 0) updateBankDirect({ coins: sim.coinsGained })

            // Track all completed quests for idle result display
            const completedQuests = []
            const aggregatedXp = {}
            let totalCoinsGained = sim.coinsGained || 0
            let workingQueue = [...(questQueueRef.current || [])]
            let remainingElapsedMs = elapsedMs - (sim.ticksUsed * 600)
            let finalTask = null

            if (sim.completed) {
              // Original quest completed — track rewards
              completedQuests.push(savedTask.quest)
              for (const [skill, xp] of Object.entries(savedTask.quest.xpReward || {})) {
                aggregatedXp[skill] = (aggregatedXp[skill] || 0) + xp
              }
              const { choices } = splitXpRewards(savedTask.quest.xpReward)
              finaliseQuest(savedTask.quest.id, savedTask.quest.name, choices)

              // Cascade through queue while time remains
              while (workingQueue.length > 0 && remainingElapsedMs > 0) {
                const nextQuest = workingQueue[0]
                const nextTotalTicks = Math.ceil(nextQuest.durationSeconds * 1000 / 600)
                const nextTask = {
                  type: 'quest',
                  quest: nextQuest,
                  totalTicks: nextTotalTicks,
                  ticksRemaining: nextTotalTicks,
                }
                const nextSim = simulateIdleQuest(nextTask, remainingElapsedMs)
                if (!nextSim) break
                remainingElapsedMs -= nextSim.ticksUsed * 600

                if (nextSim.completed) {
                  if (nextSim.coinsGained > 0) {
                    updateBankDirect({ coins: nextSim.coinsGained })
                    totalCoinsGained += nextSim.coinsGained
                  }
                  completedQuests.push(nextQuest)
                  for (const [skill, xp] of Object.entries(nextQuest.xpReward || {})) {
                    aggregatedXp[skill] = (aggregatedXp[skill] || 0) + xp
                  }
                  // Grant fixed XP immediately; choice rewards queued via finaliseQuest
                  const { fixed: nextFixed, choices: nextChoices } = splitXpRewards(nextQuest.xpReward)
                  for (const [skill, xp] of Object.entries(nextFixed)) grantXP(skill, xp)
                  finaliseQuest(nextQuest.id, nextQuest.name, nextChoices)
                  workingQueue = workingQueue.slice(1)
                } else {
                  // Partial progress — this quest becomes the active one
                  finalTask = {
                    type: 'quest',
                    quest: nextQuest,
                    totalTicks: nextTotalTicks,
                    ticksRemaining: nextSim.ticksRemaining,
                    startedAt: Date.now(),
                  }
                  workingQueue = workingQueue.slice(1)
                  break
                }
              }

              // No partial quest mid-cascade, but queue still has items: promote head to active
              if (!finalTask && workingQueue.length > 0) {
                const nextQuest = workingQueue[0]
                const nextTotalTicks = Math.ceil(nextQuest.durationSeconds * 1000 / 600)
                finalTask = {
                  type: 'quest',
                  quest: nextQuest,
                  totalTicks: nextTotalTicks,
                  ticksRemaining: nextTotalTicks,
                  startedAt: Date.now(),
                }
                workingQueue = workingQueue.slice(1)
              }
            } else {
              // Original quest still running — persist updated progress
              finalTask = {
                ...savedTask,
                ticksRemaining: sim.ticksRemaining,
              }
            }

            setActiveTask(finalTask)
            updateQuestQueue(workingQueue)

            if (completedQuests.length > 0) {
              sim.completedQuests = completedQuests
              sim.aggregatedXpReward = aggregatedXp
              if (totalCoinsGained > 0) sim.coinsGained = totalCoinsGained
            }
          }
          // Deduct consumed materials from bank
          if (sim.itemsConsumed && Object.keys(sim.itemsConsumed).length > 0) {
            const negated = {}
            for (const [itemId, qty] of Object.entries(sim.itemsConsumed)) {
              negated[itemId] = -qty
            }
            updateBankDirect(negated)
          }
          // Deduct runes consumed from bank (inventory portion already reflected in finalInventory)
          if (sim.runesConsumed && Object.keys(sim.runesConsumed).length > 0) {
            const negated = {}
            for (const [itemId, qty] of Object.entries(sim.runesConsumed)) {
              negated[itemId] = -qty
            }
            updateBankDirect(negated)
          }
          // Persist slayer task update if present
          if (savedTask.type === 'combat' && sim.slayerTaskUpdate) {
            if (sim.slayerTaskUpdate.completed) {
              setSlayerTask(null)
              updateSlayerPoints(slayerPoints + sim.slayerTaskUpdate.pointsOnComplete)
              addToast('💀 Slayer task completed!', 'levelup')
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
        const snap = getSnapshot()
        snapshotToLocalStorage(snap.player, snap.stats, snap.inventory, snap.bank, snap.equipment, snap.bankConfig, snap.homeShortcuts, snap.bossKillCounts, snap.completedQuests, snap.questQueue)
        // Cloud sync piggy-backs on the local snapshot cadence (debounced, hash-skipped).
        if (!isInPvpMatch) schedulePushSave(snap)
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
          const product = task.gatherTask.product
          const qty = task.gatherTask.qty || 1
          updateBankDirect({ [product]: qty })
          addToast(`${task.gatherTask.icon || '🎮'} ${task.gatherTask.name} complete!`, 'levelup', '🏆')
          setActiveTask(null)
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
          updateBankDirect({ [mgTask.product]: mgTask.qty || 1 })
          addToast(`${mgTask.icon || '🎮'} ${mgTask.name} complete!`, 'levelup', '🏆')
          setActiveTask(null)
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

      const offlineMode = localStorage.getItem('pocketrpg_offline_mode') === '1'
      const hasToken = !!getToken()
      const hasCharacter = !!getCharacterId()

      if (!hasToken && !offlineMode) {
        setCloudPhase('auth')
        return
      }
      if (hasToken && !hasCharacter) {
        setCloudPhase('auth')
        return
      }

      if (hasToken && hasCharacter) {
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
        // Pull cloud save and decide on conflict before touching local IDB
        try {
          const result = await pullSave()
          if (result && result.payload) {
            const localExists = await hasSave()
            const localTs = parseInt(localStorage.getItem('pocketrpg_lastTick'), 10) || 0
            if (!localExists) {
              // Fresh device — apply cloud save straight away
              await applyCloudSave(result.payload, result.updatedAt)
            } else if (result.updatedAt > localTs + 60_000) {
              // Cloud is meaningfully newer — ask the user
              setConflict({
                cloudPayload: result.payload,
                cloudUpdatedAt: result.updatedAt,
                localUpdatedAt: localTs,
              })
              return
            }
            // else: local is newer or effectively equal — keep local, next push will overwrite cloud
          }
        } catch (err) {
          console.warn('[PocketRPG] Cloud pull failed, continuing with local save:', err.message)
        }
      }

      setCloudPhase('ready')
      await checkSave()
    } catch (err) {
      console.warn('[PocketRPG] Cloud init failed, falling back to local:', err)
      setCloudPhase('ready')
      await checkSave()
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
        // No IDB save — check localStorage backup before giving up
        await attemptBackupRestore()
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
      await attemptBackupRestore()
    }
  }

  async function attemptBackupRestore() {
    try {
      const restored = await restoreFromLocalStorage()
      if (restored) {
        // Backup restored to IDB — now load normally (idle engine will run from lastTick)
        console.log('[PocketRPG] Backup restore succeeded, loading...')
        const idleResult = await loadGame()
        setGameReady(true)
        if (idleResult) {
          setIdleResult(idleResult)
          if (idleResult.pendingChoices?.length > 0) {
            setPendingXpChoices(prev => [...prev, ...idleResult.pendingChoices])
          }
        }
        addToast('💾 Save restored from backup!', 'info')
      } else {
        // No backup either — start a new game silently. Cloud users reuse
        // their AuthScreen username as the in-game player name; offline
        // users default to 'Adventurer'.
        await startNewGame()
      }
    } catch (err2) {
      console.error('[PocketRPG] Backup restore failed:', err2)
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

  async function handleOfflineCharacterCreate(e) {
    e.preventDefault()
    setOfflineCreating(true)
    try {
      await startNewGame(offlineIsIronman, 'Adventurer', offlineIsOneLife)
      // Transition from auth_offline to ready now that game is initialized
      setCloudPhase('ready')
    } catch (err) {
      console.error('Failed to create offline character:', err)
      addToast(`Failed to create character: ${err.message}`, 'error')
      setOfflineCreating(false)
    }
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
    setGameReady(false)
    setCloudPhase('auth')
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

  // Skip 1 hour handler — validate with server first, then simulate idle time
  async function handleSkip1h() {
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
      return
    }

    try {
      // Call server to validate credit and deduct atomically
      const result = await api.skipHour()
      if (!result.ok) {
        addToast('Server error processing skip!', 'error')
        return
      }

      // Server confirmed and deducted 1 credit — update local credits state
      setCredits(result.credits_remaining)

      const elapsedMs = 3600000 // 1 hour in milliseconds
      let idleResultData = { elapsedMs, task: activeTaskRef.current }

      // Re-read latest stats/equipment/inventory/bank to avoid stale state
      const [freshStats, freshInv, freshEq, freshBank, freshSlayerTask] = await Promise.all([
        getAllStats(),
        getInventory(),
        getEquipment(),
        getBank(),
        getSetting('slayerTask'),
      ])

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
            // Minigame completed — award item and clear task
            updateBankDirect({ [savedTask.gatherTask.product]: savedTask.gatherTask.qty || 1 })
            setActiveTask(null)
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
            updateBankDirect({ [savedTask.minigameTask.product]: savedTask.minigameTask.qty || 1 })
            setActiveTask(null)
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
          if (savedTask.type === 'combat')  sim = simulateIdleCombat(savedTask, elapsedMs, freshStats, freshEq, freshInv, itemsDataRef.current, freshSlayerTask, freshBank)
          if (savedTask.type === 'agility') sim = simulateIdleAgility(savedTask, elapsedMs)
          if (savedTask.type === 'thieving') sim = simulateIdleThieving(savedTask, elapsedMs)
          if (savedTask.type === 'hunter') sim = simulateIdleHunting(savedTask, elapsedMs)
          if (savedTask.type === 'quest') sim = simulateIdleQuest(savedTask, elapsedMs)
        }

        if (!sim) {
          if (savedTask.type === 'skill' && (savedTask.action?.type === 'alchemy' || savedTask.action?.materials || savedTask.action?.runeReq)) {
            setActiveTask(null)
          }
        } else {
          // Apply HP regeneration during idle
          const hpRegenSim = simulateIdleHPRegen(elapsedMs)
          if (hpRegenSim.hpRegen > 0) {
            const maxHP = getLevelFromXP(freshStats.hitpoints?.xp || 0)
            const restoredHP = Math.min(currentHP + hpRegenSim.hpRegen, maxHP)
            sim.hpRestored = hpRegenSim.hpRegen
            sim.hpAfterRegen = restoredHP
          }

          // Apply XP (skip combat/any — those require player choice via modal)
          if (sim.xpGained) {
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
          // Quest cascade — complete quests while time remains
          if (savedTask.type === 'quest') {
            if (sim.coinsGained > 0) updateBankDirect({ coins: sim.coinsGained })

            const completedQuests = []
            const aggregatedXp = {}
            let totalCoinsGained = sim.coinsGained || 0
            let workingQueue = [...(questQueueRef.current || [])]
            let remainingElapsedMs = elapsedMs - (sim.ticksUsed * 600)
            let finalTask = null

            if (sim.completed) {
              // Original quest completed — track for modal
              completedQuests.push(savedTask.quest)
              for (const [skill, xp] of Object.entries(savedTask.quest.xpReward || {})) {
                aggregatedXp[skill] = (aggregatedXp[skill] || 0) + xp
              }
              const { choices } = splitXpRewards(savedTask.quest.xpReward)
              finaliseQuest(savedTask.quest.id, savedTask.quest.name, choices)

              // Cascade through queue while time remains
              while (workingQueue.length > 0 && remainingElapsedMs > 0) {
                const nextQuest = workingQueue[0]
                const nextTotalTicks = Math.ceil(nextQuest.durationSeconds * 1000 / 600)
                const nextTask = {
                  type: 'quest',
                  quest: nextQuest,
                  totalTicks: nextTotalTicks,
                  ticksRemaining: nextTotalTicks,
                }
                const nextSim = simulateIdleQuest(nextTask, remainingElapsedMs)
                if (!nextSim) break
                remainingElapsedMs -= nextSim.ticksUsed * 600

                if (nextSim.completed) {
                  if (nextSim.coinsGained > 0) {
                    updateBankDirect({ coins: nextSim.coinsGained })
                    totalCoinsGained += nextSim.coinsGained
                  }
                  completedQuests.push(nextQuest)
                  for (const [skill, xp] of Object.entries(nextQuest.xpReward || {})) {
                    aggregatedXp[skill] = (aggregatedXp[skill] || 0) + xp
                  }
                  const { fixed: nextFixed, choices: nextChoices } = splitXpRewards(nextQuest.xpReward)
                  for (const [skill, xp] of Object.entries(nextFixed)) grantXP(skill, xp)
                  finaliseQuest(nextQuest.id, nextQuest.name, nextChoices)
                  workingQueue = workingQueue.slice(1)
                } else {
                  // Partial progress — this quest becomes the active one
                  finalTask = {
                    type: 'quest',
                    quest: nextQuest,
                    totalTicks: nextTotalTicks,
                    ticksRemaining: nextSim.ticksRemaining,
                    startedAt: Date.now(),
                  }
                  workingQueue = workingQueue.slice(1)
                  break
                }
              }

              // No partial quest mid-cascade, but queue still has items: promote head to active
              if (!finalTask && workingQueue.length > 0) {
                const nextQuest = workingQueue[0]
                const nextTotalTicks = Math.ceil(nextQuest.durationSeconds * 1000 / 600)
                finalTask = {
                  type: 'quest',
                  quest: nextQuest,
                  totalTicks: nextTotalTicks,
                  ticksRemaining: nextTotalTicks,
                  startedAt: Date.now(),
                }
                workingQueue = workingQueue.slice(1)
              }
            } else {
              // Original quest still running — persist updated progress
              finalTask = {
                ...savedTask,
                ticksRemaining: sim.ticksRemaining,
              }
            }

            setActiveTask(finalTask)
            updateQuestQueue(workingQueue)

            // Add quest data to idle result
            if (completedQuests.length > 0) {
              idleResultData.completedQuests = completedQuests
              idleResultData.aggregatedXpReward = aggregatedXp
              if (totalCoinsGained > 0) idleResultData.coinsGained = totalCoinsGained
            }
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
          // Deduct runes consumed from bank
          if (sim.runesConsumed && Object.keys(sim.runesConsumed).length > 0) {
            const negated = {}
            for (const [itemId, qty] of Object.entries(sim.runesConsumed)) {
              negated[itemId] = -qty
            }
            updateBankDirect(negated)
          }
          // Persist slayer task update if present
          if (savedTask.type === 'combat' && sim.slayerTaskUpdate) {
            if (sim.slayerTaskUpdate.completed) {
              setSlayerTask(null)
              updateSlayerPoints(slayerPoints + sim.slayerTaskUpdate.pointsOnComplete)
              addToast('💀 Slayer task completed!', 'levelup')
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

      // Show idle result modal with skip summary
      setIdleResult(idleResultData)

      // Save the updated game state to cloud
      if (!isInPvpMatch) schedulePushSave(getSnapshot())
    } catch (err) {
      console.error('[PocketRPG] Skip 1h error:', err)
      addToast(err.message || 'Error during skip!', 'error')
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

  // Offline character creation
  if (cloudPhase === 'auth_offline') {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', background: '#0f0f0f' }}>
        <div style={{ width: '100%', maxWidth: '380px' }}>
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <h1 style={{ fontFamily: 'Cinzel, serif', fontSize: '28px', fontWeight: '900', color: '#d4af37', letterSpacing: '0.05em' }}>PocketRPG</h1>
            <p style={{ fontSize: '11px', color: '#e8d5b0', opacity: 0.35, marginTop: '4px', fontFamily: 'Nunito, sans-serif' }}>Offline Mode</p>
          </div>

          <form onSubmit={handleOfflineCharacterCreate}>
            <div style={{ fontSize: '11px', color: '#e8d5b0', opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: '700', marginBottom: '8px' }}>Character</div>
            <input
              type="text"
              value="Adventurer"
              disabled
              style={{ width: '100%', padding: '12px 16px', borderRadius: '12px', background: '#0f0f0f', border: '1px solid #2a2a2a', color: '#e8d5b0', fontSize: '14px', fontFamily: 'Nunito, sans-serif', boxSizing: 'border-box', outline: 'none', marginBottom: '6px', opacity: 0.6, cursor: 'not-allowed' }}
            />
            <p style={{ fontSize: '10px', color: '#e8d5b0', opacity: 0.45, margin: '6px 0 14px' }}>
              Offline characters use the name "Adventurer"
            </p>

            {/* Ironman Mode Toggle */}
            <div style={{ marginBottom: '14px', padding: '12px', borderRadius: '12px', background: '#1a1a1a', border: '1px solid #333' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', margin: 0 }}>
                <input
                  type="checkbox"
                  checked={offlineIsIronman}
                  onChange={(e) => setOfflineIsIronman(e.target.checked)}
                  style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                />
                <div>
                  <div style={{ fontSize: '13px', color: '#d4af37', fontWeight: 'bold' }}>⚔️ Ironman Mode</div>
                  <div style={{ fontSize: '10px', color: '#e8d5b0', opacity: 0.6, marginTop: '2px' }}>
                    Limited shop access. Can only buy general and quest items.
                  </div>
                </div>
              </label>
            </div>

            {/* One Life Mode Toggle */}
            <div style={{ marginBottom: '14px', padding: '12px', borderRadius: '12px', background: '#1a1a1a', border: '1px solid #333' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', margin: 0 }}>
                <input
                  type="checkbox"
                  checked={offlineIsOneLife}
                  onChange={(e) => setOfflineIsOneLife(e.target.checked)}
                  style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                />
                <div>
                  <div style={{ fontSize: '13px', color: '#d4af37', fontWeight: 'bold' }}>☠️ One Life Mode</div>
                  <div style={{ fontSize: '10px', color: '#e8d5b0', opacity: 0.6, marginTop: '2px' }}>
                    Die once and your account is permanently deleted. Works with or without Ironman.
                  </div>
                </div>
              </label>
            </div>

            <button type="submit" disabled={offlineCreating} style={{ width: '100%', padding: '14px', borderRadius: '12px', background: 'linear-gradient(135deg, #b8940e, #d4af37)', color: '#0f0f0f', fontFamily: 'Cinzel, serif', fontWeight: 'bold', fontSize: '14px', letterSpacing: '0.05em', border: 'none', cursor: offlineCreating ? 'not-allowed' : 'pointer', opacity: offlineCreating ? 0.6 : 1, marginBottom: '10px' }}>
              {offlineCreating ? 'Creating…' : 'Start Adventure'}
            </button>
            <button type="button" onClick={() => setCloudPhase('auth')} disabled={offlineCreating} style={{ width: '100%', padding: '12px', borderRadius: '12px', background: 'transparent', border: '1px solid #2a2a2a', color: '#e8d5b0', opacity: 0.7, fontSize: '13px', cursor: offlineCreating ? 'not-allowed' : 'pointer' }}>
              Back to Login
            </button>
          </form>
        </div>
      </div>
    )
  }

  // Auth gate — shown before we touch local save
  if (cloudPhase === 'auth') {
    return (
      <AuthScreen
        onCloudReady={async () => {
          // After character selection, re-run the full cloud+local boot
          setCloudPhase('pending')
          await initCloudAndSave()
        }}
        onPlayOffline={() => {
          localStorage.setItem('pocketrpg_offline_mode', '1')
          setCloudPhase('auth_offline')
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
      case SCREENS.HOME:      return <HomeScreen onNavigate={navigate} onLogout={handleLogoutToCharacterSelect} isCloudAccount={!!getToken() && !!getCharacterId()} removeAds={removeAds} identityId={identityId} characterId={getCharacterId()} stripeLinks={stripeLinks} />
      case SCREENS.STATS:     return <StatsScreen />
      case SCREENS.INVENTORY: return <InventoryScreen />
      case SCREENS.EQUIPMENT: return <EquipmentScreen />
      case SCREENS.BANK:      return <BankScreen />
      case SCREENS.COMBAT:    return <CombatScreen onNavigate={navigate} initialMonsterId={actionData?.monsterId} initialRaidId={actionData?.raidId} onCombatStatusChange={setIsInCombat} />
      case SCREENS.SKILLS:    return <SkillingScreen initialSkillId={actionData?.skillId} initialActionId={actionData?.actionId} idleResult={idleResult} />
      case SCREENS.GATHER:    return <GatherScreen initialTaskId={actionData?.gatherTaskId} idleResult={idleResult} />
      case SCREENS.AGILITY:     return <AgilityScreen initialActionId={actionData?.actionId} />
      case SCREENS.STORE:       return <GeneralStoreScreen />
      case SCREENS.QUESTS:      return <QuestsScreen />
      case SCREENS.LEADERBOARD: return <LeaderboardScreen />
      default:                  return <HomeScreen onNavigate={navigate} onLogout={handleLogoutToCharacterSelect} isCloudAccount={!!getToken() && !!getCharacterId()} />
    }
  }

  const isCloudAccount = !!getToken() && !!getCharacterId()

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Header activity={activity} credits={credits} isCloudAccount={isCloudAccount} onSkip1h={isCloudAccount ? handleSkip1h : null} onBuyCredits={() => setShowBuyCreditsModal(true)} />
      <ToastContainer />
      <main style={{ flex: 1, overflow: 'hidden' }}>
        {renderScreen()}
      </main>
      <BottomNav
        active={screen}
        onNavigate={(s) => navigate(s)}
        isInCombat={isInCombat}
        onDisabledClick={() => addToast('⚔️ Cannot navigate during combat!', 'warning')}
      />

      {/* Idle Result Modal */}
      {idleResult && pvp.phase !== 'in_match' && (
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
                  agility: '🏃', thieving: '🗝️', slayer: '💀', firemaking: '🔥', construction: '🏠'
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
                    <div style={{ marginBottom: '12px', padding: '10px', background: '#1a3a2a', borderRadius: '10px', borderLeft: '3px solid #4ade80' }}>
                      <div style={{ fontSize: '12px', color: '#4ade80', fontWeight: 'bold', marginBottom: '6px' }}>🎮 Minigame Progress</div>
                      <div style={{ fontSize: '12px', color: '#e8d5b0', marginBottom: '4px' }}>{idleResult.task?.gatherTask?.name || idleResult.task?.minigameTask?.name}</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#e8d5b0' }}>
                        <span>Time Remaining</span>
                        <span style={{ color: '#d4af37', fontFamily: 'monospace', fontWeight: 'bold' }}>{idleResult.hoursRemaining}h</span>
                      </div>
                    </div>
                  )}

                  {/* Minigame Completed */}
                  {idleResult.minigameCompleted && (
                    <div style={{ marginBottom: '12px', padding: '10px', background: '#1a3a2a', borderRadius: '10px', borderLeft: '3px solid #4ade80' }}>
                      <div style={{ fontSize: '12px', color: '#4ade80', fontWeight: 'bold', marginBottom: '6px' }}>✅ Minigame Complete!</div>
                      <div style={{ fontSize: '12px', color: '#e8d5b0' }}>{idleResult.task?.gatherTask?.name || idleResult.task?.minigameTask?.name}</div>
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
                              <span style={{ textTransform: 'capitalize' }}>{itemId.replace(/_/g, ' ')}</span>
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
                onClick={() => setIdleResult(null)}
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
