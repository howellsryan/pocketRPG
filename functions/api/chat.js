// In-game help chatbot endpoint. Answers PocketRPG questions AND performs
// actions (MCP write tools) on the player's behalf — but every write is gated:
// the model's write call is captured, never run inline, and executed only after
// the player confirms and the signed action token is verified back (see
// _lib/chat/actions.js). OpenAI is the primary model; Gemini and the Workers AI
// model are paid fallbacks reached only when OpenAI runs out/fails. Every AI
// path is metered against a daily spend budget, degrading to retrieval-only.

import { requireAuth, json } from '../_lib/auth.js'
import { utcDayKey, nextResetMs } from '../_lib/game/dailyTasks.js'
import { auditLog } from '../_lib/game/audit.js'
import { callTool } from '../_lib/mcp/tools.js'
import { KNOWLEDGE_CHUNKS } from '../_lib/chat/knowledge.js'
import { buildIndex, conversationContextTerms, searchKnowledge } from '../_lib/chat/retrieval.js'
import {
  claimCharacterMessage,
  refundCharacterMessage,
  resetCharacterMessages,
  reserveMessageNeurons,
  settleMessageNeurons,
  usageMilliNeurons,
  openaiPoolKey,
  geminiPoolKey,
  CHAT_DAILY_LIMIT,
  CHAT_REFILL_CREDITS,
  CHAT_MESSAGE_RESERVE_MILLI,
  CHAT_NEURON_BUDGET_MILLI,
  CHAT_OPENAI_MESSAGE_RESERVE_TOKENS,
  CHAT_OPENAI_TOKEN_BUDGET,
  CHAT_GEMINI_MESSAGE_RESERVE_TOKENS,
  CHAT_GEMINI_TOKEN_BUDGET,
} from '../_lib/chat/quota.js'
import {
  isWriteTool,
  validateWriteArgs,
  signPendingAction,
  verifyPendingAction,
  actionLabel,
  actionCreditCost,
  CHAT_ACTION_FEE,
  isChatActionFeeEnabled,
  PENDING_CONFIRMATION_NOTE,
  SECONDARY_WRITE_NOTE,
} from '../_lib/chat/actions.js'
import {
  CHAT_CONTEXT_CHUNKS,
  CHAT_MODEL,
  CHAT_OPENAI_MAX_OUTPUT_TOKENS,
  CHAT_OPENAI_MODEL,
  CHAT_FALLBACK_MODEL,
  CHAT_OPENAI_REASONING_EFFORT,
  CHAT_MAX_TOOL_ROUNDS,
  CHAT_MAX_ANSWER_TOKENS,
  CHAT_MAX_TOOL_RESULT_CHARS,
  CHAT_MAX_QUESTION_CHARS,
  CHAT_TIME_BUDGET_MS,
  CHAT_TOOL_ALLOWLIST,
  ALWAYS_ON_TOOL_NAMES,
  SEARCH_TOOL_NAME,
  SEARCH_TOOLS_DEF,
  searchToolsByQuery,
  buildSystemPrompt,
  chatToolDefs,
  buildMessages,
  retrievalOnlyAnswer,
} from '../_lib/chat/prompt.js'

// Preface for the post-confirmation summary call: the action already ran, so the
// model must report the outcome, not propose it again.
const ACTION_RESULT_PREFACE =
  'The player confirmed and this PocketRPG action just ran on their account. Tell them what happened in 1-2 friendly sentences using the result below. If it reports an error, explain it plainly and suggest a fix. Do not invent anything beyond the result, and do not ask for confirmation again.'

// Preface used instead of ACTION_RESULT_PREFACE when the original ask is known
// (multi-step requests like "skip this task and get me a new one"): lets the
// model continue with the next step, same confirm gate as any other write.
const ACTION_CHAIN_PREFACE =
  'The player confirmed and this PocketRPG action just ran on their account — see the result below. Tell them what ' +
  'happened in 1 short sentence. Then look at what they originally asked (below): if there is more left to do from ' +
  "that request, call the right tool for it now — it will be held for the player's confirmation, exactly like the " +
  "action that just ran, not executed immediately. If their original request is now fully handled, just say so. " +
  'Do not invent extra steps beyond what they asked for.'

let knowledgeIndex = null
function getIndex() {
  if (!knowledgeIndex) knowledgeIndex = buildIndex(KNOWLEDGE_CHUNKS)
  return knowledgeIndex
}

function parseToolArgs(raw) {
  if (raw && typeof raw === 'object') return { ...raw }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
  return {}
}

