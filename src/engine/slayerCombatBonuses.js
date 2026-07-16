import { doesSlayerTaskMatchMonster } from './slayerTasks.js'
import { RAID_TASK_META } from './slayerMasters.js'
import raidsData from '../data/raids.json'

// Raid-completion proxy tasks are keyed to the raid's final boss id, but the
// player fights every boss in the raid on the way there — slayer-task gear
// bonuses (slayer helm etc.) should apply for the whole raid, not just the
// last encounter.
function isSameRaidEncounter(taskMonsterId, monsterId) {
  const raidId = RAID_TASK_META[taskMonsterId]?.raidId
  const bosses = raidId ? raidsData[raidId]?.bosses : null
  return Array.isArray(bosses) && bosses.includes(monsterId)
}

export function isOnSlayerTask(slayerTask, monsterId) {
  if (!slayerTask || !monsterId || Number(slayerTask.monstersRemaining ?? 0) <= 0) return false
  return doesSlayerTaskMatchMonster(slayerTask.monsterId, monsterId) || isSameRaidEncounter(slayerTask.monsterId, monsterId)
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
