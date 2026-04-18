import { useState, useEffect, useRef } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import Modal from '../components/Modal.jsx'
import HPBar from '../components/HPBar.jsx'
import { createCombatState, createRaidCombatState, processCombatTick, applyEat, applySpecialAttack } from '../engine/combat.js'
import { getLevelFromXP } from '../engine/experience.js'
import { getAgilityBankDelayMs, formatBankDelay } from '../engine/agility.js'
import { onTick } from '../engine/tick.js'
import { addItem, removeItem, freeSlots } from '../engine/inventory.js'
import { getCombatType, equipItem } from '../engine/equipment.js'
import monstersData from '../data/monsters.json'
import itemsData from '../data/items.json'
import prayersData from '../data/prayers.json'
import spellsData from '../data/spells.json'
import raidsData from '../data/raids.json'
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
    ids: ['giant_spider', 'hill_giant', 'moss_giant', 'lesser_demon', 'green_dragon', 'red_dragon'],
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
  {
    key: 'wilderness',
    label: 'Wilderness',
    icon: '🏴',
    ids: ['crazy_archaeologist'],
  },
  {
    key: 'lair',
    label: 'Lair',
    icon: '🐲',
    ids: ['king_black_dragon'],
  },
  {
    key: 'zulrah',
    label: 'Zulrah',
    icon: '🐍',
    ids: ['zulrah'],
  },
  {
    key: 'fight_caves',
    label: 'Fight Caves',
    icon: '🔥',
    ids: ['jad'],
  },
  {
    key: 'inferno',
    label: 'The Inferno',
    icon: '🌋',
    ids: ['inferno'],
  },
  {
    key: 'corrupted_gauntlet',
    label: 'Corrupted Gauntlet',
    icon: '⚡',
    ids: ['corrupted_gauntlet'],
  },
]

const MONSTER_ICONS = {
  chicken: '🐔', goblin: '👺', cow: '🐄', giant_spider: '🕷️',
  rock_crab: '🦀', sand_crab: '🦀', hill_giant: '👊', moss_giant: '🌿',
  wizard: '🧙', dark_wizard: '🧙‍♂️', abyssal_demon: '😈',
  green_dragon: '🐉', red_dragon: '🔴', lesser_demon: '👿',
  general_graardor: '👹', commander_zilyana: '🌟', kril_tsutsaroth: '🔥', kreearra: '🦅',
  dagganoth_rex: '🦖', dagganoth_prime: '👹', dagganoth_supreme: '🏹',
  crazy_archaeologist: '📜', king_black_dragon: '👑', zulrah: '🐍', jad: '🌋', inferno: '🌋', corrupted_gauntlet: '⚡',
  tekton: '🔨', vespula: '🦟', muttadile: '🦷', olm: '🏛️',
  maiden_of_sugadinti: '🩸', pestilent_bloat: '🤢', nylocas_vasilias: '🕷️',
  sotetseg: '🔮', xarpus: '☠️', verzik_vitur: '👑'
}

