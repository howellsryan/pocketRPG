import { SCREENS, isWorldMapEnabled } from '../utils/constants.js'

// Gather has no nav entry: that content starts from the World Map (place
// hubs, town maps). Quests/Clues/Minigames also start there, but their full
// boards additionally live behind the "Adventures" rail icon; Combat's
// monster picker gets its own rail icon too. Skills start from their skill's
// own detail modal on the Home screen instead of a rail icon. All of these
// (Bank included) gate their actions by the player's actual location (a
// travel prompt covers the rest), so opening them from the rail works from
// anywhere.

// OSRS-style frame (GameFrameBar) — the mobile chrome (below md): gold
// medallion rails above and below the main content panel, set in a carved-wood
// chrome. Top rail: World Map/Bank/Combat/Inventory/Equipment — the Bank
// medallion opens the Bank & Trading Post hub (BankHubScreen). Bottom rail:
// Settings + Adventures (left), Daily Tasks + Credits + Skip (centered), Home
// + Game Helper (right — Game Helper is a GameFrameBar-only extra tab, cloud
// accounts only, not listed here). Icons are tintable game-icons glyphs so
// they read as brass/steel inlays on the dark medallions. Desktop (md+) uses
// SideNav + Header with the same destinations (DESKTOP_NAV_TABS below) —
// Home/Adventures keep their desktop positions; only mobile moves.
export const GAME_FRAME_TOP_TABS = [
  ...(isWorldMapEnabled() ? [{ id: SCREENS.WORLD_MAP, label: 'Map', iconKey: 'globe', iconSize: 40 }] : []),
  { id: SCREENS.BANK_HUB, label: 'Bank', iconKey: 'coins', iconSize: 40 },
  { id: SCREENS.COMBAT, label: 'Combat', iconKey: 'combat_level', iconSize: 40 },
  { id: SCREENS.INVENTORY, label: 'Items', iconKey: 'backpack', iconSize: 40 },
  { id: SCREENS.EQUIPMENT, label: 'Equip', iconKey: 'paperdoll', iconSize: 40 },
]
export const GAME_FRAME_BOTTOM_LEFT_TABS = [
  { id: SCREENS.HELP, label: 'Settings', iconKey: 'gears', iconSize: 20, iconColor: '#d9b45a' },
  { id: SCREENS.ADVENTURES, label: 'Adventures', iconKey: 'adventures_scroll', iconSize: 20 },
]
export const GAME_FRAME_BOTTOM_RIGHT_TABS = [
  { id: SCREENS.HOME, label: 'Home', iconKey: 'home', iconSize: 20, iconColor: '#efe3c2' },
]

// Desktop chrome (md+): SideNav rail entries — the same destinations as the
// frame rails' medallions (Home/Adventures keep their usual desktop spots —
// only the mobile rails move them). No iconColor: glyphs inherit the rail's
// ink color; bespoke art keeps its own.
export const DESKTOP_NAV_TABS = [
  { id: SCREENS.HOME, label: 'Home', iconKey: 'home', iconSize: 34 },
  ...(isWorldMapEnabled() ? [{ id: SCREENS.WORLD_MAP, label: 'World Map', iconKey: 'globe', iconSize: 30 }] : []),
  { id: SCREENS.BANK,       label: 'Bank',       iconKey: 'coins' },
  { id: SCREENS.STORE,      label: 'Trading Post', iconKey: 'offers', iconSize: 30 },
  { id: SCREENS.COMBAT,     label: 'Combat',     iconKey: 'combat_level' },
  { id: SCREENS.INVENTORY,  label: 'Inventory',  iconKey: 'backpack' },
  { id: SCREENS.EQUIPMENT,  label: 'Equipment',  iconKey: 'paperdoll' },
  { id: SCREENS.ADVENTURES, label: 'Adventures', iconKey: 'adventures_scroll' },
  { id: SCREENS.HELP,       label: 'Settings',   iconKey: 'gears', iconSize: 30 },
]

// Screens reachable from the Settings screen (HelpScreen) instead of the nav
// rails — keeps the rails short. (Combat/Quests/Clues/Minigames moved to
// their own rail icons.)
export const SETTINGS_NAV_LINKS = [
  { id: SCREENS.CHARACTER_UNLOCKS, label: 'Character Unlocks', iconKey: 'master_rejuvenation' },
  { id: SCREENS.ARMOURY,           label: 'Armoury',           iconKey: 'iron_longsword' },
  { id: SCREENS.COLLECTION_LOG,    label: 'Collection Log',    iconKey: 'open_book', iconColor: 'var(--color-parchment)' },
  { id: SCREENS.LEADERBOARD,       label: 'Leaderboard',       iconKey: 'progression', iconSize: 22, iconColor: 'var(--color-parchment)' },
  { id: SCREENS.GRIM_REAPER,       label: 'Grim Reaper',       iconKey: 'grim_reaper_reclaim' },
]
