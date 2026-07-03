import { SCREENS, isWorldMapEnabled } from '../utils/constants.js'

export const NAV_TABS = [
  { id: SCREENS.HOME,               label: 'Home',           icon: '🏠', iconKey: 'home', iconSize: 34 },
  ...(isWorldMapEnabled() ? [{ id: SCREENS.WORLD_MAP, label: 'World Map', icon: '🗺️', iconKey: 'scroll', iconSize: 30 }] : []),
  { id: SCREENS.BANK,               label: 'Bank',           icon: '🏦', iconKey: 'coins' },
  { id: SCREENS.INVENTORY,          label: 'Items',          icon: '🎒', iconKey: 'money_purse' },
  { id: SCREENS.EQUIPMENT,          label: 'Equip',          icon: '🛡️', iconKey: 'iron_platebody' },
  { id: SCREENS.STORE,              label: 'Trading Post',   icon: '🪙', iconKey: 'uncut_ruby' },
  { id: SCREENS.CLUES,              label: 'Clues',          icon: '🗝️', iconKey: 'clue_scroll_hard' },
  { id: SCREENS.HELP,               label: 'Settings',       icon: '🧭', iconKey: 'tinderbox' },
]

// Skills/Combat/Quests/Minigames/Gather have no nav entry: that content starts
// from the World Map (place hubs, town maps, quest posts).

// Screens reachable from the Settings screen (HelpScreen) instead of the nav
// rails — keeps SideNav/BurgerMenu short on mobile and desktop.
export const SETTINGS_NAV_LINKS = [
  { id: SCREENS.CONNECT_AI,        label: 'Connect AI',        iconKey: 'brain', iconColor: '#D97757', iconSize: 28 },
  { id: SCREENS.CHARACTER_UNLOCKS, label: 'Character Unlocks', iconKey: 'master_rejuvenation' },
  { id: SCREENS.ARMOURY,           label: 'Armoury',           iconKey: 'iron_longsword' },
  { id: SCREENS.COLLECTION_LOG,    label: 'Collection Log',    iconKey: 'open_book', iconColor: 'var(--fm-brass-lo)', iconSize: 28 },
  { id: SCREENS.LEADERBOARD,       label: 'Leaderboard',       iconKey: 'progression', iconSize: 22 },
]