export default function CombatScreen({ onNavigate, initialMonsterId, initialRaidId, onBossFightStatusChange }) {
  const { stats, inventory, bank, equipment, currentHP, updateHP, updateInventory, updateBank, updateEquipment, grantXP, getMaxHP, addToast, combatStance, updateCombatStance, homeShortcuts, updateHomeShortcuts, setActiveTask, slayerTask, setSlayerTask, slayerPoints, updateSlayerPoints, activeCombatSpell, updateActiveCombatSpell, bossKillCounts, updateBossKillCounts, unlockedFeatures } = useGame()

  const [combat, setCombat] = useState(null)
  const [log, setLog] = useState([])
  const [killCount, setKillCount] = useState(0)
  const [fightStartedAt, setFightStartedAt] = useState(null)
  const [isAutoRestarting, setIsAutoRestarting] = useState(false)
  const [showPrayerModal, setShowPrayerModal] = useState(false)
  const [showPotionModal, setShowPotionModal] = useState(false)
  const [showEquipmentModal, setShowEquipmentModal] = useState(false)
  const [showSpellModal, setShowSpellModal] = useState(false)
  const [selectedMonsterInfo, setSelectedMonsterInfo] = useState(null)
  const [selectedRaidInfo, setSelectedRaidInfo] = useState(null)
  const [lootModal, setLootModal] = useState(null)

  const combatRef = useRef(null)
  const hpRef = useRef(currentHP)
  const hasAutoStarted = useRef(false)
  const inventoryRef = useRef(inventory)
  const bankRef = useRef(bank)
  const statsRef = useRef(stats)
  const equipmentRef = useRef(equipment)
  const slayerTaskRef = useRef(slayerTask)
  const slayerPointsRef = useRef(slayerPoints)
  const bossKillCountsRef = useRef(bossKillCounts)
  const unlockedFeaturesRef = useRef(unlockedFeatures)
  const logRef = useRef(null)

  useEffect(() => { hpRef.current = currentHP }, [currentHP])
  useEffect(() => { inventoryRef.current = inventory }, [inventory])
  useEffect(() => { bankRef.current = bank }, [bank])
  useEffect(() => { statsRef.current = stats }, [stats])
  useEffect(() => { equipmentRef.current = equipment }, [equipment])
  useEffect(() => { slayerTaskRef.current = slayerTask }, [slayerTask])
  useEffect(() => { slayerPointsRef.current = slayerPoints }, [slayerPoints])
  useEffect(() => { bossKillCountsRef.current = bossKillCounts }, [bossKillCounts])
  useEffect(() => { unlockedFeaturesRef.current = unlockedFeatures }, [unlockedFeatures])

  // Auto-scroll log to bottom on new messages
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [log])

  // Update spell in active combat if changed mid-fight
  useEffect(() => {
    if (!combatRef.current || !combatRef.current.active) return
    const newCombatType = getCombatType(equipmentRef.current, itemsData)
    const weaponItem = equipmentRef.current?.weapon ? itemsData[equipmentRef.current.weapon.itemId] : null
    const isPoweredStaff = !!weaponItem?.poweredStaff
    const newSpell = newCombatType === 'magic' && activeCombatSpell && !isPoweredStaff ? spellsData[activeCombatSpell.id] : null
    const effectiveSpellId = isPoweredStaff ? null : activeCombatSpell?.id
    // Update combat state to use the new spell/combat type
    if (combatRef.current.combatType !== newCombatType ||
        (newCombatType === 'magic' && combatRef.current.spell?.id !== effectiveSpellId)) {
      combatRef.current = {
        ...combatRef.current,
        combatType: newCombatType,
        spell: newSpell
      }
      setCombat({ ...combatRef.current })
    }
  }, [activeCombatSpell, equipment])

  // Auto-start fight from home shortcut
  useEffect(() => {
    if (initialMonsterId && !hasAutoStarted.current && !combat) {
      hasAutoStarted.current = true
      const monster = monstersData[initialMonsterId]
      if (monster) startFight(monster)
    }
  }, [initialMonsterId])

  useEffect(() => {
    if (initialRaidId && !hasAutoStarted.current && !combat) {
      hasAutoStarted.current = true
      const raid = raidsData[initialRaidId]
      if (raid) startRaid(raid)
    }
  }, [initialRaidId])

  // Update boss fight status in parent
  useEffect(() => {
    const isBossFight = combat?.active && combat?.monster?.boss === true
    onBossFightStatusChange?.(isBossFight)
  }, [combat?.active, combat?.monster?.boss, onBossFightStatusChange])

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

      const { combatState, events } = processCombatTick(state, playerStats, equipmentRef.current, itemsData, prayersData, inventoryRef.current)

      // Master Rejuvenation: auto-refill spec bar when it hits 0 mid-fight
      if (combatState.active && combatState.specialAttackEnergy === 0 && unlockedFeaturesRef.current.has('master_rejuvenation')) {
        combatState.specialAttackEnergy = 100
      }

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
            shove: '🗡️ Shove (staggered!)',
            toxic_siphon: `🎋 Toxic Siphon (+${ev.healAmount || 0} HP)`,
            slice_and_dice: '🦀🦀🦀🦀 Slice and Dice',
            lunge: '🔰 The Block'
          }
          const label = specLabels[ev.specType] || '⚡ Special Attack'
          setLog(prev => [...prev.slice(-20), {
            text: `${label}: ${hitsStr} (total ${ev.totalDamage})`,
            type: 'special',
            time: Date.now()
          }])
          if ((ev.specType === 'healing_blade' || ev.specType === 'toxic_siphon') && ev.healAmount > 0) {
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
            addToast('You died!', 'error')
            setActiveTask(null)
            updateHP(getMaxHP())
            hpRef.current = getMaxHP()
          }
        }
        if (ev.type === 'monsterMiss') {
          setLog(prev => [...prev.slice(-20), {
            text: `${state.monster.name} misses!`,
            type: 'heal',
            time: Date.now()
          }])
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
            addToast('Incinerated by dragonfire!', 'error')
            setActiveTask(null)
            updateHP(getMaxHP())
            hpRef.current = getMaxHP()
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
        if (ev.type === 'noRunesForSpell') {
          setLog(prev => [...prev.slice(-20), {
            text: `Not enough runes for ${ev.spellName}`,
            type: 'miss',
            time: Date.now()
          }])
        }
        if (ev.type === 'consumeCharge') {
          // Decrement weapon charges on the equipped weapon
          const newEq = { ...equipmentRef.current }
          const w = newEq.weapon
          if (w && w.charges && w.charges > 0) {
            newEq.weapon = { ...w, charges: Math.max(0, w.charges - (ev.qty || 1)) }
            equipmentRef.current = newEq
            updateEquipment(newEq)
          }
        }
        if (ev.type === 'consumeAmmo') {
          // Decrement ammo quantity on the equipped ammo
          const newEq = { ...equipmentRef.current }
          const ammo = newEq.ammo
          if (ammo && ammo.quantity && ammo.quantity > 0) {
            const newQty = Math.max(0, ammo.quantity - (ev.qty || 1))
            if (newQty <= 0) {
              // Out of ammo
              newEq.ammo = null
              setLog(prev => [...prev.slice(-20), {
                text: `Out of ammo!`,
                type: 'miss',
                time: Date.now()
              }])
            } else {
              newEq.ammo = { ...ammo, quantity: newQty }
            }
            equipmentRef.current = newEq
            updateEquipment(newEq)
          }
        }
        if (ev.type === 'noCharges') {
          const item = itemsData[ev.itemId]
          setLog(prev => [...prev.slice(-20), {
            text: `${item?.name || 'Weapon'} has no charges — use Zulrah's scales to charge it!`,
            type: 'miss',
            time: Date.now()
          }])
        }
        if (ev.type === 'immuneHit') {
          const immunityLabel = ev.immunity === 'melee' ? 'melee' : ev.immunity === 'ranged' ? 'ranged' : 'magic'
          setLog(prev => [...prev.slice(-20), {
            text: `🛡️ ${ev.monsterName || 'Monster'} is immune to ${immunityLabel}!`,
            type: 'miss',
            time: Date.now()
          }])
        }
        if (ev.type === 'formChange') {
          const monsterName = ev.monsterName || 'Monster'
          const immunityNote = ev.immunity ? ` (immune to ${ev.immunity})` : ''
          setLog(prev => [...prev.slice(-20), {
            text: `${ev.icon || '🐍'} ${monsterName} shifts into ${ev.displayName}${immunityNote}`,
            type: 'formChange',
            time: Date.now()
          }])
          const phaseChangeMonsters = ['olm', 'zulrah', 'jad', 'inferno', 'demonic_gorilla', 'maiden_of_sugadinti', 'pestilent_bloat', 'nylocas_vasilias', 'sotetseg', 'xarpus', 'verzik_vitur', 'vespula', 'muttadile']
          if (!phaseChangeMonsters.includes(state.monster.id)) {
            addToast(`${ev.icon || '🐍'} ${monsterName}: ${ev.displayName} form${immunityNote}`, 'info')
          }
        }
        if (ev.type === 'bossPhaseReset') {
          const name = ev.monsterName || 'Boss'
          setLog(prev => [...prev.slice(-20), {
            text: `💀 ${name} defeated! (${ev.killsCompleted}/${ev.killsNeeded}) — regenerating...`,
            type: 'formChange',
            time: Date.now()
          }])
        }
        if (ev.type === 'verzikPhaseChange') {
          setLog(prev => [...prev.slice(-20), {
            text: `${ev.icon || '🩸'} ${ev.monsterName} enters ${ev.displayName}!`,
            type: 'formChange',
            time: Date.now()
          }])
        }
        if (ev.type === 'raidBossDefeated') {
          setLog(prev => [...prev.slice(-20), {
            text: `🩸 ${ev.bossName} defeated! (${ev.bossIndex + 1}/${ev.totalBosses})`,
            type: 'victory',
            time: Date.now()
          }])
        }
        if (ev.type === 'raidBossAdvance') {
          setLog(prev => [...prev.slice(-20), {
            text: `⚔️ Boss ${ev.bossIndex + 1}/${ev.totalBosses}: ${ev.nextBossName}`,
            type: 'raid',
            time: Date.now()
          }])
        }
        if (ev.type === 'raidComplete') {
          setLog(prev => [...prev.slice(-20), {
            text: `🏆 Raid complete!`,
            type: 'raid',
            time: Date.now()
          }])
          addToast('🏆 Raid complete! Check your loot!', 'levelup')
        }
        if (ev.type === 'scythePassive') {
          setLog(prev => [...prev.slice(-20), {
            text: `🌙 Scythe hits: ${ev.hits.join(' + ')} = ${ev.hits.reduce((a, b) => a + b, 0)}`,
            type: 'hit',
            time: Date.now()
          }])
        }
        if (ev.type === 'sangHeal') {
          // Heal the player from sanguinesti staff passive
          const maxHP = getMaxHP()
          const newHP = Math.min(hpRef.current + ev.healAmount, maxHP)
          updateHP(newHP)
          hpRef.current = newHP
          setLog(prev => [...prev.slice(-20), {
            text: `🩸 Sanguinesti staff heals ${ev.healAmount} HP`,
            type: 'heal',
            time: Date.now()
          }])
        }
        if (combatRef.current.runesConsumed && ev.type === 'playerHit' && ev.damage > 0) {
          // Consume runes when spell successfully casts
          const newInv = [...inventoryRef.current]
          for (const [runeId, qty] of Object.entries(combatRef.current.runesConsumed)) {
            let remaining = qty
            for (let i = 0; i < newInv.length && remaining > 0; i++) {
              if (newInv[i]?.itemId === runeId) {
                const consumed = Math.min(newInv[i].quantity, remaining)
                newInv[i] = { ...newInv[i], quantity: newInv[i].quantity - consumed }
                if (newInv[i].quantity === 0) newInv[i] = null
                remaining -= consumed
              }
            }
          }
          updateInventory(newInv)
          inventoryRef.current = newInv
          combatRef.current.runesConsumed = null // Clear so we don't consume again
        }
        if (ev.type === 'monsterDeath') {
          setKillCount(k => k + 1)

          // Boss kill count tracking
          if (state.monster.boss) {
            const monsterId = state.monster.id
            const newKC = (bossKillCountsRef.current[monsterId] || 0) + 1
            const updatedCounts = { ...bossKillCountsRef.current, [monsterId]: newKC }
            bossKillCountsRef.current = updatedCounts
            updateBossKillCounts(updatedCounts)
            setLog(prev => [...prev.slice(-20), {
              text: `👑 ${state.monster.name} KC: ${newKC.toLocaleString()}`,
              type: 'victory',
              time: Date.now()
            }])
          }

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
              let added = false
              if (drop.noted) {
                // Noted drops stack separately from regular stacks (noted: true on slot)
                const existingIdx = newInv.findIndex(s => s && s.itemId === drop.itemId && s.noted)
                if (existingIdx !== -1) {
                  newInv[existingIdx] = { ...newInv[existingIdx], quantity: newInv[existingIdx].quantity + drop.quantity }
                  added = true
                } else {
                  const empty = newInv.indexOf(null)
                  if (empty !== -1) { newInv[empty] = { itemId: drop.itemId, quantity: drop.quantity, noted: true }; added = true }
                }
              } else {
                added = addItem(newInv, drop.itemId, drop.quantity, item?.stackable || false)
              }
            }
            updateInventory(newInv)
          }
          setLog(prev => [...prev.slice(-20), {
            text: `${state.monster.name} defeated!`,
            type: 'victory',
            time: Date.now()
          }])
          // Show loot modal instead of auto-restarting
          const raidId = state.raid?.raidId || null
          setLootModal({
            monster: state.monster,
            loot: ev.loot || [],
            raidId
          })
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
    const weaponItem = equipment?.weapon ? itemsData[equipment.weapon.itemId] : null
    const isPoweredStaff = !!weaponItem?.poweredStaff
    const spell = combatType === 'magic' && activeCombatSpell && !isPoweredStaff ? spellsData[activeCombatSpell.id] : null
    if (combatType === 'magic' && !spell && !isPoweredStaff) {
      addToast('No spell selected! Use the 🔮 Cast button to pick a spell.', 'error')
    }
    const state = createCombatState(monster, combatType, combatStance, spell)
    // Reset special attack energy on new fight; preserve active potions so they last their full 5 minutes
    state.specialAttackEnergy = 100
    state.activePotions = combatRef.current ? { ...combatRef.current.activePotions } : {}
    setCombat(state)
    setKillCount(0)
    setFightStartedAt(Date.now())
    const spellName = spell ? ` with ${spell.name}` : isPoweredStaff && weaponItem ? ` with ${weaponItem.name}` : ''
    setLog([{ text: `Fighting ${monster.name}${spellName}...`, type: 'info', time: Date.now() }])
    setActiveTask({ type: 'combat', monster, stance: combatStance, bankingEnabled: true, spell: spell || null })
  }

  const startRaid = (raidData) => {
    const combatType = getCombatType(equipment, itemsData)
    const weaponItem = equipment?.weapon ? itemsData[equipment.weapon.itemId] : null
    const isPoweredStaff = !!weaponItem?.poweredStaff
    const spell = combatType === 'magic' && activeCombatSpell && !isPoweredStaff ? spellsData[activeCombatSpell.id] : null
    if (combatType === 'magic' && !spell && !isPoweredStaff) {
      addToast('No spell selected! Use the 🔮 Cast button to pick a spell.', 'error')
    }
    const state = createRaidCombatState(raidData, monstersData, combatType, combatStance, spell)
    if (!state) {
      addToast('Failed to start raid — missing boss data', 'error')
      return
    }
    state.specialAttackEnergy = 100
    state.activePotions = combatRef.current ? { ...combatRef.current.activePotions } : {}
    setCombat(state)
    setKillCount(0)
    setFightStartedAt(Date.now())
    const firstBoss = monstersData[raidData.bosses[0]]
    setLog([
      { text: `🩸 ${raidData.name} — Raid started!`, type: 'raid', time: Date.now() },
      { text: `Boss 1/${raidData.bosses.length}: ${firstBoss?.name || 'Unknown'}`, type: 'info', time: Date.now() }
    ])
    setActiveTask({ type: 'combat', monster: firstBoss, stance: combatStance, bankingEnabled: false, spell: spell || null })
  }

  const continueFight = (monster) => {
    const combatType = getCombatType(equipment, itemsData)
    const weaponItem = equipment?.weapon ? itemsData[equipment.weapon.itemId] : null
    const isPoweredStaff = !!weaponItem?.poweredStaff
    const spell = combatType === 'magic' && activeCombatSpell && !isPoweredStaff ? spellsData[activeCombatSpell.id] : null
    const state = createCombatState(monster, combatType, combatStance, spell)
    // Reset special attack energy on kill; preserve active potions and prayers so they last their full duration
    state.specialAttackEnergy = 100
    state.activePotions = combatRef.current ? { ...combatRef.current.activePotions } : {}
    state.activeProtectionPrayer = combatRef.current?.activeProtectionPrayer ?? null
    state.activeCombatPrayer = combatRef.current?.activeCombatPrayer ?? null
    setCombat(state)
    setActiveTask({ type: 'combat', monster, stance: combatStance, bankingEnabled: true, spell: spell || null })
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

    // Scale-charged weapons must have at least one charge to fire a spec
    if (weapon.scaleCharged && (weaponEntry.charges || 0) <= 0) {
      addToast('No charges — use Zulrah\'s scales to charge this weapon.', 'error')
      return
    }

    // Queue the special attack to be fired on next tick (without draining energy yet)
    const newState = {
      ...combatRef.current,
      specialAttackQueued: true
    }
    combatRef.current = newState
    setCombat({ ...newState })
  }

  const handlePotion = (potionItemId) => {
    if (!combatRef.current || !combatRef.current.active) return

    const newInv = [...inventoryRef.current]
    const potionIdx = newInv.findIndex(s => s && s.itemId === potionItemId)
    if (potionIdx === -1) return

    const potion = itemsData[potionItemId]
    if (!potion) return

    // Check if a potion with the same effect type is already active
    const hasPotionOfType = Object.keys(combatRef.current.activePotions).some(existingId => {
      const existingPotion = itemsData[existingId]
      return existingPotion && existingPotion.effect === potion.effect
    })
    if (hasPotionOfType) {
      addToast(`${potion.name} effect is already active`, 'error')
      return
    }

    // Remove potion from inventory
    if (newInv[potionIdx].quantity > 1) {
      newInv[potionIdx] = { ...newInv[potionIdx], quantity: newInv[potionIdx].quantity - 1 }
    } else {
      newInv[potionIdx] = null
    }
    updateInventory(newInv)
    inventoryRef.current = newInv

    // Apply potion effect to combat state
    const newState = { ...combatRef.current }
    newState.activePotions = { ...newState.activePotions }

    // Duration: 300 ticks = 300 * 0.6s = 180s = 3 minutes
    const durationTicks = (potion.duration || 300) / 0.6  // Convert seconds to ticks
    newState.activePotions[potionItemId] = durationTicks

    // HP potions heal immediately
    if (potion.effect === 'hp') {
      const maxHP = getMaxHP()
      const healing = potion.boost || 10
      const newHP = Math.min(hpRef.current + healing, maxHP)
      updateHP(newHP)
      hpRef.current = newHP
      setLog(prev => [...prev.slice(-20), {
        text: `Drank ${potion.name}, healed ${healing} HP`,
        type: 'heal',
        time: Date.now()
      }])
    } else {
      setLog(prev => [...prev.slice(-20), {
        text: `Drank ${potion.name}`,
        type: 'heal',
        time: Date.now()
      }])
    }

    combatRef.current = newState
    setCombat(newState)
    setShowPotionModal(false)
    addToast(`${potion.icon} ${potion.name}`, 'info')
  }

  const handleEquipItem = (itemId) => {
    if (!combat) return
    const newInv = [...inventoryRef.current]
    const itemIdx = newInv.findIndex(s => s && s.itemId === itemId)
    if (itemIdx === -1) return

    const itemData = itemsData[itemId]
    if (!itemData || !itemData.slot) return

    // Copy equipment to avoid mutating ref directly
    const newEq = { ...equipmentRef.current }
    const sourceSlot = newInv[itemIdx]
    const result = equipItem(newEq, itemData, itemsData, sourceSlot)

    if (!result.equipped) {
      addToast('Could not equip item', 'error')
      return
    }

    // Remove the equipped item from inventory
    if (newInv[itemIdx].quantity > 1) {
      newInv[itemIdx] = { ...newInv[itemIdx], quantity: newInv[itemIdx].quantity - 1 }
    } else {
      newInv[itemIdx] = null
    }

    // Add any unequipped items back to inventory
    for (const unequipped of result.unequipped) {
      if (itemsData[unequipped.itemId]?.stackable) {
        const existingIdx = newInv.findIndex(s => s && s.itemId === unequipped.itemId)
        if (existingIdx !== -1) {
          newInv[existingIdx] = { ...newInv[existingIdx], quantity: newInv[existingIdx].quantity + (unequipped.quantity || 1) }
          continue
        }
      }
      // Add to empty slot, preserving any charges the unequipped item had
      const emptyIdx = newInv.findIndex(s => s === null)
      if (emptyIdx !== -1) {
        const invEntry = { itemId: unequipped.itemId, quantity: unequipped.quantity || 1 }
        if (unequipped.charges && unequipped.charges > 0) invEntry.charges = unequipped.charges
        newInv[emptyIdx] = invEntry
      }
    }

    updateInventory(newInv)
    inventoryRef.current = newInv
    updateEquipment(newEq)
    equipmentRef.current = newEq

    addToast(`Equipped ${itemData.name}`, 'info')
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

  const handleAddRaidToHome = (raid) => {
    const shortcut = {
      label: `Run ${raid.name}`,
      icon: raid.icon,
      screen: SCREENS.COMBAT,
      raidId: raid.id
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
    addToast(`${raid.icon} ${shortcut.label} added to Home!`, 'info')
  }

  const agilityLevel = getLevelFromXP(stats.agility?.xp || 0)
  const bankDelayMs = getAgilityBankDelayMs(agilityLevel)
  // Monster picker
  if (!combat) {
    return (
      <>
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
                    <div key={monster.id} class="flex gap-2 items-center">
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
                          {monster.boss && bossKillCounts[monster.id] > 0 && (
                            <div class="text-[9px] text-yellow-400 font-mono mt-0.5">KC: {bossKillCounts[monster.id].toLocaleString()}</div>
                          )}
                        </div>
                      </button>
                      <button
                        onClick={() => setSelectedMonsterInfo(monster)}
                        class="flex-shrink-0 px-3 py-3 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] active:bg-[#222] transition-colors flex flex-col items-center justify-center gap-0.5"
                        title="View Monster Info"
                      >
                        <span class="text-base">ℹ️</span>
                        <span class="text-[8px] text-[var(--color-parchment)] opacity-50">Info</span>
                      </button>
                      <button
                        onClick={() => handleAddToHome(monster)}
                        class="flex-shrink-0 px-3 py-3 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] active:bg-[#222] transition-colors flex flex-col items-center justify-center gap-0.5"
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

        {/* Raids Section */}
        <div class="mt-6">
          <div class="flex items-center gap-2 mb-3 px-1">
            <span class="text-base">🏆</span>
            <span class="text-xs font-semibold text-[var(--color-gold)] uppercase tracking-wider">Raids</span>
          </div>
          <div class="space-y-2">
            {Object.values(raidsData).map(raid => {
              const bosses = raid.bosses.map(id => monstersData[id]).filter(Boolean)
              return (
                <div key={raid.id} class="flex gap-2 items-center">
                  <button
                    onClick={() => startRaid(raid)}
                    class="flex-1 p-3 rounded-xl border bg-[#1a1a1a] border-[#2a2a2a] active:bg-[#222] transition-colors text-left"
                  >
                    <div class="flex items-center gap-2 mb-2">
                      <span class="text-2xl">{raid.icon}</span>
                      <div>
                        <div class="text-sm font-semibold text-[var(--color-parchment)]">{raid.name}</div>
                        <div class="text-[10px] text-[var(--color-parchment)] opacity-40">{raid.description}</div>
                      </div>
                    </div>
                    <div class="flex flex-wrap gap-1">
                      {bosses.map((boss) => (
                        <span key={boss.id} class="text-[9px] bg-[#111] text-[var(--color-parchment)] opacity-60 px-1.5 py-0.5 rounded">
                          {MONSTER_ICONS[boss.id] || '👹'} {boss.name}
                        </span>
                      ))}
                    </div>
                  </button>
                  <button
                    onClick={() => setSelectedRaidInfo(raid)}
                    class="flex-shrink-0 px-3 py-3 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] active:bg-[#222] transition-colors flex flex-col items-center justify-center gap-0.5"
                    title="View Raid Info"
                  >
                    <span class="text-base">ℹ️</span>
                    <span class="text-[8px] text-[var(--color-parchment)] opacity-50">Info</span>
                  </button>
                  <button
                    onClick={() => handleAddRaidToHome(raid)}
                    class="flex-shrink-0 px-3 py-3 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] active:bg-[#222] transition-colors flex flex-col items-center justify-center gap-0.5"
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
      </div>

      {/* Monster Info Modal — shown from picker view */}
      {selectedMonsterInfo && (
        <Modal onClose={() => setSelectedMonsterInfo(null)}>
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-[var(--font-display)] text-base font-bold text-[var(--color-gold)]">
              {MONSTER_ICONS[selectedMonsterInfo.id] || '👹'} {selectedMonsterInfo.name}
            </h3>
            <button
              onClick={() => setSelectedMonsterInfo(null)}
              class="w-6 h-6 flex items-center justify-center rounded-lg bg-[#222] text-[var(--color-parchment)] hover:bg-[#333] active:bg-[#444] transition-colors"
              title="Close"
            >
              ✕
            </button>
          </div>
          <div class="space-y-4 max-h-96 overflow-y-auto">
            <div>
              <h4 class="text-xs font-semibold text-[var(--color-gold-dim)] uppercase tracking-wider mb-2 opacity-70">Combat Stats</h4>
              <div class="bg-[#111] rounded-lg p-3 space-y-1">
                <div class="flex justify-between text-[11px] text-[var(--color-parchment)]"><span>Combat Level</span><span class="font-[var(--font-mono)] text-[var(--color-gold)]">{selectedMonsterInfo.combatLevel}</span></div>
                <div class="flex justify-between text-[11px] text-[var(--color-parchment)]"><span>HP</span><span class="font-[var(--font-mono)] text-[var(--color-hp-green)]">{selectedMonsterInfo.hitpoints}</span></div>
                <div class="flex justify-between text-[11px] text-[var(--color-parchment)]"><span>Attack</span><span class="font-[var(--font-mono)]">{selectedMonsterInfo.stats.attack}</span></div>
                <div class="flex justify-between text-[11px] text-[var(--color-parchment)]"><span>Strength</span><span class="font-[var(--font-mono)]">{selectedMonsterInfo.stats.strength}</span></div>
                <div class="flex justify-between text-[11px] text-[var(--color-parchment)]"><span>Defence</span><span class="font-[var(--font-mono)]">{selectedMonsterInfo.stats.defence}</span></div>
                <div class="flex justify-between text-[11px] text-[var(--color-parchment)]"><span>Magic</span><span class="font-[var(--font-mono)]">{selectedMonsterInfo.stats.magic}</span></div>
                <div class="flex justify-between text-[11px] text-[var(--color-parchment)]"><span>Ranged</span><span class="font-[var(--font-mono)]">{selectedMonsterInfo.stats.ranged}</span></div>
              </div>
            </div>
            <div>
              <h4 class="text-xs font-semibold text-[var(--color-gold-dim)] uppercase tracking-wider mb-2 opacity-70">Defence Bonuses</h4>
              <div class="bg-[#111] rounded-lg p-3 space-y-1">
                {['stab', 'slash', 'crush', 'magic', 'ranged'].map(style => (
                  <div key={style} class="flex justify-between text-[11px] text-[var(--color-parchment)]">
                    <span class="capitalize">{style}</span>
                    <span class={`font-[var(--font-mono)] ${selectedMonsterInfo.defenceBonus[style] >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {selectedMonsterInfo.defenceBonus[style] >= 0 ? '+' : ''}{selectedMonsterInfo.defenceBonus[style]}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            {selectedMonsterInfo.drops && selectedMonsterInfo.drops.length > 0 && (
              <div>
                <h4 class="text-xs font-semibold text-[var(--color-gold-dim)] uppercase tracking-wider mb-2 opacity-70">Drops</h4>
                <div class="space-y-1">
                  {selectedMonsterInfo.drops.map(drop => {
                    const item = itemsData[drop.itemId]
                    const percentage = (drop.chance * 100).toFixed(1)
                    return (
                      <div key={drop.itemId} class="bg-[#111] rounded-lg p-2">
                        <div class="flex items-start justify-between gap-2">
                          <div class="text-left flex-1 min-w-0">
                            <div class="text-[11px] font-semibold text-[var(--color-parchment)]">{item?.icon || '📦'} {item?.name || drop.itemId}</div>
                            <div class="text-[9px] text-[var(--color-parchment)] opacity-60 mt-0.5">
                              {drop.chance === 1 ? 'Always' : `${percentage}%`}
                              {Array.isArray(drop.quantity) ? ` · ${drop.quantity[0]}–${drop.quantity[1]} ea` : ` · ${drop.quantity}`}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Raid Info Modal */}
      {selectedRaidInfo && (
        <Modal onClose={() => setSelectedRaidInfo(null)}>
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-[var(--font-display)] text-base font-bold text-[var(--color-gold)]">
              {selectedRaidInfo.icon} {selectedRaidInfo.name}
            </h3>
            <button
              onClick={() => setSelectedRaidInfo(null)}
              class="w-6 h-6 flex items-center justify-center rounded-lg bg-[#222] text-[var(--color-parchment)] hover:bg-[#333] active:bg-[#444] transition-colors"
              title="Close"
            >
              ✕
            </button>
          </div>
          <div class="space-y-4 max-h-96 overflow-y-auto">
            <div>
              <p class="text-[11px] text-[var(--color-parchment)] opacity-60 mb-3">{selectedRaidInfo.description}</p>
            </div>
            <div>
              <h4 class="text-xs font-semibold text-[var(--color-gold-dim)] uppercase tracking-wider mb-2 opacity-70">Bosses</h4>
              <div class="space-y-1">
                {selectedRaidInfo.bosses.map((bossId, i) => {
                  const boss = monstersData[bossId]
                  if (!boss) return null
                  return (
                    <div key={bossId} class="bg-[#111] rounded-lg p-2 flex items-center justify-between">
                      <div class="flex items-center gap-2">
                        <span class="text-base">{MONSTER_ICONS[bossId] || '👹'}</span>
                        <div>
                          <div class="text-[11px] font-semibold text-[var(--color-parchment)]">{i + 1}. {boss.name}</div>
                          <div class="text-[9px] text-[var(--color-parchment)] opacity-50">HP {boss.hitpoints} · CB {boss.combatLevel}</div>
                        </div>
                      </div>
                      <span class="text-[9px] text-[var(--color-parchment)] opacity-40 font-[var(--font-mono)]">CB {boss.combatLevel}</span>
                    </div>
                  )
                })}
              </div>
            </div>
            {selectedRaidInfo.rewards && (
              <div>
                <h4 class="text-xs font-semibold text-[var(--color-gold-dim)] uppercase tracking-wider mb-2 opacity-70">Rewards</h4>
                <div class="space-y-1">
                  {selectedRaidInfo.rewards.always?.map(drop => {
                    const item = itemsData[drop.itemId]
                    return (
                      <div key={drop.itemId} class="bg-[#111] rounded-lg p-2 flex items-center justify-between">
                        <div class="text-[11px] text-[var(--color-parchment)]">{item?.icon || '📦'} {item?.name || drop.itemId}</div>
                        <div class="text-[9px] text-[var(--color-parchment)] opacity-50">
                          {drop.chance === 1 ? 'Always' : `${(drop.chance * 100).toFixed(0)}%`}
                          {Array.isArray(drop.quantity) ? ` · ${drop.quantity[0]}–${drop.quantity[1]}` : ` · ${drop.quantity}`}
                        </div>
                      </div>
                    )
                  })}
                  {selectedRaidInfo.rewards.unique && (
                    <div class="bg-[#1a1208] border border-[#3a2a10] rounded-lg p-2 mt-1">
                      <div class="text-[10px] font-semibold text-[var(--color-gold)] mb-1">
                        ✨ Unique Drop ({(selectedRaidInfo.rewards.unique.chance * 100).toFixed(1)}% chance)
                      </div>
                      <div class="space-y-0.5">
                        {selectedRaidInfo.rewards.unique.items.map(u => {
                          const item = itemsData[u.itemId]
                          return (
                            <div key={u.itemId} class="text-[10px] text-[var(--color-parchment)] opacity-70">
                              {item?.icon || '🎁'} {item?.name || u.itemId}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
      </>
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
          <span class="text-sm font-semibold text-[var(--color-parchment)]">
            {combat.monster.name}
            {combat.monster.multiForm && combat.monster.currentForm && combat.monster.forms?.[combat.monster.currentForm] && (() => {
              const form = combat.monster.forms[combat.monster.currentForm]
              return (
                <span class="ml-2 text-[10px] font-[var(--font-mono)] text-purple-300">
                  {form.icon} {form.displayName}{form.immunity ? ` · 🛡️ immune to ${form.immunity}` : ''}
                </span>
              )
            })()}
          </span>
          <span class="text-[10px] font-[var(--font-mono)] text-[var(--color-blood-light)]">CB {combat.monster.combatLevel}</span>
        </div>
        <HPBar current={Math.max(0, combat.monster.currentHP)} max={combat.monster.hitpoints} size="large" />
      </div>

      {/* Raid progress indicator */}
      {combat.raid && (
        <div class="mb-2 bg-[#111] border border-[#2a2a2a] rounded-lg px-3 py-2">
          <div class="flex items-center justify-between mb-1.5">
            <span class="text-[10px] font-semibold text-[var(--color-gold)]">{raidsData[combat.raid.raidId]?.icon} {raidsData[combat.raid.raidId]?.name || 'Raid'}</span>
            <span class="text-[10px] font-[var(--font-mono)] text-[var(--color-parchment)] opacity-60">
              Boss {combat.raid.currentBossIndex + 1}/{combat.raid.bosses.length}
            </span>
          </div>
          <div class="flex gap-1">
            {combat.raid.bosses.map((bossId, i) => (
              <div
                key={bossId}
                class={`flex-1 h-1.5 rounded-full ${
                  i < combat.raid.currentBossIndex ? 'bg-[var(--color-hp-green)]' :
                  i === combat.raid.currentBossIndex ? 'bg-[var(--color-gold)]' :
                  'bg-[#333]'
                }`}
                title={monstersData[bossId]?.name || bossId}
              />
            ))}
          </div>
        </div>
      )}

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

      {/* Inventory slots indicator with active potion boosts */}
      <div class="mb-2 bg-[#111] rounded-lg px-3 py-1.5">
        <div class="flex items-center justify-between mb-1">
          <span class="text-[10px] text-[var(--color-parchment)] opacity-50">🎒 Inventory</span>
          <span class="text-[10px] font-[var(--font-mono)] text-[var(--color-parchment)] opacity-40">
            {freeSlots(inventory)}/28 free
          </span>
        </div>
        {Object.keys(combat?.activePotions || {}).length > 0 && (
          <div class="text-[8px] text-[var(--color-gold)] opacity-75">
            {Object.keys(combat.activePotions).map(potionId => {
              const potion = itemsData[potionId]
              if (!potion) return null
              const boosts = []
              if (potion.effect === 'attack') boosts.push(`+${potion.boost} Atk`)
              if (potion.effect === 'strength') boosts.push(`+${potion.boost} Str`)
              if (potion.effect === 'defence') boosts.push(`+${potion.boost} Def`)
              if (potion.effect === 'ranged') boosts.push(`+${potion.boost} Rng`)
              if (potion.effect === 'magic') boosts.push(`+${potion.boost} Mag`)
              if (potion.effect === 'combat') boosts.push(`+${potion.boost} All`)
              return (
                <div key={potionId} class="opacity-75">
                  {potion.icon} {boosts.join(', ')}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Scale-charged weapon charges display */}
      {(() => {
        const weaponEntry = equipment?.weapon
        const weapon = weaponEntry ? itemsData[weaponEntry.itemId] : null
        if (!weapon?.scaleCharged) return null
        const charges = weaponEntry.charges || 0
        return (
          <div class="mb-2 bg-[#111] rounded-lg px-3 py-2">
            <div class="flex items-center justify-between">
              <span class="text-[10px] text-green-400 font-semibold">🐍 {weapon.name} charges</span>
              <span class={`text-[10px] font-[var(--font-mono)] ${charges === 0 ? 'text-red-400' : 'text-green-400'}`}>
                {charges}
              </span>
            </div>
            <div class="text-[9px] text-[var(--color-parchment)] opacity-40 mt-0.5">
              1 Zulrah's scale = 1 attack · Charge via Equipment screen
            </div>
          </div>
        )
      })()}

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
      <div ref={logRef} class="flex-1 bg-[#111] rounded-lg border border-[#222] p-2 overflow-y-auto mb-2 min-h-[100px]">
        {log.map((entry, i) => (
          <div key={i} class={`text-[11px] font-[var(--font-mono)] py-0.5
            ${entry.type === 'hit' ? 'text-[var(--color-emerald-light)]' :
              entry.type === 'miss' ? 'text-[var(--color-parchment)] opacity-30' :
              entry.type === 'enemy' ? 'text-[var(--color-blood-light)]' :
              entry.type === 'heal' ? 'text-[var(--color-hp-green)]' :
              entry.type === 'dragonfire' ? 'text-orange-400' :
              entry.type === 'special' ? 'text-yellow-300' :
              entry.type === 'formChange' ? 'text-purple-300' :
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
              <button onClick={() => setShowPotionModal(true)}
                class="py-2.5 rounded-lg font-semibold text-sm active:opacity-80"
                style="background:linear-gradient(135deg,#1a3a2a,#2a5a3a);border:1px solid rgba(100,200,120,0.35);color:#7de8a0">
                🧪 Potion
              </button>
            </div>
            {/* Special attack, Cast, and Prayer buttons */}
            <div class="grid grid-cols-3 gap-2">
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
                    ⚡ {hasSpec ? `Spec` : 'No Spec'}
                  </button>
                )
              })()}
              {(() => {
                const weaponEntry = equipment?.weapon
                const weapon = weaponEntry ? itemsData[weaponEntry.itemId] : null
                const isMagic = weapon?.attackStyle === 'magic'
                const magicLevel = getLevelFromXP(stats.magic?.xp || 0)
                return (
                  <button
                    onClick={() => isMagic && setShowSpellModal(true)}
                    disabled={!isMagic}
                    class={`py-2.5 rounded-lg font-semibold text-sm transition-opacity ${isMagic ? 'active:opacity-80' : 'opacity-40 cursor-default'}`}
                    style={isMagic ? 'background:linear-gradient(135deg,#1a2a3a,#2a3a5a);border:1px solid rgba(100,150,200,0.35);color:#a8d8ff' : 'background:#1a1a1a;border:1px solid #2a2a2a;color:#888'}
                  >
                    🔮 Cast
                  </button>
                )
              })()}
              <button onClick={() => setShowPrayerModal(true)}
                class="py-2.5 rounded-lg font-semibold text-sm active:opacity-80"
                style="background:linear-gradient(135deg,#1a3a2a,#2a5a3a);border:1px solid rgba(100,200,120,0.35);color:#7de8a0">
                🙏 Prayer
              </button>
            </div>
            {/* Gear button */}
            <div class="grid grid-cols-1 gap-2">
              <button onClick={() => setShowEquipmentModal(true)}
                class="py-2.5 rounded-lg font-semibold text-sm active:opacity-80"
                style="background:linear-gradient(135deg,#2a2a3a,#3a3a5a);border:1px solid rgba(150,150,200,0.35);color:#a8a8d8">
                ⚙️ Gear
              </button>
            </div>
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
              <div class="grid grid-cols-3 gap-2">
                {Object.values(prayersData)
                  .filter(p => p.bonusType === 'protection')
                  .map(prayer => {
                    const prayerLevel = getLevelFromXP(stats.prayer?.xp || 0)
                    const canUse = prayerLevel >= prayer.level
                    const isActive = combat?.activeProtectionPrayer === prayer.id
                    const protectType = prayer.style === 'magic' ? 'Magic' : prayer.style === 'ranged' ? 'Ranged' : 'Melee'
                    return (
                      <button
                        key={prayer.id}
                        onClick={() => canUse && handlePrayer(prayer.id)}
                        disabled={!canUse}
                        class={`p-3 rounded-lg border transition-colors flex flex-col items-center justify-between ${
                          isActive
                            ? 'bg-[#2a4a2a] border-[#4a8a4a]'
                            : canUse
                              ? 'bg-[#1a2a1a] border-[#2a4a2a] active:bg-[#2a3a2a]'
                              : 'bg-[#111] border-[#1a1a1a] opacity-40'
                        }`}
                      >
                        <div class="text-center flex-1 flex flex-col items-center justify-center">
                          <div class="text-[10px] text-[var(--color-parchment)] opacity-60">{prayer.icon}</div>
                          <div class="text-[8px] text-[var(--color-parchment)] opacity-60 mt-1 line-clamp-2">Protect from {protectType}</div>
                          <div class="text-[8px] text-[var(--color-gold-dim)] mt-1">Lv {prayer.level}</div>
                        </div>
                        {isActive && (
                          <span class="text-base text-[var(--color-hp-green)] mt-1">✓</span>
                        )}
                      </button>
                    )
                  })}
              </div>
            </div>

            {/* Combat Enhancement Prayers */}
            <div>
              <h4 class="text-xs font-semibold text-[var(--color-gold-dim)] uppercase tracking-wider mb-2 opacity-70">Combat</h4>
              <div class="grid grid-cols-2 gap-2">
                {Object.values(prayersData)
                  .filter(p => p.bonusType !== 'protection')
                  .sort((a, b) => b.level - a.level)
                  .map(prayer => {
                    const prayerLevel = getLevelFromXP(stats.prayer?.xp || 0)
                    const canUse = prayerLevel >= prayer.level
                    const isActive = combat?.activeCombatPrayer === prayer.id
                    return (
                      <button
                        key={prayer.id}
                        onClick={() => canUse && handlePrayer(prayer.id)}
                        disabled={!canUse}
                        class={`p-3 rounded-lg border transition-colors ${
                          isActive
                            ? 'bg-[#2a3a1a] border-[#4a8a2a]'
                            : canUse
                              ? 'bg-[#1a2a1a] border-[#2a4a2a] active:bg-[#2a3a2a]'
                              : 'bg-[#111] border-[#1a1a1a] opacity-40'
                        }`}
                      >
                        <div class="flex flex-col items-start justify-between h-full">
                          <div class="text-left flex-1">
                            <div class="text-sm font-semibold text-[var(--color-parchment)]">{prayer.icon} {prayer.name}</div>
                            <div class="text-[9px] text-[var(--color-parchment)] opacity-60 line-clamp-2">{prayer.description}</div>
                            <div class="text-[8px] text-[var(--color-gold-dim)] mt-0.5">Lv {prayer.level}</div>
                          </div>
                          {isActive && (
                            <span class="text-base text-[var(--color-hp-green)] mt-1">✓</span>
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

      {/* Potion modal */}
      {showPotionModal && (
        <Modal onClose={() => setShowPotionModal(false)}>
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-[var(--font-display)] text-base font-bold text-[var(--color-gold)]">Choose Potion</h3>
            <button
              onClick={() => setShowPotionModal(false)}
              class="w-6 h-6 flex items-center justify-center rounded-lg bg-[#222] text-[var(--color-parchment)] hover:bg-[#333] active:bg-[#444] transition-colors"
              title="Close"
            >
              ✕
            </button>
          </div>

          <div class="space-y-2 max-h-96 overflow-y-auto">
            {(() => {
              const potions = inventoryRef.current
                .filter(slot => slot && itemsData[slot.itemId]?.type === 'potion')
              if (potions.length === 0) {
                return (
                  <div class="text-center py-4 text-[var(--color-parchment)] opacity-50">
                    No potions in inventory
                  </div>
                )
              }
              return potions.map(slot => {
                const potion = itemsData[slot.itemId]
                return (
                  <button
                    key={slot.itemId}
                    onClick={() => handlePotion(slot.itemId)}
                    class="w-full p-3 rounded-lg border bg-[#1a2a1a] border-[#2a4a2a] active:bg-[#2a3a2a] transition-colors"
                  >
                    <div class="flex items-center justify-between">
                      <div class="text-left flex-1">
                        <div class="text-sm font-semibold text-[var(--color-parchment)]">{potion.icon} {potion.name}</div>
                        <div class="text-[10px] text-[var(--color-parchment)] opacity-60 mt-0.5">
                          {potion.effect === 'hp' && `+${potion.boost} HP`}
                          {potion.effect === 'attack' && `+${potion.boost} Attack`}
                          {potion.effect === 'strength' && `+${potion.boost} Strength`}
                          {potion.effect === 'defence' && `+${potion.boost} Defence`}
                          {potion.effect === 'ranged' && `+${potion.boost} Ranged`}
                          {potion.effect === 'magic' && `+${potion.boost} Magic`}
                          {potion.effect === 'combat' && `+${potion.boost} All Combat Skills`}
                          {potion.effect === 'super_restore' && `Restores stats`}
                        </div>
                        <div class="text-[9px] text-[var(--color-gold-dim)] mt-0.5">Duration: {potion.duration}s</div>
                      </div>
                      <div class="text-right flex-shrink-0 ml-2">
                        <div class="text-sm font-semibold text-[var(--color-parchment)]">×{slot.quantity}</div>
                      </div>
                    </div>
                  </button>
                )
              })
            })()}
          </div>
        </Modal>
      )}

      {/* Spell modal */}
      {showSpellModal && (
        <Modal onClose={() => setShowSpellModal(false)}>
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-[var(--font-display)] text-base font-bold text-[var(--color-gold)]">Select Spell</h3>
            <button
              onClick={() => setShowSpellModal(false)}
              class="w-6 h-6 flex items-center justify-center rounded-lg bg-[#222] text-[var(--color-parchment)] hover:bg-[#333] active:bg-[#444] transition-colors"
              title="Close"
            >
              ✕
            </button>
          </div>

          <div class="space-y-2 max-h-96 overflow-y-auto">
            {Object.values(spellsData).map(spell => {
              const magicLevel = getLevelFromXP(stats.magic?.xp || 0)
              const canCast = magicLevel >= spell.levelReq
              const isActive = activeCombatSpell?.id === spell.id
              return (
                <button
                  key={spell.id}
                  onClick={() => { if (canCast) { updateActiveCombatSpell({ id: spell.id, name: spell.name, baseDamage: spell.baseDamage }); addToast(`Spell changed to ${spell.name}`, 'info'); setShowSpellModal(false); } }}
                  disabled={!canCast}
                  class={`w-full p-3 rounded-lg border transition-colors ${
                    isActive
                      ? 'bg-[#1a2a3a] border-[#2a5a7a]'
                      : canCast
                        ? 'bg-[#1a1a2a] border-[#2a2a4a] active:bg-[#2a2a3a]'
                        : 'bg-[#111] border-[#1a1a1a] opacity-40'
                  }`}
                >
                  <div class="flex items-center justify-between">
                    <div class="text-left flex-1">
                      <div class="text-sm font-semibold text-[var(--color-parchment)]">🔮 {spell.name}</div>
                      <div class="text-[10px] text-[var(--color-parchment)] opacity-60 mt-0.5">
                        {spell.tier ? `${spell.tier.charAt(0).toUpperCase() + spell.tier.slice(1)} · ` : ''}Damage {spell.baseDamage}
                      </div>
                      <div class="text-[9px] text-[var(--color-gold-dim)] mt-0.5">Lv {spell.levelReq}</div>
                    </div>
                    {isActive && (
                      <span class="text-base text-[#a8d8ff]">✓</span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </Modal>
      )}

      {/* Equipment modal */}
      {showEquipmentModal && (
        <Modal onClose={() => setShowEquipmentModal(false)}>
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-[var(--font-display)] text-base font-bold text-[var(--color-gold)]">Swap Gear</h3>
            <button
              onClick={() => setShowEquipmentModal(false)}
              class="w-6 h-6 flex items-center justify-center rounded-lg bg-[#222] text-[var(--color-parchment)] hover:bg-[#333] active:bg-[#444] transition-colors"
              title="Close"
            >
              ✕
            </button>
          </div>

          <div class="max-h-96 overflow-y-auto">
            {(() => {
              const equipment_items = inventoryRef.current
                .filter(slot => slot && itemsData[slot.itemId]?.slot)

              if (equipment_items.length === 0) {
                return (
                  <div class="text-center py-4 text-[var(--color-parchment)] opacity-50">
                    No weapons or armour in inventory
                  </div>
                )
              }

              // Sort items by slot order so related gear clusters together
              // without needing visible section headers.
              const slotOrder = ['weapon', 'shield', 'head', 'body', 'legs', 'gloves', 'boots', 'cape', 'neck', 'ring', 'ammo']
              const slotRank = Object.fromEntries(slotOrder.map((s, i) => [s, i]))
              const sortedItems = [...equipment_items].sort((a, b) => {
                const sa = slotRank[itemsData[a.itemId].slot] ?? 99
                const sb = slotRank[itemsData[b.itemId].slot] ?? 99
                return sa - sb
              })

              return (
                <div class="grid grid-cols-4 gap-1.5">
                  {sortedItems.map(slot => {
                    const item = itemsData[slot.itemId]
                    const equipped = equipmentRef.current[item.slot]?.itemId === item.id
                    return (
                      <button
                        key={`${slot.itemId}-${inventoryRef.current.indexOf(slot)}`}
                        onClick={() => handleEquipItem(slot.itemId)}
                        class={`p-1.5 rounded-lg border transition-colors flex flex-col items-center ${
                          equipped
                            ? 'bg-[#2a3a2a] border-[#4a8a4a]'
                            : 'bg-[#1a2a1a] border-[#2a4a2a] active:bg-[#2a3a2a]'
                        }`}
                      >
                        <div class="text-lg leading-none">{item.icon}</div>
                        <div class="text-[8px] text-[var(--color-parchment)] font-semibold mt-0.5 line-clamp-2 text-center leading-tight">
                          {item.name}
                        </div>
                        {equipped && (
                          <span class="text-[10px] text-[var(--color-hp-green)] mt-0.5">✓</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        </Modal>
      )}

      {/* Loot Modal */}
      {lootModal && (
        <Modal title={lootModal.raidId ? '🏆 Raid Complete' : 'Loot'} onClose={() => setLootModal(null)}>
          <div class="space-y-4">
            {/* Header message */}
            <div class="text-center py-2">
              {lootModal.raidId ? (
                <>
                  <div class="text-4xl mb-2">🏆</div>
                  <div class="text-lg font-semibold text-[var(--color-gold)]">{raidsData[lootModal.raidId]?.name || 'Raid'} complete!</div>
                </>
              ) : (
                <>
                  <div class="text-4xl mb-2">{MONSTER_ICONS[lootModal.monster.id] || '👹'}</div>
                  <div class="text-lg font-semibold text-[var(--color-gold)]">{lootModal.monster.name} defeated!</div>
                </>
              )}
            </div>

            {/* Loot items */}
            {lootModal.loot && lootModal.loot.length > 0 ? (
              <div class="space-y-2 max-h-48 overflow-y-auto">
                {lootModal.loot.map((drop, idx) => {
                  const item = itemsData[drop.itemId]
                  const isHighValue = item && item.shopValue > 1000000
                  return (
                    <div key={idx} class={`rounded-lg p-3 flex items-center justify-between ${isHighValue ? 'bg-purple-900 bg-opacity-30 border border-purple-500' : 'bg-[#111]'}`}>
                      <div class="flex items-center gap-2">
                        <span class="text-2xl">{item?.icon || '📦'}</span>
                        <div>
                          <div class={`text-sm font-semibold ${isHighValue ? 'text-purple-300' : 'text-[var(--color-parchment)]'}`}>
                            {item?.name || drop.itemId}
                          </div>
                          <div class={`text-xs ${isHighValue ? 'text-purple-300 opacity-80' : 'text-[var(--color-parchment)] opacity-60'}`}>
                            ×{drop.quantity}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div class="text-center py-4 text-[var(--color-parchment)] opacity-60 text-sm">
                No loot dropped
              </div>
            )}

            {/* Action buttons */}
            <div class="grid grid-cols-2 gap-3 pt-2">
              <button
                onClick={() => {
                  setLootModal(null)
                  stopAndBack()
                }}
                style="background:#1a1a1a;border:1px solid #2a2a2a;color:#888"
                class="py-2.5 rounded-lg font-semibold text-sm active:opacity-80"
              >
                {lootModal.raidId ? 'Leave' : 'Run Away'}
              </button>
              <button
                onClick={() => {
                  if (lootModal.raidId) {
                    const raid = raidsData[lootModal.raidId]
                    if (raid) startRaid(raid)
                  } else {
                    const original = monstersData[lootModal.monster.id]
                    if (original) continueFight(original)
                  }
                  setLootModal(null)
                }}
                style="background:linear-gradient(135deg,#1a3a2a,#2a5a3a);border:1px solid rgba(100,200,120,0.35);color:#7de8a0"
                class="py-2.5 rounded-lg font-semibold text-sm active:opacity-80"
              >
                {lootModal.raidId ? 'Raid Again' : 'Fight Again'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Monster Info Modal */}
      {selectedMonsterInfo && (
        <Modal onClose={() => setSelectedMonsterInfo(null)}>
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-[var(--font-display)] text-base font-bold text-[var(--color-gold)]">
              {MONSTER_ICONS[selectedMonsterInfo.id] || '👹'} {selectedMonsterInfo.name}
            </h3>
            <button
              onClick={() => setSelectedMonsterInfo(null)}
              class="w-6 h-6 flex items-center justify-center rounded-lg bg-[#222] text-[var(--color-parchment)] hover:bg-[#333] active:bg-[#444] transition-colors"
              title="Close"
            >
              ✕
            </button>
          </div>

          <div class="space-y-4 max-h-96 overflow-y-auto">
            {/* Combat Stats */}
            <div>
              <h4 class="text-xs font-semibold text-[var(--color-gold-dim)] uppercase tracking-wider mb-2 opacity-70">Combat Stats</h4>
              <div class="bg-[#111] rounded-lg p-3 space-y-1">
                <div class="flex justify-between text-[11px] text-[var(--color-parchment)]">
                  <span>Combat Level</span>
                  <span class="font-[var(--font-mono)] text-[var(--color-gold)]">{selectedMonsterInfo.combatLevel}</span>
                </div>
                <div class="flex justify-between text-[11px] text-[var(--color-parchment)]">
                  <span>HP</span>
                  <span class="font-[var(--font-mono)] text-[var(--color-hp-green)]">{selectedMonsterInfo.hitpoints}</span>
                </div>
                <div class="flex justify-between text-[11px] text-[var(--color-parchment)]">
                  <span>Attack</span>
                  <span class="font-[var(--font-mono)]">{selectedMonsterInfo.stats.attack}</span>
                </div>
                <div class="flex justify-between text-[11px] text-[var(--color-parchment)]">
                  <span>Strength</span>
                  <span class="font-[var(--font-mono)]">{selectedMonsterInfo.stats.strength}</span>
                </div>
                <div class="flex justify-between text-[11px] text-[var(--color-parchment)]">
                  <span>Defence</span>
                  <span class="font-[var(--font-mono)]">{selectedMonsterInfo.stats.defence}</span>
                </div>
                <div class="flex justify-between text-[11px] text-[var(--color-parchment)]">
                  <span>Magic</span>
                  <span class="font-[var(--font-mono)]">{selectedMonsterInfo.stats.magic}</span>
                </div>
                <div class="flex justify-between text-[11px] text-[var(--color-parchment)]">
                  <span>Ranged</span>
                  <span class="font-[var(--font-mono)]">{selectedMonsterInfo.stats.ranged}</span>
                </div>
              </div>
            </div>

            {/* Defence Bonuses */}
            <div>
              <h4 class="text-xs font-semibold text-[var(--color-gold-dim)] uppercase tracking-wider mb-2 opacity-70">Defence Bonuses</h4>
              <div class="bg-[#111] rounded-lg p-3 space-y-1">
                <div class="flex justify-between text-[11px] text-[var(--color-parchment)]">
                  <span>Stab</span>
                  <span class={`font-[var(--font-mono)] ${selectedMonsterInfo.defenceBonus.stab >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {selectedMonsterInfo.defenceBonus.stab >= 0 ? '+' : ''}{selectedMonsterInfo.defenceBonus.stab}
                  </span>
                </div>
                <div class="flex justify-between text-[11px] text-[var(--color-parchment)]">
                  <span>Slash</span>
                  <span class={`font-[var(--font-mono)] ${selectedMonsterInfo.defenceBonus.slash >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {selectedMonsterInfo.defenceBonus.slash >= 0 ? '+' : ''}{selectedMonsterInfo.defenceBonus.slash}
                  </span>
                </div>
                <div class="flex justify-between text-[11px] text-[var(--color-parchment)]">
                  <span>Crush</span>
                  <span class={`font-[var(--font-mono)] ${selectedMonsterInfo.defenceBonus.crush >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {selectedMonsterInfo.defenceBonus.crush >= 0 ? '+' : ''}{selectedMonsterInfo.defenceBonus.crush}
                  </span>
                </div>
                <div class="flex justify-between text-[11px] text-[var(--color-parchment)]">
                  <span>Magic</span>
                  <span class={`font-[var(--font-mono)] ${selectedMonsterInfo.defenceBonus.magic >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {selectedMonsterInfo.defenceBonus.magic >= 0 ? '+' : ''}{selectedMonsterInfo.defenceBonus.magic}
                  </span>
                </div>
                <div class="flex justify-between text-[11px] text-[var(--color-parchment)]">
                  <span>Ranged</span>
                  <span class={`font-[var(--font-mono)] ${selectedMonsterInfo.defenceBonus.ranged >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {selectedMonsterInfo.defenceBonus.ranged >= 0 ? '+' : ''}{selectedMonsterInfo.defenceBonus.ranged}
                  </span>
                </div>
              </div>
            </div>

            {/* Drops */}
            {selectedMonsterInfo.drops && selectedMonsterInfo.drops.length > 0 && (
              <div>
                <h4 class="text-xs font-semibold text-[var(--color-gold-dim)] uppercase tracking-wider mb-2 opacity-70">Drops</h4>
                <div class="space-y-1">
                  {selectedMonsterInfo.drops.map(drop => {
                    const item = itemsData[drop.itemId]
                    const percentage = (drop.chance * 100).toFixed(1)
                    return (
                      <div key={drop.itemId} class="bg-[#111] rounded-lg p-2">
                        <div class="flex items-start justify-between gap-2">
                          <div class="text-left flex-1 min-w-0">
                            <div class="text-[11px] font-semibold text-[var(--color-parchment)]">
                              {item?.icon || '📦'} {item?.name || drop.itemId}
                            </div>
                            <div class="text-[9px] text-[var(--color-parchment)] opacity-60 mt-0.5">
                              {drop.chance === 1 ? 'Always' : `${percentage}%`}
                              {Array.isArray(drop.quantity) ? ` · ${drop.quantity[0]}–${drop.quantity[1]} ea` : ` · ${drop.quantity}`}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
