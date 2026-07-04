// Confirmation gate for chatbot write actions. The chatbot may call the MCP
// write tools, but never runs one directly: the endpoint captures the model's
// write call, signs it into a short-lived token (reusing JWT_SECRET), and only
// executes it once the player confirms and the token is verified back. This
// keeps "every write needs a confirmation" a structural guarantee, not a prompt.

import { signJWT, verifyJWT } from '../jwt.js'
import { TOOL_SCHEMAS } from '../mcp/schema.js'

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

// Sign a pending write so only an action the model actually proposed (for this
// character) can later be executed. character_id is pinned into the payload.
export function signPendingAction({ tool, args, characterId }, secret) {
  return signJWT({ kind: 'chat_action', tool, args, characterId }, secret, ACTION_TTL_SECONDS)
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
