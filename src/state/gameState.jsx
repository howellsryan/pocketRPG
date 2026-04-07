import { createContext } from 'preact'
import { useState, useContext, useCallback, useEffect, useRef } from 'preact/hooks'
import { getAllStats, getInventory, getEquipment, getBank, getPlayer, saveAllStats, saveInventory, saveEquipment, saveBank, savePlayer, getSetting, saveSetting } from '../db/stores.js'
import { getLevelFromXP, clampXP } from '../engine/experience.js'
import { simulateIdleSkilling, simulateIdleGather, simulateIdleCombat, simulateIdleAgility } from '../engine/idleEngine.js'
import { ALL_SKILLS, MAX_XP, AUTO_SAVE_DEBOUNCE } from '../utils/constants.js'
import { debounce } from '../utils/helpers.js'
import itemsData from '../data/items.json'

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
  const [autoBankLoot, setAutoBankLootState] = useState(true)
  const [activeTask, setActiveTaskState] = useState(null)
  const dirty = useRef({ stats: false, inventory: false, equipment: false, bank: false, player: false })

  // Refs to hold latest state for the debounced auto-save
  const stateRef = useRef({ stats: {}, inventory: new Array(28).fill(null), equipment: {}, bank: {}, player: null })

  // Keep refs in sync with state
  useEffect(() => { stateRef.current.stats = stats }, [stats])
  useEffect(() => { stateRef.current.inventory = inventory }, [inventory])
  useEffect(() => { stateRef.current.equipment = equipment }, [equipment])
  useEffect(() => { stateRef.current.bank = bank }, [bank])
  useEffect(() => { stateRef.current.player = player }, [player])

  // Load all state from IndexedDB — runs idle simulation inline, returns idleResult
  const loadGame = useCallback(async () => {
    const [p, s, inv, eq, b, shortcuts, stance, savedHP, autoBankSetting] = await Promise.all([
      getPlayer(), getAllStats(), getInventory(), getEquipment(), getBank(),
      getSetting('homeShortcuts'), getSetting('combatStance'), getSetting('currentHP'),
      getSetting('autoBankLoot')
    ])
    // lastTick and activeTask live in localStorage — synchronous, survives iOS background freeze
    const savedLastTick = (() => { const v = localStorage.getItem('pocketrpg_lastTick'); return v ? parseInt(v, 10) : null })()
    const savedTask = (() => { try { return JSON.parse(localStorage.getItem('pocketrpg_activeTask')) } catch { return null } })()

    // ── Idle simulation (runs on raw DB data, before state is set) ──
    let idleResult = null
    console.log('[PocketRPG] loadGame — savedTask:', savedTask, 'savedLastTick:', savedLastTick, 'elapsed:', savedLastTick ? Date.now() - savedLastTick : 0)
    if (savedTask && savedLastTick) {
      const elapsedMs = Date.now() - savedLastTick
      if (elapsedMs >= 2000) {
        let sim = null
        if (savedTask.type === 'skill') {
          sim = simulateIdleSkilling(savedTask, elapsedMs, b, eq, s, itemsData)
        } else if (savedTask.type === 'gather') {
          sim = simulateIdleGather(savedTask, elapsedMs)
        } else if (savedTask.type === 'combat') {
          sim = simulateIdleCombat(savedTask, elapsedMs, s, eq, inv, itemsData)
        } else if (savedTask.type === 'agility') {
          sim = simulateIdleAgility(savedTask, elapsedMs)
        }

        if (sim) {
          // Apply XP directly to raw stats object
          if (sim.xpGained) {
            for (const [skill, xp] of Object.entries(sim.xpGained)) {
              if (xp > 0 && s[skill]) {
                const newXP = Math.min((s[skill].xp || 0) + Math.floor(xp), 200000000)
                s[skill] = { ...s[skill], xp: newXP, level: getLevelFromXP(newXP) }
              }
            }
          }
          // Deduct consumed materials from bank
          if (sim.itemsConsumed) {
            for (const [itemId, qty] of Object.entries(sim.itemsConsumed)) {
              if (b[itemId]) {
                const newQty = b[itemId].quantity - qty
                if (newQty <= 0) {
                  delete b[itemId]
                } else {
                  b[itemId] = { ...b[itemId], quantity: newQty }
                }
              }
            }
          }
          // Apply items to bank (skilling/gather) or inventory (combat)
          if (savedTask.type === 'combat' && sim.finalInventory) {
            // Use the already-mutated inventory from simulation
            sim.finalInventory.forEach((slot, i) => { inv[i] = slot })
          } else if (savedTask.type === 'agility' && sim.coinsGained > 0) {
            // Agility coins go to inventory (stackable), fall back to bank if full
            const coinsSlot = inv.findIndex(s => s && s.itemId === 'coins')
            if (coinsSlot >= 0) {
              inv[coinsSlot] = { ...inv[coinsSlot], quantity: inv[coinsSlot].quantity + sim.coinsGained }
            } else {
              const emptySlot = inv.findIndex(s => s === null)
              if (emptySlot >= 0) {
                inv[emptySlot] = { itemId: 'coins', quantity: sim.coinsGained }
              } else {
                // Inventory full — bank overflow
                if (b['coins']) {
                  b['coins'] = { ...b['coins'], quantity: b['coins'].quantity + sim.coinsGained }
                } else {
                  b['coins'] = { itemId: 'coins', quantity: sim.coinsGained }
                }
              }
            }
          } else if (sim.itemsGained) {
            for (const [itemId, qty] of Object.entries(sim.itemsGained)) {
              if (b[itemId]) {
                b[itemId] = { ...b[itemId], quantity: b[itemId].quantity + qty }
              } else {
                b[itemId] = { itemId, quantity: qty }
              }
            }
          }
          // Persist updated stats + bank/inventory to DB
          await saveAllStats(s)
          if (savedTask.type === 'combat') {
            await saveInventory(inv)
          } else {
            await saveBank(b)
          }
          idleResult = { elapsedMs, task: savedTask, ...sim }
        }
      }
    }

    setPlayer(p)
    setStats({ ...s })
    setInventory([...inv])
    setEquipment(eq)
    setBank({ ...b })
    setHomeShortcuts(shortcuts ?? null)
    setCombatStanceState(stance ?? 'accurate')
    setAutoBankLootState(autoBankSetting !== false) // default true
    setActiveTaskState(savedTask ?? null)
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
    await Promise.all(promises)
    dirty.current = { stats: false, inventory: false, equipment: false, bank: false, player: false }
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
          agility: '🏃', thieving: '🗝️', slayer: '💀', firemaking: '🔥', construction: '🏠'
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
    setCombatStanceState(stance)
    saveSetting('combatStance', stance)
  }, [])

  const updateAutoBankLoot = useCallback((enabled) => {
    setAutoBankLootState(enabled)
    saveSetting('autoBankLoot', enabled)
  }, [])

  const setActiveTask = useCallback((task) => {
    setActiveTaskState(task)
    // Synchronous localStorage write — safe from iOS background freeze
    if (task) {
      localStorage.setItem('pocketrpg_activeTask', JSON.stringify(task))
    } else {
      localStorage.removeItem('pocketrpg_activeTask')
      localStorage.removeItem('pocketrpg_lastTick')
    }
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
  }), [])

  const value = {
    loaded, player, stats, inventory, equipment, bank, currentHP, toasts,
    homeShortcuts, combatStance, activeTask, autoBankLoot,
    loadGame, grantXP, updateInventory, updateEquipment, updateBank,
    updateHP, getMaxHP, getSkillLevel, addToast, setPlayer,
    markDirty, itemsData, updateHomeShortcuts, updateCombatStance,
    setActiveTask, updateBankDirect, getSnapshot, updateAutoBankLoot
  }

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>
}

export function useGame() {
  return useContext(GameContext)
}
