import { SCREENS, isWorldMapEnabled } from '../utils/constants.js'

export const NAV_TABS = [
  { id: SCREENS.HOME,               label: 'Home',           icon: '🏠', iconKey: 'home', iconSize: 34 },
  ...(isWorldMapEnabled() ? [{ id: SCREENS.WORLD_MAP, label: 'World Map', icon: '🗺️', iconKey: 'scroll', iconSize: 30 }] : []),
  { id: SCREENS.BANK,               label: 'Bank',           icon: '🏦', iconKey: 'coins' },
  { id: SCREENS.INVENTORY,          label: 'Items',          icon: '🎒', iconKey: 'money_purse' },
  { id: SCREENS.EQUIPMENT,          label: 'Equip',          icon: '🛡️', iconKey: 'iron_platebody' },
  { id: SCREENS.STORE,              label: 'Trading Post',   icon: '🪙', iconKey: 'uncut_ruby' },
  { id: SCREENS.SKILLS,             label: 'Skills',         icon: '🔨', iconKey: 'hammer' },
  { id: SCREENS.COMBAT,             label: 'Combat',         icon: '⚔️', iconKey: 'iron_sword' },
  { id: SCREENS.QUESTS,             label: 'Quests',         icon: '📜', iconKey: 'clue_scroll_medium' },
  { id: SCREENS.CLUES,              label: 'Clues',          icon: '🗝️', iconKey: 'clue_scroll_hard' },
  { id: SCREENS.MINIGAMES,          label: 'Minigames',      icon: '🎮', iconKey: 'purple_sweets' },
  { id: SCREENS.GATHER,             label: 'Gather',         icon: '🌿', iconKey: 'kingsherb' },
  { id: SCREENS.COLLECTION_LOG,     label: 'Collection Log', icon: '📖', iconKey: 'open_book', iconColor: 'var(--fm-brass-lo)', iconSize: 28 },
  { id: SCREENS.LEADERBOARD,        label: 'Leaderboard',    icon: '🏆', iconKey: 'progression', iconSize: 22 },
  { id: SCREENS.ARMOURY,            label: 'Armoury',        icon: '🗡️', iconKey: 'iron_longsword' },
  { id: SCREENS.HELP,               label: 'Help & Settings', icon: '🧭', iconKey: 'tinderbox' },
  { id: SCREENS.CHARACTER_UNLOCKS,  label: 'Unlocks',        icon: '✨', iconKey: 'master_rejuvenation' },
  { id: SCREENS.CONNECT_AI,         label: 'Connect AI',     icon: '🤖', iconKey: 'brain', iconColor: '#D97757', iconSize: 28 },
]
