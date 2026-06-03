import { callHandler } from './bridge.js'
import { summarizeSave } from './summary.js'
import { getItem, getMonster, itemName, withItemName, REFERENCE_RESOURCES, readReference } from './reference.js'
import { loadCharacterWithSave, writeSave } from '../game/save.js'
import { auditLog } from '../game/audit.js'
import { assertNotInActiveMatch } from '../pvp.js'
import { depositToBank, withdrawFromBank, equip, unequip, buildIdleTask, runIdleTask, isClaimableTask, buildQuestTask, applyQuestTask, questStatuses, buildCombatTask, runCombatTask } from './intents.js'
import { getIdleRow, setIdleTask, resetIdleActiveAt, clearIdleTask, advanceIdleClock } from './idle.js'
import { SKIP_HOUR_MS } from '../../../src/engine/skipPreflight.js'

// Reuse the exact production endpoint handlers (see bridge.js).
import { onRequestGet as listCharacters } from '../../api/characters/index.js'
import { onRequestGet as getMe } from '../../api/auth/me.js'
import { onRequestGet as getSave } from '../../api/save.js'
import { onRequestGet as getCollectionLog } from '../../api/collection-log.js'
import { onRequestGet as getKillCounts } from '../../api/kill-counts.js'
import { onRequestGet as getLeaderboard } from '../../api/leaderboard.js'
import { onRequestPost as postPurchase } from '../../api/purchase.js'
import { onRequestPost as postSkipHour } from '../../api/skip-hour.js'
import { onRequestPost as postSlayerSkip } from '../../api/slayer/skip.js'
import { onRequestPost as postMarketSearch } from '../../api/trading-post/search.js'
import { onRequestGet as getMyOffers } from '../../api/trading-post/my-offers.js'
import { onRequestPost as postPlaceOffer } from '../../api/trading-post/list.js'
import { onRequestPost as postCancelOffer } from '../../api/trading-post/cancel.js'
import { onRequestPost as postCollectOffer } from '../../api/trading-post/collect.js'
import { onRequestPost as postInstantSell } from '../../api/trading-post/instant-sell.js'
import { onRequestPost as postSellImmediate } from '../../api/trading-post/sell-immediate.js'

function ok(payload) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)
  return { content: [{ type: 'text', text }] }
}

function httpError(res) {
  if (res.status === 401) {
    return new Error('Not authenticated. Reconnect the PocketRPG connector and approve access.')
  }
  return new Error(res.data?.error || `Request failed (HTTP ${res.status}).`)
}

// Most tools act on a single character. Auto-select when the account has
// exactly one; otherwise require an explicit character_id.
async function resolveCharacterId(env, authorization, provided) {
  const res = await callHandler(listCharacters, env, { authorization })
  if (!res.ok) throw httpError(res)
  const characters = res.data?.characters || []
  if (provided !== undefined && provided !== null) {
    const match = characters.find((c) => Number(c.id) === Number(provided))
    if (!match) throw new Error(`Character ${provided} not found on this account.`)
    return Number(match.id)
  }
  if (characters.length === 0) throw new Error('This account has no characters yet. Create one in the PocketRPG app first.')
  if (characters.length === 1) return Number(characters[0].id)
  const list = characters.map((c) => `${c.id} (${c.username})`).join(', ')
  throw new Error(`Multiple characters found — pass character_id. Options: ${list}`)
}

// Apply a Phase C save intent: resolve + own the character, refuse during PvP,
// load → mutate (throws abort the write) → save → audit. No value is created;
// intents only relocate items the character already owns.
async function applySaveIntent({ env, authorization, identity }, characterIdArg, intentFn, auditType) {
  if (!identity?.id) throw new Error('Not authenticated.')
  const id = await resolveCharacterId(env, authorization, characterIdArg)
  const lock = await assertNotInActiveMatch(env, id)
  if (lock) throw new Error('Blocked: the character is in an active PvP match.')
  const { saveObject, saveRevision } = await loadCharacterWithSave(env, id, identity.id)
  const result = intentFn(saveObject)
  const write = await writeSave(env, id, saveObject, saveRevision)
  await auditLog(env, auditType, { characterId: id, identityId: identity.id, ...result }, { swallow: true })
  return ok({ characterId: id, ...result, save_revision: write.saveRevision })
}

