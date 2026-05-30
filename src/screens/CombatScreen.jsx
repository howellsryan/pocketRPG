import { Component } from 'preact'
import { useState, useEffect, useRef } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import { usePvp } from '../state/pvpState.jsx'
import PvpLobbyModal from './PvpLobbyModal.jsx'
import PvpCombatScreen from './PvpCombatScreen.jsx'
import Modal from '../components/Modal.jsx'
import HPBar from '../components/HPBar.jsx'
import IdleCombatSetupModal from '../components/IdleCombatSetupModal.jsx'
import EquipmentPaperdoll from '../components/EquipmentPaperdoll.jsx'
import ItemSlot from '../components/ItemSlot.jsx'
import { getPrayerStyleIcon } from '../utils/prayerIcons.js'
import { createCombatState, createRaidCombatState, processCombatTick, applyEat, applySpecialAttack } from '../engine/combat.js'
import { getLevelFromXP } from '../engine/experience.js'
import { getAgilityBankDelayMs, formatBankDelay } from '../engine/agility.js'
import { onTick, pauseTicks, resumeTicks } from '../engine/tick.js'
import { addItem, removeItem, freeSlots } from '../engine/inventory.js'
import { getCombatType, equipItem, checkEquipRequirements } from '../engine/equipment.js'
import { api, getToken, getCharacterId, getOneLifeMode } from '../cloud/api.js'
import { pullSave, applyCloudSave, requestCriticalPushSave, pushNow } from '../cloud/sync.js'
import { pvpApi } from '../cloud/pvp.js'
import { triggerOneLifeDeath } from '../utils/oneLifeDeath.js'
import monstersData from '../data/monsters.json'
import itemsData from '../data/items.json'
import prayersData from '../data/prayers.json'
import spellsData from '../data/spells.json'
import raidsData from '../data/raids.json'
import { SCREENS, formatDropChance } from '../utils/constants.js'
import { isHighValueDrop } from '../utils/itemValue.js'
import { getSlayerTaskXpForKill, resolveMonsterRewardData } from '../engine/slayerRewards.js'
import { resolveSlayerTaskKill, doesSlayerTaskMatchMonster, canFightSlayerMonster } from '../engine/slayerTasks.js'
import { getSlayerTaskReward } from '../engine/slayerRewards.js'
import { CRITICAL_SAVE_REASONS, hasCriticalDrop } from '../cloud/criticalSavePolicy.js'
import { recordCollectionLogDrop, applyServerCollectionLogEntries } from '../cloud/collectionLog.js'
import { filterLoggedDrops } from '../engine/collectionLog.js'

const COMBAT_CATEGORIES = [
  {
    key: 'training',
    label: 'Training',
    icon: '⚔️',
    ids: ['field_chicken', 'cave_goblin', 'pasture_bull', 'stoneback_crab', 'duneback_crab', 'arcane_adept', 'umbral_adept', 'broodfang_spider', 'highland_giant', 'briar_giant', 'lesser_fiend'],
  },
  {
    key: 'slayer',
    label: 'Slayer',
    icon: '💀',
    ids: [
      'dustpaw_rat', 'wailing_banshee', 'bogling_sprite', 'frostbite_imp', 'marshfen_toad', 'cinderpaw_cub',
      'glaive_skeleton', 'mirebound_husk', 'verdant_stalker', 'stoneglare_basilisk', 'embertongue_lizard',
      'hollow_reaver', 'briarheart_treant', 'frostmaw_direwolf', 'pyreclaw_demon', 'sanguine_veld',
      'wraithgale_specter', 'bloodmoon_stalker', 'warped_spectre', 'ironfang_drake', 'ash_wyrm',
      'astral_ranger', 'shadeglass_golem', 'astral_warrior', 'tidereaper_crab',
      'voidweave_stalker', 'hellbound_gorilla', 'bone_wyvern', 'drakthul_wyrmling',
      'runestone_gargoyle', 'bonelight_pyromancer', 'vicious_black_dragon', 'cinderfang_reaver',
      'ashen_marauder', 'marshscale_shaman', 'nether_wraith', 'sovrathar_the_ashen_sovereign',
      'astral_mage', 'nether_demon', 'cinder_devil', 'deepmaw_kraken', 'nightfang_beast',
      'threefang_cerberus', 'ashen_hydra',
    ],
  },
  {
    key: 'bossing',
    label: 'God Wars Dungeon',
    icon: '👑',
    ids: ['warlord_grondar', 'commander_zephyra', 'krylth_the_defiler', 'skyrender_kharra'],
  },
  {
    key: 'dagganoth_kings',
    label: 'Nagadoth Kings',
    icon: '👹',
    ids: ['nagadoth_rex', 'nagadoth_prime', 'nagadoth_supreme'],
  },
  {
    key: 'wilderness',
    label: 'Wilderness',
    icon: '🏴',
    ids: ['crazy_archaeologist'],
  },
  {
    key: 'dragons_lair',
    label: 'Dragons Lair',
    icon: '🐲',
    ids: ['green_dragon', 'red_dragon', 'king_black_dragon', 'adamant_dragon', 'rune_dragon'],
  },
  {
    key: 'venomcoil_matriarch',
    label: 'Venomcoil Matriarch',
    icon: '🐍',
    ids: ['venomcoil_matriarch'],
  },
  {
    key: 'fight_caves',
    label: 'Ember Pits',
    icon: '🔥',
    ids: ['ember_tyrant', 'ashen_crucible'],
  },
  {
    key: 'blighted_gauntlet',
    label: 'Blighted Gauntlet',
    icon: '⚡',
    ids: ['blighted_gauntlet'],
  },
  {
    key: 'sunken_crypts',
    label: 'Sunken Crypts',
    icon: '🪦',
    ids: ['gravehusk_brute', 'boneclaw_revenant', 'shroudwraith_specter'],
  },
  {
    key: 'ashveil_highlands',
    label: 'Ashveil Highlands',
    icon: '🌿',
    ids: ['stonegale_elemental', 'cindermaw_serpent', 'thornhide_colossus'],
  },
  {
    key: 'ironhold_fortress',
    label: 'Ironhold Fortress',
    icon: '⚒️',
    ids: ['ironclad_guardian', 'emberhowl_warlord'],
  },
  {
    key: 'verdant_wilds',
    label: 'Verdant Wilds',
    icon: '🌲',
    ids: ['gravethorn_drake', 'razorwing_harpy'],
  },
]

const MONSTER_ICONS = {
  field_chicken: '🐔', cave_goblin: '👺', pasture_bull: '🐄', broodfang_spider: '🕷️',
  stoneback_crab: '🦀', duneback_crab: '🦀', highland_giant: '👊', briar_giant: '🌿',
  arcane_adept: '🧙', umbral_adept: '🧙‍♂️', hellbound_gorilla: '🦍',
  wailing_banshee: '👻', sanguine_veld: '🩸', warped_spectre: '👁️', ash_wyrm: '🐍',
  astral_warrior: '⚔️', astral_ranger: '🏹', astral_mage: '🔮', runestone_gargoyle: '🗿',
  bone_wyvern: '🐲', cinder_devil: '💨', deepmaw_kraken: '🦑', nightfang_beast: '🦇',
  marshscale_shaman: '🦎', nether_wraith: '👻', nether_demon: '😈', vicious_black_dragon: '🐉',
  threefang_cerberus: '🐺', ashen_hydra: '🐲',
  dustpaw_rat: '🐀', bogling_sprite: '✨', frostbite_imp: '❄️', marshfen_toad: '🐸',
  cinderpaw_cub: '🐅', glaive_skeleton: '💀', mirebound_husk: '🪦', verdant_stalker: '🏹',
  stoneglare_basilisk: '🦎', embertongue_lizard: '🦎', hollow_reaver: '⚰️',
  briarheart_treant: '🌳', frostmaw_direwolf: '🐺', pyreclaw_demon: '👹',
  wraithgale_specter: '👻', bloodmoon_stalker: '🌙', ironfang_drake: '🐲',
  shadeglass_golem: '🗿', tidereaper_crab: '🦀',
  voidweave_stalker: '🕸️', drakthul_wyrmling: '🐉', bonelight_pyromancer: '🔥',
  cinderfang_reaver: '🗡️', ashen_marauder: '⚒️', sovrathar_the_ashen_sovereign: '👑',
  green_dragon: '🐉', red_dragon: '🔴', adamant_dragon: '⚔️', rune_dragon: '🛡️', lesser_fiend: '👿',
  warlord_grondar: '👹', commander_zephyra: '🌟', krylth_the_defiler: '🔥', skyrender_kharra: '🦅',
  nagadoth_rex: '🦖', nagadoth_prime: '👹', nagadoth_supreme: '🏹',
  crazy_archaeologist: '📜', king_black_dragon: '👑', venomcoil_matriarch: '🐍', ember_tyrant: '🌋', ashen_crucible: '🌋', blighted_gauntlet: '⚡',
  tekton: '🔨', vespula: '🦟', muttadile: '🦷', the_great_olm: '🏛️',
  the_maiden_of_sugadinti: '🩸', pestilent_bloat: '🤢', nylocas_vasilias: '🕷️',
  sotetseg: '🔮', xarpus: '☠️', verzik_vitur: '👑',
  gravehusk_brute: '💀', boneclaw_revenant: '🦴', shroudwraith_specter: '👻',
  stonegale_elemental: '🪨', cindermaw_serpent: '🐍', thornhide_colossus: '🌳',
  ironclad_guardian: '⚙️', emberhowl_warlord: '🪓',
  gravethorn_drake: '🦎', razorwing_harpy: '🦅'
}

class PvpCombatErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, message: '' }
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, message: '' })
    }
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      message: error?.message || String(error || 'Unknown PvP render error'),
    }
  }

  componentDidCatch(error, info) {
    console.error('[PocketRPG][PvP] combat screen render failed', error, info)
    this.props.onCrash?.(error, info)
  }

  reset = () => {
    this.setState({ hasError: false, message: '' })
  }

  render(props, state) {
    if (state.hasError) {
      if (typeof props.fallback === 'function') {
        return props.fallback({ reset: this.reset, message: state.message })
      }
      return null
    }
    return props.children
  }
}

export default function CombatScreen({ onNavigate, initialMonsterId, initialRaidId, onCombatStatusChange }) {
  const { stats, inventory, bank, equipment, currentHP, updateHP, updateInventory, updateBank, updateEquipment, grantXP, getMaxHP, addToast, combatStance, updateCombatStance, idleCombatSetup, updateIdleCombatSetup, homeShortcuts, updateHomeShortcuts, setActiveTask, slayerTask, setSlayerTask, awardSlayerPoints, slayerTasksCompleted, setSlayerTasksCompleted, activeCombatSpell, updateActiveCombatSpell, bossKillCounts, updateBossKillCounts, raidKillCounts, updateRaidKillCounts, unlockedFeatures, completedQuests, isOneLife, isIronman, getSnapshot, loadGame } = useGame()
  const pvp = usePvp()
  const [showPvpLobby, setShowPvpLobby] = useState(false)

  const [combat, setCombat] = useState(null)
  const [log, setLog] = useState([])
  const [killCount, setKillCount] = useState(0)
  const [fightStartedAt, setFightStartedAt] = useState(null)
  const [isAutoRestarting, setIsAutoRestarting] = useState(false)
  const [showPrayerModal, setShowPrayerModal] = useState(false)
  const [showPotionModal, setShowPotionModal] = useState(false)
  const [idleSetupMode, setIdleSetupMode] = useState(null) // 'food' | 'potion' | 'prayer' | null
  const [showEquipmentModal, setShowEquipmentModal] = useState(false)
  const [showSpellModal, setShowSpellModal] = useState(false)
  const [selectedMonsterInfo, setSelectedMonsterInfo] = useState(null)
  const [selectedRaidInfo, setSelectedRaidInfo] = useState(null)
  const [collapsedSections, setCollapsedSections] = useState(() => ({
    raids: true,
    ...Object.fromEntries(COMBAT_CATEGORIES.map(category => [category.key, true])),
  }))
  const [lootModal, setLootModal] = useState(null)
  const [isDesktopCombatLayout, setIsDesktopCombatLayout] = useState(false)

  const combatRef = useRef(null)
  const hpRef = useRef(currentHP)
  const hasAutoStarted = useRef(false)
  const inventoryRef = useRef(inventory)
  const bankRef = useRef(bank)
  const statsRef = useRef(stats)
  const equipmentRef = useRef(equipment)
  const slayerTaskRef = useRef(slayerTask)
  const pvpCrashHandledRef = useRef(false)
  const oneLifeModeRef = useRef(isOneLife || getOneLifeMode())
  const bossKillCountsRef = useRef(bossKillCounts)
  const raidKillCountsRef = useRef(raidKillCounts)
  const unlockedFeaturesRef = useRef(unlockedFeatures)
  const logRef = useRef(null)

  useEffect(() => {
    if (pvp.phase === 'in_match' && combat?.active) {
      setCombat(null)
    }
  }, [pvp.phase])

  useEffect(() => {
    let cancelled = false

    const reconnectToActiveMatch = async () => {
      if (pvp.phase === 'in_match') return
      if (!pvp.canAutoReconnect) return
      try {
        const invitesRes = await pvpApi.listInvitations()
        const activeMatchId = Number(invitesRes?.active_match_id)
        if (cancelled || !Number.isFinite(activeMatchId) || activeMatchId <= 0) return
        setShowPvpLobby(false)
        pauseTicks()
        pvp.enterMatch(activeMatchId)
      } catch {
        // best-effort reconnect check
      }
    }

    reconnectToActiveMatch()
    const onVisible = () => {
      if (!document.hidden) reconnectToActiveMatch()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [pvp.phase, pvp.enterMatch, pvp.canAutoReconnect])

  useEffect(() => { hpRef.current = currentHP }, [currentHP])
  useEffect(() => { inventoryRef.current = inventory }, [inventory])
  useEffect(() => { bankRef.current = bank }, [bank])
  useEffect(() => { statsRef.current = stats }, [stats])
  useEffect(() => { equipmentRef.current = equipment }, [equipment])
  useEffect(() => { slayerTaskRef.current = slayerTask }, [slayerTask])
  useEffect(() => { oneLifeModeRef.current = isOneLife || getOneLifeMode() }, [isOneLife])
  useEffect(() => { bossKillCountsRef.current = bossKillCounts }, [bossKillCounts])
  useEffect(() => { raidKillCountsRef.current = raidKillCounts }, [raidKillCounts])
  useEffect(() => { unlockedFeaturesRef.current = unlockedFeatures }, [unlockedFeatures])

  useEffect(() => {
    const updateDesktopLayout = () => {
      const width = Number(window.innerWidth) || 0
      const height = Number(window.innerHeight) || 0
      setIsDesktopCombatLayout(width >= 1250 && height >= 600)
    }

    updateDesktopLayout()
    window.addEventListener('resize', updateDesktopLayout)
    window.addEventListener('orientationchange', updateDesktopLayout)
    return () => {
      window.removeEventListener('resize', updateDesktopLayout)
      window.removeEventListener('orientationchange', updateDesktopLayout)
    }
  }, [])

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

  // Update combat status in parent
  useEffect(() => {
    const isActive = combat?.active === true
    onCombatStatusChange?.(isActive)
  }, [combat?.active, onCombatStatusChange])

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

      const { combatState, events } = processCombatTick(state, playerStats, equipmentRef.current, itemsData, prayersData, inventoryRef.current, slayerTaskRef.current)

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
            smash: ev.defenceReducedBy > 0 ? `🔨 Smash (-${ev.defenceReducedBy} Defence)` : '🔨 Smash',
            lightning: '⚡ Saradomin\'s Lightning',
            snapshot: '🏹🏹 Snapshot',
            pebble_shot: '🎯 Pebble Shot',
            shove: '🗡️ Shove (staggered!)',
            toxic_siphon: `🎋 Toxic Siphon (+${ev.healAmount || 0} HP)`,
            slice_and_dice: '🦀🦀🦀🦀 Slice and Dice',
            lunge: '🔰 The Block',
            triple_hit: '🪨🪨🪨 Quake',
            descent_of_darkness: '🏹🏹 Descent of Darkness',
            soul_leech: `🩸 Soul Leech (+${ev.healAmount || 0} HP)`,
            gale_shot: ev.stunned ? '💨 Gale Shot (staggered!)' : '💨 Gale Shot',
            molten_crush: ev.defenceReducedBy > 0 ? `🌋 Molten Crush (-${ev.defenceReducedBy} Defence)` : '🌋 Molten Crush',
            volley: '🌿🌿🌿 Volley'
          }
          const label = specLabels[ev.specType] || '⚡ Special Attack'
          setLog(prev => [...prev.slice(-20), {
            text: `${label}: ${hitsStr} (total ${ev.totalDamage})`,
            type: 'special',
            time: Date.now()
          }])
          if ((ev.specType === 'healing_blade' || ev.specType === 'toxic_siphon' || ev.specType === 'soul_leech') && ev.healAmount > 0) {
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
            setActiveTask(null)
            if (oneLifeModeRef.current) {
              void triggerOneLifeDeath(addToast)
            } else {
              addToast('You died!', 'error')
              updateHP(getMaxHP())
              hpRef.current = getMaxHP()
            }
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
            setActiveTask(null)
            if (oneLifeModeRef.current) {
              void triggerOneLifeDeath(addToast)
            } else {
              addToast('Incinerated by dragonfire!', 'error')
              updateHP(getMaxHP())
              hpRef.current = getMaxHP()
            }
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
          if (ammo) {
            const currentQty = Number.isFinite(Number(ammo.quantity)) ? Number(ammo.quantity) : 1
            const newQty = Math.max(0, currentQty - (ev.qty || 1))
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
        if (ev.type === 'noAmmo') {
          const weaponName = ev.weaponName || itemsData[ev.weaponId]?.name || 'Weapon'
          const required = ev.requiredAmmoName || ev.requiredAmmoKind || 'compatible ammo'
          setLog(prev => [...prev.slice(-20), {
            text: `${weaponName} requires ${required} to fire.`,
            type: 'miss',
            time: Date.now()
          }])
        }
        if (ev.type === 'noCharges') {
          const item = itemsData[ev.itemId]
          const chargeItemId = item?.chargeItemId || 'zulrah_scales'
          const chargeItemName = itemsData[chargeItemId]?.name || chargeItemId
          setLog(prev => [...prev.slice(-20), {
            text: `${item?.name || 'Weapon'} has no charges — use ${chargeItemName} to charge it!`,
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
          const phaseChangeMonsters = ['the_great_olm', 'venomcoil_matriarch', 'ember_tyrant', 'ashen_crucible', 'hellbound_gorilla', 'the_maiden_of_sugadinti', 'pestilent_bloat', 'nylocas_vasilias', 'sotetseg', 'xarpus', 'verzik_vitur', 'vespula', 'muttadile']
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
          const cloudAuthoritativeRaid = Boolean(ev.raidId && getToken() && getCharacterId())
          setLog(prev => [...prev.slice(-20), {
            text: `🏆 Raid complete!`,
            type: 'raid',
            time: Date.now()
          }])
          addToast('🏆 Raid complete! Check your loot!', 'levelup')
          // Track raid KC
          if (ev.raidId && state.raid) {
            const raidId = ev.raidId
            const newKC = (raidKillCountsRef.current[raidId] || 0) + 1
            const updatedCounts = { ...raidKillCountsRef.current, [raidId]: newKC }
            raidKillCountsRef.current = updatedCounts
            updateRaidKillCounts(updatedCounts)
            const raidName = ev.raidName || state.raid?.name || raidId
            setLog(prev => [...prev.slice(-20), {
              text: `👑 ${raidName} KC: ${newKC.toLocaleString()}`,
              type: 'victory',
              time: Date.now()
            }])
          }
          if (!cloudAuthoritativeRaid && ev.raidId && Array.isArray(ev.loot)) {
            for (const itemId of filterLoggedDrops(ev.loot, 'raids', ev.raidId)) {
              recordCollectionLogDrop({ itemId, sourceType: 'raids', sourceId: ev.raidId })
            }
          }
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
        if (ev.type === 'guthanHeal') {
          // Heal the player from Guthan set bonus
          const maxHP = getMaxHP()
          const newHP = Math.min(hpRef.current + ev.healAmount, maxHP)
          updateHP(newHP)
          hpRef.current = newHP
          setLog(prev => [...prev.slice(-20), {
            text: `💚 Gorath's Blessing heals ${ev.healAmount} HP`,
            type: 'heal',
            time: Date.now()
          }])
        }
        if (ev.type === 'boltProc') {
          const labels = {
            blood_forfeit: '🩸 Blood Forfeit',
            armour_piercing: '💠 Armour Piercing',
            dragons_breath: '🔥 Dragon\'s Breath',
            life_leech: '🖤 Life Leech'
          }
          const label = labels[ev.procType] || '⚡ Bolt Proc'
          if (ev.blocked) {
            setLog(prev => [...prev.slice(-20), {
              text: `${label} blocked by ${ev.monsterName || 'target'}!`,
              type: 'miss',
              time: Date.now()
            }])
          } else {
            setLog(prev => [...prev.slice(-20), {
              text: `${label}: ${ev.damage} dmg${ev.healAmount ? ` (+${ev.healAmount} HP)` : ''}${ev.selfDamage ? ` (−${ev.selfDamage} HP)` : ''}`,
              type: 'special',
              time: Date.now()
            }])
            if (ev.healAmount > 0) {
              const maxHP = getMaxHP()
              const newHP = Math.min(hpRef.current + ev.healAmount, maxHP)
              updateHP(newHP)
              hpRef.current = newHP
            }
            if (ev.selfDamage > 0) {
              const newHP = Math.max(1, hpRef.current - ev.selfDamage)
              updateHP(newHP)
              hpRef.current = newHP
            }
          }
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
          const defeatedMonster = ev.monster || state.monster
          const defeatedMonsterData = resolveMonsterRewardData(defeatedMonster, state.monster, monstersData)
          const defeatedMonsterId = defeatedMonsterData?.id || defeatedMonster?.id
          const defeatedMonsterName = defeatedMonsterData?.name || defeatedMonster?.name || state.monster?.name || 'Monster'
          const isDefeatedBoss = defeatedMonsterData?.boss === true || defeatedMonster?.boss === true
          const killLoot = Array.isArray(ev.loot) ? ev.loot : []
          const raidId = state.raid?.raidId || null
          const cloudAuthoritativeRaid = Boolean(raidId && getToken() && getCharacterId())
          const cloudAuthoritativeMonster = Boolean(!raidId && defeatedMonsterId && getToken() && getCharacterId())
          const cloudAuthoritativeCompletion = cloudAuthoritativeRaid || cloudAuthoritativeMonster
          let slayerXpGained = 0
          setKillCount(k => k + 1)
          if (!cloudAuthoritativeCompletion) {
            requestCriticalPushSave(() => getSnapshot(), CRITICAL_SAVE_REASONS.MONSTER_KILL)
          }

          // Boss kill count tracking
          if (!cloudAuthoritativeCompletion && isDefeatedBoss && defeatedMonsterId) {
            const skipBossKcLog = ev.fromRaidCompletion === true
            const newKC = (bossKillCountsRef.current[defeatedMonsterId] || 0) + 1
            const updatedCounts = { ...bossKillCountsRef.current, [defeatedMonsterId]: newKC }
            bossKillCountsRef.current = updatedCounts
            updateBossKillCounts(updatedCounts)
            if (!skipBossKcLog) {
              setLog(prev => [...prev.slice(-20), {
                text: `👑 ${defeatedMonsterName} KC: ${newKC.toLocaleString()}`,
                type: 'victory',
                time: Date.now()
              }])
            }
          }

          // Slayer task tracking
          const task = slayerTaskRef.current
          if (task && defeatedMonsterId && doesSlayerTaskMatchMonster(task.monsterId, defeatedMonsterId)) {
            // Active combat does not flow through the idle-engine slayer XP handler.
            // Grant XP on the live kill event so active and idle kills stay consistent.
            const xpForKill = getSlayerTaskXpForKill(defeatedMonster, state.monster, monstersData)
            slayerXpGained += xpForKill
            if (xpForKill > 0) {
              grantXP('slayer', xpForKill)
              setLog(prev => [...prev.slice(-20), {
                text: `💀 Slayer XP +${xpForKill.toLocaleString()}`,
                type: 'xp',
                time: Date.now()
              }])
            }
            const slayerResult = resolveSlayerTaskKill(task, defeatedMonsterId, 1)
            if (slayerResult.completed) {
              slayerTaskRef.current = null
              setSlayerTask(null)
              const reward = getSlayerTaskReward(slayerResult.pointsAwarded, slayerTasksCompleted)
              setSlayerTasksCompleted(reward.totalTasks)
              if (reward.pointsEarned > 0) {
                awardSlayerPoints(reward.pointsEarned)
              }
              requestCriticalPushSave(() => getSnapshot(), CRITICAL_SAVE_REASONS.SLAYER_TASK_COMPLETE)
              addToast(`💀 Slayer Task #${reward.totalTasks} Completed - ${reward.pointsEarned.toLocaleString()} points.`, 'levelup')
            } else if (slayerResult.onTask) {
              slayerTaskRef.current = slayerResult.task
              setSlayerTask(slayerResult.task)
              requestCriticalPushSave(() => getSnapshot(), CRITICAL_SAVE_REASONS.SLAYER_TASK_CHANGE)
            }
          }

          if (cloudAuthoritativeRaid) {
            setLootModal({
              monster: defeatedMonsterData,
              loot: [],
              slayerXpGained,
              isBossKill: isDefeatedBoss,
              raidId,
              loading: true
            })
            void api.completeRaid(raidId, {
              actionNonce: `raid:${raidId}:${Date.now()}`,
            }).then(async (res) => {
              const granted = Array.isArray(res?.granted) ? res.granted : []
              if (granted.length > 0) {
                const newInv = [...inventoryRef.current]
                const newBank = { ...(bankRef.current || {}) }
                for (const reward of granted) {
                  const itemId = reward?.itemId
                  const quantity = Math.floor(Number(reward?.quantity) || 0)
                  if (!itemId || quantity < 1) continue
                  const item = itemsData[itemId]
                  if (reward?.destination === 'bank') {
                    const existing = newBank[itemId]
                    const existingQty = Math.floor(Number(existing?.quantity ?? existing) || 0)
                    newBank[itemId] = { itemId, quantity: existingQty + quantity }
                  } else {
                    addItem(newInv, itemId, quantity, item?.stackable || false)
                  }
                }
                updateInventory(newInv)
                inventoryRef.current = newInv
                updateBank(newBank)
                bankRef.current = newBank
              }
              applyServerCollectionLogEntries(res?.collectionLogEntries || [])
              const serverRaidKc = res?.killCount
              if (serverRaidKc?.sourceType === 'raids' && typeof serverRaidKc.killCount === 'number') {
                const updated = { ...raidKillCountsRef.current, [serverRaidKc.sourceId]: serverRaidKc.killCount }
                raidKillCountsRef.current = updated
                updateRaidKillCounts(updated)
              }
              if (res?.save?.save_data) {
                await applyCloudSave(JSON.parse(res.save.save_data), res.save.updatedAt)
              }
              setLootModal({
                monster: defeatedMonsterData,
                loot: granted.map(reward => ({ itemId: reward.itemId, quantity: reward.quantity })),
                slayerXpGained,
                isBossKill: isDefeatedBoss,
                raidId,
                loading: false
              })
            }).catch((err) => {
              setLootModal(null)
              addToast(`Raid claim failed: ${err?.message || 'server_error'}`, 'error')
            })
          } else if (cloudAuthoritativeMonster) {
            setLootModal({
              monster: defeatedMonsterData,
              loot: [],
              slayerXpGained,
              isBossKill: isDefeatedBoss,
              raidId,
              loading: true
            })
            void (async () => {
              // Flush current inventory to server before completing the monster so
              // the server sees consumed food/potions and can correctly route drops
              // to inventory (not bank) when space is available.
              try { await pushNow(getSnapshot()) } catch { /* non-fatal; server falls back to last saved state */ }
              return api.completeMonster(defeatedMonsterId, {
                actionNonce: `monster:${defeatedMonsterId}:${Date.now()}`,
              })
            })().then(async (res) => {
              const granted = Array.isArray(res?.granted) ? res.granted : []
              if (granted.length > 0) {
                const newInv = [...inventoryRef.current]
                const newBank = { ...(bankRef.current || {}) }
                for (const reward of granted) {
                  const itemId = reward?.itemId
                  const quantity = Math.floor(Number(reward?.quantity) || 0)
                  if (!itemId || quantity < 1) continue
                  const item = itemsData[itemId]
                  if (reward?.destination === 'bank') {
                    const existing = newBank[itemId]
                    const existingQty = Math.floor(Number(existing?.quantity ?? existing) || 0)
                    newBank[itemId] = { itemId, quantity: existingQty + quantity }
                  } else {
                    addItem(newInv, itemId, quantity, item?.stackable || false)
                  }
                }
                updateInventory(newInv)
                inventoryRef.current = newInv
                updateBank(newBank)
                bankRef.current = newBank
              }
              applyServerCollectionLogEntries(res?.collectionLogEntries || [])
              const serverBossKc = res?.killCount
              if (serverBossKc?.sourceType === 'monsters' && typeof serverBossKc.killCount === 'number') {
                const updated = { ...bossKillCountsRef.current, [serverBossKc.sourceId]: serverBossKc.killCount }
                bossKillCountsRef.current = updated
                updateBossKillCounts(updated)
              }
              if (res?.save?.save_data) {
                await applyCloudSave(JSON.parse(res.save.save_data), res.save.updatedAt)
              }
              setLootModal({
                monster: defeatedMonsterData,
                loot: granted.map(reward => ({ itemId: reward.itemId, quantity: reward.quantity })),
                slayerXpGained,
                isBossKill: isDefeatedBoss,
                raidId,
                loading: false
              })
            }).catch((err) => {
              setLootModal(null)
              addToast(`Monster claim failed: ${err?.message || 'server_error'}`, 'error')
            })
          } else if (killLoot.length > 0) {
            const newInv = [...inventoryRef.current]
            for (const drop of killLoot) {
                const item = itemsData[drop.itemId]
                if (drop.noted) {
                  const existingIdx = newInv.findIndex(s => s && s.itemId === drop.itemId && s.noted)
                  if (existingIdx !== -1) newInv[existingIdx] = { ...newInv[existingIdx], quantity: newInv[existingIdx].quantity + drop.quantity }
                  else {
                    const empty = newInv.indexOf(null)
                    if (empty !== -1) newInv[empty] = { itemId: drop.itemId, quantity: drop.quantity, noted: true }
                  }
                } else {
                  addItem(newInv, drop.itemId, drop.quantity, item?.stackable || false)
                }
              }
              updateInventory(newInv)
            }

          if (hasCriticalDrop(killLoot, defeatedMonsterData, itemsData)) {
            requestCriticalPushSave(() => getSnapshot(), CRITICAL_SAVE_REASONS.RARE_DROP)
          }
          if (defeatedMonsterId && killLoot.length > 0) {
            for (const itemId of filterLoggedDrops(killLoot, 'monsters', defeatedMonsterId)) {
              recordCollectionLogDrop({ itemId, sourceType: 'monsters', sourceId: defeatedMonsterId })
            }
          }
          if (ev.fromRaidCompletion !== true) {
            setLog(prev => [...prev.slice(-20), {
              text: `${defeatedMonsterName} defeated!`,
              type: 'victory',
              time: Date.now()
            }])
          }
          // Show loot modal instead of auto-restarting
          if (!cloudAuthoritativeRaid && !cloudAuthoritativeMonster) {
            setLootModal({
              monster: defeatedMonsterData,
              loot: killLoot,
              slayerXpGained,
              isBossKill: isDefeatedBoss,
              raidId,
              loading: false
            })
          }
        }
      }

    })

    return unsub
  }, [combat?.active])

  const getSlayerLevel = () => getLevelFromXP(stats.slayer?.xp || 0)
  const toggleSection = (sectionKey) => {
    setCollapsedSections(prev => ({ ...prev, [sectionKey]: !prev[sectionKey] }))
  }

  const checkBossRequirements = (monster) => {
    const slayLvl = getSlayerLevel()
    if (monster.slayerRequirement && slayLvl < monster.slayerRequirement) {
      return { locked: true, reason: `Need Slayer level ${monster.slayerRequirement} to fight ${monster.name}` }
    }
    if (!canFightSlayerMonster(monster, slayerTask)) {
      return { locked: true, reason: `${monster.name} can only be slain on an active Slayer task` }
    }
    if (monster.id === 'blighted_gauntlet' && !completedQuests.has('song_of_the_elves')) {
      return { locked: true, reason: 'Complete Song of the Elves to fight Blighted Gauntlet' }
    }
    if (monster.id === 'ashen_crucible' && (!bossKillCounts['ember_tyrant'] || bossKillCounts['ember_tyrant'] < 1)) {
      return { locked: true, reason: 'Defeat Ember Tyrant first to unlock Ashen Crucible' }
    }
    if ((monster.id === 'adamant_dragon' || monster.id === 'rune_dragon') && !completedQuests.has('dragon_slayer_ii')) {
      return { locked: true, reason: 'Complete Dragon Slayer II to fight Metal Dragons' }
    }
    if (monster.id === 'hellbound_gorilla' && !completedQuests.has('monkey_madness_ii')) {
      return { locked: true, reason: 'Complete Monkey Madness II to fight Hellbound Gorilla' }
    }
    return { locked: false }
  }

  const checkRaidRequirements = (raid) => {
    if (raid.id === 'theatre_of_blood' && !completedQuests.has('a_night_at_the_theatre')) {
      return { locked: true, reason: 'Complete A Night at the Theatre to access Crimson Night Theatre' }
    }
    return { locked: false }
  }

  const startFight = (monster) => {
    const req = checkBossRequirements(monster)
    if (req.locked) {
      addToast(req.reason, 'error')
      return
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
    const req = checkRaidRequirements(raidData)
    if (req.locked) {
      addToast(req.reason, 'error')
      return
    }
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
    consumeFoodAt(foodIdx, newInv)
  }

  const handleEatItem = (itemId) => {
    const food = itemsData[itemId]
    if (!food || food.type !== 'food') return
    const newInv = [...inventoryRef.current]
    const foodIdx = newInv.findIndex(s => s && s.itemId === itemId)
    if (foodIdx === -1) return
    consumeFoodAt(foodIdx, newInv)
  }

  // Shared eat path used by both the Eat button and direct inventory clicks.
  // Mirrors the original handleEat: decrement inventory, heal up to max,
  // applyEat() to bind the post-eat tick delay, and append the heal log line.
  const consumeFoodAt = (foodIdx, newInv) => {
    const food = itemsData[newInv[foodIdx].itemId]
    if (!food) return
    if (newInv[foodIdx].quantity > 1) {
      newInv[foodIdx] = { ...newInv[foodIdx], quantity: newInv[foodIdx].quantity - 1 }
    } else {
      newInv[foodIdx] = null
    }
    updateInventory(newInv)
    inventoryRef.current = newInv
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
      const chargeItemId = weapon.chargeItemId || 'zulrah_scales'
      const chargeItemName = itemsData[chargeItemId]?.name || chargeItemId
      addToast(`No charges — use ${chargeItemName} to charge this weapon.`, 'error')
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

    // Combat gear tab must enforce the same level/quest gates as the inventory
    // screen — otherwise the player can swap into mid-combat gear they haven't
    // unlocked (e.g. a Dragon scimitar at Attack 1).
    const reqError = checkEquipRequirements(itemData, statsRef.current, completedQuests)
    if (reqError) {
      if (reqError.reason === 'quest') {
        addToast(`Complete quest to equip: ${reqError.questUnlock.replace(/_/g, ' ')}`, 'error')
      } else {
        addToast(`Need ${reqError.skill} level ${reqError.required} to equip`, 'error')
      }
      return
    }

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

  const handleUnequipSlot = (slotName) => {
    const entry = equipmentRef.current?.[slotName]
    if (!entry) return

    const newInv = [...inventoryRef.current]
    const emptyIdx = newInv.indexOf(null)
    if (emptyIdx === -1) {
      addToast('Inventory full', 'error')
      return
    }

    const invEntry = { itemId: entry.itemId, quantity: entry.quantity || 1 }
    if (entry.charges && entry.charges > 0) invEntry.charges = entry.charges
    newInv[emptyIdx] = invEntry

    const newEq = { ...equipmentRef.current, [slotName]: null }

    updateInventory(newInv)
    inventoryRef.current = newInv
    updateEquipment(newEq)
    equipmentRef.current = newEq

    const itemName = itemsData[entry.itemId]?.name || entry.itemId
    addToast(`Unequipped ${itemName}`, 'info')
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
  const finalizePvpExit = async () => {
    pvpCrashHandledRef.current = false
    pvp.leaveMatch()
    try {
      const pulled = await pullSave()
      if (pulled?.payload) {
        await applyCloudSave(pulled.payload, pulled.updatedAt)
      }
      await loadGame()
    } catch (err) {
      console.warn('[PocketRPG] PvP post-match cloud pull failed:', err?.message || err)
    }
    resumeTicks()
    setShowPvpLobby(false)
  }

  const handleRecoveryForfeit = async (reset) => {
    try {
      await pvpApi.forfeitMatch(pvp.activeMatchId)
      addToast('Forfeit queued. Resolving...', 'info')
      pvpCrashHandledRef.current = false
      reset()
    } catch (err) {
      const code = err?.body?.error || err?.message
      if (code === 'match_not_found' || code === 'match_not_active') {
        try {
          const invites = await pvpApi.listInvitations()
          const activeMatchId = Number(invites?.active_match_id)
          if (!Number.isFinite(activeMatchId) || activeMatchId <= 0) {
            addToast('Match already ended.', 'info')
            await finalizePvpExit()
            return
          }
        } catch {
          // fall through to generic error toast
        }
      }
      addToast(err.body?.error || err.message, 'error')
    }
  }

  if (pvp.phase === 'in_match' && pvp.activeMatchId) {
    return (
      <PvpCombatErrorBoundary
        resetKey={pvp.activeMatchId}
        onCrash={async (error) => {
          if (pvpCrashHandledRef.current) return
          pvpCrashHandledRef.current = true
          console.error('[PocketRPG][PvP] Match view crashed; keeping recovery mode active:', error?.message || error)
          addToast('PvP match view failed. Use retry or forfeit.', 'error')
        }}
        fallback={({ reset, message }) => (
          <div className="p-3">
            <Card className="border-[var(--color-blood)] bg-[#2a1010]">
              <div class="text-sm font-bold text-[var(--color-blood-light)]">PvP match view failed to render</div>
              <div class="text-[11px] text-[var(--color-parchment)] opacity-70 mt-1">
                The server still has you in an active PvP match. Do not return to PvE.
              </div>
              {message && (
                <p className="text-xs text-red-200 break-words mt-2">
                  {message}
                </p>
              )}
              <div class="flex gap-2 mt-3">
                <Button
                  variant="primary"
                  onClick={() => {
                    pvpCrashHandledRef.current = false
                    reset()
                  }}
                >
                  Retry PvP screen
                </Button>
                <Button
                  variant="danger"
                  onClick={() => handleRecoveryForfeit(reset)}
                >
                  Forfeit
                </Button>
              </div>
            </Card>
          </div>
        )}
      >
        <PvpCombatScreen
          matchId={pvp.activeMatchId}
          addToast={addToast}
          onExit={finalizePvpExit}
        />
      </PvpCombatErrorBoundary>
    )
  }

  // Monster picker
  if (!combat) {
    return (
      <>
      <div class="h-full overflow-y-auto p-4">
        <h2 class="font-[var(--font-display)] text-sm font-bold text-[var(--color-parchment)] opacity-60 uppercase tracking-wider mb-3">
          Choose a Monster
        </h2>

        {/* Idle setup buttons */}
        <div class="flex gap-1.5 mb-2">
          <button
            onClick={() => setIdleSetupMode('food')}
            class="flex-1 py-1.5 rounded-lg text-[10px] font-semibold bg-[#1a1a1a] text-[var(--color-parchment)] active:bg-[#2a2a2a]"
            title="Configure food the simulator can use during idle/skip combat"
          >
            🍖 Idle Eat
            {idleCombatSetup?.food?.length > 0 && (
              <span class="ml-1 text-[var(--color-gold)]">✓</span>
            )}
          </button>
          <button
            onClick={() => setIdleSetupMode('prayer')}
            class="flex-1 py-1.5 rounded-lg text-[10px] font-semibold bg-[#1a1a1a] text-[var(--color-parchment)] active:bg-[#2a2a2a]"
            title="Configure prayers the simulator should use during idle/skip combat"
          >
            🙏 Idle Pray
            {(idleCombatSetup?.prayers?.protectionPrayerId || idleCombatSetup?.prayers?.combatPrayerId) && (
              <span class="ml-1 text-[var(--color-gold)]">✓</span>
            )}
          </button>
          <button
            onClick={() => setIdleSetupMode('potion')}
            class="flex-1 py-1.5 rounded-lg text-[10px] font-semibold bg-[#1a1a1a] text-[var(--color-parchment)] active:bg-[#2a2a2a]"
            title="Configure potions the simulator can drink during idle/skip combat"
          >
            🧪 Idle Potion
            {idleCombatSetup?.potions?.length > 0 && (
              <span class="ml-1 text-[var(--color-gold)]">✓</span>
            )}
          </button>
        </div>

        {/* Stance selector */}
        <div class="flex gap-1.5 mb-3">
          {['accurate', 'aggressive', 'defensive'].map(s => (
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
              .sort((a, b) => {
                if (category.key === 'slayer') {
                  return (a.slayerRequirement || 0) - (b.slayerRequirement || 0)
                }
                return a.combatLevel - b.combatLevel
              })
            const isCollapsed = collapsedSections[category.key] ?? true
            return (
              <div key={category.key}>
                <button
                  type="button"
                  onClick={() => toggleSection(category.key)}
                  class="w-full flex items-center gap-2 mb-2 px-1 py-1 text-left rounded-lg active:bg-[#1a1a1a]"
                >
                  <span class="text-base">{category.icon}</span>
                  <span class="text-xs font-semibold text-[var(--color-parchment)] uppercase tracking-wider opacity-60">{category.label}</span>
                  <span class="ml-auto text-[10px] text-[var(--color-parchment)] opacity-60">{isCollapsed ? '▶' : '▼'}</span>
                  {monsters.length === 0 && (
                    <span class="text-[10px] text-[var(--color-parchment)] opacity-30 italic">— coming soon</span>
                  )}
                </button>
                {!isCollapsed && (
                  <div class="space-y-2 md:space-y-0 md:grid md:grid-cols-2 md:gap-2 lg:grid-cols-3 xl:grid-cols-4">
                  {monsters.map(monster => {
                    const slayLvl = getSlayerLevel()
                    const slayReq = monster.slayerRequirement
                    const slayLocked = slayReq && slayLvl < slayReq
                    const bossReq = checkBossRequirements(monster)
                    const isLocked = slayLocked || bossReq.locked
                    const isOnTask = doesSlayerTaskMatchMonster(slayerTask?.monsterId, monster.id)
                    return (
                    <div key={monster.id} class="flex gap-2 items-center" title={isLocked ? (bossReq.locked ? bossReq.reason : '') : ''}>
                      <button
                        onClick={() => !isLocked && startFight(monster)}
                        disabled={isLocked}
                        title={isLocked && bossReq.locked ? bossReq.reason : ''}
                        class={`flex-1 flex items-center justify-between p-3 rounded-xl border transition-colors
                          ${isOnTask ? 'bg-[#1a1a08] border-[#3a3a10]' :
                            isLocked ? 'bg-[#111] border-[#1a1a1a] opacity-50' :
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
                            {slayReq && !slayLocked && !isOnTask && (
                              <div class="text-[9px] font-semibold text-[var(--color-blood-light)]">
                                🔒 Slayer task required
                              </div>
                            )}
                            {bossReq.locked && !slayLocked && !slayReq && (
                              <div class="text-[9px] font-semibold text-[var(--color-blood-light)]">
                                🔒 {monster.id === 'blighted_gauntlet' ? 'Song of the Elves' :
                                     monster.id === 'ashen_crucible' ? 'Defeat Ember Tyrant' :
                                     (monster.id === 'adamant_dragon' || monster.id === 'rune_dragon') ? 'Dragon Slayer II' :
                                     monster.id === 'hellbound_gorilla' ? 'Monkey Madness II' : 'Locked'}
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
                        aria-label="Monster info"
                        class="flex-shrink-0 w-9 h-9 rounded-full border border-[var(--color-void-border)] bg-[var(--color-void-light)] text-[var(--color-gold)] text-[14px] font-bold flex items-center justify-center active:opacity-70"
                        title="View Monster Info"
                      >
                        ⓘ
                      </button>
                    </div>
                    )
                  })}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Raids Section */}
        <div class="mt-6">
          <button
            type="button"
            onClick={() => toggleSection('raids')}
            class="w-full flex items-center gap-2 mb-3 px-1 py-1 text-left rounded-lg active:bg-[#1a1a1a]"
          >
            <span class="text-base">🏆</span>
            <span class="text-xs font-semibold text-[var(--color-gold)] uppercase tracking-wider">Raids</span>
            <span class="ml-auto text-[10px] text-[var(--color-parchment)] opacity-60">{(collapsedSections.raids ?? true) ? '▶' : '▼'}</span>
          </button>
          {!(collapsedSections.raids ?? true) && (
            <div class="space-y-2">
            {Object.values(raidsData).filter((raid, index, allRaids) =>
              allRaids.findIndex(candidate => candidate.id === raid.id) === index
            ).map(raid => {
              const raidReq = checkRaidRequirements(raid)
              const isRaidLocked = raidReq.locked
              return (
                <div key={raid.id} class="flex gap-2 items-center" title={isRaidLocked ? raidReq.reason : ''}>
                  <button
                    onClick={() => !isRaidLocked && startRaid(raid)}
                    disabled={isRaidLocked}
                    title={isRaidLocked ? raidReq.reason : ''}
                    class={`flex-1 p-3 rounded-xl border transition-colors text-left flex items-center justify-between
                      ${isRaidLocked ? 'bg-[#111] border-[#1a1a1a] opacity-50' : 'bg-[#1a1a1a] border-[#2a2a2a] active:bg-[#222]'}`}
                  >
                    <div class="flex-1 flex items-center gap-2">
                      <span class="text-2xl">{raid.icon}</span>
                      <div>
                        <div class="text-sm font-semibold text-[var(--color-parchment)]">{raid.name}</div>
                        <div class={`text-[10px] ${isRaidLocked ? 'text-[var(--color-blood-light)]' : 'text-[var(--color-parchment)]'} opacity-40`}>{isRaidLocked ? '🔒 ' + raidReq.reason : raid.description}</div>
                      </div>
                    </div>
                    {raidKillCounts[raid.id] > 0 && (
                      <div class="text-[9px] text-yellow-400 font-mono ml-2 flex-shrink-0">KC: {raidKillCounts[raid.id].toLocaleString()}</div>
                    )}
                  </button>
                  <button
                    onClick={() => setSelectedRaidInfo(raid)}
                    aria-label="Raid info"
                    class="flex-shrink-0 w-9 h-9 rounded-full border border-[var(--color-void-border)] bg-[var(--color-void-light)] text-[var(--color-gold)] text-[14px] font-bold flex items-center justify-center active:opacity-70"
                    title="View Raid Info"
                  >
                    ⓘ
                  </button>
                </div>
              )
            })}
            </div>
          )}
        </div>

        {/* PvP entry — hidden for ironman / one-life accounts. */}
        {!isIronman && !isOneLife && (
          <div class="mt-6 pb-2">
            <button
              onClick={() => setShowPvpLobby(true)}
              class="w-full p-3 rounded-xl border border-[var(--color-blood)] bg-[#2a1010] text-[var(--color-blood-light)] active:bg-[#3a1818] transition-colors flex items-center justify-center gap-2"
              title="Player vs Player"
            >
              <span class="text-lg">☠️</span>
              <span class="text-sm font-bold tracking-wider">PvP — Player vs Player</span>
            </button>
            <div class="text-[9px] text-[var(--color-parchment)] opacity-40 mt-1.5 text-center px-2">
              On death, your tradeable inventory + equipped gear go to the winner. Untradeables stay with you.
            </div>
          </div>
        )}
      </div>

      {showPvpLobby && (
        <PvpLobbyModal
          onClose={() => setShowPvpLobby(false)}
          getSnapshot={getSnapshot}
        />
      )}

      {/* Idle combat setup */}
      {idleSetupMode && (
        <IdleCombatSetupModal
          mode={idleSetupMode}
          onClose={() => setIdleSetupMode(null)}
          inventory={inventory}
          bank={bank}
          itemsData={itemsData}
          prayersData={prayersData}
          prayerLevel={getLevelFromXP(stats.prayer?.xp || 0)}
          setup={idleCombatSetup}
          onChange={updateIdleCombatSetup}
        />
      )}

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
                    return (
                      <div key={drop.itemId} class="bg-[#111] rounded-lg p-2">
                        <div class="flex items-start justify-between gap-2">
                          <div class="text-left flex-1 min-w-0">
                            <div class="text-[11px] font-semibold text-[var(--color-parchment)]">{item?.icon || '📦'} {item?.name || drop.itemId}</div>
                            <div class="text-[9px] text-[var(--color-parchment)] opacity-60 mt-0.5">
                              {formatDropChance(drop.chance)}
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
                          {formatDropChance(drop.chance)}
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
    <div class={`h-full flex flex-col p-4 ${isDesktopCombatLayout ? 'overflow-hidden' : ''}`}>
      {/* Back button */}
      <button onClick={stopAndBack}
        class="text-xs text-[var(--color-gold-dim)] mb-3 flex items-center gap-1">
        ← Back
      </button>

      {/* Pane container — single flex column on mobile, 3-pane grid on desktop.
          DOM order is [stats, inventory, console] so mobile flow stays
          [stats, console] (the inventory pane is desktop-only). At md+,
          explicit grid placement puts:
            col 1 = stats + paperdoll
            col 2 = inventory grid (click equippables to equip) + prayers
            col 3 = special bar + combat log + kills + action buttons */}
      <div class={`flex-1 min-h-0 flex flex-col ${isDesktopCombatLayout ? 'grid grid-cols-[minmax(220px,1fr)_minmax(0,1.6fr)_minmax(220px,1fr)] grid-rows-1 gap-4 overflow-hidden' : ''}`}>

      {/* LEFT pane: enemy + player stats */}
      <div class={`flex flex-col ${isDesktopCombatLayout ? 'col-start-1 row-start-1 overflow-y-auto min-h-0 pr-1' : ''}`}>

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
      {doesSlayerTaskMatchMonster(slayerTask?.monsterId, combat.monster.id) && (
        <div class="mb-2 bg-[#1a1a08] border border-[#3a3a10] rounded-lg px-3 py-1.5 flex items-center justify-between">
          <span class="text-[10px] text-yellow-400 font-semibold">💀 Slayer Task</span>
          <span class="text-[10px] font-[var(--font-mono)] text-yellow-400">
            {slayerTask.monstersRemaining} / {slayerTask.totalCount} remaining
          </span>
        </div>
      )}

      {/* Inline gear paperdoll — desktop only. Click an equipped slot to
          unequip directly into inventory (only works if there's space).
          Mobile keeps the ⚙️ Gear button + modal flow. */}
      <div class={`${isDesktopCombatLayout ? 'block' : 'hidden'} mt-2`}>
        <div class="grid grid-cols-2 gap-2 mb-2">
          {(() => {
            const weaponEntry = equipment?.weapon
            const weapon = weaponEntry ? itemsData[weaponEntry.itemId] : null
            const hasSpec = weapon?.specialAttack
            const energy = combat.specialAttackEnergy || 0
            const canSpec = hasSpec && energy >= weapon.specialAttack.energyCost
            const isMagic = weapon?.attackStyle === 'magic'
            return (
              <>
                <button
                  onClick={canSpec ? handleSpecialAttack : undefined}
                  disabled={!canSpec}
                  class={`py-2.5 rounded-lg font-semibold text-sm transition-opacity ${canSpec ? 'active:opacity-80' : 'opacity-40 cursor-default'}`}
                  style={canSpec ? 'background:linear-gradient(135deg,#3a2a00,#6a4a00);border:1px solid rgba(234,179,8,0.5);color:#fde047' : 'background:#1a1a1a;border:1px solid #2a2a2a;color:#888'}
                >
                  ⚡ {hasSpec ? 'Spec' : 'No Spec'}
                </button>
                <button
                  onClick={() => isMagic && setShowSpellModal(true)}
                  disabled={!isMagic}
                  class={`py-2.5 rounded-lg font-semibold text-sm transition-opacity ${isMagic ? 'active:opacity-80' : 'opacity-40 cursor-default'}`}
                  style={isMagic ? 'background:linear-gradient(135deg,#1a2a3a,#2a3a5a);border:1px solid rgba(100,150,200,0.35);color:#a8d8ff' : 'background:#1a1a1a;border:1px solid #2a2a2a;color:#888'}
                >
                  🔮 Cast
                </button>
              </>
            )
          })()}
        </div>
        <div class="text-[10px] uppercase tracking-wider text-[var(--color-gold-dim)] opacity-60 mb-1.5 px-1">Gear</div>
        <EquipmentPaperdoll
          equipment={equipment}
          itemsData={itemsData}
          onSelect={(slotName) => handleUnequipSlot(slotName)}
          size="mdFixed"
        />
      </div>

      </div>{/* /LEFT pane */}

      {/* INVENTORY pane (DOM 2nd, visually MIDDLE at md+): full inventory grid.
          Click an equippable item to equip it instantly (no confirm). Clicks on
          non-equippable items are ignored to keep mid-fight UX safe. Hidden on
          mobile so the existing modal-driven flow is preserved there. */}
      <div class={`${isDesktopCombatLayout ? 'flex' : 'hidden'} flex-col ${isDesktopCombatLayout ? 'col-start-2 row-start-1 overflow-y-auto min-h-0' : ''}`}>

      <div class="flex items-center justify-between mb-2 px-1">
        <div class="text-[10px] uppercase tracking-wider text-[var(--color-gold-dim)] opacity-60">Inventory</div>
        <span class="text-[10px] font-[var(--font-mono)] text-[var(--color-parchment)] opacity-40">
          {freeSlots(inventory)}/28 free
        </span>
      </div>

      <div class="grid grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 justify-items-center">
        {inventory.map((slot, i) => {
          const item = slot ? itemsData[slot.itemId] : null
          // Notes can't be equipped/eaten/drunk, so they fall through to no-op.
          let onClick = undefined
          if (item && !slot.noted) {
            if (item.slot) onClick = () => handleEquipItem(slot.itemId)
            else if (item.type === 'food') onClick = () => handleEatItem(slot.itemId)
            else if (item.type === 'potion') onClick = () => handlePotion(slot.itemId)
          }
          return (
            <ItemSlot
              key={i}
              slot={slot}
              onClick={onClick}
              showName
            />
          )
        })}
      </div>

      {/* Inline prayer toggles — desktop only. Mirrors the prayer modal's
          activeProtectionPrayer / activeCombatPrayer toggles, but inline so
          mobile keeps the 🙏 Prayer button + modal flow. */}
      <div class="mt-4">
        <div class="flex items-start justify-between gap-2 mb-1.5 px-1">
          <div class="text-[10px] uppercase tracking-wider text-[var(--color-gold-dim)] opacity-60">Prayers</div>
          {Object.keys(combat?.activePotions || {}).length > 0 && (
            <div class="text-right text-[9px] text-[var(--color-gold)] leading-tight">
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
                const remainingTicks = combat.activePotions[potionId] || 0
                const remainingSeconds = Math.ceil(remainingTicks * 0.6)
                return (
                  <div key={potionId} class="opacity-80">
                    {potion.icon} {boosts.join(', ')} · {remainingSeconds}s
                  </div>
                )
              })}
            </div>
          )}
        </div>
        {(() => {
          const prayerLevel = getLevelFromXP(stats.prayer?.xp || 0)
          const protectionPrayers = Object.values(prayersData).filter(p => p.bonusType === 'protection')
          const combatPrayers = Object.values(prayersData)
            .filter(p => p.bonusType !== 'protection')
            .sort((a, b) => b.level - a.level)
          return (
            <>
              <div class="grid grid-cols-3 gap-1 mb-1.5">
                {protectionPrayers.map(prayer => {
                  const canUse = prayerLevel >= prayer.level
                  const isActive = combat?.activeProtectionPrayer === prayer.id
                  const protectType = prayer.style === 'magic' ? 'Mage' : prayer.style === 'ranged' ? 'Range' : 'Melee'
                  return (
                    <button
                      key={prayer.id}
                      onClick={() => canUse && handlePrayer(prayer.id)}
                      disabled={!canUse}
                      title={`${prayer.name} · Lv ${prayer.level}`}
                      class={`px-1 py-1.5 rounded-md border text-center transition-colors ${
                        isActive
                          ? 'bg-[#2a4a2a] border-[var(--color-gold)]'
                          : canUse
                            ? 'bg-[#1a2a1a] border-[#2a4a2a] active:bg-[#2a3a2a]'
                            : 'bg-[#111] border-[#1a1a1a] opacity-30 cursor-default'
                      }`}
                    >
                      <div class="text-[12px] leading-none">{prayer.icon}</div>
                      <div class="text-[8px] text-[var(--color-parchment)] opacity-70 mt-0.5">{protectType}</div>
                    </button>
                  )
                })}
              </div>
              <div class="grid grid-cols-6 gap-1">
                {combatPrayers.map(prayer => {
                  const canUse = prayerLevel >= prayer.level
                  const isActive = combat?.activeCombatPrayer === prayer.id
                  const styled = getPrayerStyleIcon(prayer)
                  return (
                    <button
                      key={prayer.id}
                      onClick={() => canUse && handlePrayer(prayer.id)}
                      disabled={!canUse}
                      title={`${prayer.name} · Lv ${prayer.level}\n${prayer.description}`}
                      class={`px-1 py-1 rounded-md border text-center transition-colors ${
                        isActive
                          ? 'bg-[#2a3a1a] border-[var(--color-gold)]'
                          : canUse
                            ? 'bg-[#1a2a1a] border-[#2a4a2a] active:bg-[#2a3a2a]'
                            : 'bg-[#111] border-[#1a1a1a] opacity-30 cursor-default'
                      }`}
                    >
                      {styled ? (
                        <div class="text-[10px] font-[var(--font-mono)] text-[var(--color-parchment)] leading-none whitespace-nowrap">
                          +{styled.boostPercent}% {styled.icon}
                        </div>
                      ) : (
                        <div class="text-[12px] leading-none">{prayer.icon}</div>
                      )}
                      <div class="text-[8px] text-[var(--color-gold-dim)] opacity-70 mt-0.5">Lv {prayer.level}</div>
                    </button>
                  )
                })}
              </div>
            </>
          )
        })()}
      </div>

      </div>{/* /INVENTORY pane */}

      {/* CONSOLE pane (DOM 3rd, visually RIGHT at md+): special bar, log, kill stats, action buttons */}
      <div class={`flex-1 min-h-0 flex flex-col ${isDesktopCombatLayout ? 'col-start-3 row-start-1 overflow-hidden' : ''}`}>

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

      {/* Action buttons.
          Mobile keeps the 6-button two-row layout (Eat/Potion/Gear,
          Spec/Cast/Prayer) since Gear + Prayer don't have inline panels there.
          Desktop collapses to a single 4-button row (Eat/Potion/Spec/Cast)
          because Gear lives in the LEFT pane paperdoll and Prayer lives in
          the RIGHT pane prayer panel. */}
      <div class="flex-shrink-0 flex flex-col gap-2">
        {combat.active && !isAutoRestarting && (() => {
          const weaponEntry = equipment?.weapon
          const weapon = weaponEntry ? itemsData[weaponEntry.itemId] : null
          const hasSpec = weapon?.specialAttack
          const energy = combat.specialAttackEnergy || 0
          const canSpec = hasSpec && energy >= weapon.specialAttack.energyCost
          const isMagic = weapon?.attackStyle === 'magic'

          const eatBtn = (
            <button onClick={handleEat}
              class="py-2.5 rounded-lg font-semibold text-sm active:opacity-80"
              style="background:linear-gradient(135deg,#1a3a2a,#2a5a3a);border:1px solid rgba(100,200,120,0.35);color:#7de8a0">
              🍖 Eat
            </button>
          )
          const potionBtn = (
            <button onClick={() => setShowPotionModal(true)}
              class="py-2.5 rounded-lg font-semibold text-sm active:opacity-80"
              style="background:linear-gradient(135deg,#1a3a2a,#2a5a3a);border:1px solid rgba(100,200,120,0.35);color:#7de8a0">
              🧪 Potion
            </button>
          )
          const gearBtn = (
            <button onClick={() => setShowEquipmentModal(true)}
              class="py-2.5 rounded-lg font-semibold text-sm active:opacity-80"
              style="background:linear-gradient(135deg,#2a2a3a,#3a3a5a);border:1px solid rgba(150,150,200,0.35);color:#a8a8d8">
              ⚙️ Gear
            </button>
          )
          const specBtn = (
            <button
              onClick={canSpec ? handleSpecialAttack : undefined}
              disabled={!canSpec}
              class={`py-2.5 rounded-lg font-semibold text-sm transition-opacity ${canSpec ? 'active:opacity-80' : 'opacity-40 cursor-default'}`}
              style={canSpec ? 'background:linear-gradient(135deg,#3a2a00,#6a4a00);border:1px solid rgba(234,179,8,0.5);color:#fde047' : 'background:#1a1a1a;border:1px solid #2a2a2a;color:#888'}
            >
              ⚡ {hasSpec ? `Spec` : 'No Spec'}
            </button>
          )
          const castBtn = (
            <button
              onClick={() => isMagic && setShowSpellModal(true)}
              disabled={!isMagic}
              class={`py-2.5 rounded-lg font-semibold text-sm transition-opacity ${isMagic ? 'active:opacity-80' : 'opacity-40 cursor-default'}`}
              style={isMagic ? 'background:linear-gradient(135deg,#1a2a3a,#2a3a5a);border:1px solid rgba(100,150,200,0.35);color:#a8d8ff' : 'background:#1a1a1a;border:1px solid #2a2a2a;color:#888'}
            >
              🔮 Cast
            </button>
          )
          const prayerBtn = (
            <button onClick={() => setShowPrayerModal(true)}
              class="py-2.5 rounded-lg font-semibold text-sm active:opacity-80"
              style="background:linear-gradient(135deg,#1a3a2a,#2a5a3a);border:1px solid rgba(100,200,120,0.35);color:#7de8a0">
              🙏 Prayer
            </button>
          )

          return (
            <>
              {/* Mobile: two rows of 3 */}
              <div class={`${isDesktopCombatLayout ? 'hidden' : 'flex'} flex-col gap-2`}>
                <div class="grid grid-cols-3 gap-2">
                  {eatBtn}{potionBtn}{gearBtn}
                </div>
                <div class="grid grid-cols-3 gap-2">
                  {specBtn}{castBtn}{prayerBtn}
                </div>
              </div>
              {/* Desktop: only Spec + Cast remain (Gear/Prayer moved to side
                  panes; Eat/Potion are now click-an-inventory-item flows). */}
              <div class="hidden" />
            </>
          )
        })()}
      </div>

      </div>{/* /CENTRE pane */}
      </div>{/* /pane container */}

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
              <div class="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
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
              <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
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
                            <div class="text-sm font-semibold text-[var(--color-parchment)]">{(getPrayerStyleIcon(prayer)?.icon) || prayer.icon} {prayer.name}</div>
                            <div class="text-[9px] text-[var(--color-parchment)] opacity-60 line-clamp-2 mt-0.5">
                              {prayer.description}
                            </div>
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
                      {spell.runeReq && Object.entries(spell.runeReq).length > 0 && (
                        <div class="text-[9px] text-[var(--color-gold-dim)] mt-0.5">
                          Runes: {Object.entries(spell.runeReq).map(([runeId, qty]) => `${qty}x ${runeId.split('_')[0].charAt(0).toUpperCase() + runeId.split('_')[0].slice(1)}`).join(', ')}
                        </div>
                      )}
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
                <div class="grid grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-1.5">
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
            {lootModal.loading ? (
              <div class="text-center py-6">
                <div class="w-8 h-8 mx-auto border-2 border-[var(--color-gold)] border-t-transparent rounded-full animate-spin" />
                <div class="mt-3 text-sm text-[var(--color-parchment)] opacity-70">Waiting for server loot…</div>
              </div>
            ) : lootModal.loot && lootModal.loot.length > 0 ? (
              <div class="space-y-2 max-h-48 overflow-y-auto">
                {lootModal.loot.map((drop, idx) => {
                  const item = itemsData[drop.itemId]
                  const isHighValue = isHighValueDrop(drop.itemId, drop.quantity, itemsData)
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
            {!lootModal.loading && (
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
            )}
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
                    return (
                      <div key={drop.itemId} class="bg-[#111] rounded-lg p-2">
                        <div class="flex items-start justify-between gap-2">
                          <div class="text-left flex-1 min-w-0">
                            <div class="text-[11px] font-semibold text-[var(--color-parchment)]">
                              {item?.icon || '📦'} {item?.name || drop.itemId}
                            </div>
                            <div class="text-[9px] text-[var(--color-parchment)] opacity-60 mt-0.5">
                              {formatDropChance(drop.chance)}
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
