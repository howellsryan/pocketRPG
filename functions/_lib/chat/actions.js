// Confirmation gate for chatbot write actions. The chatbot may call the MCP
// write tools, but never runs one directly: the endpoint captures the model's
// write call, signs it into a short-lived token (reusing JWT_SECRET), and only
// executes it once the player confirms and the token is verified back. This
// keeps "every write needs a confirmation" a structural guarantee, not a prompt.

import { signJWT, verifyJWT } from '../jwt.js'
import { TOOL_SCHEMAS } from '../mcp/schema.js'
import { getItem, getMonster, getSkillActions } from '../mcp/reference.js'
import monstersData from '../../../src/data/monsters.json' assert { type: 'json' }
import raidsData from '../../../src/data/raids.json' assert { type: 'json' }

// State-mutating tools, derived from schema annotations so the set stays in
// lockstep as MCP tools are added (readOnlyHint:false === a write).
export const CHAT_WRITE_TOOLS = new Set(
  TOOL_SCHEMAS.filter((t) => t?.annotations?.readOnlyHint === false).map((t) => t.name),
)

export function isWriteTool(name) {
  return CHAT_WRITE_TOOLS.has(name)
}

// Short window: a confirmation the player doesn't act on quickly should expire
// rather than linger as a live, executable action.
const ACTION_TTL_SECONDS = 600

// Tool-result text the model sees in place of a write's real result: the action
// was NOT performed and needs the player's confirmation. Steers the model to
// describe the action (with its cost) and ask, instead of reporting success.
export const PENDING_CONFIRMATION_NOTE =
  'PENDING_CONFIRMATION: this action was NOT performed. It needs the player to confirm first. ' +
  'In your reply, tell the player exactly what you will do — including any coins, credits or slayer ' +
  'points it will cost and the items/quantities involved — and ask them to confirm. Do not say it is done.'

// A second write in the same turn: only one action is confirmed at a time.
export const SECONDARY_WRITE_NOTE =
  'Not performed: only one action can be confirmed at a time. Handle this one after the first is confirmed.'

const ACTION_TITLES = Object.fromEntries(TOOL_SCHEMAS.map((t) => [t.name, t?.annotations?.title || t.name]))

