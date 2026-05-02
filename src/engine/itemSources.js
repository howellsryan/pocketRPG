import { SLAYER_UNLOCKS } from './slayerUnlocks.js'

const titleize = (s = '') => s.split('_').map(x => x.charAt(0).toUpperCase() + x.slice(1)).join(' ')

export function getRaidRewardSources(itemId, raidsData = {}) {
  const names = []
  for (const raid of Object.values(raidsData || {})) {
    const uniqueItems = raid?.rewards?.unique?.items || []
    if (uniqueItems.some(i => i.itemId === itemId)) names.push(raid.name || titleize(raid.id || ''))
  }
  return names
}

export function getMonsterDropSources(itemId, monstersData = {}) {
  const names = []
  for (const monster of Object.values(monstersData || {})) {
    if ((monster?.drops || []).some(d => d.itemId === itemId)) names.push(monster.name || titleize(monster.id || ''))
  }
  return names
}

export function getItemIngredientSources(itemId, data = {}, seen = new Set()) {
  if (!itemId || seen.has(itemId)) return []
  seen.add(itemId)
  const { itemsData = {} } = data
  const item = itemsData[itemId]
  if (!item) return []
  if (item.obtainSource?.type === 'derived_item' && item.obtainSource.itemId) {
    return getItemObtainSources(item.obtainSource.itemId, data, seen)
  }
  return []
}

export function getItemObtainSources(itemId, data = {}, seen = new Set()) {
  const { itemsData = {}, monstersData = {}, raidsData = {}, slayerUnlocks = SLAYER_UNLOCKS } = data
  const item = itemsData[itemId] || {}
  const raidSources = getRaidRewardSources(itemId, raidsData)
  if (raidSources.length) return raidSources
  const monsterSources = getMonsterDropSources(itemId, monstersData)
  if (monsterSources.length) return monsterSources
  if (item.obtainSource?.type === 'monster_drop' && item.obtainSource.sourceId) {
    const monster = monstersData[item.obtainSource.sourceId]
    return [monster?.name || titleize(item.obtainSource.sourceId)]
  }
  if (item.obtainSource?.type === 'raid_reward' && item.obtainSource.sourceId) {
    const raid = raidsData[item.obtainSource.sourceId]
    return [raid?.name || titleize(item.obtainSource.sourceId)]
  }
  if (item.obtainSource?.type === 'derived_item' && item.obtainSource.itemId) {
    return getItemIngredientSources(itemId, data, seen)
  }
  const slayerUnlock = (slayerUnlocks || []).find(x => x.itemId === itemId)
  if (slayerUnlock) return ['Slayer rewards']
  return []
}

export function formatObtainSourceMessage(itemId, data) {
  const raids = getRaidRewardSources(itemId, data?.raidsData)
  if (raids.length) return `Unlock through ${raids[0]}`
  const sources = getItemObtainSources(itemId, data)
  if (!sources.length) return 'Obtain from boss or raid drops'
  if (sources.length === 1) return `Obtain from ${sources[0]}`
  return `Obtain from ${sources.slice(0, -1).join(', ')}, or ${sources[sources.length - 1]}`
}
