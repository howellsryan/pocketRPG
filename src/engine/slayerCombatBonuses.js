import { doesSlayerTaskMatchMonster } from './slayerTasks.js'
export function isOnSlayerTask(slayerTask, monsterId) {
  return Boolean(slayerTask && monsterId && doesSlayerTaskMatchMonster(slayerTask.monsterId, monsterId) && Number(slayerTask.monstersRemaining ?? 0) > 0)
}

export function getSlayerTaskEquipmentBonuses({ equipment = {}, itemsData = {}, slayerTask = null, monsterId = null }) {
  if (!isOnSlayerTask(slayerTask, monsterId)) return { accuracyFlat: 0, damageFlat: 0 }
  let accuracyFlat = 0
  let damageFlat = 0
  for (const slot of Object.values(equipment || {})) {
    if (!slot?.itemId) continue
    const other = itemsData[slot.itemId]?.otherBonus || {}
    accuracyFlat += Math.max(0, Math.floor(Number(other.slayerTaskAccuracyFlat) || 0))
    damageFlat += Math.max(0, Math.floor(Number(other.slayerTaskDamageFlat) || 0))
  }
  return { accuracyFlat, damageFlat }
}
