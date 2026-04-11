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
import { SCREENS } from './utils/constants.js'
import { hasSave, closeDB } from './db/database.js'
import { initNewGame, saveSetting, getSetting, getAllStats, getInventory, getEquipment, getBank } from './db/stores.js'
import { startTicks, stopTicks, onTick } from './engine/tick.js'
import { exportSave, importSave, snapshotToLocalStorage, restoreFromLocalStorage } from './db/saveload.js'
import { formatIdleTime, simulateIdleSkilling, simulateIdleGather, simulateIdleCombat, simulateIdleAgility } from './engine/idleEngine.js'
import { getLevelFromXP } from './engine/experience.js'

function GameApp() {
  const { loaded, loadGame, player, stats, equipment, inventory, bank, currentHP, updateHP, getMaxHP, updateInventory, updateBank, updateBankDirect, grantXP, addToast, activeTask, setActiveTask, itemsData, getSnapshot, unlockedFeatures, setSlayerTask } = useGame()
  const [screen, setScreen] = useState(SCREENS.HOME)
  const [gameReady, setGameReady] = useState(false)
  const [showNewGame, setShowNewGame] = useState(false)
  const [showSaveMenu, setShowSaveMenu] = useState(false)
  const [playerName, setPlayerName] = useState('')
  const [activity, setActivity] = useState(null)
  const [idleResult, setIdleResult] = useState(null) // { elapsedMs, task, xpGained, itemsGained, lootLost, monstersKilled }
  const [actionData, setActionData] = useState(null) // { monsterId, gatherTaskId, skillId, actionId }

  // Refs for tick-based systems
  const hpRegenCounter = useRef(0)
  const snapshotCounter = useRef(99) // Start at 99 so first snapshot fires after 1 tick
  const hiddenAtPerfRef = useRef(null) // performance.now() at hide — monotonic, immune to clock changes

  useEffect(() => {
    checkSave()
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
          if (savedTask.type === 'skill')   sim = simulateIdleSkilling(savedTask, elapsedMs, freshBank)
          if (savedTask.type === 'gather')  sim = simulateIdleGather(savedTask, elapsedMs)
          if (savedTask.type === 'combat')  sim = simulateIdleCombat(savedTask, elapsedMs, freshStats, freshEq, freshInv, itemsDataRef.current, freshSlayerTask)
          if (savedTask.type === 'agility') sim = simulateIdleAgility(savedTask, elapsedMs)

          // Always show the modal — even if sim is null (e.g. <1 action completed)
          if (!sim) {
            setIdleResult({ elapsedMs, task: savedTask })
            return
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
          if (savedTask.type === 'combat' && sim.finalInventory) {
            updateInventory(sim.finalInventory)
            if (sim.lootBanked && Object.keys(sim.lootBanked).length > 0) {
              updateBankDirect(sim.lootBanked)
            }
          } else if (sim.itemsGained) {
            updateBankDirect(sim.itemsGained)
          }
          // Apply agility coin reward directly to bank
          if (savedTask.type === 'agility' && sim.coinsGained > 0) {
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
          // Persist slayer task update if present
          if (savedTask.type === 'combat' && sim.slayerTaskUpdate) {
            if (sim.slayerTaskUpdate.completed) {
              await saveSetting('slayerTask', null)
              addToast('💀 Slayer task completed!', 'levelup')
            } else {
              await saveSetting('slayerTask', sim.slayerTaskUpdate)
            }
          }

          setIdleResult({ elapsedMs, task: savedTask, ...sim })
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
        // No backup either — new game
        setShowNewGame(true)
      }
    } catch (err2) {
      console.error('[PocketRPG] Backup restore failed:', err2)
      setShowNewGame(true)
    }
  }

  async function handleNewGame(e) {
    e.preventDefault()
    const name = playerName.trim() || 'Adventurer'
    await initNewGame(name)
    await loadGame()
    setShowNewGame(false)
    setGameReady(true)
  }

  async function handleExport() {
    try {
      await exportSave()
      addToast('Save exported!', 'info')
      setShowSaveMenu(false)
    } catch (err) {
      addToast('Export failed', 'error')
    }
  }

  async function handleImport(e) {
    const file = e.target?.files?.[0]
    if (!file) return
    try {
      await importSave(file)
      await loadGame()
      // Dismiss whichever UI triggered this — new game screen or save menu
      setShowNewGame(false)
      setShowSaveMenu(false)
      setGameReady(true)
      addToast('Save imported!', 'info')
    } catch (err) {
      addToast(`Import failed: ${err.message}`, 'error')
    }
  }

  // Skip 1 hour — simulate 1 hour of the current active task
  const handleSkipHour = async () => {
    const task = activeTaskRef.current
    if (!task) return
    if (task.type === 'combat' && task.monster?.boss) {
      addToast('Cannot skip time during a boss fight.', 'error')
      return
    }

    const ONE_HOUR_MS = 3_600_000
    const [freshStats, freshInv, freshEq, freshBank, freshSlayerTask] = await Promise.all([
      getAllStats(), getInventory(), getEquipment(), getBank(), getSetting('slayerTask'),
    ])

    let sim = null
    if (task.type === 'skill')   sim = simulateIdleSkilling(task, ONE_HOUR_MS, freshBank, freshEq, freshStats, itemsDataRef.current, freshInv)
    if (task.type === 'gather')  sim = simulateIdleGather(task, ONE_HOUR_MS, freshInv, freshStats, itemsDataRef.current)
    if (task.type === 'combat')  sim = simulateIdleCombat(task, ONE_HOUR_MS, freshStats, freshEq, freshInv, itemsDataRef.current, freshSlayerTask)
    if (task.type === 'agility') sim = simulateIdleAgility(task, ONE_HOUR_MS)

    if (!sim) {
      addToast('Nothing to skip — no materials or progress possible.', 'info')
      return
    }

    if (sim.xpGained) {
      for (const [skill, xp] of Object.entries(sim.xpGained)) {
        if (xp > 0) grantXP(skill, xp)
      }
    }
    // Apply slayer XP from combat simulation
    if (task.type === 'combat' && sim.slayerXpGained > 0) {
      grantXP('slayer', sim.slayerXpGained)
    }
    if (sim.finalInventory) {
      updateInventory(sim.finalInventory)
      // combat uses lootBanked; skill/gather use itemsBanked (pure bank-trip items, not end-state inventory)
      const banked = sim.lootBanked || sim.itemsBanked
      if (banked && Object.keys(banked).length > 0) {
        updateBankDirect(banked)
      }
    } else if (sim.itemsGained) {
      updateBankDirect(sim.itemsGained)
    }
    if (task.type === 'agility' && sim.coinsGained > 0) {
      updateBankDirect({ coins: sim.coinsGained })
    }
    if (sim.itemsConsumed && Object.keys(sim.itemsConsumed).length > 0) {
      const negated = {}
      for (const [itemId, qty] of Object.entries(sim.itemsConsumed)) {
        negated[itemId] = -qty
      }
      updateBankDirect(negated)
    }
    // Update slayer task if present
    if (task.type === 'combat' && sim.slayerTaskUpdate) {
      if (sim.slayerTaskUpdate.completed) {
        setSlayerTask(null)
        addToast('💀 Slayer task completed!', 'levelup')
      } else {
        setSlayerTask(sim.slayerTaskUpdate)
      }
    }

    setIdleResult({ elapsedMs: ONE_HOUR_MS, task, ...sim })

    // Show skip hour completion toast
    const resultMsg = []
    if (sim.xpGained && Object.keys(sim.xpGained).length > 0) {
      const xpTotal = Object.values(sim.xpGained).reduce((a, b) => a + b, 0)
      if (xpTotal > 0) resultMsg.push(`+${Math.floor(xpTotal).toLocaleString()} XP`)
    }
    if (sim.itemsGained && Object.keys(sim.itemsGained).length > 0) {
      const itemTotal = Object.values(sim.itemsGained).reduce((a, b) => a + b, 0)
      if (itemTotal > 0) resultMsg.push(`+${itemTotal.toLocaleString()} items`)
    }
    if (resultMsg.length > 0) {
      addToast(`⏭️ Skipped 1h: ${resultMsg.join(', ')}`, 'info')
    }
  }

  // Navigate with optional action data
  const navigate = (scr, data) => {
    // Navigating away stops any active task and clears localStorage idle-engine
    // keys so the idle engine won't re-process a task that was stopped/cancelled.
    setActiveTask(null)
    setActionData(data || null)
    setScreen(scr)
  }

  // New game screen
  if (showNewGame) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', background: '#0f0f0f' }}>
        <div style={{ width: '100%', maxWidth: '360px' }}>
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <h1 style={{ fontFamily: 'Cinzel, serif', fontSize: '28px', fontWeight: '900', color: '#d4af37', letterSpacing: '0.05em' }}>PocketRPG</h1>
            <p style={{ fontSize: '11px', color: '#e8d5b0', opacity: 0.35, marginTop: '4px', fontFamily: 'Nunito, sans-serif' }}>A mobile tick-based idle fantasy RPG</p>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', fontSize: '11px', color: '#e8d5b0', opacity: 0.6, marginBottom: '6px', fontWeight: '600' }}>Character Name</label>
            <input
              type="text"
              value={playerName}
              onInput={(e) => setPlayerName(e.target.value)}
              placeholder="Enter your name..."
              maxLength={16}
              style={{ width: '100%', padding: '12px 16px', borderRadius: '12px', background: '#1a1a1a', border: '1px solid #333', color: '#e8d5b0', fontSize: '14px', fontFamily: 'Nunito, sans-serif', boxSizing: 'border-box', outline: 'none' }}
            />
          </div>

          <button
            onClick={handleNewGame}
            style={{ width: '100%', padding: '14px', borderRadius: '12px', background: 'linear-gradient(135deg, #b8940e, #d4af37)', color: '#0f0f0f', fontFamily: 'Cinzel, serif', fontWeight: 'bold', fontSize: '15px', letterSpacing: '0.05em', border: 'none', cursor: 'pointer' }}
          >
            Begin Adventure
          </button>

          <div style={{ marginTop: '16px', textAlign: 'center' }}>
            <label style={{ fontSize: '12px', color: '#7bb3f0', cursor: 'pointer' }}>
              Import existing save
              <input type="file" accept=".pocketrpg" onChange={handleImport} style={{ display: 'none' }} />
            </label>
          </div>
        </div>
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
      case SCREENS.HOME:      return <HomeScreen onNavigate={navigate} onSaveMenu={() => setShowSaveMenu(true)} />
      case SCREENS.STATS:     return <StatsScreen />
      case SCREENS.INVENTORY: return <InventoryScreen />
      case SCREENS.EQUIPMENT: return <EquipmentScreen />
      case SCREENS.BANK:      return <BankScreen />
      case SCREENS.COMBAT:    return <CombatScreen onNavigate={navigate} initialMonsterId={actionData?.monsterId} onSkipHour={handleSkipHour} skipHourUnlocked={unlockedFeatures?.has('skip_hour')} />
      case SCREENS.SKILLS:    return <SkillingScreen initialSkillId={actionData?.skillId} initialActionId={actionData?.actionId} idleResult={idleResult} onSkipHour={handleSkipHour} skipHourUnlocked={unlockedFeatures?.has('skip_hour')} />
      case SCREENS.GATHER:    return <GatherScreen initialTaskId={actionData?.gatherTaskId} idleResult={idleResult} onSkipHour={handleSkipHour} skipHourUnlocked={unlockedFeatures?.has('skip_hour')} />
      case SCREENS.AGILITY:   return <AgilityScreen initialActionId={actionData?.actionId} />
      case SCREENS.STORE:     return <GeneralStoreScreen />
      default:                return <HomeScreen onNavigate={navigate} onSaveMenu={() => setShowSaveMenu(true)} />
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Header activity={activity} />
      <ToastContainer />
      <main style={{ flex: 1, overflow: 'hidden' }}>
        {renderScreen()}
      </main>
      <BottomNav active={screen} onNavigate={(s) => navigate(s)} />

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
                   idleResult.task.type === 'gather' ? idleResult.task.gatherTask?.name : ''}
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
                        {taskCompleted && (
                          <div style={{ marginBottom: '8px', padding: '8px', background: 'rgba(212, 175, 55, 0.1)', borderRadius: '6px', borderLeft: '3px solid #d4af37' }}>
                            <div style={{ fontSize: '13px', color: '#d4af37', fontWeight: 'bold' }}>💀 Slayer Task Complete!</div>
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

      {/* Save/Load overlay */}
      {showSaveMenu && (
        <div
          onClick={() => setShowSaveMenu(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100, display: 'flex', alignItems: 'flex-end' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ width: '100%', background: '#1a1a1a', borderRadius: '20px 20px 0 0', padding: '20px', border: '1px solid #333', borderBottom: 'none' }}
          >
            <div style={{ width: '40px', height: '4px', background: '#333', borderRadius: '2px', margin: '0 auto 20px' }} />
            <h3 style={{ fontFamily: 'Cinzel, serif', fontSize: '15px', color: '#d4af37', textAlign: 'center', marginBottom: '16px' }}>Save & Load</h3>

            <button
              onClick={handleExport}
              style={{ width: '100%', padding: '14px', borderRadius: '12px', background: '#2a2a2a', border: '1px solid #3a3a3a', color: '#e8d5b0', fontSize: '14px', fontWeight: '600', marginBottom: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer' }}
            >
              📤 Export Save File
            </button>

            <label style={{ display: 'block', width: '100%', padding: '14px', borderRadius: '12px', background: '#2a2a2a', border: '1px solid #3a3a3a', color: '#7bb3f0', fontSize: '14px', fontWeight: '600', marginBottom: '10px', textAlign: 'center', cursor: 'pointer', boxSizing: 'border-box' }}>
              📥 Import Save File
              <input type="file" accept=".pocketrpg" onChange={handleImport} style={{ display: 'none' }} />
            </label>

            <button
              onClick={() => setShowSaveMenu(false)}
              style={{ width: '100%', padding: '12px', borderRadius: '12px', background: 'transparent', border: '1px solid #2a2a2a', color: '#e8d5b0', opacity: 0.5, fontSize: '13px', cursor: 'pointer' }}
            >
              Cancel
            </button>
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
