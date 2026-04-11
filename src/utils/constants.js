// Core timing
export const TICK_DURATION = 600 // ms per game tick
export const TICKS_PER_SECOND = 1000 / TICK_DURATION

// Inventory & bank
export const INVENTORY_SIZE = 28
export const BANK_SIZE = 500

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

// Skills list
export const COMBAT_SKILLS = ['attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic', 'prayer']
export const GATHERING_SKILLS = ['mining', 'woodcutting', 'fishing', 'farming', 'hunter']
export const PRODUCTION_SKILLS = ['smithing', 'cooking', 'crafting', 'fletching', 'herblore', 'runecraft', 'magic']
export const UTILITY_SKILLS = ['agility', 'thieving', 'slayer', 'firemaking', 'construction']

export const ALL_SKILLS = [...COMBAT_SKILLS, ...GATHERING_SKILLS, ...PRODUCTION_SKILLS, ...UTILITY_SKILLS]

export const STUB_SKILLS = new Set(['farming', 'hunter', 'runecraft', 'thieving', 'firemaking', 'construction'])

// Agility banking: delay in ms at level 1 and level 99
export const AGILITY_BANK_DELAY_LV1_MS = 5 * 60 * 1000   // 5 minutes
export const AGILITY_BANK_DELAY_LV99_MS = 10 * 1000        // 10 seconds

// Equipment slots
export const EQUIPMENT_SLOTS = ['head', 'body', 'legs', 'weapon', 'shield', 'gloves', 'boots', 'cape', 'neck', 'ring', 'ammo']

// Skill icons (emoji for MVP)
export const SKILL_ICONS = {
  attack: '⚔️', strength: '💪', defence: '🛡️', hitpoints: '❤️',
  ranged: '🏹', magic: '🔮', prayer: '🙏',
  mining: '⛏️', woodcutting: '🪓', fishing: '🎣', farming: '🌾', hunter: '🪤',
  smithing: '🔨', cooking: '🍳', crafting: '✂️', fletching: '🏹', herblore: '🧪', runecraft: '🔴',
  agility: '🏃', thieving: '🗝️', slayer: '💀', firemaking: '🔥', construction: '🏠'
}

// Screen tabs
export const SCREENS = {
  HOME: 'home',
  STATS: 'stats',
  BANK: 'bank',
  INVENTORY: 'inventory',
  EQUIPMENT: 'equipment',
  COMBAT: 'combat',
  SKILLS: 'skills',
  GATHER: 'gather',
  AGILITY: 'agility',
  STORE: 'store'
}
