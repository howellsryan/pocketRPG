import { SCREENS, isWorldMapEnabled } from '../utils/constants.js'

// Skills/Gather have no nav entry: that content starts from the World Map
// (place hubs, town maps). Quests/Clues/Minigames also start there, but their
// full boards additionally live behind the "Adventures" rail icon; Combat's
// monster picker gets its own rail icon. Both gate their actions by the
// player's actual location (a travel prompt covers the rest), so opening them
// from the rail works from anywhere.

// OSRS-style frame (GameFrameBar) — the app's only navigation chrome at every
// viewport width: gold medallion rails above and below the main content panel,
// set in a carved-wood chrome. Top rail carries Home (top-left) then World
// Map/Combat/Inventory/Equipment/Adventures; bottom rail carries Settings,
// then Daily Tasks + Credits + Skip together (all rendered by GameFrameBar
// itself). Icons are tintable game-icons glyphs so they read as brass/steel
// inlays on the dark medallions.
export const GAME_FRAME_TOP_LEFT_TABS = [
  { id: SCREENS.HOME, label: 'Home', iconKey: 'home', iconSize: 20, iconColor: '#efe3c2' },
]
export const GAME_FRAME_TOP_TABS = [
  ...(isWorldMapEnabled() ? [{ id: SCREENS.WORLD_MAP, label: 'Map', iconKey: 'globe', iconSize: 40 }] : []),
  { id: SCREENS.COMBAT, label: 'Combat', iconKey: 'combat_level', iconSize: 40 },
  { id: SCREENS.INVENTORY, label: 'Items', iconKey: 'backpack', iconSize: 40 },
  { id: SCREENS.EQUIPMENT, label: 'Equip', iconKey: 'paperdoll', iconSize: 40 },
  { id: SCREENS.ADVENTURES, label: 'Adventures', iconKey: 'adventures_scroll', iconSize: 40 },
]
export const GAME_FRAME_BOTTOM_LEFT_TABS = [
  { id: SCREENS.HELP, label: 'Settings', iconKey: 'gears', iconSize: 20, iconColor: '#d9b45a' },
]

// Screens reachable from the Settings screen (HelpScreen) instead of the nav
// rails — keeps the rails short. Trading Post lives here because the OSRS-style
// frame (GameFrameBar) has no rail entry for it — Settings is its only entry
// point. (Combat/Quests/Clues/Minigames moved to their own rail icons.)
export const SETTINGS_NAV_LINKS = [
  { id: SCREENS.STORE,             label: 'Trading Post',      iconKey: 'uncut_ruby' },
  { id: SCREENS.CHARACTER_UNLOCKS, label: 'Character Unlocks', iconKey: 'master_rejuvenation' },
  { id: SCREENS.ARMOURY,           label: 'Armoury',           iconKey: 'iron_longsword' },
  { id: SCREENS.COLLECTION_LOG,    label: 'Collection Log',    iconKey: 'open_book', iconColor: 'var(--color-parchment)' },
  { id: SCREENS.LEADERBOARD,       label: 'Leaderboard',       iconKey: 'progression', iconSize: 22, iconColor: 'var(--color-parchment)' },
]
