import { Component } from 'preact'
import { useState, useEffect, useRef, useMemo } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import { usePvp } from '../state/pvpState.jsx'
import PvpLobbyModal from './PvpLobbyModal.jsx'
import PvpCombatScreen from './PvpCombatScreen.jsx'
import Modal from '../components/Modal.jsx'
import LootResultModal from '../components/LootResultModal.jsx'
import HPBar from '../components/HPBar.jsx'
import IdleCombatSetupModal from '../components/IdleCombatSetupModal.jsx'
import BackLink from '../components/BackLink.jsx'
import EquipmentPaperdoll from '../components/EquipmentPaperdoll.jsx'
import InventoryGrid from '../components/InventoryGrid.jsx'
import GameIcon from '../components/GameIcon.jsx'
import CombatQuickActions from '../components/CombatQuickActions.jsx'
import SpellSelectGrid from '../components/SpellSelectGrid.jsx'
import SkillEmblem from '../components/SkillEmblem.jsx'
import CollapseChevron from '../components/CollapseChevron.jsx'
import CombatMobileSelect from './CombatMobileSelect.jsx'
import { CombatMonsterInfoSheet, CombatRaidInfoSheet, MultiStyleChip } from './CombatMobileSheets.jsx'
import { getMonsterArt, getMonsterAttackStyles, getMonsterWeakness, getCategoryArt, getRaidArt, getMonsterLocationLabel, getStyleArt } from '../utils/combatArt.js'
import { getSkillArt } from '../utils/skillArt.js'
import { prayerSkill } from '../utils/prayerIcons.js'
import { MONSTER_ICONS } from '../utils/monsterIcons.js'
import SkillIcon from '../components/SkillIcon.jsx'
import { createCombatState, createRaidCombatState, processCombatTick, applyEat, applyCombo, applySpecialAttack, applyInstantKill } from '../engine/combat.js'
import { applyConsumableEffect, isLumiraBrew, isComboConsumable } from '../engine/consumables.js'
import { getLevelFromXP } from '../engine/experience.js'
import { checkBossRequirementsPure, checkRaidRequirementsPure } from '../engine/combatRequirements.js'
import { getMonsterSeedDrops } from '../engine/seedDrops.js'
import { getAgilityBankDelayMs, formatBankDelay } from '../engine/agility.js'
import { onTick, pauseTicks, resumeTicks } from '../engine/tick.js'
import { addItem, removeItem, freeSlots, countItem } from '../engine/inventory.js'
import { SUMMONING_CREATURES, getSummoningCreature, createSummonState, getMonsterCharmDrops } from '../engine/summoning.js'
import { getCombatType, resolveMagicSpell, equipItem, checkEquipRequirements, placeUnequippedItems } from '../engine/equipment.js'
import { RAID_TASK_META } from '../engine/slayerMasters.js'
import { resolveSpecialEnergyCost, canAffordSpecialAttack, formatSpecialEnergyCostLabel } from '../engine/specialAttackEnergy.js'
import { api, getToken, getCharacterId, getOneLifeMode, isDemoMode } from '../cloud/api.js'
import { pullSave, applyCloudSave, requestCriticalPushSave, pushNow } from '../cloud/sync.js'
import { pvpApi } from '../cloud/pvp.js'
import monstersData from '../data/monsters.json'
import worldData from '../data/world.json'
import { placeActivities } from '../engine/worldContent.js'
import questsData from '../data/quests.json'
import itemsData from '../data/items.json'
import prayersData from '../data/prayers.json'
import spellsData from '../data/spells.json'
import raidsData from '../data/raids.json'
import { SCREENS, formatDropChance } from '../utils/constants.js'
import { hasEpicLootDrop, getItemUnitValue, getLootTotalValue } from '../utils/itemValue.js'
import { splatsFromCombatEvents, HIT_SPLAT_DURATION_MS } from '../utils/hitSplats.js'
import { HitSplatLayer } from '../components/HitSplat.jsx'
import CombatArena3D from '../components/CombatArena3D.jsx'
import { getCreatureSpec } from '../3d/creatures.js'
import { getArenaBiomeSpec } from '../3d/biomeRegistry.js'
import { getMonsterModel, getCharacterAssetPath, getWeaponPlacement, getGearPlacements, getCharacterModel } from '../utils/equipModels.js'
import { canRender3D } from '../utils/three3d.js'
import ActivePotionBadges from '../components/ActivePotionBadges.jsx'
import { getSlayerTaskXpForKill, resolveMonsterRewardData } from '../engine/slayerRewards.js'
import { resolveSlayerTaskKill, doesSlayerTaskMatchMonster } from '../engine/slayerTasks.js'
import { getSlayerTaskReward } from '../engine/slayerRewards.js'
import { CRITICAL_SAVE_REASONS, hasCriticalDrop } from '../cloud/criticalSavePolicy.js'
import { recordCollectionLogDrop, applyServerCollectionLogEntries } from '../cloud/collectionLog.js'
import { filterLoggedDrops, monsterHasLoggedDrop } from '../engine/collectionLog.js'