function toolResultText(result) {
  const text = (result?.content || [])
    .map((c) => (typeof c?.text === 'string' ? c.text : ''))
    .join('\n')
    .trim()
  const clipped = text.slice(0, CHAT_MAX_TOOL_RESULT_CHARS)
  return result?.isError ? `Tool error: ${clipped || 'unknown error'}` : clipped || '(empty result)'
}

const CHAT_RUN_OPTS = {
  max_tokens: CHAT_MAX_ANSWER_TOKENS,
  temperature: 0.6,
}

// Gemini-backed binding with the same `run(model, payload)` shape as env.AI,
// via Google's OpenAI-compatible endpoint — the chat-completions plumbing
// (messages/tools/usage) works unchanged.
export function geminiChatBinding(env) {
  return {
    async run(model, payload) {
      const body = JSON.stringify({ model, ...payload })
      // Free-tier Gemini is limited per minute, not per day, so a 429/503 is
      // usually a brief burst. Retry a couple of times with a short backoff
      // (kept small to stay inside the request time budget) before giving up and
      // letting the endpoint fall through to the Workers AI fallback.
      const backoffs = [500, 1200]
      for (let attempt = 0; ; attempt++) {
        const res = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${env.GEMINI_API_KEY}`,
          },
          body,
        })
        if (res.ok) return res.json()
        if ((res.status === 429 || res.status === 503) && attempt < backoffs.length) {
          await new Promise((resolve) => setTimeout(resolve, backoffs[attempt]))
          continue
        }
        const detail = (await res.text().catch(() => '')).slice(0, 300)
        throw new Error(`Gemini ${res.status}: ${detail}`)
      }
    },
  }
}

// Chat-completions `messages` -> Responses API `input` items. Assistant tool
// calls and tool results are distinct item types there (`function_call` /
// `function_call_output`), not message roles.
function toResponsesInput(messages) {
  const input = []
  for (const m of messages) {
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      if (m.content) input.push({ role: 'assistant', content: m.content })
      for (const call of m.tool_calls) {
        input.push({ type: 'function_call', call_id: call.id, name: call.function.name, arguments: call.function.arguments })
      }
    } else if (m.role === 'tool') {
      input.push({ type: 'function_call_output', call_id: m.tool_call_id, output: m.content })
    } else {
      input.push({ role: m.role, content: m.content })
    }
  }
  return input
}

// Chat-completions `tools` (nested `{type:'function', function:{...}}`) ->
// Responses API's flat `{type:'function', name, description, parameters}`.
function toResponsesTools(tools) {
  return tools.map((t) => ({ type: 'function', name: t.function.name, description: t.function.description, parameters: t.function.parameters }))
}

// Responses API `output` -> a chat-completions-shaped result, so the rest of
// this file (answerText, the tool loop, trackUsage) doesn't need to know
// OpenAI is on a different endpoint than Gemini/Workers AI.
function fromResponsesOutput(res) {
  const output = Array.isArray(res?.output) ? res.output : []
  const content =
    output
      .filter((item) => item.type === 'message')
      .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
      .filter((c) => c.type === 'output_text')
      .map((c) => c.text)
      .join('') || null
  const toolCalls = output
    .filter((item) => item.type === 'function_call')
    .map((item) => ({ id: item.call_id, type: 'function', function: { name: item.name, arguments: item.arguments } }))
  const usage = res?.usage
    ? { prompt_tokens: res.usage.input_tokens, completion_tokens: res.usage.output_tokens }
    : undefined
  return { choices: [{ message: { role: 'assistant', content, tool_calls: toolCalls.length ? toolCalls : undefined } }], usage }
}

// OpenAI-backed binding with the same `run(model, payload)` shape as env.AI.
// Reasoning models 400 on function tools + reasoning_effort via
// /v1/chat/completions ("Please use /v1/responses instead"), so this talks to
// the Responses API and translates to/from the chat-completions shape shared
// with the Gemini/Workers AI bindings.
export function openaiChatBinding(env) {
  return {
    async run(model, payload) {
      const { messages, tools, max_tokens } = payload
      const body = {
        model,
        input: toResponsesInput(messages),
        reasoning: { effort: CHAT_OPENAI_REASONING_EFFORT },
      }
      if (tools) body.tools = toResponsesTools(tools)
      // Deliberately not the payload's max_tokens: that caps the visible answer
      // for every provider, while max_output_tokens also has to fund this
      // model's reasoning (see CHAT_OPENAI_MAX_OUTPUT_TOKENS).
      if (max_tokens !== undefined) body.max_output_tokens = CHAT_OPENAI_MAX_OUTPUT_TOKENS
      const res = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 300)
        throw new Error(`OpenAI ${res.status}: ${detail}`)
      }
      return fromResponsesOutput(await res.json())
    },
  }
}

// Ordered AI attempts for a message: OpenAI is the primary (tried first when
// configured); the free Workers AI model (CHAT_FALLBACK_MODEL) is the first
// failover; paid Gemini (CHAT_MODEL) is the last resort. Each later attempt is
// only reached when the earlier ones are unconfigured or fail/answer empty/run
// out of budget. Empty = AI path unavailable, straight to retrieval-only.
// `pool` is the daily spend budget the attempt meters against.
export function chatAttempts(env) {
  const attempts = []
  // Primary: OpenAI.
  if (env.OPENAI_API_KEY && CHAT_OPENAI_MODEL) {
    attempts.push({ ai: openaiChatBinding(env), model: CHAT_OPENAI_MODEL, pool: 'openai' })
  }
  // First failover: Workers AI — free within the daily neuron allotment.
  if (env.AI && CHAT_FALLBACK_MODEL) {
    attempts.push({ ai: env.AI, model: CHAT_FALLBACK_MODEL, pool: 'neuron' })
  }
  // Last resort: Gemini — paid, its own budget. (If CHAT_MODEL is itself a
  // Workers AI model, run it on env.AI against the neuron budget instead.)
  if (CHAT_MODEL && CHAT_MODEL !== CHAT_FALLBACK_MODEL) {
    if (CHAT_MODEL.startsWith('@')) {
      if (env.AI) attempts.push({ ai: env.AI, model: CHAT_MODEL, pool: 'neuron' })
    } else if (env.GEMINI_API_KEY) {
      attempts.push({ ai: geminiChatBinding(env), model: CHAT_MODEL, pool: 'gemini' })
    }
  }
  return attempts
}

// Strip an unterminated <think> tail: if max_tokens cuts the model off
// mid-reasoning, the block never closes and must not leak to the player.
function stripThink(text) {
  return text.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '').trim()
}

function answerText(res) {
  const content = res?.choices?.[0]?.message?.content
  if (typeof content !== 'string') return ''
  return stripThink(content)
}

// Some models occasionally emit a tool call as a literal text fragment (a
// Harmony-style "to=functions.NAME ...{json}" token sequence) instead of
// populating the structured tool_calls field the chat-completions/Responses
// APIs are meant to return it in. Recognize that shape and recover it as the
// real call it was meant to be — otherwise it shows up as garbled text to the
// player, the write never gets gated/confirmed, and the model can go on to
// confidently claim (on a later turn) that an action succeeded when nothing
// ever ran.
const LEAKED_TOOL_CALL_RE = /to=functions\.([a-zA-Z_][\w]*)[^{]*(\{[\s\S]*)/
function recoverLeakedToolCall(content) {
  if (typeof content !== 'string') return null
  const match = content.match(LEAKED_TOOL_CALL_RE)
  if (!match) return null
  const [, name, rest] = match
  let depth = 0
  let end = -1
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '{') depth++
    else if (rest[i] === '}') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end === -1) return null
  let args
  try {
    args = JSON.parse(rest.slice(0, end + 1))
  } catch {
    return null
  }
  const before = content.slice(0, match.index).trim()
  const after = rest.slice(end + 1).trim()
  const text = stripThink([before, after].filter(Boolean).join(' '))
  return { name, args, text }
}

// Accumulate a call's reported token usage into per-pool message stats.
// A call that doesn't report both token counts marks the message unknown so
// the endpoint keeps its full worst-case reserve instead of refunding.
function trackUsage(stats, res) {
  const usage = res?.usage
  if (usage && typeof usage.prompt_tokens === 'number' && typeof usage.completion_tokens === 'number') {
    stats.promptTokens += usage.prompt_tokens
    stats.completionTokens += usage.completion_tokens
  } else {
    stats.usageUnknown = true
  }
}

// Thrown when the wall-clock budget runs out; the endpoint catches it and
// falls back to a retrieval-only answer.
export class ChatTimeoutError extends Error {
  constructor() {
    super('chat_time_budget_exceeded')
  }
}

// Race a promise against the absolute deadline. The losing work is abandoned,
// not cancelled — fine here: model/tool calls are read-only.
function raceDeadline(promise, deadline) {
  const ms = deadline - Date.now()
  if (ms <= 0) return Promise.reject(new ChatTimeoutError())
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ChatTimeoutError()), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

// Execute one model-requested tool call. Always resolves to result text — a
// failing or disallowed tool becomes a `Tool error:` message the model can
// work around, never a rejection that sinks the whole answer.
async function runChatTool(call, { env, authorization, identity, characterId }) {
  const name = call.function.name
  if (!CHAT_TOOL_ALLOWLIST.includes(name)) return `Tool error: '${name}' is not available.`
  const args = parseToolArgs(call.function.arguments)
  args.character_id = characterId
  try {
    const result = await callTool(name, args, { env, authorization, identity })
    return toolResultText(result)
  } catch (err) {
    return `Tool error: ${String(err?.message || err).slice(0, 200)}`
  }
}

// Run the model tool loop. Read tools run inline; write tools are gated — the
// first one the model calls is captured as `pendingWrite` (never executed here)
// and the loop stops so the endpoint can turn it into a confirmation. Tool calls
// are restricted to the allowlist and character_id is pinned to the
// authenticated character. Returns { answer, pendingWrite }: answer is '' when
// the model produced nothing usable; throws ChatTimeoutError past `deadline`.
// With `withTools:false` it does a single no-tools call (used for the
// post-confirmation summary). Exported for tests.
export async function runAiChat(
  env,
  messages,
  { authorization, identity, characterId, stats, deadline, ai, model, allowWrites = true, withTools = true },
) {
  const binding = ai || env.AI
  const modelId = model || CHAT_MODEL
  const runModel = async (payload) => {
    // Not worth starting a reasoning call with under 1.5s left.
    if (deadline - Date.now() < 1500) throw new ChatTimeoutError()
    try {
      const res = await raceDeadline(binding.run(modelId, payload), deadline)
      trackUsage(stats, res)
      return res
    } catch (err) {
      // An abandoned call may still bill tokens we never saw — keep the full
      // worst-case reserve instead of settling low.
      if (err instanceof ChatTimeoutError) stats.usageUnknown = true
      throw err
    }
  }
  if (!withTools) {
    const res = await runModel({ messages, ...CHAT_RUN_OPTS })
    return { answer: answerText(res), pendingWrite: null }
  }
  // Progressive tool reveal: only ALWAYS_ON_TOOL_NAMES + search_tools are
  // declared at first. A search_tools call adds its matches to this set so
  // later rounds in the SAME request can declare (and call) them — keeps the
  // per-call tool-schema payload small for the common case instead of sending
  // all ~50 MCP tool schemas on every turn.
  const activeTools = new Set(ALWAYS_ON_TOOL_NAMES)
  let pendingWrite = null
  for (let round = 0; round < CHAT_MAX_TOOL_ROUNDS; round++) {
    const tools = [SEARCH_TOOLS_DEF, ...chatToolDefs([...activeTools])]
    const res = await runModel({ messages, tools, ...CHAT_RUN_OPTS })
    const message = res?.choices?.[0]?.message
    let calls = (Array.isArray(message?.tool_calls) ? message.tool_calls : [])
      .filter((c) => c?.type === 'function' && c.function)
      .slice(0, 3)
      .map((c, i) => ({ ...c, id: c.id || `call_${round}_${i}` }))
    if (!calls.length) {
      const leaked = recoverLeakedToolCall(message?.content)
      if (leaked && CHAT_TOOL_ALLOWLIST.includes(leaked.name)) {
        calls = [{ id: `call_${round}_0`, type: 'function', function: { name: leaked.name, arguments: JSON.stringify(leaked.args) } }]
        if (message) message.content = leaked.text || null
      } else {
        const answer = answerText(res)
        if (answer) return { answer, pendingWrite: null }
        break
      }
    }
    messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: calls })
    // A write is never executed inline. Validate the writes' ids up front:
    // capture the first VALID one for the player to confirm, and feed any invalid
    // one straight back as an error so the model corrects it — no confirm, no
    // charge. Reads run in parallel; a second valid write this round is deferred.
    let captureIdx = -1
    const writeErrors = {}
    if (allowWrites) {
      for (let i = 0; i < calls.length; i++) {
        if (!isWriteTool(calls[i].function.name)) continue
        const err = validateWriteArgs(calls[i].function.name, parseToolArgs(calls[i].function.arguments))
        if (err) writeErrors[i] = err
        else if (captureIdx === -1) captureIdx = i
      }
    }
    const results = await raceDeadline(
      Promise.all(
        calls.map((call, i) => {
          if (call.function.name === SEARCH_TOOL_NAME) {
            const { query } = parseToolArgs(call.function.arguments)
            const { names, text } = searchToolsByQuery(typeof query === 'string' ? query : '')
            for (const n of names) activeTools.add(n)
            return Promise.resolve(text)
          }
          if (allowWrites && isWriteTool(call.function.name)) {
            if (writeErrors[i]) return Promise.resolve(`Tool error: ${writeErrors[i]}`)
            if (i === captureIdx) {
              const args = parseToolArgs(call.function.arguments)
              args.character_id = characterId
              pendingWrite = { tool: call.function.name, args }
              return Promise.resolve(PENDING_CONFIRMATION_NOTE)
            }
            return Promise.resolve(SECONDARY_WRITE_NOTE)
          }
          return runChatTool(call, { env, authorization, identity, characterId })
        }),
      ),
      deadline,
    )
    calls.forEach((call, i) => messages.push({ role: 'tool', tool_call_id: call.id, content: results[i] }))
    if (pendingWrite) {
      // One more no-tools call so the model phrases the confirmation request.
      const final = await runModel({ messages, ...CHAT_RUN_OPTS })
      return { answer: answerText(final), pendingWrite }
    }
  }
  // Tool budget exhausted or empty response — one last call with no tools so
  // the model must answer from what it has.
  const final = await runModel({ messages, ...CHAT_RUN_OPTS })
  return { answer: answerText(final), pendingWrite: null }
}

// Walk the ordered AI attempts to produce an answer (and, on the tool path, a
// captured pendingWrite). Handles the paid-pool reserve/settle so the day's
// spend can never cross budget mid-flight; the free Gemini attempt (pool null)
// is unmetered. Returns { answer, pendingWrite, reason }.
async function resolveAnswer(env, { buildTranscript, characterId, authorization, identity, withTools = true, allowWrites = true }) {
  const attempts = chatAttempts(env)
  if (!attempts.length) {
    // No provider reaches this deployment — almost always a secret set for the
    // wrong Pages environment. Log it loudly rather than degrade silently.
    console.warn(
      '[PocketRPG][chat] no AI provider configured — OPENAI_API_KEY / GEMINI_API_KEY / Workers AI (env.AI) all unavailable to this deployment',
    )
    return { answer: '', pendingWrite: null, reason: 'ai_unconfigured' }
  }
  const dayKey = utcDayKey()
  // Two paid daily pools reserved lazily on first use; a pool that no longer
  // fits skips only its own attempts. The free Gemini attempt has no pool.
  const pools = {
    openai: {
      key: openaiPoolKey(dayKey),
      reserve: CHAT_OPENAI_MESSAGE_RESERVE_TOKENS,
      budget: CHAT_OPENAI_TOKEN_BUDGET,
      cost: (s) => s.promptTokens + s.completionTokens,
    },
    neuron: {
      key: dayKey,
      reserve: CHAT_MESSAGE_RESERVE_MILLI,
      budget: CHAT_NEURON_BUDGET_MILLI,
      cost: (s) => usageMilliNeurons({ prompt_tokens: s.promptTokens, completion_tokens: s.completionTokens }),
    },
    gemini: {
      key: geminiPoolKey(dayKey),
      reserve: CHAT_GEMINI_MESSAGE_RESERVE_TOKENS,
      budget: CHAT_GEMINI_TOKEN_BUDGET,
      cost: (s) => s.promptTokens + s.completionTokens,
    },
  }
  let answer = ''
  let pendingWrite = null
  let reason = null
  const deadline = Date.now() + CHAT_TIME_BUDGET_MS
  for (const { ai, model, pool: poolName } of attempts) {
    const pool = poolName ? pools[poolName] : null
    if (pool && pool.stats === undefined) {
      const reserved = await reserveMessageNeurons(env, pool.key, pool.reserve, pool.budget)
      pool.stats = reserved ? { promptTokens: 0, completionTokens: 0, usageUnknown: false } : null
    }
    if (pool && !pool.stats) {
      reason = 'budget'
      continue
    }
    // Unmetered attempts still need a stats sink for runAiChat; throwaway.
    const stats = pool ? pool.stats : { promptTokens: 0, completionTokens: 0, usageUnknown: false }
    try {
      const messages = buildTranscript()
      const out = await runAiChat(env, messages, { authorization, identity, characterId, stats, deadline, ai, model, allowWrites, withTools })
      answer = out.answer
      pendingWrite = out.pendingWrite || null
      if (answer || pendingWrite) break
      reason = 'empty'
    } catch (err) {
      console.error(`[PocketRPG][chat] AI call failed (${model}):`, err?.message || err)
      answer = ''
      reason = err instanceof ChatTimeoutError ? 'timeout' : 'ai_error'
      if (err instanceof ChatTimeoutError) break
    }
  }
  // Always settle a reserved pool back to actual usage — even a timed-out call
  // that reported none — so a leaked reserve can't drain the day's budget.
  for (const pool of Object.values(pools)) {
    if (pool.stats) await settleMessageNeurons(env, pool.key, pool.reserve, pool.cost(pool.stats))
  }
  return { answer, pendingWrite, reason }
}

// Atomically debit the flat chatbot action fee (server-authoritative, same
// credits column as skip-hour). Returns { ok, remaining, charged }; ok:false =
// the character can't afford it, so nothing runs. When the fee is switched off
// (CHAT_ACTION_FEE_ENABLED=false) nothing is debited — just the current
// balance is read back — and `charged` is false so a later failure knows there
// is nothing to refund.
async function chargeActionFee(env, characterId, identityId) {
  if (!isChatActionFeeEnabled(env)) {
    const row = await env.DB.prepare(
      `SELECT credits FROM characters WHERE id = ?1 AND owner_id = ?2 AND deleted_at IS NULL`,
    )
      .bind(characterId, identityId)
      .first()
    return row ? { ok: true, remaining: Number(row.credits) || 0, charged: false } : { ok: false }
  }
  const debit = await env.DB.prepare(
    `UPDATE characters
     SET credits = credits - ?1, credits_used = credits_used + ?1
     WHERE id = ?2 AND owner_id = ?3 AND deleted_at IS NULL AND credits >= ?1
     RETURNING credits AS credits_remaining`,
  )
    .bind(CHAT_ACTION_FEE, characterId, identityId)
    .first()
  return debit ? { ok: true, remaining: debit.credits_remaining ?? 0, charged: true } : { ok: false }
}

// Give the fee back when the action didn't actually run (a failed tool call), so
// a rejected attempt is free.
async function refundActionFee(env, characterId, identityId) {
  try {
    await env.DB.prepare(
      `UPDATE characters
       SET credits = credits + ?1, credits_used = MAX(0, credits_used - ?1)
       WHERE id = ?2 AND owner_id = ?3 AND deleted_at IS NULL`,
    )
      .bind(CHAT_ACTION_FEE, characterId, identityId)
      .run()
  } catch (err) {
    console.error('[PocketRPG][chat] action-fee refund failed:', err?.message || err)
  }
}

// Sign a model-proposed write into the confirmable shape the client renders
// (label + credit cost + token). `question` carries the player's original ask
// forward so a follow-up step of the same request can chain after this one
// is confirmed (see confirmAction).
async function buildPendingAction(pendingWrite, { characterId, question, env }) {
  const label = actionLabel(pendingWrite.tool, pendingWrite.args)
  const cost = actionCreditCost(pendingWrite.tool, pendingWrite.args, isChatActionFeeEnabled(env))
  const token = await signPendingAction({ tool: pendingWrite.tool, args: pendingWrite.args, characterId, question }, env.JWT_SECRET)
  return { token, label, cost }
}

// Confirmation path: a previously-proposed write action, signed at propose time.
// Charge the 1-credit assistant fee FIRST — before any execution or AI spend —
// then execute it via the same MCP bridge (auth/locks/audit run in the real
// endpoint), then phrase the outcome. A failed action refunds the fee.
async function confirmAction({ env, authorization, identity, characterId, token }) {
  const payload = await verifyPendingAction(token, env.JWT_SECRET, characterId)
  if (!payload) {
    return json({ answer: "That action link has expired — just ask me again and I'll set it back up.", mode: 'action_expired' })
  }

  const feeEnabled = isChatActionFeeEnabled(env)

  // No credit, no action — and crucially, no AI spend past this point.
  const fee = await chargeActionFee(env, characterId, identity.id)
  if (!fee.ok) {
    return json({
      answer: feeEnabled
        ? `Running an action costs ${CHAT_ACTION_FEE} credit and you're out — top up credits in the shop, then ask me again.`
        : "Something went wrong queuing that action — try again.",
      mode: 'action_no_credit',
    })
  }

  let result
  try {
    result = await callTool(payload.tool, payload.args, { env, authorization, identity })
  } catch (err) {
    result = { content: [{ type: 'text', text: `Error: ${String(err?.message || err)}` }], isError: true }
  }
  const isError = !!result?.isError
  if (isError && fee.charged) await refundActionFee(env, characterId, identity.id)

  // Re-read the true balance on success — the action may have spent more credits
  // than the fee (a boss/hour skip) — so the client can update the credits
  // display in real time without a page refresh.
  let creditsRemaining = fee.remaining
  if (!isError) {
    const row = await env.DB.prepare('SELECT credits FROM characters WHERE id = ?').bind(characterId).first()
    if (row && Number.isFinite(Number(row.credits))) creditsRemaining = Number(row.credits)
  }

  const resultText = toolResultText(result)
  const label = actionLabel(payload.tool, payload.args)
  // Let the summary state the fee (and remaining balance on success).
  const feeNote = isError
    ? (feeEnabled
        ? `The ${CHAT_ACTION_FEE}-credit action fee was refunded because the action failed.`
        : 'No assistant fee was charged, and the action failed.')
    : (feeEnabled
        ? `This cost ${CHAT_ACTION_FEE} credit (the assistant action fee); the player has ${creditsRemaining} credit(s) left afterwards.`
        : `No assistant fee was charged for this action; the player has ${creditsRemaining} credit(s).`)

  // On success, when the original ask is known, let the model continue with
  // the next step of that ask — still gated behind its own confirm, just
  // without making the player type a follow-up message. A failed action never
  // chains (nothing to build on).
  const originalQuestion = typeof payload.question === 'string' ? payload.question.trim() : ''
  const canChain = !isError && !!originalQuestion

  // Phrase the outcome with the free/unmetered AI path; fall back to a
  // deterministic line if the AI path is unavailable.
  let answer = ''
  let nextPendingAction = null
  try {
    const out = await resolveAnswer(env, {
      buildTranscript: () =>
        canChain
          ? [
              { role: 'system', content: buildSystemPrompt(feeEnabled) },
              { role: 'user', content: `Player asked: ${originalQuestion}` },
              { role: 'user', content: `${ACTION_CHAIN_PREFACE}\n${feeNote}\nAction just completed: ${label}\nResult JSON: ${resultText}` },
            ]
          : [
              { role: 'system', content: buildSystemPrompt(feeEnabled) },
              { role: 'user', content: `${ACTION_RESULT_PREFACE}\n${feeNote}\nAction: ${label}\nResult JSON: ${resultText}` },
            ],
      characterId,
      authorization,
      identity,
      withTools: canChain,
      allowWrites: canChain,
    })
    answer = out.answer
    if (canChain && out.pendingWrite) {
      nextPendingAction = await buildPendingAction(out.pendingWrite, { characterId, question: originalQuestion, env })
      if (!answer) answer = `Done — ${label}. I can also ${nextPendingAction.label.toLowerCase()} next — confirm below.`
    }
  } catch {
    /* fall through to the deterministic line */
  }
  if (!answer) {
    answer = isError
      ? (feeEnabled
          ? `That didn't go through (your ${CHAT_ACTION_FEE} credit was refunded): ${resultText.replace(/^(Tool error|Error):\s*/, '')}`
          : `That didn't go through: ${resultText.replace(/^(Tool error|Error):\s*/, '')}`)
      : (feeEnabled
          ? `Done — ${label}. That cost ${CHAT_ACTION_FEE} credit; you have ${creditsRemaining} left.`
          : `Done — ${label}.`)
  }

  await auditLog(
    env,
    'chat_action',
    { identityId: identity.id, characterId, tool: payload.tool, isError, feeCharged: !isError, chained: !!nextPendingAction },
    { swallow: true },
  )
  return json({
    answer,
    mode: isError ? 'action_error' : nextPendingAction ? 'action_chained' : 'action_done',
    tool: payload.tool,
    ...(isError ? {} : { creditsRemaining }),
    ...(nextPendingAction ? { pendingAction: nextPendingAction } : {}),
  })
}

