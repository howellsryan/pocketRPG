import { isValidEntry } from '../collectionLog.js'
import { GameApiError } from './errors.js'
import { addItemToInventory, addItemToBank, removeItemFromInventory, getInventory } from './inventory.js'
import { VALID_CLUE_REWARD_ITEMS } from './clueRewards.js'
import skillsData from '../../../src/data/skills.json' assert { type: 'json' }
import raidsData from '../../../src/data/raids.json' assert { type: 'json' }
import monstersData from '../../../src/data/monsters.json' assert { type: 'json' }
import itemsData from '../../../src/data/items.json' assert { type: 'json' }
import minigamesData from '../../../src/data/minigames.json' assert { type: 'json' }

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
const VALID_MONSTER_REWARD_ITEMS = new Map(
  Object.entries(monstersData || {}).map(([monsterId, monster]) => {
    const valid = new Set()
    for (const drop of monster?.drops || []) {
      if (typeof drop?.itemId === 'string') valid.add(drop.itemId)
    }
    return [monsterId, valid]
  })
)
const VALID_MINIGAME_REWARD_ITEMS = new Map(
  (minigamesData?.tasks || []).map((task) => {
    const valid = new Set()
    if (typeof task?.product === 'string') valid.add(task.product)
    for (const itemId of (Array.isArray(task?.rewardItems) ? task.rewardItems : [])) {
      if (typeof itemId === 'string') valid.add(itemId)
    }
    return [task?.id, valid]
  }).filter(([id]) => typeof id === 'string' && id.length > 0)
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
  if (sourceType === 'monsters' || sourceType === 'boss') {
    return VALID_MONSTER_REWARD_ITEMS.get(sourceId)?.has(itemId) || false
  }
  if (sourceType === 'minigames' || sourceType === 'minigame') {
    return VALID_MINIGAME_REWARD_ITEMS.get(sourceId)?.has(itemId) || false
  }
  if (sourceType === 'clues' || sourceType === 'clue') {
    return VALID_CLUE_REWARD_ITEMS.get(sourceId)?.has(itemId) || false
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

function addUnlockedMinigameItems(saveObject, itemIds = []) {
  const filtered = itemIds.filter(id => typeof id === 'string' && id.length > 0)
  if (filtered.length === 0) return
  if (!saveObject.settings || typeof saveObject.settings !== 'object') saveObject.settings = {}
  const current = Array.isArray(saveObject.settings.unlockedMinigameItems) ? saveObject.settings.unlockedMinigameItems : []
  saveObject.settings.unlockedMinigameItems = [...new Set([...current, ...filtered])]
}

function setDungeoneeringTokenBalance(saveObject, nextValue) {
  const normalized = Math.max(0, Math.floor(Number(nextValue) || 0))
  saveObject.dungeoneeringTokens = normalized
  if (!saveObject.settings || typeof saveObject.settings !== 'object') saveObject.settings = {}
  saveObject.settings.dungeoneeringTokens = normalized
}

function isStackableItem(itemId) {
  return itemsData?.[itemId]?.stackable === true
}

export function settleActionCompletion(saveObject, { sourceType, sourceId, nonce, rewards = [], consumptions = [], slayerPoints = 0, dungeoneeringTokens = 0 }) {
  assertNonce(saveObject, nonce)

  for (const c of consumptions) {
    removeItemFromInventory(saveObject, c.itemId, c.quantity)
  }


  const granted = []
  const inv = getInventory(saveObject)
  for (const reward of rewards) {
    const itemId = typeof reward?.itemId === 'string' ? reward.itemId : null
    const qty = Math.floor(Number(reward?.quantity) || 0)
    if (!itemId || qty < 1) throw new GameApiError('INVALID_REWARD_ITEM', 'Invalid reward item', 400)
    if (!isValidRewardSourceItem(sourceType, sourceId, itemId)) {
      throw new GameApiError('INVALID_REWARD_SOURCE', 'Reward item not valid for source', 403)
    }
    const stackable = isStackableItem(itemId)
    if (stackable) {
      const hasExistingStack = inv.some(s => s?.itemId === itemId)
      if (hasExistingStack || inv.length < 28) {
        addItemToInventory(saveObject, itemId, qty)
        granted.push({ itemId, quantity: qty, destination: 'inventory' })
      } else {
        addItemToBank(saveObject, itemId, qty)
        granted.push({ itemId, quantity: qty, destination: 'bank' })
      }
      continue
    }

    const slotsLeft = Math.max(0, 28 - inv.length)
    const toInventory = Math.min(qty, slotsLeft)
    const toBank = qty - toInventory
    for (let i = 0; i < toInventory; i++) {
      inv.push({ itemId, quantity: 1 })
    }
    if (toInventory > 0) granted.push({ itemId, quantity: toInventory, destination: 'inventory' })
    if (toBank > 0) {
      addItemToBank(saveObject, itemId, toBank)
      granted.push({ itemId, quantity: toBank, destination: 'bank' })
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
  if (sourceType === 'minigames' || sourceType === 'minigame') {
    addUnlockedMinigameItems(saveObject, granted.map(g => g.itemId))
  }

  const dTokens = Math.floor(Number(dungeoneeringTokens) || 0)
  if (dTokens !== 0) {
    const cur = getDungeoneeringTokenBalance(saveObject)
    if (cur + dTokens < 0) throw new GameApiError('INSUFFICIENT_SUPPLIES', 'Insufficient supplies', 400)
    setDungeoneeringTokenBalance(saveObject, cur + dTokens)
  }

  return { granted, slayerPoints: sPoints, dungeoneeringTokens: dTokens }
}