function prettyId(id) {
  return String(id)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

// Short label for the Confirm button / action chip. Cosmetic — the model's
// prose carries the real detail; correctness comes from the signed token.
export function actionLabel(tool, args = {}) {
  const title = ACTION_TITLES[tool] || prettyId(tool)
  const subject =
    args.item_id ||
    args.monster_id ||
    args.raid_id ||
    args.boss_id ||
    args.seed_id ||
    args.quest_id ||
    args.unlock_id ||
    args.master_id ||
    args.perk_id ||
    args.action_id ||
    args.minigame_task_id ||
    args.task_id ||
    args.slot ||
    args.username ||
    null
  if (!subject) return title
  const qty = Number(args.quantity)
  return qty > 1 ? `${title}: ${qty} × ${prettyId(subject)}` : `${title}: ${prettyId(subject)}`
}

// Flat credit fee charged for running ANY chatbot write action, on top of
// whatever the underlying action spends itself. One fee per confirmed action,
// however many game-state updates that action performs.
export const CHAT_ACTION_FEE = 1

function skipCostFor(id, table) {
  const cost = table?.[id]?.skipCost
  return Number.isFinite(cost) && cost > 0 ? Math.floor(cost) : 1
}

// Credits the underlying action spends server-side beyond the assistant fee —
// i.e. skip-based actions that debit credits in their own endpoint. Surfaced in
// the confirm prompt so the player sees the true total before approving.
export function actionSkipCost(tool, args = {}) {
  switch (tool) {
    case 'kill_boss':
      return skipCostFor(args.monster_id, monstersData)
    case 'kill_raid':
      return skipCostFor(args.raid_id, raidsData)
    case 'skip_slayer_task':
      return 1
    case 'skip_hour':
      if (args.raid_id) return skipCostFor(args.raid_id, raidsData)
      if (args.boss_id) return skipCostFor(args.boss_id, monstersData)
      return 1
    default:
      return 0
  }
}

// Full credit breakdown for a proposed action: the flat assistant fee plus any
// credits the action's own skip spends.
export function actionCreditCost(tool, args = {}) {
  const skip = actionSkipCost(tool, args)
  return { fee: CHAT_ACTION_FEE, skip, total: CHAT_ACTION_FEE + skip }
}

// Recursively collect string `id` values from a reference payload (skill
// actions come back as nested actions/courses/npcs), robust to shape.
function collectIds(node, acc) {
  if (Array.isArray(node)) {
    for (const n of node) collectIds(n, acc)
  } else if (node && typeof node === 'object') {
    if (typeof node.id === 'string') acc.add(node.id)
    for (const v of Object.values(node)) collectIds(v, acc)
  }
  return acc
}

// Best-effort propose-time validation of a write's id arguments against the
// static game catalogs, so an obviously-invalid action (a hallucinated id like
// a non-existent thieving option) is caught and fed back to the model to fix
// BEFORE it ever becomes a confirmable, credit-charged action. Returns an error
// string, or null when the args look valid / can't be checked here. Ids that
// depend on the save (patch_id, offer_id, slayer master eligibility, …) are left
// for execution-time validation, which refunds the fee on failure.
export function validateWriteArgs(tool, args = {}) {
  const item = (id) => (!id || getItem(id) ? null : `PocketRPG has no item with id '${id}'. Look it up with list_items first — don't invent ids.`)
  const monster = (id) => (!id || getMonster(id) ? null : `PocketRPG has no monster with id '${id}'. Look it up with list_monsters first — don't invent ids.`)
  switch (tool) {
    case 'buy_item':
    case 'sell_item':
    case 'deposit_to_bank':
    case 'withdraw_from_bank':
    case 'equip_item':
      return item(args.item_id)
    case 'plant_seed':
      return item(args.seed_id)
    case 'cast_magic':
      return item(args.target_item_id)
    case 'start_fight':
    case 'kill_boss':
    case 'fight_boss':
      return monster(args.monster_id)
    case 'kill_raid':
      return args.raid_id && !raidsData[args.raid_id]
        ? `PocketRPG has no raid with id '${args.raid_id}'. Check get_reference topic='raids' for valid ids.`
        : null
    case 'start_skilling': {
      if (!args.skill || !args.action_id) return null
      const data = getSkillActions(args.skill)
      if (!data) return `'${args.skill}' isn't a valid skill. Call list_skill_actions to see the skills.`
      const ids = collectIds(data, new Set())
      if (ids.size && !ids.has(args.action_id)) {
        return `'${args.action_id}' isn't a valid ${args.skill} action in PocketRPG. Call list_skill_actions skill='${args.skill}' for the valid action ids, then use one of those.`
      }
      return null
    }
    default:
      return null
  }
}

// Sign a pending write so only an action the model actually proposed (for this
// character) can later be executed. character_id is pinned into the payload.
// `question` (the player's original ask) is optional and carried along so a
// multi-step ask ("skip this task and get me a new one") can continue with
// its next step right after this one is confirmed — see confirmAction in
// api/chat.js.
export function signPendingAction({ tool, args, characterId, question }, secret) {
  return signJWT({ kind: 'chat_action', tool, args, characterId, ...(question ? { question } : {}) }, secret, ACTION_TTL_SECONDS)
}

// Verify a confirmation token: valid signature, not expired, the right kind, a
// known write tool, and bound to the character making the request. Returns the
// payload ({ tool, args, characterId }) or null.
export async function verifyPendingAction(token, secret, characterId) {
  const payload = await verifyJWT(token, secret)
  if (!payload || payload.kind !== 'chat_action') return null
  if (!payload.tool || !CHAT_WRITE_TOOLS.has(payload.tool)) return null
  if (Number(payload.characterId) !== Number(characterId)) return null
  return payload
}
