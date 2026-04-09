import { useState, useEffect, useRef } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import Modal from '../components/Modal.jsx'
import HPBar from '../components/HPBar.jsx'
import { createCombatState, processCombatTick, applyEat, applySpecialAttack } from '../engine/combat.js'
import { getLevelFromXP } from '../engine/experience.js'
import { getAgilityBankDelayMs, formatBankDelay } from '../engine/agility.js'
import { onTick } from '../engine/tick.js'
import { addItem, removeItem, freeSlots } from '../engine/inventory.js'
import { getCombatType } from '../engine/equipment.js'
import monstersData from '../data/monsters.json'
import itemsData from '../data/items.json'
import prayersData from '../data/prayers.json'
import { SCREENS } from '../utils/constants.js'

const COMBAT_CATEGORIES = [
  {
    key: 'training',
    label: 'Training',
    icon: '⚔️',
    ids: ['chicken', 'goblin', 'cow', 'rock_crab', 'sand_crab', 'wizard', 'dark_wizard'],
  },
  {
    key: 'dragons_giants',
    label: 'Dragons & Giants',
    icon: '🐉',
    ids: ['giant_spider', 'hill_giant', 'moss_giant', 'lesser_demon', 'green_dragon'],
  },
  {
    key: 'slayer',
    label: 'Slayer',
    icon: '💀',
    ids: ['abyssal_demon'],
  },
  {
    key: 'bossing',
    label: 'God Wars Dungeon',
    icon: '👑',
    ids: ['general_graardor', 'commander_zilyana', 'kril_tsutsaroth', 'kreearra'],
  },
  {
    key: 'dagganoth_kings',
    label: 'Dagganoth Kings',
    icon: '👹',
    ids: ['dagganoth_rex', 'dagganoth_prime', 'dagganoth_supreme'],
  },
]

const MONSTER_ICONS = {
  chicken: '🐔', goblin: '👺', cow: '🐄', giant_spider: '🕷️',
  rock_crab: '🦀', sand_crab: '🦀', hill_giant: '👊', moss_giant: '🌿',
  wizard: '🧙', dark_wizard: '🧙‍♂️', abyssal_demon: '😈',
  green_dragon: '🐉', lesser_demon: '👿',
  general_graardor: '👹', commander_zilyana: '🌟', kril_tsutsaroth: '🔥', kreearra: '🦅',
  dagganoth_rex: '🦖', dagganoth_prime: '👹', dagganoth_supreme: '🏹'
}