const MAX_IDLE_MS = 24 * 60 * 60 * 1000
const MIN_IDLE_MS = 2000

// Claim a character's running idle skilling task: simulate the elapsed window
// server-side, apply it to the save, then reset the idle clock. Only supported
// production-skill tasks are claimed; anything else is left for the game client.
async function claimIdleCore(env, characterId, identityId) {
  const idle = await getIdleRow(env, characterId)
  if (!idle || !idle.active_task) return { claimed: false, reason: 'no_active_task' }
  let task
  try { task = JSON.parse(idle.active_task) } catch { return { claimed: false, reason: 'bad_task' } }
  if (!isClaimableTask(task)) {
    return { claimed: false, reason: 'unsupported_type', type: task?.type || 'unknown' }
  }
  const now = Date.now()
  const elapsedMs = Math.max(0, Math.min(now - (Number(idle.last_active_at) || now), MAX_IDLE_MS))
  if (elapsedMs < MIN_IDLE_MS) return { claimed: false, reason: 'too_soon', elapsedMs }

  // Combat can kill the character. We never wipe via MCP, so One-Life accounts
  // are deferred to the game client where death is handled explicitly.
  if (task.type === 'combat' && (await isOneLifeCharacter(env, characterId))) {
    return { claimed: false, reason: 'one_life_combat' }
  }

  const { saveObject, saveRevision } = await loadCharacterWithSave(env, characterId, identityId)

  // Combat continues like skilling, but a simulated death clears the slot and
  // resets HP to max (rewards up to the killing blow are kept by the engine).
  if (task.type === 'combat') {
    const result = runCombatTask(saveObject, task, elapsedMs)
    if (!result.applied) return { claimed: false, reason: result.reason || 'no_progress', elapsedMs }
    await writeSave(env, characterId, saveObject, saveRevision)
    if (result.died) await clearIdleTask(env, characterId, now)
    else await resetIdleActiveAt(env, characterId, now)
    return { claimed: true, elapsedMs, ...result }
  }

  // Quests carry finite progress: apply completions, then persist the partial
  // task (clock reset) or clear it once the quest is finished.
  if (task.type === 'quest') {
    const result = applyQuestTask(saveObject, task, elapsedMs, now)
    await writeSave(env, characterId, saveObject, saveRevision)
    if (result.finalTask) await setIdleTask(env, characterId, JSON.stringify(result.finalTask), now)
    else await clearIdleTask(env, characterId, now)
    return { claimed: true, elapsedMs, ...result }
  }

  const result = runIdleTask(saveObject, task, elapsedMs)
  if (!result.applied) return { claimed: false, reason: result.reason || 'no_progress', elapsedMs }
  await writeSave(env, characterId, saveObject, saveRevision)
  await resetIdleActiveAt(env, characterId, now)
  return { claimed: true, elapsedMs, ...result }
}

// True if the character is a One-Life account (combat death = permanent wipe).
async function isOneLifeCharacter(env, characterId) {
  const row = await env.DB.prepare('SELECT is_one_life FROM characters WHERE id = ?').bind(characterId).first()
  return !!(row && (row.is_one_life === 1 || row.is_one_life === true))
}

// Parse the character's current idle task without mutating anything.
async function peekActiveTask(env, characterId) {
  const idle = await getIdleRow(env, characterId)
  if (!idle?.active_task) return null
  try { return JSON.parse(idle.active_task) } catch { return null }
}

// A quest occupies the single idle slot exclusively and carries finite
// progress, so refuse to start another activity over a running quest — it must
// be finished via claim_activity first (which clears the slot).
async function assertNoActiveQuest(env, characterId) {
  const task = await peekActiveTask(env, characterId)
  if (task?.type === 'quest') {
    throw new Error('A quest is in progress. Call claim_activity to finish and collect it before starting another activity.')
  }
}

