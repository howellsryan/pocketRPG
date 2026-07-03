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

// Mobile OSRS-style frame (GameFrameBar): icon rails above and below the main
// content panel. Top rail also carries the Skip action; bottom rail carries
// Credits between Settings and Home (both rendered by GameFrameBar itself).
export const GAME_FRAME_TOP_TABS = [
  // scroll/home art is white — ink it so it reads on the rail's parchment tiles.
  ...(isWorldMapEnabled() ? [{ id: SCREENS.WORLD_MAP, label: 'Map', iconKey: 'scroll', iconSize: 26, iconColor: 'var(--fm-ink-soft)' }] : []),
  { id: SCREENS.INVENTORY, label: 'Items', iconKey: 'money_purse', iconSize: 30 },
  { id: SCREENS.EQUIPMENT, label: 'Equip', iconKey: 'iron_platebody', iconSize: 30 },
]
export const GAME_FRAME_BOTTOM_LEFT_TABS = [
  { id: SCREENS.HELP, label: 'Settings', iconKey: 'tinderbox', iconSize: 30 },
]
export const GAME_FRAME_BOTTOM_RIGHT_TABS = [
  { id: SCREENS.HOME, label: 'Home', iconKey: 'home', iconSize: 28, iconColor: 'var(--fm-ink-soft)' },
]

// Screens reachable from the Settings screen (HelpScreen) instead of the nav
// rails — keeps SideNav/BurgerMenu short on mobile and desktop. Trading Post
// and Clues also live here because the mobile OSRS-style frame (GameFrameBar)
// has no rail entry for them — Settings is their only mobile entry point.
export const SETTINGS_NAV_LINKS = [
  { id: SCREENS.STORE,             label: 'Trading Post',      iconKey: 'uncut_ruby' },
  { id: SCREENS.CLUES,             label: 'Clues',             iconKey: 'clue_scroll_hard' },
  { id: SCREENS.CONNECT_AI,        label: 'Connect AI',        iconKey: 'brain', iconColor: '#D97757', iconSize: 28 },
  { id: SCREENS.CHARACTER_UNLOCKS, label: 'Character Unlocks', iconKey: 'master_rejuvenation' },
  { id: SCREENS.ARMOURY,           label: 'Armoury',           iconKey: 'iron_longsword' },
  { id: SCREENS.COLLECTION_LOG,    label: 'Collection Log',    iconKey: 'open_book', iconColor: 'var(--fm-brass-lo)', iconSize: 28 },
  { id: SCREENS.LEADERBOARD,       label: 'Leaderboard',       iconKey: 'progression', iconSize: 22 },
]
