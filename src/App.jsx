import { useState, useEffect, useRef } from 'preact/hooks'
import { GameProvider, useGame } from './state/gameState.jsx'
import BottomNav from './components/BottomNav.jsx'
import Header from './components/Header.jsx'
import ToastContainer from './components/Toast.jsx'
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
import AuthScreen from './screens/AuthScreen.jsx'
import { SCREENS } from './utils/constants.js'
import { hasSave, closeDB } from './db/database.js'
import { initNewGame, saveSetting, getSetting, getAllStats, getInventory, getEquipment, getBank } from './db/stores.js'
import { startTicks, stopTicks, onTick } from './engine/tick.js'
import { snapshotToLocalStorage, restoreFromLocalStorage, wipeLocalSave } from './db/saveload.js'
import { captureTokenFromHash, getToken, getCharacterId, getCharacterName, setCharacter, clearAuth, getLocalCharacterId, setLocalCharacterId } from './cloud/api.js'
import { schedulePushSave, pushNow, pullSave, applyCloudSave, checkCloudNewer, resetSyncState } from './cloud/sync.js'
import { formatIdleTime, simulateIdleSkilling, simulateIdleGather, simulateIdleCombat, simulateIdleAgility, simulateIdleHPRegen } from './engine/idleEngine.js'
import { simulateIdleThieving } from './engine/thieving.js'
import { getLevelFromXP } from './engine/experience.js'