// Refill path: spend CHAT_REFILL_CREDITS to reset today's message count to 0,
// restoring the full daily allowance. Debit first (atomic, guarded); only reset
// on a successful charge.
async function refillMessages({ env, characterId, identityId }) {
  const debit = await env.DB.prepare(
    `UPDATE characters
     SET credits = credits - ?1, credits_used = credits_used + ?1
     WHERE id = ?2 AND owner_id = ?3 AND deleted_at IS NULL AND credits >= ?1
     RETURNING credits AS credits_remaining`,
  )
    .bind(CHAT_REFILL_CREDITS, characterId, identityId)
    .first()
  if (!debit) {
    return json({
      answer: `A refill costs ${CHAT_REFILL_CREDITS} credits and you don't have enough. Top up credits in the shop, or wait for the 00:00 UTC reset.`,
      mode: 'refill_no_credit',
    })
  }
  await resetCharacterMessages(env, characterId, utcDayKey())
  await auditLog(env, 'chat_refill', { identityId, characterId, credits: CHAT_REFILL_CREDITS }, { swallow: true })
  return json({
    answer: `Refilled — you've got ${CHAT_DAILY_LIMIT} more helper messages today. That cost ${CHAT_REFILL_CREDITS} credits (${debit.credits_remaining ?? 0} left).`,
    mode: 'refilled',
    remaining: CHAT_DAILY_LIMIT,
    resetInMs: nextResetMs(),
    creditsRemaining: debit.credits_remaining ?? 0,
  })
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)
  const authorization = request.headers.get('Authorization')

  const characterId = parseInt(request.headers.get('X-Character-Id') || '0', 10)
  if (!characterId) return json({ error: 'Missing X-Character-Id header' }, 400)
  const owned = await env.DB.prepare(
    'SELECT id FROM characters WHERE id = ? AND owner_id = ? AND deleted_at IS NULL',
  )
    .bind(characterId, auth.identity.id)
    .first()
  if (!owned) return json({ error: 'Character not found' }, 404)

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  // A confirm token means "run the action I already approved" — no question,
  // and it doesn't consume a daily message (it has its own credit fee).
  if (typeof body?.confirm === 'string' && body.confirm.trim()) {
    return confirmAction({ env, authorization, identity: auth.identity, characterId, token: body.confirm.trim() })
  }

  // A paid refill of the daily message allowance — no question either.
  if (body?.refill === true) {
    return refillMessages({ env, characterId, identityId: auth.identity.id })
  }

  const question = typeof body?.message === 'string' ? body.message.trim().slice(0, CHAT_MAX_QUESTION_CHARS) : ''
  if (!question) return json({ error: 'Missing message' }, 400)

  // Per-character daily cap. Exhausted → offer a paid refill; no AI is spent.
  const dayKey = utcDayKey()
  const claim = await claimCharacterMessage(env, characterId, dayKey)
  if (!claim.allowed) {
    return json({
      answer: `You've used all ${CHAT_DAILY_LIMIT} helper messages for today. Refill for ${CHAT_REFILL_CREDITS} credits, or wait — they reset at 00:00 UTC.`,
      mode: 'quota',
      remaining: 0,
      resetInMs: nextResetMs(),
      refillCredits: CHAT_REFILL_CREDITS,
    })
  }

  // Rank against the conversation, not just this message: a follow-up carries
  // almost no terms of its own, and retrieving on those alone returns chunks
  // about whatever generic word survived — which the system prompt then tells
  // the model to answer from.
  const history = body?.history
  const hits = searchKnowledge(question, getIndex(), CHAT_CONTEXT_CHUNKS, conversationContextTerms(history, question))
  const chunks = hits.map((h) => h.chunk)
  const sources = chunks.map((c) => ({ id: c.id, title: c.title }))

  const { answer: aiAnswer, pendingWrite, reason } = await resolveAnswer(env, {
    buildTranscript: () => buildMessages({ question, history, chunks, feeEnabled: isChatActionFeeEnabled(env) }),
    characterId,
    authorization,
    identity: auth.identity,
  })

  let answer = aiAnswer
  let mode = 'ai'
  let pendingAction = null
  if (pendingWrite) {
    // The model proposed a write — hand the player a signed, confirmable action
    // instead of running it. This is the enforcement point: no write executes
    // without a confirm round-trip.
    mode = 'action_pending'
    pendingAction = await buildPendingAction(pendingWrite, { characterId, question, env })
    if (!answer) answer = `I can ${pendingAction.label.toLowerCase()} for you — confirm below and I'll do it.`
  } else if (!answer) {
    // Whatever went wrong on the AI path — the player always gets a
    // knowledge-index answer.
    answer = retrievalOnlyAnswer(chunks)
    mode = 'retrieval'
  }

  // A degraded (retrieval-only) answer shouldn't cost the player a daily message.
  let remaining = claim.remaining
  if (mode === 'retrieval') {
    await refundCharacterMessage(env, characterId, dayKey)
    remaining = Math.min(CHAT_DAILY_LIMIT, remaining + 1)
  }

  await auditLog(
    env,
    'chat_message',
    { identityId: auth.identity.id, characterId, mode, questionChars: question.length },
    { swallow: true },
  )

  return json({
    answer,
    sources,
    mode,
    remaining,
    resetInMs: nextResetMs(),
    ...(pendingAction ? { pendingAction } : {}),
    ...(mode === 'retrieval' && reason ? { reason } : {}),
  })
}