const TOOLS = {
  async list_characters(_args, { env, authorization }) {
    const res = await callHandler(listCharacters, env, { authorization })
    if (!res.ok) throw httpError(res)
    return ok(res.data)
  },

  async get_account({ character_id }, { env, authorization }) {
    const res = await callHandler(getMe, env, { authorization, characterId: character_id })
    if (!res.ok) throw httpError(res)
    return ok(res.data)
  },

  async get_character_state({ character_id }, { env, authorization }) {
    const id = await resolveCharacterId(env, authorization, character_id)
    const res = await callHandler(getSave, env, { authorization, characterId: id })
    if (!res.ok) throw httpError(res)
    if (!res.data?.save?.save_data) return ok({ characterId: id, state: null, note: 'No save yet.' })
    const summary = summarizeSave(res.data.save.save_data)
    // Resolve item ids to names so the model doesn't need a separate lookup.
    summary.inventory = summary.inventory.map(withItemName)
    for (const [slot, item] of Object.entries(summary.equipment)) summary.equipment[slot] = withItemName(item)
    return ok({ characterId: id, savedAt: res.data.save.updatedAt, ...summary })
  },

  async inspect_item({ item_id }) {
    if (!item_id) throw new Error('item_id is required.')
    const item = getItem(item_id)
    if (!item) throw new Error(`No item with id '${item_id}'. Browse ids via pocketrpg://reference/items.`)
    return ok(item)
  },

  async inspect_monster({ monster_id }) {
    if (!monster_id) throw new Error('monster_id is required.')
    const monster = getMonster(monster_id)
    if (!monster) throw new Error(`No monster with id '${monster_id}'. Browse ids via pocketrpg://reference/monsters.`)
    return ok(monster)
  },

  async get_collection_log({ character_id }, { env, authorization }) {
    const id = await resolveCharacterId(env, authorization, character_id)
    const res = await callHandler(getCollectionLog, env, { authorization, characterId: id })
    if (!res.ok) throw httpError(res)
    return ok({ characterId: id, ...res.data })
  },

  async get_kill_counts({ character_id }, { env, authorization }) {
    const id = await resolveCharacterId(env, authorization, character_id)
    const res = await callHandler(getKillCounts, env, { authorization, characterId: id })
    if (!res.ok) throw httpError(res)
    return ok({ characterId: id, ...res.data })
  },

  async get_leaderboard({ metric, source_type, source_id, limit, offset }, { env }) {
    // Public endpoint — no token required.
    const res = await callHandler(getLeaderboard, env, { query: { metric, source_type, source_id, limit, offset } })
    if (!res.ok) throw httpError(res)
    return ok(res.data)
  },

  async buy_item({ item_id, quantity = 1, character_id }, { env, authorization }) {
    if (!item_id) throw new Error('item_id is required.')
    const id = await resolveCharacterId(env, authorization, character_id)
    const res = await callHandler(postPurchase, env, {
      method: 'POST',
      authorization,
      characterId: id,
      body: { item_id, quantity, unlocked_minigame_items: [] },
    })
    if (!res.ok) throw httpError(res)
    return ok({ characterId: id, item: itemName(item_id), ...res.data })
  },

  async skip_hour({ bossId, raidId, character_id }, { env, authorization }) {
    const id = await resolveCharacterId(env, authorization, character_id)
    const res = await callHandler(postSkipHour, env, {
      method: 'POST',
      authorization,
      characterId: id,
      body: { bossId, raidId },
    })
    if (!res.ok) throw httpError(res)

    // The endpoint only debits the credit; the time-advance is applied to the
    // running activity. For a plain 1-hour skip (no boss/raid), push the server
    // idle clock back an hour so the running idle task accrues the skipped time
    // on the next claim_activity. Boss/raid skips drive client-side combat and
    // have no claimable idle task to advance.
    let appliedToActivity = false
    if (!bossId && !raidId) {
      const idle = await getIdleRow(env, id)
      let task = null
      try { task = idle?.active_task ? JSON.parse(idle.active_task) : null } catch { task = null }
      if (isClaimableTask(task)) {
        await advanceIdleClock(env, id, SKIP_HOUR_MS)
        appliedToActivity = true
      }
    }

    return ok({
      characterId: id,
      ...res.data,
      skippedActivity: appliedToActivity
        ? { advancedByMs: SKIP_HOUR_MS, note: 'Idle activity advanced 1 hour — call claim_activity to collect it.' }
        : { advancedByMs: 0, note: 'No claimable idle activity to advance; the credit applies to client-side play (combat/farming).' },
    })
  },

  async skip_slayer_task({ character_id }, { env, authorization }) {
    const id = await resolveCharacterId(env, authorization, character_id)
    const res = await callHandler(postSlayerSkip, env, { method: 'POST', authorization, characterId: id })
    if (!res.ok) throw httpError(res)
    return ok({ characterId: id, ...res.data })
  },

  // ── Trading post (Phase B) ─────────────────────────────────────────────────

  async search_market({ item_ids }, { env, authorization }) {
    if (!Array.isArray(item_ids) || item_ids.length === 0) throw new Error('item_ids must be a non-empty array.')
    const res = await callHandler(postMarketSearch, env, { method: 'POST', authorization, body: { item_ids } })
    if (!res.ok) throw httpError(res)
    const market = {}
    for (const [id, summary] of Object.entries(res.data?.market || {})) market[id] = { name: itemName(id), ...summary }
    return ok({ market })
  },

  async my_offers({ character_id }, { env, authorization }) {
    const id = await resolveCharacterId(env, authorization, character_id)
    const res = await callHandler(getMyOffers, env, { authorization, characterId: id })
    if (!res.ok) throw httpError(res)
    const offers = (res.data?.offers || []).map((o) => ({ ...o, name: itemName(o.item_id) }))
    return ok({ characterId: id, maxSlots: res.data?.max_slots, offers })
  },

  async place_offer({ offer_type, item_id, price, quantity, character_id }, { env, authorization }) {
    const id = await resolveCharacterId(env, authorization, character_id)
    const res = await callHandler(postPlaceOffer, env, {
      method: 'POST',
      authorization,
      characterId: id,
      body: { offer_type, item_id, price, quantity },
    })
    if (!res.ok) throw httpError(res)
    return ok({ characterId: id, item: itemName(item_id), ...res.data })
  },

  async cancel_offer({ offer_id, character_id }, { env, authorization }) {
    const id = await resolveCharacterId(env, authorization, character_id)
    const res = await callHandler(postCancelOffer, env, { method: 'POST', authorization, characterId: id, body: { offer_id } })
    if (!res.ok) throw httpError(res)
    return ok({ characterId: id, ...res.data })
  },

  async collect_offer({ offer_id, character_id }, { env, authorization }) {
    const id = await resolveCharacterId(env, authorization, character_id)
    const res = await callHandler(postCollectOffer, env, { method: 'POST', authorization, characterId: id, body: { offer_id } })
    if (!res.ok) throw httpError(res)
    return ok({ characterId: id, ...res.data })
  },

  async instant_sell_offer({ offer_id, character_id }, { env, authorization }) {
    const id = await resolveCharacterId(env, authorization, character_id)
    const res = await callHandler(postInstantSell, env, { method: 'POST', authorization, characterId: id, body: { offer_id } })
    if (!res.ok) throw httpError(res)
    return ok({ characterId: id, ...res.data })
  },

  async sell_item({ item_id, quantity, character_id }, { env, authorization }) {
    if (!item_id) throw new Error('item_id is required.')
    const id = await resolveCharacterId(env, authorization, character_id)
    const res = await callHandler(postSellImmediate, env, {
      method: 'POST',
      authorization,
      characterId: id,
      body: { item_id, quantity },
    })
    if (!res.ok) throw httpError(res)
    return ok({ characterId: id, item: itemName(item_id), ...res.data })
  },

  // ── Bank & equipment management (Phase C) ──────────────────────────────────

  deposit_to_bank({ item_id, quantity, character_id }, ctx) {
    return applySaveIntent(ctx, character_id, (save) => depositToBank(save, item_id, quantity), 'mcp_deposit_to_bank')
  },

  withdraw_from_bank({ item_id, quantity, character_id }, ctx) {
    return applySaveIntent(ctx, character_id, (save) => withdrawFromBank(save, item_id, quantity), 'mcp_withdraw_from_bank')
  },

  equip_item({ item_id, character_id }, ctx) {
    return applySaveIntent(ctx, character_id, (save) => equip(save, item_id), 'mcp_equip_item')
  },

  unequip_item({ slot, character_id }, ctx) {
    return applySaveIntent(ctx, character_id, (save) => unequip(save, slot), 'mcp_unequip_item')
  },

  // ── Idle activities (Phase C increment 2) ──────────────────────────────────

  async get_active_activity({ character_id }, { env, authorization }) {
    const id = await resolveCharacterId(env, authorization, character_id)
    const idle = await getIdleRow(env, id)
    if (!idle || !idle.active_task) return ok({ characterId: id, active: null })
    let task = null
    try { task = JSON.parse(idle.active_task) } catch { /* leave null */ }
    const runningForSeconds = Math.floor(Math.max(0, Date.now() - (Number(idle.last_active_at) || Date.now())) / 1000)
    const active = task && (
      task.type === 'quest'
        ? {
            type: 'quest',
            quest: task.quest?.name || task.quest?.id || null,
            secondsRemaining: Math.max(0, Math.ceil(((Number(task.ticksRemaining) || 0) * 600) / 1000) - runningForSeconds),
          }
        : task.type === 'combat'
        ? { type: 'combat', monster: task.monster?.name || task.monster?.id || null, stance: task.stance || null }
        : {
            type: task.type,
            skill: task.skill || (task.type !== 'skill' ? task.type : null),
            action: task.action?.name || task.npc?.name || task.action?.id || null,
          }
    )
    return ok({
      characterId: id,
      active,
      runningForSeconds,
      claimableViaMcp: isClaimableTask(task),
    })
  },

  async start_skilling({ skill, action_id, character_id }, { env, authorization, identity }) {
    if (!identity?.id) throw new Error('Not authenticated.')
    const id = await resolveCharacterId(env, authorization, character_id)
    const lock = await assertNotInActiveMatch(env, id)
    if (lock) throw new Error('Blocked: the character is in an active PvP match.')
    await assertNoActiveQuest(env, id)

    // Bank any pending rewards from a current supported task before switching;
    // refuse if an unsupported activity (combat/gather/…) is mid-flight so we
    // never silently discard its progress.
    const autoClaimed = await claimIdleCore(env, id, identity.id)
    if (autoClaimed.reason === 'unsupported_type') {
      throw new Error(`An active ${autoClaimed.type} activity is in progress — claim it in the game client first.`)
    }
    if (autoClaimed.reason === 'one_life_combat') {
      throw new Error('One-Life combat is in progress — claim it in the game client, where death is handled.')
    }

    const { saveObject } = await loadCharacterWithSave(env, id, identity.id)
    const task = buildIdleTask(saveObject, skill, action_id) // validates skill/action/level
    const now = Date.now()
    await setIdleTask(env, id, JSON.stringify(task), now)
    await auditLog(env, 'mcp_start_skilling', { characterId: id, identityId: identity.id, skill, actionId: action_id }, { swallow: true })
    return ok({
      characterId: id,
      started: { skill, action: task.action?.name || task.npc?.name || action_id },
      autoClaimed: autoClaimed.claimed ? autoClaimed : undefined,
    })
  },

  async claim_activity({ character_id }, { env, authorization, identity }) {
    if (!identity?.id) throw new Error('Not authenticated.')
    const id = await resolveCharacterId(env, authorization, character_id)
    const lock = await assertNotInActiveMatch(env, id)
    if (lock) throw new Error('Blocked: the character is in an active PvP match.')
    const result = await claimIdleCore(env, id, identity.id)
    if (!result.claimed) {
      if (result.reason === 'unsupported_type') {
        return ok({ characterId: id, claimed: false, note: `The active ${result.type} activity must be claimed in the game client.` })
      }
      if (result.reason === 'one_life_combat') {
        return ok({ characterId: id, claimed: false, note: 'One-Life combat must be claimed in the game client, where death is handled.' })
      }
      return ok({ characterId: id, claimed: false, reason: result.reason })
    }
    await auditLog(env, 'mcp_claim_activity', { characterId: id, identityId: identity.id, elapsedMs: result.elapsedMs, skill: result.skill }, { swallow: true })
    return ok({ characterId: id, ...result })
  },

  // ── Quests (Phase C increment 4) ────────────────────────────────────────────

  async get_quests({ character_id }, { env, authorization }) {
    const id = await resolveCharacterId(env, authorization, character_id)
    const res = await callHandler(getSave, env, { authorization, characterId: id })
    if (!res.ok) throw httpError(res)
    const save = res.data?.save?.save_data
    const state = save ? (typeof save === 'string' ? JSON.parse(save) : save) : {}
    return ok({ characterId: id, ...questStatuses(state) })
  },

  async start_quest({ quest_id, xp_skill, character_id }, { env, authorization, identity }) {
    if (!identity?.id) throw new Error('Not authenticated.')
    if (!quest_id) throw new Error('quest_id is required.')
    const id = await resolveCharacterId(env, authorization, character_id)
    const lock = await assertNotInActiveMatch(env, id)
    if (lock) throw new Error('Blocked: the character is in an active PvP match.')
    await assertNoActiveQuest(env, id)

    // Bank/clear any pending supported skilling task first; refuse if an
    // unsupported activity is mid-flight so its progress isn't discarded.
    const autoClaimed = await claimIdleCore(env, id, identity.id)
    if (autoClaimed.reason === 'unsupported_type') {
      throw new Error(`An active ${autoClaimed.type} activity is in progress — claim it in the game client first.`)
    }
    if (autoClaimed.reason === 'one_life_combat') {
      throw new Error('One-Life combat is in progress — claim it in the game client, where death is handled.')
    }

    const { saveObject } = await loadCharacterWithSave(env, id, identity.id)
    const task = buildQuestTask(saveObject, quest_id, xp_skill) // validates eligibility + xp choice
    const now = Date.now()
    await setIdleTask(env, id, JSON.stringify(task), now)
    await auditLog(env, 'mcp_start_quest', { characterId: id, identityId: identity.id, questId: quest_id, xpSkill: xp_skill || null }, { swallow: true })
    return ok({
      characterId: id,
      started: { questId: task.quest.id, quest: task.quest.name, durationSeconds: task.quest.durationSeconds, xpSkill: task.xpChoiceSkill || undefined },
      note: 'Quest started — it completes after its duration of real time. Call claim_activity to collect rewards (skip_hour advances it an hour).',
      autoClaimed: autoClaimed.claimed ? autoClaimed : undefined,
    })
  },

  // ── Combat (Phase D increment 1) ────────────────────────────────────────────

  async start_fight({ monster_id, stance, character_id }, { env, authorization, identity }) {
    if (!identity?.id) throw new Error('Not authenticated.')
    if (!monster_id) throw new Error('monster_id is required.')
    const id = await resolveCharacterId(env, authorization, character_id)
    const lock = await assertNotInActiveMatch(env, id)
    if (lock) throw new Error('Blocked: the character is in an active PvP match.')
    if (await isOneLifeCharacter(env, id)) {
      throw new Error('Refused: One-Life characters can die permanently. Fight in the game client, where death is handled explicitly.')
    }
    await assertNoActiveQuest(env, id)

    const autoClaimed = await claimIdleCore(env, id, identity.id)
    if (autoClaimed.reason === 'unsupported_type') {
      throw new Error(`An active ${autoClaimed.type} activity is in progress — claim it in the game client first.`)
    }

    const { saveObject } = await loadCharacterWithSave(env, id, identity.id)
    const task = buildCombatTask(saveObject, monster_id, stance) // validates monster + stance
    const now = Date.now()
    await setIdleTask(env, id, JSON.stringify(task), now)
    await auditLog(env, 'mcp_start_fight', { characterId: id, identityId: identity.id, monsterId: monster_id, stance: task.stance }, { swallow: true })
    return ok({
      characterId: id,
      started: { monsterId: task.monster.id, monster: task.monster.name, combatLevel: task.monster.combatLevel ?? null, stance: task.stance },
      note: 'Combat started — XP and loot accrue over real time using your configured idle food/potions (set them in the game client). Call claim_activity to collect; skip_hour advances an hour.',
      autoClaimed: autoClaimed.claimed ? autoClaimed : undefined,
    })
  },
}