export default function CombatScreen({ onNavigate, initialMonsterId, onSkipHour, skipHourUnlocked }) {
  const { stats, inventory, bank, equipment, currentHP, updateHP, updateInventory, updateBank, grantXP, getMaxHP, addToast, combatStance, updateCombatStance, homeShortcuts, updateHomeShortcuts, setActiveTask, autoBankLoot, updateAutoBankLoot, slayerTask, setSlayerTask, slayerPoints, updateSlayerPoints } = useGame()

  const [combat, setCombat] = useState(null)
  const [log, setLog] = useState([])
  const [killCount, setKillCount] = useState(0)
  const [fightStartedAt, setFightStartedAt] = useState(null)
  const [isAutoRestarting, setIsAutoRestarting] = useState(false)
  const [showPrayerModal, setShowPrayerModal] = useState(false)

  const combatRef = useRef(null)
  const hpRef = useRef(currentHP)
  const hasAutoStarted = useRef(false)
  const inventoryRef = useRef(inventory)
  const bankRef = useRef(bank)
  const statsRef = useRef(stats)
  const equipmentRef = useRef(equipment)
  const slayerTaskRef = useRef(slayerTask)
  const slayerPointsRef = useRef(slayerPoints)

  useEffect(() => { hpRef.current = currentHP }, [currentHP])
  useEffect(() => { inventoryRef.current = inventory }, [inventory])
  useEffect(() => { bankRef.current = bank }, [bank])
  useEffect(() => { statsRef.current = stats }, [stats])
  useEffect(() => { equipmentRef.current = equipment }, [equipment])
  useEffect(() => { slayerTaskRef.current = slayerTask }, [slayerTask])
  useEffect(() => { slayerPointsRef.current = slayerPoints }, [slayerPoints])

  // Auto-start fight from home shortcut
  useEffect(() => {
    if (initialMonsterId && !hasAutoStarted.current && !combat) {
      hasAutoStarted.current = true
      const monster = monstersData[initialMonsterId]
      if (monster) startFight(monster)
    }
  }, [initialMonsterId])

  // Tick listener for combat
  useEffect(() => {
    if (!combat || !combat.active) return
    combatRef.current = combat

    const unsub = onTick(() => {
      const state = combatRef.current
      if (!state || !state.active) return

      const playerStats = {
        attack: getLevelFromXP(statsRef.current.attack?.xp || 0),
        strength: getLevelFromXP(statsRef.current.strength?.xp || 0),
        defence: getLevelFromXP(statsRef.current.defence?.xp || 0),
        ranged: getLevelFromXP(statsRef.current.ranged?.xp || 0),
        magic: getLevelFromXP(statsRef.current.magic?.xp || 0),
        currentHP: hpRef.current
      }

      // Apply slayer helmet +15% melee accuracy & strength bonus when on task
      const headEquip = equipmentRef.current?.head
      const headItemData = headEquip ? itemsData[headEquip.itemId] : null
      if (headItemData?.otherBonus?.slayerHelmet && slayerTaskRef.current?.monsterId === state.monster.id) {
        playerStats.attack = Math.floor(playerStats.attack * 1.15)
        playerStats.strength = Math.floor(playerStats.strength * 1.15)
      }

      const { combatState, events } = processCombatTick(state, playerStats, equipmentRef.current, itemsData, prayersData)
      combatRef.current = combatState
      setCombat({ ...combatState })

      for (const ev of events) {
        if (ev.type === 'playerHit') {
          setLog(prev => [...prev.slice(-20), {
            text: ev.damage > 0 ? `You hit ${ev.damage}` : 'You miss',
            type: ev.damage > 0 ? 'hit' : 'miss',
            time: Date.now()
          }])
        }
        if (ev.type === 'specialHit') {
          const hitsStr = ev.hits.map(h => h > 0 ? h : 'miss').join(' + ')
          const specLabels = {
            double_hit: '⚔️⚔️ Puncture',
            zero_defence: '🎯 Sever',
            stun: ev.stunned ? '🪱 Energy Drain (stunned!)' : '🪱 Energy Drain',
            judgement: '⚡ The Judgement',
            healing_blade: `✨ Healing Blade (+${ev.healAmount} HP)`,
            freeze: '❄️ Ice Cleave (frozen!)',
            warstrike: '💥 Warstrike',
            lightning: '⚡ Saradomin\'s Lightning',
            snapshot: '🏹🏹 Snapshot',
            pebble_shot: '🎯 Pebble Shot',
            shove: '🗡️ Shove (staggered!)'
          }
          const label = specLabels[ev.specType] || '⚡ Special Attack'
          setLog(prev => [...prev.slice(-20), {
            text: `${label}: ${hitsStr} (total ${ev.totalDamage})`,
            type: 'special',
            time: Date.now()
          }])
          if (ev.specType === 'healing_blade' && ev.healAmount > 0) {
            const maxHP = getMaxHP()
            const newHP = Math.min(hpRef.current + ev.healAmount, maxHP)
            updateHP(newHP)
            hpRef.current = newHP
          }
        }
        if (ev.type === 'monsterHit') {
          const newHP = Math.max(0, hpRef.current - ev.damage)
          updateHP(newHP)
          hpRef.current = newHP
          if (ev.damage > 0) {
            setLog(prev => [...prev.slice(-20), {
              text: `${state.monster.name} hits ${ev.damage}`,
              type: 'enemy',
              time: Date.now()
            }])
          }
          if (newHP <= 0) {
            setCombat(prev => ({ ...prev, active: false }))
            addToast('You died! Respawning...', 'error')
            setActiveTask(null)
            updateHP(getMaxHP())
            hpRef.current = getMaxHP()
            // Auto-restart the fight after delay
            setIsAutoRestarting(true)
            setTimeout(() => {
              const original = monstersData[state.monster.id]
              if (original) continueFight(original)
              setIsAutoRestarting(false)
            }, 3000)
          }
        }
        if (ev.type === 'dragonfireHit') {
          const newHP = Math.max(0, hpRef.current - ev.damage)
          updateHP(newHP)
          hpRef.current = newHP
          setLog(prev => [...prev.slice(-20), {
            text: `🔥 Dragon breathes fire — ${ev.damage > 0 ? `hits ${ev.damage}!` : 'misses'} (equip Anti-dragon shield!)`,
            type: 'dragonfire',
            time: Date.now()
          }])
          if (newHP <= 0) {
            setCombat(prev => ({ ...prev, active: false }))
            addToast('Incinerated by dragonfire! Respawning...', 'error')
            setActiveTask(null)
            updateHP(getMaxHP())
            hpRef.current = getMaxHP()
            // Auto-restart the fight after delay
            setIsAutoRestarting(true)
            setTimeout(() => {
              const original = monstersData[state.monster.id]
              if (original) continueFight(original)
              setIsAutoRestarting(false)
            }, 3000)
          }
        }
        if (ev.type === 'dragonfireBlocked') {
          setLog(prev => [...prev.slice(-20), {
            text: `🛡️ Anti-dragon shield blocks the dragonfire!`,
            type: 'heal',
            time: Date.now()
          }])
        }
        if (ev.type === 'xp') {
          if (ev.xpSkills && typeof ev.xpSkills === 'object') {
            for (const [skill, xp] of Object.entries(ev.xpSkills)) {
              if (xp > 0) grantXP(skill, xp)
            }
          }
        }
        if (ev.type === 'monsterDeath') {
          setKillCount(k => k + 1)

          // Slayer task tracking
          const task = slayerTaskRef.current
          if (task && task.monsterId === state.monster.id) {
            // Grant slayer XP equal to monster's hitpoints
            grantXP('slayer', state.monster.hitpoints)
            const newRemaining = task.monstersRemaining - 1
            if (newRemaining <= 0) {
              // Task complete!
              const pts = task.pointsOnComplete
              const newPts = slayerPointsRef.current + pts
              updateSlayerPoints(newPts)
              setSlayerTask(null)
              addToast(pts > 0
                ? `💀 Slayer task complete! +${pts} points (${newPts} total)`
                : '💀 Slayer task complete!', 'levelup')
            } else {
              setSlayerTask({ ...task, monstersRemaining: newRemaining })
            }
          }

          if (ev.loot && ev.loot.length > 0) {
            const newInv = [...inventoryRef.current]
            for (const drop of ev.loot) {
              const item = itemsData[drop.itemId]
              const added = addItem(newInv, drop.itemId, drop.quantity, item?.stackable || false)
              if (added) {
                addToast(`Loot: ${item?.name || drop.itemId} ×${drop.quantity}`, 'drop')
              }
            }
            updateInventory(newInv)
          }
          setLog(prev => [...prev.slice(-20), {
            text: `${state.monster.name} defeated!`,
            type: 'victory',
            time: Date.now()
          }])
          setIsAutoRestarting(true)
          setTimeout(() => {
            const original = monstersData[state.monster.id]
            if (original) continueFight(original)
            setIsAutoRestarting(false)
          }, 3000)
        }
      }

    })

    return unsub
  }, [combat?.active])

  const getSlayerLevel = () => getLevelFromXP(stats.slayer?.xp || 0)

  const startFight = (monster) => {
    // Check slayer requirement
    if (monster.slayerRequirement) {
      const slayLvl = getSlayerLevel()
      if (slayLvl < monster.slayerRequirement) {
        addToast(`Need Slayer level ${monster.slayerRequirement} to fight ${monster.name}`, 'error')
        return
      }
    }
    const combatType = getCombatType(equipment, itemsData)
    const state = createCombatState(monster, combatType, combatStance)
    setCombat(state)
    setKillCount(0)
    setFightStartedAt(Date.now())
    setLog([{ text: `Fighting ${monster.name}...`, type: 'info', time: Date.now() }])
    setActiveTask({ type: 'combat', monster, stance: combatStance, bankingEnabled: autoBankLoot })
  }

  const continueFight = (monster) => {
    const combatType = getCombatType(equipment, itemsData)
    const state = createCombatState(monster, combatType, combatStance)
    setCombat(state)
    setActiveTask({ type: 'combat', monster, stance: combatStance, bankingEnabled: autoBankLoot })
  }

  const stopAndBack = () => {
    setCombat(null)
    setLog([])
    setActiveTask(null)
  }

  const handleEat = () => {
    const newInv = [...inventoryRef.current]
    const foodIdx = newInv.findIndex(s => s && itemsData[s.itemId]?.type === 'food')
    if (foodIdx === -1) { addToast('No food!', 'error'); return }

    const food = itemsData[newInv[foodIdx].itemId]
    if (newInv[foodIdx].quantity > 1) {
      newInv[foodIdx] = { ...newInv[foodIdx], quantity: newInv[foodIdx].quantity - 1 }
    } else {
      newInv[foodIdx] = null
    }
    updateInventory(newInv)
    const maxHP = getMaxHP()
    const newHP = Math.min(hpRef.current + food.heals, maxHP)
    updateHP(newHP)
    hpRef.current = newHP

    if (combat) {
      const newState = applyEat(combat)
      setCombat(newState)
      combatRef.current = newState
    }

    setLog(prev => [...prev.slice(-20), {
      text: `Ate ${food.name}, healed ${food.heals}`,
      type: 'heal',
      time: Date.now()
    }])
  }

  const handleSpecialAttack = () => {
    if (!combatRef.current || !combatRef.current.active) return

    // Check if weapon has special attack and enough energy
    const weaponEntry = equipmentRef.current?.weapon
    const weapon = weaponEntry ? itemsData[weaponEntry.itemId] : null
    if (!weapon?.specialAttack) return

    const energy = combatRef.current.specialAttackEnergy || 0
    if (energy < weapon.specialAttack.energyCost) return

    // Queue the special attack to be fired on next tick (without draining energy yet)
    const newState = {
      ...combatRef.current,
      specialAttackQueued: true
    }
    combatRef.current = newState
    setCombat({ ...newState })
  }

  const handlePrayer = (prayerId) => {
    if (!combatRef.current) return
    const prayer = prayersData[prayerId]
    if (!prayer) return

    let newState = { ...combatRef.current }

    // Determine prayer type and update accordingly
    if (prayer.bonusType === 'protection') {
      // Toggle or set protection prayer
      newState.activeProtectionPrayer = combatRef.current.activeProtectionPrayer === prayerId ? null : prayerId
    } else {
      // Toggle or set combat prayer
      newState.activeCombatPrayer = combatRef.current.activeCombatPrayer === prayerId ? null : prayerId
    }

    combatRef.current = newState
    setCombat(newState)
    addToast(`${prayer.icon} ${prayer.name}`, 'info')
  }

  const handleAddToHome = (monster) => {
    const icon = MONSTER_ICONS[monster.id] || '👹'
    const shortcut = {
      label: `Fight ${monster.name}`,
      icon,
      screen: SCREENS.COMBAT,
      monsterId: monster.id
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
      addToast(`Already on home screen!`, 'info')
      return
    }
    updateHomeShortcuts([...current, shortcut])
    addToast(`${icon} ${shortcut.label} added to Home!`, 'info')
  }

  const agilityLevel = getLevelFromXP(stats.agility?.xp || 0)
  const bankDelayMs = getAgilityBankDelayMs(agilityLevel)
  // Monster picker
  if (!combat) {
    return (
      <div class="h-full overflow-y-auto p-4">
        <h2 class="font-[var(--font-display)] text-sm font-bold text-[var(--color-parchment)] opacity-60 uppercase tracking-wider mb-3">
          Choose a Monster
        </h2>

        {/* Stance selector */}
        <div class="flex gap-1.5 mb-3">
          {['accurate', 'aggressive', 'defensive', 'controlled'].map(s => (
            <button
              key={s}
              onClick={() => updateCombatStance(s)}
              class={`flex-1 py-1.5 rounded-lg text-[10px] font-semibold capitalize transition-colors
                ${combatStance === s ? 'bg-[var(--color-gold-dim)] text-white' : 'bg-[#1a1a1a] text-[var(--color-parchment)] opacity-50'}`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Banking toggle — idle only, persisted */}
        <div class="mb-3 bg-[#111] rounded-lg px-3 py-2.5 flex items-center justify-between">
          <div>
            <div class="text-xs font-semibold text-[var(--color-parchment)]">🏦 Auto-Bank Loot (Idle)</div>
            <div class="text-[10px] text-[var(--color-parchment)] opacity-40 mt-0.5">
              {autoBankLoot
                ? `${formatBankDelay(bankDelayMs)} delay (Agility lv ${agilityLevel})`
                : 'Off — loot stays in inventory'}
            </div>
          </div>
          <button
            onClick={() => updateAutoBankLoot(!autoBankLoot)}
            class={`relative flex-shrink-0 w-12 h-7 rounded-full transition-colors duration-200 ${autoBankLoot ? 'bg-[var(--color-gold-dim)]' : 'bg-[#333]'}`}
            style="min-width:48px"
          >
            <span class={`absolute top-[3px] left-[3px] w-[22px] h-[22px] bg-white rounded-full shadow-md transition-transform duration-200 ${autoBankLoot ? 'translate-x-[20px]' : 'translate-x-0'}`} />
          </button>
        </div>

        <div class="space-y-4">
          {COMBAT_CATEGORIES.map(category => {
            const monsters = category.ids
              .map(id => monstersData[id])
              .filter(Boolean)
              .sort((a, b) => a.combatLevel - b.combatLevel)
            return (
              <div key={category.key}>
                <div class="flex items-center gap-2 mb-2 px-1">
                  <span class="text-base">{category.icon}</span>
                  <span class="text-xs font-semibold text-[var(--color-parchment)] uppercase tracking-wider opacity-60">{category.label}</span>
                  {monsters.length === 0 && (
                    <span class="text-[10px] text-[var(--color-parchment)] opacity-30 italic">— coming soon</span>
                  )}
                </div>
                <div class="space-y-2">
                  {monsters.map(monster => {
                    const slayLvl = getSlayerLevel()
                    const slayReq = monster.slayerRequirement
                    const slayLocked = slayReq && slayLvl < slayReq
                    const isOnTask = slayerTask?.monsterId === monster.id
                    return (
                    <div key={monster.id} class="flex gap-2 items-stretch">
                      <button
                        onClick={() => !slayLocked && startFight(monster)}
                        disabled={slayLocked}
                        class={`flex-1 flex items-center justify-between p-3 rounded-xl border transition-colors
                          ${isOnTask ? 'bg-[#1a1a08] border-[#3a3a10]' :
                            slayLocked ? 'bg-[#111] border-[#1a1a1a] opacity-50' :
                            'bg-[#1a1a1a] border-[#2a2a2a] active:bg-[#222]'}`}
                      >
                        <div class="flex items-center gap-3">
                          <span class="text-2xl">{MONSTER_ICONS[monster.id] || '👹'}</span>
                          <div class="text-left">
                            <div class="flex items-center gap-1.5">
                              <span class="text-sm font-semibold text-[var(--color-parchment)]">{monster.name}</span>
                              {isOnTask && <span class="text-[9px] bg-yellow-500 text-black font-bold px-1 rounded">TASK</span>}
                            </div>
                            <div class="text-[10px] text-[var(--color-parchment)] opacity-40">
                              HP {monster.hitpoints} · Att {monster.stats.attack} · Def {monster.stats.defence}
                            </div>
                            {slayReq && (
                              <div class={`text-[9px] font-semibold ${slayLocked ? 'text-[var(--color-blood-light)]' : 'text-[var(--color-hp-green)]'}`}>
                                💀 Slayer {slayReq}{slayLocked ? ` (you: ${slayLvl})` : ' ✓'}
                              </div>
                            )}
                          </div>
                        </div>
                        <div class="text-right">
                          <div class="text-xs font-[var(--font-mono)] text-[var(--color-blood-light)]">CB {monster.combatLevel}</div>
                          {isOnTask && (
                            <div class="text-[9px] text-yellow-400 font-mono mt-0.5">{slayerTask.monstersRemaining} left</div>
                          )}
                        </div>
                      </button>
                      <button
                        onClick={() => handleAddToHome(monster)}
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
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // Combat view
  return (
    <div class="h-full flex flex-col p-4">
      {/* Back button */}
      <button onClick={stopAndBack}
        class="text-xs text-[var(--color-gold-dim)] mb-3 flex items-center gap-1">
        ← Back
      </button>

      {/* Monster HP */}
      <div class="mb-3">
        <div class="flex items-center justify-between mb-1">
          <span class="text-sm font-semibold text-[var(--color-parchment)]">{combat.monster.name}</span>
          <span class="text-[10px] font-[var(--font-mono)] text-[var(--color-blood-light)]">CB {combat.monster.combatLevel}</span>
        </div>
        <HPBar current={Math.max(0, combat.monster.currentHP)} max={combat.monster.hitpoints} size="large" />
      </div>

      {/* Player HP */}
      <div class="mb-2">
        <div class="text-[10px] text-[var(--color-parchment)] opacity-50 mb-0.5">Your HP</div>
        <HPBar current={currentHP} max={getMaxHP()} size="large" />
      </div>

      {/* Slayer task indicator */}
      {slayerTask?.monsterId === combat.monster.id && (
        <div class="mb-2 bg-[#1a1a08] border border-[#3a3a10] rounded-lg px-3 py-1.5 flex items-center justify-between">
          <span class="text-[10px] text-yellow-400 font-semibold">💀 Slayer Task</span>
          <span class="text-[10px] font-[var(--font-mono)] text-yellow-400">
            {slayerTask.monstersRemaining} / {slayerTask.totalCount} remaining
          </span>
        </div>
      )}

      {/* Inventory slots indicator */}
      <div class="mb-2 bg-[#111] rounded-lg px-3 py-1.5 flex items-center justify-between">
        <span class="text-[10px] text-[var(--color-parchment)] opacity-50">🎒 Inventory</span>
        <span class="text-[10px] font-[var(--font-mono)] text-[var(--color-parchment)] opacity-40">
          {freeSlots(inventory)}/28 free
        </span>
      </div>

      {/* Special attack bar — only shown when equipped weapon has a spec */}
      {(() => {
        const weaponEntry = equipment?.weapon
        const weapon = weaponEntry ? itemsData[weaponEntry.itemId] : null
        if (!weapon?.specialAttack) return null
        const energy = combat.specialAttackEnergy || 0
        const canSpec = energy >= weapon.specialAttack.energyCost
        return (
          <div class="mb-2 bg-[#111] rounded-lg px-3 py-2">
            <div class="flex items-center justify-between mb-1">
              <span class="text-[10px] text-yellow-400 font-semibold">⚡ Special Attack</span>
              <span class="text-[10px] font-[var(--font-mono)] text-yellow-400">{energy}%</span>
            </div>
            <div class="h-2 rounded-full bg-[#222] overflow-hidden">
              <div
                class="h-full rounded-full transition-all duration-300"
                style={{ width: `${energy}%`, background: canSpec ? '#eab308' : '#78530a' }}
              />
            </div>
            <div class="text-[9px] text-[var(--color-parchment)] opacity-40 mt-0.5">
              {weapon.specialAttack.energyCost}% cost · refills on kill
            </div>
          </div>
        )
      })()}

      {/* Combat log */}
      <div class="flex-1 bg-[#111] rounded-lg border border-[#222] p-2 overflow-y-auto mb-2 min-h-[100px]">
        {log.map((entry, i) => (
          <div key={i} class={`text-[11px] font-[var(--font-mono)] py-0.5
            ${entry.type === 'hit' ? 'text-[var(--color-emerald-light)]' :
              entry.type === 'miss' ? 'text-[var(--color-parchment)] opacity-30' :
              entry.type === 'enemy' ? 'text-[var(--color-blood-light)]' :
              entry.type === 'heal' ? 'text-[var(--color-hp-green)]' :
              entry.type === 'dragonfire' ? 'text-orange-400' :
              entry.type === 'special' ? 'text-yellow-300' :
              entry.type === 'victory' ? 'text-[var(--color-gold)]' :
              'text-[var(--color-parchment)] opacity-50'}`}
          >
            {entry.text}
          </div>
        ))}
      </div>

      {/* Kill stats */}
      {fightStartedAt && (
        <div class="flex-shrink-0 flex justify-between bg-[#111] rounded-lg px-3 py-2 mb-2 text-[11px]">
          <span class="text-[var(--color-parchment)] opacity-50">Kills</span>
          <span class="font-[var(--font-mono)] text-[var(--color-gold)]">{killCount}</span>
          <span class="text-[var(--color-parchment)] opacity-50">Kills/hr</span>
          <span class="font-[var(--font-mono)] text-[var(--color-gold)]">
            {killCount > 0 && (Date.now() - fightStartedAt) > 5000
              ? Math.round(killCount / ((Date.now() - fightStartedAt) / 3600000)).toLocaleString()
              : '—'}
          </span>
        </div>
      )}

      {/* Action buttons */}
      <div class="flex-shrink-0 flex flex-col gap-2">
        {combat.active && !isAutoRestarting && (
          <>
            {/* Primary combat actions */}
            <div class="grid grid-cols-2 gap-2">
              <button onClick={handleEat}
                class="py-2.5 rounded-lg font-semibold text-sm active:opacity-80"
                style="background:linear-gradient(135deg,#1a3a2a,#2a5a3a);border:1px solid rgba(100,200,120,0.35);color:#7de8a0">
                🍖 Eat
              </button>
              <button class="py-2.5 rounded-lg bg-[#222] text-[var(--color-parchment)] opacity-40 text-sm cursor-default">
                🧪 Potion
              </button>
            </div>
            {/* Special attack & Prayer buttons */}
            <div class="grid grid-cols-2 gap-2">
              {(() => {
                const weaponEntry = equipment?.weapon
                const weapon = weaponEntry ? itemsData[weaponEntry.itemId] : null
                const hasSpec = weapon?.specialAttack
                const energy = combat.specialAttackEnergy || 0
                const canSpec = hasSpec && energy >= weapon.specialAttack.energyCost
                return (
                  <button
                    onClick={canSpec ? handleSpecialAttack : undefined}
                    disabled={!canSpec}
                    class={`py-2.5 rounded-lg font-semibold text-sm transition-opacity ${canSpec ? 'active:opacity-80' : 'opacity-40 cursor-default'}`}
                    style={canSpec ? 'background:linear-gradient(135deg,#3a2a00,#6a4a00);border:1px solid rgba(234,179,8,0.5);color:#fde047' : 'background:#1a1a1a;border:1px solid #2a2a2a;color:#888'}
                  >
                    ⚡ {hasSpec ? `Special (${weapon.specialAttack.energyCost}%)` : 'No Spec'}
                  </button>
                )
              })()}
              <button onClick={() => setShowPrayerModal(true)}
                class="py-2.5 rounded-lg font-semibold text-sm active:opacity-80"
                style="background:linear-gradient(135deg,#1a3a2a,#2a5a3a);border:1px solid rgba(100,200,120,0.35);color:#7de8a0">
                🙏 Prayer
              </button>
            </div>
            {/* Skip 1h */}
            {skipHourUnlocked && (
              <button onClick={onSkipHour}
                class="w-full py-2.5 rounded-lg font-semibold text-sm active:opacity-80"
                style="background:linear-gradient(135deg,#1a3a2a,#2a5a3a);border:1px solid rgba(100,200,120,0.35);color:#7de8a0">
                ⏭️ Skip 1h
              </button>
            )}
          </>
        )}
      </div>

      {/* Prayer modal */}
      {showPrayerModal && (
        <Modal onClose={() => setShowPrayerModal(false)}>
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-[var(--font-display)] text-base font-bold text-[var(--color-gold)]">Choose Prayer</h3>
            <button
              onClick={() => setShowPrayerModal(false)}
              class="w-6 h-6 flex items-center justify-center rounded-lg bg-[#222] text-[var(--color-parchment)] hover:bg-[#333] active:bg-[#444] transition-colors"
              title="Close"
            >
              ✕
            </button>
          </div>

          <div class="space-y-4 max-h-96 overflow-y-auto">
            {/* Protection Prayers */}
            <div>
              <h4 class="text-xs font-semibold text-[var(--color-gold-dim)] uppercase tracking-wider mb-2 opacity-70">Protection</h4>
              <div class="space-y-2">
                {Object.values(prayersData)
                  .filter(p => p.bonusType === 'protection')
                  .map(prayer => {
                    const prayerLevel = getLevelFromXP(stats.prayer?.xp || 0)
                    const canUse = prayerLevel >= prayer.level
                    const isActive = combat?.activeProtectionPrayer === prayer.id
                    return (
                      <button
                        key={prayer.id}
                        onClick={() => canUse && handlePrayer(prayer.id)}
                        disabled={!canUse}
                        class={`w-full p-3 rounded-lg border transition-colors ${
                          isActive
                            ? 'bg-[#2a4a2a] border-[#4a8a4a]'
                            : canUse
                              ? 'bg-[#1a2a1a] border-[#2a4a2a] active:bg-[#2a3a2a]'
                              : 'bg-[#111] border-[#1a1a1a] opacity-40'
                        }`}
                      >
                        <div class="flex items-center justify-between">
                          <div class="text-left">
                            <div class="text-sm font-semibold text-[var(--color-parchment)]">{prayer.icon} {prayer.name}</div>
                            <div class="text-[10px] text-[var(--color-parchment)] opacity-60">{prayer.description}</div>
                            <div class="text-[9px] text-[var(--color-gold-dim)] mt-0.5">Lv {prayer.level}</div>
                          </div>
                          {isActive && (
                            <span class="text-base text-[var(--color-hp-green)]">✓</span>
                          )}
                        </div>
                      </button>
                    )
                  })}
              </div>
            </div>

            {/* Combat Enhancement Prayers */}
            <div>
              <h4 class="text-xs font-semibold text-[var(--color-gold-dim)] uppercase tracking-wider mb-2 opacity-70">Combat</h4>
              <div class="space-y-2">
                {Object.values(prayersData)
                  .filter(p => p.bonusType !== 'protection')
                  .map(prayer => {
                    const prayerLevel = getLevelFromXP(stats.prayer?.xp || 0)
                    const canUse = prayerLevel >= prayer.level
                    const isActive = combat?.activeCombatPrayer === prayer.id
                    return (
                      <button
                        key={prayer.id}
                        onClick={() => canUse && handlePrayer(prayer.id)}
                        disabled={!canUse}
                        class={`w-full p-3 rounded-lg border transition-colors ${
                          isActive
                            ? 'bg-[#2a3a1a] border-[#4a8a2a]'
                            : canUse
                              ? 'bg-[#1a2a1a] border-[#2a4a2a] active:bg-[#2a3a2a]'
                              : 'bg-[#111] border-[#1a1a1a] opacity-40'
                        }`}
                      >
                        <div class="flex items-center justify-between">
                          <div class="text-left">
                            <div class="text-sm font-semibold text-[var(--color-parchment)]">{prayer.icon} {prayer.name}</div>
                            <div class="text-[10px] text-[var(--color-parchment)] opacity-60">{prayer.description}</div>
                            <div class="text-[9px] text-[var(--color-gold-dim)] mt-0.5">Lv {prayer.level}</div>
                          </div>
                          {isActive && (
                            <span class="text-base text-[var(--color-hp-green)]">✓</span>
                          )}
                        </div>
                      </button>
                    )
                  })}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
