import { useState, useEffect, useRef, useMemo } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import WildernessEntryModal from './WildernessEntryModal.jsx'
import CoopBossScreen from './CoopBossScreen.jsx'
import CoopSessionBrowser, { CoopSessionList } from '../components/CoopSessionBrowser.jsx'
import CoopRaidPartyList from '../components/CoopRaidPartyList.jsx'
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
import { CombatMonsterInfoSheet, CombatRaidInfoSheet, MultiStyleChip, WasIs } from './CombatMobileSheets.jsx'
import { getMonsterArt, getMonsterAttackStyles, getMonsterWeakness, getCategoryArt, getRaidArt, getMonsterLocationLabel, getStyleArt, getMonsterAddInfo, getDefenceLevelInfo, getDefenceBonusInfo, DEFENCE_STYLES } from '../utils/combatArt.js'
import { getSkillArt } from '../utils/skillArt.js'
import { COMBAT_CATEGORY_ORDER, COMBAT_RAID_ORDER, orderBy } from '../utils/combatOrder.js'
import { nextProtectionPrayerThreat, prayerSkill, protectionPrayerForAttackStyle } from '../utils/prayerIcons.js'
import { MONSTER_ICONS } from '../utils/monsterIcons.js'
import SkillIcon from '../components/SkillIcon.jsx'
import { createCombatState, createRaidCombatState, continueRaidCombatState, processCombatTick, applyEat, applyCombo, applySpecialAttack, applyInstantKill, setCombatTarget } from '../engine/combat.js'
import { hardModeDeathLoss, hardModeSkipCost, monstersTableFor, scaleMonsterForHardMode, supportsHardMode } from '../engine/hardMode.js'
import { displayedDropChance, dropRateBoostLabel, monsterDropBoost } from '../engine/dropRateDisplay.js'
import { grimReaperStashFromDeath } from '../engine/grimReaper.js'
import { hardModeKey, pushHardModeTarget } from '../cloud/hardMode.js'
import { recordItemLossEntries } from '../engine/lossLedger.js'
import { HardModeConfirm, HardModeTag, HardModeToggle } from '../components/HardMode.jsx'
import { liveAdds } from '../engine/bossAdds.js'
import { isWaveRaid, raidInfoStages, raidUniqueChanceRange } from '../engine/raidEncounters.js'
import { applyConsumableEffect, isLumiraBrew, isComboConsumable, boostedMagicLevel } from '../engine/consumables.js'
import { getLevelFromXP } from '../engine/experience.js'
import { checkBossRequirementsPure, checkRaidRequirementsPure } from '../engine/combatRequirements.js'
import { getMonsterSeedDrops } from '../engine/seedDrops.js'
import { getAgilityBankDelayMs, formatBankDelay } from '../engine/agility.js'
import { onTick, pauseTicks, resumeTicks } from '../engine/tick.js'
import { addLootEntry, removeItem, freeSlots, countItem } from '../engine/inventory.js'
import { SUMMONING_CREATURES, getSummoningCreature, createSummonState, getMonsterCharmDrops } from '../engine/summoning.js'
import { getCombatType, resolveMagicSpell, equipItem, checkEquipRequirements, placeUnequippedItems } from '../engine/equipment.js'
import { RAID_TASK_META } from '../engine/slayerMasters.js'
import { resolveSpecialEnergyCost, canAffordSpecialAttack, formatSpecialEnergyCostLabel, SELF_HEALING_SPEC_TYPES } from '../engine/specialAttackEnergy.js'
import { hasMasterRejuvenation, refillSpecialOnEmpty } from '../engine/specialRegen.js'
import { api, getToken, getCharacterId, getOneLifeMode, isDemoMode } from '../cloud/api.js'
import { pullSave, applyCloudSave, requestCriticalPushSave, pushNow, suspendSaves, resumeSaves, holdServerOwnedSave, releaseServerOwnedSave, lastSaveLockCode } from '../cloud/sync.js'
import monstersData from '../data/monsters.json'
import worldData from '../data/world.json'
import { placeActivities } from '../engine/worldContent.js'
import questsData from '../data/quests.json'
import itemsData from '../data/items.json'
import prayersData from '../data/prayers.json'
import spellsData from '../data/spells.json'
import raidsData from '../data/raids.json'
import { isCoopBossId } from '../engine/coopBossEngine.js'
import { isCoopRaidId } from '../engine/coopRaidEngine.js'
import { hasWorldLair, worldLairZone } from '../engine/worldLairs.js'
import { openWorld, worldBetaEnabled, worldBossLairsEnabled } from '../utils/helpers.js'
import { coopApi, setActiveCoopSession } from '../cloud/coop.js'
import { SCREENS, formatDropChance } from '../utils/constants.js'
import { hasEpicLootDrop, getItemUnitValue, getLootTotalValue } from '../utils/itemValue.js'
import { splatsFromCombatEvents, HIT_SPLAT_DURATION_MS } from '../utils/hitSplats.js'
import { swingsFromCombatEvents, playerCombatSprite, monsterCombatSprite, combatStageTarget, combatStageDeathTransition, combatStageSwingRoute, MONSTER_DEATH_ANIM_MS } from '../utils/actionSprites.js'
import { useActionSwings, useConsumeToken } from '../hooks/useActionSwings.js'
import InkwrightCombatStage from '../components/InkwrightCombatStage.jsx'
import { dropsFromBankedXp, emitXpDrops } from '../utils/xpDrops.js'
import { shapeLootForModal, lootRowsForModal, killPresentsFullModal } from '../utils/lootModal.js'
import { emitKillReveal } from '../utils/rewardReveal.js'
import { HitSplatLayer } from '../components/HitSplat.jsx'
import { CombatFightHead, CombatHPBlock, CombatPrayerBlock } from '../components/CombatHud.jsx'
import QuickPrayerConfigModal from '../components/QuickPrayerConfigModal.jsx'
import ActivePotionBadges from '../components/ActivePotionBadges.jsx'
import SunspireDecisionPanel from '../components/SunspireDecisionPanel.jsx'
import { SUNSPIRE_MODIFIERS_ENABLED, offerSunspireModifiers, raiseSunspireModifierTier } from '../engine/sunspireModifiers.js'
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
    label: 'Nagadoth Kings and Queen',
    icon: '👹',
    ids: ['nagadoth_rex', 'nagadoth_prime', 'nagadoth_supreme', 'nagadoth_queen'],
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
    key: 'corporeal_horror',
    label: 'Corporeal Horror',
    icon: '👁️',
    ids: ['corporeal_horror'],
  },
  {
    key: 'zaryth_the_empty_lord',
    label: 'The Empty Throne',
    icon: '🕳️',
    ids: ['zaryth_the_empty_lord'],
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

// Picker display order, shared by desktop and mobile so the two never drift
// (mobile used to define its own order — see combatOrder.js).
const ORDERED_COMBAT_CATEGORIES = [...COMBAT_CATEGORIES].sort(orderBy(COMBAT_CATEGORY_ORDER, c => c.key))

// Resolve which combat category a monster id belongs to (for art accent fallback).
const MONSTER_CATEGORY_KEY = (() => {
  const map = {}
  for (const cat of COMBAT_CATEGORIES) for (const id of cat.ids) map[id] = cat.key
  return map
})()
function getMonsterCategoryKey(monsterId) {
  return MONSTER_CATEGORY_KEY[monsterId]
}

// How often the picker re-reads the open co-op rooms. Slow enough that an idle
// picker is cheap, fast enough that a group opened while the player is browsing
// shows up before they have finished scrolling.
const COOP_BROWSER_POLL_MS = 15000
// Auto-fight restart delay after an ordinary kill (CLAUDE.md §6) — long enough
// to read the kill, short enough that a grind still feels continuous.
const AUTO_FIGHT_RESTART_MS = 1200

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
            <div class="grid grid-cols-5 gap-1 text-[9px] text-[var(--color-parchment)] pt-1 border-t border-[var(--hairline)]">
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

// Stat block for a boss's mid-fight add (e.g. the Corporeal Horror's Dread
// Core). Both monsters are alive and targetable at once, so the info modal has
// to show the add's numbers next to the boss's own.
function MonsterAddStats({ monster }) {
  const info = getMonsterAddInfo(monster)
  if (!info) return null
  const { add, spawnLabel, maxHit } = info
  return (
    <div>
      <h4 class="text-xs font-semibold text-[var(--color-gold-dim)] uppercase tracking-wider mb-2 opacity-70">Summoned</h4>
      <div class="bg-[var(--color-void)] rounded-lg p-3 space-y-2">
        <div class="flex items-center justify-between">
          <span class="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: getStyleArt(add.attackStyle).color }}>
            <SkillEmblem iconKey={getMonsterArt(add).icon} accent={getMonsterArt(add).accent} size={18} glow={0} />
            {add.name}
          </span>
          <span class="text-[9px] text-[var(--color-parchment)] opacity-50 font-[var(--font-mono)]">Max Hit {maxHit}</span>
        </div>
        <div class="flex justify-between text-[10px] text-[var(--color-parchment)] opacity-80">
          <span>Combat <span class="font-[var(--font-mono)]">{add.combatLevel}</span></span>
          <span>HP <span class="font-[var(--font-mono)]">{add.hitpoints}</span></span>
          <span>Attack Bonus <span class="font-[var(--font-mono)]">{add.attackBonus ?? 0}</span></span>
        </div>
        <div class="grid grid-cols-5 gap-1 text-[9px] text-[var(--color-parchment)] pt-1 border-t border-[var(--hairline)]">
          {DEFENCE_STYLES.map(style => (
            <div key={style} class="text-center">
              <div class="opacity-50 capitalize">{style}</div>
              <div class={(add.defenceBonus?.[style] ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}>
                {(add.defenceBonus?.[style] ?? 0) >= 0 ? '+' : ''}{add.defenceBonus?.[style] ?? 0}
              </div>
            </div>
          ))}
        </div>
        {add.weakness && (
          <div class="text-[9px] text-[var(--color-parchment)] opacity-50 capitalize">Weak to: {add.weakness}</div>
        )}
        {spawnLabel && (
          <div class="text-[9px] text-[var(--color-parchment)] opacity-50">{spawnLabel}</div>
        )}
      </div>
    </div>
  )
}

/**
 * The desktop drop table, shared by the picker's info modal and the in-fight
 * one — the two are the same list and drifted apart is how one of them would
 * end up still printing authored rates.
 *
 * Rates are what the player is actually rolling against (monsterDropBoost). One
 * boost covers every row — seeds and charms are empty for a boss, and hard mode
 * is boss-only.
 */
function MonsterDropList({ monster, itemsData, grindman = false }) {
  if (!monster?.drops || monster.drops.length === 0) return null
  const boost = monsterDropBoost(monster, grindman)
  const boostLabel = dropRateBoostLabel(boost)
  const drops = [
    ...monster.drops,
    ...getMonsterSeedDrops(monster),
    ...getMonsterCharmDrops(monster),
  ]
  return (
    <div>
      <h4 class="text-xs font-semibold text-[var(--color-gold-dim)] uppercase tracking-wider mb-2 opacity-70">Drops</h4>
      {boostLabel && (
        <div class="text-[10px] font-semibold text-[var(--color-gold)] mb-2">{boostLabel}</div>
      )}
      <div class="space-y-1">
        {drops.map(drop => {
          const item = itemsData[drop.itemId]
          return (
            <div key={drop.itemId} class="bg-[var(--color-void)] rounded-lg p-2">
              <div class="flex items-start justify-between gap-2">
                <div class="flex items-center gap-1.5 text-left flex-1 min-w-0">
                  <GameIcon item={item} iconKey={item?.iconId} size={16} />
                  <div class="min-w-0">
                    <div class="text-[11px] font-semibold text-[var(--color-parchment)]">{item?.name || drop.itemId}</div>
                    <div class="text-[9px] text-[var(--color-parchment)] opacity-60 mt-0.5">
                      {formatDropChance(displayedDropChance(drop.chance, boost))}
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
  )
}

export default function CombatScreen({ onNavigate, initialMonsterId, initialRaidId, onCombatStatusChange, onBack, onStopBack, dungeonPlaceId }) {
  const { stats, inventory, bank, equipment, currentHP, updateHP, updateInventory, updateBank, updateEquipment, grantXP, getMaxHP, addToast, combatStance, updateCombatStance, idleCombatSetup, updateIdleCombatSetup, homeShortcuts, updateHomeShortcuts, setActiveTask, requestActivityStart, slayerTask, setSlayerTask, awardSlayerPoints, slayerTasksCompleted, setSlayerTasksCompleted, incrementSlayerMasterTaskCompletions, activeCombatSpell, updateActiveCombatSpell, bossKillCounts, updateBossKillCounts, raidKillCounts, updateRaidKillCounts, unlockedFeatures, completedQuests, isOneLife, isIronman, isGrindman, revertOneLifeMode, getSnapshot, loadGame, combatSkipHandlerRef, chargeSkipRef, raidSkipHandlerRef, lockGame, unlockGame, runLockedSave, resolveCombatCompletion, characterUnlocks, killCountsLoaded, recordGameEvent, worldLocation, publishCombatStatus, activeTask, backgroundCombat, combatAnimations, quickPrayers, updateQuickPrayers, hardModeTargets, applyHardModeTarget, updateGrimReaperStash } = useGame()
  // Offline demo: bosses, raids and PvP are locked (server-authoritative).
  const isDemo = isDemoMode() && !(getToken() && getCharacterId())
  const [showWildernessEntry, setShowWildernessEntry] = useState(false)
  // Co-op boss session. The server owns the fight and locks the save for its
  // duration, so this takes over the screen.
  const [coopSessionId, setCoopSessionId] = useState(null)
  // Set while exitCoopFight is releasing the session, so the effect cleanup
  // that fires straight after doesn't send a second leave for the same fight.
  const coopLeavingRef = useRef(false)
  const [coopJoining, setCoopJoining] = useState(null)
  // What the player was fighting, so a session they were dropped from can be
  // rejoined rather than dead-ended. Set at every join, read only on recovery.
  const coopRejoinRef = useRef(null)
  const coopRejoiningRef = useRef(false)
  // Bumped on every rejoin so the fight screen remounts even when the player
  // lands back in the same room, which is the usual case for a boss.
  const [coopAttempt, setCoopAttempt] = useState(0)
  const [worldJoining, setWorldJoining] = useState(null)
  // Solo-or-group prompt: which boss was tapped, and how busy its instances are.
  const [coopChoice, setCoopChoice] = useState(null)
  const [coopOpenSessions, setCoopOpenSessions] = useState(null)
  // A room the server still holds this character for, from the picker's own
  // headcount fetch. Only read while recovering a join, never rendered.
  const heldCoopSessionRef = useRef(null)
  // Every open room across every boss, for the picker's session browser.
  const [coopBrowser, setCoopBrowser] = useState({ sessions: [], loading: true, activeSessionId: null })
  const [coopJoiningSession, setCoopJoiningSession] = useState(null)
  const [showCoopSessions, setShowCoopSessions] = useState(false)
  // Raid parties. `raidChoice` is the solo-or-party prompt; `raidParties` is the
  // lobby list for whichever raid it is showing.
  const [raidChoice, setRaidChoice] = useState(null)
  const [raidParties, setRaidParties] = useState(null)
  const [raidJoining, setRaidJoining] = useState(null)
  // The party this character is still held by. A party that has SET OFF is not
  // in the lobby list — that is the point of the lobby — so without this a
  // player who refreshed mid-raid has no way back into their own run.
  const [activeRaidParty, setActiveRaidParty] = useState(null)

  // Dungeon mode: this screen renders one place's foes (Monsters / Bosses /
  // Raids) instead of the world-wide picker. PvP is hidden (not place-bound);
  // starting a fight still routes through the same gating, and the player is at
  // the place, so it starts immediately. The picker + its info sheets are reused
  // verbatim, only the section list and header change.
  const dungeonPlace = dungeonPlaceId ? worldData.places[dungeonPlaceId] : null
  const isDungeon = !!dungeonPlace
  const dungeon = useMemo(() => (isDungeon ? buildDungeonData(dungeonPlaceId) : null), [dungeonPlaceId, isDungeon])
  const pickerCategories = isDungeon ? dungeon.categories : ORDERED_COMBAT_CATEGORIES
  const pickerRaids = isDungeon ? dungeon.raids : raidsData
  const pickerTitle = isDungeon ? `${dungeonPlace.name} Dungeon` : 'Choose a Foe'

  const [combat, setCombat] = useState(null)
  const [log, setLog] = useState([])
  const [killCount, setKillCount] = useState(0)
  const [fightStartedAt, setFightStartedAt] = useState(null)
  const [isAutoRestarting, setIsAutoRestarting] = useState(false)
  const [showPrayerModal, setShowPrayerModal] = useState(false)
  const [showQuickPrayerConfig, setShowQuickPrayerConfig] = useState(false)
  const [showPotionModal, setShowPotionModal] = useState(false)
  const [idleSetupMode, setIdleSetupMode] = useState(null) // 'food' | 'potion' | 'prayer' | null
  const [showEquipmentModal, setShowEquipmentModal] = useState(false)
  const [showSpellModal, setShowSpellModal] = useState(false)
  const [showSummonModal, setShowSummonModal] = useState(false)
  const [targetsExpanded, setTargetsExpanded] = useState(true)
  const [sunspireClaimBusy, setSunspireClaimBusy] = useState(false)
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
  // An ordinary kill whose loot the server is still rolling. It shows no UI —
  // it just holds the fight until the grant lands, which is also what keeps two
  // completeMonster round trips from overlapping.
  const [pendingKill, setPendingKill] = useState(false)
  // An ordinary kill re-arms itself after the auto-fight delay rather than
  // parking the player behind a loot modal (CLAUDE.md §6). The pending restart
  // is state, not just a ref: between two kills the fight is inactive with no
  // modal up, and the background-combat host unmounts this screen the moment it
  // reads `busy: false` — cancelling the very timer that keeps a background
  // grind going.
  const [autoFightPending, setAutoFightPending] = useState(false)
  const autoFightTimerRef = useRef(null)
  const cancelAutoFight = () => {
    setAutoFightPending(false)
    if (!autoFightTimerRef.current) return
    clearTimeout(autoFightTimerRef.current)
    autoFightTimerRef.current = null
  }
  useEffect(() => cancelAutoFight, [])
  const [deathModal, setDeathModal] = useState(null)
  const [isDesktopCombatLayout, setIsDesktopCombatLayout] = useState(false)
  const [monsterSplats, setMonsterSplats] = useState([])
  const [addSplats, setAddSplats] = useState([])
  const [playerSplats, setPlayerSplats] = useState([])
  // Latest swing per side for the sprite stage. The hook expires each token when
  // its motion is over, so nothing between fights, respawns or target switches
  // is left holding a swing that could replay.
  const { swings, pushSwings } = useActionSwings()
  const { token: actorConsume, pushConsume } = useConsumeToken()
  const [stageDeathTarget, setStageDeathTarget] = useState(null)
  const stageDeathTimerRef = useRef(null)
  const clearStageDeathTarget = () => {
    if (stageDeathTimerRef.current) {
      clearTimeout(stageDeathTimerRef.current)
      stageDeathTimerRef.current = null
    }
    setStageDeathTarget(null)
  }
  const holdStageDeathTarget = (transition) => {
    if (!transition) return
    if (stageDeathTimerRef.current) clearTimeout(stageDeathTimerRef.current)
    setStageDeathTarget(transition)
    stageDeathTimerRef.current = setTimeout(() => {
      stageDeathTimerRef.current = null
      setStageDeathTarget(null)
    }, MONSTER_DEATH_ANIM_MS)
  }
  useEffect(() => () => {
    if (stageDeathTimerRef.current) clearTimeout(stageDeathTimerRef.current)
  }, [])
  const combatRef = useRef(null)
  // Bumped exactly at a new-fight boundary (startFight/continueFight/startRaid),
  // never on an ordinary re-render — InkwrightCombatStage clears its frozen
  // swing state when this changes, so the last motion/tool of a monster that
  // just died can't bleed a frame into the next monster's first swing.
  const fightSeqRef = useRef(0)
  const hpRef = useRef(currentHP)
  const getCombatMaxHP = (state = combatRef.current) => {
    const base = Math.max(1, Number(getMaxHP()) || 1)
    if (state?.raid?.raidId !== 'sunspire_colosseum') return base
    const multiplier = Math.max(0.01, Math.min(1, Number(state?.sunspireRules?.maxHpMultiplier) || 1))
    return Math.max(1, Math.floor(base * multiplier))
  }
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

  useEffect(() => { hpRef.current = currentHP }, [currentHP])
  useEffect(() => { inventoryRef.current = inventory }, [inventory])
  useEffect(() => { bankRef.current = bank }, [bank])
  useEffect(() => { statsRef.current = stats }, [stats])
  useEffect(() => { equipmentRef.current = equipment }, [equipment])

  // A hard-mode death takes everything tradeable carried and worn, for good
  // (hardModeDeathLoss). Applied here rather than in the engine because the pack
  // lives in the screen's refs during a fight; the bank is untouched. Declared
  // above the tick loop that calls it.
  const applyHardModeDeath = (state) => {
    if (state?.monster?.hardModeActive !== true) return null
    const loss = hardModeDeathLoss(inventoryRef.current, equipmentRef.current, itemsData)
    inventoryRef.current = loss.inventory
    updateInventory(loss.inventory)
    equipmentRef.current = loss.equipment
    updateEquipment(loss.equipment)
    // Declared, or the one write that deliberately empties a pack is also the
    // one the item-loss detector cannot tell from the bug it watches for
    // (src/engine/lossLedger.js).
    recordItemLossEntries(loss.lost)
    // Stashed with the Grim Reaper (Settings) so it can be bought back for
    // credits — overwrites whatever was stashed from an earlier death.
    const stash = grimReaperStashFromDeath(loss.lost, { id: state.monster?.id, name: state.monster?.name })
    if (stash) updateGrimReaperStash(stash)
    // Losing a pack has to survive a closed tab, so it does not wait for the
    // ordinary idle flush.
    requestCriticalPushSave(() => getSnapshot(), CRITICAL_SAVE_REASONS.HARD_MODE_DEATH)
    return loss.lost
  }

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

  // Auto-start fight from home shortcut. Waits for kill counts for the same
  // reason the render below does: this effect runs even while that loader is on
  // screen (hooks run before the early return), so without the guard it opened
  // the boss gate against an empty count map and refused a boss the player had
  // long since unlocked.
  useEffect(() => {
    if (initialMonsterId && killCountsLoaded && !hasAutoStarted.current && !combat) {
      hasAutoStarted.current = true
      const monster = monstersData[initialMonsterId]
      if (monster) startFight(monster)
    }
  }, [initialMonsterId, killCountsLoaded])

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
    if (!backgroundCombat || (!combat && !lootModal && !deathModal && !pendingKill && !autoFightPending)) {
      publishCombatStatus?.(null)
      return
    }
    const m = combat?.monster
    publishCombatStatus?.({
      active: combat?.active === true,
      busy: combat?.active === true || !!lootModal || !!deathModal || pendingKill || autoFightPending,
      backgroundable: !isDungeon && m?.boss !== true && !combat?.raid,
      monsterId: m?.id || null,
      monsterName: m?.name || null,
      monsterHP: Number.isFinite(m?.currentHP) ? m.currentHP : null,
      monsterMaxHP: Number.isFinite(m?.hitpoints) ? m.hitpoints : null,
    })
  }, [combat, lootModal, deathModal, pendingKill, autoFightPending, backgroundCombat])

  // Clear the published status when the screen unmounts entirely.
  useEffect(() => () => publishCombatStatus?.(null), [])

  // If another activity (a skill, gathering, travel) supersedes this fight while
  // it ticks in the background, stop combat cleanly rather than running two
  // activities at once.
  useEffect(() => {
    // A pending auto-fight restart outlives the fight it belongs to, so anything
    // that isn't this combat task taking over has to disarm it — otherwise it
    // fires 1.2s later and hijacks the new activity.
    if (activeTask?.type !== 'combat') cancelAutoFight()
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

      const playerStats = {
        attack: getLevelFromXP(statsRef.current.attack?.xp || 0),
        strength: getLevelFromXP(statsRef.current.strength?.xp || 0),
        defence: getLevelFromXP(statsRef.current.defence?.xp || 0),
        ranged: getLevelFromXP(statsRef.current.ranged?.xp || 0),
        magic: getLevelFromXP(statsRef.current.magic?.xp || 0),
        currentHP: hpRef.current
      }

      const stageTargetBeforeTick = combatStageTarget(state)
      const stageTargetSnapshot = stageTargetBeforeTick ? { ...stageTargetBeforeTick } : null
      const { combatState, events } = processCombatTick(state, playerStats, equipmentRef.current, itemsData, prayersData, inventoryRef.current, slayerTaskRef.current)

      const deathTransition = combatStageDeathTransition(stageTargetSnapshot, combatState)
      if (deathTransition) holdStageDeathTarget(deathTransition)

      // Master Rejuvenation: auto-refill spec bar when it hits 0 mid-fight.
      if (combatState.active) {
        combatState.specialAttackEnergy = refillSpecialOnEmpty(
          combatState.specialAttackEnergy,
          hasMasterRejuvenation(unlockedFeaturesRef.current),
        )
      }

      combatRef.current = combatState
      setCombat({ ...combatState })

      const tickSplats = splatsFromCombatEvents(events)
      pushSplats(setMonsterSplats, tickSplats.monster)
      pushSplats(setAddSplats, tickSplats.add)
      pushSplats(setPlayerSplats, tickSplats.player)

      // A tick with no swing on a side leaves that side's token alone — the
      // stage keys off the id, so re-setting an unchanged one would replay a
      // motion the engine never made. Route from the PRE-tick active target:
      // the events describe that tick, including a killing blow. Crucially this
      // is activeTarget()-based rather than addTargetIndex-based, because a
      // finite Sunspire encounter automatically attacks the next live add after
      // its primary dies even though no manual add selection exists.
      pushSwings(swingsFromCombatEvents(events, combatStageSwingRoute(state)))

      // Filled from what grantXP BANKED below, so the floating drop and the
      // skill can never disagree — the engine's number is pre-account-type.
      const bankedXp = {}

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
            disrupt: '🌋 Disrupt',
            empty_bolt: '🕳️ Empty Bolt',
            empty_lord_cleave: `🕳️ Empty Lord's Cleave (+${ev.healAmount || 0} HP)`,
            division: ev.defenceReducedBy > 0 ? `☀️ Division (-${ev.defenceReducedBy} Defence)` : '☀️ Division'
          }
          const label = specLabels[ev.specType] || '⚡ Special Attack'
          setLog(prev => [...prev.slice(-20), {
            text: `${label}: ${hitsStr} (total ${ev.totalDamage})`,
            type: 'special',
            time: Date.now()
          }])
          if (SELF_HEALING_SPEC_TYPES.has(ev.specType) && ev.healAmount > 0) {
            const maxHP = getCombatMaxHP(combatState)
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
            cancelAutoFight()
            setCombat(prev => ({ ...prev, active: false }))
            setActiveTask(null)
            updateHP(getMaxHP())
            hpRef.current = getMaxHP()
            setDeathModal({ monsterName: state.monster?.name || 'the monster', cause: 'slain', itemsLost: applyHardModeDeath(state) })
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
            cancelAutoFight()
            setCombat(prev => ({ ...prev, active: false }))
            setActiveTask(null)
            updateHP(getMaxHP())
            hpRef.current = getMaxHP()
            setDeathModal({ monsterName: state.monster?.name || 'the dragon', cause: 'incinerated', itemsLost: applyHardModeDeath(state) })
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
              if (xp > 0) bankedXp[skill] = (bankedXp[skill] || 0) + grantXP(skill, xp)
            }
          }
        }
        if (ev.type === 'summonHit') {
          const cname = getSummoningCreature(ev.creatureId)?.name || 'Creature'
          const swingHits = ev.hits || [ev.damage]
          const anyHit = swingHits.some(h => h > 0)
          setLog(prev => [...prev.slice(-20), {
            text: anyHit ? `Your ${cname} hits ${swingHits.map(h => h > 0 ? h : 'miss').join(' + ')}` : `Your ${cname} misses`,
            type: anyHit ? 'hit' : 'miss',
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
        if (ev.type === 'addSpawned') {
          setLog(prev => [...prev.slice(-20), {
            text: `${ev.icon || '🔮'} ${ev.bossName || 'The boss'} spawns a ${ev.monsterName}! (${ev.hitpoints} HP)`,
            type: 'formChange',
            time: Date.now()
          }])
          addToast(`${ev.icon || '🔮'} ${ev.monsterName} spawns — switch target to kill it`, 'info')
        }
        if (ev.type === 'addDefeated') {
          setLog(prev => [...prev.slice(-20), {
            text: `💥 ${ev.monsterName} destroyed!`,
            type: 'heal',
            time: Date.now()
          }])
        }
        if (ev.type === 'prayerDrained') {
          setLog(prev => [...prev.slice(-20), {
            text: `🔮 ${ev.monsterName || 'Monster'} drains ${ev.amount} prayer points!`,
            type: 'miss',
            time: Date.now()
          }])
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
        if (ev.type === 'raidWaveCleared' && combatState.raid?.raidId === 'sunspire_colosseum') {
          const modifierState = combatState.raid.modifierState || {}
          combatState.raid = {
            ...combatState.raid,
            modifierOffers: ev.finalWave || !SUNSPIRE_MODIFIERS_ENABLED
              ? []
              : offerSunspireModifiers(modifierState, raidsData.sunspire_colosseum?.modifierPool),
          }
          combatRef.current = combatState
          setCombat({ ...combatState })
          setActiveTask(null)
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
          const maxHP = getCombatMaxHP(combatState)
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
          const maxHP = getCombatMaxHP(combatState)
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
          // Whether the fight that just ended was hard, taken from the record it
          // was BUILT from. defeatedMonsterData is a raw monsters.json lookup for
          // the reward tables, so it never carries hardModeActive — reading the
          // flag off it silently answered "no" every time, which sent Fight Again
          // and Skip back into an unscaled boss while the server's own switch
          // kept paying the doubled drop rates.
          const defeatedHardMode = defeatedMonster?.hardModeActive === true || state.monster?.hardModeActive === true
          const killLoot = Array.isArray(ev.loot) ? ev.loot : []
          const raidId = state.raid?.raidId || null
          // Only a boss or a raid stops the game on the full-screen modal.
          const fullModal = killPresentsFullModal({ isBossKill: isDefeatedBoss, raidId })
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
            void claimRaidCompletion({
              raidId,
              monster: defeatedMonsterData,
              slayerXpGained,
              isBossKill: isDefeatedBoss,
              hardMode: defeatedHardMode,
            })
          } else if (cloudAuthoritativeMonster) {
            if (fullModal) {
              setLootModal({
                monster: defeatedMonsterData,
                hardMode: defeatedHardMode,
                loot: [],
                slayerXpGained,
                isBossKill: isDefeatedBoss,
                raidId,
                loading: true
              })
            } else {
              setPendingKill(true)
            }
            void (async () => {
              // Flush current inventory to server before completing the monster so
              // the server sees consumed food/potions and can correctly route drops
              // to inventory (not bank) when space is available.
              try { await pushNow(getSnapshot()) } catch { /* non-fatal; server falls back to last saved state */ }
              return api.completeMonster(defeatedMonsterId, {
                actionNonce: `monster:${defeatedMonsterId}:${Date.now()}`,
                // What we actually fought, from the fight's own record rather
                // than the switch — the server treats this as a downgrade only
                // (hardModeForKill), so it can refuse to pay hard rates for an
                // ordinary boss but can never claim them.
                hardMode: defeatedHardMode,
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
                  if (reward?.destination === 'bank') {
                    const existing = newBank[itemId]
                    const existingQty = Math.floor(Number(existing?.quantity ?? existing) || 0)
                    newBank[itemId] = {
                      ...(existing && typeof existing === 'object' ? existing : {}),
                      itemId,
                      quantity: existingQty + quantity,
                    }
                  } else {
                    addLootEntry(newInv, reward, itemsData)
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
              const serverLoot = granted.map(reward => ({ itemId: reward.itemId, quantity: reward.quantity }))
              if (fullModal) {
                setLootModal({
                  monster: defeatedMonsterData,
                  hardMode: defeatedHardMode,
                  loot: serverLoot,
                  slayerXpGained,
                  isBossKill: isDefeatedBoss,
                  raidId,
                  loading: false
                })
              } else {
                setPendingKill(false)
                announceOrdinaryKill({
                  monsterId: defeatedMonsterId,
                  monsterName: defeatedMonsterName,
                  hardMode: defeatedHardMode,
                  loot: serverLoot,
                })
              }
            }).catch((err) => {
              // Nothing was granted, so the fight stays stopped rather than
              // re-arming into a kill whose loot never landed.
              setLootModal(null)
              setPendingKill(false)
              addToast(`Monster claim failed: ${err?.message || 'server_error'}`, 'error')
            }).finally(() => {
              // Release any boss-skip lock awaiting this completion (no-op for a
              // normal live kill that didn't arm a wait).
              resolveCombatCompletion()
            })
          } else if (killLoot.length > 0) {
            const newInv = [...inventoryRef.current]
            for (const drop of killLoot) addLootEntry(newInv, drop, itemsData)
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
          // A boss/raid stops on the loot modal; an ordinary kill flashes its
          // loot as a reveal card and re-arms itself.
          if (!cloudAuthoritativeRaid && !cloudAuthoritativeMonster) {
            if (fullModal) {
              setLootModal({
                monster: defeatedMonsterData,
                hardMode: defeatedHardMode,
                loot: killLoot,
                slayerXpGained,
                isBossKill: isDefeatedBoss,
                raidId,
                loading: false
              })
            } else {
              announceOrdinaryKill({
                monsterId: defeatedMonsterId,
                monsterName: defeatedMonsterName,
                hardMode: defeatedHardMode,
                loot: killLoot,
              })
            }
          }
        }
      }

      emitXpDrops(dropsFromBankedXp(bankedXp))
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
    monstersData,
  })

  const checkRaidRequirements = (raid) => checkRaidRequirementsPure(raid, { completedQuests })

  // The local save loop is suspended for exactly as long as a co-op session is
  // held, because the server owns this character's save for the duration.
  // Deliberately NOT lockGame(): that also raises the "Saving your progress…"
  // blocking overlay, which is meant for short operations and would sit on top
  // of the whole fight. Tying it to the session state rather than the
  // join/leave handlers means navigating away mid-fight releases it too.
  useEffect(() => {
    if (!coopSessionId) return undefined
    suspendSaves()
    // …and the stronger statement the suspension alone cannot make: the SERVER
    // owns this save now, so even the teardown beacon has nothing to flush.
    // Released with the suspension below, not with the session id above — the
    // server's lock outlives the client's until the leave actually lands.
    holdServerOwnedSave()
    setActiveCoopSession(coopSessionId)
    // One marker, one lifetime: the client-side simulation guards key off the
    // session id, so nulling it on the first line of cleanup re-armed the idle
    // catch-up and the background runner for the whole leave round trip — while
    // the room still owned the save. Everything lifts together, once the server
    // has actually let go.
    const release = () => {
      setActiveCoopSession(null)
      releaseServerOwnedSave()
      resumeSaves()
    }
    return () => {
      // Releasing the client-side suspension is not enough: the server holds
      // `characters.active_coop_session_id` and refuses every save until the
      // membership actually ends. Leaving via the back link already did this
      // (exitCoopFight), but navigating away with the nav bar lands here
      // instead, and skipping it would block this character's saves until the
      // member heartbeat lapses.
      if (coopLeavingRef.current) {
        coopLeavingRef.current = false
        release()
        return
      }
      // Resume saving only AFTER the server has written the fight back and we
      // have re-pulled it. Resuming first races the write-back with a push of
      // the client's pre-fight copy, which the revision guard then rejects —
      // correct, but it costs the player a rollback for no reason.
      coopApi.leave(coopSessionId)
        .then(() => pullSave())
        .then((pulled) => (pulled?.payload ? applyCloudSave(pulled.payload, pulled.updatedAt).then(loadGame) : null))
        .catch(() => { /* the member heartbeat lapsing covers it */ })
        .finally(release)
    }
  }, [coopSessionId])

  // Hard Mode. The switch itself is server state (§14) — this is the mirror the
  // picker renders and the flag that decides which monster record the fight is
  // built from. The offline demo has no server to hold the switch, so it has no
  // hard mode either.
  const hardModeSet = useMemo(() => new Set(hardModeTargets || []), [hardModeTargets])
  const offersHardMode = (entity) => supportsHardMode(entity) && !isDemo
  const isHardMode = (sourceType, sourceId) => hardModeSet.has(hardModeKey(sourceType, sourceId))
  // A raid carries no scaled record for the info surfaces to read a flag off, so
  // both of them (mobile sheet, desktop modal) ask here.
  const raidDropBoost = (raid) => ({
    hardMode: offersHardMode(raid) && isHardMode('raids', raid.id),
    grindman: isGrindman,
  })
  const [hardModePending, setHardModePending] = useState(null)
  // Switching hard mode ON is what puts a player's whole pack at risk, so it
  // asks first. Switching it OFF costs nothing and asks nothing.
  const [hardModeConfirm, setHardModeConfirm] = useState(null)
  // Writes first, mirrors second. A refused write leaves the switch where it
  // was: a client-only hard mode is a doubled boss paying normal drop rates.
  const commitHardMode = async (sourceType, sourceId, enabled) => {
    const key = hardModeKey(sourceType, sourceId)
    setHardModePending(key)
    try {
      await pushHardModeTarget(sourceType, sourceId, enabled)
      applyHardModeTarget(key, enabled)
      setHardModeConfirm(null)
    } catch (err) {
      addToast(err?.message || 'Could not change difficulty — try again.', 'error')
    } finally {
      setHardModePending(null)
    }
  }
  const toggleHardMode = (sourceType, sourceId, enabled, name) => {
    if (!enabled) return commitHardMode(sourceType, sourceId, false)
    setHardModeConfirm({ sourceType, sourceId, name })
    return undefined
  }

  // Co-op needs a cloud account (the server owns the fight), so the offline demo
  // always goes straight to the solo path.
  const offersCoop = (monster) => isCoopBossId(monster.id) && !isDemo
  // World lairs are preview-only; idle co-op remains available independently.
  const offersWorldLair = (monster) => hasWorldLair(monster.id) && !isDemo && worldBossLairsEnabled()

  // Every picker tap goes through here so mobile and desktop behave the same —
  // the mobile picker is the primary layout, so wiring only one of them is how
  // the prompt goes missing for most players.
  const pickMonsterForFight = (monster) => {
    if (offersCoop(monster) || offersWorldLair(monster) || offersHardMode(monster)) setCoopChoice(monster)
    else startFight(monster)
  }

  // Live headcount for the prompt, so "Fight together" says whether anyone is
  // actually in there. Best-effort — the prompt still works without it.
  useEffect(() => {
    if (!coopChoice) {
      setCoopOpenSessions(null)
      return undefined
    }
    let cancelled = false
    coopApi.listBosses()
      .then((res) => {
        if (cancelled) return
        // A session this character is STILL held by — a fight they refreshed or
        // crashed out of. The server keeps their save locked for it, so the
        // recovery in startCoopFight needs the id to release it.
        heldCoopSessionRef.current = Number.isFinite(res?.activeSessionId) ? res.activeSessionId : null
        const entry = (res?.bosses || []).find((b) => b.bossId === coopChoice.id)
        setCoopOpenSessions(entry?.sessions || [])
      })
      .catch(() => { if (!cancelled) setCoopOpenSessions([]) })
    return () => { cancelled = true }
  }, [coopChoice])

  // The session browser's poll. Runs only while the picker is the visible
  // screen: a fight has its own tick, and this endpoint sweeps stale rooms on
  // every call, so polling it from a backgrounded screen is pure server load.
  const coopBrowserActive = !combat && !coopSessionId && !isDungeon && !isDemo
  const reloadCoopBrowserRef = useRef(null)
  useEffect(() => {
    if (!coopBrowserActive) return undefined
    let cancelled = false
    const load = async () => {
      try {
        const res = await coopApi.listBosses()
        if (cancelled) return
        const activeSessionId = Number.isFinite(res?.activeSessionId) ? res.activeSessionId : null
        heldCoopSessionRef.current = activeSessionId
        const sessions = (res?.bosses || [])
          .flatMap((boss) => (boss.sessions || []).map((s) => ({ ...s, bossId: s.bossId || boss.bossId })))
          .sort((a, b) => (b.memberCount || 0) - (a.memberCount || 0) || a.sessionId - b.sessionId)
        setCoopBrowser({ sessions, loading: false, activeSessionId })
      } catch {
        if (!cancelled) setCoopBrowser((prev) => ({ ...prev, loading: false }))
      }
    }
    reloadCoopBrowserRef.current = load
    load()
    const timer = setInterval(load, COOP_BROWSER_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
      reloadCoopBrowserRef.current = null
    }
  }, [coopBrowserActive])

  // Joins, releasing a stale hold first if one is in the way. The server refuses
  // to move a character between rooms ("leave it first") because the old room
  // still holds their pack — but a player whose last fight ended in a refresh has
  // no way to leave it by hand, so do it for them and take them where they asked
  // to go. Leaving writes that fight's XP and supplies back onto the save.
  const joinCoopWithRecovery = async (bossId, sessionId = null) => {
    try {
      return await coopApi.join(bossId, sessionId)
    } catch (err) {
      const held = heldCoopSessionRef.current
      if (err?.body?.code !== 'CHARACTER_IN_COOP_SESSION' || !held) throw err
      // A leave that 404s has already happened (the room ended, or the sweep got
      // there first) — that is the outcome we wanted, so try the join either way.
      try { await coopApi.leave(held) } catch { /* the join below reports the real state */ }
      heldCoopSessionRef.current = null
      return await coopApi.join(bossId, sessionId)
    }
  }

  // Joins the shared fight for a boss. The save is flushed first: the server
  // snapshots it on join and owns inventory/XP from that moment, so anything
  // still only in the local client would be lost.
  const startCoopFight = async (monster, sessionId = null) => {
    if (isDemo) {
      addToast('🔒 Group bossing is available with a free account.', 'warning')
      return
    }
    const req = checkBossRequirements(monster)
    if (req.locked) {
      addToast(req.reason, 'error')
      return
    }
    setCoopJoining(monster.id)
    setCoopJoiningSession(sessionId)
    try {
      const saved = await runLockedSave()
      // A co-op lock is not a failed save. It means a room ALREADY owns this
      // character's save — a fight they refreshed or crashed out of — and the
      // join below is what sweeps that room and puts them back in. Aborting here
      // left the player wedged: every save refused, and the one call that would
      // release the lock never made.
      if (!saved && lastSaveLockCode() !== 'CHARACTER_IN_COOP_SESSION') {
        addToast('Could not save before joining — try again.', 'error')
        return
      }
      const res = await joinCoopWithRecovery(monster.id, sessionId)
      setShowCoopSessions(false)
      // What to rejoin if the room lets this player go while they are away —
      // a locked screen closes the socket, and the fight should be waiting for
      // them rather than an error.
      coopRejoinRef.current = { kind: 'boss', monster }
      setCoopSessionId(res.sessionId)
    } catch (err) {
      const code = err?.body?.code
      // The group filled up or ended between the browser rendering it and the
      // tap. Re-poll so the row the player is looking at stops lying to them.
      if (code === 'COOP_SESSION_UNAVAILABLE') reloadCoopBrowserRef.current?.()
      // BOSS_REQUIREMENTS_NOT_MET carries the same player-ready sentence the
      // client's own gate shows ("Complete X to fight Y"), so pass it through
      // rather than rebuilding a worse one from the monster.
      if (code === 'BOSS_REQUIREMENTS_NOT_MET') addToast(err?.body?.error || 'You have not unlocked this boss yet.', 'error')
      else if (code === 'CHARACTER_IN_WORLD_SESSION') addToast('You are adventuring in the World.', 'error')
      else if (code === 'CHARACTER_IN_COOP_SESSION') addToast(err?.body?.error || 'Leave your current group fight first.', 'error')
      else if (code === 'COOP_UNAVAILABLE') addToast('Group boss fights are offline right now — fight alone for the moment.', 'error')
      else if (code === 'COOP_SESSION_UNAVAILABLE') addToast(err?.body?.error || 'That group is no longer taking fighters.', 'error')
      else addToast(err?.message || 'Could not join the fight.', 'error')
    } finally {
      setCoopJoining(null)
      setCoopJoiningSession(null)
    }
  }

  // Raids run as parties, not as drop-in rooms: `offersRaidParty` is what puts
  // the solo-or-party prompt in front of a raid tap, and every picker entry
  // point routes through pickRaidForFight so the two layouts cannot disagree.
  const offersRaidParty = (raid) => isCoopRaidId(raid?.id) && !isDemo
  const pickRaidForFight = (raid) => {
    if (offersRaidParty(raid) || offersHardMode(raid)) setRaidChoice(raid)
    else startRaid(raid)
  }

  // The open lobbies for the raid the prompt is showing. Re-read on every open
  // so a party that set off between renders stops being offered.
  const reloadRaidPartiesRef = useRef(null)
  useEffect(() => {
    if (!raidChoice) {
      setRaidParties(null)
      return undefined
    }
    let cancelled = false
    const load = async () => {
      try {
        const res = await coopApi.listRaids()
        if (cancelled) return
        heldCoopSessionRef.current = Number.isFinite(res?.activeSessionId) ? res.activeSessionId : null
        setActiveRaidParty(res?.activeParty || null)
        const entry = (res?.raids || []).find((r) => r.raidId === raidChoice.id)
        setRaidParties(entry?.parties || [])
      } catch {
        if (!cancelled) setRaidParties([])
      }
    }
    reloadRaidPartiesRef.current = load
    load()
    const timer = setInterval(load, COOP_BROWSER_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
      reloadRaidPartiesRef.current = null
    }
  }, [raidChoice])

  // Opens a party (sessionId null) or joins a named lobby. The save is flushed
  // first for the same reason the co-op boss join does it: the server snapshots
  // it on join and owns the pack from that moment.
  const startRaidParty = async (raid, sessionId = null, { solo = false } = {}) => {
    if (isDemo) {
      addToast('\u{1F512} Raid parties are available with a free account.', 'warning')
      return
    }
    const req = checkRaidRequirements(raid)
    if (req.locked) {
      addToast(req.reason, 'error')
      return
    }
    setRaidJoining(sessionId ?? 'new')
    try {
      const saved = await runLockedSave()
      // A co-op lock is not a failed save — it means a room already owns this
      // character, and the join below is what releases it.
      if (!saved && lastSaveLockCode() !== 'CHARACTER_IN_COOP_SESSION') {
        addToast('Could not save before joining — try again.', 'error')
        return
      }
      const res = await joinRaidWithRecovery(raid.id, sessionId, { solo })
      setRaidChoice(null)
      // A raid is rejoined by PARTY, never by opening a fresh one: joining a
      // raid with no session id means "start a new party" (§21), which would
      // strand a returning player alone in a lobby of their own.
      coopRejoinRef.current = { kind: 'raid', raid, sessionId: res.sessionId }
      setCoopSessionId(res.sessionId)
    } catch (err) {
      const code = err?.body?.code
      if (code === 'RAID_ALREADY_STARTED' || code === 'COOP_SESSION_UNAVAILABLE') reloadRaidPartiesRef.current?.()
      if (code === 'RAID_REQUIREMENTS_NOT_MET') addToast(err?.body?.error || 'You have not unlocked this raid yet.', 'error')
      else if (code === 'RAID_ALREADY_STARTED') addToast(err?.body?.error || 'That party has already set off.', 'error')
      else if (code === 'COOP_SESSION_UNAVAILABLE') addToast(err?.body?.error || 'That party is no longer taking raiders.', 'error')
      else if (code === 'CHARACTER_IN_WORLD_SESSION') addToast('You are adventuring in the World.', 'error')
      else if (code === 'CHARACTER_IN_COOP_SESSION') addToast(err?.body?.error || 'Leave your current group fight first.', 'error')
      else if (code === 'COOP_UNAVAILABLE') addToast('Raid parties are offline right now — raid alone for the moment.', 'error')
      else addToast(err?.message || 'Could not join the party.', 'error')
    } finally {
      setRaidJoining(null)
    }
  }

  /** Same stale-hold recovery the boss join uses: a player whose last fight
   * ended in a refresh has no way to leave that room by hand. */
  const joinRaidWithRecovery = async (raidId, sessionId, { solo = false } = {}) => {
    try {
      return await coopApi.joinRaid(raidId, sessionId, { solo })
    } catch (err) {
      const held = heldCoopSessionRef.current
      if (err?.body?.code !== 'CHARACTER_IN_COOP_SESSION' || !held) throw err
      try { await coopApi.leave(held) } catch { /* the join below reports the real state */ }
      heldCoopSessionRef.current = null
      return await coopApi.joinRaid(raidId, sessionId, { solo })
    }
  }

  // Sends the player into the boss's own instanced room in the open world. From
  // the moment they connect the world server owns their save, so flush first —
  // the same reason the co-op join above does. The world opens in its own tab;
  // this screen is left as it was.
  const startWorldLairFight = async (monster) => {
    const zone = worldLairZone(monster.id)
    if (!zone) return
    const req = checkBossRequirements(monster)
    if (req.locked) {
      addToast(req.reason, 'error')
      return
    }
    setWorldJoining(monster.id)
    try {
      // A co-op lock is not a failed save — it means a room already owns this
      // character. Let the handoff request run: it refuses with the code that
      // produces the accurate "leave your group fight" message below, rather
      // than this path guessing at a save problem that isn't one.
      if (!(await runLockedSave()) && lastSaveLockCode() !== 'CHARACTER_IN_COOP_SESSION') {
        addToast('Could not save before setting out — try again.', 'error')
        return
      }
      await openWorld(api, zone)
    } catch (err) {
      const code = err?.body?.code
      if (code === 'CHARACTER_IN_COOP_SESSION') addToast('Leave your current group fight first.', 'error')
      else addToast(err?.message || 'Could not reach the world.', 'error')
    } finally {
      setWorldJoining(null)
    }
  }

  // Leaving pulls the server's copy back down: it holds the authoritative
  // inventory, XP and HP from the fight, and the in-memory client copy is stale.
  const exitCoopFight = async () => {
    // Leave BEFORE pulling: leaving is what writes the server-owned inventory,
    // XP and HP back onto the save, so pulling first would fetch the pre-fight
    // copy and throw the whole session away.
    coopLeavingRef.current = true
    try {
      if (coopSessionId) await coopApi.leave(coopSessionId)
    } catch (err) {
      addToast(err?.message || 'Could not leave the fight cleanly — your progress may take a moment.', 'error')
    }
    try {
      const pulled = await pullSave()
      if (pulled?.payload) {
        await applyCloudSave(pulled.payload, pulled.updatedAt)
        await loadGame()
      } else {
        addToast('Refresh to see your latest progress.', 'info')
      }
    } catch {
      addToast('Refresh to see your latest progress.', 'info')
    } finally {
      setCoopSessionId(null)
    }
  }

  /**
   * Puts a player back into the fight they were dropped from.
   *
   * A room lets a member go once their connection has been gone long enough
   * (§20) — a locked phone or an app switch is enough — and it writes their save
   * back and releases it on the way out. That used to leave the screen showing a
   * "not a member" error with no way forward but the back arrow, which read as
   * the fight breaking rather than as a brief absence.
   *
   * Rejoining is a fresh join, so the pull comes first: the room's write-back
   * holds the XP and supplies from the fight so far, and joining snapshots
   * whatever the save says at that moment.
   */
  const rejoinCoopFight = async () => {
    if (coopRejoiningRef.current) return
    coopRejoiningRef.current = true
    const target = coopRejoinRef.current
    const from = coopSessionId
    try {
      const pulled = await pullSave()
      if (pulled?.payload) {
        await applyCloudSave(pulled.payload, pulled.updatedAt)
        await loadGame()
      }
      if (!target) throw new Error('Your group fight ended while you were away.')
      const res = target.kind === 'raid'
        ? await joinRaidWithRecovery(target.raid.id, target.sessionId)
        : await joinCoopWithRecovery(target.monster.id)
      // A boss rejoin usually lands in the very room the player was dropped
      // from, so the id alone cannot restart the screen — the attempt counter
      // is what remounts it and opens a fresh connection either way. The
      // suppression flag is only armed when the id really does change, because
      // it is consumed by an effect cleanup that would otherwise not run.
      if (res.sessionId !== from) {
        coopLeavingRef.current = true
        setCoopSessionId(res.sessionId)
      }
      setCoopAttempt((n) => n + 1)
    } catch (err) {
      // An honest ending: the party set off without them, the room filled up
      // while they were gone, or the fight is simply over. Deliberately NOT
      // suppressing the effect's leave here — if the rejoin failed for a reason
      // that left them still held, that call is what releases their save.
      const code = err?.body?.code
      if (code === 'RAID_ALREADY_STARTED') addToast('Your party set off without you.', 'error')
      else if (code === 'COOP_SESSION_UNAVAILABLE') addToast('That group is no longer taking fighters.', 'error')
      else addToast(err?.message || 'Your group fight ended while you were away.', 'error')
      setCoopSessionId(null)
    } finally {
      coopRejoiningRef.current = false
    }
  }

  const startFight = (monster) => {
    if (isDemo && monster.boss === true) {
      addToast('🔒 Bosses are available with a free account.', 'warning')
      return
    }
    const req = checkBossRequirements(monster)
    if (req.locked) {
      addToast(req.reason, 'error')
      return
    }
    // Map-driven gating (Phase 3): must be at a place that offers this monster.
    if (!requestActivityStart({ type: 'combat', monster })) return
    cancelAutoFight()
    const { combatType: weaponCombatType, weaponItem, isPoweredStaff, spell, needsSpell } = resolveMagicSpell(equipment, itemsData, activeCombatSpell, spellsData)
    const combatType = needsSpell ? 'melee' : weaponCombatType
    if (needsSpell) addToast('No spell selected — attacking with melee. Use the 🔮 Cast Spell button to fight with magic.', 'info')
    // Hard mode is a scaled COPY of the record (and of the table its adds come
    // out of), never a branch in the engine — see src/engine/hardMode.js. The
    // scaled record is what the active task carries, so an auto-fight, an idle
    // sim and a reload all keep fighting the same boss.
    const hard = offersHardMode(monster) && isHardMode('monsters', monster.id)
    if (hard) monster = scaleMonsterForHardMode(monster)
    // A scaled record can outlive the switch that made it — the info sheet holds
    // one, and hard mode can be turned off behind it. Going back to the authored
    // record is the only way back down: scaling has no inverse.
    else if (monster.hardModeActive) monster = monstersData[monster.id] || monster
    const state = createCombatState(monster, combatType, combatStance, spell, monstersTableFor(monstersData, hard), { grindman: isGrindman })
    // Reset special attack energy on new fight; preserve active potions so they last their full 5 minutes
    state.specialAttackEnergy = 100
    // Prayer pool starts full (= Prayer level) at the start of a combat session.
    const prayerLvl = getLevelFromXP(stats.prayer?.xp || 0)
    state.maxPrayerPoints = prayerLvl
    state.prayerPoints = prayerLvl
    state.activePotions = combatRef.current ? { ...combatRef.current.activePotions } : {}
    fightSeqRef.current += 1
    clearStageDeathTarget()
    setCombat(state)
    setKillCount(0)
    setFightStartedAt(Date.now())
    const spellName = spell ? ` with ${spell.name}` : isPoweredStaff && weaponItem ? ` with ${weaponItem.name}` : ''
    setLog([{ text: `Fighting ${monster.name}${spellName}...`, type: 'info', time: Date.now() }])
    setActiveTask({ type: 'combat', monster, stance: combatStance, bankingEnabled: true, spell: spell || null, dungeon: isDungeon })
  }

  const startRaid = async (raidData) => {
    if (isDemo) {
      addToast('🔒 Raids are available with a free account.', 'warning')
      return
    }
    const req = checkRaidRequirements(raidData)
    if (req.locked) {
      addToast(req.reason, 'error')
      return
    }
    if (!requestActivityStart({ type: 'raid', raid: raidData })) return

    const { combatType: weaponCombatType, spell, needsSpell } = resolveMagicSpell(equipment, itemsData, activeCombatSpell, spellsData)
    const combatType = needsSpell ? 'melee' : weaponCombatType
    if (needsSpell) addToast('No spell selected — attacking with melee. Use the 🔮 Cast Spell button to fight with magic.', 'info')

    const hardRaid = offersHardMode(raidData) && isHardMode('raids', raidData.id)
    const table = monstersTableFor(monstersData, hardRaid)
    const state = createRaidCombatState(raidData, table, combatType, combatStance, spell, { grindman: isGrindman })
    if (!state) {
      addToast('Failed to start raid — missing encounter data', 'error')
      return
    }

    state.specialAttackEnergy = 100
    const raidPrayerLvl = getLevelFromXP(stats.prayer?.xp || 0)
    state.maxPrayerPoints = raidPrayerLvl
    state.prayerPoints = raidPrayerLvl
    state.activePotions = combatRef.current ? { ...combatRef.current.activePotions } : {}
    combatRef.current = state
    fightSeqRef.current += 1
    clearStageDeathTarget()
    setCombat(state)
    setKillCount(0)
    setFightStartedAt(Date.now())
    setTargetsExpanded(true)

    const firstId = Array.isArray(raidData.waves) ? raidData.waves[0]?.primary : raidData.bosses?.[0]
    const firstBoss = firstId ? table[firstId] : null
    const isWaveRaid = Array.isArray(raidData.waves)
    const total = isWaveRaid ? raidData.waves.length : (raidData.bosses?.length || 1)
    setLog([
      { text: '🩸 ' + raidData.name + ' — Raid started!', type: 'raid', time: Date.now() },
      { text: (isWaveRaid ? 'Wave' : 'Boss') + ' 1/' + total + ': ' + (firstBoss?.name || 'Unknown'), type: 'info', time: Date.now() }
    ])
    setActiveTask({ type: 'combat', monster: state.monster, stance: combatStance, bankingEnabled: false, spell: spell || null, raid: true, raidId: raidData.id })
  }

  const continueFight = (monster) => {
    // equipmentRef, not `equipment` — scheduleAutoFight defers this call by
    // AUTO_FIGHT_RESTART_MS via setTimeout, so the closure that actually runs
    // is the one captured at kill time. A weapon swap during that wait updates
    // equipmentRef.current immediately but never reaches that stale `equipment`
    // binding, so the restarted fight (and its sprite) kept animating with
    // whatever was equipped at the moment of the kill — same class of bug
    // equipmentRef exists to prevent everywhere else mid-fight (e.g. the
    // live-fight spell-sync effect above, which already reads the ref).
    const { combatType: weaponCombatType, spell, needsSpell } = resolveMagicSpell(equipmentRef.current, itemsData, activeCombatSpell, spellsData)
    // A magic weapon with no castable spell fights with melee instead of
    // stopping the auto-fight — see resolveMagicSpell.
    const combatType = needsSpell ? 'melee' : weaponCombatType
    // The monster handed in here came out of the active task, so a hard-mode
    // fight arrives already scaled — scaleMonsterForHardMode is idempotent, and
    // the table has to match it or the next add spawns at normal strength.
    const hard = monster?.hardModeActive === true
    const state = createCombatState(monster, combatType, combatStance, spell, monstersTableFor(monstersData, hard), { grindman: isGrindman })
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
    fightSeqRef.current += 1
    clearStageDeathTarget()
    setCombat(state)
    setActiveTask({ type: 'combat', monster, stance: combatStance, bankingEnabled: true, spell: spell || null, dungeon: isDungeon })
  }

  const scheduleAutoFight = (monsterId, hardMode) => {
    cancelAutoFight()
    setAutoFightPending(true)
    autoFightTimerRef.current = setTimeout(() => {
      autoFightTimerRef.current = null
      setAutoFightPending(false)
      // The player may have walked away, died, or started another fight during
      // the delay — every one of those leaves this restart stale.
      if (!combatRef.current || combatRef.current.active) return
      if (combatRef.current.monster?.id !== monsterId) return
      const original = monstersTableFor(monstersData, hardMode === true)[monsterId]
      if (original) continueFight(original)
    }, AUTO_FIGHT_RESTART_MS)
  }

  // Present an ordinary kill: loot as a reward-reveal card, fight re-armed.
  const announceOrdinaryKill = ({ monsterId, monsterName, hardMode, loot }) => {
    emitKillReveal(monsterId, monsterName, loot)
    scheduleAutoFight(monsterId, hardMode)
  }

  // Claim one full-raid reward roll from the server (the legitimate grant path)
  // and surface it in the loot modal. Used both when a raid is completed live
  // and when the player skips an entire raid from the loot modal — a skip just
  // re-rolls another complete reward rather than re-simulating every boss.
  const claimRaidCompletion = async ({
    raidId, monster, slayerXpGained = 0, isBossKill = false, hardMode = false,
    completionPayload = {}, recordCompletion = true,
  }) => {
    const cashOutWave = raidId === 'sunspire_colosseum' && completionPayload?.wave && !recordCompletion
      ? Number(completionPayload.wave)
      : null
    setLootModal({ monster, hardMode, loot: [], slayerXpGained, isBossKill, raidId, cashOutWave, loading: true })
    try {
      const res = await api.completeRaid(raidId, {
        actionNonce: `raid:${raidId}:${Date.now()}`,
        hardMode,
        ...completionPayload,
      })
      const granted = Array.isArray(res?.granted) ? res.granted : []
      if (granted.length > 0) {
        const newInv = [...inventoryRef.current]
        const newBank = { ...(bankRef.current || {}) }
        for (const reward of granted) {
          const itemId = reward?.itemId
          const quantity = Math.floor(Number(reward?.quantity) || 0)
          if (!itemId || quantity < 1) continue
          if (reward?.destination === 'bank') {
            const existing = newBank[itemId]
            const existingQty = Math.floor(Number(existing?.quantity ?? existing) || 0)
            newBank[itemId] = {
              ...(existing && typeof existing === 'object' ? existing : {}),
              itemId,
              quantity: existingQty + quantity,
            }
          } else {
            addLootEntry(newInv, reward, itemsData)
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
      if (recordCompletion) recordGameEvent?.({ kind: 'raid_complete', raidId })
      setLootModal({
        monster,
        loot: granted.map(reward => ({ itemId: reward.itemId, quantity: reward.quantity })),
        slayerXpGained,
        isBossKill,
        raidId,
        cashOutWave,
        loading: false
      })
      return true
    } catch (err) {
      setLootModal(null)
      addToast(`Raid claim failed: ${err?.message || 'server_error'}`, 'error')
      return false
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
  const skipEntireRaid = async ({ raidId, monster, slayerXpGained = 0, isBossKill = false, hardMode = false } = {}) => {
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
    setLootModal({ monster, hardMode, loot: [], slayerXpGained, isBossKill, raidId, loading: true })
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
      await claimRaidCompletion({ raidId, monster, slayerXpGained, isBossKill, hardMode })
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
  // The full-screen modal is raid-only now (§6) — a standalone boss kill
  // announces on the reward-reveal card like any other monster, so this skip
  // path only ever needs to handle a raid.
  const skipAgain = async () => {
    const modal = lootModal
    if (!modal || modal.loading || !modal.raidId) return
    setLootModal(null)
    await new Promise(r => requestAnimationFrame(r))
    await skipEntireRaid({
      raidId: modal.raidId,
      monster: modal.monster,
      slayerXpGained: modal.slayerXpGained || 0,
      isBossKill: modal.isBossKill,
      hardMode: modal.hardMode === true,
    })
  }

  // Register the full-raid skip for the top-nav Skip button. The nav button
  // (App.handleSkip1h) calls this when the active task is a raid, deriving the
  // raid from the live combat state. Mirrors combatSkipHandlerRef wiring.
  const navRaidSkipRef = useRef(null)
  navRaidSkipRef.current = () => {
    const st = combatRef.current
    const raidId = st?.raid?.raidId
    if (!raidId) return Promise.resolve()
    if (raidId === 'sunspire_colosseum') {
      addToast('Sunspire cannot be skipped — the chest risk is part of the run.', 'info')
      return Promise.resolve()
    }
    return skipEntireRaid({ raidId, monster: st?.monster, isBossKill: true, hardMode: st?.monster?.hardModeActive === true })
  }
  useEffect(() => {
    if (!raidSkipHandlerRef) return
    raidSkipHandlerRef.current = () => navRaidSkipRef.current?.()
    return () => { raidSkipHandlerRef.current = null }
  }, [])

  const stopAndBack = () => {
    cancelAutoFight()
    clearStageDeathTarget()
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
    pushConsume()
    if (newInv[idx].quantity > 1) {
      newInv[idx] = { ...newInv[idx], quantity: newInv[idx].quantity - 1 }
    } else {
      newInv[idx] = null
    }
    updateInventory(newInv)
    inventoryRef.current = newInv

    const healing = brew.boost || 10
    const actor = { hp: hpRef.current, maxHP: getCombatMaxHP(), activePotions: { ...(combatRef.current?.activePotions || {}) } }
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
    pushConsume()
    if (newInv[foodIdx].quantity > 1) {
      newInv[foodIdx] = { ...newInv[foodIdx], quantity: newInv[foodIdx].quantity - 1 }
    } else {
      newInv[foodIdx] = null
    }
    updateInventory(newInv)
    inventoryRef.current = newInv
    const actor = { hp: hpRef.current, maxHP: getCombatMaxHP(), activePotions: {} }
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
    pushConsume()

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
      hp: hpRef.current, maxHP: getCombatMaxHP(),
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
    if (state.raid?.raidId === 'sunspire_colosseum') {
      addToast('Sunspire waves cannot be skipped.', 'info')
      return false
    }
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
  if (coopSessionId) {
    return (
      <CoopBossScreen
        key={`coop-${coopSessionId}-${coopAttempt}`}
        sessionId={coopSessionId}
        characterId={parseInt(getCharacterId(), 10)}
        addToast={addToast}
        onExit={exitCoopFight}
        onRejoin={rejoinCoopFight}
        onDeath={() => { if (oneLifeModeRef.current) revertOneLifeAfterDeath() }}
      />
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
    const coopBrowserPanel = coopBrowserActive ? (
      <CoopSessionBrowser
        sessions={coopBrowser.sessions}
        monstersData={monstersData}
        loading={coopBrowser.loading}
        onOpen={() => setShowCoopSessions(true)}
      />
    ) : null
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
            onFight={pickMonsterForFight}
            isHardMode={isHardMode}
            offersCoop={offersCoop}
            onMonsterInfo={setSelectedMonsterInfo}
            onStartRaid={pickRaidForFight}
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
            showPvp={!isDemo && !isDungeon && worldBetaEnabled()}
            onOpenPvp={() => setShowWildernessEntry(true)}
            demoLockBosses={isDemo}
            coopBrowserPanel={coopBrowserPanel}
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
            class={`fm-toggle fm-toggle--sm flex-1${idleCombatSetup?.food?.length > 0 ? ' is-on' : ''}`}
            title="Configure food the simulator can use during idle/skip combat"
          >
            <GameIcon iconKey="meat" color={idleCombatSetup?.food?.length > 0 ? 'var(--fm-btn-ink-on)' : 'var(--fm-btn-ink)'} size={14} /> Idle Eat
            {idleCombatSetup?.food?.length > 0 && <span class="ml-1">✓</span>}
          </button>
          <button
            onClick={() => setIdleSetupMode('prayer')}
            class={`fm-toggle fm-toggle--sm flex-1${(idleCombatSetup?.prayers?.protectionPrayerId || idleCombatSetup?.prayers?.combatPrayerId) ? ' is-on' : ''}`}
            title="Configure prayers the simulator should use during idle/skip combat"
          >
            <GameIcon iconKey="prayer" color={(idleCombatSetup?.prayers?.protectionPrayerId || idleCombatSetup?.prayers?.combatPrayerId) ? 'var(--fm-btn-ink-on)' : 'var(--fm-btn-ink)'} size={14} /> Idle Pray
            {(idleCombatSetup?.prayers?.protectionPrayerId || idleCombatSetup?.prayers?.combatPrayerId) && <span class="ml-1">✓</span>}
          </button>
          <button
            onClick={() => setIdleSetupMode('potion')}
            class={`fm-toggle fm-toggle--sm flex-1${idleCombatSetup?.potions?.length > 0 ? ' is-on' : ''}`}
            title="Configure potions the simulator can drink during idle/skip combat"
          >
            <GameIcon iconKey="potion_ball" color={idleCombatSetup?.potions?.length > 0 ? 'var(--fm-btn-ink-on)' : 'var(--fm-btn-ink)'} size={14} /> Idle Potion
            {idleCombatSetup?.potions?.length > 0 && <span class="ml-1">✓</span>}
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
                class={`fm-toggle fm-toggle--sm flex-1 capitalize${combatStance === s ? ' is-on' : ''}`}
              >
                <GameIcon iconKey={art.icon} color={combatStance === s ? 'var(--fm-btn-ink-on)' : art.accent} size={14} />
                {s}
              </button>
            )
          })}
        </div>

        {coopBrowserPanel}

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
                    // Same rule as the mobile row: a boss set to hard is listed
                    // with the numbers the fight will actually open with.
                    const hardOn = isHardMode('monsters', monster.id)
                    const shownMonster = hardOn ? scaleMonsterForHardMode(monster) : monster
                    return (
                    <div key={monster.id} class="flex gap-2 items-center" title={isLocked ? (bossReq.locked ? bossReq.reason : '') : ''}>
                      <button
                        onClick={() => !isLocked && pickMonsterForFight(monster)}
                        disabled={isLocked}
                        title={isLocked && bossReq.locked ? bossReq.reason : ''}
                        class={`flex-1 flex items-center justify-between p-3 rounded-xl border transition-colors
                          ${isOnTask ? 'bg-[var(--surface-raised)] border-[var(--color-gold-dim)]' :
                            isLocked ? 'bg-[var(--color-void)] border-[var(--color-void-light)] opacity-50' :
                            'bg-[var(--color-void-light)] border-[var(--color-void-border)] active:bg-[var(--color-void-lighter)]'}`}
                      >
                        <div class="flex items-center gap-3">
                          <SkillEmblem iconKey={getMonsterArt(monster, category.key).icon} accent={getMonsterArt(monster, category.key).accent} size={36} glow={0} />
                          <div class="text-left">
                            {/* Tags wrap under the name instead of squeezing it — a boss can
                                carry TASK, GROUP and HARD at once (mirrors .cb-mon__name). */}
                            <div class="flex items-center flex-wrap gap-1.5">
                              <span class="flex-shrink-0 text-sm font-semibold text-[var(--color-parchment)]">{monster.name}</span>
                              {isOnTask && <span class="flex-shrink-0 text-[9px] bg-yellow-500 text-black font-bold px-1 rounded">TASK</span>}
                              {offersCoop(monster) && !isLocked && (
                                <span class="flex-shrink-0 text-[9px] border border-[var(--color-gold-dim)] text-[var(--color-gold)] font-bold px-1 rounded">GROUP</span>
                              )}
                              {hardOn && <HardModeTag />}
                            </div>
                            <div class="text-[10px] text-[var(--color-parchment)]">
                              HP {shownMonster.hitpoints} · Att {shownMonster.stats.attack} · Def {shownMonster.stats.defence}
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
                        onClick={() => setSelectedMonsterInfo(shownMonster)}
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
            ).sort(orderBy(COMBAT_RAID_ORDER, r => r.id)).map(raid => {
              const raidReq = checkRaidRequirements(raid)
              const demoRaidLocked = isDemo
              const isRaidLocked = raidReq.locked || demoRaidLocked
              const raidLockReason = raidReq.locked ? raidReq.reason : demoRaidLocked ? 'Available with a free account' : ''
              return (
                <div key={raid.id} class="flex gap-2 items-center" title={isRaidLocked ? raidLockReason : ''}>
                  <button
                    onClick={() => !isRaidLocked && pickRaidForFight(raid)}
                    disabled={isRaidLocked}
                    title={isRaidLocked ? raidLockReason : ''}
                    class={`flex-1 p-3 rounded-xl border transition-colors text-left flex items-center justify-between
                      ${isRaidLocked ? 'bg-[var(--color-void)] border-[var(--color-void-light)] opacity-50' : 'bg-[var(--color-void-light)] border-[var(--color-void-border)] active:bg-[var(--color-void-lighter)]'}`}
                  >
                    <div class="flex-1 flex items-center gap-2">
                      <SkillEmblem iconKey={getRaidArt(raid.id).icon} accent={getRaidArt(raid.id).accent} size={36} glow={0} />
                      <div>
                        <div class="text-sm font-semibold text-[var(--color-parchment)]">{raid.name}</div>
                        {isRaidLocked && <div class="text-[10px] text-[var(--color-blood-light)]">🔒 {raidLockReason}</div>}
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

        {/* Wilderness entry — preview-only, hidden in the demo (no account, so no world
            handoff) and in dungeons. Ironman and One Life accounts may both go:
            an Ironman simply cannot take another player's loot, and a One Life
            run ends there like it ends anywhere else. */}
        {!isDemo && !isDungeon && worldBetaEnabled() && (
          <div class="mt-6 pb-2">
            <button
              onClick={() => setShowWildernessEntry(true)}
              class="cb-raid__enter flex items-center justify-center gap-2"
              style={{ marginTop: 0, background: 'linear-gradient(180deg,#c0392b,#8b1a1a)', color: 'var(--color-parchment)', boxShadow: '0 8px 20px -8px rgba(192,57,43,0.6), inset 0 1px 0 rgba(255,255,255,0.15)' }}
              title="The Wilderness"
            >
              <GameIcon iconKey="crossed_swords" color="var(--color-parchment)" size={18} />
              <span>The Wilderness</span>
            </button>
            <div class="text-[9px] text-[var(--color-parchment)] opacity-90 mt-1.5 text-center px-2">
              Open-world PvP. Die out there and you drop everything you carry and everything you wear.
            </div>
          </div>
        )}
      </div>
      )}

      {showWildernessEntry && worldBetaEnabled() && (
        <WildernessEntryModal onClose={() => setShowWildernessEntry(false)} />
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
          grindman={isGrindman}
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
                <div class="flex justify-between text-[11px] text-[var(--color-parchment)]"><span>Defence</span><span class="font-[var(--font-mono)]"><WasIs info={getDefenceLevelInfo(selectedMonsterInfo)} /></span></div>
                <div class="flex justify-between text-[11px] text-[var(--color-parchment)]"><span>Magic</span><span class="font-[var(--font-mono)]">{selectedMonsterInfo.stats.magic}</span></div>
                <div class="flex justify-between text-[11px] text-[var(--color-parchment)]"><span>Ranged</span><span class="font-[var(--font-mono)]">{selectedMonsterInfo.stats.ranged}</span></div>
              </div>
            </div>
            <div>
              <h4 class="text-xs font-semibold text-[var(--color-gold-dim)] uppercase tracking-wider mb-2 opacity-70">Defence Bonuses</h4>
              <div class="bg-[var(--color-void)] rounded-lg p-3 space-y-1">
                {DEFENCE_STYLES.map(style => {
                  const info = getDefenceBonusInfo(selectedMonsterInfo, style)
                  return (
                    <div key={style} class="flex justify-between text-[11px] text-[var(--color-parchment)]">
                      <span class="capitalize">{style}</span>
                      <span class={`font-[var(--font-mono)] ${info.current >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        <WasIs info={info} format={(n) => `${n >= 0 ? '+' : ''}${n}`} />
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
            <MonsterPhaseStats monster={selectedMonsterInfo} />
            <MonsterAddStats monster={selectedMonsterInfo} />
            <MonsterDropList monster={selectedMonsterInfo} itemsData={itemsData} grindman={isGrindman} />
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
          boost={raidDropBoost(selectedRaidInfo)}
          onStartRaid={(raid) => { setSelectedRaidInfo(null); pickRaidForFight(raid) }}
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
            {(() => {
              const waveRaid = isWaveRaid(selectedRaidInfo)
              const stages = raidInfoStages(selectedRaidInfo, monstersData)
              return (
                <div>
                  <h4 class="text-xs font-semibold text-[var(--color-gold-dim)] uppercase tracking-wider mb-2 opacity-70">{waveRaid ? 'Waves' : 'Bosses'}</h4>
                  <div class="space-y-1">
                    {stages.map((stage) => {
                      const boss = stage.primary
                      if (!boss) return null
                      const bossArt = getMonsterArt(boss)
                      const waveDetail = stage.kind === 'wave'
                        ? ` · ${stage.startingEnemyCount} starting enem${stage.startingEnemyCount === 1 ? 'y' : 'ies'}${stage.reinforcementCount > 0 ? ` · +${stage.reinforcementCount} reinforcement${stage.reinforcementCount === 1 ? '' : 's'}` : ''}`
                        : ''
                      return (
                        <div key={stage.key} class="bg-[var(--color-void)] rounded-lg p-2 flex items-center justify-between">
                          <div class="flex items-center gap-2">
                            <SkillEmblem iconKey={bossArt.icon} accent={bossArt.accent} size={22} glow={0} />
                            <div>
                              <div class="text-[11px] font-semibold text-[var(--color-parchment)]">{stage.label}{stage.kind === 'wave' ? ' · ' : '. '}{boss.name}</div>
                              <div class="text-[9px] text-[var(--color-parchment)] opacity-50">HP {boss.hitpoints} · CB {boss.combatLevel}{waveDetail}</div>
                            </div>
                          </div>
                          <span class="text-[9px] text-[var(--color-parchment)] opacity-40 font-[var(--font-mono)]">CB {boss.combatLevel}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()}
            {selectedRaidInfo.rewards && (() => {
              const raidBoost = raidDropBoost(selectedRaidInfo)
              const raidBoostLabel = dropRateBoostLabel(raidBoost)
              return (
              <div>
                <h4 class="text-xs font-semibold text-[var(--color-gold-dim)] uppercase tracking-wider mb-2 opacity-70">Rewards</h4>
                {raidBoostLabel && (
                  <div class="text-[10px] font-semibold text-[var(--color-gold)] mb-2">{raidBoostLabel}</div>
                )}
                <div class="space-y-1">
                  {selectedRaidInfo.rewards.always?.map(drop => {
                    const item = itemsData[drop.itemId]
                    return (
                      <div key={drop.itemId} class="bg-[var(--color-void)] rounded-lg p-2 flex items-center justify-between">
                        <div class="flex items-center gap-1.5 text-[11px] text-[var(--color-parchment)]">
                          <GameIcon item={item} iconKey={item?.iconId} size={16} /> {item?.name || drop.itemId}
                        </div>
                        <div class="text-[9px] text-[var(--color-parchment)] opacity-50">
                          {formatDropChance(displayedDropChance(drop.chance, raidBoost))}
                          {Array.isArray(drop.quantity) ? ` · ${drop.quantity[0]}–${drop.quantity[1]}` : ` · ${drop.quantity}`}
                        </div>
                      </div>
                    )
                  })}
                  {selectedRaidInfo.rewards.unique && (
                    <div class="bg-[var(--surface-raised)] border border-[var(--color-gold-dim)] rounded-lg p-2 mt-1">
                      <div class="text-[10px] font-semibold text-[var(--color-gold)] mb-1">
                        {(() => {
                          const range = raidUniqueChanceRange(selectedRaidInfo)
                          return range
                            ? `✨ Unique Drop (${formatDropChance(displayedDropChance(range.first.chance, raidBoost))} at Wave ${range.first.wave} → ${formatDropChance(displayedDropChance(range.last.chance, raidBoost))} at Wave ${range.last.wave})`
                            : `✨ Unique Drop (${(displayedDropChance(selectedRaidInfo.rewards.unique.chance, raidBoost) * 100).toFixed(1)}% chance)`
                        })()}
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
              )
            })()}
          </div>
        </Modal>
      )}

      {/* Live group fights. A modal rather than an inline list: a busy night
          would otherwise push the foe list off the screen. */}
      {showCoopSessions && (
        <Modal title="Live Group Fights" onClose={() => setShowCoopSessions(false)}>
          <p class="text-[11px] text-[var(--color-parchment)] opacity-70 mb-3">
            Join a boss someone is already fighting. The drop goes to whoever deals the most damage; everyone keeps their own XP.
          </p>
          <div class="max-h-96 overflow-y-auto">
            <CoopSessionList
              sessions={coopBrowser.sessions}
              monstersData={monstersData}
              activeSessionId={coopBrowser.activeSessionId}
              joiningSessionId={coopJoiningSession}
              checkBossRequirements={checkBossRequirements}
              onJoin={(session, monster) => startCoopFight(monster, session.sessionId)}
            />
          </div>
        </Modal>
      )}

      {/* Solo-or-party prompt for a raid. Same place and same reasoning as the
          boss prompt below: every picker path into a raid comes through here. */}
      {raidChoice && (
        <Modal onClose={() => setRaidChoice(null)}>
          <div class="flex items-center gap-2 mb-1">
            <SkillEmblem iconKey={getRaidArt(raidChoice.id).icon} accent={getRaidArt(raidChoice.id).accent} size={28} glow={0} />
            <h3 class="font-[var(--font-display)] text-base font-bold text-[var(--color-gold)]">{raidChoice.name}</h3>
            {isHardMode('raids', raidChoice.id) && <HardModeTag />}
          </div>
          <p class="text-[11px] text-[var(--color-parchment)] opacity-70 mb-4">How do you want to run this raid?</p>

          {offersHardMode(raidChoice) && (
            <div class="mb-4">
              <HardModeToggle
                enabled={isHardMode('raids', raidChoice.id)}
                pending={hardModePending === hardModeKey('raids', raidChoice.id)}
                onToggle={(next) => toggleHardMode('raids', raidChoice.id, next, raidChoice.name)}
              />
            </div>
          )}

          <div class="space-y-2 mb-4">
            <button
              onClick={() => {
                const r = raidChoice
                setRaidChoice(null)
                startRaid(r)
              }}
              class="w-full text-left p-3 rounded-xl border border-[var(--color-void-border)] bg-[var(--color-void-light)] active:bg-[var(--color-void-lighter)]"
            >
              <div class="text-sm font-semibold text-[var(--color-parchment)]">Raid alone</div>
              <div class="text-[10px] text-[var(--color-parchment)] opacity-60 mt-0.5">
                {raidChoice.id === 'sunspire_colosseum'
                  ? 'Run the raid solo using the normal PocketRPG combat engine. Rewards are settled by the server when you cash out.'
                  : 'Every boss, back to back, and the whole reward table is yours.'}
              </div>
            </button>
          </div>

          <div class="text-xs font-semibold text-[var(--color-gold)] uppercase tracking-wider mb-2">Raid together</div>
          <p class="text-[10px] text-[var(--color-parchment)] opacity-60 mb-2">
            Up to eight of you share one run. Deal 10% of the raid's health and you roll the
            reward table yourself. Nobody can join once the host sets off.
          </p>
          {activeRaidParty?.raidId === raidChoice.id && activeRaidParty.phase !== 'lobby' && (
            <button
              onClick={() => startRaidParty(raidChoice, activeRaidParty.sessionId)}
              disabled={raidJoining === activeRaidParty.sessionId}
              class="w-full text-left p-3 mb-2 rounded-xl border border-[var(--color-gold-dim)] bg-[var(--color-void-light)] active:bg-[var(--color-void-lighter)] disabled:opacity-40"
            >
              <div class="text-sm font-semibold text-[var(--color-gold)]">
                {raidJoining === activeRaidParty.sessionId ? 'Rejoining\u2026' : 'Rejoin your run'}
              </div>
              <div class="text-[10px] text-[var(--color-parchment)] opacity-60 mt-0.5">
                Your party is already raiding. It is not in the list below because nobody
                can join a run once it has started.
              </div>
            </button>
          )}

          <div class="max-h-80 overflow-y-auto">
            <CoopRaidPartyList
              raid={raidChoice}
              parties={raidParties}
              joining={raidJoining}
              activeSessionId={heldCoopSessionRef.current}
              onHost={() => startRaidParty(raidChoice)}
              onJoin={(party) => startRaidParty(raidChoice, party.sessionId)}
            />
          </div>

          <p class="text-[10px] text-[var(--color-parchment)] opacity-50 mt-3">
            While you are in a party the server runs your character, so the rest of the game is
            paused until you come back.
          </p>
        </Modal>
      )}

      {/* Hard Mode's one gate. Rendered over the fight prompt rather than inside
          it so the same confirmation covers a boss and a raid. */}
      {hardModeConfirm && (
        <Modal onClose={() => setHardModeConfirm(null)}>
          <HardModeConfirm
            name={hardModeConfirm.name}
            pending={hardModePending === hardModeKey(hardModeConfirm.sourceType, hardModeConfirm.sourceId)}
            onCancel={() => setHardModeConfirm(null)}
            onConfirm={() => commitHardMode(hardModeConfirm.sourceType, hardModeConfirm.sourceId, true)}
          />
        </Modal>
      )}

      {/* Solo-or-group prompt. Lives in the PICKER block: this is the only
          render path where a boss is chosen, and both layouts route into it. */}
      {coopChoice && (
        <Modal onClose={() => setCoopChoice(null)}>
          <div class="flex items-center gap-2 mb-1">
            <SkillEmblem iconKey={getMonsterArt(coopChoice).icon} accent={getMonsterArt(coopChoice).accent} size={28} glow={0} />
            <h3 class="font-[var(--font-display)] text-base font-bold text-[var(--color-gold)]">{coopChoice.name}</h3>
            {isHardMode('monsters', coopChoice.id) && <HardModeTag />}
          </div>
          <p class="text-[11px] text-[var(--color-parchment)] opacity-70 mb-4">How do you want to fight this?</p>

          {offersHardMode(coopChoice) && (
            <div class="mb-4">
              <HardModeToggle
                enabled={isHardMode('monsters', coopChoice.id)}
                pending={hardModePending === hardModeKey('monsters', coopChoice.id)}
                onToggle={(next) => toggleHardMode('monsters', coopChoice.id, next, coopChoice.name)}
              />
            </div>
          )}

          <div class="space-y-2">
            <button
              onClick={() => { const m = coopChoice; setCoopChoice(null); startFight(m) }}
              class="w-full text-left p-3 rounded-xl border border-[var(--color-void-border)] bg-[var(--color-void-light)] active:bg-[var(--color-void-lighter)]"
            >
              <div class="text-sm font-semibold text-[var(--color-parchment)]">Fight alone</div>
              <div class="text-[10px] text-[var(--color-parchment)] opacity-60 mt-0.5">
                The whole drop table is yours. Kill count and collection log as normal.
              </div>
            </button>

            {offersCoop(coopChoice) && (
              <button
                onClick={() => { const m = coopChoice; setCoopChoice(null); startCoopFight(m) }}
                disabled={coopJoining === coopChoice.id}
                class="w-full text-left p-3 rounded-xl border border-[var(--color-gold-dim)] bg-[var(--color-void-light)] active:bg-[var(--color-void-lighter)] disabled:opacity-40"
              >
                <div class="text-sm font-semibold text-[var(--color-gold)]">
                  {coopJoining === coopChoice.id ? 'Joining\u2026' : 'Fight together'}
                </div>
                <div class="text-[10px] text-[var(--color-parchment)] opacity-60 mt-0.5">
                  Share one boss with other players. The drop goes to whoever deals the most damage. Everyone keeps their own XP.
                </div>
                <div class="text-[10px] text-[var(--color-gold)] opacity-80 mt-1">
                  {coopOpenSessions === null
                    ? 'Checking who is in there\u2026'
                    : (() => {
                      // Only rooms at the difficulty this player would join —
                      // a hard-mode join never lands in a normal room.
                      const wantHard = isHardMode('monsters', coopChoice.id)
                      const fighters = coopOpenSessions
                        .filter((s) => !!s.hardMode === wantHard)
                        .reduce((sum, s) => sum + (s.memberCount || 0), 0)
                      if (fighters === 0) return 'Nobody in there yet, so you would start a new fight.'
                      return `${fighters} ${fighters === 1 ? 'player is' : 'players are'} fighting right now.`
                    })()}
                </div>
              </button>
            )}

            {offersWorldLair(coopChoice) && (
              <button
                onClick={() => { const m = coopChoice; setCoopChoice(null); startWorldLairFight(m) }}
                disabled={worldJoining === coopChoice.id}
                class="w-full text-left p-3 rounded-xl border border-[var(--color-mana)] bg-[var(--color-void-light)] active:bg-[var(--color-void-lighter)] disabled:opacity-40"
              >
                <div class="text-sm font-semibold text-[var(--color-mana)]">
                  {worldJoining === coopChoice.id ? 'Setting out\u2026' : 'Fight in the open world'}
                </div>
                <div class="text-[10px] text-[var(--color-parchment)] opacity-60 mt-0.5">
                  Walk into its own lair in 3D, up to eight of you, and fight it where it lives. Opens in a new tab.
                </div>
              </button>
            )}
          </div>

          <p class="text-[10px] text-[var(--color-parchment)] opacity-50 mt-3">
            While you are in a group fight or out in the world the server runs your character, so the rest of the game is paused until you come back.
          </p>
        </Modal>
      )}

      </>
    )
  }

  // A solo Sunspire run uses the ordinary local raid engine. Only the reward
  // claim crosses the server boundary, exactly like other solo raids.
  if (combat?.raid?.raidId === 'sunspire_colosseum' && combat.raid.awaitingDecision && !lootModal) {
    const wave = (Number(combat.raid.currentWaveIndex) || 0) + 1
    const totalWaves = combat.raid.waves?.length || 12
    const finalWave = wave >= totalWaves
    const continueSunspire = (modifierId = null) => {
      const raidData = raidsData.sunspire_colosseum
      const modifierState = SUNSPIRE_MODIFIERS_ENABLED && modifierId
        ? raiseSunspireModifierTier(combat.raid.modifierState || {}, modifierId)
        : {}
      const next = continueRaidCombatState(combat, raidData, monstersData, { modifierState })
      if (!next) {
        addToast('Could not start the next Sunspire wave.', 'error')
        return
      }
      const cappedHP = Math.min(hpRef.current, getCombatMaxHP(next))
      if (cappedHP !== hpRef.current) {
        updateHP(cappedHP)
        hpRef.current = cappedHP
      }
      combatRef.current = next
      fightSeqRef.current += 1
      setCombat({ ...next })
      // Keep the player's Targets collapse preference across waves. A fresh raid
      // still starts expanded; wave transitions no longer override their choice.
      setActiveTask({
        type: 'combat',
        monster: next.monster,
        stance: next.stance || combatStance,
        bankingEnabled: false,
        spell: next.spell || null,
        raid: true,
        raidId: raidData.id,
      })
    }
    const claimSunspire = async () => {
      if (sunspireClaimBusy) return
      setSunspireClaimBusy(true)
      // Leave decision mode before opening the reward modal so it can render
      // over the normal combat shell rather than being hidden by this return.
      const settledState = { ...combat, raid: { ...combat.raid, awaitingDecision: false } }
      combatRef.current = settledState
      setCombat(settledState)
      const ok = await claimRaidCompletion({
        raidId: 'sunspire_colosseum',
        monster: combat.monster,
        isBossKill: finalWave,
        completionPayload: { wave },
        recordCompletion: finalWave,
      })
      if (!ok) {
        combatRef.current = combat
        setCombat({ ...combat })
      } else {
        setActiveTask(null)
      }
      setSunspireClaimBusy(false)
    }
    return (
      <div class="forge-shell h-full flex flex-col p-4">
        <BackLink onClick={stopAndBack} className="mb-3" />
        <div class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden no-scrollbar">
          <SunspireDecisionPanel
            wave={wave}
            totalWaves={totalWaves}
            modifierState={combat.raid.modifierState || {}}
            offers={combat.raid.modifierOffers || []}
            finalWave={finalWave}
            deferredRewards
            canChoose
            busy={sunspireClaimBusy}
            onChoose={continueSunspire}
            onContinue={() => continueSunspire()}
            onClaim={claimSunspire}
          />
        </div>
      </div>
    )
  }

  // ── Boss adds (e.g. the Dread Core, Zaryth's sentinels) ──
  // Live enemies, not a phase: they attack alongside the boss until killed, so
  // the player needs a way to swing at each and to see the one they are on.
  // A boss may field several — the picker grows a slot each, but only ONE HP bar
  // is drawn (a stack of four would push the fight itself off a phone screen),
  // and it follows the enemy the player is actually hitting.
  const addsOnField = liveAdds(combat)
  const liveCombatTarget = combatStageTarget(combat) || combat.monster
  const onBoss = liveCombatTarget === combat.monster
  const activeAdd = onBoss ? (addsOnField[0] || null) : liveCombatTarget
  const switchTarget = (which) => {
    if (!combatRef.current) return
    const next = setCombatTarget(combatRef.current, which)
    combatRef.current = next
    setCombat(next)
  }
  const addPanel = activeAdd && (
    <div class="cb-qa" style={{ marginBottom: 12 }}>
      <div class="cb-hplabel">
        <span class="flex items-center gap-1.5">
          <SkillEmblem iconKey={getMonsterArt(activeAdd).icon} accent={getMonsterArt(activeAdd).accent} size={16} glow={0} />
          {activeAdd.name}
        </span>
        <span class="cb-hplabel__v">{Math.max(0, Math.round(activeAdd.currentHP))}/{activeAdd.hitpoints}</span>
      </div>
      <div class="relative mb-2">
        <HPBar current={Math.max(0, activeAdd.currentHP)} max={activeAdd.hitpoints} size="large" />
        <HitSplatLayer splats={addSplats} />
      </div>
      {/* Target choices can collapse independently of the active enemy HP bar,
          keeping multi-enemy fights compact without hiding what is being hit. */}
      <button
        type="button"
        class="mb-1.5 flex w-full items-center justify-between rounded-lg border border-[var(--color-void-border)] px-2.5 py-1.5 text-left text-[10px] text-[var(--color-parchment)]"
        onClick={() => setTargetsExpanded((value) => !value)}
        aria-expanded={targetsExpanded}
      >
        <span><span class="opacity-55">Targets</span> · {onBoss ? combat.monster.name : activeAdd?.name}</span>
        <CollapseChevron expanded={targetsExpanded} size={11} />
      </button>
      {targetsExpanded && (
        <div class="cb-qa__grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))' }}>
          {combat.monster.currentHP > 0 && (
            <button class={'cb-slot' + (onBoss ? ' is-active' : '')} onClick={() => switchTarget('boss')}>
              <span class="cb-slot__name">{combat.monster.name}</span>
              <span class="cb-slot__tag">{onBoss ? 'Attacking' : 'Attack'}</span>
              {onBoss && <span class="cb-slot__ring" />}
            </button>
          )}
          {combat.adds.map((add, index) => {
            if (!add || add.currentHP <= 0) return null
            const on = add === activeAdd && !onBoss
            return (
              <button key={add.instanceId} class={'cb-slot' + (on ? ' is-active' : '')} onClick={() => switchTarget(index)}>
                <span class="cb-slot__name">{add.name}</span>
                <span class="cb-slot__tag">{on ? 'Attacking' : `${Math.max(0, Math.round(add.currentHP))} HP`}</span>
                {on && <span class="cb-slot__ring" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )

  // ── Sprite stage ──
  // Both sides are rebuilt every render because both can change mid-fight: a
  // weapon swap changes the player's tool AND its speed, and a multi-form boss
  // changes style per form. Timing comes from actionSprites, never from here.
  const spriteMonster = combatStageTarget(combat, stageDeathTarget) || combat.monster
  const stageShowingAdd = stageDeathTarget ? stageDeathTarget.wasAdd : spriteMonster !== combat.monster
  const spriteMonsterArt = getMonsterArt(spriteMonster, getMonsterCategoryKey(spriteMonster.id))
  // Stance is part of the cadence: combat.js shortens a ranged swing by a tick
  // on Rapid, so leaving it out animated the speed stance at Accurate's pace.
  // combatType, not the weapon's own style: a staff with no spell selected
  // fights melee, and Rapid takes a tick off a ranged swing.
  const playerSprite = playerCombatSprite(equipment, itemsData, { combatType: combat.combatType, stance: combat.stance })
  const monsterSprite = monsterCombatSprite(spriteMonster)
  // Whichever splat stream belongs to what's actually shown — an add has its
  // own HP bar and its own splats (addSplats), so a targeted add must not
  // borrow the boss's monsterSplats or a hit on the add would flash on a
  // figure representing something else entirely.
  const stageTargetSplats = stageShowingAdd ? addSplats : monsterSplats
  const prayerCue = nextProtectionPrayerThreat({
    primary: combat.monster,
    primaryAttackTimer: combat.monsterAttackTimer,
    adds: combat.adds,
    staggered: combat.raid?.raidId === 'sunspire_colosseum',
  })
  const cuePrayer = prayerCue ? protectionPrayerForAttackStyle(prayerCue.style, prayersData) : null
  const cueStyleArt = prayerCue ? getStyleArt(prayerCue.style) : null
  const cueThreat = cuePrayer && cueStyleArt
    ? { skill: prayerSkill(cuePrayer), color: cueStyleArt.color, label: cuePrayer.name }
    : null
  // Null on the classic screen: every readout the stage absorbed (both HP
  // bars, the prayer pool) is rendered as its own bar below instead.
  const spriteStage = !combatAnimations ? null : (
    <InkwrightCombatStage
      actor={{ ...playerSprite, accent: getStyleArt(playerSprite.motion).color }}
      target={{
        icon: spriteMonsterArt.icon,
        accent: spriteMonsterArt.accent,
        sprite: monsterSprite,
        // The live combat copy, not the monsters.json row: a targeted add is
        // its own creature and must be drawn as one, and a multi-form boss
        // carries its current form here.
        monster: spriteMonster,
        dying: !!stageDeathTarget || spriteMonster.currentHP <= 0,
      }}
      actorSwing={swings.player}
      actorConsume={actorConsume}
      targetSwing={swings.monster}
      actorHp={{ current: currentHP, max: getCombatMaxHP(combat) }}
      targetHp={{ current: spriteMonster.currentHP, max: spriteMonster.hitpoints }}
      actorSplats={playerSplats}
      targetSplats={stageTargetSplats}
      resetKey={fightSeqRef.current}
      showCorners={!isDesktopCombatLayout}
      actorPrayer={typeof combat?.maxPrayerPoints === 'number' ? { current: combat.prayerPoints, max: combat.maxPrayerPoints } : null}
      actorThreat={cueThreat}
      label={`You versus ${spriteMonster.name}`}
    />
  )

  return (
    <div class={`forge-shell h-full flex flex-col p-4 ${isDesktopCombatLayout ? 'overflow-hidden' : ''}`}>
      {/* Back button — on mobile the raid track rides this same row instead of
          costing its own full-width block above the fight header. */}
      <div class="flex items-center gap-2 mb-3">
        <BackLink onClick={stopAndBack} />
        {!isDesktopCombatLayout && combat.raid && (
          <div class="flex-1 min-w-0 flex items-center gap-1.5">
            <span class="text-[9px] font-[var(--font-mono)] text-[var(--color-parchment)] opacity-50 flex-shrink-0">
              {Array.isArray(combat.raid.waves)
                ? `Wave ${combat.raid.currentWaveIndex + 1}/${combat.raid.waves.length}`
                : `Boss ${combat.raid.currentBossIndex + 1}/${combat.raid.bosses.length}`}
            </span>
            <div class="flex-1 flex gap-0.5 min-w-0">
              {(combat.raid.waves || combat.raid.bosses).map((entry, i) => {
                const bossId = typeof entry === 'string' ? entry : entry.primary
                const currentIndex = Array.isArray(combat.raid.waves) ? combat.raid.currentWaveIndex : combat.raid.currentBossIndex
                return (
                <div
                  key={bossId}
                  class={`flex-1 h-1 rounded-full ${
                    i < currentIndex ? 'bg-[var(--color-hp-green)]' :
                    i === currentIndex ? 'bg-[var(--color-gold)]' :
                    'bg-[var(--color-void-border)]'
                  }`}
                  title={monstersData[bossId]?.name || bossId}
                />
                )
              })}
            </div>
          </div>
        )}
      </div>

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

      {spriteStage}

      {/* Monster identity — with the stage on, the HP bar itself is above the
          character there rather than duplicated here. */}
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
            <span class="text-[10px] font-[var(--font-mono)] text-[var(--color-blood-light)]">CB {combat.monster.combatLevel}</span>
          </span>
        </div>
        {!combatAnimations && (
          <div class="relative">
            <HPBar current={Math.max(0, combat.monster.currentHP)} max={combat.monster.hitpoints} size="large" />
            <HitSplatLayer splats={monsterSplats} />
          </div>
        )}
      </div>

      {addPanel}

      {/* Raid progress indicator */}
      {combat.raid && (
        <div class="mb-2 bg-[var(--color-void)] border border-[var(--color-void-border)] rounded-lg px-3 py-2">
          <div class="flex items-center justify-between mb-1.5">
            <span class="text-[10px] font-semibold text-[var(--color-gold)]">{raidsData[combat.raid.raidId]?.icon} {raidsData[combat.raid.raidId]?.name || 'Raid'}</span>
            <span class="text-[10px] font-[var(--font-mono)] text-[var(--color-parchment)] opacity-60">
              {Array.isArray(combat.raid.waves)
                ? `Wave ${combat.raid.currentWaveIndex + 1}/${combat.raid.waves.length}`
                : `Boss ${combat.raid.currentBossIndex + 1}/${combat.raid.bosses.length}`}
            </span>
          </div>
          <div class="flex gap-1">
            {(combat.raid.waves || combat.raid.bosses).map((entry, i) => {
              const bossId = typeof entry === 'string' ? entry : entry.primary
              const currentIndex = Array.isArray(combat.raid.waves) ? combat.raid.currentWaveIndex : combat.raid.currentBossIndex
              return (
                <div
                  key={(entry.id || bossId) + ':' + i}
                  class={`flex-1 h-1.5 rounded-full ${
                    i < currentIndex ? 'bg-[var(--color-hp-green)]' :
                    i === currentIndex ? 'bg-[var(--color-gold)]' :
                    'bg-[var(--color-void-border)]'
                  }`}
                  title={monstersData[bossId]?.name || bossId}
                />
              )
            })}
          </div>
        </div>
      )}

      {/* Your HP — with the stage on, the bar itself rides above your own
          character there and only the potion badges need a home. */}
      <div class="mb-2">
        <div class="flex items-center justify-between mb-0.5">
          <div class="text-[10px] text-[var(--color-parchment)] opacity-50">Your HP</div>
          <ActivePotionBadges activePotions={combat?.activePotions} itemsData={itemsData} />
        </div>
        {!combatAnimations && (
          <div class="relative">
            <HPBar current={currentHP} max={getCombatMaxHP(combat)} size="large" />
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
        <div class="mb-2 bg-[var(--surface-raised)] border border-[var(--color-gold-dim)] rounded-lg px-3 py-1.5 flex items-center justify-between">
          <span class="text-[10px] text-yellow-400 font-semibold">💀 Slayer Task</span>
          <span class="text-[10px] font-[var(--font-mono)] text-yellow-400">
            {slayerTask.monstersRemaining} / {slayerTask.totalCount} remaining
          </span>
        </div>
      )}

      {/* Inline gear paperdoll — desktop only. Click an equipped slot to
          unequip directly into inventory (only works if there's space).
          Mobile keeps the ⚙️ Gear button + modal flow. */}
      <div class={`${isDesktopCombatLayout ? 'flex' : 'hidden'} flex-col flex-1 min-h-0 mt-2`}>
        <div class="grid grid-cols-2 gap-2 mb-1.5 flex-shrink-0">
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
                  class={`py-2 rounded-lg font-semibold text-sm transition-opacity ${canSpec ? 'active:opacity-80' : 'opacity-40 cursor-default'}`}
                  style={canSpec ? 'background:linear-gradient(135deg,#3a2a00,#6a4a00);border:1px solid rgba(234,179,8,0.5);color:#fde047' : 'background:#1a1a1a;border:1px solid #2a2a2a;color:#888'}
                >
                  ⚡ {hasSpec ? 'Spec' : 'No Spec'}
                </button>
                <button
                  onClick={() => isMagic && setShowSpellModal(true)}
                  disabled={!isMagic}
                  class={`py-2 rounded-lg font-semibold text-sm transition-opacity ${isMagic ? 'active:opacity-80' : 'opacity-40 cursor-default'}`}
                  style={isMagic ? 'background:linear-gradient(135deg,#1a2a3a,#2a3a5a);border:1px solid rgba(100,150,200,0.35);color:#a8d8ff' : 'background:#1a1a1a;border:1px solid #2a2a2a;color:#888'}
                >
                  🔮 Cast Spell
                </button>
              </>
            )
          })()}
        </div>
        <div class="text-[10px] uppercase tracking-wider text-[var(--color-gold-dim)] opacity-60 mb-1 px-1 flex-shrink-0">Gear</div>
        <div class="flex-1 min-h-0 overflow-y-auto bg-[var(--color-void-light)] border border-[var(--color-void-border)] rounded-xl p-2 flex items-center justify-center">
          <EquipmentPaperdoll
            equipment={equipment}
            itemsData={itemsData}
            onSelect={(slotName) => handleUnequipSlot(slotName)}
            size="fluidFixed"
            asCard={false}
          />
        </div>
      </div>

      </div>{/* /LEFT pane */}

      {/* INVENTORY pane (DOM 2nd, visually MIDDLE at md+): full inventory grid.
          Click an equippable item to equip it instantly (no confirm). Clicks on
          non-equippable items are ignored to keep mid-fight UX safe. Hidden on
          mobile so the existing modal-driven flow is preserved there. */}
      <div class={`${isDesktopCombatLayout ? 'flex' : 'hidden'} flex-col ${isDesktopCombatLayout ? 'col-start-2 row-start-1 overflow-y-auto min-h-0' : ''}`}>

      <div class="flex items-center justify-between mb-0.5 px-1 flex-shrink-0">
        <div class="text-[10px] uppercase tracking-wider text-[var(--color-gold-dim)] opacity-60">Inventory</div>
        <span class="text-[10px] font-[var(--font-mono)] text-[var(--color-parchment)] opacity-40">
          {freeSlots(inventory)}/28 free
        </span>
      </div>

      <div class="flex-shrink-0">
      <InventoryGrid
        inventory={inventory}
        size="normal"
        gridClass="grid grid-cols-7 gap-1 justify-items-center"
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
      </div>

      {/* Inline prayer toggles — desktop only. Mirrors the prayer modal's
          activeProtectionPrayer / activeCombatPrayer toggles, but inline so
          mobile keeps the 🙏 Prayer button + modal flow. */}
      <div class="flex flex-col flex-1 min-h-0 mt-1.5">
        <div class="flex items-start justify-between gap-2 mb-1 px-1 flex-shrink-0">
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
            <div class="flex-1 min-h-0 overflow-y-auto bg-[var(--color-void-light)] border border-[var(--color-void-border)] rounded-xl p-1.5 flex flex-col justify-center gap-[clamp(4px,2vh,20px)]">
              <div>
                <div class="text-[9px] uppercase tracking-wider text-[var(--color-gold-dim)] opacity-50 mb-1 px-0.5">Protection</div>
                <div class="grid grid-cols-3 gap-[clamp(3px,1.2vh,12px)]">
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
                        class={`h-[clamp(36px,6.5vh,84px)] flex flex-col items-center justify-center gap-1 rounded-md border text-center transition-colors ${
                          isActive
                            ? 'cb-prayon'
                            : canUse
                              ? 'bg-[var(--surface-raised)] border-[var(--color-emerald)] active:bg-[var(--surface-panel)]'
                              : 'bg-[var(--color-void)] border-[var(--color-void-light)] opacity-30 cursor-default'
                        }`}
                      >
                        <SkillIcon skill={prayerSkill(prayer)} size={20} />
                        <div class={`text-[9px] opacity-70 ${isActive ? 'text-[#1a1206]' : 'text-[var(--color-parchment)]'}`}>{protectType}</div>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div class="border-t border-[var(--color-void-border)]" />

              <div>
                <div class="text-[9px] uppercase tracking-wider text-[var(--color-gold-dim)] opacity-50 mb-1 px-0.5">Enhance</div>
                <div class="grid grid-cols-6 gap-[clamp(3px,0.8vh,8px)]">
                  {combatPrayers.map(prayer => {
                    const canUse = prayerLevel >= prayer.level
                    const isActive = combat?.activeCombatPrayer === prayer.id
                    return (
                      <button
                        key={prayer.id}
                        onClick={() => canUse && handlePrayer(prayer.id)}
                        disabled={!canUse}
                        title={`${prayer.name} · Lv ${prayer.level}\n${prayer.description}`}
                        class={`h-[clamp(28px,4.5vh,60px)] flex flex-col items-center justify-center gap-0.5 rounded-md border text-center transition-colors ${
                          isActive
                            ? 'cb-prayon'
                            : canUse
                              ? 'bg-[var(--surface-raised)] border-[var(--color-emerald)] active:bg-[var(--surface-panel)]'
                              : 'bg-[var(--color-void)] border-[var(--color-void-light)] opacity-30 cursor-default'
                        }`}
                      >
                        <SkillIcon skill={prayerSkill(prayer)} size={16} />
                        <div class={`text-[8px] opacity-70 ${isActive ? 'text-[#1a1206]' : 'text-[var(--color-gold-dim)]'}`}>Lv {prayer.level}</div>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
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
        const shown = Math.floor(energy)
        return (
          <div class="mb-2 bg-[var(--color-void)] rounded-lg px-3 py-2">
            <div class="flex items-center justify-between mb-1">
              <span class="text-[10px] text-yellow-400 font-semibold">⚡ Special Attack</span>
              <span class="text-[10px] font-[var(--font-mono)] text-yellow-400">{shown}%</span>
            </div>
            <div class="h-2 rounded-full bg-[var(--color-void-light)] overflow-hidden">
              <div
                class="h-full rounded-full transition-all duration-300"
                style={{ width: `${shown}%`, background: canSpec ? '#eab308' : '#78530a' }}
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
            <button onClick={handleEat} class="fm-btn fm-btn--sm">
              🍖 Eat
            </button>
          )
          const potionBtn = (
            <button onClick={() => setShowPotionModal(true)} class="fm-btn fm-btn--sm">
              🧪 Potion
            </button>
          )
          const gearBtn = (
            <button onClick={() => setShowEquipmentModal(true)} class="fm-btn fm-btn--sm">
              ⚙️ Gear
            </button>
          )
          const specBtn = (
            <button
              onClick={canSpec ? handleSpecialAttack : undefined}
              disabled={!canSpec}
              class={`fm-btn fm-btn--sm ${canSpec ? 'fm-btn--ember' : ''}`}
            >
              ⚡ {hasSpec ? `Spec` : 'No Spec'}
            </button>
          )
          const castBtn = (
            <button
              onClick={() => isMagic && setShowSpellModal(true)}
              disabled={!isMagic}
              class={`fm-btn fm-btn--sm ${isMagic ? 'fm-btn--woad' : ''}`}
            >
              🔮 Cast Spell
            </button>
          )
          const prayerBtn = (
            <button onClick={() => setShowPrayerModal(true)} class="fm-btn fm-btn--sm">
              🙏 Prayer
            </button>
          )
          const summonActive = !!combat?.summon
          const ownsPouch = SUMMONING_CREATURES.some(c => countItem(inventory, c.pouch) > 0)
          const summonSecs = summonActive ? Math.ceil((combat.summon.ticksLeft || 0) * 0.6) : 0
          const summonBtn = (ownsPouch || summonActive) ? (
            <button onClick={summonActive ? undefined : () => setShowSummonModal(true)} disabled={summonActive}
              class={`fm-btn fm-btn--sm ${summonActive ? '' : 'fm-btn--woad'}`}>
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
              <CombatFightHead
                icon={mArt.icon}
                accent={mArt.accent}
                name={m.name}
                nameColor={getStyleArt(form ? form.attackStyle : m.attackStyle).color}
                combatLevel={m.combatLevel}
                onInfo={() => setSelectedMonsterInfo(m)}
                aside={m.hardModeActive && <HardModeTag />}
              />

              {spriteStage}

              {/* The stage carries both HP bars above their own figure, so it
                  leaves only the potion badges to place; the classic screen
                  has no stage and needs the bars themselves back. */}
              {combatAnimations ? (
                <div class="mb-2 flex justify-end">
                  <ActivePotionBadges activePotions={combat?.activePotions} itemsData={itemsData} />
                </div>
              ) : (
                <>
                  <CombatHPBlock
                    label="Enemy Hitpoints"
                    current={m.currentHP}
                    max={m.hitpoints}
                    splats={monsterSplats}
                  />
                  <CombatHPBlock
                    label="Your Hitpoints"
                    current={currentHP}
                    max={getCombatMaxHP(combat)}
                    splats={playerSplats}
                    valueColor="#7ce88a"
                    right={<ActivePotionBadges activePotions={combat?.activePotions} itemsData={itemsData} />}
                  />
                </>
              )}

              {addPanel}

              {/* Prayer pool reads from the stage's top-left corner
                  (showCorners/actorPrayer above) unless the stage is off. */}
              {!combatAnimations && typeof combat?.maxPrayerPoints === 'number' && (
                <CombatPrayerBlock current={combat.prayerPoints} max={combat.maxPrayerPoints} threat={cueThreat} />
              )}

              {/* Slayer task indicator */}
              {doesSlayerTaskMatchMonster(slayerTask?.monsterId, m.id) && (
                <div class="mb-2 bg-[var(--surface-raised)] border border-[var(--color-gold-dim)] rounded-lg px-3 py-1.5 flex items-center justify-between">
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
                  quickPrayers={quickPrayers}
                  prayersData={prayersData}
                  prayerLevel={getLevelFromXP(stats.prayer?.xp || 0)}
                  onPrayer={handlePrayer}
                  onEditPrayers={() => setShowQuickPrayerConfig(true)}
                  isPrayerActive={(prayerId) => combat?.activeProtectionPrayer === prayerId || combat?.activeCombatPrayer === prayerId}
                />
              )}

              {/* Action row — Special / Cast / Summon (Eat/Potion/Gear/Prayer now live in the quick-actions tabs) */}
              {combat.active && !isAutoRestarting && (() => {
                const weaponEntry = equipment?.weapon
                const weapon = weaponEntry ? itemsData[weaponEntry.itemId] : null
                const hasSpec = !!weapon?.specialAttack
                const energy = combat.specialAttackEnergy || 0
                const canSpec = hasSpec && canAffordSpecialAttack(weapon.specialAttack, energy)
                const specQueued = !!combat?.specialAttackQueued
                const isMagic = weapon?.attackStyle === 'magic'
                const summonActive = !!combat?.summon
                const ownsPouch = SUMMONING_CREATURES.some(c => countItem(inventory, c.pouch) > 0)
                const summonSecs = summonActive ? Math.ceil((combat.summon.ticksLeft || 0) * 0.6) : 0
                return (
                  <div class="cb-actions" style={{ marginTop: 12, marginBottom: 12 }}>
                    <button class={'cb-act' + (specQueued ? ' is-on' : '')} disabled={!canSpec && !specQueued} onClick={canSpec ? handleSpecialAttack : undefined}>
                      <GameIcon iconKey="lightning_arc" color="currentColor" size={18} />
                      <span>Special{hasSpec ? ` ${Math.floor(energy)}%` : ''}</span>
                    </button>
                    <button class="cb-act" disabled={!isMagic} onClick={isMagic ? () => setShowSpellModal(true) : undefined}>
                      <GameIcon iconKey="crystal_ball" color="currentColor" size={18} />
                      <span>Cast Spell</span>
                    </button>
                    <button class={'cb-act' + (summonActive ? ' is-on' : '')} disabled={summonActive || !ownsPouch} onClick={(summonActive || !ownsPouch) ? undefined : () => setShowSummonModal(true)}>
                      <GameIcon iconKey="summoning" color="currentColor" size={18} />
                      <span>{summonActive ? `Summon ${summonSecs}s` : 'Summon'}</span>
                    </button>
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
              <GameIcon iconKey="cancel" color="var(--text-soft)" size={16} />
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

      {/* Quick-prayer config modal — same prayer grid, but tapping a prayer toggles
          its membership in the quick-prayer list (persisted via updateQuickPrayers)
          rather than activating it. */}
      {showQuickPrayerConfig && (
        <QuickPrayerConfigModal
          prayerLevel={getLevelFromXP(stats.prayer?.xp || 0)}
          selected={quickPrayers}
          onChange={updateQuickPrayers}
          onClose={() => setShowQuickPrayerConfig(false)}
        />
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
                    class="w-full p-3 rounded-lg border bg-[var(--surface-raised)] border-[var(--color-emerald)] active:bg-[var(--surface-panel)] transition-colors"
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
              <GameIcon iconKey="cancel" color="var(--text-soft)" size={16} />
            </button>
          </div>
          <div class="max-h-96 overflow-y-auto">
            <SpellSelectGrid
              magicLevel={boostedMagicLevel(getLevelFromXP(stats.magic?.xp || 0), combat?.activePotions, itemsData)}
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
              <GameIcon iconKey="cancel" color="var(--text-soft)" size={16} />
            </button>
          </div>
          <div class="max-h-96 overflow-y-auto flex flex-col gap-2">
            {(() => {
              const summoningLevel = getLevelFromXP(stats.summoning?.xp || 0)
              // Only list what's actually pickable — level met and a pouch in
              // hand. A creature the player can't yet afford or unlock just
              // clutters the sheet with rows that can never be tapped.
              const available = SUMMONING_CREATURES.filter(c => summoningLevel >= c.level && countItem(inventory, c.pouch) > 0)
              if (available.length === 0) {
                return (
                  <p class="text-[11px] text-[var(--color-parchment)] opacity-50 text-center py-4">
                    No summoning pouches ready. Craft or buy one to summon a creature.
                  </p>
                )
              }
              return available.map(c => {
                const pouches = countItem(inventory, c.pouch)
                const scrolls = countItem(inventory, c.scroll)
                const canSummon = !combat?.summon
                return (
                  <button key={c.id} disabled={!canSummon} onClick={canSummon ? () => handleSummon(c.id) : undefined}
                    class={`flex items-center gap-3 p-2.5 rounded-lg text-left ${canSummon ? 'active:opacity-80' : 'opacity-45 cursor-default'}`}
                    style="background:var(--color-void);border:1px solid var(--color-void-light)">
                    <GameIcon item={itemsData[c.pouch]} size={30} />
                    <div class="flex-1 min-w-0">
                      <div class="text-[13px] font-bold text-[var(--color-parchment)]">{c.name}</div>
                      <div class="text-[10px] text-[var(--color-parchment)] opacity-55">
                        Max {c.maxHit}{c.hits > 1 ? ` ×${c.hits} hits` : ''} · {c.accuracyTier} accuracy · {c.summonXp} XP
                      </div>
                      <div class="text-[10px] text-[var(--color-parchment)] opacity-40">
                        {pouches} pouch{pouches === 1 ? '' : 'es'} · {scrolls} scroll{scrolls === 1 ? '' : 's'}
                      </div>
                    </div>
                    <span class="text-[11px] text-[var(--color-gold)] font-bold">Summon</span>
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
                            ? 'bg-[var(--surface-raised)] border-[var(--color-emerald-light)]'
                            : 'bg-[var(--surface-raised)] border-[var(--color-emerald)] active:bg-[var(--surface-panel)]'
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

      {/* Loot Modal — raid completion only (§6); a standalone boss kill uses
          the reward-reveal card below like any other monster. */}
      {lootModal && (() => {
        const drops = !lootModal.loading && lootModal.loot ? lootModal.loot : []
        const { hero, heroItem: heroItemData, rest, total: lootTotal } = shapeLootForModal(drops, itemsData)

        return (
          <LootResultModal
            theme={!lootModal.loading && hasEpicLootDrop(lootModal.loot, itemsData) ? 'purple' : 'gold'}
            kind="loot"
            eyebrow={lootModal.cashOutWave ? `Cashed Out · Wave ${lootModal.cashOutWave}` : 'Raid Complete'}
            title={raidsData[lootModal.raidId]?.name || 'Raid'}
            heroItem={!lootModal.loading && heroItemData ? heroItemData : null}
            heroName={!lootModal.loading && hero ? (heroItemData?.name || hero.itemId) : null}
            heroQuantity={!lootModal.loading && hero ? hero.quantity : null}
            heroGp={!lootModal.loading && hero ? hero.totalGp : 0}
            heroUnitGp={!lootModal.loading && hero ? hero.unitGp : 0}
            skipLabel={!lootModal.loading && lootModal.raidId !== 'sunspire_colosseum' && getToken() && getCharacterId()
              ? `Skip raid (${hardModeSkipCost(raidsData[lootModal.raidId]?.skipCost ?? 1, isHardMode('raids', lootModal.raidId))})`
              : null}
            onSkip={lootModal.raidId !== 'sunspire_colosseum' ? skipAgain : undefined}
            loot={!lootModal.loading && rest.length > 0 ? lootRowsForModal(rest, itemsData) : null}
            lootTitle="Loot Secured"
            lootTotal={lootTotal}
            primaryAction={!lootModal.loading ? {
              label: 'Raid Again',
              onClick: () => {
                const raid = raidsData[lootModal.raidId]
                if (raid) startRaid(raid)
                setLootModal(null)
              },
            } : null}
            secondaryAction={!lootModal.loading ? {
              label: 'Leave',
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
          // A hard-mode death is the one death that costs items, so the screen
          // has to name what went with it rather than leave the player to work
          // out why their pack is empty.
          sub={deathModal.itemsLost?.length > 0
            ? 'Hard Mode — everything tradeable you carried and wore is gone. Untradeables stayed with you. Reclaim it from Grim Reaper in Settings.'
            : (deathModal.itemsLost ? 'Hard Mode — everything tradeable you carried and wore is gone. Untradeables stayed with you.' : undefined)}
          loot={deathModal.itemsLost?.length > 0 ? lootRowsForModal(shapeLootForModal(deathModal.itemsLost, itemsData).valued, itemsData) : undefined}
          lootTitle={deathModal.itemsLost?.length > 0 ? 'Lost Forever' : undefined}
          lootSigned="-"
          primaryAction={{
            label: 'Continue',
            onClick: () => setDeathModal(null),
          }}
          onClose={() => setDeathModal(null)}
        />
      )}

      {/* Monster Info Modal — in-fight only (this Modal only ever renders once
          combat exists, guarded by the earlier `if (!combat) return` above), so
          it reads combat.monster directly rather than the tap-time snapshot
          selectedMonsterInfo held before: combat.monster is the SAME object a
          special attack mutates in place, and re-reading it here on every
          render is what makes a Dragon Warhammer smash or a Grondar Godsword
          warstrike show up live instead of frozen at the moment "i" was tapped.
          selectedMonsterInfo now only gates whether the modal is open. */}
      {selectedMonsterInfo && (() => {
        const liveMonster = combat.monster
        return (
        <Modal onClose={() => setSelectedMonsterInfo(null)}>
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-[var(--font-display)] text-base font-bold text-[var(--color-gold)] flex items-center gap-2">
              <SkillEmblem iconKey={getMonsterArt(liveMonster).icon} accent={getMonsterArt(liveMonster).accent} size={28} glow={0} /> {liveMonster.name}
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
              <MultiStyleChip chip={getMonsterAttackStyles(liveMonster)} prefix="Uses " />
              <MultiStyleChip chip={getMonsterWeakness(liveMonster)} prefix="Weak: " kind="!" />
            </div>
            {getMonsterLocationLabel(liveMonster) && (
              <div class="text-[11px] text-[var(--color-parchment)] opacity-60">📍 {getMonsterLocationLabel(liveMonster)}</div>
            )}
            {/* Combat Stats */}
            <div>
              <h4 class="text-xs font-semibold text-[var(--color-gold-dim)] uppercase tracking-wider mb-2 opacity-70">Combat Stats</h4>
              <div class="bg-[var(--color-void)] rounded-lg p-3 space-y-1">
                <div class="flex justify-between text-[11px] text-[var(--color-parchment)]">
                  <span>Combat Level</span>
                  <span class="font-[var(--font-mono)] text-[var(--color-gold)]">{liveMonster.combatLevel}</span>
                </div>
                <div class="flex justify-between text-[11px] text-[var(--color-parchment)]">
                  <span>HP</span>
                  <span class="font-[var(--font-mono)] text-[var(--color-hp-green)]">{liveMonster.hitpoints}</span>
                </div>
                <div class="flex justify-between text-[11px] text-[var(--color-parchment)]">
                  <span>Attack</span>
                  <span class="font-[var(--font-mono)]">{liveMonster.stats.attack}</span>
                </div>
                <div class="flex justify-between text-[11px] text-[var(--color-parchment)]">
                  <span>Strength</span>
                  <span class="font-[var(--font-mono)]">{liveMonster.stats.strength}</span>
                </div>
                <div class="flex justify-between text-[11px] text-[var(--color-parchment)]">
                  <span>Defence</span>
                  <span class="font-[var(--font-mono)]"><WasIs info={getDefenceLevelInfo(liveMonster)} /></span>
                </div>
                <div class="flex justify-between text-[11px] text-[var(--color-parchment)]">
                  <span>Magic</span>
                  <span class="font-[var(--font-mono)]">{liveMonster.stats.magic}</span>
                </div>
                <div class="flex justify-between text-[11px] text-[var(--color-parchment)]">
                  <span>Ranged</span>
                  <span class="font-[var(--font-mono)]">{liveMonster.stats.ranged}</span>
                </div>
              </div>
            </div>

            {/* Defence Bonuses */}
            <div>
              <h4 class="text-xs font-semibold text-[var(--color-gold-dim)] uppercase tracking-wider mb-2 opacity-70">Defence Bonuses</h4>
              <div class="bg-[var(--color-void)] rounded-lg p-3 space-y-1">
                {DEFENCE_STYLES.map(style => {
                  const info = getDefenceBonusInfo(liveMonster, style)
                  return (
                    <div key={style} class="flex justify-between text-[11px] text-[var(--color-parchment)]">
                      <span class="capitalize">{style}</span>
                      <span class={`font-[var(--font-mono)] ${info.current >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        <WasIs info={info} format={(n) => `${n >= 0 ? '+' : ''}${n}`} />
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>

            <MonsterPhaseStats monster={liveMonster} />
            <MonsterAddStats monster={liveMonster} />

            <MonsterDropList monster={liveMonster} itemsData={itemsData} grindman={isGrindman} />
          </div>
        </Modal>
        )
      })()}
    </div>
  )
}
