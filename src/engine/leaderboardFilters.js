// Single source of truth for leaderboard filters, shared by the client
// (toggle UI) and the server (request validation). Pure logic, no UI imports.
//
// Order: total level first (default), then each raid, then every boss ordered
// by combat level. Kill-count filters resolve against the server-authoritative
// kill_counts table (migration 0019).

import raidsData from '../data/raids.json'
import monstersData from '../data/monsters.json'

export const TOTAL_LEVEL_FILTER = Object.freeze({
  id: 'total',
  type: 'total',
  label: 'Total Level',
})

// Ironman-only board, ranked by total level (same metric as the main board,
// scoped to is_ironman accounts server-side).
export const IRONMAN_FILTER = Object.freeze({
  id: 'ironman',
  type: 'ironman',
  label: 'Ironman',
  icon: '🪖', // emoji fallback before the helm glyph chunk loads
})

// Canonical raids only. raids.json carries legacy_id aliases as extra keys
// whose `id` points back at the canonical entry; skip those so each raid
// appears once. Preserves raids.json declaration order.
function buildRaidLeaderboardFilters() {
  return Object.entries(raidsData)
    .filter(([key, raid]) => raid && raid.id === key)
    .map(([key, raid]) => ({
      id: `raids:${key}`,
      type: 'kc',
      sourceType: 'raids',
      sourceId: key,
      label: raid.name || key,
      icon: raid.icon || null,
    }))
}

// Monster ids that belong to a raid encounter. These carry boss:true in
// monsters.json but must not appear as standalone boss filters — only the
// raid itself is leaderboard-ranked (raid KC is tracked per raid, not per
// sub-boss).
function getRaidBossIds() {
  const ids = new Set()
  for (const raid of Object.values(raidsData)) {
    for (const bossId of (raid?.bosses || [])) {
      if (typeof bossId === 'string' && bossId) ids.add(bossId)
    }
  }
  return ids
}

// Every standalone boss, weakest to strongest by combat level (name as
// tiebreak). Raid sub-bosses are excluded.
function buildBossLeaderboardFilters() {
  const raidBossIds = getRaidBossIds()
  return Object.entries(monstersData)
    .filter(([key, monster]) => monster && monster.boss === true && !raidBossIds.has(key))
    .map(([key, monster]) => ({
      id: `monsters:${key}`,
      type: 'kc',
      sourceType: 'monsters',
      sourceId: key,
      label: monster.name || key,
      combatLevel: Math.max(0, Math.floor(Number(monster.combatLevel) || 0)),
    }))
    .sort((a, b) => a.combatLevel - b.combatLevel || a.label.localeCompare(b.label))
}

let cachedLeaderboardFilters = null

export function getLeaderboardFilters() {
  if (!cachedLeaderboardFilters) {
    cachedLeaderboardFilters = [
      TOTAL_LEVEL_FILTER,
      IRONMAN_FILTER,
      ...buildRaidLeaderboardFilters(),
      ...buildBossLeaderboardFilters(),
    ]
  }
  return cachedLeaderboardFilters
}

export function getLeaderboardFilterById(id) {
  return getLeaderboardFilters().find(f => f.id === id) || null
}

// Server-side guard: only (sourceType, sourceId) pairs that map to a known
// raid/boss filter are queryable, which also keeps the edge cache bounded.
export function isValidKcSource(sourceType, sourceId) {
  return getLeaderboardFilters().some(
    f => f.type === 'kc' && f.sourceType === sourceType && f.sourceId === sourceId,
  )
}
