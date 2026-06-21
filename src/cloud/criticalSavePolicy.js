export const CRITICAL_SAVE_REASONS = Object.freeze({
  MONSTER_KILL: 'monster_kill',
  CLUE_REWARD: 'clue_reward',
  MINIGAME_COMPLETE: 'minigame_complete',
  ACTIVITY_HEARTBEAT: 'activity_heartbeat',
  LEVEL_UP: 'level_up',
  BOSS_KILL: 'boss_kill',
  RAID_COMPLETE: 'raid_complete',
  RARE_DROP: 'rare_drop',
  QUEST_COMPLETE: 'quest_complete',
  FEATURE_UNLOCK: 'feature_unlock',
  SLAYER_TASK_CHANGE: 'slayer_task_change',
  SLAYER_TASK_COMPLETE: 'slayer_task_complete',
  PURCHASE: 'purchase',
  SKIP_HOUR: 'skip_hour',
  PVP_MATCH_COMPLETE: 'pvp_match_complete',
  EQUIPMENT_PRESET_CHANGE: 'equipment_preset_change',
})

export const CRITICAL_SAVE_COALESCE_MS = 3_000
export const RARE_DROP_CHANCE_THRESHOLD = 0.01

const KNOWN_REASONS = new Set(Object.values(CRITICAL_SAVE_REASONS))

export function normaliseCriticalSaveReason(reason) {
  return KNOWN_REASONS.has(reason) ? reason : 'critical'
}

export function extractSkillLevels(stats = {}) {
  const levels = {}
  for (const [skill, value] of Object.entries(stats || {})) {
    const level = Number(value?.level)
    if (Number.isFinite(level)) levels[skill] = level
  }
  return levels
}

export function detectLevelUps(previousLevels = {}, nextStats = {}) {
  const ups = []
  for (const [skill, value] of Object.entries(nextStats || {})) {
    const nextLevel = Number(value?.level)
    const prevLevel = Number(previousLevels?.[skill])
    if (!Number.isFinite(nextLevel)) continue
    if (Number.isFinite(prevLevel) && nextLevel > prevLevel) ups.push({ skill, previousLevel: prevLevel, nextLevel })
  }
  return ups
}

export function detectCountIncreases(previousCounts = {}, nextCounts = {}) {
  const increases = []
  for (const [id, rawNext] of Object.entries(nextCounts || {})) {
    const next = Number(rawNext) || 0
    const prev = Number(previousCounts?.[id]) || 0
    if (next > prev) increases.push({ id, previousCount: prev, nextCount: next })
  }
  return increases
}

export function detectSetGrowth(previousSetLike, nextSetLike) {
  const previous = previousSetLike instanceof Set ? previousSetLike : new Set(previousSetLike || [])
  const next = nextSetLike instanceof Set ? nextSetLike : new Set(nextSetLike || [])
  const added = []
  for (const value of next) {
    if (!previous.has(value)) added.push(value)
  }
  return added
}

export function didNumberIncrease(previousValue, nextValue) {
  const prev = Number(previousValue) || 0
  const next = Number(nextValue) || 0
  return next > prev
}

function normaliseLootItemId(lootEntry) {
  return lootEntry?.itemId || lootEntry?.id || lootEntry?.item_id || null
}

export function isCriticalDrop(lootEntry, monster, itemsData = {}, options = {}) {
  const itemId = normaliseLootItemId(lootEntry)
  if (!itemId) return false

  const item = itemsData?.[itemId]
  if (item?.criticalSave || item?.unique || item?.collectionLog) return true

  const chanceThreshold = Number.isFinite(options.chanceThreshold) ? options.chanceThreshold : RARE_DROP_CHANCE_THRESHOLD

  const drop = Array.isArray(monster?.drops)
    ? monster.drops.find(d => d?.itemId === itemId || d?.id === itemId || d?.item_id === itemId)
    : null

  const chance = Number(drop?.chance)
  return Number.isFinite(chance) && chance > 0 && chance <= chanceThreshold
}

export function hasCriticalDrop(loot = [], monster, itemsData = {}, options = {}) {
  return Array.isArray(loot) && loot.some(entry => isCriticalDrop(entry, monster, itemsData, options))
}
