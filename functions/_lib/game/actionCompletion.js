import { isValidEntry } from '../collectionLog.js'
import { GameApiError } from './errors.js'
import { addItemToInventory, addItemToBank, removeItemFromInventory, removeItemFromBank, bankQuantity, getInventory } from './inventory.js'
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


function getDungeoneeringTokenBalance(saveObject) {
  const topLevel = Number(saveObject?.dungeoneeringTokens)
  if (Number.isFinite(topLevel)) return Math.floor(topLevel)
  const settingsLevel = Number(saveObject?.settings?.dungeoneeringTokens)
  if (Number.isFinite(settingsLevel)) return Math.floor(settingsLevel)
  return 0
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

// Pre-step-6 callers passed `nonce` for in-blob replay defence. The new
// flow claims the nonce via claimActionNonce(env, characterId, nonce)
// BEFORE calling this — that path is atomic at the DB level. The `nonce`
// arg is accepted and ignored here for backward compatibility with any
// caller that hasn't migrated yet (tests can still pass it).
export function settleActionCompletion(saveObject, { sourceType, sourceId, nonce: _nonce, rewards = [], consumptions = [], slayerPoints = 0, dungeoneeringTokens = 0 }) {
  for (const c of consumptions) {
    // Consume inventory-first-then-bank: clue scrolls (and most supplies) are
    // auto-banked on drop and the client gates on inventory+bank, so an
    // inventory-only debit rejects legitimate completions with
    // INSUFFICIENT_SUPPLIES whenever the item sits in the bank.
    const qty = Math.floor(Number(c.quantity) || 0)
    if (qty < 1) throw new GameApiError('INVALID_QUANTITY', 'Invalid quantity', 400)
    const inInventory = getInventory(saveObject).reduce(
      (sum, s) => sum + (s?.itemId === c.itemId ? Math.floor(Number(s.quantity) || 0) : 0), 0)
    if (inInventory + bankQuantity(saveObject, c.itemId) < qty) {
      throw new GameApiError('INSUFFICIENT_SUPPLIES', 'Insufficient supplies', 400)
    }
    const fromInventory = Math.min(inInventory, qty)
    if (fromInventory > 0) removeItemFromInventory(saveObject, c.itemId, fromInventory)
    if (qty - fromInventory > 0) removeItemFromBank(saveObject, c.itemId, qty - fromInventory)
  }


  // Zul-Kaar's Blade (slayer-point unlock) additionally gates on the
  // player's Zul-Kaar task-completion count. slayerPoints alone is not
  // sufficient for a "requiresMasterCompletions" unlock — read strictly from
  // the server's own persisted save (settings.slayerMasterTaskCompletions),
  // never from any client-supplied request field, or a client could grant
  // itself the weapon by simply claiming enough completions.
  if (rewards.some(r => r?.itemId === 'zul_kaars_blade')) {
    const zulKaarCompletions = Math.floor(Number(saveObject.settings?.slayerMasterTaskCompletions?.zul_kaar) || 0)
    if (zulKaarCompletions < 25) {
      throw new GameApiError('SLAYER_MASTER_COMPLETIONS_REQUIRED', 'Requires 25 completed Zul-Kaar tasks', 403)
    }
  }

  const granted = []
  for (const reward of rewards) {
    const itemId = typeof reward?.itemId === 'string' ? reward.itemId : null
    const qty = Math.floor(Number(reward?.quantity) || 0)
    if (!itemId || qty < 1) throw new GameApiError('INVALID_REWARD_ITEM', 'Invalid reward item', 400)
    if (!isValidRewardSourceItem(sourceType, sourceId, itemId)) {
      throw new GameApiError('INVALID_REWARD_SOURCE', 'Reward item not valid for source', 403)
    }
    // Re-read the live inventory each iteration. addItemToInventory calls
    // getInventory, which REPLACES save.inventory with a freshly compacted
    // array — a reference captured once before the loop goes stale after the
    // first inventory add, so any items pushed onto it afterwards (and the
    // slot-cap check that decides bank-vs-inventory) would silently miss the
    // persisted save, losing drops once the inventory starts filling up.
    const inv = getInventory(saveObject)
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
    // Slayer points live at `settings.slayerPoints` in the save blob (the
    // canonical client/MCP location — see gameState getSnapshot and
    // intents.slayerStatus). Reading/writing them anywhere else (e.g. a
    // top-level `slayer.points`) makes the server see 0 points and reject
    // every slayer-points spend with INSUFFICIENT_SUPPLIES.
    if (!saveObject.settings || typeof saveObject.settings !== 'object') saveObject.settings = {}
    const cur = Math.max(0, Math.floor(Number(saveObject.settings.slayerPoints) || 0))
    if (cur + sPoints < 0) throw new GameApiError('INSUFFICIENT_SUPPLIES', 'Insufficient supplies', 400)
    saveObject.settings.slayerPoints = cur + sPoints
  }

  // Boss/raid kill counts are persisted server-authoritatively into the
  // dedicated kill_counts table (see _completeShared.js), not the save blob.
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
