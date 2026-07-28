import monstersData from '../data/monsters.json'
import raidsData from '../data/raids.json'
import { DAGANNOTH_KINGS_TASK_ID } from './slayerTasks.js'
import { questRequirementMet } from './questGates.js'

// Zul-Kaar's boss-task pool includes every boss monster EXCEPT these 4, which
// are raid-final-bosses only reachable via a full raid clear (never independently
// fightable) — they're represented as raid-completion proxy entries instead
// (see SLAYER_MASTERS below). flatSlayerXp is the flat Slayer XP per raid
// completion (used by getSlayerTaskXpForKill's options.flatXp), replacing the
// normal HP-based Slayer XP formula since these "kills" are whole-raid clears.
export const RAID_TASK_META = {
  the_great_olm: { raidId: 'vaults_of_xyren', flatSlayerXp: 10000 },
  verzik_vitur: { raidId: 'crimson_night_theatre', flatSlayerXp: 10000 },
  verin_the_defiled: { raidId: 'cryptbound_champions', flatSlayerXp: 2500 },
  warden_of_arasmus: { raidId: 'tomb_of_arasmus', flatSlayerXp: 10000 },
}

// Every monster that makes up any raid — sub-bosses (e.g. Gorath the Infested)
// as well as each raid's final boss — derived structurally from raids.json so
// a new raid or roster change can't silently desync this. None of these may
// be individually assignable as a standalone kill task: only a full raid
// clear (RAID_TASK_META's proxy entries, keyed to the final boss id) counts.
const RAID_MONSTER_IDS = new Set(
  Object.values(raidsData).flatMap(raid => Array.isArray(raid?.bosses) ? raid.bosses : [])
)