function GameApp() {
  const { loaded, loadGame, player, stats, equipment, inventory, bank, currentHP, updateHP, getMaxHP, updateInventory, updateBank, updateBankDirect, grantXP, addToast, activeTask, setActiveTask, itemsData, getSnapshot, unlockedFeatures, setSlayerTask, slayerPoints, updateSlayerPoints } = useGame()
  const [screen, setScreen] = useState(SCREENS.HOME)
  const [gameReady, setGameReady] = useState(false)
  const [activity, setActivity] = useState(null)
  const [idleResult, setIdleResult] = useState(null) // { elapsedMs, task, xpGained, itemsGained, lootLost, monstersKilled }
  const [actionData, setActionData] = useState(null) // { monsterId, gatherTaskId, skillId, actionId }
  const [isInBossFight, setIsInBossFight] = useState(false) // Track if currently in a boss fight
  // Cloud auth gate: 'pending' until we resolve, 'auth' if AuthScreen needed, 'ready' to boot game
  const [cloudPhase, setCloudPhase] = useState('pending')
  const [conflict, setConflict] = useState(null) // { cloudPayload, cloudBase64, cloudUpdatedAt, localUpdatedAt }

  // Refs for tick-based systems
  const hpRegenCounter = useRef(0)
  const snapshotCounter = useRef(99) // Start at 99 so first snapshot fires after 1 tick
  const hiddenAtPerfRef = useRef(null) // performance.now() at hide — monotonic, immune to clock changes

  useEffect(() => {
    initCloudAndSave()
  }, [])

  useEffect(() => {
    if (gameReady) {
      // Immediately stamp lastTick so idle engine has a baseline if user closes tab
      localStorage.setItem('pocketrpg_lastTick', String(Date.now()))
      // Do an immediate snapshot so localStorage backup exists from the start
      const snap = getSnapshot()
      if (snap.player) {
        snapshotToLocalStorage(snap.player, snap.stats, snap.inventory, snap.bank, snap.equipment)
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
  useEffect(() => { statsRef.current = stats }, [stats])
  useEffect(() => { equipmentRef.current = equipment }, [equipment])
  useEffect(() => { inventoryRef.current = inventory }, [inventory])

  // visibilitychange: stamp on hide, run idle on return
  useEffect(() => {
    if (!gameReady) return

    const handleVisibility = async () => {
      if (document.hidden) {
        // Page going to background — stamp the hide time separately from tick heartbeat
        const now = Date.now()
        hiddenAtPerfRef.current = performance.now() // monotonic — not affected by clock changes
        localStorage.setItem('pocketrpg_hiddenAt', String(now))
        localStorage.setItem('pocketrpg_activeTask', JSON.stringify(activeTaskRef.current))
        // Flush any pending cloud push before the tab gets suspended.
        try { pushNow(getSnapshot()) } catch (e) { /* non-fatal */ }
      } else {
        // Page returning to foreground — prefer performance.now() diff (monotonic) over wall-clock
        // to prevent system-time manipulation from granting fake idle progress.
        try {
          const rawHiddenAt = localStorage.getItem('pocketrpg_hiddenAt')
          const savedTask = (() => { try { return JSON.parse(localStorage.getItem('pocketrpg_activeTask')) } catch { return null } })()
          if (!rawHiddenAt) return
          const hiddenAt = parseInt(rawHiddenAt, 10)
          const perfNow = performance.now()
          let elapsedMs
          if (hiddenAtPerfRef.current !== null && perfNow >= hiddenAtPerfRef.current) {
            // Same session: use monotonic clock — immune to system time changes
            elapsedMs = Math.floor(perfNow - hiddenAtPerfRef.current)
          } else {
            // New session (page reloaded while hidden): fall back to wall-clock, capped at 24h
            elapsedMs = Math.min(Date.now() - hiddenAt, 24 * 60 * 60 * 1000)
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
              await applyCloudSave(cloudNewer.payload, cloudNewer.base64, cloudNewer.updatedAt)
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
          if (savedTask.type === 'skill')   sim = simulateIdleSkilling(savedTask, elapsedMs, freshBank, freshEq, freshStats, itemsDataRef.current, freshInv)
          if (savedTask.type === 'gather')  sim = simulateIdleGather(savedTask, elapsedMs, freshInv, freshStats, itemsDataRef.current)
          if (savedTask.type === 'combat')  sim = simulateIdleCombat(savedTask, elapsedMs, freshStats, freshEq, freshInv, itemsDataRef.current, freshSlayerTask, freshBank)
          if (savedTask.type === 'agility') sim = simulateIdleAgility(savedTask, elapsedMs)
          if (savedTask.type === 'thieving') sim = simulateIdleThieving(savedTask, elapsedMs)

          // Always show the modal — even if sim is null (e.g. <1 action completed)
          if (!sim) {
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

          // Apply XP
          if (sim.xpGained) {
            for (const [skill, xp] of Object.entries(sim.xpGained)) {
              if (xp > 0) grantXP(skill, xp)
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
              await saveSetting('slayerTask', null)
              updateSlayerPoints(slayerPoints + sim.slayerTaskUpdate.pointsOnComplete)
              addToast('💀 Slayer task completed!', 'levelup')
            } else {
              await saveSetting('slayerTask', sim.slayerTaskUpdate)
            }
          }

          // Update HP from regen if applicable
          if (sim.hpAfterRegen !== undefined) {
            updateHP(sim.hpAfterRegen)
          }

          setIdleResult({ elapsedMs, task: savedTask, ...sim })
          // Push the post-idle state to the cloud (debounced + hash-skipped).
          schedulePushSave(getSnapshot())
        } catch (err) {
          console.warn('[PocketRPG] Visibility idle error:', err)
          // DB may be stale — force reconnect for next read
          closeDB()
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [gameReady, grantXP, updateInventory, updateBankDirect])

  // HP regen tick: once per minute (100 ticks at 600ms = 60s)
  useEffect(() => {
    if (!gameReady) return
    const unsub = onTick(() => {
      // Sync localStorage stamp — completes in same call stack, safe from iOS freeze
      const now = Date.now()
      localStorage.setItem('pocketrpg_lastTick', String(now))
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
        snapshotToLocalStorage(snap.player, snap.stats, snap.inventory, snap.bank, snap.equipment)
        // Cloud sync piggy-backs on the local snapshot cadence (debounced, hash-skipped).
        schedulePushSave(snap)
      }
      hpRegenCounter.current++
      if (hpRegenCounter.current >= 100) {
        hpRegenCounter.current = 0
        const maxHP = getMaxHP()
        if (currentHP < maxHP) {
          updateHP(Math.min(currentHP + 1, maxHP))
        }
      }
    })
    return unsub
  }, [gameReady, currentHP, stats])

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
              await applyCloudSave(result.payload, result.base64, result.updatedAt)
            } else if (result.updatedAt > localTs + 60_000) {
              // Cloud is meaningfully newer — ask the user
              setConflict({
                cloudPayload: result.payload,
                cloudBase64: result.base64,
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
      await applyCloudSave(conflict.cloudPayload, conflict.cloudBase64, conflict.cloudUpdatedAt)
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
        if (idleResult) setIdleResult(idleResult)
      } else {
        // No IDB save — check localStorage backup before giving up
        await attemptBackupRestore()
      }
    } catch (err) {
      // IDB connection broken (iOS Safari kills background tabs)
      console.warn('[PocketRPG] checkSave IDB error, trying backup restore...', err)
      closeDB()
      await new Promise(r => setTimeout(r, 300))
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
        if (idleResult) setIdleResult(idleResult)
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

  async function startNewGame() {
    const name = getCharacterName() || 'Adventurer'
    await initNewGame(name)
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
    try { await pushNow(getSnapshot()) } catch { /* non-fatal */ }
    setActiveTask(null)
    localStorage.removeItem('pocketrpg_activeTask')
    localStorage.removeItem('pocketrpg_hiddenAt')
    setCharacter(null)
    resetSyncState()
    setGameReady(false)
    setCloudPhase('auth')
  }

  // Navigate with optional action data
  const navigate = (scr, data) => {
    // Navigating away stops any active task and clears localStorage idle-engine
    // keys so the idle engine won't re-process a task that was stopped/cancelled.
    setActiveTask(null)
    setActionData(data || null)
    setScreen(scr)
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
    return (
      <AuthScreen
        onCloudReady={async () => {
          // After character selection, re-run the full cloud+local boot
          setCloudPhase('pending')
          await initCloudAndSave()
        }}
        onPlayOffline={() => {
          localStorage.setItem('pocketrpg_offline_mode', '1')
          setCloudPhase('ready')
          checkSave()
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
      case SCREENS.HOME:      return <HomeScreen onNavigate={navigate} onLogout={handleLogoutToCharacterSelect} />
      case SCREENS.STATS:     return <StatsScreen />
      case SCREENS.INVENTORY: return <InventoryScreen />
      case SCREENS.EQUIPMENT: return <EquipmentScreen />
      case SCREENS.BANK:      return <BankScreen />
      case SCREENS.COMBAT:    return <CombatScreen onNavigate={navigate} initialMonsterId={actionData?.monsterId} initialRaidId={actionData?.raidId} onBossFightStatusChange={setIsInBossFight} />
      case SCREENS.SKILLS:    return <SkillingScreen initialSkillId={actionData?.skillId} initialActionId={actionData?.actionId} idleResult={idleResult} />
      case SCREENS.GATHER:    return <GatherScreen initialTaskId={actionData?.gatherTaskId} idleResult={idleResult} />
      case SCREENS.AGILITY:   return <AgilityScreen initialActionId={actionData?.actionId} />
      case SCREENS.STORE:     return <GeneralStoreScreen />
      default:                return <HomeScreen onNavigate={navigate} onLogout={handleLogoutToCharacterSelect} />
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Header activity={activity} />
      <ToastContainer />
      <main style={{ flex: 1, overflow: 'hidden' }}>
        {renderScreen()}
      </main>
      <BottomNav
        active={screen}
        onNavigate={(s) => navigate(s)}
        isInBossFight={isInBossFight}
        onDisabledClick={() => addToast('⚔️ Cannot navigate during boss fight!', 'warning')}
      />

      {/* Idle Result Modal */}
      {idleResult && (
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
                   idleResult.task.type === 'thieving' ? `Pickpocketing ${idleResult.task.npc?.name}` :
                   idleResult.task.type === 'agility' ? `Training agility` : ''}
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

                  {/* Boss Combat Warning */}
                  {idleResult.task?.type === 'combat' && idleResult.task.monster?.boss && (
                    <div style={{ marginBottom: '12px', padding: '10px', background: 'rgba(220, 53, 69, 0.15)', borderRadius: '10px', borderLeft: '3px solid #dc3545' }}>
                      <div style={{ fontSize: '12px', color: '#ff6b6b', fontWeight: 'bold', marginBottom: '4px' }}>⚠️ Boss Combat</div>
                      <div style={{ fontSize: '11px', color: '#ff8787', lineHeight: '1.4' }}>
                        Bosses cannot be fought while idle. You must actively kill this boss in combat. Return to the fight to continue!
                      </div>
                    </div>
                  )}

                  {/* XP Gained Summary */}
                  {(() => {
                    const xpEntries = idleResult.xpGained ? Object.entries(idleResult.xpGained).filter(([_, xp]) => xp > 0) : []
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

    </div>
  )
}

export default function App() {
  return (
    <GameProvider>
      <GameApp />
    </GameProvider>
  )
}