const COMBAT_CATEGORIES = [
  {
    key: 'training',
    label: 'Training',
    icon: '⚔️',
    ids: ['field_chicken', 'cave_goblin', 'pasture_bull', 'stoneback_crab', 'duneback_crab', 'arcane_adept', 'umbral_adept', 'broodfang_spider', 'highland_giant', 'briar_giant', 'ember_giant', 'lesser_fiend', 'elder_tree_spirit', 'elder_rock_golem'],
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
    ids: ['green_dragon', 'red_dragon', 'black_dragon', 'king_black_dragon', 'adamant_dragon', 'rune_dragon'],
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
  {
    key: 'duskmare',
    label: 'The Duskmare',
    icon: '🌑',
    ids: ['duskmare'],
  },
]

// Resolve which combat category a monster id belongs to (for art accent fallback).
const MONSTER_CATEGORY_KEY = (() => {
  const map = {}
  for (const cat of COMBAT_CATEGORIES) for (const id of cat.ids) map[id] = cat.key
  return map
})()
function getMonsterCategoryKey(monsterId) {
  return MONSTER_CATEGORY_KEY[monsterId]
}

// Dungeon mode (per-place foe list): the place's combat monsters split into
// Monsters / Bosses plus its raids — the same rows the world-wide picker shows,
// filtered to one place and re-grouped. Refs come from the same
// worldActivities.json index that gates a fight's start, so a dungeon can never
// list a foe the place doesn't actually offer.
function buildDungeonData(placeId) {
  const acts = placeActivities(placeId)
  const combatIds = acts.filter(a => a.kind === 'combat').map(a => a.ref).filter(id => monstersData[id])
  const raidIds = acts.filter(a => a.kind === 'raid').map(a => a.ref).filter(id => raidsData[id])
  const categories = []
  const monsters = combatIds.filter(id => !monstersData[id].boss)
  const bosses = combatIds.filter(id => monstersData[id].boss)
  if (monsters.length) categories.push({ key: 'monsters', label: 'Monsters', icon: '⚔️', ids: monsters })
  if (bosses.length) categories.push({ key: 'bosses', label: 'Bosses', icon: '👑', ids: bosses })
  const raids = {}
  for (const id of raidIds) raids[id] = raidsData[id]
  return { categories, raids }
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

const DEFENCE_STYLES = ['stab', 'slash', 'crush', 'magic', 'ranged']

// Per-phase attack/defence breakdown for multiForm bosses (e.g. Venomcoil
// Matriarch) — the monster's own top-level stats/defenceBonus only mirror its
// initial form, so a full picture needs every entry in `forms`.
function MonsterPhaseStats({ monster }) {
  if (!monster?.multiForm || !monster.forms) return null
  return (
    <div>
      <h4 class="text-xs font-semibold text-[var(--color-gold-dim)] uppercase tracking-wider mb-2 opacity-70">Phases</h4>
      <div class="space-y-2">
        {Object.entries(monster.forms).map(([formKey, form]) => (
          <div key={formKey} class="bg-[var(--color-void)] rounded-lg p-3 space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-[11px] font-semibold" style={{ color: getStyleArt(form.attackStyle).color }}>
                {form.icon} {form.displayName || formKey}
              </span>
              <span class="text-[9px] text-[var(--color-parchment)] opacity-50 font-[var(--font-mono)]">Max Hit {form.maxHit ?? '—'}</span>
            </div>
            <div class="flex justify-between text-[10px] text-[var(--color-parchment)] opacity-80">
              <span>Attack Bonus <span class="font-[var(--font-mono)]">{form.attackBonus ?? 0}</span></span>
              <span>Strength Bonus <span class="font-[var(--font-mono)]">{form.strengthBonus ?? 0}</span></span>
            </div>
            <div class="grid grid-cols-5 gap-1 text-[9px] text-[var(--color-parchment)] pt-1 border-t border-[var(--fm-rule)]">
              {DEFENCE_STYLES.map(style => (
                <div key={style} class="text-center">
                  <div class="opacity-50 capitalize">{style}</div>
                  <div class={(form.defenceBonus?.[style] ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}>
                    {(form.defenceBonus?.[style] ?? 0) >= 0 ? '+' : ''}{form.defenceBonus?.[style] ?? 0}
                  </div>
                </div>
              ))}
            </div>
            {form.weakness && (
              <div class="text-[9px] text-[var(--color-parchment)] opacity-50 capitalize">Weak to: {form.weakness}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function CombatScreen({ onNavigate, initialMonsterId, initialRaidId, onCombatStatusChange, onBack, onStopBack, dungeonPlaceId }) {
  const { stats, inventory, bank, equipment, currentHP, updateHP, updateInventory, updateBank, updateEquipment, grantXP, getMaxHP, addToast, combatStance, updateCombatStance, idleCombatSetup, updateIdleCombatSetup, homeShortcuts, updateHomeShortcuts, setActiveTask, requestActivityStart, slayerTask, setSlayerTask, awardSlayerPoints, slayerTasksCompleted, setSlayerTasksCompleted, incrementSlayerMasterTaskCompletions, activeCombatSpell, updateActiveCombatSpell, bossKillCounts, updateBossKillCounts, raidKillCounts, updateRaidKillCounts, unlockedFeatures, completedQuests, isOneLife, isIronman, revertOneLifeMode, getSnapshot, loadGame, combatSkipHandlerRef, skipHourHandlerRef, chargeSkipRef, raidSkipHandlerRef, lockGame, unlockGame, resolveCombatCompletion, characterUnlocks, killCountsLoaded, recordGameEvent, worldLocation, publishCombatStatus, activeTask, backgroundCombat } = useGame()
  const pvp = usePvp()
  // Offline demo: bosses, raids and PvP are locked (server-authoritative).
  const isDemo = isDemoMode() && !(getToken() && getCharacterId())
  const [showPvpLobby, setShowPvpLobby] = useState(false)

  // Dungeon mode: this screen renders one place's foes (Monsters / Bosses /
  // Raids) instead of the world-wide picker. PvP is hidden (not place-bound);
  // starting a fight still routes through the same gating, and the player is at
  // the place, so it starts immediately. The picker + its info sheets are reused
  // verbatim, only the section list and header change.
  const dungeonPlace = dungeonPlaceId ? worldData.places[dungeonPlaceId] : null
  const isDungeon = !!dungeonPlace
  const dungeon = useMemo(() => (isDungeon ? buildDungeonData(dungeonPlaceId) : null), [dungeonPlaceId, isDungeon])
  const pickerCategories = isDungeon ? dungeon.categories : COMBAT_CATEGORIES
  const pickerRaids = isDungeon ? dungeon.raids : raidsData
  const pickerTitle = isDungeon ? `${dungeonPlace.name} Dungeon` : 'Choose a Foe'

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
  const [showSummonModal, setShowSummonModal] = useState(false)
  const [selectedMonsterInfo, setSelectedMonsterInfo] = useState(null)
  const [selectedRaidInfo, setSelectedRaidInfo] = useState(null)
  // Section collapse state. Read sites default an unset key to collapsed in the
  // world-wide picker and expanded in dungeon mode (few sections, so open reads
  // better) via `?? !isDungeon`. `raids` is intentionally not seeded so that
  // default can apply to it too.
  const [collapsedSections, setCollapsedSections] = useState(() => ({
    ...Object.fromEntries(COMBAT_CATEGORIES.map(category => [category.key, true])),
  }))
  // Monster/raid picker search: filters the current picker screen down to
  // name matches and hides sections left with no results, without touching
  // the underlying collapsed-section state (restored once the search clears).
  // Matched sections default open but use their own collapse state (rather
  // than `collapsedSections`) so they can still be manually toggled while
  // searching without disturbing the pre-search collapsed layout.
  const [monsterSearch, setMonsterSearch] = useState('')
  const [searchCollapsedSections, setSearchCollapsedSections] = useState({})
  const monsterSearchActive = monsterSearch.trim().length > 0
  const monsterSearchQuery = monsterSearch.trim().toLowerCase()
  const filteredPickerCategories = useMemo(() => {
    if (!monsterSearchActive) return pickerCategories
    return pickerCategories
      .map(category => ({
        ...category,
        ids: category.ids.filter(id => monstersData[id]?.name?.toLowerCase().includes(monsterSearchQuery)),
      }))
      .filter(category => category.ids.length > 0)
  }, [pickerCategories, monsterSearchActive, monsterSearchQuery])
  const filteredPickerRaids = useMemo(() => {
    if (!monsterSearchActive) return pickerRaids
    return Object.fromEntries(
      Object.entries(pickerRaids).filter(([, raid]) => raid.name?.toLowerCase().includes(monsterSearchQuery))
    )
  }, [pickerRaids, monsterSearchActive, monsterSearchQuery])
  // While searching, sections use their own (independently toggleable)
  // collapse state, defaulting open so matches are visible immediately.
  const isSectionCollapsed = (key, dungeonDefault) => monsterSearchActive
    ? (searchCollapsedSections[key] ?? false)
    : (collapsedSections[key] ?? dungeonDefault)
  const handleMonsterSearchChange = (value) => {
    setMonsterSearch(value)
    if (!value.trim()) setSearchCollapsedSections({})
  }
  const [lootModal, setLootModal] = useState(null)
  const [deathModal, setDeathModal] = useState(null)
  const [isDesktopCombatLayout, setIsDesktopCombatLayout] = useState(false)
  const [monsterSplats, setMonsterSplats] = useState([])
  const [playerSplats, setPlayerSplats] = useState([])
  // 3D combat arena (Phase 2): renders inline in place of the HP bars for
  // monsters with a registered model; the 🎥/📊 chip swaps between the two,
  // and the choice persists. Combat ticks are held until the arena reports
  // ready (onReady — it self-releases on a load timeout), so a fight never
  // starts against an invisible scene.
  const [arenaClosed, setArenaClosed] = useState(() => {
    try { return localStorage.getItem('pocketrpg_combat3d') === 'off' } catch { return false }
  })
  const [arenaSignal, setArenaSignal] = useState(null)
  // Fired one tick BEFORE the monster's next attack lands (monsterAttackTimer
  // reaches 1) so the 3D arena can lead a rigged monster's wind-up and have the
  // swing connect exactly on the hit tick's splat. See CombatArena3D.
  const [arenaWindup, setArenaWindup] = useState(null)
  const [arenaReady, setArenaReady] = useState(false)
  const arenaReadyRef = useRef(false)
  const arenaClosedRef = useRef(arenaClosed)
  useEffect(() => { arenaReadyRef.current = arenaReady }, [arenaReady])
  useEffect(() => { arenaClosedRef.current = arenaClosed }, [arenaClosed])
  useEffect(() => { setArenaReady(false) }, [combat?.monster?.id, arenaClosed])
  const combatRef = useRef(null)
  const hpRef = useRef(currentHP)
  const hasAutoStarted = useRef(false)
  // Timestamp-throttles the "out of runes" error toast so a spell that splashes
  // every tick for lack of runes raises one toast, not one per 600ms tick.
  const noRunesToastRef = useRef(0)
  const noScrollsToastRef = useRef(0)
  const inventoryRef = useRef(inventory)
  const bankRef = useRef(bank)
  const statsRef = useRef(stats)
  const equipmentRef = useRef(equipment)
  const slayerTaskRef = useRef(slayerTask)
  const pvpCrashHandledRef = useRef(false)
  const oneLifeModeRef = useRef(isOneLife || getOneLifeMode())

  // One-life death: the character already revives at full HP like any other
  // death (see the call sites below) — this just reverts the account's
  // is_one_life flag in the background and surfaces the mode change.
  function revertOneLifeAfterDeath() {
    oneLifeModeRef.current = false
    void revertOneLifeMode().then(({ ok, isIronman }) => {
      if (!ok) {
        addToast('Connection issue confirming your account change — will retry on your next death.', 'error')
        oneLifeModeRef.current = true
        return
      }
      addToast(isIronman
        ? 'One-life protection lost — you are now a standard Ironman.'
        : 'One-life protection lost — you are now a standard account.', 'error')
    })
  }
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
    const { combatType: weaponCombatType, isPoweredStaff, spell: newSpell, needsSpell } = resolveMagicSpell(equipmentRef.current, itemsData, activeCombatSpell, spellsData)
    // A magic weapon with no castable spell (e.g. a staff just equipped with
    // no spell picked) fights with melee instead of splashing 0s forever —
    // stay in the fight; switch back to real magic once a spell is selected.
    const newCombatType = needsSpell ? 'melee' : weaponCombatType
    const effectiveSpellId = isPoweredStaff ? null : activeCombatSpell?.id
    // Update combat state to use the new spell/combat type
    if (combatRef.current.combatType !== newCombatType ||
        (newCombatType === 'magic' && combatRef.current.spell?.id !== effectiveSpellId)) {
      if (needsSpell && combatRef.current.combatType !== 'melee') {
        addToast('No spell selected — attacking with melee until you pick one.', 'info')
      }
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

  // Publish the live fight snapshot for the desktop combat indicator and the
  // background-combat host. `busy` stays true while a loot/death modal is still
  // up so the host keeps this screen mounted long enough to show it. Only normal
  // monster fights are `backgroundable` (bosses/raids/dungeons stay foreground).
  // Gated on the opt-in setting so combat is an exact no-op when it's off.
  useEffect(() => {
    if (!backgroundCombat || (!combat && !lootModal && !deathModal)) {
      publishCombatStatus?.(null)
      return
    }
    const m = combat?.monster
    publishCombatStatus?.({
      active: combat?.active === true,
      busy: combat?.active === true || !!lootModal || !!deathModal,
      backgroundable: !isDungeon && m?.boss !== true && !combat?.raid,
      monsterId: m?.id || null,
      monsterName: m?.name || null,
      monsterHP: Number.isFinite(m?.currentHP) ? m.currentHP : null,
      monsterMaxHP: Number.isFinite(m?.hitpoints) ? m.hitpoints : null,
    })
  }, [combat, lootModal, deathModal, backgroundCombat])

  // Clear the published status when the screen unmounts entirely.
  useEffect(() => () => publishCombatStatus?.(null), [])

  // If another activity (a skill, gathering, travel) supersedes this fight while
  // it ticks in the background, stop combat cleanly rather than running two
  // activities at once.
  useEffect(() => {
    if (combatRef.current?.active && activeTask && activeTask.type !== 'combat') {
      combatRef.current = null
      setCombat(null)
      setLog([])
    }
  }, [activeTask])

  // Pause ticks while the loot modal is open so combat cannot advance in the background
  useEffect(() => {
    if (!lootModal) return
    pauseTicks()
    return () => resumeTicks()
  }, [!!lootModal])

  // Hit splats — floating damage markers over the HP bars. Each batch expires
  // after its float animation; timers are cleared on unmount.
  const splatTimersRef = useRef(new Set())
  useEffect(() => () => {
    for (const t of splatTimersRef.current) clearTimeout(t)
    splatTimersRef.current.clear()
  }, [])
  const pushSplats = (setter, splats) => {
    if (!splats.length) return
    setter(prev => [...prev, ...splats])
    const ids = new Set(splats.map(s => s.id))
    const timer = setTimeout(() => {
      splatTimersRef.current.delete(timer)
      setter(prev => prev.filter(s => !ids.has(s.id)))
    }, HIT_SPLAT_DURATION_MS)
    splatTimersRef.current.add(timer)
  }

  // Tick listener for combat
  useEffect(() => {
    if (!combat || !combat.active) return
    combatRef.current = combat

    const unsub = onTick(() => {
      const state = combatRef.current
      if (!state || !state.active) return

      // Hold the fight while the 3D arena is still loading its models, so the
      // opening hits are never invisible (arena onReady/onFail releases this).
      if (!arenaClosedRef.current && !arenaReadyRef.current &&
          getMonsterModel(state.monster.id) && getCharacterAssetPath() && canRender3D()) return

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

      // Hit splats replace the chat-style "You hit X" / "Monster hits X" lines.
      const tickSplats = splatsFromCombatEvents(events)
      pushSplats(setMonsterSplats, tickSplats.monster)
      pushSplats(setPlayerSplats, tickSplats.player)
      if (tickSplats.monster.length || tickSplats.player.length) {
        setArenaSignal(prev => ({
          seq: (prev?.seq || 0) + 1,
          hero: tickSplats.monster.length > 0,
          monster: tickSplats.player.length > 0,
          special: events.some(ev => ev.type === 'specialHit'),
        }))
      }

      // Wind-up lead: broadcast how many ticks until the monster's next attack
      // so the arena can pre-start a rigged swing early enough (even for clips
      // longer than one tick) that it ENDS on the hit tick's splat.
      if (combatState.active && combatState.monster.currentHP > 0 && combatState.monsterAttackTimer >= 1) {
        setArenaWindup(prev => ({ seq: (prev?.seq || 0) + 1, ticks: combatState.monsterAttackTimer }))
      }

      for (const ev of events) {
        if (ev.type === 'specialHit') {
          const hitsStr = ev.hits.map(h => h > 0 ? h : 'miss').join(' + ')
          const specLabels = {
            double_hit: '⚔️⚔️ Puncture',
            fang: '🗡️ Deadly Strike',
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
            overpower: '🔨 Overpower',
            soul_leech: `🩸 Soul Leech (+${ev.healAmount || 0} HP)`,
            gale_shot: ev.stunned ? '💨 Gale Shot (staggered!)' : '💨 Gale Shot',
            molten_crush: ev.defenceReducedBy > 0 ? `🌋 Molten Crush (-${ev.defenceReducedBy} Defence)` : '🌋 Molten Crush',
            volley: '🌿🌿🌿 Volley',
            soul_drain: ev.prayerRestored > 0 ? `🌑 Soul Drain (+${ev.prayerRestored} Prayer)` : '🌑 Soul Drain',
            volatile_surge: '🌩️ Volatile Surge',
            disrupt: '🌋 Disrupt'
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
          if (newHP <= 0) {
            // Stop the fight synchronously: the tick loop reads combatRef.current,
            // so leaving it active lets the next tick re-activate combat (line ~613)
            // after HP was reset to full — the player never dies and the boss keeps
            // its damaged HP.
            if (combatRef.current) combatRef.current.active = false
            setCombat(prev => ({ ...prev, active: false }))
            setActiveTask(null)
            updateHP(getMaxHP())
            hpRef.current = getMaxHP()
            setDeathModal({ monsterName: state.monster?.name || 'the monster', cause: 'slain' })
            if (oneLifeModeRef.current) revertOneLifeAfterDeath()
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
            if (combatRef.current) combatRef.current.active = false
            setCombat(prev => ({ ...prev, active: false }))
            setActiveTask(null)
            updateHP(getMaxHP())
            hpRef.current = getMaxHP()
            setDeathModal({ monsterName: state.monster?.name || 'the dragon', cause: 'incinerated' })
            if (oneLifeModeRef.current) revertOneLifeAfterDeath()
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
        if (ev.type === 'summonHit') {
          const cname = getSummoningCreature(ev.creatureId)?.name || 'Creature'
          setLog(prev => [...prev.slice(-20), {
            text: ev.damage > 0 ? `Your ${cname} hits ${ev.damage}` : `Your ${cname} misses`,
            type: ev.damage > 0 ? 'hit' : 'miss',
            time: Date.now()
          }])
        }
        if (ev.type === 'consumeScroll') {
          const newInv = [...inventoryRef.current]
          removeItem(newInv, ev.itemId, ev.qty || 1)
          updateInventory(newInv)
          inventoryRef.current = newInv
        }
        if (ev.type === 'summonExpired') {
          const cname = getSummoningCreature(ev.creatureId)?.name || 'Creature'
          setLog(prev => [...prev.slice(-20), {
            text: `Your ${cname} vanishes.`,
            type: 'special',
            time: Date.now()
          }])
        }
        if (ev.type === 'summonNoScrolls') {
          const c = getSummoningCreature(ev.creatureId)
          const now = Date.now()
          if (now - noScrollsToastRef.current > 3500) {
            noScrollsToastRef.current = now
            addToast(`Out of ${itemsData[c?.scroll]?.name || 'scrolls'} — your ${c?.name || 'creature'} can't attack!`, 'error')
          }
        }
        if (ev.type === 'noRunesForSpell') {
          setLog(prev => [...prev.slice(-20), {
            text: `Not enough runes for ${ev.spellName}`,
            type: 'error',
            time: Date.now()
          }])
          const now = Date.now()
          if (now - noRunesToastRef.current > 3500) {
            noRunesToastRef.current = now
            addToast(`Out of runes for ${ev.spellName}!`, 'error')
          }
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
        if (ev.type === 'consumeArmourCharge') {
          // Decrement charges on each worn scale-charged armour piece that took a hit
          const newEq = { ...equipmentRef.current }
          let changed = false
          for (const slot of (ev.slots || [])) {
            const piece = newEq[slot]
            if (piece && piece.charges && piece.charges > 0) {
              newEq[slot] = { ...piece, charges: Math.max(0, piece.charges - (ev.qty || 1)) }
              changed = true
            }
          }
          if (changed) {
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
          const chargeItemId = item?.chargeItemId || 'venomcoil_scales'
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
          // Only bosses and monsters with a collection-logged unique settle
          // server-side (server-rolled loot + grant), so their high-value drops
          // can't be self-granted. Every other monster is client-trusted: its
          // client-rolled loot (ev.loot) is applied locally below and persisted
          // on the combat save heartbeat — NOT via a per-kill cloud write. This
          // is what keeps an auto-fight grind from hammering /api/save.
          const monsterNeedsServerGrant = isDefeatedBoss || monsterHasLoggedDrop(defeatedMonsterId)
          const cloudAuthoritativeMonster = Boolean(!raidId && defeatedMonsterId && monsterNeedsServerGrant && getToken() && getCharacterId())
          const cloudAuthoritativeCompletion = cloudAuthoritativeRaid || cloudAuthoritativeMonster
          let slayerXpGained = 0
          setKillCount(k => k + 1)
          // A routine kill is not a save milestone — it rides the 120s combat
          // heartbeat like a skilling action. Milestone saves still fire below:
          // RARE_DROP on a genuinely rare drop, and the server-authoritative
          // completion for bosses / logged-drop monsters.

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
          // Raid-completion proxy tasks (RAID_TASK_META) only credit progress on the
          // raid-complete kill event (ev.fromRaidCompletion) — a matching-id kill from
          // any other path (there shouldn't be one; the raid final bosses aren't placed
          // standalone) is ignored as defense-in-depth alongside the Slay-button routing
          // fix in SlayerScreen/WorldMapScreen.
          const isRaidTaskMonster = task && RAID_TASK_META[task.monsterId]
          const raidTaskCreditBlocked = isRaidTaskMonster && ev.fromRaidCompletion !== true
          if (task && defeatedMonsterId && !raidTaskCreditBlocked && doesSlayerTaskMatchMonster(task.monsterId, defeatedMonsterId)) {
            // Active combat does not flow through the idle-engine slayer XP handler.
            // Grant XP on the live kill event so active and idle kills stay consistent.
            const xpForKill = getSlayerTaskXpForKill(defeatedMonster, state.monster, monstersData, { doubleXp: characterUnlocks?.doubleSlayerXp, flatXp: RAID_TASK_META[task.monsterId]?.flatSlayerXp })
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
              if (task.masterId) incrementSlayerMasterTaskCompletions(task.masterId, 1)
              if (reward.pointsEarned > 0) {
                awardSlayerPoints(reward.pointsEarned)
              }
              requestCriticalPushSave(() => getSnapshot(), CRITICAL_SAVE_REASONS.SLAYER_TASK_COMPLETE)
              addToast(`💀 Slayer Task #${reward.totalTasks} Completed - ${reward.pointsEarned.toLocaleString()} points.`, 'levelup')
              recordGameEvent?.({ kind: 'slayer_task_complete' })
            } else if (slayerResult.onTask) {
              // An on-task kill decrementing the remaining count is routine
              // progress, not a milestone — it rides the 120s combat heartbeat
              // (and the tab-hide/unload flush) like every other kill. Firing a
              // critical save here made every slayer-grind kill a full
              // /api/save PUT. Assignment/skip (SlayerScreen) and completion
              // (above) remain critical saves.
              slayerTaskRef.current = slayerResult.task
              setSlayerTask(slayerResult.task)
            }
          }

          if (defeatedMonsterId) {
            const kind = isDefeatedBoss ? 'boss_kill' : 'monster_kill'
            recordGameEvent?.({ kind, monsterId: defeatedMonsterId })
          }

          if (cloudAuthoritativeRaid) {
            void claimRaidCompletion({ raidId, monster: defeatedMonsterData, slayerXpGained, isBossKill: isDefeatedBoss })
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
              // NOTE: deliberately NOT applyCloudSave(res.save.save_data) here — that
              // snapshot is whatever the server read at THIS request's start, which can
              // predate a later local-only change (e.g. travel) if the round trip is
              // slow, silently reverting it. The reward itself is already applied above;
              // save_revision stays in sync generically via SAVE_REVISION_EVENT (api.js).
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
            }).finally(() => {
              // Release any boss-skip lock awaiting this completion (no-op for a
              // normal live kill that didn't arm a wait).
              resolveCombatCompletion()
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
    if (monsterSearchActive) {
      setSearchCollapsedSections(prev => ({ ...prev, [sectionKey]: !(prev[sectionKey] ?? false) }))
    } else {
      setCollapsedSections(prev => ({ ...prev, [sectionKey]: !prev[sectionKey] }))
    }
  }

  const checkBossRequirements = (monster) => checkBossRequirementsPure(monster, {
    slayerLevel: getSlayerLevel(),
    completedQuests,
    bossKillCounts,
    questsData,
  })

  const checkRaidRequirements = (raid) => checkRaidRequirementsPure(raid, { completedQuests })

  const startFight = (monster) => {
    if (isDemo && monster.boss === true) {
      addToast('🔒 Bosses are available with a free account.', 'info')
      return
    }
    const req = checkBossRequirements(monster)
    if (req.locked) {
      addToast(req.reason, 'error')
      return
    }
    // Map-driven gating (Phase 3): must be at a place that offers this monster.
    if (!requestActivityStart({ type: 'combat', monster })) return
    const { combatType: weaponCombatType, weaponItem, isPoweredStaff, spell, needsSpell } = resolveMagicSpell(equipment, itemsData, activeCombatSpell, spellsData)
    const combatType = needsSpell ? 'melee' : weaponCombatType
    if (needsSpell) addToast('No spell selected — attacking with melee. Use the 🔮 Cast Spell button to fight with magic.', 'info')
    const state = createCombatState(monster, combatType, combatStance, spell)
    // Reset special attack energy on new fight; preserve active potions so they last their full 5 minutes
    state.specialAttackEnergy = 100
    // Prayer pool starts full (= Prayer level) at the start of a combat session.
    const prayerLvl = getLevelFromXP(stats.prayer?.xp || 0)
    state.maxPrayerPoints = prayerLvl
    state.prayerPoints = prayerLvl
    state.activePotions = combatRef.current ? { ...combatRef.current.activePotions } : {}
    setCombat(state)
    setKillCount(0)
    setFightStartedAt(Date.now())
    const spellName = spell ? ` with ${spell.name}` : isPoweredStaff && weaponItem ? ` with ${weaponItem.name}` : ''
    setLog([{ text: `Fighting ${monster.name}${spellName}...`, type: 'info', time: Date.now() }])
    setActiveTask({ type: 'combat', monster, stance: combatStance, bankingEnabled: true, spell: spell || null, dungeon: isDungeon })
  }

  const startRaid = (raidData) => {
    if (isDemo) {
      addToast('🔒 Raids are available with a free account.', 'info')
      return
    }
    const req = checkRaidRequirements(raidData)
    if (req.locked) {
      addToast(req.reason, 'error')
      return
    }
    // Map-driven gating (Phase 3): must be at a city that offers this raid. Raids are
    // their own activity kind — gate on the raid, not its first boss (which is raid-only
    // content and not a standalone monster on the map).
    if (!requestActivityStart({ type: 'raid', raid: raidData })) return
    const { combatType: weaponCombatType, spell, needsSpell } = resolveMagicSpell(equipment, itemsData, activeCombatSpell, spellsData)
    const combatType = needsSpell ? 'melee' : weaponCombatType
    if (needsSpell) addToast('No spell selected — attacking with melee. Use the 🔮 Cast Spell button to fight with magic.', 'info')
    const state = createRaidCombatState(raidData, monstersData, combatType, combatStance, spell)
    if (!state) {
      addToast('Failed to start raid — missing boss data', 'error')
      return
    }
    state.specialAttackEnergy = 100
    const raidPrayerLvl = getLevelFromXP(stats.prayer?.xp || 0)
    state.maxPrayerPoints = raidPrayerLvl
    state.prayerPoints = raidPrayerLvl
    state.activePotions = combatRef.current ? { ...combatRef.current.activePotions } : {}
    combatRef.current = state
    setCombat(state)
    setKillCount(0)
    setFightStartedAt(Date.now())
    const firstBoss = monstersData[raidData.bosses[0]]
    setLog([
      { text: `🩸 ${raidData.name} — Raid started!`, type: 'raid', time: Date.now() },
      { text: `Boss 1/${raidData.bosses.length}: ${firstBoss?.name || 'Unknown'}`, type: 'info', time: Date.now() }
    ])
    setActiveTask({ type: 'combat', monster: firstBoss, stance: combatStance, bankingEnabled: false, spell: spell || null, raid: true, raidId: raidData.id })
  }

  const continueFight = (monster) => {
    const { combatType: weaponCombatType, spell, needsSpell } = resolveMagicSpell(equipment, itemsData, activeCombatSpell, spellsData)
    // A magic weapon with no castable spell fights with melee instead of
    // stopping the auto-fight — see resolveMagicSpell.
    const combatType = needsSpell ? 'melee' : weaponCombatType
    const state = createCombatState(monster, combatType, combatStance, spell)
    // Reset special attack energy on kill; preserve active potions and prayers so they last their full duration
    state.specialAttackEnergy = 100
    state.activePotions = combatRef.current ? { ...combatRef.current.activePotions } : {}
    state.activeProtectionPrayer = combatRef.current?.activeProtectionPrayer ?? null
    state.activeCombatPrayer = combatRef.current?.activeCombatPrayer ?? null
    // Prayer pool is a persistent pool — carry it (and its fractional drain) across kills.
    state.maxPrayerPoints = combatRef.current?.maxPrayerPoints ?? getLevelFromXP(stats.prayer?.xp || 0)
    state.prayerPoints = combatRef.current?.prayerPoints ?? state.maxPrayerPoints
    state.prayerDrainAccumulator = combatRef.current?.prayerDrainAccumulator || 0
    // Carry an active summon across auto-fight kills so it lasts its full 60s
    // (the engine keeps ticking down ticksLeft and expires it naturally).
    state.summon = combatRef.current?.summon || null
    combatRef.current = state
    setCombat(state)
    setActiveTask({ type: 'combat', monster, stance: combatStance, bankingEnabled: true, spell: spell || null, dungeon: isDungeon })
  }

  // Claim one full-raid reward roll from the server (the legitimate grant path)
  // and surface it in the loot modal. Used both when a raid is completed live
  // and when the player skips an entire raid from the loot modal — a skip just
  // re-rolls another complete reward rather than re-simulating every boss.
  const claimRaidCompletion = async ({ raidId, monster, slayerXpGained = 0, isBossKill = false }) => {
    setLootModal({ monster, loot: [], slayerXpGained, isBossKill, raidId, loading: true })
    try {
      const res = await api.completeRaid(raidId, { actionNonce: `raid:${raidId}:${Date.now()}` })
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
      // NOTE: deliberately NOT applyCloudSave(res.save.save_data) here — see the
      // monster-completion handler above for why.
      recordGameEvent?.({ kind: 'raid_complete', raidId })
      setLootModal({
        monster,
        loot: granted.map(reward => ({ itemId: reward.itemId, quantity: reward.quantity })),
        slayerXpGained,
        isBossKill,
        raidId,
        loading: false
      })
    } catch (err) {
      setLootModal(null)
      addToast(`Raid claim failed: ${err?.message || 'server_error'}`, 'error')
    } finally {
      // Release any boss-skip lock awaiting this completion (no-op otherwise).
      resolveCombatCompletion()
    }
  }

  // Guards the full-raid skip so rapid clicks (top-nav and/or loot modal) can't
  // fire overlapping charge/claim round-trips — overlapping server writes were
  // the source of the save_revision conflict. Held for the entire sequence.
  const raidSkipBusyRef = useRef(false)

  // Shared full-raid skip used by BOTH the top-nav Skip (mid-raid) and the
  // loot-modal Skip (after a completion): charge the raid's skipCost
  // server-side, then re-roll one complete raid reward (no per-boss
  // re-simulation). Serialized end-to-end via raidSkipBusyRef.
  const skipEntireRaid = async ({ raidId, monster, slayerXpGained = 0, isBossKill = false } = {}) => {
    if (!raidId || raidSkipBusyRef.current) return
    const charge = chargeSkipRef?.current
    if (!charge) return
    raidSkipBusyRef.current = true
    // Freeze the game for the WHOLE raid skip (charge → claim): block input and
    // suspend competing autosaves until the server completion responds, so
    // nothing races the authoritative write.
    lockGame()
    const prevModal = lootModal
    const prevCombat = combatRef.current
    // Freeze the live raid immediately so no boss death fires during the server
    // round-trip (which would trigger a second, conflicting completion).
    if (prevCombat?.active) {
      const frozen = { ...prevCombat, active: false }
      combatRef.current = frozen
      setCombat(frozen)
    }
    setLootModal({ monster, loot: [], slayerXpGained, isBossKill, raidId, loading: true })
    try {
      await charge({ raidId })
    } catch (err) {
      // Nothing was spent — restore the live raid and the previous modal.
      if (prevCombat?.active) {
        combatRef.current = prevCombat
        setCombat(prevCombat)
      }
      setLootModal(prevModal)
      if (err?.status === 402) addToast('Not enough credits to skip this raid.', 'error')
      else addToast(err?.message || 'Error during skip!', 'error')
      raidSkipBusyRef.current = false
      unlockGame()
      return
    }
    try {
      setActiveTask(null)
      await claimRaidCompletion({ raidId, monster, slayerXpGained, isBossKill })
    } finally {
      raidSkipBusyRef.current = false
      // Pairs with this handler's lockGame — a conflict rollback re-applies
      // the cloud copy in place under its own overlay.
      unlockGame()
    }
  }

  // Loot-modal "skip". For a raid, skip the ENTIRE raid via skipEntireRaid. For
  // a single boss/monster, re-arm the fight and trigger the same skip the
  // top-nav uses (boss instant-kill or 1-hour idle skip), so the player can
  // chain skips without manually clicking Fight Again then Skip.
  const skipAgain = async () => {
    const modal = lootModal
    if (!modal || modal.loading) return

    if (modal.raidId) {
      setLootModal(null)
      await new Promise(r => requestAnimationFrame(r))
      await skipEntireRaid({
        raidId: modal.raidId,
        monster: modal.monster,
        slayerXpGained: modal.slayerXpGained || 0,
        isBossKill: modal.isBossKill,
      })
      return
    }

    setLootModal(null)
    const original = monstersData[modal.monster.id]
    if (original) continueFight(original)
    skipHourHandlerRef?.current?.()
  }

  // Register the full-raid skip for the top-nav Skip button. The nav button
  // (App.handleSkip1h) calls this when the active task is a raid, deriving the
  // raid from the live combat state. Mirrors combatSkipHandlerRef wiring.
  const navRaidSkipRef = useRef(null)
  navRaidSkipRef.current = () => {
    const st = combatRef.current
    const raidId = st?.raid?.raidId
    if (!raidId) return Promise.resolve()
    return skipEntireRaid({ raidId, monster: st?.monster, isBossKill: true })
  }
  useEffect(() => {
    if (!raidSkipHandlerRef) return
    raidSkipHandlerRef.current = () => navRaidSkipRef.current?.()
    return () => { raidSkipHandlerRef.current = null }
  }, [])

  const stopAndBack = () => {
    setCombat(null)
    setLog([])
    setActiveTask(null)
    const back = onStopBack || onBack
    if (back) back()
  }

  // Drink a brew: heals immediately, wipes all active potion effects. The heal +
  // wipe rules live in the shared consumables engine (used by PvE and PvP alike).
  const consumeBrewAt = (idx, newInv) => {
    const brewId = newInv[idx].itemId
    const brew = itemsData[brewId]
    if (!brew) return
    // A brew is a combo item — one per combo-delay; drop extra taps.
    if (combatRef.current?.active && (combatRef.current.comboCooldown || 0) > 0) return
    if (newInv[idx].quantity > 1) {
      newInv[idx] = { ...newInv[idx], quantity: newInv[idx].quantity - 1 }
    } else {
      newInv[idx] = null
    }
    updateInventory(newInv)
    inventoryRef.current = newInv

    const healing = brew.boost || 10
    const actor = { hp: hpRef.current, maxHP: getMaxHP(), activePotions: { ...(combatRef.current?.activePotions || {}) } }
    applyConsumableEffect(actor, brew, brewId, 'drink')
    updateHP(actor.hp)
    hpRef.current = actor.hp

    if (combatRef.current) {
      // Carry the wiped potion set into combat state. A brew is a combo item, so
      // it uses the combo cooldown — it can be drunk on the same tick as a normal
      // food and does not delay the next attack.
      const afterCombo = applyCombo({ ...combatRef.current, activePotions: actor.activePotions })
      setCombat(afterCombo)
      combatRef.current = afterCombo
    }

    setLog(prev => [...prev.slice(-20), {
      text: `Drank ${brew.name}, healed ${healing} HP (potions cleared)`,
      type: 'heal',
      time: Date.now(),
    }])
  }

  const handleEat = () => {
    const newInv = [...inventoryRef.current]
    let idx = newInv.findIndex(s => s && itemsData[s.itemId]?.type === 'food')
    if (idx !== -1) return consumeFoodAt(idx, newInv)
    idx = newInv.findIndex(s => s && isLumiraBrew(itemsData[s.itemId]))
    if (idx !== -1) return consumeBrewAt(idx, newInv)
    addToast('No food!', 'error')
  }

  const handleEatItem = (itemId) => {
    const item = itemsData[itemId]
    const newInv = [...inventoryRef.current]
    const idx = newInv.findIndex(s => s && s.itemId === itemId)
    if (idx === -1) return
    if (item?.type === 'food') return consumeFoodAt(idx, newInv)
    if (isLumiraBrew(item)) return consumeBrewAt(idx, newInv)
  }

  // Shared eat path used by both the Eat button and direct inventory clicks.
  // Mirrors the original handleEat: decrement inventory, heal up to max,
  // applyEat() to bind the post-eat tick delay, and append the heal log line.
  const consumeFoodAt = (foodIdx, newInv) => {
    const foodId = newInv[foodIdx].itemId
    const food = itemsData[foodId]
    if (!food) return
    // Spam guard (shared rule with PvP): one normal food per eat-delay, one combo
    // item per combo-delay. Extra taps inside the delay window are dropped.
    const combo = isComboConsumable(food)
    if (combatRef.current?.active) {
      const cd = combo ? (combatRef.current.comboCooldown || 0) : (combatRef.current.eatCooldown || 0)
      if (cd > 0) return
    }
    if (newInv[foodIdx].quantity > 1) {
      newInv[foodIdx] = { ...newInv[foodIdx], quantity: newInv[foodIdx].quantity - 1 }
    } else {
      newInv[foodIdx] = null
    }
    updateInventory(newInv)
    inventoryRef.current = newInv
    const actor = { hp: hpRef.current, maxHP: getMaxHP(), activePotions: {} }
    applyConsumableEffect(actor, food, foodId, 'eat')
    updateHP(actor.hp)
    hpRef.current = actor.hp

    if (combatRef.current) {
      // Combo food (e.g. Karam) uses the combo cooldown so it can be eaten on the
      // same tick as a normal food; normal food uses the standard eat delay. Build
      // from combatRef.current (not the stale `combat` closure) so a normal food
      // and a combo food eaten on the same tick don't clobber each other's state.
      const base = combatRef.current
      const newState = combo ? applyCombo(base) : applyEat(base)
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
    if (!canAffordSpecialAttack(weapon.specialAttack, energy)) return

    // Scale-charged weapons must have at least one charge to fire a spec
    if (weapon.scaleCharged && (weaponEntry.charges || 0) <= 0) {
      const chargeItemId = weapon.chargeItemId || 'venomcoil_scales'
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

  const handleSummon = (creatureId) => {
    if (!combatRef.current || !combatRef.current.active) return
    const creature = getSummoningCreature(creatureId)
    if (!creature) return
    if (getLevelFromXP(stats.summoning?.xp || 0) < creature.level) {
      addToast(`Requires Summoning ${creature.level}`, 'error')
      return
    }
    if (combatRef.current.summon) {
      addToast('A creature is already summoned', 'error')
      return
    }
    if (countItem(inventoryRef.current, creature.pouch) <= 0) {
      addToast(`No ${itemsData[creature.pouch]?.name || 'pouch'} in your inventory`, 'error')
      return
    }
    const newInv = [...inventoryRef.current]
    removeItem(newInv, creature.pouch, 1)
    updateInventory(newInv)
    inventoryRef.current = newInv
    // Summoning XP is granted only here — the act of summoning.
    grantXP('summoning', creature.summonXp)
    const newState = { ...combatRef.current, summon: createSummonState(creatureId) }
    combatRef.current = newState
    setCombat({ ...newState })
    setShowSummonModal(false)
    setLog(prev => [...prev.slice(-20), { text: `You summon a ${creature.name}!`, type: 'victory', time: Date.now() }])
  }

  const handlePotion = (potionItemId) => {
    if (!combatRef.current || !combatRef.current.active) return

    const newInv = [...inventoryRef.current]
    const potionIdx = newInv.findIndex(s => s && s.itemId === potionItemId)
    if (potionIdx === -1) return

    const potion = itemsData[potionItemId]
    if (!potion) return

    // Lumira Brew: heals + wipes active potion effects — routed through the brew path.
    if (isLumiraBrew(potion)) {
      consumeBrewAt(potionIdx, newInv)
      return
    }

    // Potions are combo items — one per combo-delay; drop extra taps.
    if (combatRef.current.comboCooldown > 0) return

    // Remove potion from inventory — unlimited-use items (e.g. Imbued Brain) never deplete.
    if (!potion.unlimited) {
      if (newInv[potionIdx].quantity > 1) {
        newInv[potionIdx] = { ...newInv[potionIdx], quantity: newInv[potionIdx].quantity - 1 }
      } else {
        newInv[potionIdx] = null
      }
      updateInventory(newInv)
      inventoryRef.current = newInv
    }

    // Apply the drink (buff registration + immediate HP heal + prayer restore)
    // via the shared consumables engine, then carry the result into combat state.
    const actor = {
      hp: hpRef.current, maxHP: getMaxHP(),
      activePotions: { ...(combatRef.current.activePotions || {}) },
      prayerPoints: combatRef.current.prayerPoints,
      maxPrayerPoints: combatRef.current.maxPrayerPoints,
    }
    const drinkResult = applyConsumableEffect(actor, potion, potionItemId, 'drink')
    updateHP(actor.hp)
    hpRef.current = actor.hp
    // Potions are combo items — combo cooldown, no attack delay, same-tick as food.
    const newState = applyCombo({ ...combatRef.current, activePotions: actor.activePotions, prayerPoints: actor.prayerPoints })

    if (potion.effect === 'hp') {
      setLog(prev => [...prev.slice(-20), {
        text: `Drank ${potion.name}, healed ${potion.boost || 10} HP`,
        type: 'heal',
        time: Date.now()
      }])
    } else {
      const restored = drinkResult?.prayerRestored || 0
      setLog(prev => [...prev.slice(-20), {
        text: restored > 0 ? `Drank ${potion.name}, +${restored} prayer` : `Drank ${potion.name}`,
        type: 'heal',
        time: Date.now()
      }])
    }

    combatRef.current = newState
    setCombat(newState)
    setShowPotionModal(false)
  }

  // Boss/raid skip: set monster HP to 0 and arm player attack timer so the next
  // engine tick fires the kill and routes through the full death event pipeline.
  const forceKillHandlerRef = useRef(null)
  forceKillHandlerRef.current = () => {
    const state = combatRef.current
    if (!state || !state.active || !state.monster) return false
    state.monster.currentHP = 0
    state.playerAttackTimer = 0
    state.eatCooldown = 0
    combatRef.current = state
    setCombat({ ...state })
    return true
  }

  useEffect(() => {
    if (!combatSkipHandlerRef) return
    combatSkipHandlerRef.current = () => forceKillHandlerRef.current?.()
    return () => { combatSkipHandlerRef.current = null }
  }, [])

  const handleEquipItem = (itemId) => {
    if (!combat) return false
    const newInv = [...inventoryRef.current]
    const itemIdx = newInv.findIndex(s => s && s.itemId === itemId)
    if (itemIdx === -1) return false

    const itemData = itemsData[itemId]
    if (!itemData || !itemData.slot) return false

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
      return false
    }

    // Copy equipment to avoid mutating ref directly
    const newEq = { ...equipmentRef.current }
    const sourceSlot = newInv[itemIdx]
    const result = equipItem(newEq, itemData, itemsData, sourceSlot)

    if (!result.equipped) {
      addToast('Could not equip item', 'error')
      return false
    }

    // Remove the equipped item from inventory. Ammo equips the WHOLE stack
    // (equipItem preserves sourceSlot.quantity into the ammo slot), so clear the
    // entire inventory slot — otherwise the stack would be both worn and left in
    // the bag (the "lose one, double the rest" bug). All other gear moves one unit.
    if (itemData.slot === 'ammo') {
      newInv[itemIdx] = null
    } else if (newInv[itemIdx].quantity > 1) {
      newInv[itemIdx] = { ...newInv[itemIdx], quantity: newInv[itemIdx].quantity - 1 }
    } else {
      newInv[itemIdx] = null
    }

    // Add any unequipped items back to inventory. If there's nowhere to put
    // one (e.g. switching to a 2H weapon displaces both the old weapon and a
    // shield, but only one slot was freed above), abort the whole swap rather
    // than silently dropping the item that didn't fit.
    const placed = placeUnequippedItems(result.unequipped, newInv, itemsData)
    if (!placed.ok) {
      addToast('Inventory full', 'error')
      return false
    }

    updateInventory(placed.inventory)
    inventoryRef.current = placed.inventory
    updateEquipment(newEq)
    equipmentRef.current = newEq

    return true
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
  }

  const handlePrayer = (prayerId) => {
    if (!combatRef.current) return
    const prayer = prayersData[prayerId]
    if (!prayer) return

    let newState = { ...combatRef.current }

    const isProtection = prayer.bonusType === 'protection'
    const currentlyActive = isProtection
      ? combatRef.current.activeProtectionPrayer === prayerId
      : combatRef.current.activeCombatPrayer === prayerId

    // Block turning a prayer ON with an empty pool (toggling OFF is always allowed).
    if (!currentlyActive && (combatRef.current.prayerPoints ?? 0) <= 0) {
      addToast('Out of prayer points!', 'error')
      return
    }

    if (isProtection) {
      newState.activeProtectionPrayer = currentlyActive ? null : prayerId
    } else {
      newState.activeCombatPrayer = currentlyActive ? null : prayerId
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
              <div class="text-[11px] text-[#f5e6c8] opacity-70 mt-1">
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

  // Don't render the combat screen until the server kill-count fetch has
  // settled (success or fail) — on a cold cache boss KC would briefly show 0.
  // Scoped to this screen so global startup time is unaffected.
  if (!killCountsLoaded && !combat) {
    return (
      <div class="h-full flex flex-col items-center justify-center gap-3">
        <div class="w-8 h-8 border-2 border-[var(--color-gold)] border-t-transparent rounded-full animate-spin" />
        <div class="text-sm text-[var(--color-parchment)] opacity-70">Loading kill counts…</div>
      </div>
    )
  }

  // Monster picker
  if (!combat) {
    return (
      <>
      {/* Mobile uses the artsy CombatMobileSelect; desktop keeps the responsive
          grid below unchanged. Shared modals (info / raid / idle / PvP) follow. */}
      {!isDesktopCombatLayout ? (
        <div class="forge-shell h-full overflow-y-auto">
          <CombatMobileSelect
            categories={filteredPickerCategories}
            monstersData={monstersData}
            raidsData={filteredPickerRaids}
            collapsedSections={monsterSearchActive ? searchCollapsedSections : collapsedSections}
            defaultCollapsed={monsterSearchActive ? false : !isDungeon}
            title={isDungeon ? pickerTitle : undefined}
            searchValue={monsterSearch}
            onSearchChange={handleMonsterSearchChange}
            onToggleSection={toggleSection}
            onFight={startFight}
            onMonsterInfo={setSelectedMonsterInfo}
            onStartRaid={startRaid}
            onRaidInfo={setSelectedRaidInfo}
            checkBossRequirements={checkBossRequirements}
            checkRaidRequirements={checkRaidRequirements}
            getSlayerLevel={getSlayerLevel}
            doesSlayerTaskMatchMonster={doesSlayerTaskMatchMonster}
            slayerTask={slayerTask}
            bossKillCounts={bossKillCounts}
            raidKillCounts={raidKillCounts}
            combatStance={combatStance}
            onStance={updateCombatStance}
            idleSetup={idleCombatSetup}
            onOpenIdle={setIdleSetupMode}
            showPvp={!isIronman && !isOneLife && !isDemo && !isDungeon}
            onOpenPvp={() => setShowPvpLobby(true)}
            demoLockBosses={isDemo}
            onBack={onStopBack || onBack}
          />
        </div>
      ) : (
      <div class="forge-shell h-full overflow-y-auto p-4">
        <BackLink onClick={onStopBack || onBack} className="mb-3" />
        <h2 class="font-[var(--font-display)] text-sm font-bold text-[var(--color-parchment)] opacity-60 uppercase tracking-wider mb-3">
          {pickerTitle}
        </h2>

        <input
          type="search"
          value={monsterSearch}
          onInput={(e) => handleMonsterSearchChange(e.currentTarget.value)}
          placeholder="Search monsters…"
          aria-label="Search monsters and raids by name"
          class="w-full min-h-[44px] px-3 mb-3 rounded-xl bg-[var(--color-void-light)] border border-[var(--color-void-border)] text-[14px] text-[var(--color-parchment)] placeholder:text-[var(--color-parchment)] placeholder:opacity-40 focus:outline-none focus:border-[var(--color-gold)]"
        />

        {/* Idle setup buttons */}
        <div class="flex gap-1.5 mb-2">
          <button
            onClick={() => setIdleSetupMode('food')}
            class="flex-1 py-1.5 rounded-lg text-[10px] font-semibold bg-[var(--color-void-light)] text-[var(--color-parchment)] active:bg-[var(--color-void-lighter)] flex items-center justify-center gap-1.5"
            title="Configure food the simulator can use during idle/skip combat"
          >
            <GameIcon iconKey="meat" color={idleCombatSetup?.food?.length > 0 ? 'var(--color-gold)' : '#9b978c'} size={14} /> Idle Eat
            {idleCombatSetup?.food?.length > 0 && (
              <span class="ml-1 text-[var(--color-gold)]">✓</span>
            )}
          </button>
          <button
            onClick={() => setIdleSetupMode('prayer')}
            class="flex-1 py-1.5 rounded-lg text-[10px] font-semibold bg-[var(--color-void-light)] text-[var(--color-parchment)] active:bg-[var(--color-void-lighter)] flex items-center justify-center gap-1.5"
            title="Configure prayers the simulator should use during idle/skip combat"
          >
            <GameIcon iconKey="prayer" color={(idleCombatSetup?.prayers?.protectionPrayerId || idleCombatSetup?.prayers?.combatPrayerId) ? 'var(--color-gold)' : '#9b978c'} size={14} /> Idle Pray
            {(idleCombatSetup?.prayers?.protectionPrayerId || idleCombatSetup?.prayers?.combatPrayerId) && (
              <span class="ml-1 text-[var(--color-gold)]">✓</span>
            )}
          </button>
          <button
            onClick={() => setIdleSetupMode('potion')}
            class="flex-1 py-1.5 rounded-lg text-[10px] font-semibold bg-[var(--color-void-light)] text-[var(--color-parchment)] active:bg-[var(--color-void-lighter)] flex items-center justify-center gap-1.5"
            title="Configure potions the simulator can drink during idle/skip combat"
          >
            <GameIcon iconKey="potion_ball" color={idleCombatSetup?.potions?.length > 0 ? 'var(--color-gold)' : '#9b978c'} size={14} /> Idle Potion
            {idleCombatSetup?.potions?.length > 0 && (
              <span class="ml-1 text-[var(--color-gold)]">✓</span>
            )}
          </button>
        </div>

        {/* Stance selector */}
        <div class="flex gap-1.5 mb-3">
          {[['accurate', 'attack'], ['aggressive', 'strength'], ['defensive', 'defence']].map(([s, skill]) => {
            const art = getSkillArt(skill)
            return (
              <button
                key={s}
                onClick={() => updateCombatStance(s)}
                class={`flex-1 py-1.5 rounded-lg text-[10px] font-semibold capitalize transition-colors flex items-center justify-center gap-1
                  ${combatStance === s ? 'bg-[var(--color-gold-dim)] text-white' : 'bg-[var(--color-void-light)] text-[var(--color-parchment)] opacity-50'}`}
              >
                <GameIcon iconKey={art.icon} color={art.accent} size={14} />
                {s}
              </button>
            )
          })}
        </div>

        <div class="space-y-4">
          {filteredPickerCategories.map(category => {
            const monsters = category.ids
              .map(id => monstersData[id])
              .filter(Boolean)
              .sort((a, b) => {
                if (category.key === 'slayer') {
                  return (a.slayerRequirement || 0) - (b.slayerRequirement || 0)
                }
                return a.combatLevel - b.combatLevel
              })
            const isCollapsed = isSectionCollapsed(category.key, !isDungeon)
            const categoryArt = getCategoryArt(category.key)
            return (
              <div key={category.key}>
                <button
                  type="button"
                  onClick={() => toggleSection(category.key)}
                  class="w-full flex items-center gap-2 mb-2 px-1 py-1 text-left rounded-lg active:bg-[var(--color-void-light)]"
                >
                  <SkillEmblem iconKey={categoryArt.icon} accent={categoryArt.accent} size={24} glow={0} />
                  <span class="text-xs font-semibold text-[var(--color-parchment)] uppercase tracking-wider opacity-60">{category.label}</span>
                  <CollapseChevron expanded={!isCollapsed} className="ml-auto text-[var(--color-parchment)] opacity-60" />
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
                    const demoBossLocked = isDemo && monster.boss === true
                    const isLocked = slayLocked || bossReq.locked || demoBossLocked
                    const isOnTask = doesSlayerTaskMatchMonster(slayerTask?.monsterId, monster.id)
                    return (
                    <div key={monster.id} class="flex gap-2 items-center" title={isLocked ? (bossReq.locked ? bossReq.reason : '') : ''}>
                      <button
                        onClick={() => !isLocked && startFight(monster)}
                        disabled={isLocked}
                        title={isLocked && bossReq.locked ? bossReq.reason : ''}
                        class={`flex-1 flex items-center justify-between p-3 rounded-xl border transition-colors
                          ${isOnTask ? 'bg-[var(--fm-parch-hi)] border-[var(--color-gold-dim)]' :
                            isLocked ? 'bg-[var(--color-void)] border-[var(--color-void-light)] opacity-50' :
                            'bg-[var(--color-void-light)] border-[var(--color-void-border)] active:bg-[var(--color-void-lighter)]'}`}
                      >
                        <div class="flex items-center gap-3">
                          <SkillEmblem iconKey={getMonsterArt(monster, category.key).icon} accent={getMonsterArt(monster, category.key).accent} size={36} glow={0} />
                          <div class="text-left">
                            <div class="flex items-center gap-1.5">
                              <span class="text-sm font-semibold text-[var(--color-parchment)]">{monster.name}</span>
                              {isOnTask && <span class="text-[9px] bg-yellow-500 text-black font-bold px-1 rounded">TASK</span>}
                            </div>
                            <div class="text-[10px] text-[var(--color-parchment)]">
                              HP {monster.hitpoints} · Att {monster.stats.attack} · Def {monster.stats.defence}
                            </div>
                            {getMonsterLocationLabel(monster) && (
                              <div class="text-[9px] text-[var(--color-parchment)] opacity-50">
                                📍 {getMonsterLocationLabel(monster)}
                              </div>
                            )}
                            {slayReq && (
                              <div class={`text-[9px] font-semibold ${slayLocked ? 'text-[var(--color-blood-light)]' : 'text-[var(--color-hp-green)]'}`}>
                                💀 Slayer {slayReq}{slayLocked ? '' : ' ✓'}
                              </div>
                            )}
                            {bossReq.locked && !slayLocked && !slayReq && (
                              <div class="text-[9px] font-semibold text-[var(--color-blood-light)]">
                                🔒 {monster.id === 'blighted_gauntlet' ? 'Hymn of the Elves' :
                                     monster.id === 'ashen_crucible' ? 'Defeat Ember Tyrant' :
                                     (monster.id === 'adamant_dragon' || monster.id === 'rune_dragon') ? 'Dragon Slayer II' :
                                     monster.id === 'hellbound_gorilla' ? 'Monkey Madness II' : 'Locked'}
                              </div>
                            )}
                            {demoBossLocked && !bossReq.locked && !slayLocked && (
                              <div class="text-[9px] font-semibold text-[var(--color-blood-light)]">
                                🔒 Free account
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
                        <GameIcon iconKey="info" color="var(--fm-ember)" size={18} />
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

        {/* Raids Section — hidden in a dungeon with no raids, or while a search has no raid matches. */}
        {(monsterSearchActive ? Object.keys(filteredPickerRaids).length > 0 : (!isDungeon || Object.keys(pickerRaids).length > 0)) && (
        <div class="mt-6">
          <button
            type="button"
            onClick={() => toggleSection('raids')}
            class="w-full flex items-center gap-2 mb-3 px-1 py-1 text-left rounded-lg active:bg-[var(--color-void-light)]"
          >
            <SkillEmblem iconKey="temple_gate" accent="#9b6cff" size={24} glow={0} />
            <span class="text-xs font-semibold text-[var(--color-gold)] uppercase tracking-wider">Raids</span>
            <CollapseChevron expanded={!isSectionCollapsed('raids', !isDungeon)} className="ml-auto text-[var(--color-parchment)] opacity-60" />
          </button>
          {!isSectionCollapsed('raids', !isDungeon) && (
            <div class="space-y-2">
            {Object.values(filteredPickerRaids).filter((raid, index, allRaids) =>
              allRaids.findIndex(candidate => candidate.id === raid.id) === index
            ).map(raid => {
              const raidReq = checkRaidRequirements(raid)
              const demoRaidLocked = isDemo
              const isRaidLocked = raidReq.locked || demoRaidLocked
              const raidLockReason = raidReq.locked ? raidReq.reason : demoRaidLocked ? 'Available with a free account' : ''
              return (
                <div key={raid.id} class="flex gap-2 items-center" title={isRaidLocked ? raidLockReason : ''}>
                  <button
                    onClick={() => !isRaidLocked && startRaid(raid)}
                    disabled={isRaidLocked}
                    title={isRaidLocked ? raidLockReason : ''}
                    class={`flex-1 p-3 rounded-xl border transition-colors text-left flex items-center justify-between
                      ${isRaidLocked ? 'bg-[var(--color-void)] border-[var(--color-void-light)] opacity-50' : 'bg-[var(--color-void-light)] border-[var(--color-void-border)] active:bg-[var(--color-void-lighter)]'}`}
                  >
                    <div class="flex-1 flex items-center gap-2">
                      <SkillEmblem iconKey={getRaidArt(raid.id).icon} accent={getRaidArt(raid.id).accent} size={36} glow={0} />
                      <div>
                        <div class="text-sm font-semibold text-[var(--color-parchment)]">{raid.name}</div>
                        <div class={`text-[10px] ${isRaidLocked ? 'text-[var(--color-blood-light)]' : 'text-[var(--color-parchment)]'}`}>{isRaidLocked ? '🔒 ' + raidLockReason : raid.description}</div>
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
                    <GameIcon iconKey="info" color="var(--fm-royal)" size={18} />
                  </button>
                </div>
              )
            })}
            </div>
          )}
        </div>
        )}

        {/* PvP entry — hidden for ironman / one-life accounts, the demo, and dungeons. */}
        {!isIronman && !isOneLife && !isDemo && !isDungeon && (
          <div class="mt-6 pb-2">
            <button
              onClick={() => setShowPvpLobby(true)}
              class="cb-raid__enter flex items-center justify-center gap-2"
              style={{ marginTop: 0, background: 'linear-gradient(180deg,#c0392b,#8b1a1a)', color: 'var(--color-parchment)', boxShadow: '0 8px 20px -8px rgba(192,57,43,0.6), inset 0 1px 0 rgba(255,255,255,0.15)' }}
              title="Player vs Player"
            >
              <GameIcon iconKey="crossed_swords" color="var(--color-parchment)" size={18} />
              <span>Player vs Player</span>
            </button>
            <div class="text-[9px] text-[var(--color-parchment)] opacity-90 mt-1.5 text-center px-2">
              On death, your tradeable inventory + equipped gear go to the winner. Untradeables stay with you.
            </div>
          </div>
        )}
      </div>
      )}

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

      {/* Monster Info — mobile gets the artsy slide-up bestiary sheet; desktop
          keeps the <Modal> below. */}
      {selectedMonsterInfo && !isDesktopCombatLayout && (
        <CombatMonsterInfoSheet
          monster={selectedMonsterInfo}
          categoryKey={getMonsterCategoryKey(selectedMonsterInfo.id)}
          itemsData={itemsData}
          onClose={() => setSelectedMonsterInfo(null)}
        />
      )}

      {/* Monster Info Modal — desktop only (shown from picker view) */}
      {selectedMonsterInfo && isDesktopCombatLayout && (
        <Modal onClose={() => setSelectedMonsterInfo(null)}>
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-[var(--font-display)] text-base font-bold text-[var(--color-gold)] flex items-center gap-2">
              <SkillEmblem iconKey={getMonsterArt(selectedMonsterInfo).icon} accent={getMonsterArt(selectedMonsterInfo).accent} size={28} glow={0} /> {selectedMonsterInfo.name}
            </h3>
            <button
              onClick={() => setSelectedMonsterInfo(null)}
              class="w-6 h-6 flex items-center justify-center rounded-lg bg-[var(--color-void-light)] text-[var(--color-parchment)] hover:bg-[var(--color-void-lighter)] active:bg-[var(--color-void-border)] transition-colors"
              title="Close"
            >
              ✕
            </button>
          </div>
          <div class="space-y-4 max-h-96 overflow-y-auto">
            {getMonsterLocationLabel(selectedMonsterInfo) && (
              <div class="text-[11px] text-[var(--color-parchment)] opacity-60">📍 {getMonsterLocationLabel(selectedMonsterInfo)}</div>
            )}
            <div>
              <h4 class="text-xs font-semibold text-[var(--color-gold-dim)] uppercase tracking-wider mb-2 opacity-70">Combat Stats</h4>
              <div class="bg-[var(--color-void)] rounded-lg p-3 space-y-1">
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
              <div class="bg-[var(--color-void)] rounded-lg p-3 space-y-1">
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
            <MonsterPhaseStats monster={selectedMonsterInfo} />
            {selectedMonsterInfo.drops && selectedMonsterInfo.drops.length > 0 && (
              <div>
                <h4 class="text-xs font-semibold text-[var(--color-gold-dim)] uppercase tracking-wider mb-2 opacity-70">Drops</h4>
                <div class="space-y-1">
                  {[...(selectedMonsterInfo.drops || []), ...getMonsterSeedDrops(selectedMonsterInfo), ...getMonsterCharmDrops(selectedMonsterInfo)].map(drop => {
                    const item = itemsData[drop.itemId]
                    return (
                      <div key={drop.itemId} class="bg-[var(--color-void)] rounded-lg p-2">
                        <div class="flex items-start justify-between gap-2">
                          <div class="flex items-center gap-1.5 text-left flex-1 min-w-0">
                            <GameIcon item={item} iconKey={item?.iconId} size={16} />
                            <div class="min-w-0">
                              <div class="text-[11px] font-semibold text-[var(--color-parchment)]">{item?.name || drop.itemId}</div>
                              <div class="text-[9px] text-[var(--color-parchment)] opacity-60 mt-0.5">
                                {formatDropChance(drop.chance)}
                                {Array.isArray(drop.quantity) ? ` · ${drop.quantity[0]}–${drop.quantity[1]} ea` : ` · ${drop.quantity}`}
                                {drop.taskOnly ? ' · Slayer task only' : ''}
                              </div>
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

      {/* Raid Info — mobile gets the artsy slide-up sheet; desktop keeps <Modal>. */}
      {selectedRaidInfo && !isDesktopCombatLayout && (
        <CombatRaidInfoSheet
          raid={selectedRaidInfo}
          monstersData={monstersData}
          itemsData={itemsData}
          raidKillCounts={raidKillCounts}
          onStartRaid={(raid) => { setSelectedRaidInfo(null); startRaid(raid) }}
          onClose={() => setSelectedRaidInfo(null)}
        />
      )}

      {/* Raid Info Modal — desktop only */}
      {selectedRaidInfo && isDesktopCombatLayout && (
        <Modal onClose={() => setSelectedRaidInfo(null)}>
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-[var(--font-display)] text-base font-bold text-[var(--color-gold)] flex items-center gap-2">
              <SkillEmblem iconKey={getRaidArt(selectedRaidInfo.id).icon} accent={getRaidArt(selectedRaidInfo.id).accent} size={28} glow={0} /> {selectedRaidInfo.name}
            </h3>
            <button
              onClick={() => setSelectedRaidInfo(null)}
              class="w-6 h-6 flex items-center justify-center rounded-lg bg-[var(--color-void-light)] text-[var(--color-parchment)] hover:bg-[var(--color-void-lighter)] active:bg-[var(--color-void-border)] transition-colors"
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
                  const bossArt = getMonsterArt(boss)
                  return (
                    <div key={bossId} class="bg-[var(--color-void)] rounded-lg p-2 flex items-center justify-between">
                      <div class="flex items-center gap-2">
                        <SkillEmblem iconKey={bossArt.icon} accent={bossArt.accent} size={22} glow={0} />
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
                      <div key={drop.itemId} class="bg-[var(--color-void)] rounded-lg p-2 flex items-center justify-between">
                        <div class="flex items-center gap-1.5 text-[11px] text-[var(--color-parchment)]">
                          <GameIcon item={item} iconKey={item?.iconId} size={16} /> {item?.name || drop.itemId}
                        </div>
                        <div class="text-[9px] text-[var(--color-parchment)] opacity-50">
                          {formatDropChance(drop.chance)}
                          {Array.isArray(drop.quantity) ? ` · ${drop.quantity[0]}–${drop.quantity[1]}` : ` · ${drop.quantity}`}
                        </div>
                      </div>
                    )
                  })}
                  {selectedRaidInfo.rewards.unique && (
                    <div class="bg-[var(--fm-parch-hi)] border border-[var(--color-gold-dim)] rounded-lg p-2 mt-1">
                      <div class="text-[10px] font-semibold text-[var(--color-gold)] mb-1">
                        ✨ Unique Drop ({(selectedRaidInfo.rewards.unique.chance * 100).toFixed(1)}% chance)
                      </div>
                      <div class="space-y-0.5">
                        {selectedRaidInfo.rewards.unique.items.map(u => {
                          const item = itemsData[u.itemId]
                          return (
                            <div key={u.itemId} class="flex items-center gap-1.5 text-[10px] text-[var(--color-parchment)] opacity-70">
                              <GameIcon item={item} iconKey={item?.iconId} size={14} /> {item?.name || u.itemId}
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

  // Combat view — GLB registry entry wins per-monster; a procedural
  // blend-shell spec (creatures3d.json) covers the rest.
  const arenaModel = combat?.active && combat.monster ? getMonsterModel(combat.monster.id) : null
  // currentForm keys multiForm bosses to their per-phase spec (creatures3d
  // `forms`); the arena swaps the creature in place on form transitions.
  const arenaProc = combat?.active && combat.monster && !arenaModel ? getCreatureSpec(combat.monster.id, combat.monster.currentForm) : null
  // Hero realism (2026-07 re-scope): the arena hero is the GLB human — the
  // blend-shell hero capped out at a mannequin read (docs/hero-realism-plan.md).
  // Passing null here falls back to the GLB hero + bone-attach/skinned gear;
  // the procedural hero stays authorable via render-proc.mjs --hero.
  const arenaHeroProc = null
  const arenaMonsterId = combat?.active && combat.monster ? combat.monster.id : null
  const arenaBiome = useMemo(() => getArenaBiomeSpec(worldLocation, arenaMonsterId), [worldLocation, arenaMonsterId])
  const arenaAvailable = Boolean(arenaModel || arenaProc) && Boolean(arenaHeroProc || getCharacterAssetPath()) && canRender3D()
  const showArena = arenaAvailable && !arenaClosed
  const reopenArena = () => {
    setArenaClosed(false)
    try { localStorage.removeItem('pocketrpg_combat3d') } catch { /* private mode */ }
  }
  const closeArena = () => {
    setArenaClosed(true)
    try { localStorage.setItem('pocketrpg_combat3d', 'off') } catch { /* private mode */ }
  }
  const arenaChip = arenaAvailable && (
    <button
      class="px-2 py-1 rounded-lg bg-[var(--color-void)] border border-[var(--color-void-border)] text-[10px] font-semibold text-[var(--color-gold)] active:bg-[var(--color-void-border)]"
      onClick={arenaClosed ? reopenArena : closeArena}
      aria-label={arenaClosed ? 'Switch to 3D battle view' : 'Switch to progress bars'}
    >
      {arenaClosed ? '🎥 3D' : '📊 Bars'}
    </button>
  )
  // Inline 3D arena — replaces the HP-bar block in whichever layout renders.
  const heroSpec = getCharacterModel() || {}
  const arenaPanel = showArena && (
    <CombatArena3D
      monsterName={combat.monster.name}
      monsterPath={arenaModel ? arenaModel.path : null}
      monsterProc={arenaProc}
      monsterHeight={(arenaModel || arenaProc).height}
      monsterRotationDeg={(arenaModel || arenaProc).rotationDeg}
      characterPath={getCharacterAssetPath()}
      characterRotationDeg={heroSpec.rotationDeg}
      heroProc={arenaHeroProc}
      biome={arenaBiome}
      clips={{ idle: heroSpec.combatIdleClip || heroSpec.idleClip, attack: heroSpec.attackClip, special: heroSpec.specialClip, hit: heroSpec.hitClip, death: heroSpec.deathClip }}
      weapon={equipment?.weapon ? getWeaponPlacement(equipment.weapon.itemId) : null}
      gear={getGearPlacements(equipment)}
      attackSignal={arenaSignal}
      windupSignal={arenaWindup}
      monsterAttackImpactSec={arenaModel ? arenaModel.attackImpactSec : null}
      monsterHP={{ current: Math.max(0, Math.round(combat.monster.currentHP)), max: combat.monster.hitpoints }}
      playerHP={{ current: Math.max(0, Math.round(currentHP)), max: getMaxHP() }}
      monsterSplats={monsterSplats}
      playerSplats={playerSplats}
      onReady={() => setArenaReady(true)}
      onFail={() => setArenaClosed(true)}
    />
  )

  return (
    <div class={`forge-shell h-full flex flex-col p-4 ${isDesktopCombatLayout ? 'overflow-hidden' : ''}`}>
      {/* Back button */}
      <BackLink onClick={stopAndBack} className="mb-3" />

      {/* Pane container — single flex column on mobile, 3-pane grid on desktop.
          DOM order is [stats, inventory, console] so mobile flow stays
          [stats, console] (the inventory pane is desktop-only). At md+,
          explicit grid placement puts:
            col 1 = stats + paperdoll
            col 2 = inventory grid (click equippables to equip) + prayers
            col 3 = special bar + combat log + kills + action buttons.
          Desktop keeps this layout untouched; mobile renders the redesigned
          single-column HUD (fight header + HP bars + quick-actions) below. */}
      {isDesktopCombatLayout ? (
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
                <span class="ml-2 text-[10px] font-[var(--font-mono)]" style={{ color: getStyleArt(form.attackStyle).color }}>
                  {form.icon} {form.displayName}{form.immunity ? ` · 🛡️ immune to ${form.immunity}` : ''}
                </span>
              )
            })()}
          </span>
          <span class="flex items-center gap-2">
            {arenaChip}
            <span class="text-[10px] font-[var(--font-mono)] text-[var(--color-blood-light)]">CB {combat.monster.combatLevel}</span>
          </span>
        </div>
        {!showArena && (
          <div class="relative">
            <HPBar current={Math.max(0, combat.monster.currentHP)} max={combat.monster.hitpoints} size="large" />
            <HitSplatLayer splats={monsterSplats} />
          </div>
        )}
      </div>

      {/* Inline 3D arena replaces both HP bars (its own bars ride the scene) */}
      {arenaPanel && <div class="mb-2">{arenaPanel}</div>}

      {/* Raid progress indicator */}
      {combat.raid && (
        <div class="mb-2 bg-[var(--color-void)] border border-[var(--color-void-border)] rounded-lg px-3 py-2">
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
                  'bg-[var(--color-void-border)]'
                }`}
                title={monstersData[bossId]?.name || bossId}
              />
            ))}
          </div>
        </div>
      )}

      {/* Player HP */}
      <div class="mb-2">
        <div class="flex items-center justify-between mb-0.5">
          {!showArena && <div class="text-[10px] text-[var(--color-parchment)] opacity-50">Your HP</div>}
          <ActivePotionBadges activePotions={combat?.activePotions} itemsData={itemsData} />
        </div>
        {!showArena && (
          <div class="relative">
            <HPBar current={currentHP} max={getMaxHP()} size="large" />
            <HitSplatLayer splats={playerSplats} />
          </div>
        )}
      </div>

      {/* Prayer pool — drains while prayers are active; restored by prayer/super restore potions */}
      {typeof combat?.maxPrayerPoints === 'number' && (
        <div class="mb-2">
          <div class="flex items-center justify-between mb-0.5">
            <div class="text-[10px] text-[var(--color-parchment)] opacity-50">🙏 Prayer</div>
            <div class="text-[10px] font-[var(--font-mono)] text-[var(--color-mana)]">
              {Math.ceil(combat.prayerPoints || 0)}/{combat.maxPrayerPoints}
            </div>
          </div>
          <div class="h-2 rounded-full bg-[rgba(255,255,255,0.07)] overflow-hidden">
            <div
              class="h-full rounded-full bg-gradient-to-r from-[#3b82f6] to-[#7ec8ff]"
              style={{ width: `${Math.max(0, Math.min(100, ((combat.prayerPoints || 0) / combat.maxPrayerPoints) * 100))}%` }}
            />
          </div>
        </div>
      )}

      {/* Slayer task indicator */}
      {doesSlayerTaskMatchMonster(slayerTask?.monsterId, combat.monster.id) && (
        <div class="mb-2 bg-[var(--fm-parch-hi)] border border-[var(--color-gold-dim)] rounded-lg px-3 py-1.5 flex items-center justify-between">
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
            const canSpec = hasSpec && canAffordSpecialAttack(weapon.specialAttack, energy)
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
                  🔮 Cast Spell
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

      <InventoryGrid
        inventory={inventory}
        size="normal"
        gridClass="grid grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 justify-items-center"
        onReorder={(from, to) => {
          const newInv = [...inventory]
          const tmp = newInv[to]
          newInv[to] = newInv[from]
          newInv[from] = tmp
          updateInventory(newInv)
        }}
        onSlotClick={(slot, item) => {
          // Notes can't be equipped/eaten/drunk, so they fall through to no-op.
          if (!item || slot.noted) return
          if (item.slot) handleEquipItem(slot.itemId)
          else if (item.type === 'food') handleEatItem(slot.itemId)
          else if (item.type === 'potion') handlePotion(slot.itemId)
        }}
      />

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
                  <div key={potionId} class="opacity-80 flex items-center justify-end gap-1">
                    <GameIcon item={potion} iconKey={potion?.iconId} size={12} /> {boosts.join(', ')} · {remainingSeconds}s
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
                          ? 'cb-prayon'
                          : canUse
                            ? 'bg-[var(--fm-parch-hi)] border-[var(--color-emerald)] active:bg-[var(--fm-parch)]'
                            : 'bg-[var(--color-void)] border-[var(--color-void-light)] opacity-30 cursor-default'
                      }`}
                    >
                      <div class="flex justify-center leading-none"><SkillIcon skill={prayerSkill(prayer)} size={18} /></div>
                      <div class={`text-[8px] opacity-70 mt-0.5 ${isActive ? 'text-[#1a1206]' : 'text-[var(--color-parchment)]'}`}>{protectType}</div>
                    </button>
                  )
                })}
              </div>
              <div class="grid grid-cols-6 gap-1">
                {combatPrayers.map(prayer => {
                  const canUse = prayerLevel >= prayer.level
                  const isActive = combat?.activeCombatPrayer === prayer.id
                  return (
                    <button
                      key={prayer.id}
                      onClick={() => canUse && handlePrayer(prayer.id)}
                      disabled={!canUse}
                      title={`${prayer.name} · Lv ${prayer.level}\n${prayer.description}`}
                      class={`px-1 py-1 rounded-md border text-center transition-colors ${
                        isActive
                          ? 'cb-prayon'
                          : canUse
                            ? 'bg-[var(--fm-parch-hi)] border-[var(--color-emerald)] active:bg-[var(--fm-parch)]'
                            : 'bg-[var(--color-void)] border-[var(--color-void-light)] opacity-30 cursor-default'
                      }`}
                    >
                      <div class="flex justify-center leading-none"><SkillIcon skill={prayerSkill(prayer)} size={18} /></div>
                      <div class={`text-[8px] opacity-70 mt-0.5 ${isActive ? 'text-[#1a1206]' : 'text-[var(--color-gold-dim)]'}`}>Lv {prayer.level}</div>
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
        const canSpec = canAffordSpecialAttack(weapon.specialAttack, energy)
        return (
          <div class="mb-2 bg-[var(--color-void)] rounded-lg px-3 py-2">
            <div class="flex items-center justify-between mb-1">
              <span class="text-[10px] text-yellow-400 font-semibold">⚡ Special Attack</span>
              <span class="text-[10px] font-[var(--font-mono)] text-yellow-400">{energy}%</span>
            </div>
            <div class="h-2 rounded-full bg-[var(--color-void-light)] overflow-hidden">
              <div
                class="h-full rounded-full transition-all duration-300"
                style={{ width: `${energy}%`, background: canSpec ? '#eab308' : '#78530a' }}
              />
            </div>
            <div class="text-[9px] text-[var(--color-parchment)] opacity-40 mt-0.5">
              {formatSpecialEnergyCostLabel(weapon.specialAttack)} · refills on kill
            </div>
          </div>
        )
      })()}

      {/* Combat log */}
      <div ref={logRef} class="flex-1 bg-[var(--color-void)] rounded-lg border border-[var(--color-void-light)] p-2 overflow-y-auto mb-2 min-h-[100px]">
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
              entry.type === 'error' ? 'text-[var(--color-blood-light)]' :
              'text-[var(--color-parchment)] opacity-50'}`}
          >
            {entry.text}
          </div>
        ))}
      </div>

      {/* Kill stats */}
      {fightStartedAt && (
        <div class="flex-shrink-0 flex justify-between bg-[var(--color-void)] rounded-lg px-3 py-2 mb-2 text-[11px]">
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
          const canSpec = hasSpec && canAffordSpecialAttack(weapon.specialAttack, energy)
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
              🔮 Cast Spell
            </button>
          )
          const prayerBtn = (
            <button onClick={() => setShowPrayerModal(true)}
              class="py-2.5 rounded-lg font-semibold text-sm active:opacity-80"
              style="background:linear-gradient(135deg,#1a3a2a,#2a5a3a);border:1px solid rgba(100,200,120,0.35);color:#7de8a0">
              🙏 Prayer
            </button>
          )
          const summonActive = !!combat?.summon
          const ownsPouch = SUMMONING_CREATURES.some(c => countItem(inventory, c.pouch) > 0)
          const summonSecs = summonActive ? Math.ceil((combat.summon.ticksLeft || 0) * 0.6) : 0
          const summonBtn = (ownsPouch || summonActive) ? (
            <button onClick={summonActive ? undefined : () => setShowSummonModal(true)} disabled={summonActive}
              class={`py-2.5 rounded-lg font-semibold text-sm ${summonActive ? 'opacity-70 cursor-default' : 'active:opacity-80'}`}
              style="background:linear-gradient(135deg,#12303a,#1f5566);border:1px solid rgba(120,200,224,0.4);color:#bfe0ee">
              🐾 {summonActive ? `${summonSecs}s` : 'Summon'}
            </button>
          ) : null

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
                {summonBtn && <div class="grid grid-cols-1 gap-2">{summonBtn}</div>}
              </div>
              {/* Desktop: only Spec + Cast remain (Gear/Prayer moved to side
                  panes; Eat/Potion are now click-an-inventory-item flows). */}
              <div class="hidden" />
            </>
          )
        })()}
      </div>

      </div>{/* /CENTRE pane */}
      </div>
      ) : (
      /* ── Mobile combat HUD (redesign): fight header + HP bars + quick-actions ── */
      <div class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden no-scrollbar">
        {(() => {
          const m = combat.monster
          const categoryKey = COMBAT_CATEGORIES.find(c => c.ids.includes(m.id))?.key
          const mArt = getMonsterArt(m, categoryKey)
          const form = m.multiForm && m.currentForm && m.forms?.[m.currentForm] ? m.forms[m.currentForm] : null
          return (
            <>
              {/* Fight header */}
              <div class="cb-fight__head">
                <div class="cb-fight__id">
                  <SkillEmblem iconKey={mArt.icon} accent={mArt.accent} size={34} glow={0} />
                  <div class="min-w-0">
                    <div class="cb-fight__name" style={{ color: getStyleArt(form ? form.attackStyle : m.attackStyle).color }}>{m.name}</div>
                  </div>
                </div>
                <span class="flex items-center gap-1.5 flex-shrink-0">
                  {arenaChip}
                  <button class="cb-fight__cb" onClick={() => setSelectedMonsterInfo(m)} aria-label={`${m.name} info`}>
                    CB {m.combatLevel}
                    <GameIcon iconKey="info" color="#e0564b" size={13} />
                  </button>
                </span>
              </div>

              {/* Raid progress */}
              {combat.raid && (
                <div class="mb-2 bg-[var(--color-void)] border border-[var(--color-void-border)] rounded-lg px-3 py-2">
                  <div class="flex items-center justify-between mb-1.5">
                    <span class="text-[10px] font-semibold text-[var(--color-gold)]">{raidsData[combat.raid.raidId]?.name || 'Raid'}</span>
                    <span class="text-[10px] font-[var(--font-mono)] text-[var(--color-parchment)] opacity-60">Boss {combat.raid.currentBossIndex + 1}/{combat.raid.bosses.length}</span>
                  </div>
                  <div class="flex gap-1">
                    {combat.raid.bosses.map((bossId, i) => (
                      <div key={bossId} class={`flex-1 h-1.5 rounded-full ${i < combat.raid.currentBossIndex ? 'bg-[var(--color-hp-green)]' : i === combat.raid.currentBossIndex ? 'bg-[var(--color-gold)]' : 'bg-[var(--color-void-border)]'}`} title={monstersData[bossId]?.name || bossId} />
                    ))}
                  </div>
                </div>
              )}

              {/* Inline 3D arena replaces both HP blocks (its own bars +
                  splats ride the scene); the 📊 chip swaps the bars back. */}
              {showArena ? (
                <>
                  <div class="mb-2">{arenaPanel}</div>
                  <ActivePotionBadges activePotions={combat?.activePotions} itemsData={itemsData} />
                </>
              ) : (
                <>
                  {/* Monster HP */}
                  <div class="cb-hpblock">
                    <div class="cb-hplabel">
                      <span>Enemy Hitpoints</span>
                      <span class="cb-hplabel__v">{Math.max(0, Math.round(m.currentHP))}/{m.hitpoints}</span>
                    </div>
                    <div class="relative">
                      <HPBar current={Math.max(0, m.currentHP)} max={m.hitpoints} size="large" />
                      <HitSplatLayer splats={monsterSplats} />
                    </div>
                  </div>

                  {/* Player HP */}
                  <div class="cb-hpblock">
                    <div class="cb-hplabel">
                      <span>Your Hitpoints</span>
                      <span class="cb-hplabel__right">
                        <ActivePotionBadges activePotions={combat?.activePotions} itemsData={itemsData} />
                        <span class="cb-hplabel__v" style={{ color: '#7ce88a' }}>{Math.max(0, Math.round(currentHP))}/{getMaxHP()}</span>
                      </span>
                    </div>
                    <div class="relative">
                      <HPBar current={currentHP} max={getMaxHP()} size="large" />
                      <HitSplatLayer splats={playerSplats} />
                    </div>
                  </div>
                </>
              )}

              {/* Prayer pool */}
              {typeof combat?.maxPrayerPoints === 'number' && (
                <div class="cb-hpblock">
                  <div class="cb-hplabel">
                    <span>🙏 Prayer</span>
                    <span class="cb-hplabel__v" style={{ color: '#7ec8ff' }}>{Math.ceil(combat.prayerPoints || 0)}/{combat.maxPrayerPoints}</span>
                  </div>
                  <div class="h-2 rounded-full bg-[rgba(255,255,255,0.07)] overflow-hidden">
                    <div
                      class="h-full rounded-full bg-gradient-to-r from-[#3b82f6] to-[#7ec8ff]"
                      style={{ width: `${Math.max(0, Math.min(100, ((combat.prayerPoints || 0) / combat.maxPrayerPoints) * 100))}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Slayer task indicator */}
              {doesSlayerTaskMatchMonster(slayerTask?.monsterId, m.id) && (
                <div class="mb-2 bg-[var(--fm-parch-hi)] border border-[var(--color-gold-dim)] rounded-lg px-3 py-1.5 flex items-center justify-between">
                  <span class="text-[10px] text-yellow-400 font-semibold">💀 Slayer Task</span>
                  <span class="text-[10px] font-[var(--font-mono)] text-yellow-400">{slayerTask.monstersRemaining} / {slayerTask.totalCount} remaining</span>
                </div>
              )}

              {/* Quick-actions panel — replaces the text combat log */}
              {combat.active && !isAutoRestarting && (
                <CombatQuickActions
                  inventory={inventory}
                  itemsData={itemsData}
                  onEat={(entry) => handleEatItem(entry.itemId)}
                  onPotion={(entry) => handlePotion(entry.itemId)}
                  onEquip={(entry) => handleEquipItem(entry.itemId)}
                  isPotionActive={(item) => Object.keys(combat?.activePotions || {}).some(pid => itemsData[pid]?.effect === item.effect)}
                />
              )}

              {/* Action row — Special / Cast / Prayer (Eat/Potion/Gear now live in the quick-actions tabs) */}
              {combat.active && !isAutoRestarting && (() => {
                const weaponEntry = equipment?.weapon
                const weapon = weaponEntry ? itemsData[weaponEntry.itemId] : null
                const hasSpec = !!weapon?.specialAttack
                const energy = combat.specialAttackEnergy || 0
                const canSpec = hasSpec && canAffordSpecialAttack(weapon.specialAttack, energy)
                const specQueued = !!combat?.specialAttackQueued
                const isMagic = weapon?.attackStyle === 'magic'
                const prayerActive = !!(combat?.activeProtectionPrayer || combat?.activeCombatPrayer)
                const summonActive = !!combat?.summon
                const ownsPouch = SUMMONING_CREATURES.some(c => countItem(inventory, c.pouch) > 0)
                const summonSecs = summonActive ? Math.ceil((combat.summon.ticksLeft || 0) * 0.6) : 0
                return (
                  <div class="cb-actions" style={{ marginTop: 12, marginBottom: 12 }}>
                    <button class={'cb-act' + (specQueued ? ' is-on' : '')} disabled={!canSpec && !specQueued} onClick={canSpec ? handleSpecialAttack : undefined}>
                      <GameIcon iconKey="lightning_arc" color="currentColor" size={18} />
                      <span>Special{hasSpec ? ` ${energy}%` : ''}</span>
                    </button>
                    <button class="cb-act" disabled={!isMagic} onClick={isMagic ? () => setShowSpellModal(true) : undefined}>
                      <GameIcon iconKey="crystal_ball" color="currentColor" size={18} />
                      <span>Cast Spell</span>
                    </button>
                    <button class={'cb-act' + (prayerActive ? ' is-on' : '')} onClick={() => setShowPrayerModal(true)}>
                      <GameIcon iconKey="prayer" color="currentColor" size={18} />
                      <span>Prayer</span>
                    </button>
                    {(ownsPouch || summonActive) && (
                      <button class={'cb-act' + (summonActive ? ' is-on' : '')} disabled={summonActive} onClick={summonActive ? undefined : () => setShowSummonModal(true)}>
                        <GameIcon iconKey="summoning" color="currentColor" size={18} />
                        <span>{summonActive ? `Summon ${summonSecs}s` : 'Summon'}</span>
                      </button>
                    )}
                  </div>
                )
              })()}
            </>
          )
        })()}
      </div>
      )}

      {/* Prayer modal */}
      {showPrayerModal && (
        <Modal onClose={() => setShowPrayerModal(false)}>
          <div class="cb-prayhead">
            <h3>Prayers</h3>
            <button onClick={() => setShowPrayerModal(false)} class="cb-x" aria-label="Close">
              <GameIcon iconKey="cancel" color="var(--fm-ink-soft)" size={16} />
            </button>
          </div>

          {(() => {
            const prayerLevel = getLevelFromXP(stats.prayer?.xp || 0)
            const protectionPrayers = Object.values(prayersData).filter(p => p.bonusType === 'protection')
            const combatPrayers = Object.values(prayersData)
              .filter(p => p.bonusType !== 'protection')
              .sort((a, b) => b.level - a.level)
            return (
              <div class="max-h-96 overflow-y-auto">
                <div class="cb-praysec">Protection</div>
                <div class="cb-praygrid cb-praygrid--prot">
                  {protectionPrayers.map(prayer => {
                    const canUse = prayerLevel >= prayer.level
                    const isActive = combat?.activeProtectionPrayer === prayer.id
                    const protectType = prayer.style === 'magic' ? 'Magic' : prayer.style === 'ranged' ? 'Ranged' : 'Melee'
                    return (
                      <button
                        key={prayer.id}
                        onClick={() => canUse && handlePrayer(prayer.id)}
                        disabled={!canUse}
                        class={'cb-prayer' + (isActive ? ' is-on' : '') + (!canUse ? ' is-locked' : '')}
                        style={{ alignItems: 'center', textAlign: 'center', minHeight: 64 }}
                      >
                        <span class="cb-prayer__name" style={{ justifyContent: 'center', gap: '4px' }}><SkillIcon skill={prayerSkill(prayer)} size={14} /> Protect</span>
                        <span class="cb-prayer__desc" style={{ textAlign: 'center', width: '100%' }}>{protectType}</span>
                        <span class="cb-prayer__lv" style={{ margin: '0 auto' }}>Lv {prayer.level}</span>
                        {isActive && <span class="cb-prayer__chk">✓</span>}
                      </button>
                    )
                  })}
                </div>

                <div class="cb-praysec">Combat</div>
                <div class="cb-praygrid">
                  {combatPrayers.map(prayer => {
                    const canUse = prayerLevel >= prayer.level
                    const isActive = combat?.activeCombatPrayer === prayer.id
                    return (
                      <button
                        key={prayer.id}
                        onClick={() => canUse && handlePrayer(prayer.id)}
                        disabled={!canUse}
                        class={'cb-prayer' + (isActive ? ' is-on' : '') + (!canUse ? ' is-locked' : '')}
                      >
                        <span class="cb-prayer__name" style={{ gap: '4px' }}><SkillIcon skill={prayerSkill(prayer)} size={14} /> {prayer.name}</span>
                        <span class="cb-prayer__desc">{prayer.description}</span>
                        <span class="cb-prayer__lv">Lv {prayer.level}</span>
                        {isActive && <span class="cb-prayer__chk">✓</span>}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })()}
        </Modal>
      )}

      {/* Potion modal */}
      {showPotionModal && (
        <Modal onClose={() => setShowPotionModal(false)}>
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-[var(--font-display)] text-base font-bold text-[var(--color-gold)]">Choose Potion</h3>
            <button
              onClick={() => setShowPotionModal(false)}
              class="w-6 h-6 flex items-center justify-center rounded-lg bg-[var(--color-void-light)] text-[var(--color-parchment)] hover:bg-[var(--color-void-lighter)] active:bg-[var(--color-void-border)] transition-colors"
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
                    class="w-full p-3 rounded-lg border bg-[var(--fm-parch-hi)] border-[var(--color-emerald)] active:bg-[var(--fm-parch)] transition-colors"
                  >
                    <div class="flex items-center justify-between">
                      <div class="text-left flex-1">
                        <div class="flex items-center gap-1.5 text-sm font-semibold text-[var(--color-parchment)]">
                          <GameIcon item={potion} iconKey={potion?.iconId} size={16} /> {potion.name}
                        </div>
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

      {/* Spell modal — same card grid as the prayer modal (shared component) */}
      {showSpellModal && (
        <Modal onClose={() => setShowSpellModal(false)}>
          <div class="cb-prayhead">
            <h3>Spells</h3>
            <button onClick={() => setShowSpellModal(false)} class="cb-x" aria-label="Close">
              <GameIcon iconKey="cancel" color="var(--fm-ink-soft)" size={16} />
            </button>
          </div>
          <div class="max-h-96 overflow-y-auto">
            <SpellSelectGrid
              magicLevel={getLevelFromXP(stats.magic?.xp || 0)}
              activeSpellId={activeCombatSpell?.id || null}
              onSelect={(spell) => {
                updateActiveCombatSpell({ id: spell.id, name: spell.name, baseDamage: spell.baseDamage })
                addToast(`Spell changed to ${spell.name}`, 'info')
                setShowSpellModal(false)
              }}
            />
          </div>
        </Modal>
      )}

      {/* Summon modal — pick a creature to summon into the fight */}
      {showSummonModal && (
        <Modal onClose={() => setShowSummonModal(false)}>
          <div class="cb-prayhead">
            <h3>Summon a Creature</h3>
            <button onClick={() => setShowSummonModal(false)} class="cb-x" aria-label="Close">
              <GameIcon iconKey="cancel" color="var(--fm-ink-soft)" size={16} />
            </button>
          </div>
          <div class="max-h-96 overflow-y-auto flex flex-col gap-2">
            {(() => {
              const summoningLevel = getLevelFromXP(stats.summoning?.xp || 0)
              return SUMMONING_CREATURES.map(c => {
                const unlocked = summoningLevel >= c.level
                const pouches = countItem(inventory, c.pouch)
                const scrolls = countItem(inventory, c.scroll)
                const canSummon = unlocked && pouches > 0 && !combat?.summon
                return (
                  <button key={c.id} disabled={!canSummon} onClick={canSummon ? () => handleSummon(c.id) : undefined}
                    class={`flex items-center gap-3 p-2.5 rounded-lg text-left ${canSummon ? 'active:opacity-80' : 'opacity-45 cursor-default'}`}
                    style="background:var(--color-void);border:1px solid var(--color-void-light)">
                    <GameIcon iconKey="summoning" size={30} />
                    <div class="flex-1 min-w-0">
                      <div class="text-[13px] font-bold text-[var(--color-parchment)]">{c.name}</div>
                      <div class="text-[10px] text-[var(--color-parchment)] opacity-55">
                        Max {c.maxHit}{c.hits > 1 ? ` ×${c.hits} hits` : ''} · {c.accuracyTier} accuracy · {c.summonXp} XP
                      </div>
                      <div class="text-[10px] text-[var(--color-parchment)] opacity-40">
                        {pouches} pouch{pouches === 1 ? '' : 'es'} · {scrolls} scroll{scrolls === 1 ? '' : 's'}
                      </div>
                    </div>
                    {!unlocked
                      ? <span class="text-[10px] text-[var(--color-blood-light)] font-bold">Lv {c.level}</span>
                      : pouches <= 0
                        ? <span class="text-[10px] text-[var(--color-blood-light)]">No pouch</span>
                        : <span class="text-[11px] text-[var(--color-gold)] font-bold">Summon</span>}
                  </button>
                )
              })
            })()}
          </div>
          <p class="text-[10px] text-[var(--color-parchment)] opacity-40 mt-3 text-center">
            A summoned creature fights for 60s, spending one scroll per attack.
          </p>
        </Modal>
      )}

      {/* Equipment modal */}
      {showEquipmentModal && (
        <Modal onClose={() => setShowEquipmentModal(false)}>
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-[var(--font-display)] text-base font-bold text-[var(--color-gold)]">Swap Gear</h3>
            <button
              onClick={() => setShowEquipmentModal(false)}
              class="w-6 h-6 flex items-center justify-center rounded-lg bg-[var(--color-void-light)] text-[var(--color-parchment)] hover:bg-[var(--color-void-lighter)] active:bg-[var(--color-void-border)] transition-colors"
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
                            ? 'bg-[var(--fm-parch-hi)] border-[var(--color-emerald-light)]'
                            : 'bg-[var(--fm-parch-hi)] border-[var(--color-emerald)] active:bg-[var(--fm-parch)]'
                        }`}
                      >
                        <GameIcon item={item} iconKey={item?.iconId} size={22} />
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
      {lootModal && (() => {
        const drops = !lootModal.loading && lootModal.loot ? lootModal.loot : []
        const valuedDrops = drops.map(d => {
          const unitVal = getItemUnitValue(d.itemId, itemsData) || 0
          return { ...d, unitGp: unitVal, totalGp: unitVal * (d.quantity || 1) }
        })
        const sorted = [...valuedDrops].sort((a, b) => b.totalGp - a.totalGp)
        // Spotlight the highest *unit* shop value (the rare/prestige drop), not
        // the biggest stack — a billion coins shouldn't outrank dragon claws.
        // Tie-break by total gp. The loot list keeps its total-gp ordering.
        const hero = valuedDrops.reduce((best, d) => {
          if (!best) return d
          if ((d.unitGp || 0) !== (best.unitGp || 0)) return (d.unitGp || 0) > (best.unitGp || 0) ? d : best
          return (d.totalGp || 0) > (best.totalGp || 0) ? d : best
        }, null)
        const rest = sorted.filter(d => d !== hero)
        const heroItemData = hero ? (itemsData[hero.itemId] || null) : null
        const lootTotal = valuedDrops.reduce((s, d) => s + d.totalGp, 0)
        const isRaid = !!lootModal.raidId

        return (
          <LootResultModal
            theme={!lootModal.loading && hasEpicLootDrop(lootModal.loot, itemsData) ? 'purple' : 'gold'}
            kind="loot"
            eyebrow={isRaid ? 'Raid Complete' : (lootModal.isBossKill ? 'Boss Defeated' : 'Monster Slain')}
            title={isRaid
              ? (raidsData[lootModal.raidId]?.name || 'Raid')
              : (lootModal.monster?.name || 'Monster')}
            sub={isRaid
              ? undefined
              : undefined}
            heroItem={!lootModal.loading && heroItemData ? heroItemData : null}
            heroName={!lootModal.loading && hero ? (heroItemData?.name || hero.itemId) : null}
            heroQuantity={!lootModal.loading && hero ? hero.quantity : null}
            heroGp={!lootModal.loading && hero ? hero.totalGp : 0}
            heroUnitGp={!lootModal.loading && hero ? hero.unitGp : 0}
            skipLabel={!lootModal.loading && getToken() && getCharacterId()
              ? (isRaid ? `Skip raid (${raidsData[lootModal.raidId]?.skipCost ?? 1})` : 'Skip')
              : null}
            onSkip={skipAgain}
            loot={!lootModal.loading && rest.length > 0
              ? rest.map((drop, idx) => ({
                  key: idx,
                  item: itemsData[drop.itemId] || null,
                  name: itemsData[drop.itemId]?.name || drop.itemId,
                  quantity: drop.quantity,
                  gp: drop.totalGp,
                  unitGp: drop.unitGp,
                }))
              : null}
            lootTitle="Loot Secured"
            lootTotal={lootTotal}
            primaryAction={!lootModal.loading ? {
              label: isRaid ? 'Raid Again' : 'Fight Again',
              onClick: () => {
                if (isRaid) {
                  const raid = raidsData[lootModal.raidId]
                  if (raid) startRaid(raid)
                } else {
                  const original = monstersData[lootModal.monster.id]
                  if (original) continueFight(original)
                }
                setLootModal(null)
              },
            } : null}
            secondaryAction={!lootModal.loading ? {
              label: isRaid ? 'Leave' : 'Run Away',
              onClick: () => {
                setLootModal(null)
                stopAndBack()
              },
            } : null}
            onClose={() => setLootModal(null)}
          >
            {lootModal.loading && (
              <div class="flex flex-col items-center py-6 gap-3" style={{ position: 'relative', zIndex: 4 }}>
                <div class="w-8 h-8 border-2 border-[var(--color-gold)] border-t-transparent rounded-full animate-spin" />
                <div class="text-sm text-[var(--color-parchment)] opacity-70">Waiting for server loot…</div>
              </div>
            )}
          </LootResultModal>
        )
      })()}

      {/* PvE Death Modal */}
      {deathModal && (
        <LootResultModal
          theme="blood"
          kind="progress"
          icon="💀"
          eyebrow={deathModal.cause === 'incinerated'
            ? `Incinerated by ${deathModal.monsterName}`
            : `Slain by ${deathModal.monsterName}`}
          title="Defeated"
          primaryAction={{
            label: 'Continue',
            onClick: () => setDeathModal(null),
          }}
          onClose={() => setDeathModal(null)}
        />
      )}

      {/* Monster Info Modal */}
      {selectedMonsterInfo && (
        <Modal onClose={() => setSelectedMonsterInfo(null)}>
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-[var(--font-display)] text-base font-bold text-[var(--color-gold)] flex items-center gap-2">
              <SkillEmblem iconKey={getMonsterArt(selectedMonsterInfo).icon} accent={getMonsterArt(selectedMonsterInfo).accent} size={28} glow={0} /> {selectedMonsterInfo.name}
            </h3>
            <button
              onClick={() => setSelectedMonsterInfo(null)}
              class="w-6 h-6 flex items-center justify-center rounded-lg bg-[var(--color-void-light)] text-[var(--color-parchment)] hover:bg-[var(--color-void-lighter)] active:bg-[var(--color-void-border)] transition-colors"
              title="Close"
            >
              ✕
            </button>
          </div>

          <div class="space-y-4 max-h-96 overflow-y-auto">
            <div class="cb-fight__chips">
              <MultiStyleChip chip={getMonsterAttackStyles(selectedMonsterInfo)} prefix="Uses " />
              <MultiStyleChip chip={getMonsterWeakness(selectedMonsterInfo)} prefix="Weak: " kind="!" />
            </div>
            {getMonsterLocationLabel(selectedMonsterInfo) && (
              <div class="text-[11px] text-[var(--color-parchment)] opacity-60">📍 {getMonsterLocationLabel(selectedMonsterInfo)}</div>
            )}
            {/* Combat Stats */}
            <div>
              <h4 class="text-xs font-semibold text-[var(--color-gold-dim)] uppercase tracking-wider mb-2 opacity-70">Combat Stats</h4>
              <div class="bg-[var(--color-void)] rounded-lg p-3 space-y-1">
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
              <div class="bg-[var(--color-void)] rounded-lg p-3 space-y-1">
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

            <MonsterPhaseStats monster={selectedMonsterInfo} />

            {/* Drops */}
            {selectedMonsterInfo.drops && selectedMonsterInfo.drops.length > 0 && (
              <div>
                <h4 class="text-xs font-semibold text-[var(--color-gold-dim)] uppercase tracking-wider mb-2 opacity-70">Drops</h4>
                <div class="space-y-1">
                  {[...(selectedMonsterInfo.drops || []), ...getMonsterSeedDrops(selectedMonsterInfo), ...getMonsterCharmDrops(selectedMonsterInfo)].map(drop => {
                    const item = itemsData[drop.itemId]
                    return (
                      <div key={drop.itemId} class="bg-[var(--color-void)] rounded-lg p-2">
                        <div class="flex items-start justify-between gap-2">
                          <div class="flex items-center gap-1.5 text-left flex-1 min-w-0">
                            <GameIcon item={item} iconKey={item?.iconId} size={16} />
                            <div class="min-w-0">
                              <div class="text-[11px] font-semibold text-[var(--color-parchment)]">
                                {item?.name || drop.itemId}
                              </div>
                              <div class="text-[9px] text-[var(--color-parchment)] opacity-60 mt-0.5">
                                {formatDropChance(drop.chance)}
                                {Array.isArray(drop.quantity) ? ` · ${drop.quantity[0]}–${drop.quantity[1]} ea` : ` · ${drop.quantity}`}
                                {drop.taskOnly ? ' · Slayer task only' : ''}
                              </div>
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
