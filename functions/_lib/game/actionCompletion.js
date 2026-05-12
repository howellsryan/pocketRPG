import { isValidEntry } from '../collectionLog.js'
import { GameApiError } from './errors.js'
import { addItemToInventory, addItemToBank, removeItemFromInventory } from './inventory.js'
import skillsData from '../../../src/data/skills.json' assert { type: 'json' }
import raidsData from '../../../src/data/raids.json' assert { type: 'json' }

const VALID_DUNGEONEERING_REWARD_ITEMS = new Set(
  ((skillsData?.dungeoneering?.actions) || [])
    .filter(action => action?.category === 'reward' && typeof action?.product === 'string')
    .map(action => action.product)
)
const VALID_RAID_REWARD_ITEMS = new Map(
  Object.entries(raidsData || {}).map(([raidId, raid]) => {
    const valid = new Set()
    for (const drop of raid?.rewards?.always || []) {
      if (typeof drop?.itemId === 'string') valid.add(drop.itemId)
    }
    for (const drop of raid?.rewards?.unique?.items || []) {
      if (typeof drop?.itemId === 'string') valid.add(drop.itemId)
    }
    return [raidId, valid]
  })
)

function isValidRewardSourceItem(sourceType, sourceId, itemId) {
  if (isValidEntry(sourceType, sourceId, itemId)) return true
  // Keep dungeoneering claim validation authoritative even if collection-log
  // source naming drifts between branches/deploys.
  if (sourceType === 'dungeoneering' && sourceId === 'dungeoneering') {
    return VALID_DUNGEONEERING_REWARD_ITEMS.has(itemId)
  }
  if (sourceType === 'raids') {
    return VALID_RAID_REWARD_ITEMS.get(sourceId)?.has(itemId) || false
  }
  return false
}


function assertNonce(saveObject, nonce) {
  if (!nonce || typeof nonce !== 'string') throw new GameApiError('INVALID_NONCE', 'Invalid action nonce', 400)
  if (!saveObject._serverActionNonces) saveObject._serverActionNonces = {}
  if (saveObject._serverActionNonces[nonce]) throw new GameApiError('STALE_REPLAYED_ACTION', 'stale_replayed_action', 409)
  saveObject._serverActionNonces[nonce] = Date.now()
}

function getDungeoneeringTokenBalance(saveObject) {
  const topLevel = Number(saveObject?.dungeoneeringTokens)
  if (Number.isFinite(topLevel)) return Math.floor(topLevel)
  const settingsLevel = Number(saveObject?.settings?.dungeoneeringTokens)
  if (Number.isFinite(settingsLevel)) return Math.floor(settingsLevel)
  return 0
}


function incrementSettingCounterMap(saveObject, key, sourceId) {
  if (!sourceId || typeof sourceId !== 'string') return
  if (!saveObject.settings || typeof saveObject.settings !== 'object') saveObject.settings = {}
  const counts = (saveObject.settings[key] && typeof saveObject.settings[key] === 'object') ? saveObject.settings[key] : {}
  const current = Math.max(0, Math.floor(Number(counts[sourceId]) || 0))
  saveObject.settings[key] = { ...counts, [sourceId]: current + 1 }
}

function setDungeoneeringTokenBalance(saveObject, nextValue) {
  const normalized = Math.max(0, Math.floor(Number(nextValue) || 0))
  saveObject.dungeoneeringTokens = normalized
  if (!saveObject.settings || typeof saveObject.settings !== 'object') saveObject.settings = {}
  saveObject.settings.dungeoneeringTokens = normalized
}

export function settleActionCompletion(saveObject, { sourceType, sourceId, nonce, rewards = [], consumptions = [], slayerPoints = 0, dungeoneeringTokens = 0 }) {
  assertNonce(saveObject, nonce)

  for (const c of consumptions) {
    removeItemFromInventory(saveObject, c.itemId, c.quantity)
  }


  const granted = []
  for (const reward of rewards) {
    const itemId = typeof reward?.itemId === 'string' ? reward.itemId : null
    const qty = Math.floor(Number(reward?.quantity) || 0)
    if (!itemId || qty < 1) throw new GameApiError('INVALID_REWARD_ITEM', 'Invalid reward item', 400)
    if (!isValidRewardSourceItem(sourceType, sourceId, itemId)) {
      throw new GameApiError('INVALID_REWARD_SOURCE', 'Reward item not valid for source', 403)
    }
    try {
      addItemToInventory(saveObject, itemId, qty)
      granted.push({ itemId, quantity: qty, destination: 'inventory' })
    } catch (err) {
      if (err?.code === 'INVENTORY_FULL') {
        addItemToBank(saveObject, itemId, qty)
        granted.push({ itemId, quantity: qty, destination: 'bank' })
      } else {
        throw err
      }
    }
  }

  const sPoints = Math.floor(Number(slayerPoints) || 0)
  if (sPoints !== 0) {
    if (!saveObject.slayer) saveObject.slayer = {}
    const cur = Number(saveObject.slayer.points) || 0
    if (cur + sPoints < 0) throw new GameApiError('INSUFFICIENT_SUPPLIES', 'Insufficient supplies', 400)
    saveObject.slayer.points = cur + sPoints
  }

  if (sourceType === 'raids') incrementSettingCounterMap(saveObject, 'raidKillCounts', sourceId)
  if (sourceType === 'monsters') incrementSettingCounterMap(saveObject, 'bossKillCounts', sourceId)

  const dTokens = Math.floor(Number(dungeoneeringTokens) || 0)
  if (dTokens !== 0) {
    const cur = getDungeoneeringTokenBalance(saveObject)
    if (cur + dTokens < 0) throw new GameApiError('INSUFFICIENT_SUPPLIES', 'Insufficient supplies', 400)
    setDungeoneeringTokenBalance(saveObject, cur + dTokens)
  }

  return { granted, slayerPoints: sPoints, dungeoneeringTokens: dTokens }
}