// PocketRPG slayer masters — requirements and monster pools from PocketRPG design references.
//
// Each master lives at a world place (`placeId` — must exist in world.json;
// `location` is its display name). Getting a task from a master is a place
// action: the world map / place hubs list masters via worldContent's `slayer`
// activity kind, and the Slayer screen gates assignment on being there.
//
// Monster pools are distributed across masters by combat level so that every
// assignable monster (excluding boss and raid monsters) appears on at least one
// master, with deliberate overlap between adjacent tiers. Selection within a
// pool is even (see pickSlayerMonster) so masters no longer repeat the same task.
export const SLAYER_MASTERS = [
  {
    id: 'turael',
    name: 'Torvak',
    location: 'Lumbright',
    placeId: 'lumbright',
    icon: '👴',
    iconKey: 'hood',
    combatReq: 0,
    slayerReq: 0,
    pointsPerTask: 0,
    description: 'Assigns the easiest slayer tasks. No requirements.',
    taskRange: [50, 120],
    // Combat level ~1-30
    monsterPool: [
      'field_chicken', 'dustpaw_rat', 'cave_goblin', 'pasture_bull', 'arcane_adept',
      'bogling_sprite', 'stoneback_crab', 'duneback_crab', 'umbral_adept',
      'wailing_banshee', 'frostbite_imp', 'broodfang_spider', 'highland_giant',
      'marshfen_toad',
    ],
  },
  {
    id: 'mazchna',
    name: 'Morven',
    location: 'Canifel',
    placeId: 'canifel',
    icon: '🧙',
    iconKey: 'pointy_hat',
    combatReq: 20,
    slayerReq: 0,
    pointsPerTask: 2,
    description: 'Assigns medium-low level monsters. Requires combat 20.',
    taskRange: [60, 130],
    // Combat level ~20-62
    monsterPool: [
      'umbral_adept', 'wailing_banshee', 'frostbite_imp', 'broodfang_spider',
      'highland_giant', 'marshfen_toad', 'cinderpaw_cub', 'briar_giant',
      'glaive_skeleton', 'mirebound_husk', 'verdant_stalker', 'stoneglare_basilisk',
      'elder_tree_spirit', 'elder_rock_golem',
    ],
  },
  {
    id: 'vannaka',
    name: 'Valdrin',
    location: 'Edgevale',
    placeId: 'edgevale',
    icon: '⚔️',
    iconKey: 'wizard_staff',
    combatReq: 40,
    slayerReq: 0,
    pointsPerTask: 4,
    description: 'Assigns mid-level combat tasks. Requires combat 40.',
    taskRange: [70, 160],
    // Combat level ~42-99
    monsterPool: [
      'briar_giant', 'glaive_skeleton', 'mirebound_husk', 'verdant_stalker',
      'stoneglare_basilisk', 'embertongue_lizard', 'hollow_reaver', 'green_dragon',
      'lesser_fiend', 'ember_giant', 'briarheart_treant', 'frostmaw_direwolf', 'pyreclaw_demon',
      'wraithgale_specter', 'bloodmoon_stalker', 'ash_wyrm',
      'elder_tree_spirit', 'elder_rock_golem',
    ],
  },
  {
    id: 'chaeldar',
    name: 'Caelira',
    location: 'Seerhold',
    placeId: 'seerhold',
    icon: '🧝',
    iconKey: 'crystal_ball',
    combatReq: 70,
    slayerReq: 0,
    pointsPerTask: 10,
    description: 'High-level tasks including Netherfiend Demons. Requires combat 70.',
    taskRange: [80, 300],
    // Combat level ~75-204
    monsterPool: [
      'hollow_reaver', 'sanguine_veld', 'green_dragon', 'lesser_fiend',
      'briarheart_treant', 'frostmaw_direwolf', 'pyreclaw_demon', 'wraithgale_specter',
      'bloodmoon_stalker', 'warped_spectre', 'ironfang_drake', 'shadeglass_golem',
      'tidereaper_crab', 'ash_wyrm', 'astral_ranger', 'astral_warrior',
      'runestone_gargoyle', 'bone_wyvern', 'nether_demon', 'red_dragon',
    ],
  },
  {
    id: 'nieve',
    name: 'Nyra',
    location: 'Camlann',
    placeId: 'camlann',
    icon: '🌿',
    iconKey: 'magic_swirl',
    combatReq: 0,
    slayerReq: 70,
    pointsPerTask: 12,
    description: 'Elite tasks including God Wars Dungeon bosses. Requires slayer 70.',
    taskRange: [150, 400],
    bossTaskRange: [5, 25],
    // Combat level ~99-338, slayer 70+
    monsterPool: [
      'voidweave_stalker', 'drakthul_wyrmling', 'bonelight_pyromancer',
      'cinderfang_reaver', 'ashen_marauder', 'runestone_gargoyle', 'astral_ranger',
      'nether_wraith', 'astral_mage', 'nether_demon', 'astral_warrior', 'bone_wyvern',
      'marshscale_shaman', 'red_dragon', 'cinder_devil', 'vicious_black_dragon',
      'black_dragon', 'crazy_archaeologist', 'adamant_dragon',
      { id: DAGANNOTH_KINGS_TASK_ID, boss: true },
      { id: 'deepmaw_kraken', boss: true },
      { id: 'ember_tyrant', boss: true },
      { id: 'hellbound_gorilla', boss: true },
      { id: 'sovrathar_the_ashen_sovereign', boss: true },
    ],
  },
  {
    id: 'duradel',
    name: 'Druven',
    location: 'Brimhollow',
    placeId: 'brimhollow',
    icon: '💀',
    iconKey: 'queen_crown',
    combatReq: 0,
    slayerReq: 80,
    pointsPerTask: 15,
    description: 'Assigns the hardest monster tasks. Requires slayer 80.',
    taskRange: [100, 250],
    bossTaskRange: [20, 50],
    // Combat level ~85-380, slayer 90+
    monsterPool: [
      'nether_demon', 'sanguine_veld', 'nether_wraith', 'astral_mage',
      'runestone_gargoyle', 'marshscale_shaman', 'cinder_devil', 'nightfang_beast',
      'vicious_black_dragon', 'voidweave_stalker', 'drakthul_wyrmling',
      'bonelight_pyromancer', 'cinderfang_reaver', 'ashen_marauder', 'adamant_dragon',
      'rune_dragon',
      { id: DAGANNOTH_KINGS_TASK_ID, boss: true },
      { id: 'warlord_grondar', boss: true },
      { id: 'commander_zephyra', boss: true },
      { id: 'krylth_the_defiler', boss: true },
      { id: 'skyrender_kharra', boss: true },
      { id: 'deepmaw_kraken', boss: true },
      { id: 'ember_tyrant', boss: true },
      { id: 'hellbound_gorilla', boss: true },
      { id: 'threefang_cerberus', boss: true },
      { id: 'ashen_hydra', boss: true },
      { id: 'sovrathar_the_ashen_sovereign', boss: true },
    ],
  },
  {
    id: 'zul_kaar',
    name: 'Zul-Kaar',
    location: 'Varrick',
    placeId: 'varrick',
    icon: '🗿',
    iconKey: 'zul_kaar',
    combatReq: 0,
    slayerReq: 85,
    pointsPerTask: 25,
    description: 'Assigns only full boss kills or raid clears — the realm\'s ultimate Slayer trial. Requires slayer 85.',
    bossTaskRange: [5, 50],
    monsterPool: [
      // Every monster with boss:true in monsters.json except raid monsters
      // (RAID_MONSTER_IDS — both sub-bosses and final bosses): none of them are
      // individually assignable, only a full raid clear is.
      //
      // Also excluded: bosses gated on kill counts of OTHER bosses
      // (`killCountRequirement`). Eligibility here is checked against slayer
      // level and quests only, so assigning one would hand out a task the
      // combat screen and the server both refuse to start — a dead end the
      // player can only pay to skip.
      ...Object.keys(monstersData)
        .filter(id => monstersData[id]?.boss === true && !RAID_MONSTER_IDS.has(id) && !monstersData[id]?.killCountRequirement)
        .map(id => ({ id, boss: true })),
      // Raid-completion proxy entries: each is the raid's final boss, overridden
      // to a [2,10] task range instead of the master's [5,50] bossTaskRange.
      ...Object.keys(RAID_TASK_META).map(id => ({ id, boss: true, taskRange: [2, 10] })),
    ],
  },
]

