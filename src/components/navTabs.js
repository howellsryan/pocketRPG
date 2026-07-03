import { SCREENS, isWorldMapEnabled } from '../utils/constants.js'

export const NAV_TABS = [
  { id: SCREENS.HOME,               label: 'Home',           icon: '🏠', iconKey: 'home', iconSize: 34 },
  ...(isWorldMapEnabled() ? [{ id: SCREENS.WORLD_MAP, label: 'World Map', icon: '🗺️', iconKey: 'globe', iconSize: 30 }] : []),
  { id: SCREENS.BANK,               label: 'Bank',           icon: '🏦', iconKey: 'coins' },
  { id: SCREENS.INVENTORY,          label: 'Items',          icon: '🎒', iconKey: 'backpack' },
  { id: SCREENS.EQUIPMENT,          label: 'Equip',          icon: '🛡️', iconKey: 'paperdoll' },
  { id: SCREENS.STORE,              label: 'Trading Post',   icon: '🪙', iconKey: 'uncut_ruby' },
  { id: SCREENS.CLUES,              label: 'Clues',          icon: '🗝️', iconKey: 'clue_scroll_hard' },
  { id: SCREENS.HELP,               label: 'Settings',       icon: '🧭', iconKey: 'tinderbox' },
]

// Skills/Combat/Quests/Minigames/Gather have no nav entry: that content starts
// from the World Map (place hubs, town maps, quest posts).

// Mobile OSRS-style frame (GameFrameBar): gold medallion rails above and below
// the main content panel, set in a carved-wood chrome. Top rail carries Home
// (top-left) then World Map/Inventory/Equipment; bottom rail carries Settings,
// then Credits + Skip together (both rendered by GameFrameBar itself). Icons
// are tintable game-icons glyphs so they read as brass/steel inlays on the
// dark medallions.
export const GAME_FRAME_TOP_LEFT_TABS = [
  { id: SCREENS.HOME, label: 'Home', iconKey: 'home', iconSize: 20, iconColor: '#efe3c2' },
]
export const GAME_FRAME_TOP_TABS = [
  ...(isWorldMapEnabled() ? [{ id: SCREENS.WORLD_MAP, label: 'Map', iconKey: 'globe', iconSize: 40 }] : []),
  { id: SCREENS.INVENTORY, label: 'Items', iconKey: 'backpack', iconSize: 40 },
  { id: SCREENS.EQUIPMENT, label: 'Equip', iconKey: 'paperdoll', iconSize: 40 },
]
export const GAME_FRAME_BOTTOM_LEFT_TABS = [
  { id: SCREENS.HELP, label: 'Settings', iconKey: 'gears', iconSize: 20, iconColor: '#d9b45a' },
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
  { id: SCREENS.COLLECTION_LOG,    label: 'Collection Log',    iconKey: 'open_book', iconColor: 'var(--color-parchment)' },
  { id: SCREENS.LEADERBOARD,       label: 'Leaderboard',       iconKey: 'progression', iconSize: 22, iconColor: 'var(--color-parchment)' },
]
