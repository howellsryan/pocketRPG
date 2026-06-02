import { callHandler } from './bridge.js'
import { summarizeSave } from './summary.js'

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

function ok(payload) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)
  return { content: [{ type: 'text', text }] }
}

function httpError(res) {
  if (res.status === 401) {
    return new Error(
      'Not authenticated. Paste your PocketRPG access token as the connector bearer token (get it in-game: Home → API Access).',
    )
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
    return ok({ characterId: id, savedAt: res.data.save.updatedAt, ...summarizeSave(res.data.save.save_data) })
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
    return ok({ characterId: id, ...res.data })
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
    return ok({ characterId: id, ...res.data })
  },

  async skip_slayer_task({ character_id }, { env, authorization }) {
    const id = await resolveCharacterId(env, authorization, character_id)
    const res = await callHandler(postSlayerSkip, env, { method: 'POST', authorization, characterId: id })
    if (!res.ok) throw httpError(res)
    return ok({ characterId: id, ...res.data })
  },
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