// Monsters whose task is always a single kill, regardless of the master's
// bossTaskRange — these are singular, high-effort world bosses rather than a
// grindable pool.
const SINGLE_KILL_MONSTER_IDS = new Set(['ember_tyrant', 'ashen_crucible'])

// Build a slayer task object for an assigned monster. Shared by the game client
// and the MCP assignment intent so the two paths can't drift: SINGLE_KILL_MONSTER_IDS
// are always a single kill; RAID_TASK_META entries display the raid's own name
// (not its final boss's); bosses use the master's bossTaskRange (default
// [20,50]); everything else rolls within the master's taskRange. `options.rng`
// overrides Math.random for deterministic assignment.
export function buildSlayerTask(master, monsterId, isBoss, options = {}) {
  const rng = options.rng || Math.random
  const quantityMultiplier = (Number(options.quantityMultiplier) > 0) ? Number(options.quantityMultiplier) : 1
  const monsterData = monstersData[monsterId]
  const raidMeta = RAID_TASK_META[monsterId]
  const monsterName = monsterId === DAGANNOTH_KINGS_TASK_ID
    ? 'Nagadoth Kings'
    : raidMeta
      ? (raidsData[raidMeta.raidId]?.name || monsterId.replace(/_/g, ' '))
      : (monsterData?.name || monsterId.replace(/_/g, ' '))

  let totalCount
  if (SINGLE_KILL_MONSTER_IDS.has(monsterId)) {
    totalCount = 1
  } else {
    const taskRange = options.entry?.taskRange || (isBoss ? (master.bossTaskRange || [20, 50]) : master.taskRange)
    totalCount = Math.floor(rng() * (taskRange[1] - taskRange[0] + 1)) + taskRange[0]
    totalCount = Math.floor(totalCount * quantityMultiplier)
  }

  return {
    monsterId,
    monsterName,
    monstersRemaining: totalCount,
    totalCount,
    masterId: master.id,
    pointsOnComplete: master.pointsPerTask,
    isBoss,
  }
}

// Composite tasks (e.g. Nagadoth Kings) resolve to the set of monsters that count.
export function resolveTaskMonsterIds(monsterId) {
  if (monsterId === DAGANNOTH_KINGS_TASK_ID) return ['nagadoth_rex', 'nagadoth_prime', 'nagadoth_supreme']
  return [monsterId]
}

function getEntryId(entry) {
  return typeof entry === 'object' ? entry.id : entry
}

// Does the player satisfy a monster's quest gate? Quest gating is only enforced
// when a `completedQuests` collection is supplied (Set or array); when it is
// omitted the check is skipped, keeping older callers/tests backward compatible.
function meetsQuestRequirement(monster, completedQuests) {
  const required = monster?.questRequirement
  if (!required) return true
  if (completedQuests == null) return true
  return questRequirementMet(completedQuests, required)
}

// A pool entry is eligible only when the player meets the slayer requirement —
// and, when `completedQuests` is supplied, any quest requirement — of every
// monster the task resolves to.
export function isEntryEligible(entry, slayerLevel, completedQuests) {
  return resolveTaskMonsterIds(getEntryId(entry)).every(monsterKey => {
    const monster = monstersData[monsterKey]
    if (monster?.slayerRequirement && slayerLevel < monster.slayerRequirement) return false
    if (!meetsQuestRequirement(monster, completedQuests)) return false
    return true
  })
}

// In-memory per-master history of recently assigned monsters. This keeps the
// distribution even within a play session: a master will cycle through all of
// its eligible monsters before repeating any of them.
const recentTasksByMaster = new Map()

/**
 * Picks a slayer monster from a master's pool with even distribution.
 *
 * Only monsters whose slayer requirement is met are considered, and any monster
 * assigned recently (tracked per master) is skipped until the rest of the
 * eligible pool has been cycled through. This replaces the previous uniform
 * random pick + deterministic first-match fallback, which caused the same task
 * to be handed out repeatedly.
 *
 * @returns {{ entry, monsterId, isBoss } | null} null when nothing is eligible.
 */
export function pickSlayerMonster(master, slayerLevel, options = {}) {
  const rng = options.rng || Math.random
  const history = options.history || recentTasksByMaster
  const completedQuests = options.completedQuests

  const eligible = master.monsterPool.filter(entry => isEntryEligible(entry, slayerLevel, completedQuests))
  if (eligible.length === 0) return null

  const recent = history.get(master.id) || []
  let choices = eligible.filter(entry => !recent.includes(getEntryId(entry)))
  if (choices.length === 0) choices = eligible

  const pick = choices[Math.floor(rng() * choices.length)]
  const monsterId = getEntryId(pick)

  // Remember enough history to cover every eligible monster but one, so the
  // selection always has at least one fresh option to rotate to.
  const cap = Math.max(1, eligible.length - 1)
  history.set(master.id, [...recent, monsterId].slice(-cap))

  return {
    entry: pick,
    monsterId,
    isBoss: typeof pick === 'object' && !!pick.boss,
  }
}
