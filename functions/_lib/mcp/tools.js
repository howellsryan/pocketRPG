import { callHandler } from './bridge.js'
import { summarizeSave } from './summary.js'
import { getItem, getMonster, itemName, withItemName, REFERENCE_RESOURCES, readReference, listSkills, getSkillActions, searchItems, searchMonsters, REFERENCE_TOPICS } from './reference.js'
import { loadCharacterWithSave, writeSave } from '../game/save.js'
import { auditLog } from '../game/audit.js'
import { assertNotInActiveMatch } from '../pvp.js'
import { depositToBank, withdrawFromBank, equip, unequip, buildIdleTask, runIdleTask, isClaimableTask, buildGatherTask, buildQuestTask, applyQuestTask, questStatuses, buildCombatTask, runCombatTask, planDungeoneeringReward, setIdleCombatSetup, idleCombatSetupSummary, idleFoodWarning, addQuestToQueueIntent, removeQuestFromQueueIntent, dropFromQueue, assignSlayerTask, slayerStatus } from './intents.js'
import { getIdleRow, setIdleTask, resetIdleActiveAt, clearIdleTask, advanceIdleClock } from './idle.js'
import { SKIP_HOUR_MS } from '../../../src/engine/skipPreflight.js'
import { simulateBossFight, applyBossFightOutcome } from './bossFight.js'
import raidsData from '../../../src/data/raids.json' assert { type: 'json' }

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
import { onRequestGet as getListings } from '../../api/trading-post/listings.js'
import { onRequestPost as postPlaceOffer } from '../../api/trading-post/list.js'
import { onRequestPost as postCancelOffer } from '../../api/trading-post/cancel.js'
import { onRequestPost as postCollectOffer } from '../../api/trading-post/collect.js'
import { onRequestPost as postInstantSell } from '../../api/trading-post/instant-sell.js'
import { onRequestPost as postSellImmediate } from '../../api/trading-post/sell-immediate.js'
import { onRequestPost as completeMonster } from '../../api/actions/monster/complete.js'
import { onRequestPost as completeRaid } from '../../api/actions/raid/complete.js'
import { onRequestPost as completeDungeoneering } from '../../api/actions/dungeoneering/complete.js'

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

  // Account tokens are stateless and client-held, so the server can't revoke
  // them remotely — return the steps to disconnect/switch in the AI client.
  logout(_args, { identity }) {
    if (!identity?.id) throw new Error('Not authenticated.')
    return ok({
      account: { provider: identity.provider || null, displayName: identity.displayName || null },
      note: 'For security the MCP server cannot delete the access token your AI client stores, so logging out / switching accounts is done in your client (and browser). Follow the steps below.',
      disconnect: [
        "Open your AI client's connector settings (ChatGPT: Settings → Apps & Connectors; Claude: Settings → Connectors).",
        'Remove or disconnect the PocketRPG connector — that deletes the stored token from the client.',
      ],
      switchAccount: [
        'Disconnect PocketRPG as above, then add/reconnect it.',
        'At the PocketRPG sign-in window choose "Use a different account", sign in with the account you want, and approve.',
      ],
      tokenNote: 'Even if you do nothing, the current access expires on its own within 30 days.',
    })
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

  list_skill_actions({ skill }) {
    if (!skill) return ok({ skills: listSkills() })
    const data = getSkillActions(skill)
    if (!data) throw new Error(`No skill with id '${skill}'. Call list_skill_actions with no arguments to see the skill ids.`)
    return ok(data)
  },

  list_items({ query, type, limit }) {
    return ok(searchItems({ query, type, limit }))
  },

  list_monsters({ query, limit }) {
    return ok(searchMonsters({ query, limit }))
  },

  get_reference({ topic }) {
    const uri = REFERENCE_TOPICS[topic]
    if (!uri) throw new Error(`Unknown topic '${topic}'. Valid topics: ${Object.keys(REFERENCE_TOPICS).join(', ')}.`)
    const ref = readReference(uri)
    if (!ref) throw new Error(`No reference data for topic '${topic}'.`)
    return ok(ref.text)
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

  async get_slayer_task({ character_id }, { env, authorization }) {
    const id = await resolveCharacterId(env, authorization, character_id)
    const res = await callHandler(getSave, env, { authorization, characterId: id })
    if (!res.ok) throw httpError(res)
    const save = res.data?.save?.save_data
    const state = save ? (typeof save === 'string' ? JSON.parse(save) : save) : {}
    return ok({ characterId: id, ...slayerStatus(state) })
  },

  assign_slayer_task({ master_id, character_id }, ctx) {
    if (!master_id) throw new Error('master_id is required.')
    return applySaveIntent(ctx, character_id, (save) => assignSlayerTask(save, master_id), 'mcp_assign_slayer_task')
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

  async list_market_listings(_args, { env, authorization }) {
    const res = await callHandler(getListings, env, { method: 'GET', authorization })
    if (!res.ok) throw httpError(res)
    const listings = (res.data?.listings || []).map((l) => ({ ...l, name: itemName(l.item_id) }))
    return ok({ listings })
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
        : task.type === 'gather'
        ? { type: 'gather', taskId: task.gatherTask?.id || null, task: task.gatherTask?.name || null }
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

  async start_gather({ task_id, character_id }, { env, authorization, identity }) {
    if (!identity?.id) throw new Error('Not authenticated.')
    if (!task_id) throw new Error('task_id is required.')
    const id = await resolveCharacterId(env, authorization, character_id)
    const lock = await assertNotInActiveMatch(env, id)
    if (lock) throw new Error('Blocked: the character is in an active PvP match.')
    await assertNoActiveQuest(env, id)

    const autoClaimed = await claimIdleCore(env, id, identity.id)
    if (autoClaimed.reason === 'unsupported_type') {
      throw new Error(`An active ${autoClaimed.type} activity is in progress — claim it in the game client first.`)
    }
    if (autoClaimed.reason === 'one_life_combat') {
      throw new Error('One-Life combat is in progress — claim it in the game client, where death is handled.')
    }

    const { saveObject } = await loadCharacterWithSave(env, id, identity.id)
    const task = buildGatherTask(saveObject, task_id)
    const now = Date.now()
    await setIdleTask(env, id, JSON.stringify(task), now)
    await auditLog(env, 'mcp_start_gather', { characterId: id, identityId: identity.id, taskId: task_id }, { swallow: true })
    return ok({
      characterId: id,
      started: { taskId: task.gatherTask.id, task: task.gatherTask.name },
      note: 'Gather task started — items accrue over real time. Call claim_activity to collect them.',
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

    const { saveObject, saveRevision } = await loadCharacterWithSave(env, id, identity.id)
    const task = buildQuestTask(saveObject, quest_id, xp_skill) // validates eligibility + xp choice
    // A started quest must not also sit in the queue (it would re-complete).
    if (dropFromQueue(saveObject, quest_id)) await writeSave(env, id, saveObject, saveRevision)
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

  // ── Quest queue ─────────────────────────────────────────────────────────────

  async queue_quest({ quest_id, xp_skill, character_id }, ctx) {
    const { env, authorization } = ctx
    if (!quest_id) throw new Error('quest_id is required.')
    const id = await resolveCharacterId(env, authorization, character_id)
    // Never queue the quest that's already running in the idle slot.
    const activeTask = await peekActiveTask(env, id)
    const activeQuestId = activeTask?.type === 'quest' ? (activeTask.quest?.id || null) : null
    return applySaveIntent(ctx, id, (save) => addQuestToQueueIntent(save, quest_id, xp_skill, activeQuestId), 'mcp_queue_quest')
  },

  remove_from_queue({ quest_id, character_id }, ctx) {
    if (!quest_id) throw new Error('quest_id is required.')
    return applySaveIntent(ctx, character_id, (save) => removeQuestFromQueueIntent(save, quest_id), 'mcp_remove_from_queue')
  },

  // ── Idle combat setup (food / potions / prayers) ────────────────────────────

  async get_idle_combat_setup({ character_id }, { env, authorization, identity }) {
    if (!identity?.id) throw new Error('Not authenticated.')
    const id = await resolveCharacterId(env, authorization, character_id)
    const { saveObject } = await loadCharacterWithSave(env, id, identity.id)
    return ok({ characterId: id, ...idleCombatSetupSummary(saveObject) })
  },

  set_idle_combat_setup({ food, potions, protection_prayer, combat_prayer, character_id }, ctx) {
    return applySaveIntent(
      ctx,
      character_id,
      (save) => setIdleCombatSetup(save, {
        food,
        potions,
        protectionPrayerId: protection_prayer,
        combatPrayerId: combat_prayer,
      }),
      'mcp_set_idle_combat_setup',
    )
  },

  // ── Combat (Phase D increment 1) ────────────────────────────────────────────

  async start_fight({ monster_id, stance, confirm_no_food, character_id }, { env, authorization, identity }) {
    if (!identity?.id) throw new Error('Not authenticated.')
    if (!monster_id) throw new Error('monster_id is required.')
    const id = await resolveCharacterId(env, authorization, character_id)
    const lock = await assertNotInActiveMatch(env, id)
    if (lock) throw new Error('Blocked: the character is in an active PvP match.')
    if (await isOneLifeCharacter(env, id)) {
      throw new Error('Refused: One-Life characters can die permanently. Fight in the game client, where death is handled explicitly.')
    }
    await assertNoActiveQuest(env, id)

    // Pre-flight the idle food. Fighting with no healing risks losing the
    // character's HP (and progress on death), so unless the caller confirms,
    // surface a warning and don't start — let the player decide.
    const { saveObject } = await loadCharacterWithSave(env, id, identity.id)
    const foodWarning = idleFoodWarning(saveObject)
    if (foodWarning && !confirm_no_food) {
      return ok({
        characterId: id,
        started: false,
        warning: foodWarning,
        hint: 'Set up healing with set_idle_combat_setup, or call start_fight again with confirm_no_food: true to fight without food.',
      })
    }

    const autoClaimed = await claimIdleCore(env, id, identity.id)
    if (autoClaimed.reason === 'unsupported_type') {
      throw new Error(`An active ${autoClaimed.type} activity is in progress — claim it in the game client first.`)
    }

    // claimIdleCore may have mutated/persisted the save (a prior task); reload so
    // the combat task is built from the post-claim state.
    const { saveObject: freshSave } = await loadCharacterWithSave(env, id, identity.id)
    const task = buildCombatTask(freshSave, monster_id, stance) // validates monster + stance
    const now = Date.now()
    await setIdleTask(env, id, JSON.stringify(task), now)
    await auditLog(env, 'mcp_start_fight', { characterId: id, identityId: identity.id, monsterId: monster_id, stance: task.stance, noFood: !!foodWarning }, { swallow: true })
    return ok({
      characterId: id,
      started: { monsterId: task.monster.id, monster: task.monster.name, combatLevel: task.monster.combatLevel ?? null, stance: task.stance },
      warning: foodWarning || undefined,
      note: 'Combat started — XP and loot accrue over real time using the configured idle food/potions/prayers (set them with set_idle_combat_setup). Call claim_activity to collect; skip_hour advances an hour.',
      autoClaimed: autoClaimed.claimed ? autoClaimed : undefined,
    })
  },

  // Kill a boss by spending its skip cost in credits (the in-game instant-kill
  // skip), then grant the server-rolled loot, kill count and collection-log
  // entries through the normal completion endpoint.
  async kill_boss({ monster_id, character_id }, { env, authorization, identity }) {
    if (!identity?.id) throw new Error('Not authenticated.')
    if (!monster_id) throw new Error('monster_id is required.')
    const id = await resolveCharacterId(env, authorization, character_id)
    const lock = await assertNotInActiveMatch(env, id)
    if (lock) throw new Error('Blocked: the character is in an active PvP match.')
    const monster = getMonster(monster_id)
    if (!monster) throw new Error(`No monster with id '${monster_id}'. Browse ids via pocketrpg://reference/monsters.`)
    if (monster.boss !== true) throw new Error(`${monster.name || monster_id} is not a boss — use start_fight for normal monsters.`)

    const skip = await callHandler(postSkipHour, env, { method: 'POST', authorization, characterId: id, body: { bossId: monster_id } })
    if (!skip.ok) throw httpError(skip)
    const res = await callHandler(completeMonster, env, {
      method: 'POST', authorization, characterId: id,
      body: { sourceId: monster_id, actionNonce: `mcp:monster:${monster_id}:${Date.now()}` },
    })
    if (!res.ok) throw httpError(res)
    return ok({
      characterId: id,
      killed: monster.name || monster_id,
      creditsSpent: skip.data?.cost,
      creditsRemaining: skip.data?.credits_remaining,
      granted: (res.data?.granted || []).map((g) => ({ ...g, name: itemName(g.itemId) })),
      killCount: res.data?.killCount,
      collectionLogEntries: res.data?.collectionLogEntries || [],
    })
  },

  // Fight a boss for real — simulate the whole fight over the combat engine
  // (no credits). A win is granted through the normal completion endpoint; a
  // loss/death grants nothing. The sim is conservative (no prayers/potions/
  // specials), so a win is always genuinely achievable.
  async fight_boss({ monster_id, character_id }, { env, authorization, identity }) {
    if (!identity?.id) throw new Error('Not authenticated.')
    if (!monster_id) throw new Error('monster_id is required.')
    const id = await resolveCharacterId(env, authorization, character_id)
    const lock = await assertNotInActiveMatch(env, id)
    if (lock) throw new Error('Blocked: the character is in an active PvP match.')
    if (await isOneLifeCharacter(env, id)) {
      throw new Error('Refused: One-Life characters fight bosses in the game client, where death is permanent.')
    }
    const monster = getMonster(monster_id)
    if (!monster) throw new Error(`No monster with id '${monster_id}'. Browse ids via pocketrpg://reference/monsters.`)
    if (monster.boss !== true) throw new Error(`${monster.name || monster_id} is not a boss — use start_fight for normal monsters.`)

    const { saveObject, saveRevision } = await loadCharacterWithSave(env, id, identity.id)
    const outcome = simulateBossFight(saveObject, monster) // throws for magic setups
    applyBossFightOutcome(saveObject, outcome)
    await writeSave(env, id, saveObject, saveRevision)
    await auditLog(env, 'mcp_fight_boss', { characterId: id, identityId: identity.id, monsterId: monster_id, victory: outcome.victory, died: outcome.died, ticks: outcome.ticks }, { swallow: true })

    const foodUsed = Object.entries(outcome.foodConsumed).map(([itemId, quantity]) => ({ itemId, name: itemName(itemId), quantity }))
    if (!outcome.victory) {
      return ok({
        characterId: id,
        killed: false,
        died: outcome.died,
        monster: monster.name || monster_id,
        ticks: outcome.ticks,
        finalHP: outcome.finalHP,
        foodUsed,
        reason: outcome.died
          ? 'You died before defeating the boss — bring more/better food or stronger gear.'
          : 'Could not out-damage the boss; improve gear before trying again.',
      })
    }

    // Victory — grant the server-rolled loot, kill count and collection log.
    const res = await callHandler(completeMonster, env, {
      method: 'POST', authorization, characterId: id,
      body: { sourceId: monster_id, actionNonce: `mcp:fight:${monster_id}:${Date.now()}` },
    })
    if (!res.ok) throw httpError(res)
    return ok({
      characterId: id,
      killed: true,
      monster: monster.name || monster_id,
      ticks: outcome.ticks,
      finalHP: outcome.finalHP,
      foodUsed,
      granted: (res.data?.granted || []).map((g) => ({ ...g, name: itemName(g.itemId) })),
      killCount: res.data?.killCount,
      collectionLogEntries: res.data?.collectionLogEntries || [],
    })
  },

  // Clear a raid by spending its skip cost in credits, then grant the
  // server-rolled raid loot, kill count and collection-log entries.
  async kill_raid({ raid_id, character_id }, { env, authorization, identity }) {
    if (!identity?.id) throw new Error('Not authenticated.')
    if (!raid_id) throw new Error('raid_id is required.')
    const raid = raidsData[raid_id]
    if (!raid) throw new Error(`No raid with id '${raid_id}'. Browse ids via pocketrpg://reference/raids.`)
    const id = await resolveCharacterId(env, authorization, character_id)
    const lock = await assertNotInActiveMatch(env, id)
    if (lock) throw new Error('Blocked: the character is in an active PvP match.')

    const skip = await callHandler(postSkipHour, env, { method: 'POST', authorization, characterId: id, body: { raidId: raid_id } })
    if (!skip.ok) throw httpError(skip)
    const res = await callHandler(completeRaid, env, {
      method: 'POST', authorization, characterId: id,
      body: { sourceId: raid_id, actionNonce: `mcp:raid:${raid_id}:${Date.now()}` },
    })
    if (!res.ok) throw httpError(res)
    return ok({
      characterId: id,
      cleared: raid.name || raid_id,
      creditsSpent: skip.data?.cost,
      creditsRemaining: skip.data?.credits_remaining,
      granted: (res.data?.granted || []).map((g) => ({ ...g, name: itemName(g.itemId) })),
      killCount: res.data?.killCount,
      collectionLogEntries: res.data?.collectionLogEntries || [],
    })
  },

  // Spend dungeoneering tokens to unlock a piece of dungeoneering gear. Tokens
  // are earned by training dungeoneering (start_skilling skill='dungeoneering').
  async claim_dungeoneering_reward({ action_id, character_id }, { env, authorization, identity }) {
    if (!identity?.id) throw new Error('Not authenticated.')
    if (!action_id) throw new Error('action_id is required.')
    const id = await resolveCharacterId(env, authorization, character_id)
    const saveRes = await callHandler(getSave, env, { authorization, characterId: id })
    if (!saveRes.ok) throw httpError(saveRes)
    const raw = saveRes.data?.save?.save_data
    const state = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {}
    const plan = planDungeoneeringReward(state, action_id) // validates level + token affordability

    const res = await callHandler(completeDungeoneering, env, {
      method: 'POST', authorization, characterId: id,
      body: {
        sourceId: 'dungeoneering',
        actionNonce: `mcp:dng:${action_id}:${Date.now()}`,
        rewards: [{ itemId: plan.product, quantity: plan.productQty }],
        dungeoneeringTokens: -plan.cost,
      },
    })
    if (!res.ok) throw httpError(res)
    return ok({
      characterId: id,
      unlocked: { itemId: plan.product, name: itemName(plan.product), quantity: plan.productQty },
      tokensSpent: plan.cost,
      granted: (res.data?.granted || []).map((g) => ({ ...g, name: itemName(g.itemId) })),
      collectionLogEntries: res.data?.collectionLogEntries || [],
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
