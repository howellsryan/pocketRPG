import monstersData from '../data/monsters.json'
import { DAGANNOTH_KINGS_TASK_ID } from './slayerTasks.js'

// PocketRPG slayer masters — requirements and monster pools from PocketRPG design references.
//
// Monster pools are distributed across masters by combat level so that every
// assignable monster (excluding boss and raid monsters) appears on at least one
// master, with deliberate overlap between adjacent tiers. Selection within a
// pool is even (see pickSlayerMonster) so masters no longer repeat the same task.
export const SLAYER_MASTERS = [
  {
    id: 'turael',
    name: 'Torvak',
    location: 'Brighthome',
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
    location: 'Duskmire',
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
    ],
  },
  {
    id: 'vannaka',
    name: 'Valdrin',
    location: 'Deepgate Caverns',
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
    ],
  },
  {
    id: 'chaeldar',
    name: 'Caelira',
    location: 'Moonglade',
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
    location: 'Spryroot Grove',
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
    location: 'Silverkeep Quarter',
    icon: '💀',
    iconKey: 'queen_crown',
    combatReq: 0,
    slayerReq: 90,
    pointsPerTask: 15,
    description: 'The most prestigious master. Assigns the hardest tasks. Requires slayer 90.',
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
]

// Build a slayer task object for an assigned monster. Shared by the game client
// and the MCP assignment intent so the two paths can't drift: Ember Tyrant is
// always a single kill; bosses use the master's bossTaskRange (default [20,50]);
// everything else rolls within the master's taskRange. `options.rng` overrides
// Math.random for deterministic assignment.
export function buildSlayerTask(master, monsterId, isBoss, options = {}) {
  const rng = options.rng || Math.random
  const quantityMultiplier = (Number(options.quantityMultiplier) > 0) ? Number(options.quantityMultiplier) : 1
  const monsterData = monstersData[monsterId]
  const monsterName = monsterId === DAGANNOTH_KINGS_TASK_ID
    ? 'Nagadoth Kings'
    : (monsterData?.name || monsterId.replace(/_/g, ' '))

  let totalCount
  if (monsterId === 'ember_tyrant') {
    totalCount = 1
  } else {
    const taskRange = isBoss ? (master.bossTaskRange || [20, 50]) : master.taskRange
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
  if (typeof completedQuests.has === 'function') return completedQuests.has(required)
  if (Array.isArray(completedQuests)) return completedQuests.includes(required)
  return true
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
