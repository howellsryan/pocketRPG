// Core timing
export const TICK_DURATION = 600 // ms per game tick
export const TICKS_PER_SECOND = 1000 / TICK_DURATION

// Inventory & bank
export const INVENTORY_SIZE = 28
export const BANK_SIZE = 500

// Sells at or above this total gp trigger a confirmation prompt (mirrors the
// item-drop confirmation) so a mistap can't lose a fortune silently.
export const HIGH_VALUE_SELL_THRESHOLD = 1_000_000

// Construction level that unlocks auto-banking for gathered resources. Below
// this, gathering fills the inventory and stops when full; at/above it, a full
// inventory triggers an agility-scaled bank trip so gathering continues.
export const GATHER_AUTOBANK_CONSTRUCTION_LEVEL = 80

// Combat
export const EAT_TICK_COST = 3
export const POTION_TICK_COST = 3
export const DEFAULT_AUTO_EAT_THRESHOLD = 0.5 // 50% HP

// XP
export const MAX_XP = 200_000_000
export const MAX_LEVEL = 99
export const HITPOINTS_START_LEVEL = 10
export const HITPOINTS_START_XP = 1154

// Combat XP multipliers
export const MELEE_XP_PER_DAMAGE = 4
export const RANGED_XP_PER_DAMAGE = 4
export const MAGIC_XP_PER_DAMAGE = 2
export const HP_XP_PER_DAMAGE = 1.33

// Skilling
export const COOKING_BURN_BASE_CHANCE = 0.5 // 50% at minimum level, scales down

// Auto-save
export const AUTO_SAVE_DEBOUNCE = 300 // ms

// Quests
export const QUEST_QUEUE_MAX = 3

// Skills list
export const COMBAT_SKILLS = ['attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic', 'prayer']
export const GATHERING_SKILLS = ['mining', 'woodcutting', 'fishing', 'farming']
// Gathering skills that always auto-bank during idle/skip catch-up, regardless
// of the Construction auto-bank unlock. This stops the 28-slot inventory cap
// from halting long idle/skip sessions — otherwise these are the only skills
// that can't be meaningfully idled/skipped without the unlock. Farming is
// excluded (it still banks only once the Construction unlock is earned).
export const IDLE_AUTOBANK_GATHERING_SKILLS = ['mining', 'woodcutting', 'fishing']
export const PRODUCTION_SKILLS = ['smithing', 'cooking', 'crafting', 'fletching', 'herblore', 'runecraft', 'firemaking']
export const UTILITY_SKILLS = ['agility', 'thieving', 'hunter', 'slayer', 'construction', 'dungeoneering']

export const ALL_SKILLS = [...COMBAT_SKILLS, ...GATHERING_SKILLS, ...PRODUCTION_SKILLS, ...UTILITY_SKILLS]

// Maxed account = every skill at the level cap. Drives the max cape unlock and
// the gilded leaderboard treatment.
export const MAX_TOTAL_LEVEL = ALL_SKILLS.length * MAX_LEVEL

export const STUB_SKILLS = new Set([])

// Agility banking: delay in ms at level 1 and level 99
export const AGILITY_BANK_DELAY_LV1_MS = 5 * 60 * 1000   // 5 minutes
export const AGILITY_BANK_DELAY_LV99_MS = 10 * 1000        // 10 seconds

// Equipment slots
export const EQUIPMENT_SLOTS = ['head', 'body', 'legs', 'weapon', 'shield', 'gloves', 'boots', 'cape', 'neck', 'ring', 'ammo']

// Format drop chance as "1 in X" or percentage
export function formatDropChance(chance) {
  if (chance === 1) return 'Always'
  if (chance >= 0.01) return `${(chance * 100).toFixed(1)}%`
  if (chance > 0) {
    const oneIn = Math.round(1 / chance)
    return `1 in ${oneIn.toLocaleString()}`
  }
  return '—'
}

// Skill icons (emoji for MVP)
export const SKILL_ICONS = {
  attack: '⚔️', strength: '💪', defence: '🛡️', hitpoints: '❤️',
  ranged: '🏹', magic: '🔮', prayer: '🙏',
  mining: '⛏️', woodcutting: '🪓', fishing: '🎣', farming: '🌾', hunter: '🪤',
  smithing: '🔨', cooking: '🍳', crafting: '✂️', fletching: '🏹', herblore: '🧪', runecraft: '🔴',
  agility: '🏃', thieving: '🗝️', slayer: '💀', firemaking: '🔥', construction: '🏠',
  dungeoneering: '🏰'
}

// Screen tabs
export const SCREENS = {
  HOME: 'home',
  STATS: 'stats',
  BANK: 'bank',
  BANK_HUB: 'bank_hub',
  INVENTORY: 'inventory',
  EQUIPMENT: 'equipment',
  COMBAT: 'combat',
  SKILLS: 'skills',
  GATHER: 'gather',
  AGILITY: 'agility',
  STORE: 'store',
  QUESTS: 'quests',
  CLUES: 'clues',
  MINIGAMES: 'minigames',
  COLLECTION_LOG: 'collection_log',
  LEADERBOARD: 'leaderboard',
  HELP: 'help',
  ARMOURY: 'armoury',
  CHARACTER_UNLOCKS: 'character_unlocks',
  MAGIC: 'magic',
  WORLD_MAP: 'world_map',
  ADVENTURES: 'adventures',
  DUNGEONS: 'dungeons'
}

// Phase 1 of the map-driven overhaul (docs/map-driven-overhaul-plan.md) ships the
// World Map as a read-only screen behind this flag. Off by default in prod; flip
// the const for a build, or set localStorage `prpg.worldmap` = '1' for a no-rebuild
// dev preview. When off the nav tab is hidden and the route falls through to Home.
export const WORLD_MAP_ENABLED = true

export function isWorldMapEnabled() {
  if (WORLD_MAP_ENABLED) return true
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('prpg.worldmap') === '1'
  } catch {
    return false
  }
}