// ── Resources ────────────────────────────────────────────────────────────────

export const RESOURCE_LIST = REFERENCE_RESOURCES

export const RESOURCE_TEMPLATES = [
  {
    uriTemplate: 'pocketrpg://character/{character_id}/state',
    name: 'Character state',
    description: "A character's coins, skills, HP, equipment and inventory. Use 'me' for the sole character.",
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'pocketrpg://character/{character_id}/bank',
    name: 'Character bank',
    description: "A character's full bank contents (item ids, names and quantities).",
    mimeType: 'application/json',
  },
]

function parseBank(saveData) {
  const state = typeof saveData === 'string' ? JSON.parse(saveData) : (saveData || {})
  const raw = state.bank
  let entries = []
  if (Array.isArray(raw)) entries = raw
  else if (raw && typeof raw === 'object') {
    entries = Object.entries(raw).map(([k, v]) =>
      v && typeof v === 'object' ? { itemId: v.itemId ?? k, quantity: v.quantity ?? v.qty ?? 0 } : { itemId: k, quantity: v },
    )
  }
  return entries.map(withItemName)
}

// Read an MCP resource by uri. Reference uris are static; character uris fetch
// the live save through the bridge (auth forwarded).
export async function readResource(uri, { env, authorization }) {
  const ref = readReference(uri)
  if (ref) return { uri, mimeType: ref.mimeType, text: ref.text }

  const m = /^pocketrpg:\/\/character\/([^/]+)\/(state|bank)$/.exec(uri)
  if (m) {
    const provided = m[1] === 'me' ? undefined : Number(m[1])
    const id = await resolveCharacterId(env, authorization, provided)
    const res = await callHandler(getSave, env, { authorization, characterId: id })
    if (!res.ok) throw httpError(res)
    const save = res.data?.save?.save_data
    if (!save) return { uri, mimeType: 'application/json', text: JSON.stringify({ characterId: id, note: 'No save yet.' }) }
    if (m[2] === 'state') {
      const summary = summarizeSave(save)
      summary.inventory = summary.inventory.map(withItemName)
      for (const [slot, item] of Object.entries(summary.equipment)) summary.equipment[slot] = withItemName(item)
      return { uri, mimeType: 'application/json', text: JSON.stringify({ characterId: id, ...summary }, null, 2) }
    }
    return { uri, mimeType: 'application/json', text: JSON.stringify({ characterId: id, bank: parseBank(save) }, null, 2) }
  }

  throw new Error(`Unknown resource: ${uri}`)
}

// Dispatch a tools/call. Unknown tool names throw (surfaced as a JSON-RPC
// error); operational failures are returned as an isError tool result so the
// model can read and react to them.
export async function callTool(name, args, ctx) {
  const tool = TOOLS[name]
  if (!tool) throw new Error(`Unknown tool: ${name}`)
  try {
    return await tool(args || {}, ctx)
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err?.message || String(err)}` }], isError: true }
  }
}
